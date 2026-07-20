/**
 * Auto Layout(Step 27.13)— 自动布局算法。
 *
 * 职责:
 * - 把 AI 生成的 Graph(节点可能重叠)整理为可读的布局
 * - 按拓扑层级分层(源节点在左,OUTPUT 在右)
 * - 同层节点垂直排列,层间水平间距固定
 *
 * 算法:
 *   1. 用 buildParallelLevels 计算每个节点的层级
 *   2. 同层节点按出现顺序垂直排列
 *   3. 层间用 LAYER_SPACING 隔开,同层用 NODE_SPACING 隔开
 *
 * 与 runtime/scheduler.ts 的 buildParallelLevels 的关系:
 * - 复用同一个算法(拓扑分层)
 * - layout 只产出位置,不执行
 *
 * 未来扩展(Step 28+):
 * - 接入 Dagre / ELK.js 实现更精细的布局
 * - 支持手动布局覆盖(用户拖动后不自动重排)
 */

import type { GraphNode, NodePosition, RenderGraph } from './types'
import { NODE_SIZE } from './types'
import { buildParallelLevels } from './runtime/scheduler'

/** 层间水平间距(像素) */
const LAYER_SPACING = 280
/** 同层节点垂直间距(像素) */
const NODE_SPACING = 40
/** 起始 x 坐标 */
const START_X = 80
/** 起始 y 坐标 */
const START_Y = 80

/**
 * 自动布局结果。
 */
export interface LayoutResult {
  /** 节点 ID → 新位置 */
  positions: Map<string, NodePosition>
  /** 布局边界 { minX, minY, maxX, maxY } */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** 层级数 */
  layerCount: number
}

/**
 * 计算自动布局(不修改原 graph)。
 *
 * @param graph 待布局的 RenderGraph
 * @returns LayoutResult(包含每个节点的新位置)
 *
 * @example
 * const result = autoLayout(graph)
 * for (const [nodeId, pos] of result.positions) {
 *   graphStore.updateNodePosition(nodeId, pos)
 * }
 */
export function autoLayout(graph: RenderGraph): LayoutResult {
  if (graph.nodes.length === 0) {
    return {
      positions: new Map(),
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      layerCount: 0,
    }
  }

  const levels = buildParallelLevels(graph)
  const positions = new Map<string, NodePosition>()

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let layerIdx = 0; layerIdx < levels.length; layerIdx++) {
    const layer = levels[layerIdx]
    const x = START_X + layerIdx * LAYER_SPACING

    // 同层节点垂直居中排列
    const layerHeight = layer.length * (NODE_SIZE.headerHeight + 60) + (layer.length - 1) * NODE_SPACING
    const startY = START_Y + Math.max(0, (400 - layerHeight) / 2)

    for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
      const nodeId = layer[nodeIdx]
      const y = startY + nodeIdx * (NODE_SIZE.headerHeight + 60 + NODE_SPACING)
      positions.set(nodeId, { x, y })

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + NODE_SIZE.width)
      maxY = Math.max(maxY, y + NODE_SIZE.headerHeight + 80)
    }
  }

  // 处理孤立节点(不在任何 edge 中,但 levels 会包含它们)
  // buildParallelLevels 已保证所有节点都在某层中,这里不需要额外处理

  return {
    positions,
    bounds: {
      minX: minX === Infinity ? 0 : minX,
      minY: minY === Infinity ? 0 : minY,
      maxX: maxX === -Infinity ? 0 : maxX,
      maxY: maxY === -Infinity ? 0 : maxY,
    },
    layerCount: levels.length,
  }
}

/**
 * 把自动布局应用到 graphStore(批量更新位置)。
 *
 * 注意:此函数会修改 graph 中的节点位置,调用方负责 history 记录。
 *
 * @param graph     待布局的 RenderGraph(会被原地修改)
 * @param positions 由 autoLayout 计算的位置映射
 */
export function applyLayout(
  graph: RenderGraph,
  positions: Map<string, NodePosition>,
): void {
  for (const node of graph.nodes) {
    const pos = positions.get(node.id)
    if (pos) {
      node.position = { ...pos }
    }
  }
}

/**
 * 计算节点的布局边界(用于 fitView)。
 *
 * @param nodes 节点列表
 * @returns bounds { minX, minY, maxX, maxY }
 */
export function computeNodeBounds(nodes: GraphNode[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + NODE_SIZE.width)
    maxY = Math.max(maxY, node.position.y + NODE_SIZE.headerHeight + 80)
  }

  return {
    minX: minX === Infinity ? 0 : minX,
    minY: minY === Infinity ? 0 : minY,
    maxX: maxX === -Infinity ? 0 : maxX,
    maxY: maxY === -Infinity ? 0 : maxY,
  }
}
