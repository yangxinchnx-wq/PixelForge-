/**
 * Material Graph Store(Step 28.15)— Material Graph 数据结构 + Pinia Store。
 *
 * 职责:
 * - 管理 MaterialGraph 状态(nodes / edges / canvas)
 * - 提供 CRUD actions:addNode / removeNode / connect / disconnect / updateNodeParams
 * - 提供 selection 状态(选中节点 / 边)
 * - 提供 validation(类型检查 + 环检测 + OUTPUT 唯一性)
 * - 提供 compile()(调用 compiler.compileMaterialGraph)
 *
 * 与 graph/graphStore.ts 的关系:
 * - graph/graphStore.ts:   RenderGraph store(高层场景)
 * - material/materialGraph.ts: MaterialGraph store(底层 shader)
 *
 * 设计原则:
 * - 与 graphStore 解耦(可独立用于 Material Editor)
 * - 不直接调用 MaterialRuntime(由 App.vue 编排:store.compile → runtime.compilePipeline)
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { JsonLiteral } from '@/shared/types'
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

/**
 * 生成节点唯一 ID(基于时间戳 + 自增序号)。
 */
let nodeIdCounter = 0
function generateNodeId(prefix: string = 'm'): string {
  nodeIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${nodeIdCounter.toString(36)}`
}

/**
 * 生成 edge ID(确定性,便于去重)。
 */
function makeEdgeId(from: string, fromPort: string, to: string, toPort: string): string {
  return `${from}:${fromPort}->${to}:${toPort}`
}

/**
 * 默认节点位置(每次添加右下偏移)。
 */
let defaultPosCounter = 0
function nextDefaultPosition(): { x: number; y: number } {
  defaultPosCounter++
  const col = defaultPosCounter % 4
  const row = Math.floor(defaultPosCounter / 4)
  return { x: 80 + col * 240, y: 80 + row * 200 }
}

/**
 * Material Graph Store(Pinia Setup Store)。
 */
export const useMaterialGraphStore = defineStore('materialGraph', () => {
  // —— State ——
  const nodes = ref<MaterialNode[]>([])
  const edges = ref<MaterialEdge[]>([])
  const canvas = ref({ ...DEFAULT_MATERIAL_CANVAS })

  const selectedNodeId = ref<string | null>(null)
  const selectedEdgeId = ref<string | null>(null)

  // —— Getters ——
  const nodeCount = computed(() => nodes.value.length)
  const edgeCount = computed(() => edges.value.length)
  const outputNodeCount = computed(() =>
    nodes.value.filter((n) => n.type === 'OUTPUT').length,
  )
  const hasOutput = computed(() => outputNodeCount.value >= 1)
  const selectedNode = computed<MaterialNode | null>(() => {
    if (!selectedNodeId.value) return null
    return nodes.value.find((n) => n.id === selectedNodeId.value) ?? null
  })

  /** 校验结果(类型 + 环 + OUTPUT 唯一性) */
  const validation = computed<MaterialValidationResult>(() => {
    const errors: MaterialValidationResult['errors'] = []
    const warnings: MaterialValidationResult['warnings'] = []

    // OUTPUT 唯一性
    if (outputNodeCount.value === 0) {
      errors.push({ message: '缺少 OUTPUT 节点', severity: 'error' })
    } else if (outputNodeCount.value > 1) {
      errors.push({
        message: `只能有一个 OUTPUT 节点(当前 ${outputNodeCount.value} 个)`,
        severity: 'error',
      })
    }

    // 类型检查(每条边)
    for (const edge of edges.value) {
      const fromNode = nodes.value.find((n) => n.id === edge.from)
      const toNode = nodes.value.find((n) => n.id === edge.to)
      if (!fromNode || !toNode) {
        errors.push({
          edgeId: edge.id,
          message: `边 ${edge.id} 引用不存在的节点`,
          severity: 'error',
        })
        continue
      }
      const fromPort = fromNode.outputs.find((p) => p.id === edge.fromPort)
      const toPort = toNode.inputs.find((p) => p.id === edge.toPort)
      if (!fromPort || !toPort) {
        errors.push({
          edgeId: edge.id,
          message: `边 ${edge.id} 引用不存在的端口`,
          severity: 'error',
        })
        continue
      }
      const check = canConnectPorts(fromPort, toPort)
      if (!check.ok) {
        errors.push({
          edgeId: edge.id,
          message: check.reason ?? '类型不兼容',
          severity: 'error',
        })
      }
    }

    // 输入端口唯一性(每个输入最多一条边)
    const inputPortCounts = new Map<string, number>()
    for (const edge of edges.value) {
      const key = `${edge.to}:${edge.toPort}`
      inputPortCounts.set(key, (inputPortCounts.get(key) ?? 0) + 1)
    }
    for (const [key, count] of inputPortCounts) {
      if (count > 1) {
        errors.push({
          message: `输入端口 ${key} 被 ${count} 条边连接(最多 1 条)`,
          severity: 'error',
        })
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  })

  // —— Actions: 节点 CRUD ——

  /**
   * 添加节点(从注册表实例化)。
   *
   * @param key      ShaderNodeKey(如 'uv' / 'noise' / 'output')
   * @param position 可选位置
   * @param name     可读名(不传则用 label)
   * @returns 新节点 ID,失败返回 null
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
    nodes.value = [...nodes.value, node]
    return id
  }

  /** 移除节点(同时移除相关边) */
  function removeNode(id: string): void {
    nodes.value = nodes.value.filter((n) => n.id !== id)
    edges.value = edges.value.filter((e) => e.from !== id && e.to !== id)
    if (selectedNodeId.value === id) selectedNodeId.value = null
  }

  /** 更新节点位置 */
  function updateNodePosition(id: string, position: { x: number; y: number }): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) node.position = position
  }

  /** 更新节点参数 */
  function updateNodeParams(id: string, params: Record<string, JsonLiteral>): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) node.params = { ...params }
  }

  /** 重命名节点 */
  function renameNode(id: string, name: string): void {
    const node = nodes.value.find((n) => n.id === id)
    if (node) node.name = name
  }

  // —— Actions: Edge CRUD ——

  /**
   * 连接两个节点(先检查类型兼容)。
   *
   * @returns { ok, edgeId?, error? }
   */
  function connect(
    from: string,
    fromPort: string,
    to: string,
    toPort: string,
  ): { ok: boolean; edgeId?: string; error?: string } {
    const fromNode = nodes.value.find((n) => n.id === from)
    const toNode = nodes.value.find((n) => n.id === to)
    if (!fromNode || !toNode) {
      return { ok: false, error: '节点不存在' }
    }
    const fromPortDef = fromNode.outputs.find((p) => p.id === fromPort)
    const toPortDef = toNode.inputs.find((p) => p.id === toPort)
    if (!fromPortDef || !toPortDef) {
      return { ok: false, error: '端口不存在' }
    }
    const check = canConnectPorts(fromPortDef, toPortDef)
    if (!check.ok) {
      return { ok: false, error: check.reason }
    }
    // 检查输入端口是否已被占用
    const existing = edges.value.find((e) => e.to === to && e.toPort === toPort)
    if (existing) {
      return { ok: false, error: '输入端口已被占用' }
    }
    const id = makeEdgeId(from, fromPort, to, toPort)
    edges.value = [...edges.value, { id, from, fromPort, to, toPort }]
    return { ok: true, edgeId: id }
  }

  /** 断开连接 */
  function disconnect(edgeId: string): void {
    edges.value = edges.value.filter((e) => e.id !== edgeId)
    if (selectedEdgeId.value === edgeId) selectedEdgeId.value = null
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

  /** 加载完整 MaterialGraph(替换当前状态) */
  function loadGraph(graph: MaterialGraph): void {
    nodes.value = graph.nodes.map((n) => ({
      ...n,
      inputs: [...n.inputs],
      outputs: [...n.outputs],
      params: { ...n.params },
    }))
    edges.value = [...graph.edges]
    if (graph.canvas) canvas.value = { ...graph.canvas }
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  /** 清空 Graph */
  function clearGraph(): void {
    nodes.value = []
    edges.value = []
    selectedNodeId.value = null
    selectedEdgeId.value = null
  }

  /** 导出 MaterialGraph(深拷贝) */
  function exportGraph(): MaterialGraph {
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

  /**
   * 编译当前 Graph 为 WGSL。
   *
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
    // state
    nodes,
    edges,
    canvas,
    selectedNodeId,
    selectedEdgeId,
    // getters
    nodeCount,
    edgeCount,
    outputNodeCount,
    hasOutput,
    selectedNode,
    validation,
    // node actions
    addNode,
    removeNode,
    updateNodePosition,
    updateNodeParams,
    renameNode,
    // edge actions
    connect,
    disconnect,
    // selection
    selectNode,
    selectEdge,
    clearSelection,
    // graph actions
    loadGraph,
    clearGraph,
    exportGraph,
    compile,
    getNodeDefinition,
  }
})
