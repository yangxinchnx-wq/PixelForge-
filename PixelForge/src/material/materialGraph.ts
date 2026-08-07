/**
 * Material Graph Store(Step 28.15)— Material Graph 数据结构 + Pinia Store。
 *
 * 使用 useNodeGraph composable 消除与 graph/graphStore.ts 的 DRY 违反。
 *
 * 职责:
 * - 管理 MaterialGraph 状态(nodes / edges / canvas)
 * - 提供 domain-specific actions: addNode(ShaderNodeKey) / connect(类型检查) / compile
 * - 共享 CRUD / selection / graph 操作委托给 useNodeGraph
 *
 * 设计原则:
 * - 与 graphStore 解耦(可独立用于 Material Editor)
 * - 不直接调用 MaterialRuntime(由 App.vue 编排:store.compile → runtime.compilePipeline)
 */

import { defineStore } from 'pinia'
import { computed } from 'vue'

import type {
  CompileResult,
  MaterialEdge,
  MaterialGraph,
  MaterialNode,
  MaterialValidationResult,
} from './types'
import { DEFAULT_MATERIAL_CANVAS } from './types'
import { canConnectPorts } from './typeChecker'
import {
  createNodeFromTemplate,
  getShaderNode,
  type ShaderNodeKey,
} from './shaderRegistry'
import { compileMaterialGraph } from './compiler'
import {
  useNodeGraph,
  makeEdgeId,
  generateNodeId,
  nextDefaultPosition,
} from '@/composables/useNodeGraph'

/**
 * Material Graph Store(Pinia Setup Store)。
 */
export const useMaterialGraphStore = defineStore('materialGraph', () => {
  // ─── 共享节点图基础（CRUD / selection / load / clear / export）───
  const graph = useNodeGraph<MaterialNode, MaterialEdge, MaterialValidationResult, { width: number; height: number }>({
    defaultCanvas: { ...DEFAULT_MATERIAL_CANVAS },
    validate: (nodes, edges) => {
      const errors: MaterialValidationResult['errors'] = []
      const warnings: MaterialValidationResult['warnings'] = []

      // OUTPUT 唯一性
      const outputCount = nodes.filter((n) => n.type === 'OUTPUT').length
      if (outputCount === 0) {
        errors.push({ message: '缺少 OUTPUT 节点', severity: 'error' })
      } else if (outputCount > 1) {
        errors.push({ message: `只能有一个 OUTPUT 节点(当前 ${outputCount} 个)`, severity: 'error' })
      }

      // 类型检查(每条边)
      for (const edge of edges) {
        const fromNode = nodes.find((n) => n.id === edge.from)
        const toNode = nodes.find((n) => n.id === edge.to)
        if (!fromNode || !toNode) {
          errors.push({ edgeId: edge.id, message: `边 ${edge.id} 引用不存在的节点`, severity: 'error' })
          continue
        }
        const fromPort = fromNode.outputs.find((p) => p.id === edge.fromPort)
        const toPort = toNode.inputs.find((p) => p.id === edge.toPort)
        if (!fromPort || !toPort) {
          errors.push({ edgeId: edge.id, message: `边 ${edge.id} 引用不存在的端口`, severity: 'error' })
          continue
        }
        const check = canConnectPorts(fromPort, toPort)
        if (!check.ok) {
          errors.push({ edgeId: edge.id, message: check.reason ?? '类型不兼容', severity: 'error' })
        }
      }

      // 输入端口唯一性(每个输入最多一条边)
      const inputPortCounts = new Map<string, number>()
      for (const edge of edges) {
        const key = `${edge.to}:${edge.toPort}`
        inputPortCounts.set(key, (inputPortCounts.get(key) ?? 0) + 1)
      }
      for (const [key, count] of inputPortCounts) {
        if (count > 1) {
          errors.push({ message: `输入端口 ${key} 被 ${count} 条边连接(最多 1 条)`, severity: 'error' })
        }
      }

      return { valid: errors.length === 0, errors, warnings }
    },
  })

  // ─── domain-specific getters ────────────────────────
  const outputNodeCount = computed(() =>
    graph.nodes.value.filter((n) => n.type === 'OUTPUT').length,
  )
  const hasOutput = computed(() => outputNodeCount.value >= 1)

  // ─── domain-specific node actions ───────────────────

  /**
   * 添加节点(从注册表实例化)。
   */
  function addNode(
    key: ShaderNodeKey,
    position?: { x: number; y: number },
    name?: string,
  ): string | null {
    const id = generateNodeId(key.substring(0, 3))
    const node = createNodeFromTemplate(key, id, position ?? nextDefaultPosition())
    if (!node) return null
    if (name) node.name = name
    graph.addNode(node)
    return id
  }

  /**
   * 连接两个节点(先检查类型兼容)。
   */
  function connect(
    from: string,
    fromPort: string,
    to: string,
    toPort: string,
  ): { ok: boolean; edgeId?: string; error?: string } {
    const fromNode = graph.nodes.value.find((n) => n.id === from)
    const toNode = graph.nodes.value.find((n) => n.id === to)
    if (!fromNode || !toNode) return { ok: false, error: '节点不存在' }
    const fromPortDef = fromNode.outputs.find((p) => p.id === fromPort)
    const toPortDef = toNode.inputs.find((p) => p.id === toPort)
    if (!fromPortDef || !toPortDef) return { ok: false, error: '端口不存在' }
    const check = canConnectPorts(fromPortDef, toPortDef)
    if (!check.ok) return { ok: false, error: check.reason }
    // 检查输入端口是否已被占用
    const existing = graph.edges.value.find((e) => e.to === to && e.toPort === toPort)
    if (existing) return { ok: false, error: '输入端口已被占用' }

    const id = makeEdgeId(from, fromPort, to, toPort)
    graph.addEdge({ id, from, fromPort, to, toPort })
    return { ok: true, edgeId: id }
  }

  // ─── 整图操作 ──────────────────────────────────────

  function loadGraph(materialGraph: MaterialGraph): void {
    graph.loadGraph(materialGraph.nodes, materialGraph.edges, materialGraph.canvas)
  }

  function exportGraph(): MaterialGraph {
    return {
      nodes: graph.exportNodes(),
      edges: graph.exportEdges(),
      canvas: { ...graph.canvas.value },
    }
  }

  /**
   * 编译当前 Graph 为 WGSL。
   * @throws 如果 graph 无效
   */
  function compile(): CompileResult {
    return compileMaterialGraph(exportGraph())
  }

  /** 获取节点定义(用于 Inspector 显示参数 schema) */
  function getNodeDefinition(templateKey: string) {
    return getShaderNode(templateKey)
  }

  return {
    // ── 共享 state ──
    nodes: graph.nodes,
    edges: graph.edges,
    canvas: graph.canvas,
    selectedNodeId: graph.selectedNodeId,
    selectedEdgeId: graph.selectedEdgeId,
    // ── 共享 getters ──
    nodeCount: graph.nodeCount,
    edgeCount: graph.edgeCount,
    selectedNode: graph.selectedNode,
    validation: graph.validation,
    // ── 独有 getters ──
    outputNodeCount,
    hasOutput,
    // ── domain-specific node actions ──
    addNode,
    removeNode: graph.removeNode,
    updateNodePosition: graph.updateNodePosition,
    updateNodeParams: graph.updateNodeParams,
    renameNode: graph.renameNode,
    // ── domain-specific edge actions ──
    connect,
    disconnect: graph.disconnect,
    // ── 共享 selection ──
    selectNode: graph.selectNode,
    selectEdge: graph.selectEdge,
    clearSelection: graph.clearSelection,
    // ── 整图操作 ──
    loadGraph,
    clearGraph: graph.clearGraph,
    exportGraph,
    // ── 独有 actions ──
    compile,
    getNodeDefinition,
  }
})
