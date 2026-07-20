/**
 * Node Evaluator(Step 26.5-27)— 节点求值器。
 *
 * 职责(用户 spec):
 *   不同节点调用不同 GPU 实现。
 *   Noise    → NoiseEvaluator    → GPU Compute(噪声生成)
 *   Spiral   → SpiralEvaluator   → GPU Compute(螺旋 UV 变换)
 *   ColorGrade → ColorEvaluator  → GPU Compute(色彩调色)
 *   Output   → OutputEvaluator   → 透传(标记最终输出)
 *
 * 接口设计:
 *   interface NodeEvaluator {
 *     execute(node, ctx): Promise<TextureHandle>
 *   }
 *
 * 与 NodeRegistry 的关系:
 * - NodeRegistry(Step 25):节点静态描述(type / opcode / ports / defaultParams)
 * - EvaluatorRegistry(本文件):节点动态求值(execute 函数)
 * 两者通过 node.type + node.opcodeName 关联,GraphRuntime 查表调用。
 *
 * GPU dispatch 策略(Step 27 已接入):
 * - ctx.device 可用时,调用真实 GPU compute shader(graph_node_eval / graph_effect / graph_composite)
 * - ctx.device 为 undefined 时(测试环境),仅创建 TextureHandle 元数据
 * - 这样测试可在无 GPU 环境运行,验证调度顺序与缓存逻辑
 */

import type { GraphNode, NodeType } from '../types'
import type { ResourceManager } from './resourceManager'
import { dispatchRegion, dispatchEffect, dispatchComposite } from './gpuDispatch'

/**
 * 纹理句柄(节点求值产物)。
 *
 * - id:          唯一 ID(对应 TexturePool 中的 PooledTexture.id)
 * - width/height: 纹理尺寸
 * - source:      产生方式
 *                 - 'fresh':       新申请的纹理(evaluator 真实执行)
 *                 - 'cache':       从缓存命中(evaluator 未执行)
 *                 - 'passthrough': 透传上游(EFFECT/OUTPUT 节点直接用上游纹理)
 * - nodeType:    产生该纹理的节点类型
 * - opcodeName:  产生该纹理的节点 opcode(便于调试)
 * - paramsHash:  节点参数的 hash(用于验证缓存有效性)
 * - gpuTexture:  可选的真实 GPUTexture(测试环境为 undefined)
 */
export interface TextureHandle {
  id: string
  width: number
  height: number
  source: 'fresh' | 'cache' | 'passthrough'
  nodeType: NodeType
  opcodeName?: string
  paramsHash: string
  gpuTexture?: GPUTexture
}

/**
 * 求值上下文(传递给每个 evaluator)。
 *
 * - resources:    资源管理器(申请/释放纹理)
 * - canvas:       画布尺寸(决定输出纹理大小)
 * - device:       可选的 GPU device(真实运行时注入,测试为 undefined)
 * - outputs:      已完成求值的节点输出(nodeId → TextureHandle)
 * - currentNodeId: 当前正在求值的节点 ID
 * - predecessors: 当前节点的直接前驱 ID 列表(由 GraphRuntime 根据 graph.edges 计算)
 *                 evaluator 通过此列表查找上游纹理,而非遍历全部 outputs
 */
export interface RuntimeContext {
  resources: ResourceManager
  canvas: { width: number; height: number }
  device?: GPUDevice
  outputs: Map<string, TextureHandle>
  /** 当前正在求值的节点 ID(evaluator 内部可读取) */
  currentNodeId: string
  /** 当前节点的直接前驱 ID 列表(按 graph.edges 推导,evaluator 据此查上游输出) */
  predecessors: string[]
}

/**
 * 节点求值器接口(用户 spec)。
 *
 * 实现类需要:
 * - 声明支持的 nodeType(便于 EvaluatorRegistry 查表)
 * - 实现 execute 方法(异步,因为 GPU 命令是异步的)
 */
export interface NodeEvaluator {
  readonly nodeType: NodeType
  execute(node: GraphNode, ctx: RuntimeContext): Promise<TextureHandle>
}

// ============================================================================
// 参数 hash(简化版,用于 TextureHandle.paramsHash)
// ============================================================================

function hashParams(params: Record<string, unknown>): string {
  const json = JSON.stringify(params, Object.keys(params).sort())
  let hash = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ============================================================================
// 各节点类型的 Evaluator 实现
// ============================================================================

/**
 * REGION 节点求值器(对应 SolidColor / LinearGradient / Noise / CircleShape / ImageTexture)。
 *
 * 当前实现:
 * - 申请一个画布尺寸的纹理
 * - 把节点 params 序列化为 paramsHash(便于缓存验证)
 * - 真实 GPU dispatch 留给 Step 27+ 接入 shader
 *
 * 未来扩展:
 * - 按 opcodeName 分发到不同 shader(NOISE_SHADER / GRADIENT_SHADER / ...)
 * - 调用 ctx.device.createComputePipeline + dispatchWorkgroups
 */
export class RegionEvaluator implements NodeEvaluator {
  readonly nodeType: NodeType = 'REGION'

  async execute(node: GraphNode, ctx: RuntimeContext): Promise<TextureHandle> {
    const { width, height } = ctx.canvas
    const tex = ctx.resources.acquireTexture(ctx.currentNodeId, {
      width,
      height,
      label: `region:${node.name}:${node.id}`,
    })

    // 真实 GPU dispatch: 当 device 可用且纹理有 GPU 资源时执行
    if (ctx.device && tex.gpuTexture) {
      dispatchRegion(ctx.device, node, tex.gpuTexture, ctx.canvas)
    }

    return {
      id: tex.id,
      width,
      height,
      source: 'fresh',
      nodeType: node.type,
      opcodeName: node.opcodeName,
      paramsHash: hashParams(node.params),
      gpuTexture: tex.gpuTexture,
    }
  }
}

/**
 * EFFECT 节点求值器(对应 Blur / Bloom / ColorShift / Vignette / Mask)。
 *
 * 当前实现:
 * - 取上游输入纹理(从 ctx.outputs 中查)
 * - 申请一个新纹理作为输出(EFFECT 通常需要读上游 + 写新纹理)
 * - 真实 GPU dispatch 留给 Step 27+
 *
 * 注:EFFECT 必须有 1 个输入(由 validator 保证),否则跳过执行。
 */
export class EffectEvaluator implements NodeEvaluator {
  readonly nodeType: NodeType = 'EFFECT'

  async execute(node: GraphNode, ctx: RuntimeContext): Promise<TextureHandle> {
    // 找到上游输入(取第一个有输出的前驱)
    const upstream = findUpstreamOutput(node, ctx)
    if (!upstream) {
      // 无上游,EFFECT 无作用对象,返回空纹理(理论上 validator 已警告)
      const { width, height } = ctx.canvas
      const tex = ctx.resources.acquireTexture(ctx.currentNodeId, {
        width,
        height,
        label: `effect-empty:${node.name}:${node.id}`,
      })
      return {
        id: tex.id,
        width,
        height,
        source: 'fresh',
        nodeType: node.type,
        opcodeName: node.opcodeName,
        paramsHash: hashParams(node.params),
        gpuTexture: tex.gpuTexture,
      }
    }

    // 申请输出纹理(与上游同尺寸)
    const tex = ctx.resources.acquireTexture(ctx.currentNodeId, {
      width: upstream.width,
      height: upstream.height,
      label: `effect:${node.name}:${node.id}`,
    })

    // 真实 GPU dispatch: 读取上游纹理, 写入输出纹理
    if (ctx.device && tex.gpuTexture && upstream.gpuTexture) {
      dispatchEffect(ctx.device, node, upstream.gpuTexture, tex.gpuTexture, {
        width: upstream.width,
        height: upstream.height,
      })
    }

    return {
      id: tex.id,
      width: upstream.width,
      height: upstream.height,
      source: 'fresh',
      nodeType: node.type,
      opcodeName: node.opcodeName,
      paramsHash: hashParams(node.params),
      gpuTexture: tex.gpuTexture,
    }
  }
}

/**
 * COMPOSITE 节点求值器(合并多个输入到单个输出)。
 *
 * 当前实现:
 * - 取所有上游输入
 * - 申请一个画布尺寸的输出纹理
 * - 真实 GPU 合成(blend mode)留给 Step 27+
 */
export class CompositeEvaluator implements NodeEvaluator {
  readonly nodeType: NodeType = 'COMPOSITE'

  async execute(node: GraphNode, ctx: RuntimeContext): Promise<TextureHandle> {
    const { width, height } = ctx.canvas
    const tex = ctx.resources.acquireTexture(ctx.currentNodeId, {
      width,
      height,
      label: `composite:${node.name}:${node.id}`,
    })

    // 真实 GPU dispatch: 收集上游纹理, 按混合模式合成
    if (ctx.device && tex.gpuTexture) {
      // 收集所有有 GPU 纹理的上游输入
      const inputTextures: GPUTexture[] = []
      for (const predId of ctx.predecessors) {
        const upstream = ctx.outputs.get(predId)
        if (upstream?.gpuTexture) {
          inputTextures.push(upstream.gpuTexture)
        }
      }
      // 至少需要 1 个输入才能合成
      if (inputTextures.length > 0) {
        // 从 node.params.blendMode 读取混合模式, 默认 normal
        const blendMode = typeof node.params.blendMode === 'string'
          ? node.params.blendMode
          : 'normal'
        dispatchComposite(ctx.device, inputTextures, tex.gpuTexture, ctx.canvas, blendMode)
      }
    }

    return {
      id: tex.id,
      width,
      height,
      source: 'fresh',
      nodeType: node.type,
      opcodeName: node.opcodeName,
      paramsHash: hashParams(node.params),
      gpuTexture: tex.gpuTexture,
    }
  }
}

/**
 * OUTPUT 节点求值器(画布输出)。
 *
 * 当前实现:
 * - 取上游输入纹理
 * - 标记为 passthrough(直接用上游纹理,不新建)
 * - GraphRuntime.execute() 返回该 handle 作为最终输出
 */
export class OutputEvaluator implements NodeEvaluator {
  readonly nodeType: NodeType = 'OUTPUT'

  async execute(node: GraphNode, ctx: RuntimeContext): Promise<TextureHandle> {
    const upstream = findUpstreamOutput(node, ctx)
    if (!upstream) {
      // 无上游,返回一个空纹理(理论上 validator 已报错)
      const { width, height } = ctx.canvas
      const tex = ctx.resources.acquireTexture(ctx.currentNodeId, {
        width,
        height,
        label: `output-empty:${node.id}`,
      })
      return {
        id: tex.id,
        width,
        height,
        source: 'fresh',
        nodeType: node.type,
        paramsHash: hashParams(node.params),
        gpuTexture: tex.gpuTexture,
      }
    }

    // OUTPUT 透传上游纹理(不新建)
    return {
      ...upstream,
      source: 'passthrough',
      nodeType: node.type,
      paramsHash: hashParams(node.params),
    }
  }
}

/**
 * INPUT 节点求值器(外部输入,预留)。
 *
 * 当前实现:返回空纹理(INPUT 节点在 Step 25 是预留类型,未实际使用)。
 */
export class InputEvaluator implements NodeEvaluator {
  readonly nodeType: NodeType = 'INPUT'

  async execute(node: GraphNode, ctx: RuntimeContext): Promise<TextureHandle> {
    const { width, height } = ctx.canvas
    const tex = ctx.resources.acquireTexture(ctx.currentNodeId, {
      width,
      height,
      label: `input:${node.name}:${node.id}`,
    })
    return {
      id: tex.id,
      width,
      height,
      source: 'fresh',
      nodeType: node.type,
      paramsHash: hashParams(node.params),
      gpuTexture: tex.gpuTexture,
    }
  }
}

// ============================================================================
// Evaluator Registry — 按 nodeType 查表
// ============================================================================

/**
 * 求值器注册表(按 NodeType 索引)。
 *
 * 与 nodeRegistry.ts 的区别:
 * - nodeRegistry:  按 key(如 'Noise')索引,描述节点静态能力
 * - EvaluatorRegistry: 按 NodeType(如 'REGION')索引,提供节点动态求值
 * 两者粒度不同,EvaluatorRegistry 按 type 分发(同 type 的节点共用一个 evaluator 实例)。
 *
 * 未来扩展:
 * - 若需要按 opcodeName 细分(如 NOISE 和 CIRCLE_SHAPE 用不同 evaluator),
 *   可升级为两级查表:先按 type,再按 opcodeName
 */
export const EvaluatorRegistry: Record<NodeType, NodeEvaluator> = {
  INPUT: new InputEvaluator(),
  REGION: new RegionEvaluator(),
  EFFECT: new EffectEvaluator(),
  COMPOSITE: new CompositeEvaluator(),
  OUTPUT: new OutputEvaluator(),
}

/**
 * 根据 NodeType 取求值器。
 *
 * @param nodeType 节点类型
 * @returns 对应的 NodeEvaluator 实例
 * @throws 若 nodeType 未知
 */
export function getEvaluatorByType(nodeType: NodeType): NodeEvaluator {
  const evaluator = EvaluatorRegistry[nodeType]
  if (!evaluator) {
    throw new Error(`未知节点类型: ${nodeType}`)
  }
  return evaluator
}

/**
 * 根据 GraphNode 取求值器(便捷方法)。
 */
export function getEvaluator(node: GraphNode): NodeEvaluator {
  return getEvaluatorByType(node.type)
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 查找节点的第一个直接前驱输出。
 *
 * 用于 EFFECT / OUTPUT 节点(单输入场景):
 * - EFFECT 通常有 1 个输入(由 validator 保证)
 * - OUTPUT 必须有 1 个输入
 * - COMPOSITE 可有多个输入(本函数取第一个,CompositeEvaluator 不依赖此函数)
 *
 * 实现策略:
 * - 遍历 ctx.predecessors(由 GraphRuntime 根据 graph.edges 预先计算)
 * - 返回第一个有输出的前驱的 TextureHandle
 * - 这样避免了「误取间接祖先」的 bug(旧实现遍历全部 outputs)
 *
 * 上游节点按拓扑序先于本节点求值,所以 ctx.outputs 中一定有前驱结果。
 */
function findUpstreamOutput(
  _node: GraphNode,
  ctx: RuntimeContext,
): TextureHandle | undefined {
  for (const predId of ctx.predecessors) {
    const handle = ctx.outputs.get(predId)
    if (handle) {
      return handle
    }
  }
  return undefined
}
