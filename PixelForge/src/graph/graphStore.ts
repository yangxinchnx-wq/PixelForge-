/**
 * Graph Store(Step 25.4)。
 *
 * 使用 Pinia Setup Store + useNodeGraph composable 消除与 materialGraph 的 DRY 违反。
 *
 * 职责:
 * - 管理 RenderGraph 状态(nodes / edges / canvas / subgraphLibrary)
 * - 提供 domain-specific actions: addNode / addNodeDirect / connect / 子图管理
 * - 共享 CRUD / selection / graph 操作委托给 useNodeGraph
 * - 与 GraphCompiler 协作: compile() 返回 RenderIR
 */

import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import type { JsonLiteral } from '@/shared/types'
import type {
  GraphEdge,
  GraphNode,
  NodePosition,
  RenderGraph,
  SubGraphDefinition,
  SubGraphNode,
  ValidationResult,
} from './types'
import { DEFAULT_GRAPH_CANVAS } from './types'
import {
  getNodeDefinition,
  getSubGraphPorts,
  type NodeRegistryKey,
} from './nodeRegistry'
import { canAddEdge, validateGraph } from './validator'
import {
  generateSubGraphInstanceId,
  createSubGraphFromSelection,
} from './subgraphInliner'
import {
  useNodeGraph,
  makeEdgeId,
  generateNodeId,
  nextDefaultPosition,
} from '@/composables/useNodeGraph'

/**
 * Graph Store 主接口。
 */
export const useGraphStore = defineStore('graph', () => {
  // ─── 共享节点图基础（CRUD / selection / load / clear / export）───
  // 子图定义库（graphStore 独有）。使用 shallowRef，避免 Pinia 深度展开图节点参数。
  const subgraphLibrary = shallowRef<SubGraphDefinition[]>([])

  const graph = useNodeGraph<GraphNode, GraphEdge, ValidationResult, { width: number; height: number }>({
    defaultCanvas: { ...DEFAULT_GRAPH_CANVAS },
    validate: (nodes, edges, canvas) =>
      validateGraph({ nodes, edges, canvas, subgraphLibrary: subgraphLibrary.value }),
  })

  // ─── domain-specific getters ────────────────────────
  const isValid = computed(() => graph.validation.value.valid)

  // ─── domain-specific node actions ───────────────────

  /**
   * 添加节点(从注册表实例化)。
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
    graph.addNode(node)
    return id
  }

  /**
   * 添加自定义节点(不从注册表实例化,用于 GraphGenerator)。
   */
  function addNodeDirect(node: Omit<GraphNode, 'id'> & { id?: string }): string {
    const id = node.id ?? generateNodeId(node.type.toLowerCase())
    const fullNode: GraphNode = { ...node, id }
    graph.addNode(fullNode)
    return id
  }

  /**
   * 连接两个节点(自动校验,失败返回原因)。
   */
  function connect(
    from: string,
    fromPort: string,
    to: string,
    toPort: string,
  ): { ok: boolean; edgeId?: string; error?: string } {
    const tempGraph: RenderGraph = {
      nodes: graph.nodes.value,
      edges: graph.edges.value,
      canvas: graph.canvas.value,
    }
    const check = canAddEdge(tempGraph, { from, fromPort, to, toPort })
    if (!check.ok) return { ok: false, error: check.reason }

    const id = makeEdgeId(from, fromPort, to, toPort)
    graph.addEdge({ id, from, fromPort, to, toPort })
    return { ok: true, edgeId: id }
  }

  // ─── 整图操作（扩展 subgraphLibrary）───────────────

  function loadGraph(renderGraph: RenderGraph): void {
    graph.loadGraph(renderGraph.nodes, renderGraph.edges, renderGraph.canvas)
    if (renderGraph.subgraphLibrary) {
      subgraphLibrary.value = [...renderGraph.subgraphLibrary]
    }
  }

  function clearGraph(): void {
    graph.clearGraph()
    subgraphLibrary.value = []
  }

  function exportGraph(): RenderGraph {
    const base = {
      nodes: graph.exportNodes(),
      edges: graph.exportEdges(),
      canvas: { ...graph.canvas.value },
    }
    return {
      ...base,
      subgraphLibrary: subgraphLibrary.value.length > 0
        ? subgraphLibrary.value.map((sg) => ({ ...sg }))
        : undefined,
    }
  }

  // ─── 子图管理 ──────────────────────────────────────

  function addSubGraphDefinition(def: SubGraphDefinition): void {
    const existing = subgraphLibrary.value.findIndex((sg) => sg.id === def.id)
    if (existing >= 0) {
      subgraphLibrary.value = [
        ...subgraphLibrary.value.slice(0, existing),
        def,
        ...subgraphLibrary.value.slice(existing + 1),
      ]
    } else {
      subgraphLibrary.value = [...subgraphLibrary.value, def]
    }
  }

  function removeSubGraphDefinition(subgraphId: string): void {
    subgraphLibrary.value = subgraphLibrary.value.filter((sg) => sg.id !== subgraphId)
    const nodesToRemove = graph.nodes.value
      .filter((n) => n.type === 'SUBGRAPH' && (n as SubGraphNode).subgraphId === subgraphId)
      .map((n) => n.id)
    for (const id of nodesToRemove) {
      graph.removeNode(id)
    }
  }

  function getSubGraphDefinition(subgraphId: string): SubGraphDefinition | undefined {
    return subgraphLibrary.value.find((sg) => sg.id === subgraphId)
  }

  function listSubGraphDefinitions(): SubGraphDefinition[] {
    return [...subgraphLibrary.value]
  }

  function addSubGraphNode(
    subgraphId: string,
    position?: NodePosition,
    name?: string,
  ): string {
    const def = getSubGraphDefinition(subgraphId)
    if (!def) throw new Error(`子图定义不存在: ${subgraphId}`)

    const { inputs, outputs } = getSubGraphPorts(def)
    const id = generateNodeId('subgraph')
    const instanceId = generateSubGraphInstanceId()

    const node: SubGraphNode = {
      id,
      type: 'SUBGRAPH',
      name: name ?? def.name,
      position: position ?? nextDefaultPosition(),
      inputs: inputs.map((p) => ({ ...p })),
      outputs: outputs.map((p) => ({ ...p })),
      params: {},
      subgraphId,
      paramOverrides: {},
      instanceId,
    }

    graph.addNode(node)
    return id
  }

  function createSubGraphFromCurrentSelection(
    subgraphId: string,
    subgraphName: string,
  ): SubGraphDefinition {
    const selectedIds = new Set(
      graph.nodes.value
        .filter((n) => n.id === graph.selectedNodeId.value)
        .map((n) => n.id),
    )
    if (selectedIds.size === 0) throw new Error('请先选中要包含在子图中的节点')

    const def = createSubGraphFromSelection(
      { nodes: graph.nodes.value, edges: graph.edges.value, canvas: graph.canvas.value },
      selectedIds,
      subgraphId,
      subgraphName,
    )
    addSubGraphDefinition(def)
    return def
  }

  function updateSubGraphNodeOverrides(nodeId: string, overrides: Record<string, JsonLiteral>): void {
    const node = graph.nodes.value.find((n) => n.id === nodeId)
    if (node && node.type === 'SUBGRAPH') {
      ;(node as SubGraphNode).paramOverrides = { ...overrides }
    }
  }

  return {
    // ── 共享 state（来自 composable）──
    nodes: graph.nodes,
    edges: graph.edges,
    canvas: graph.canvas,
    selectedNodeId: graph.selectedNodeId,
    selectedEdgeId: graph.selectedEdgeId,
    // ── 独有 state ──
    subgraphLibrary,
    // ── 共享 getters ──
    validation: graph.validation,
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    selectedNode: graph.selectedNode,
    // ── 独有 getters ──
    isValid,
    // ── 共享 queries ──
    getNode: graph.getNode,
    getIncomingEdges: graph.getIncomingEdges,
    getOutgoingEdges: graph.getOutgoingEdges,
    // ── domain-specific node actions ──
    addNode,
    addNodeDirect,
    removeNode: graph.removeNode,
    updateNodePosition: graph.updateNodePosition,
    updateNodeParams: graph.updateNodeParams,
    renameNode: graph.renameNode,
    // ── domain-specific edge actions ──
    connect,
    disconnect: graph.disconnect,
    disconnectBetween: graph.disconnectBetween,
    // ── 共享 selection ──
    selectNode: graph.selectNode,
    selectEdge: graph.selectEdge,
    clearSelection: graph.clearSelection,
    // ── 扩展的整图操作 ──
    loadGraph,
    clearGraph,
    exportGraph,
    // ── 子图管理 ──
    addSubGraphDefinition,
    removeSubGraphDefinition,
    getSubGraphDefinition,
    listSubGraphDefinitions,
    addSubGraphNode,
    createSubGraphFromCurrentSelection,
    updateSubGraphNodeOverrides,
  }
})
