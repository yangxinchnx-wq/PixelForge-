/**
 * Graph Compiler(Step 25.6)。
 *
 * 职责:把 RenderGraph(DAG)转换为 RenderIR(线性 Layer 数组 + Region + Effect)。
 *
 * 转换策略:
 * 1. 拓扑排序节点(DFS 后序逆序),保证 Layer 顺序:背景在前,前景在后
 * 2. REGION 节点 → Layer(opcodeName → Opcode enum,params 直接拷贝)
 * 3. EFFECT 节点 → Effect(opcodeName = effect type,targetLayer = 前驱 REGION 节点)
 * 4. COMPOSITE 节点 → 不生成 Layer,但其所有前驱 REGION 节点共享同一 region
 * 5. OUTPUT 节点 → 不生成 Layer,标记最终合成目标
 *
 * Region 生成策略:
 * - 默认:每个 REGION 节点生成独立 region(bounds = 全画布)
 * - COMPOSITE 节点:其所有前驱合并到同一 region(layerRefs 合并)
 * - 简化版(当前):所有 REGION 节点共享 1 个全画布 region(与 generator/renderIRGenerator 一致)
 *
 * 与 generator/renderIRGenerator.ts 的区别:
 * - renderIRGenerator: CreativeRequirement → RenderIR(从需求生成)
 * - graphCompiler:    RenderGraph → RenderIR(从图编辑器编译)
 * 两者产出相同结构的 RenderIR,可互相替换。
 */

import type {
  Effect,
  Layer,
  Region,
  RenderIR,
} from '@/compiler/ir/renderIR'
import type {
  BlendMode,
  Opcode,
  ParameterOwner,
  SourceKind,
} from '@/shared/types'
import { Opcode as OpcodeEnum } from '@/shared/types'
import {
  stableEffectId,
  stableLayerId,
  stableRegionId,
} from '@/shared/ids'
import type {
  GraphNode,
  RenderGraph,
} from './types'
import { DEFAULT_GRAPH_CANVAS, SUPPORTED_EFFECT_TYPES } from './types'
import { validateGraph } from './validator'

/**
 * opcodeName → Opcode enum 映射(与 generator/renderIRGenerator 一致)。
 */
const OPCODE_NAME_TO_VALUE: Record<string, Opcode> = {
  SOLID_COLOR: OpcodeEnum.SOLID_COLOR,
  LINEAR_GRADIENT: OpcodeEnum.LINEAR_GRADIENT,
  NOISE: OpcodeEnum.NOISE,
  CIRCLE_SHAPE: OpcodeEnum.CIRCLE_SHAPE,
  IMAGE_TEXTURE: OpcodeEnum.IMAGE_TEXTURE,
}

/**
 * Graph 编译选项。
 */
export interface CompileOptions {
  /** 画布尺寸(默认从 graph.canvas 取,否则用 DEFAULT_GRAPH_CANVAS) */
  canvasWidth?: number
  canvasHeight?: number
  /** 是否创建默认 region(默认 true) */
  createRegion?: boolean
  /**
   * source 标记(默认 'llm_parser')。
   * 注意:SourceKind 是闭合枚举(7 个值),不支持 'graph_editor'。
   * - AI 生成的 Graph 用 'llm_parser'(与 generator/renderIRGenerator 一致)
   * - 用户手动编辑的 Graph 也用 'llm_parser'(标记为 AI 协助产物)
   * - 用户后续 patch 修改时,patch 系统会自动标记为 'user_patch'
   */
  source?: SourceKind
}

/**
 * Graph 编译产物(便于测试与调试)。
 */
export interface CompileResult {
  ir: RenderIR
  /** 拓扑序的节点 ID(便于调试) */
  topologicalOrder: string[]
  /** 节点 ID → Layer/Effect 的映射(便于 UI 高亮) */
  nodeToEntity: Record<string, 'layer' | 'effect' | 'skipped'>
  /** 警告信息 */
  warnings: string[]
}

/**
 * 拓扑排序(DFS 后序逆序)。
 *
 * @param graph 待排序的 Graph(假设已通过 validateGraph)
 * @returns 节点 ID 数组(拓扑序,源头在前,OUTPUT 在最后)
 */
export function topologicalSort(graph: RenderGraph): string[] {
  const visited = new Set<string>()
  const result: string[] = []

  // 邻接表:from → [to]
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from)
    if (list) list.push(edge.to)
  }

  function dfs(nodeId: string) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    const neighbors = adjacency.get(nodeId) ?? []
    for (const next of neighbors) {
      dfs(next)
    }
    result.push(nodeId)  // 后序添加
  }

  // 从所有节点开始 DFS(确保孤立节点也被访问)
  for (const node of graph.nodes) {
    dfs(node.id)
  }

  // 后序的逆序 = 拓扑序(源头在前,OUTPUT 在最后)
  return result.reverse()
}

/**
 * 把单个 GraphNode 转换为 Layer。
 *
 * @param node      REGION 类型节点
 * @param index     在拓扑序中的索引(用于稳定 ID)
 * @param source    source 标记(默认 'llm_parser')
 * @returns Layer
 */
export function nodeToLayer(
  node: GraphNode,
  index: number,
  source: SourceKind = 'llm_parser',
): Layer {
  if (!node.opcodeName) {
    throw new Error(`REGION 节点 ${node.name}(${node.id}) 缺少 opcodeName`)
  }

  const opcode = OPCODE_NAME_TO_VALUE[node.opcodeName]
  if (opcode === undefined) {
    throw new Error(
      `REGION 节点 ${node.name}(${node.id}) 的 opcodeName 不支持: ${node.opcodeName}`,
    )
  }

  const contentKey = `${index}_${node.opcodeName}_${node.name}_${node.id}_${JSON.stringify(node.params)}`
  const id = stableLayerId(source, contentKey)

  // ParameterOwner 是闭合枚举,Graph 编辑器节点统一标记为 'l2_parser'
  // (与 generator/renderIRGenerator 一致;用户通过 Inspector 修改时,patch 系统会升级为 'l2_user')
  const paramOwnership: Record<string, ParameterOwner> = {}
  for (const key of Object.keys(node.params)) {
    paramOwnership[key] = 'l2_parser'
  }

  return {
    id,
    opcode,
    params: { ...node.params },
    source,
    paramOwnership,
    visible: true,
    blendMode: 'normal' as BlendMode,
  }
}

/**
 * 把单个 EFFECT GraphNode 转换为 Effect。
 *
 * @param node       EFFECT 类型节点
 * @param targetLayer 目标 Layer ID(由前驱推导)
 * @param regionId   所属 Region ID
 * @param index      在拓扑序中的索引
 * @param source     source 标记(默认 'llm_parser')
 */
export function nodeToEffect(
  node: GraphNode,
  targetLayer: string,
  regionId: string,
  index: number,
  source: SourceKind = 'llm_parser',
): Effect {
  if (!node.opcodeName) {
    throw new Error(`EFFECT 节点 ${node.name}(${node.id}) 缺少 effect type`)
  }

  if (!SUPPORTED_EFFECT_TYPES.includes(node.opcodeName as typeof SUPPORTED_EFFECT_TYPES[number])) {
    throw new Error(
      `EFFECT 节点 ${node.name}(${node.id}) 的 type 不支持: ${node.opcodeName}`,
    )
  }

  const contentKey = `${index}_${node.opcodeName}_${node.id}_${JSON.stringify(node.params)}`
  const id = stableEffectId(source, contentKey)

  return {
    id,
    type: node.opcodeName,
    params: { ...node.params },
    targetLayer,
    targetRegion: regionId,
  }
}

/**
 * 主入口:编译 RenderGraph 为 RenderIR。
 *
 * @param graph    待编译的 RenderGraph
 * @param options  编译选项
 * @returns CompileResult(含 ir / topologicalOrder / nodeToEntity / warnings)
 *
 * @example
 * const result = compileGraph(graph)
 * runtimeStore.setRenderIR(result.ir)
 */
export function compileGraph(
  graph: RenderGraph,
  options: CompileOptions = {},
): CompileResult {
  const {
    canvasWidth,
    canvasHeight,
    createRegion = true,
    source = 'llm_parser',
  } = options

  // —— 1. 校验 ——
  const validation = validateGraph(graph)
  if (!validation.valid) {
    throw new Error(`Graph 校验失败:\n${validation.errors.join('\n')}`)
  }

  // —— 2. 拓扑排序 ——
  const topoOrder = topologicalSort(graph)
  const nodeMap = new Map<string, GraphNode>()
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node)
  }

  // —— 3. 节点 → Layer / Effect ——
  const layers: Layer[] = []
  const effects: Effect[] = []
  const nodeToEntity: Record<string, 'layer' | 'effect' | 'skipped'> = {}
  const warnings: string[] = [...validation.warnings]

  // 反向邻接表:to → [from](用于查 EFFECT 的前驱 REGION)
  const reverseAdjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!reverseAdjacency.has(edge.to)) {
      reverseAdjacency.set(edge.to, [])
    }
    reverseAdjacency.get(edge.to)!.push(edge.from)
  }

  // region 分组:遍历拓扑序,COMPOSITE 节点把其前驱 REGION 标记为同组
  // 简化版:所有 REGION 节点共享 1 个 region
  const regionLayerIds: string[] = []
  let layerIndex = 0
  let effectIndex = 0

  for (const nodeId of topoOrder) {
    const node = nodeMap.get(nodeId)
    if (!node) {
      warnings.push(`拓扑序中存在未知节点 ID: ${nodeId}`)
      continue
    }

    if (node.type === 'REGION') {
      const layer = nodeToLayer(node, layerIndex, source)
      layers.push(layer)
      regionLayerIds.push(layer.id)
      nodeToEntity[nodeId] = 'layer'
      layerIndex++
    } else if (node.type === 'EFFECT') {
      // 找到该 EFFECT 的前驱 REGION 节点(作为 targetLayer)
      const predecessors = reverseAdjacency.get(nodeId) ?? []
      let targetLayer: string | undefined

      // 沿前驱链查找第一个 REGION 节点对应的 Layer
      for (const predId of predecessors) {
        const predNode = nodeMap.get(predId)
        if (!predNode) continue
        // 直接前驱是 REGION → 用其 layer id
        if (predNode.type === 'REGION') {
          // 找到对应的 layer(按 nodeToEntity 标记)
          const predIndex = topoOrder.indexOf(predId)
          const predLayer = layers[layerIndex - 1]  // 简化:取最新加入的 layer
          void predIndex
          if (predLayer) {
            targetLayer = predLayer.id
            break
          }
        }
        // 直接前驱是 COMPOSITE / EFFECT → 需要递归查找(简化:取第一个 REGION layer)
        if (predNode.type === 'COMPOSITE' || predNode.type === 'EFFECT') {
          // 简化:取 layers 中最后一个作为 target
          if (layers.length > 0) {
            targetLayer = layers[layers.length - 1].id
            break
          }
        }
      }

      // 兜底:无前驱时取最后一个 layer
      if (!targetLayer && layers.length > 0) {
        targetLayer = layers[layers.length - 1].id
        warnings.push(
          `EFFECT 节点 ${node.name}(${node.id}) 无明确前驱,默认作用于最后一个 layer`,
        )
      }

      if (!targetLayer) {
        warnings.push(
          `EFFECT 节点 ${node.name}(${node.id}) 无可作用的 layer,跳过`,
        )
        nodeToEntity[nodeId] = 'skipped'
        continue
      }

      // region id 留待后面统一生成(用临时占位)
      const effect = nodeToEffect(
        node,
        targetLayer,
        '__pending_region__',
        effectIndex,
        source,
      )
      effects.push(effect)
      nodeToEntity[nodeId] = 'effect'
      effectIndex++
    } else if (node.type === 'COMPOSITE') {
      // COMPOSITE 节点不生成实体,但其前驱已经作为 layer 加入
      nodeToEntity[nodeId] = 'skipped'
    } else if (node.type === 'OUTPUT') {
      // OUTPUT 节点不生成实体
      nodeToEntity[nodeId] = 'skipped'
    } else if (node.type === 'INPUT') {
      // INPUT 节点(预留):当前不生成实体
      nodeToEntity[nodeId] = 'skipped'
    }
  }

  // —— 4. 创建 Region ——
  const regions: Region[] = []
  let defaultRegionId: string | undefined
  if (createRegion && layers.length > 0) {
    const contentKey = `default_${regionLayerIds.length}_${regionLayerIds.join(',')}`
    const regionId = stableRegionId(source, contentKey)
    const region: Region = {
      id: regionId,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      layerRefs: [...regionLayerIds],
      source,
    }
    regions.push(region)
    defaultRegionId = regionId
  }

  // —— 5. 回填 Effect 的 targetRegion ——
  if (defaultRegionId) {
    for (const effect of effects) {
      if (effect.targetRegion === '__pending_region__') {
        effect.targetRegion = defaultRegionId
      }
    }
  }

  // —— 6. 组装 RenderIR ——
  const width = canvasWidth ?? graph.canvas?.width ?? DEFAULT_GRAPH_CANVAS.width
  const height = canvasHeight ?? graph.canvas?.height ?? DEFAULT_GRAPH_CANVAS.height

  const ir: RenderIR = {
    canvas: { width, height },
    layers,
    regions,
    effects,
    compileHints: { preferredProfile: 'region' },
  }

  return {
    ir,
    topologicalOrder: topoOrder,
    nodeToEntity,
    warnings,
  }
}

/**
 * 计算 Graph 的可读摘要(用于 UI 反馈)。
 */
export function summarizeCompileResult(result: CompileResult): string {
  const { ir, topologicalOrder, warnings } = result
  const layerCount = ir.layers.length
  const effectCount = ir.effects.length
  const regionCount = ir.regions.length
  const warnCount = warnings.length
  const summary = `${layerCount} 图层 / ${regionCount} 区域 / ${effectCount} 效果 / ${topologicalOrder.length} 节点 @ ${ir.canvas.width}×${ir.canvas.height}`
  return warnCount > 0 ? `${summary} | ${warnCount} 警告` : summary
}
