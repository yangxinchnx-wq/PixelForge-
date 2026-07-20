/**
 * Graph Store(Step 25.4)。
 *
 * 使用 Pinia Setup Store(与 timeline.ts / history.ts / runtime.ts 一致)。
 *
 * 职责:
 * - 管理 RenderGraph 状态(nodes / edges / canvas)
 * - 提供 CRUD actions:addNode / removeNode / updateNodePosition / connect / disconnect
 * - 提供 selection 状态(当前选中的节点 / edge)
 * - 提供 validation 缓存(computed)
 * - 与 GraphCompiler 协作:compile() 返回 RenderIR
 *
 * 设计原则:
 * - state 全部用 ref(便于响应式追踪)
 * - getters 用 computed(自动缓存)
 * - actions 用普通 function(可读性)
 * - 不直接调用 runtimeStore(保持单一职责,由 App.vue 编排)
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { JsonLiteral } from '@/shared/types'
import type {
  GraphEdge,
  GraphNode,
  NodePosition,
  RenderGraph,
  ValidationResult,
} from './types'
import { DEFAULT_GRAPH_CANVAS } from './types'
import {
  getNodeDefinition,
  type NodeRegistryKey,
} from './nodeRegistry'
import { canAddEdge, validateGraph } from './validator'

/**
 * 生成稳定 edge ID(与 types.ts 中的约定一致)。
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
 * 生成节点唯一 ID(基于时间戳 + 自增序号)。
 *
 * 与 stableLayerId 的区别:
 * - stableLayerId 是内容寻址(相同输入相同 ID,用于 patch / cache 命中)
 * - graphNodeId 是实例寻址(每次添加都是新实例,即使内容相同)
 *
 * 用户拖入两个 Noise 节点应该得到两个不同 ID。
 */
let nodeIdCounter = 0
function generateNodeId(prefix: string = 'node'): string {
  nodeIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${nodeIdCounter.toString(36)}`
}

/**
 * 默认节点位置(每次添加自动右下偏移,避免完全重叠)。
 */
let defaultPositionCounter = 0
function nextDefaultPosition(): NodePosition {
  defaultPositionCounter++
  const col = defaultPositionCounter % 4
  const row = Math.floor(defaultPositionCounter / 4)
  return {
    x: 80 + col * 220,
    y: 80 + row * 180,
  }
}

/**
 * Graph Store 主接口。
 */
export const useGraphStore = defineStore('graph', () => {
  // —— State ——
  const nodes = ref<GraphNode[]>([])
  const edges = ref<GraphEdge[]>([])
  const canvas = ref<{ width: number; height: number }>({ ...DEFAULT_GRAPH_CANVAS })

  // 当前选中(单选,UI 用)
  const selectedNodeId = ref<string | null>(null)
  const selectedEdgeId = ref<string | null>(null)

  // 校验结果缓存(自动重算)
  const validation = computed<ValidationResult>(() =>
    validateGraph({
      nodes: nodes.value,
      edges: edges.value,
      canvas: canvas.value,
    }),
  )

  // —— Getters ——
  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)
  const isValid = computed(() => validation.value.valid)
  const selectedNode = computed<GraphNode | null>(() => {
    if (!selectedNodeId.value) return null
    return nodes.value.find((n) => n.id === selectedNodeId.value) ?? null
  })

  /**
   * 根据 ID 取节点(响应式)。
   */
  function getNode(id: string): GraphNode | undefined {
    return nodes.value.find((n) => n.id === id)
  }

  /**
   * 取节点的所有入边(指向该节点的 edge)。
   */
  function getIncomingEdges(nodeId: string): GraphEdge[] {
    return edges.value.filter((e) => e.to === nodeId)
  }

  /**
   * 取节点的所有出边(从该节点出发的 edge)。
   */
  function getOutgoingEdges(nodeId: string): GraphEdge[] {
    return edges.value.filter((e) => e.from === nodeId)
  }

  // —— Actions: 节点 CRUD ——

  /**
   * 添加节点(从注册表实例化)。
   *
   * @param key      注册表 key(如 'Noise' / 'Vignette' / 'Output')
   * @param position 可选位置(不传则用 nextDefaultPosition)
   * @param name     可读名(不传则用注册表 label)
   * @returns 新节点 ID
   */
  function addNode(
    key: NodeRegistryKey,
    position?: NodePosition,
    name?: string,
  ): string {
    const def = getNodeDefinition(key)
    const id = generateNodeId(key.toLowerCase())
    const node: GraphNode = {
      id,
      type: def.type,
      name: name ?? def.label,
      position: position ?? nextDefaultPosition(),
      inputs: def.inputs.map((p) => ({ ...p })),
      outputs: def.outputs.map((p) => ({ ...p })),
      params: { ...def.defaultParams },
      opcodeName: def.opcodeName,
      templateKey: def.key,
    }
    nodes.value = [...nodes.value, node]
    return id
  }

  /**
   * 添加自定义节点(不从注册表实例化,用于 GraphGenerator)。
   */
  function addNodeDirect(node: Omit<GraphNode, 'id'> & { id?: string }): string {
    const id = node.id ?? generateNodeId(node.type.toLowerCase())
    const fullNode: GraphNode = { ...node, id }
    nodes.value = [...nodes.value, fullNode]
    return id
  }

  /**
   * 移除节点(同时移除相关 edge)。
   */
  function removeNode(id: string): void {
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.from !== id && e.to !== id)
    if (selectedNodeId.value === id) {
      selectedNodeId.value = null
    }
  }

  /**
   * 更新节点位置(UI 拖动时调用)。
   */
  function updateNodePosition(id: string, position: NodePosition): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) {
      node.position = position
    }
  }

  /**
   * 更新节点参数(Inspector 编辑时调用)。
   */
  function updateNodeParams(
    id: string,
    params: Record<string, JsonLiteral>,
  ): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) {
      node.params = { ...params }
    }
  }

  /**
   * 重命名节点。
   */
  function renameNode(id: string, name: string): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) {
      node.name = name
    }
  }

  // —— Actions: Edge CRUD ——

  /**
   * 连接两个节点(自动校验,失败返回原因)。
   *
   * @returns 成功返回 edge id,失败返回 { error }
   */
  function connect(
    from: string,
    fromPort: string,
    to: string,
    toPort: string,
  ): { ok: boolean; edgeId?: string; error?: string } {
    const tempGraph: RenderGraph = {
      nodes: nodes.value,
      edges: edges.value,
      canvas: canvas.value,
    }
    const check = canAddEdge(tempGraph, { from, fromPort, to, toPort })
    if (!check.ok) {
      return { ok: false, error: check.reason }
    }

    const id = makeEdgeId(from, fromPort, to, toPort)
    const edge: GraphEdge = { id, from, fromPort, to, toPort }
    edges.value = [...edges.value, edge]
    return { ok: true, edgeId: id }
  }

  /**
   * 断开连接(按 edge id)。
   */
  function disconnect(edgeId: string): void {
    edges.value = edges.value.filter((e) => e.id !== edgeId)
    if (selectedEdgeId.value === edgeId) {
      selectedEdgeId.value = null
    }
  }

  /**
   * 断开连接(按 from/to 节点)。
   */
  function disconnectBetween(from: string, to: string): void {
    edges.value = edges.value.filter((e) => !(e.from === from && e.to === to))
  }

  // —— Actions: Selection ——

  function selectNode(id: string | null): void {
    selectedNodeId.value = id
    selectedEdgeId.value = null
  }

  function selectEdge(id: string | null): void {
    selectedEdgeId.value = id
    selectedNodeId.value = null
  }

  function clearSelection(): void {
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  // —— Actions: 整图操作 ——

  /**
   * 加载完整 RenderGraph(替换当前状态)。
   * 用于 GraphGenerator 生成后灌入 store。
   */
  function loadGraph(graph: RenderGraph): void {
    nodes.value = graph.nodes.map((n) => ({ ...n, inputs: [...n.inputs], outputs: [...n.outputs] }))
    edges.value = [...graph.edges]
    if (graph.canvas) {
      canvas.value = { ...graph.canvas }
    }
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  /**
   * 清空 Graph(回到空状态)。
   */
  function clearGraph(): void {
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  /**
   * 导出当前 RenderGraph(深拷贝,避免外部修改影响 store)。
   */
  function exportGraph(): RenderGraph {
    return {
      nodes: nodes.value.map((n) => ({
        ...n,
        inputs: [...n.inputs],
        outputs: [...n.outputs],
        params: { ...n.params },
      })),
      edges: edges.value.map((e) => ({ ...e })),
      canvas: { ...canvas.value },
    }
  }

  return {
    // state
    nodes,
    edges,
    canvas,
    selectedNodeId,
    selectedEdgeId,
    // getters
    validation,
    nodeCount,
    edgeCount,
    isValid,
    selectedNode,
    // node queries
    getNode,
    getIncomingEdges,
    getOutgoingEdges,
    // node actions
    addNode,
    addNodeDirect,
    removeNode,
    updateNodePosition,
    updateNodeParams,
    renameNode,
    // edge actions
    connect,
    disconnect,
    disconnectBetween,
    // selection
    selectNode,
    selectEdge,
    clearSelection,
    // graph actions
    loadGraph,
    clearGraph,
    exportGraph,
  }
})
