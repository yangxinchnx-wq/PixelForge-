/**
 * Graph 校验器(Step 25.4)。
 *
 * 职责:在编译前检查 RenderGraph 是否满足不变量。
 *
 * 校验项:
 * 1. OUTPUT 节点:必须有且仅有 1 个
 * 2. 节点 ID 唯一性
 * 3. Edge 引用完整性:from/to 必须指向存在的节点
 * 4. Edge 端口存在性:fromPort/toPort 必须存在于对应节点
 * 5. Edge 端口类型匹配:texture → texture,value → value
 * 6. 端口方向正确:fromPort 必须是输出端口,toPort 必须是输入端口
 * 7. 无环(DAG):DFS 三色标记法检测环
 * 8. 无悬空节点(警告):未被任何 edge 引用的节点
 * 9. EFFECT 节点必须有 1 个输入(警告:否则 effect 无作用对象)
 *
 * 返回 ValidationResult:
 * - errors:   阻塞性错误(必须修复才能编译)
 * - warnings: 非阻塞性警告(可忽略)
 * - valid:    errors.length === 0
 */

import type {
  GraphEdge,
  GraphNode,
  RenderGraph,
  ValidationResult,
} from './types'

/**
 * 校验 Graph 是否满足不变量。
 *
 * @param graph 待校验的 RenderGraph
 * @returns ValidationResult(valid / errors / warnings)
 */
export function validateGraph(graph: RenderGraph): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // —— 1. 节点 ID 唯一性 ——
  const nodeIds = new Set<string>()
  const duplicatedIds = new Set<string>()
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      duplicatedIds.add(node.id)
    } else {
      nodeIds.add(node.id)
    }
  }
  for (const id of duplicatedIds) {
    errors.push(`节点 ID 重复: ${id}`)
  }

  // —— 2. OUTPUT 节点数量校验 ——
  const outputNodes = graph.nodes.filter((n) => n.type === 'OUTPUT')
  if (outputNodes.length === 0) {
    errors.push('缺少 OUTPUT 节点(每个 Graph 必须有且仅有 1 个)')
  } else if (outputNodes.length > 1) {
    errors.push(
      `OUTPUT 节点数量过多: ${outputNodes.length}(每个 Graph 只能有 1 个)`,
    )
  }

  // —— 3. Edge 引用完整性 ——
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge ${edge.id} 的 from 节点不存在: ${edge.from}`)
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge ${edge.id} 的 to 节点不存在: ${edge.to}`)
    }
  }

  // —— 4-6. Edge 端口校验(仅在节点存在时检查) ——
  const nodeMap = new Map<string, GraphNode>()
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node)
  }

  for (const edge of graph.edges) {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)
    if (!fromNode || !toNode) continue  // 已在 step 3 报错

    // 4. 端口存在性
    const fromPort = fromNode.outputs.find((p) => p.id === edge.fromPort)
    if (!fromPort) {
      errors.push(
        `Edge ${edge.id} 的 fromPort ${edge.fromPort} 不存在于节点 ${edge.from}`,
      )
    }
    const toPort = toNode.inputs.find((p) => p.id === edge.toPort)
    if (!toPort) {
      errors.push(
        `Edge ${edge.id} 的 toPort ${edge.toPort} 不存在于节点 ${edge.to}`,
      )
    }

    // 5. 端口类型匹配
    if (fromPort && toPort && fromPort.type !== toPort.type) {
      errors.push(
        `Edge ${edge.id} 端口类型不匹配: ${fromPort.type} → ${toPort.type}`,
      )
    }

    // 6. 端口方向(隐含在 4 中:fromPort 在 outputs 里找,toPort 在 inputs 里找)
  }

  // —— 7. 无环检测(三色标记法) ——
  // 仅在 edge 引用完整时检测(否则会误报)
  if (errors.length === 0) {
    const cycle = detectCycle(graph)
    if (cycle) {
      errors.push(`检测到环: ${cycle.join(' → ')}`)
    }
  }

  // —— 8. 悬空节点警告 ——
  const referencedIds = new Set<string>()
  for (const edge of graph.edges) {
    referencedIds.add(edge.from)
    referencedIds.add(edge.to)
  }
  for (const node of graph.nodes) {
    if (!referencedIds.has(node.id) && node.type !== 'OUTPUT') {
      warnings.push(`节点 ${node.name}(${node.id}) 未连接到任何 edge`)
    }
  }

  // —— 9. EFFECT 节点必须有 1 个输入 ——
  for (const node of graph.nodes) {
    if (node.type === 'EFFECT') {
      const hasInput = graph.edges.some((e) => e.to === node.id)
      if (!hasInput) {
        warnings.push(`EFFECT 节点 ${node.name}(${node.id}) 没有输入,effect 不会生效`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 三色标记法检测环。
 *
 * - WHITE(0):未访问
 * - GRAY(1):  正在访问(在当前 DFS 路径上)
 * - BLACK(2): 已完成访问
 *
 * 若 DFS 过程中遇到 GRAY 节点,说明存在环。
 *
 * @returns 环上的节点 ID 列表,或 null(无环)
 */
export function detectCycle(graph: RenderGraph): string[] | null {
  const color = new Map<string, number>()  // 0=white, 1=gray, 2=black
  const parent = new Map<string, string | null>()

  for (const node of graph.nodes) {
    color.set(node.id, 0)
    parent.set(node.id, null)
  }

  // 邻接表:from → [to]
  const adjacency = new Map<string, string[]>()
  for (const node of graph.nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from)
    if (list) list.push(edge.to)
  }

  let cycleStart: string | null = null
  let cycleEnd: string | null = null

  function dfs(nodeId: string): boolean {
    color.set(nodeId, 1)  // GRAY

    const neighbors = adjacency.get(nodeId) ?? []
    for (const next of neighbors) {
      const nextColor = color.get(next) ?? 0
      if (nextColor === 1) {
        // 找到环
        cycleStart = next
        cycleEnd = nodeId
        return true
      }
      if (nextColor === 0) {
        parent.set(next, nodeId)
        if (dfs(next)) return true
      }
    }

    color.set(nodeId, 2)  // BLACK
    return false
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === 0) {
      if (dfs(node.id)) break
    }
  }

  if (cycleStart === null || cycleEnd === null) {
    return null
  }

  // 重建环路径:cycleEnd → ... → cycleStart
  const path: string[] = [cycleStart!]
  let current: string | null = cycleEnd
  while (current !== null && current !== cycleStart) {
    path.push(current)
    current = parent.get(current) ?? null
  }
  path.push(cycleStart!)
  path.reverse()

  return path
}

/**
 * 快速判断 Graph 是否可编译(valid && 无环)。
 */
export function isCompilable(graph: RenderGraph): boolean {
  return validateGraph(graph).valid
}

/**
 * 校验单条 edge 是否可以添加(不破坏 DAG 不变量)。
 *
 * 用于 UI 连线操作前的预检(避免用户连出环后才发现)。
 *
 * @param graph    当前 Graph
 * @param edge     待添加的 edge
 * @returns 是否可以添加
 */
export function canAddEdge(
  graph: RenderGraph,
  edge: Omit<GraphEdge, 'id'>,
): { ok: boolean; reason?: string } {
  // 1. 不能自连
  if (edge.from === edge.to) {
    return { ok: false, reason: '不能连接到自身' }
  }

  // 2. 端口方向校验
  const fromNode = graph.nodes.find((n) => n.id === edge.from)
  const toNode = graph.nodes.find((n) => n.id === edge.to)
  if (!fromNode || !toNode) {
    return { ok: false, reason: '节点不存在' }
  }

  const fromPort = fromNode.outputs.find((p) => p.id === edge.fromPort)
  const toPort = toNode.inputs.find((p) => p.id === edge.toPort)
  if (!fromPort || !toPort) {
    return { ok: false, reason: '端口不存在' }
  }

  // 3. 端口类型匹配
  if (fromPort.type !== toPort.type) {
    return { ok: false, reason: `端口类型不匹配: ${fromPort.type} → ${toPort.type}` }
  }

  // 4. 同一输入端口不能有多条 edge(避免歧义)
  const existingToPort = graph.edges.find(
    (e) => e.to === edge.to && e.toPort === edge.toPort,
  )
  if (existingToPort) {
    return { ok: false, reason: '输入端口已有连接' }
  }

  // 5. 添加后不能形成环(临时添加 + 检测)
  const tempEdge: GraphEdge = {
    id: '__temp__',
    ...edge,
  }
  const tempGraph: RenderGraph = {
    nodes: graph.nodes,
    edges: [...graph.edges, tempEdge],
  }
  if (detectCycle(tempGraph)) {
    return { ok: false, reason: '会形成环' }
  }

  return { ok: true }
}
