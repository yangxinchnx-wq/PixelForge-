/**
 * DAG Scheduler(Step 26.4)— 决定「哪个节点先执行」。
 *
 * 职责:
 * - buildSchedule:        拓扑排序(DFS 后序,依赖在前,OUTPUT 在最后)
 * - buildParallelLevels:  分层(同层节点无依赖关系,可并行调度)
 *
 * 与 graphCompiler.ts 的 topologicalSort 的区别:
 * - graphCompiler.topologicalSort: 使用前向邻接(from → to),DFS 后序 + reverse
 * - scheduler.buildSchedule:       使用反向邻接(to → from),DFS 后序,无需 reverse
 * 两者产出相同的拓扑序,但 scheduler 的语义更清晰(直接表达「先求依赖」)。
 *
 * 算法(用户 spec):
 *   function visit(id):
 *     if visited.has(id): return
 *     visited.add(id)
 *     for dep in edges.where(to === id):  // 反向边 = 依赖
 *       visit(dep.from)
 *     result.push(id)  // 后序添加:依赖先入列,本节点后入列
 *   for node in graph.nodes: visit(node.id)
 *
 * 复杂度:O(V + E),每个节点访问一次,每条边遍历一次。
 */

import type { RenderGraph } from '../types'

/**
 * 拓扑排序(DFS 后序,依赖在前)。
 *
 * @param graph 待排序的 RenderGraph(假设已通过 validateGraph,无环)
 * @returns 节点 ID 数组(拓扑序,源头在前,OUTPUT 在最后)
 *
 * @example
 *   Graph:  Noise → Spiral → ColorGrade → Output
 *   buildSchedule(graph) → ['Noise', 'Spiral', 'ColorGrade', 'Output']
 */
export function buildSchedule(graph: RenderGraph): string[] {
  const visited = new Set<string>()
  const result: string[] = []

  // 反向邻接表:to → [from](即每个节点的依赖列表)
  const reverseAdjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    reverseAdjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    const list = reverseAdjacency.get(edge.to)
    if (list) list.push(edge.from)
  }

  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)

    const deps = reverseAdjacency.get(id) ?? []
    for (const dep of deps) {
      visit(dep)
    }

    result.push(id)  // 依赖先入列,本节点后入列
  }

  // 从所有节点开始 DFS(确保孤立节点也被访问)
  for (const node of graph.nodes) {
    visit(node.id)
  }

  return result
}

/**
 * 分层:把节点按依赖深度分组,同层节点可并行执行。
 *
 * 算法:Kahn 算法变体
 *   1. level[node] = 0 if no dependencies
 *   2. level[node] = max(level[dep] for dep in dependencies) + 1
 *   3. 按 level 分组输出
 *
 * @param graph 待分层的 RenderGraph(假设已通过 validateGraph,无环)
 * @returns 层级数组(每层是节点 ID 数组,层 0 在最前)
 *
 * @example
 *   Graph:  A → B → D
 *           A → C → D
 *   buildParallelLevels(graph) → [['A'], ['B', 'C'], ['D']]
 *
 *   Graph:  Noise → Spiral → ColorGrade → Output
 *   buildParallelLevels(graph) → [['Noise'], ['Spiral'], ['ColorGrade'], ['Output']]
 */
export function buildParallelLevels(graph: RenderGraph): string[][] {
  // 反向邻接表:to → [from]
  const reverseAdjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    reverseAdjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    const list = reverseAdjacency.get(edge.to)
    if (list) list.push(edge.from)
  }

  // 计算每个节点的 level
  const levels = new Map<string, number>()
  const computing = new Set<string>()  // 用于检测环(虽然 validator 已保证无环)

  function getLevel(id: string): number {
    if (levels.has(id)) return levels.get(id)!
    if (computing.has(id)) {
      // 理论上不会走到这里(validator 已检测环),防御性处理
      throw new Error(`buildParallelLevels: 检测到环,节点 ${id} 仍在计算中`)
    }
    computing.add(id)

    const deps = reverseAdjacency.get(id) ?? []
    let maxDepLevel = -1
    for (const dep of deps) {
      maxDepLevel = Math.max(maxDepLevel, getLevel(dep))
    }

    const level = maxDepLevel + 1
    levels.set(id, level)
    computing.delete(id)
    return level
  }

  for (const node of graph.nodes) {
    getLevel(node.id)
  }

  // 按 level 分组
  const grouped: string[][] = []
  for (const [id, level] of levels) {
    if (!grouped[level]) grouped[level] = []
    grouped[level].push(id)
  }

  // 过滤空层(理论上不会有,但防御性处理)
  return grouped.filter((layer) => layer && layer.length > 0)
}

/**
 * 计算节点的依赖深度(0 = 源节点,无前驱)。
 *
 * 与 buildParallelLevels 的区别:
 * - buildParallelLevels 返回所有层级的分组
 * - getNodeDepth 只返回单个节点的深度
 *
 * @param graph 待查询的 RenderGraph
 * @param nodeId 节点 ID
 * @returns 深度(0-based),无前驱返回 0
 */
export function getNodeDepth(graph: RenderGraph, nodeId: string): number {
  const levels = buildParallelLevels(graph)
  for (let i = 0; i < levels.length; i++) {
    if (levels[i].includes(nodeId)) return i
  }
  return -1  // 节点不存在
}
