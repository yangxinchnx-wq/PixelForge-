/**
 * Impact Analysis(Step 35.3)— 影响分析 + 循环检测 + 下游查询。
 *
 * 职责:
 * - 计算资产的下游影响集(改这个资产会影响谁)
 * - 计算资产的上游依赖集(这个资产依赖谁)
 * - 检测引用图中的循环(环路)
 * - 拓扑排序(DAG 验证)
 *
 * 算法:
 * - 下游影响: BFS 从 targetId 出发,沿 reverseIndex(入边)传播
 * - 上游依赖: BFS 从 sourceId 出发,沿 adjacency(出边)传播
 * - 循环检测: DFS 三色标记法(白/灰/黑)
 * - 拓扑排序: Kahn 算法(基于入度)
 *
 * 不职责:
 * - 不修改引用图(纯查询)
 * - 不做内容哈希(Step 35.4)
 */
import type { ReferenceGraph } from './referenceGraph'
import { getReferencers, getReferences } from './referenceGraph'

// ============================================================================
// 1. 下游影响分析(BFS 沿入边传播)
// ============================================================================

/**
 * 计算资产的下层影响集:改这个资产会影响哪些下游资产。
 *
 * 算法:从 assetId 出发,BFS 沿 reverseIndex(谁引用了它)向上游传播。
 *
 * @param graph 引用图
 * @param assetId 起始资产 ID
 * @returns 影响的资产 ID 集合(不含 assetId 本身)
 */
export function getDownstreamImpact(graph: ReferenceGraph, assetId: string): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = [assetId]
  visited.add(assetId)

  while (queue.length > 0) {
    const current = queue.shift()!
    // 谁引用了 current(入边)— 这些是受影响的下游
    const refBy = getReferencers(graph, current)
    for (const ref of refBy) {
      if (!visited.has(ref.sourceId)) {
        visited.add(ref.sourceId)
        queue.push(ref.sourceId)
      }
    }
  }

  visited.delete(assetId) // 不含自身
  return visited
}

/**
 * 计算资产的上层依赖集:这个资产依赖哪些上游资产。
 *
 * 算法:从 assetId 出发,BFS 沿 adjacency(它引用了谁)向下游传播。
 *
 * @param graph 引用图
 * @param assetId 起始资产 ID
 * @returns 依赖的资产 ID 集合(不含 assetId 本身)
 */
export function getUpstreamDependencies(graph: ReferenceGraph, assetId: string): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = [assetId]
  visited.add(assetId)

  while (queue.length > 0) {
    const current = queue.shift()!
    // current 引用了谁(出边)— 这些是它的依赖
    const refs = getReferences(graph, current)
    for (const ref of refs) {
      if (!visited.has(ref.targetId)) {
        visited.add(ref.targetId)
        queue.push(ref.targetId)
      }
    }
  }

  visited.delete(assetId)
  return visited
}

// ============================================================================
// 2. 影响深度
// ============================================================================

/**
 * 计算下游影响深度(BFS 层级)。
 *
 * @param graph 引用图
 * @param assetId 起始资产 ID
 * @returns Map<assetId, depth> 深度映射(不含 assetId 本身)
 */
export function getDownstreamDepth(
  graph: ReferenceGraph,
  assetId: string,
): Map<string, number> {
  const depth = new Map<string, number>()
  const queue: string[] = [assetId]
  depth.set(assetId, 0)

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depth.get(current) ?? 0
    const refBy = getReferencers(graph, current)
    for (const ref of refBy) {
      if (!depth.has(ref.sourceId)) {
        depth.set(ref.sourceId, currentDepth + 1)
        queue.push(ref.sourceId)
      }
    }
  }

  depth.delete(assetId)
  return depth
}

// ============================================================================
// 3. 循环检测(DFS 三色标记法)
// ============================================================================

/** 节点颜色: 白(未访问) / 灰(正在访问,在递归栈中) / 黑(已完成) */
type Color = 'white' | 'gray' | 'black'

/**
 * 检测引用图中是否存在循环(环路)。
 *
 * 算法:DFS 三色标记法,遇到灰色节点说明有环。
 *
 * @param graph 引用图
 * @returns true 表示存在循环
 */
export function hasCycle(graph: ReferenceGraph): boolean {
  const color = new Map<string, Color>()

  // 收集所有节点
  const allNodes = new Set<string>()
  for (const [sourceId, refs] of graph.adjacency) {
    allNodes.add(sourceId)
    for (const ref of refs) allNodes.add(ref.targetId)
  }

  for (const node of allNodes) {
    if (color.get(node) === 'black') continue
    if (dfsHasCycle(graph, node, color)) return true
  }
  return false
}

/** DFS 递归检测环 */
function dfsHasCycle(graph: ReferenceGraph, node: string, color: Map<string, Color>): boolean {
  color.set(node, 'gray')
  const refs = getReferences(graph, node)
  for (const ref of refs) {
    const targetColor = color.get(ref.targetId) ?? 'white'
    if (targetColor === 'gray') return true // 遇到灰节点 = 有环
    if (targetColor === 'white' && dfsHasCycle(graph, ref.targetId, color)) return true
  }
  color.set(node, 'black')
  return false
}

/**
 * 找出所有循环路径(环路列表)。
 *
 * @param graph 引用图
 * @returns 环路列表,每条环路是节点 ID 数组
 */
export function findCycles(graph: ReferenceGraph): string[][] {
  const cycles: string[][] = []
  const color = new Map<string, Color>()
  const path: string[] = []

  const allNodes = new Set<string>()
  for (const [sourceId, refs] of graph.adjacency) {
    allNodes.add(sourceId)
    for (const ref of refs) allNodes.add(ref.targetId)
  }

  for (const node of allNodes) {
    if (color.get(node) === 'black') continue
    dfsFindCycles(graph, node, color, path, cycles)
  }
  return cycles
}

/** DFS 递归找环 */
function dfsFindCycles(
  graph: ReferenceGraph,
  node: string,
  color: Map<string, Color>,
  path: string[],
  cycles: string[][],
): void {
  color.set(node, 'gray')
  path.push(node)

  const refs = getReferences(graph, node)
  for (const ref of refs) {
    const targetColor = color.get(ref.targetId) ?? 'white'
    if (targetColor === 'gray') {
      // 找到环:从 path 中 targetId 位置到当前 node
      const cycleStart = path.indexOf(ref.targetId)
      const cycle = path.slice(cycleStart)
      cycles.push([...cycle, ref.targetId])
    } else if (targetColor === 'white') {
      dfsFindCycles(graph, ref.targetId, color, path, cycles)
    }
  }

  path.pop()
  color.set(node, 'black')
}

// ============================================================================
// 4. 拓扑排序(Kahn 算法)
// ============================================================================

/**
 * 拓扑排序(Kahn 算法,基于入度)。
 *
 * 若图中有环,返回 null(无法拓扑排序)。
 *
 * @param graph 引用图
 * @returns 拓扑排序后的节点数组,有环返回 null
 */
export function topologicalSort(graph: ReferenceGraph): string[] | null {
  // 收集所有节点 + 计算入度
  const inDegree = new Map<string, number>()
  const allNodes = new Set<string>()
  for (const [sourceId, refs] of graph.adjacency) {
    allNodes.add(sourceId)
    for (const ref of refs) allNodes.add(ref.targetId)
  }
  for (const node of allNodes) inDegree.set(node, 0)
  for (const [, refs] of graph.adjacency) {
    for (const ref of refs) {
      inDegree.set(ref.targetId, (inDegree.get(ref.targetId) ?? 0) + 1)
    }
  }

  // 入度为 0 的节点入队
  const queue: string[] = []
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node)
  }

  const result: string[] = []
  while (queue.length > 0) {
    const node = queue.shift()!
    result.push(node)
    const refs = getReferences(graph, node)
    for (const ref of refs) {
      const newDeg = (inDegree.get(ref.targetId) ?? 1) - 1
      inDegree.set(ref.targetId, newDeg)
      if (newDeg === 0) queue.push(ref.targetId)
    }
  }

  // 若 result 包含所有节点,说明无环
  if (result.length === allNodes.size) return result
  return null
}

// ============================================================================
// 5. 影响集详情(含 Reference 信息)
// ============================================================================

/** 影响集项(资产 ID + 影响路径) */
export interface ImpactItem {
  /** 受影响的资产 ID */
  assetId: string
  /** 影响深度(0 = 直接引用) */
  depth: number
  /** 影响路径(从起始资产到该资产的引用链) */
  path: string[]
}

/**
 * 获取下游影响集详情(含路径 + 深度)。
 *
 * @param graph 引用图
 * @param assetId 起始资产 ID
 * @returns 影响项列表
 */
export function getDownstreamImpactDetails(
  graph: ReferenceGraph,
  assetId: string,
): ImpactItem[] {
  const depth = new Map<string, number>()
  const pathMap = new Map<string, string[]>()
  const queue: string[] = [assetId]
  depth.set(assetId, 0)
  pathMap.set(assetId, [assetId])

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depth.get(current) ?? 0
    const currentPath = pathMap.get(current) ?? [current]
    const refBy = getReferencers(graph, current)
    for (const ref of refBy) {
      if (!depth.has(ref.sourceId)) {
        depth.set(ref.sourceId, currentDepth + 1)
        pathMap.set(ref.sourceId, [...currentPath, ref.sourceId])
        queue.push(ref.sourceId)
      }
    }
  }

  const result: ImpactItem[] = []
  for (const [id, d] of depth) {
    if (id === assetId) continue
    result.push({ assetId: id, depth: d, path: pathMap.get(id) ?? [] })
  }
  return result.sort((a, b) => a.depth - b.depth)
}
