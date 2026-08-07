/**
 * useNodeGraph — 通用节点图 composable 工厂。
 *
 * 消除 graph/graphStore.ts 和 material/materialGraph.ts 之间的 DRY 违反。
 * 提供节点/边 CRUD、选择管理、图操作（load/clear/export）的通用实现。
 *
 * 使用方式（在 Pinia store 内部调用）:
 *   const graph = useNodeGraph<GraphNode, GraphEdge>({
 *     makeNode: (id, position) => ...,
 *     validate: (nodes, edges) => ...,
 *   });
 *
 * 存在差异的地方（如 connect 的校验逻辑、compile、子图管理）由各 store 自行扩展。
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { JsonLiteral } from '@/shared/types'

// ─── 共享接口 ──────────────────────────────────────────

export interface BaseNode {
  id: string
  type: string
  name: string
  position: { x: number; y: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs: Array<{ id: string } & Record<string, any>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputs: Array<{ id: string } & Record<string, any>>
  params: Record<string, JsonLiteral>
}

export interface BaseEdge {
  id: string
  from: string
  fromPort: string
  to: string
  toPort: string
}

export interface BaseValidationResult {
  valid: boolean
}

// ─── ID/Position 生成器 ────────────────────────────────

let nodeIdCounter = 0
export function generateNodeId(prefix: string = 'node'): string {
  nodeIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${nodeIdCounter.toString(36)}`
}

let defaultPositionCounter = 0
export function nextDefaultPosition(): { x: number; y: number } {
  defaultPositionCounter++
  const col = defaultPositionCounter % 4
  const row = Math.floor(defaultPositionCounter / 4)
  return { x: 80 + col * 220, y: 80 + row * 180 }
}

export function makeEdgeId(from: string, fromPort: string, to: string, toPort: string): string {
  return `${from}:${fromPort}->${to}:${toPort}`
}

// ─── composable 工厂 ───────────────────────────────────

export interface NodeGraphOptions<N extends BaseNode, E extends BaseEdge, V extends BaseValidationResult, C extends { width: number; height: number }> {
  defaultCanvas: C
  validate: (nodes: N[], edges: E[], canvas: C) => V
}

export function useNodeGraph<N extends BaseNode, E extends BaseEdge, V extends BaseValidationResult, C extends { width: number; height: number }>(
  options: NodeGraphOptions<N, E, V, C>,
) {
  const { defaultCanvas, validate } = options

  // ─── State ──────────────────────────────────────────
  const nodes: Ref<N[]> = ref([]) as Ref<N[]>
  const edges: Ref<E[]> = ref([]) as Ref<E[]>
  const canvas: Ref<C> = ref({ ...defaultCanvas }) as Ref<C>
  const selectedNodeId: Ref<string | null> = ref(null)
  const selectedEdgeId: Ref<string | null> = ref(null)

  // ─── Getters ────────────────────────────────────────
  const validation: ComputedRef<V> = computed(() =>
    validate(nodes.value, edges.value, canvas.value),
  )
  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)
  const selectedNode = computed<N | null>(() => {
    if (!selectedNodeId.value) return null
    return nodes.value.find((n) => n.id === selectedNodeId.value) ?? null
  })

  // ─── Node Queries ───────────────────────────────────
  function getNode(id: string): N | undefined {
    return nodes.value.find((n) => n.id === id)
  }

  function getIncomingEdges(nodeId: string): E[] {
    return edges.value.filter((e) => e.to === nodeId) as E[]
  }

  function getOutgoingEdges(nodeId: string): E[] {
    return edges.value.filter((e) => e.from === nodeId) as E[]
  }

  // ─── Node CRUD ──────────────────────────────────────
  function addNode(node: N): void {
    nodes.value = [...nodes.value, node]
  }

  function removeNode(id: string): void {
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.from !== id && e.to !== id)
    if (selectedNodeId.value === id) selectedNodeId.value = null
  }

  function updateNodePosition(id: string, position: { x: number; y: number }): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) node.position = position
  }

  function updateNodeParams(id: string, params: Record<string, JsonLiteral>): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) node.params = { ...params }
  }

  function renameNode(id: string, name: string): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) node.name = name
  }

  // ─── Edge CRUD ──────────────────────────────────────
  function addEdge(edge: E): void {
    edges.value = [...edges.value, edge]
  }

  function disconnect(edgeId: string): void {
    edges.value = edges.value.filter((e) => e.id !== edgeId)
    if (selectedEdgeId.value === edgeId) selectedEdgeId.value = null
  }

  function disconnectBetween(from: string, to: string): void {
    edges.value = edges.value.filter((e) => !(e.from === from && e.to === to))
  }

  // ─── Selection ──────────────────────────────────────
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

  // ─── Graph Operations ──────────────────────────────
  function loadGraph(graphNodes: N[], graphEdges: E[], graphCanvas?: C): void {
    nodes.value = graphNodes.map((n) => ({
      ...n,
      inputs: [...n.inputs],
      outputs: [...n.outputs],
      params: { ...n.params },
    }))
    edges.value = [...graphEdges]
    if (graphCanvas) canvas.value = { ...graphCanvas }
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  function clearGraph(): void {
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  function exportNodes(): N[] {
    return nodes.value.map((n) => ({
      ...n,
      inputs: [...n.inputs],
      outputs: [...n.outputs],
      params: { ...n.params },
    }))
  }

  function exportEdges(): E[] {
    return edges.value.map((e) => ({ ...e }))
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
    selectedNode,
    // queries
    getNode,
    getIncomingEdges,
    getOutgoingEdges,
    // node CRUD
    addNode,
    removeNode,
    updateNodePosition,
    updateNodeParams,
    renameNode,
    // edge CRUD
    addEdge,
    disconnect,
    disconnectBetween,
    // selection
    selectNode,
    selectEdge,
    clearSelection,
    // graph ops
    loadGraph,
    clearGraph,
    exportNodes,
    exportEdges,
    // utilities
    generateNodeId,
    nextDefaultPosition,
    makeEdgeId,
  }
}
