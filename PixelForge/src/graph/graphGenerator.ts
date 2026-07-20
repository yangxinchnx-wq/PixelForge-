/**
 * Graph Generator(Step 25.9 — AI Generator 接 Graph)。
 *
 * 职责:把 CreativeRequirement 转换为 RenderGraph(DAG)。
 *
 * 数据流:
 *   CreativeRequirement
 *     → createScenePlan(requirement)              [复用 Step 24 的 planner]
 *     → SceneLayer[]
 *     → 每个 SceneLayer → GraphNode(从 NodeRegistry 查模板)
 *     → 自动连边(背景 → 主体 → 前景 → ... → Output)
 *     → 自动追加 Effect 节点(cinematic → Vignette 等)
 *     → RenderGraph
 *
 * 与 generator/renderIRGenerator.ts 的关系:
 * - renderIRGenerator: Requirement → RenderIR(线性 Layer 数组)
 * - graphGenerator:    Requirement → RenderGraph(DAG,可编辑)
 * 两者从同一 requirement 出发,graphGenerator 多一层「图结构」表达,
 * 用户可在 Graph Editor 中继续修改,而 renderIRGenerator 输出不可编辑。
 *
 * 节点位置自动布局:
 * - 横向链式布局(从左到右,每个节点 x 间隔 220px)
 * - 同一层级纵向堆叠(同一 role 的节点 y 间隔 180px)
 */

import type { CreativeRequirement } from '@/authoring/clarifier/types'
import type { JsonLiteral } from '@/shared/types'
import { createScenePlan } from '@/authoring/generator/planner'
import type { SceneLayer } from '@/authoring/generator/types'
import {
  findRegionNodeByOpcodeName,
  getNodeDefinition,
  type NodeRegistryKey,
} from './nodeRegistry'
import type {
  GraphEdge,
  GraphNode,
  NodePosition,
  RenderGraph,
} from './types'
import { DEFAULT_GRAPH_CANVAS } from './types'

/**
 * 节点自动布局配置。
 */
const LAYOUT = {
  startX: 80,
  startY: 80,
  stepX: 240,  // 横向间距
  stepY: 200,  // 纵向间距(同列多节点)
} as const

/**
 * Graph Generator 选项。
 */
export interface GraphGeneratorOptions {
  /** 画布尺寸(默认 1920×1080) */
  canvasWidth?: number
  canvasHeight?: number
  /** 是否自动追加 Effect 节点(默认 true) */
  createEffects?: boolean
  /** 是否自动追加 Output 节点(默认 true,每个 Graph 必须有) */
  createOutput?: boolean
}

/**
 * 把 SceneLayer 转换为 GraphNode。
 *
 * @param planLayer ScenePlan 中的图层
 * @param position  节点位置
 * @param id        节点 ID(由调用方分配,保证稳定)
 */
export function sceneLayerToGraphNode(
  planLayer: SceneLayer,
  position: NodePosition,
  id: string,
): GraphNode {
  // 从 opcodeName 反查 NodeRegistry key
  const registryKey = findRegionNodeByOpcodeName(planLayer.opcodeName)
  if (!registryKey) {
    throw new Error(
      `SceneLayer ${planLayer.name} 的 opcodeName ${planLayer.opcodeName} 在 NodeRegistry 中无对应节点`,
    )
  }

  const def = getNodeDefinition(registryKey)

  return {
    id,
    type: 'REGION',
    name: planLayer.name,
    position,
    inputs: def.inputs.map((p) => ({ ...p })),
    outputs: def.outputs.map((p) => ({ ...p })),
    params: { ...planLayer.params },
    opcodeName: planLayer.opcodeName,
    templateKey: def.key,
  }
}

/**
 * 根据 style.tone / lighting 决定追加哪些 EFFECT 节点。
 *
 * 与 generator/renderIRGenerator.ts 的 generateEffects 策略一致:
 *   - tone=cinematic → Vignette
 *   - tone=dreamy    → Bloom
 *   - lighting=高对比 → ColorShift
 *   - lighting=柔和  → Blur
 */
function pickEffectNodes(requirement: CreativeRequirement): NodeRegistryKey[] {
  const keys: NodeRegistryKey[] = []
  const tone = requirement.style?.tone
  const lighting = requirement.style?.lighting

  if (tone === 'cinematic') keys.push('Vignette')
  if (tone === 'dreamy') keys.push('Bloom')
  if (lighting === '高对比') keys.push('ColorShift')
  if (lighting === '柔和') keys.push('Blur')

  return keys
}

/**
 * 生成稳定节点 ID(同输入同 ID,便于测试与缓存命中)。
 *
 * 与 graphStore.generateNodeId 的区别:
 * - graphStore: 实例寻址(每次拖入都是新 ID)
 * - graphGenerator: 内容寻址(同 requirement 生成相同 ID,便于 idempotent 加载)
 */
function makeNodeId(prefix: string, index: number, contentKey: string): string {
  // 简单 hash:用 contentKey 长度 + 索引组合(避免依赖额外 hash 库)
  const hash = contentKey.length.toString(36) + index.toString(36)
  return `${prefix}_${hash}`
}

/**
 * 生成稳定 edge ID(与 graphStore.makeEdgeId 一致)。
 */
function makeEdgeId(
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
): string {
  return `${from}:${fromPort}->${to}:${toPort}`
}

/**
 * 主入口:从 CreativeRequirement 生成 RenderGraph。
 *
 * @param requirement 已澄清的完整需求
 * @param options     生成选项
 * @returns RenderGraph(可直接 load 到 graphStore)
 *
 * @example
 * const graph = generateGraph(req)
 * graphStore.loadGraph(graph)
 * const result = compileGraph(graph)
 * runtimeStore.setRenderIR(result.ir)
 */
export function generateGraph(
  requirement: CreativeRequirement,
  options: GraphGeneratorOptions = {},
): RenderGraph {
  const {
    canvasWidth = DEFAULT_GRAPH_CANVAS.width,
    canvasHeight = DEFAULT_GRAPH_CANVAS.height,
    createEffects = true,
    createOutput = true,
  } = options

  // —— 1. 复用 Step 24 的 planner 生成 ScenePlan ——
  const plan = createScenePlan(requirement)

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // —— 2. SceneLayer → GraphNode(横向链式布局) ——
  const layerNodeIds: string[] = []
  plan.layers.forEach((planLayer, index) => {
    const id = makeNodeId('layer', index, `${planLayer.opcodeName}_${planLayer.name}`)
    const position: NodePosition = {
      x: LAYOUT.startX + index * LAYOUT.stepX,
      y: LAYOUT.startY,
    }
    const node = sceneLayerToGraphNode(planLayer, position, id)
    nodes.push(node)
    layerNodeIds.push(id)
  })

  // —— 3. 自动连边(链式:layer[0] → layer[1] → ... → layer[n-1]) ——
  for (let i = 0; i < layerNodeIds.length - 1; i++) {
    const from = layerNodeIds[i]
    const to = layerNodeIds[i + 1]
    edges.push({
      id: makeEdgeId(from, 'output', to, 'input'),
      from,
      fromPort: 'output',
      to,
      toPort: 'input',
    })
  }

  // —— 4. 追加 Effect 节点(链式接到最后一个 layer 后面) ——
  let lastNodeId = layerNodeIds[layerNodeIds.length - 1]
  let nextX = LAYOUT.startX + plan.layers.length * LAYOUT.stepX

  if (createEffects) {
    const effectKeys = pickEffectNodes(requirement)
    effectKeys.forEach((key, index) => {
      const def = getNodeDefinition(key)
      const id = makeNodeId('effect', index, `${def.opcodeName}_${def.label}`)
      const node: GraphNode = {
        id,
        type: 'EFFECT',
        name: def.label,
        position: { x: nextX, y: LAYOUT.startY },
        inputs: def.inputs.map((p) => ({ ...p })),
        outputs: def.outputs.map((p) => ({ ...p })),
        params: { ...def.defaultParams },
        opcodeName: def.opcodeName,
        templateKey: def.key,
      }
      nodes.push(node)

      // 连边:上一个节点 → 当前 effect 节点
      if (lastNodeId) {
        edges.push({
          id: makeEdgeId(lastNodeId, 'output', id, 'input'),
          from: lastNodeId,
          fromPort: 'output',
          to: id,
          toPort: 'input',
        })
      }

      lastNodeId = id
      nextX += LAYOUT.stepX
    })
  }

  // —— 5. 追加 Output 节点(必须) ——
  if (createOutput && lastNodeId) {
    const outputDef = getNodeDefinition('Output')
    const outputId = makeNodeId('output', 0, 'output')
    const outputNode: GraphNode = {
      id: outputId,
      type: 'OUTPUT',
      name: '输出',
      position: { x: nextX, y: LAYOUT.startY },
      inputs: outputDef.inputs.map((p) => ({ ...p })),
      outputs: [],
      params: {},
    }
    nodes.push(outputNode)
    edges.push({
      id: makeEdgeId(lastNodeId, 'output', outputId, 'input'),
      from: lastNodeId,
      fromPort: 'output',
      to: outputId,
      toPort: 'input',
    })
  }

  return {
    nodes,
    edges,
    canvas: { width: canvasWidth, height: canvasHeight },
  }
}

/**
 * 把 Effect 节点的参数从 requirement 风格映射到节点参数。
 *
 * 与 generator/renderIRGenerator.ts 的 generateEffects 中各 effect 的默认参数对齐:
 *   - vignette: { strength: 0.5 }
 *   - bloom:    { threshold: 0.7, intensity: 0.5 } → 简化为 { intensity: 0.4 }
 *   - color_shift: { shift: 0.3 } → 简化为 { strength: 0.3 }
 *   - blur:     { radius: 0.003 }
 *
 * 注意:NodeRegistry 中各 effect 的默认参数已经是合理值,
 *       这里仅在需要根据 requirement 微调时使用(目前返回空,直接用默认值)。
 */
export function mapEffectParams(
  effectKey: NodeRegistryKey,
  _requirement: CreativeRequirement,
): Record<string, JsonLiteral> {
  // 当前版本:使用 NodeRegistry 中的默认参数(不额外覆盖)
  // 未来可扩展:根据 requirement.style.tone 微调 strength 等
  void effectKey
  void _requirement
  return {}
}

/**
 * 计算 Graph 的可读摘要(用于 UI 反馈)。
 */
export function summarizeGraph(graph: RenderGraph): string {
  const { nodes, edges } = graph
  const regionCount = nodes.filter((n) => n.type === 'REGION').length
  const effectCount = nodes.filter((n) => n.type === 'EFFECT').length
  const hasOutput = nodes.some((n) => n.type === 'OUTPUT')
  return `${nodes.length} 节点(${regionCount} 图层 / ${effectCount} 效果) / ${edges.length} 连接 / ${hasOutput ? '已连接输出' : '无输出'}`
}
