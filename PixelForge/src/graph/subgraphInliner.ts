/**
 * 子图内联器（借鉴 Gigi SubGraphs.cpp 的 InlineSubGraphs 算法）。
 *
 * 职责：
 * - 将 RenderGraph 中的 SUBGRAPH 节点递归展开为普通节点
 * - 重命名内部节点 ID（避免多实例冲突）
 * - 重定向外部边到内部节点端口
 * - 替换子图参数（paramOverrides → 内部节点 params）
 * - 检测循环引用和嵌套深度
 *
 * 与 Gigi 的对应关系：
 * - inlineSubGraphs()  → InlineSubGraphs()（主入口，循环展开直到无 SUBGRAPH 节点）
 * - inlineSingleSubGraph() → InlineSubGraph()（展开单个子图节点）
 * - instancePrefix + nodeId → Gigi 的 rename 系统（确保 ID 唯一）
 * - paramOverrides → Gigi 的变量替换系统
 *
 * 编译流程集成：
 * compileGraph() → inlineSubGraphs(graph) → validateGraph() → topologicalSort() → ...
 */

import type {
  GraphEdge,
  GraphNode,
  RenderGraph,
  SubGraphDefinition,
  SubGraphNode,
} from './types'

/**
 * 最大子图嵌套深度（防止无限递归）。
 *
 * Gigi 没有显式限制，但实际使用中很少超过 3 层。
 * 我们限制为 5 层，留有余量。
 */
const MAX_SUBGRAPH_DEPTH = 5

/**
 * 子图内联错误。
 */
export class SubGraphInlineError extends Error {
  constructor(
    message: string,
    public readonly subgraphId?: string,
    public readonly nodeId?: string,
  ) {
    super(message)
    this.name = 'SubGraphInlineError'
  }
}

/**
 * 主入口：递归内联 RenderGraph 中的所有 SUBGRAPH 节点。
 *
 * 算法（与 Gigi InlineSubGraphs 一致）：
 * 1. 深拷贝图（避免修改原图）
 * 2. 循环扫描所有节点，找到 SUBGRAPH 节点
 * 3. 展开单个子图（替换节点 + 重定向边）
 * 4. 重复直到无 SUBGRAPH 节点
 * 5. 清理 subgraphLibrary（编译后不再需要）
 *
 * @param graph  待处理的 RenderGraph
 * @returns 内联后的新 RenderGraph（所有 SUBGRAPH 节点已展开为普通节点）
 * @throws SubGraphInlineError 如果子图定义未找到或检测到循环引用
 */
export function inlineSubGraphs(graph: RenderGraph): RenderGraph {
  // 1. 深拷贝图
  const inlined = deepCloneGraph(graph)

  // 2. 如果没有子图节点，直接返回（不管有没有子图库）
  if (!hasSubGraphNodes(inlined)) {
    return inlined
  }

  // 3. 有子图节点但没有子图库，报错
  if (!inlined.subgraphLibrary || inlined.subgraphLibrary.length === 0) {
    const sgNode = inlined.nodes.find(
      (n): n is SubGraphNode => n.type === 'SUBGRAPH',
    )!
    throw new SubGraphInlineError(
      `子图定义未找到: ${sgNode.subgraphId}（子图库为空）`,
      sgNode.subgraphId,
      sgNode.id,
    )
  }

  // 4. 检测子图定义间的循环引用
  detectSubGraphCycles(inlined.subgraphLibrary)

  // 5. 循环展开直到无 SUBGRAPH 节点
  let depth = 0
  while (hasSubGraphNodes(inlined)) {
    depth++
    if (depth > MAX_SUBGRAPH_DEPTH) {
      throw new SubGraphInlineError(
        `子图嵌套深度超过上限(${MAX_SUBGRAPH_DEPTH})，可能存在无限递归`,
      )
    }

    // 找到第一个 SUBGRAPH 节点并展开
    const subNode = inlined.nodes.find(
      (n): n is SubGraphNode => n.type === 'SUBGRAPH',
    )
    if (!subNode) break

    const def = inlined.subgraphLibrary.find(
      (sg) => sg.id === subNode.subgraphId,
    )
    if (!def) {
      throw new SubGraphInlineError(
        `子图定义未找到: ${subNode.subgraphId}`,
        subNode.subgraphId,
        subNode.id,
      )
    }

    inlineSingleSubGraph(inlined, subNode, def)
  }

  // 6. 清理子图库（编译后不再需要）
  inlined.subgraphLibrary = []

  return inlined
}

/**
 * 检测子图定义间的循环引用。
 *
 * 例如：子图 A 引用子图 B，子图 B 又引用子图 A → 循环。
 * 使用 DFS 三色标记法（与 validator.ts 的 detectCycle 一致）。
 *
 * @param library 子图定义库
 * @throws SubGraphInlineError 如果检测到循环
 */
function detectSubGraphCycles(library: SubGraphDefinition[]): void {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2

  const color = new Map<string, number>()
  for (const def of library) {
    color.set(def.id, WHITE)
  }

  // 构建邻接表：子图 A → [子图 B, 子图 C]（A 的内部节点引用了 B 和 C）
  const adjacency = new Map<string, string[]>()
  for (const def of library) {
    adjacency.set(def.id, [])
    for (const node of def.nodes) {
      if (node.type === 'SUBGRAPH') {
        const sgNode = node as SubGraphNode
        adjacency.get(def.id)!.push(sgNode.subgraphId)
      }
    }
  }

  function dfs(id: string, path: string[]): void {
    color.set(id, GRAY)
    path.push(id)

    const neighbors = adjacency.get(id) ?? []
    for (const next of neighbors) {
      const nextColor = color.get(next)
      if (nextColor === GRAY) {
        // 找到环
        const cycleStart = path.indexOf(next)
        const cyclePath = path.slice(cycleStart).concat(next)
        throw new SubGraphInlineError(
          `子图循环引用: ${cyclePath.join(' → ')}`,
        )
      }
      if (nextColor === WHITE) {
        dfs(next, path)
      }
    }

    path.pop()
    color.set(id, BLACK)
  }

  for (const def of library) {
    if (color.get(def.id) === WHITE) {
      dfs(def.id, [])
    }
  }
}

/**
 * 展开单个子图节点（对应 Gigi 的 InlineSubGraph）。
 *
 * 步骤：
 * 1. 为内部节点生成唯一 ID（instancePrefix_nodeId）
 * 2. 克隆内部节点并重命名 ID
 * 3. 克隆内部边并重命名端点
 * 4. 重定向外部入边（→ 子图输入端口 → 内部节点）
 * 5. 重定向外部出边（内部节点 → 子图输出端口 → 外部）
 * 6. 替换参数（paramOverrides → 内部节点 params）
 * 7. 移除子图节点，添加内部节点和边
 */
function inlineSingleSubGraph(
  graph: RenderGraph,
  subgraphNode: SubGraphNode,
  def: SubGraphDefinition,
): void {
  const prefix = subgraphNode.instanceId

  // 1. 构建 ID 映射（旧 ID → 新 ID）
  const idMap = new Map<string, string>()
  for (const node of def.nodes) {
    idMap.set(node.id, `${prefix}_${node.id}`)
  }

  // 2. 克隆内部节点
  const clonedNodes: GraphNode[] = def.nodes.map((node) => ({
    ...deepCloneNode(node),
    id: idMap.get(node.id)!,
    position: {
      x: subgraphNode.position.x + node.position.x,
      y: subgraphNode.position.y + node.position.y,
    },
  }))

  // 3. 克隆内部边
  const clonedEdges: GraphEdge[] = def.edges.map((edge) => ({
    ...edge,
    id: `${idMap.get(edge.from)!}:${edge.fromPort}->${idMap.get(edge.to)!}:${edge.toPort}`,
    from: idMap.get(edge.from)!,
    to: idMap.get(edge.to)!,
  }))

  // 4. 重定向外部入边
  // 子图输入端口 → 绑定的内部节点端口
  for (const inputPort of def.inputPorts) {
    const boundNodeId = idMap.get(inputPort.boundTo.nodeId)
    if (!boundNodeId) {
      throw new SubGraphInlineError(
        `子图输入端口 ${inputPort.id} 绑定的节点 ${inputPort.boundTo.nodeId} 不存在`,
        def.id,
        subgraphNode.id,
      )
    }

    // 找到连接到子图输入端口的外部边
    const incomingEdges = graph.edges.filter(
      (e) => e.to === subgraphNode.id && e.toPort === inputPort.id,
    )

    // 重定向到内部节点
    for (const edge of incomingEdges) {
      edge.to = boundNodeId
      edge.toPort = inputPort.boundTo.portId
    }
  }

  // 5. 重定向外部出边
  // 内部节点端口 → 子图输出端口 → 外部
  for (const outputPort of def.outputPorts) {
    const boundNodeId = idMap.get(outputPort.boundTo.nodeId)
    if (!boundNodeId) {
      throw new SubGraphInlineError(
        `子图输出端口 ${outputPort.id} 绑定的节点 ${outputPort.boundTo.nodeId} 不存在`,
        def.id,
        subgraphNode.id,
      )
    }

    // 找到从子图输出端口发出的外部边
    const outgoingEdges = graph.edges.filter(
      (e) => e.from === subgraphNode.id && e.fromPort === outputPort.id,
    )

    // 重定向到内部节点
    for (const edge of outgoingEdges) {
      edge.from = boundNodeId
      edge.fromPort = outputPort.boundTo.portId
    }
  }

  // 6. 参数替换
  // 遍历子图定义的参数，如果实例有覆盖则替换内部节点的 params
  for (const param of def.params) {
    const overrideValue = subgraphNode.paramOverrides[param.key]
    if (overrideValue !== undefined) {
      replaceParamInNodes(clonedNodes, param.key, overrideValue)
    }
  }

  // 7. 替换子图节点
  const nodeIndex = graph.nodes.findIndex((n) => n.id === subgraphNode.id)
  if (nodeIndex === -1) {
    throw new SubGraphInlineError(
      `子图节点 ${subgraphNode.id} 在图中不存在`,
      def.id,
      subgraphNode.id,
    )
  }

  // 移除子图节点，插入内部节点
  graph.nodes.splice(nodeIndex, 1, ...clonedNodes)

  // 添加内部边
  graph.edges.push(...clonedEdges)
}

/**
 * 在节点列表中替换参数值。
 *
 * 支持两种替换模式：
 * 1. 精确匹配：节点 params 中某个 key 等于 paramKey → 替换为 newValue
 * 2. 模板替换：节点 params 中某个字符串值包含 ${paramKey} → 替换占位符
 *
 * @param nodes      节点列表（会被原地修改）
 * @param paramKey   参数 key
 * @param newValue   新值
 */
function replaceParamInNodes(
  nodes: GraphNode[],
  paramKey: string,
  newValue: import('@/shared/types').JsonLiteral,
): void {
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node.params)) {
      // 精确匹配：key 与 paramKey 相同
      if (key === paramKey) {
        node.params[key] = newValue
        continue
      }

      // 模板替换：字符串值中包含 ${paramKey}
      if (typeof value === 'string' && value.includes(`\${${paramKey}}`)) {
        node.params[key] = value.replace(
          new RegExp(`\\$\\{${paramKey}\\}`, 'g'),
          String(newValue),
        )
      }
    }
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 判断图中是否还有 SUBGRAPH 节点。
 */
function hasSubGraphNodes(graph: RenderGraph): boolean {
  return graph.nodes.some((n) => n.type === 'SUBGRAPH')
}

/**
 * 深拷贝 RenderGraph。
 */
function deepCloneGraph(graph: RenderGraph): RenderGraph {
  return {
    nodes: graph.nodes.map(deepCloneNode),
    edges: graph.edges.map((e) => ({ ...e })),
    canvas: graph.canvas ? { ...graph.canvas } : undefined,
    subgraphLibrary: graph.subgraphLibrary
      ? graph.subgraphLibrary.map(deepCloneSubGraphDef)
      : undefined,
  }
}

/**
 * 深拷贝 GraphNode。
 */
function deepCloneNode(node: GraphNode): GraphNode {
  return {
    ...node,
    inputs: node.inputs.map((p) => ({ ...p })),
    outputs: node.outputs.map((p) => ({ ...p })),
    params: { ...node.params },
  }
}

/**
 * 深拷贝 SubGraphDefinition。
 */
function deepCloneSubGraphDef(def: SubGraphDefinition): SubGraphDefinition {
  return {
    ...def,
    inputPorts: def.inputPorts.map((p) => ({ ...p, boundTo: { ...p.boundTo } })),
    outputPorts: def.outputPorts.map((p) => ({ ...p, boundTo: { ...p.boundTo } })),
    nodes: def.nodes.map(deepCloneNode),
    edges: def.edges.map((e) => ({ ...e })),
    params: def.params.map((p) => ({ ...p })),
  }
}

// ============================================================================
// 子图工具函数（供 graphStore / UI 使用）
// ============================================================================

/**
 * 创建空的子图定义。
 *
 * @param id   子图 ID
 * @param name 子图名称
 * @returns 空的 SubGraphDefinition
 */
export function createEmptySubGraphDefinition(
  id: string,
  name: string,
): SubGraphDefinition {
  const now = Date.now()
  return {
    id,
    name,
    description: '',
    version: '1.0.0',
    inputPorts: [],
    outputPorts: [],
    nodes: [],
    edges: [],
    params: [],
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 从当前图的选中节点创建子图定义。
 *
 * 将选中的节点和它们之间的边提取为子图，自动生成输入/输出端口。
 *
 * @param graph        当前图
 * @param selectedIds  选中的节点 ID 集合
 * @param subgraphId   子图 ID
 * @param subgraphName 子图名称
 * @returns 新的 SubGraphDefinition
 */
export function createSubGraphFromSelection(
  graph: RenderGraph,
  selectedIds: Set<string>,
  subgraphId: string,
  subgraphName: string,
): SubGraphDefinition {
  const selectedNodes = graph.nodes.filter((n) => selectedIds.has(n.id))
  const selectedEdges = graph.edges.filter(
    (e) => selectedIds.has(e.from) && selectedIds.has(e.to),
  )

  // 自动检测输入端口：选中节点的入边中，来源不在选中集合内的
  const inputPorts: import('./types').SubGraphPort[] = []
  const externalInEdges = graph.edges.filter(
    (e) => selectedIds.has(e.to) && !selectedIds.has(e.from),
  )
  for (const edge of externalInEdges) {
    const targetNode = graph.nodes.find((n) => n.id === edge.to)
    const targetPort = targetNode?.inputs.find((p) => p.id === edge.toPort)
    if (targetNode && targetPort) {
      inputPorts.push({
        id: `input_${inputPorts.length}`,
        name: targetPort.name,
        type: targetPort.type,
        boundTo: { nodeId: targetNode.id, portId: targetPort.id },
      })
    }
  }

  // 自动检测输出端口：选中节点的出边中，目标不在选中集合内的
  const outputPorts: import('./types').SubGraphPort[] = []
  const externalOutEdges = graph.edges.filter(
    (e) => selectedIds.has(e.from) && !selectedIds.has(e.to),
  )
  for (const edge of externalOutEdges) {
    const sourceNode = graph.nodes.find((n) => n.id === edge.from)
    const sourcePort = sourceNode?.outputs.find((p) => p.id === edge.fromPort)
    if (sourceNode && sourcePort) {
      outputPorts.push({
        id: `output_${outputPorts.length}`,
        name: sourcePort.name,
        type: sourcePort.type,
        boundTo: { nodeId: sourceNode.id, portId: sourcePort.id },
      })
    }
  }

  return {
    id: subgraphId,
    name: subgraphName,
    description: `从 ${selectedNodes.length} 个节点创建的子图`,
    version: '1.0.0',
    inputPorts,
    outputPorts,
    nodes: selectedNodes,
    edges: selectedEdges,
    params: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * 生成子图实例 ID（用于区分同一子图的不同实例）。
 */
let instanceCounter = 0
export function generateSubGraphInstanceId(): string {
  instanceCounter++
  return `sg_${Date.now().toString(36)}_${instanceCounter.toString(36)}`
}
