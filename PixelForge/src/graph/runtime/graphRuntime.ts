/**
 * Graph Runtime(Step 26.7)— 图运行主入口。
 *
 * 职责(用户 spec):
 *   把 RenderGraph(DAG)驱动为可执行的求值流水线:
 *
 *     Graph
 *       ↓
 *     Scheduler / ExecutionPlan
 *       ↓
 *     Node Evaluator(查 EvaluatorRegistry)
 *       ↓
 *     GPU Resource Allocation(ResourceManager / TexturePool)
 *       ↓
 *     Compute Pipeline(Step 27+ 接入真实 shader)
 *       ↓
 *     Texture Output
 *
 * 执行流程:
 *   1. buildExecutionPlan(graph) 得到拓扑序 steps + 并行 levels
 *   2. 对每个 step:
 *      a. 计算前驱 cache keys(传递性失效)
 *      b. 用 createCacheKey 生成 cache key
 *      c. 若 cache 命中:直接复用 TextureHandle(source='cache'),跳过 evaluator
 *      d. 若 cache 未命中:
 *         - 构造 RuntimeContext(currentNodeId / predecessors / outputs / resources)
 *         - 查 EvaluatorRegistry 取对应 evaluator
 *         - 调用 evaluator.execute(node, ctx)
 *         - 写入 NodeCache + ctx.outputs
 *   3. 返回 OUTPUT 节点的 TextureHandle + 统计信息
 *
 * 缓存策略:
 *   - cache key = type | opcodeName | paramsHash | inputCacheKeys | canvas
 *   - 上游任何变化 → 下游 cache key 变化 → 自然 miss(无需显式失效)
 *   - cache 只存元数据(TextureHandle),GPU 资源由 ResourceManager 管理
 *
 * 并行执行(已实现):
 *   - 按 plan.levels 逐层执行, 同层节点用 Promise.all 并行 dispatch
 *   - 同层节点无依赖关系, 可并发调用 evaluator.execute
 *   - 不同层之间串行 await(下游依赖上游结果)
 */

import type { GraphNode, RenderGraph } from '../types'
import { validateGraph } from '../validator'
import type { ExecutionPlan } from './executionPlan'
import { buildExecutionPlan, summarizeExecutionPlan } from './executionPlan'
import type { NodeCache } from './cache'
import { createCacheKey } from './cache'
import type { ResourceManager } from './resourceManager'
import { ResourceManager as ResourceManagerClass } from './resourceManager'
import type { RuntimeContext, TextureHandle } from './evaluator'
import { getEvaluator } from './evaluator'
import { NodeCache as NodeCacheClass } from './cache'
import { createGraphGpuTexture } from './gpuDispatch'

/**
 * GraphRuntime 选项。
 */
export interface GraphRuntimeOptions {
  /** 已有的 ResourceManager(可选,不传则内部新建) */
  resourceManager?: ResourceManager
  /** 已有的 NodeCache(可选,不传则内部新建) */
  cache?: NodeCache<TextureHandle>
  /** 画布尺寸(默认从 graph.canvas 取,否则用 1920×1080) */
  canvasWidth?: number
  canvasHeight?: number
  /** 可选的 GPUDevice(真实运行时注入,测试为 undefined) */
  device?: GPUDevice
  /** 是否禁用 cache(默认 false;调试时可设 true 强制每次重算) */
  disableCache?: boolean
}

/**
 * 单步执行结果(用于调试 / UI 高亮当前节点)。
 */
export interface StepResult {
  nodeId: string
  nodeType: GraphNode['type']
  nodeName: string
  /** 是否命中 cache */
  cacheHit: boolean
  /** 该步产物 */
  handle: TextureHandle
  /** 耗时(ms) */
  durationMs: number
}

/**
 * GraphRuntime.execute() 返回结果。
 */
export interface GraphRuntimeResult {
  /** 最终输出(OUTPUT 节点的 TextureHandle) */
  output: TextureHandle
  /** 全部节点的求值产物(nodeId → TextureHandle) */
  outputs: Map<string, TextureHandle>
  /** 每步的执行信息(便于 UI 高亮 / 调试) */
  steps: StepResult[]
  /** 执行计划摘要 */
  planSummary: string
  /** 缓存命中数 */
  cacheHits: number
  /** 缓存未命中数 */
  cacheMisses: number
  /** 总耗时(ms) */
  totalDurationMs: number
}

/**
 * 默认画布尺寸(与 types.ts DEFAULT_GRAPH_CANVAS 一致)。
 */
const DEFAULT_RUNTIME_CANVAS = { width: 1920, height: 1080 }

/**
 * Graph Runtime 主入口。
 *
 * @example
 * const runtime = new GraphRuntime(graph)
 * const result = await runtime.execute()
 * console.log(result.output)  // OUTPUT 节点的 TextureHandle
 *
 * @example 带缓存复用
 * const rm = new ResourceManager()
 * const cache = new NodeCache<TextureHandle>()
 * const runtime1 = new GraphRuntime(graph, { resourceManager: rm, cache })
 * await runtime1.execute()  // 全部 miss,写入 cache
 *
 * const runtime2 = new GraphRuntime(graph, { resourceManager: rm, cache })  // 复用 cache
 * await runtime2.execute()  // 全部 hit,跳过 evaluator
 */
export class GraphRuntime {
  private readonly graph: RenderGraph
  private readonly resources: ResourceManager
  private readonly cache: NodeCache<TextureHandle>
  private readonly canvas: { width: number; height: number }
  private readonly device?: GPUDevice
  private readonly disableCache: boolean

  constructor(graph: RenderGraph, options: GraphRuntimeOptions = {}) {
    this.graph = graph
    this.canvas = {
      width: options.canvasWidth ?? graph.canvas?.width ?? DEFAULT_RUNTIME_CANVAS.width,
      height: options.canvasHeight ?? graph.canvas?.height ?? DEFAULT_RUNTIME_CANVAS.height,
    }
    this.device = options.device
    this.disableCache = options.disableCache ?? false

    // 当 device 可用时, 配置 TexturePool 自动创建 GPU 纹理
    if (options.device && !options.resourceManager) {
      this.resources = new ResourceManagerClass({
        createGpuTexture: (desc) => {
          return createGraphGpuTexture(
            options.device!,
            desc.width,
            desc.height,
            desc.label ?? `graph_tex_${desc.width}x${desc.height}`,
          )
        },
      })
    } else {
      this.resources = options.resourceManager ?? new ResourceManagerClass()
    }
    this.cache = options.cache ?? new NodeCacheClass<TextureHandle>()
  }

  /**
   * 执行 Graph,返回 OUTPUT 节点的 TextureHandle + 统计信息。
   *
   * 流程:
   *   1. validateGraph(若失败抛错)
   *   2. buildExecutionPlan
   *   3. 按 levels 逐层执行, 同层节点并行 dispatch(Promise.all)
   *   4. 找到 OUTPUT 节点,返回其 TextureHandle
   *
   * 并行策略:
   *   - plan.levels 已计算好并行层级, 同层节点无依赖关系
   *   - 同层节点用 Promise.all 并发调用 evaluator.execute
   *   - 不同层之间串行 await(下游依赖上游结果)
   */
  async execute(): Promise<GraphRuntimeResult> {
    // —— 1. 校验 ——
    const validation = validateGraph(this.graph)
    if (!validation.valid) {
      throw new Error(`GraphRuntime: Graph 校验失败:\n${validation.errors.join('\n')}`)
    }

    // —— 2. 构建执行计划 ——
    const plan = buildExecutionPlan(this.graph)

    // —— 3. 准备执行上下文 ——
    const outputs = new Map<string, TextureHandle>()
    /** nodeId → 该节点本次执行的 cache key(供下游使用) */
    const cacheKeys = new Map<string, string>()
    /** stepIndex → StepResult(用于按拓扑序输出) */
    const stepResults = new Map<string, StepResult>()
    /** nodeId → 在 plan.steps 中的索引(用于排序) */
    const nodeStepIndex = new Map<string, number>()
    plan.steps.forEach((step, idx) => nodeStepIndex.set(step.id, idx))
    let cacheHits = 0
    let cacheMisses = 0
    const startTime = performance.now()

    // —— 4. 按 levels 逐层执行(同层并行) ——
    // 内容寻址去重:同层节点若 cache key 相同(内容一致),只求值一次,其余复用结果。
    // 这解决了 Promise.all 并行执行时,同内容节点互相 miss 的竞态问题。
    for (const level of plan.levels) {
      const tasks: Promise<void>[] = []

      if (!this.disableCache) {
        // —— 4a. cache 开启:按 cache key 分组,同 key 只求值一次 ——
        const cacheKeyToNodes = new Map<
          string,
          Array<{ nodeId: string; node: GraphNode; dependencies: string[] }>
        >()

        for (const nodeId of level) {
          const stepIndex = nodeStepIndex.get(nodeId)
          if (stepIndex === undefined) continue
          const step = plan.steps[stepIndex]
          const { node, dependencies } = step
          const inputCacheKeys = dependencies.map((depId) => cacheKeys.get(depId) ?? '__missing__')
          const cacheKey = createCacheKey(node, inputCacheKeys, this.canvas)

          const group = cacheKeyToNodes.get(cacheKey)
          if (group) {
            group.push({ nodeId, node, dependencies })
          } else {
            cacheKeyToNodes.set(cacheKey, [{ nodeId, node, dependencies }])
          }
        }

        // 每个唯一 cache key 创建一个求值任务(不同 key 之间并行)
        for (const [cacheKey, group] of cacheKeyToNodes) {
          const first = group[0]
          const { node, dependencies } = first
          const stepStart = performance.now()

          tasks.push(
            (async () => {
              let handle: TextureHandle
              let cacheHit = false

              // 第一个节点:检查 cache
              const cached = this.cache.get(cacheKey)
              if (cached) {
                handle = { ...cached, source: 'cache' }
                cacheHit = true
                cacheHits++
              } else {
                handle = await this.evaluateNode(node, dependencies, outputs)
                this.cache.set(cacheKey, handle, first.nodeId)
                cacheMisses++
              }

              // 第一个节点写入 outputs / cacheKeys / stepResults
              outputs.set(first.nodeId, handle)
              cacheKeys.set(first.nodeId, cacheKey)
              stepResults.set(first.nodeId, {
                nodeId: first.nodeId,
                nodeType: node.type,
                nodeName: node.name,
                cacheHit,
                handle,
                durationMs: performance.now() - stepStart,
              })

              // 同 cache key 的其余节点:复用第一个节点的结果(视为 cache hit)
              for (let i = 1; i < group.length; i++) {
                const { nodeId: nid, node: n } = group[i]
                const sharedHandle: TextureHandle = { ...handle, source: 'cache' }
                outputs.set(nid, sharedHandle)
                cacheKeys.set(nid, cacheKey)
                cacheHits++
                stepResults.set(nid, {
                  nodeId: nid,
                  nodeType: n.type,
                  nodeName: n.name,
                  cacheHit: true,
                  handle: sharedHandle,
                  durationMs: 0,
                })
              }
            })(),
          )
        }
      } else {
        // —— 4b. cache 禁用:每个节点独立求值 ——
        for (const nodeId of level) {
          const stepIndex = nodeStepIndex.get(nodeId)
          if (stepIndex === undefined) continue
          const step = plan.steps[stepIndex]
          const { node, dependencies } = step
          const stepStart = performance.now()
          const inputCacheKeys = dependencies.map((depId) => cacheKeys.get(depId) ?? '__missing__')
          const cacheKey = createCacheKey(node, inputCacheKeys, this.canvas)

          tasks.push(
            (async () => {
              const handle = await this.evaluateNode(node, dependencies, outputs)
              cacheMisses++
              outputs.set(nodeId, handle)
              cacheKeys.set(nodeId, cacheKey)
              stepResults.set(nodeId, {
                nodeId,
                nodeType: node.type,
                nodeName: node.name,
                cacheHit: false,
                handle,
                durationMs: performance.now() - stepStart,
              })
            })(),
          )
        }
      }

      // 同层并行执行
      await Promise.all(tasks)
    }

    // 按 plan.steps 的拓扑序输出 StepResult
    const steps: StepResult[] = plan.steps
      .map((step) => stepResults.get(step.id))
      .filter((s): s is StepResult => s !== undefined)

    const totalDurationMs = performance.now() - startTime

    // —— 5. 找到 OUTPUT 节点的产物 ——
    const outputNode = this.graph.nodes.find((n) => n.type === 'OUTPUT')
    if (!outputNode) {
      // 理论上不会走到这里(validator 已保证有 OUTPUT 节点)
      throw new Error('GraphRuntime: Graph 缺少 OUTPUT 节点(validator 应已拦截)')
    }
    const outputHandle = outputs.get(outputNode.id)
    if (!outputHandle) {
      throw new Error(`GraphRuntime: OUTPUT 节点 ${outputNode.id} 未产生输出(拓扑序异常?)`)
    }

    return {
      output: outputHandle,
      outputs,
      steps,
      planSummary: summarizeExecutionPlan(plan),
      cacheHits,
      cacheMisses,
      totalDurationMs,
    }
  }

  /**
   * 调用单个节点的 evaluator(供 execute 内部使用)。
   *
   * @param node         待求值节点
   * @param dependencies 前驱节点 ID 列表
   * @param outputs      已完成的节点产物
   * @returns 节点求值产物(TextureHandle)
   */
  private async evaluateNode(
    node: GraphNode,
    dependencies: string[],
    outputs: Map<string, TextureHandle>,
  ): Promise<TextureHandle> {
    const evaluator = getEvaluator(node)
    const ctx: RuntimeContext = {
      resources: this.resources,
      canvas: this.canvas,
      device: this.device,
      outputs,
      currentNodeId: node.id,
      predecessors: dependencies,
    }
    return evaluator.execute(node, ctx)
  }

  /**
   * 获取执行计划(不执行,仅返回 ExecutionPlan 供 UI 预览)。
   */
  getExecutionPlan(): ExecutionPlan {
    return buildExecutionPlan(this.graph)
  }

  /**
   * 获取资源管理器(供外部查询统计信息)。
   */
  getResources(): ResourceManager {
    return this.resources
  }

  /**
   * 获取缓存(供外部查询 / 失效)。
   */
  getCache(): NodeCache<TextureHandle> {
    return this.cache
  }

  /**
   * 失效某个节点的缓存(参数变化时调用)。
   *
   * @returns 删除的缓存项数量
   */
  invalidateNode(nodeId: string): number {
    return this.cache.invalidateNode(nodeId)
  }

  /**
   * 清空全部缓存(画布尺寸变化 / 强制重渲染时调用)。
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * 释放所有 GPU 资源(销毁 Runtime 时调用)。
   */
  dispose(): void {
    this.resources.disposeAll()
    this.cache.clear()
  }
}
