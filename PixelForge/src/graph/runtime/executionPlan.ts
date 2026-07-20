/**
 * Execution Plan(Step 26.3)— 把 RenderGraph 转换为 GPU 执行列表。
 *
 * 职责:
 * - 把 DAG 节点按拓扑序展开为线性执行步骤
 * - 每个步骤记录节点引用 + 依赖列表(前驱节点 ID)
 * - 同时计算并行层级(levels):同层节点无依赖关系,可并行调度
 *
 * 与 scheduler.ts 的关系:
 * - scheduler 提供 buildSchedule(拓扑序) + buildParallelLevels(并行层级)
 * - executionPlan 把两者组装成 ExecutionPlan 结构,供 GraphRuntime 使用
 *
 * 与 graphCompiler.ts 的区别:
 * - graphCompiler: Graph → RenderIR(把节点编译为 Layer/Effect,交给现有 pipeline)
 * - executionPlan: Graph → ExecutionPlan(保留节点结构,直接驱动 GraphRuntime)
 * 两者是并行的执行路径,GraphRuntime 走 executionPlan 路径(更细粒度,可缓存)。
 */

import type { GraphNode, RenderGraph } from '../types'
import { buildParallelLevels, buildSchedule } from './scheduler'

/**
 * 单个执行步骤(对应一个节点的求值)。
 *
 * - id:            节点 ID
 * - node:          节点引用(避免 GraphRuntime 再查一次)
 * - dependencies:  前驱节点 ID 列表(必须先于本节点求值)
 */
export interface ExecutionNode {
  id: string
  node: GraphNode
  dependencies: string[]
}

/**
 * 完整执行计划。
 *
 * - steps:  线性执行步骤(拓扑序,dependencies-first)
 * - levels: 并行层级(每层数组内节点可并行执行)
 *
 * 示例:
 *   Graph:  A → B → D
 *           A → C → D
 *   steps:  [A, B, C, D]
 *   levels: [[A], [B, C], [D]]
 */
export interface ExecutionPlan {
  steps: ExecutionNode[]
  levels: string[][]
}

/**
 * 构建 ExecutionPlan。
 *
 * @param graph 已通过 validateGraph 校验的 RenderGraph
 * @returns ExecutionPlan(steps + levels)
 *
 * @example
 * const plan = buildExecutionPlan(graph)
 * for (const step of plan.steps) {
 *   const evaluator = getEvaluator(step.node)
 *   await evaluator.execute(step.node, ctx)
 * }
 */
export function buildExecutionPlan(graph: RenderGraph): ExecutionPlan {
  const order = buildSchedule(graph)
  const levels = buildParallelLevels(graph)

  // 反向邻接表:to → [from](即每个节点的依赖列表)
  const reverseAdjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    reverseAdjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    const list = reverseAdjacency.get(edge.to)
    if (list) list.push(edge.from)
  }

  // 节点查找表(避免 steps 里每次 find)
  const nodeMap = new Map<string, GraphNode>()
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node)
  }

  const steps: ExecutionNode[] = order.map((id) => {
    const node = nodeMap.get(id)
    if (!node) {
      throw new Error(`buildExecutionPlan: 拓扑序中存在未知节点 ID: ${id}`)
    }
    return {
      id,
      node,
      dependencies: [...(reverseAdjacency.get(id) ?? [])],
    }
  })

  return { steps, levels }
}

/**
 * 计算执行计划的可读摘要(用于 UI 反馈 / 调试日志)。
 */
export function summarizeExecutionPlan(plan: ExecutionPlan): string {
  const { steps, levels } = plan
  const maxParallel = levels.reduce((m, l) => Math.max(m, l.length), 0)
  return `${steps.length} 步 / ${levels.length} 层 / 最大并行度 ${maxParallel}`
}
