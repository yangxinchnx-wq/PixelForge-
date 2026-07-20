<script setup lang="ts">
/**
 * GraphEditor(Step 25.8 / 27.18)— 节点图编辑器主面板。
 *
 * 职责:
 * - 组合所有 Graph 子组件(GraphCanvas / GraphNode / ConnectionLine / GraphToolbar / NodeMenu / Minimap)
 * - 通过 useGraphInteraction 处理画布交互(pan / zoom / drag / connect)
 * - 通过 useGraphShortcuts 处理快捷键(Delete / F / Esc / Ctrl+Z/Y / Ctrl+D)
 * - 编译 Graph 为 RenderIR 后 emit applyIR(交给 App.vue 调用 runtimeStore)
 *
 * 与 store 的协作:
 * - graphStore:  数据层(nodes / edges / validation)
 * - uiStore:     交互层(zoom / offset / selection / connecting / menu)
 * - graphHistory: 命令历史(undo / redo)
 *
 * 事件流:
 *   GraphNode.headerMouseDown → handleNodeHeaderMouseDown → interaction.startNodeDrag
 *   GraphPort.portStartConnect → handlePortStartConnect → interaction.startConnecting
 *   GraphToolbar.openNodeMenu → ui.openNodeMenu
 *   NodeMenu.createNode → handleCreateNode(position-based addNode + AddNodeCommand)
 *   GraphToolbar.autoLayout → handleAutoLayout(AutoLayoutCommand)
 *   GraphToolbar.compile → handleCompile(compileGraph + emit applyIR)
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useGraphStore } from '@/graph/graphStore'
import { useGraphUIStore } from '@/graph/uiStore'
import { useGraphHistoryStore } from '@/graph/graphHistory'
import {
  AddNodeCommand,
  AutoLayoutCommand,
  RemoveNodeCommand,
} from '@/graph/graphHistory'
import { compileGraph, summarizeCompileResult } from '@/graph/graphCompiler'
import { autoLayout, computeNodeBounds } from '@/graph/layout'
import { getNodeDefinition, type NodeRegistryKey } from '@/graph/nodeRegistry'
import { NODE_SIZE, type GraphNode as GraphNodeType } from '@/graph/types'
import type { RenderIR } from '@/compiler/ir/renderIR'

import GraphCanvas from './GraphCanvas.vue'
import GraphNodeComp from './GraphNode.vue'
import ConnectionLine from './ConnectionLine.vue'
import GraphToolbar from './GraphToolbar.vue'
import NodeMenu from './NodeMenu.vue'
import Minimap from './Minimap.vue'
import { useGraphInteraction } from './useGraphInteraction'
import { useGraphShortcuts } from './useGraphShortcuts'

interface Props {
  /** 浮层是否可见(v-model:visible) */
  visible: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** 编译后的 RenderIR(交给 App.vue 调用 runtimeStore.setRenderIR) */
  applyIR: [ir: RenderIR]
}>()

const graph = useGraphStore()
const ui = useGraphUIStore()
const history = useGraphHistoryStore()

// —— 画布 DOM 引用 ——
const canvasEl = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: 1200, height: 720 })

// —— 交互 hook(必须在 setup 顶层调用,内部使用 onBeforeUnmount)——
const interaction = useGraphInteraction(canvasEl)
// —— 快捷键 hook ——
useGraphShortcuts()

// —— 编译状态 ——
const compileStatus = ref<'idle' | 'success' | 'error'>('idle')
const compileMessage = ref<string | null>(null)

// —— 监听画布尺寸(用于 Minimap)——
let resizeObserver: ResizeObserver | null = null

function setupResizeObserver(): void {
  if (!canvasEl.value) return
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const cr = entry.contentRect
      canvasSize.value = { width: cr.width, height: cr.height }
    }
  })
  resizeObserver.observe(canvasEl.value)
  // 初始化尺寸
  const rect = canvasEl.value.getBoundingClientRect()
  canvasSize.value = { width: rect.width, height: rect.height }
}

onMounted(() => {
  // 等待 DOM 渲染后绑定
  setupResizeObserver()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  ui.resetAll()
})

// 当面板可见性变化时,重置 / 恢复 UI 状态
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // 进入时:重置编译状态
      compileStatus.value = 'idle'
      compileMessage.value = null
    } else {
      // 退出时:清理交互状态(避免悬留 dragging / connecting)
      ui.cancelConnecting()
      ui.isDragging = false
      ui.isPanning = false
      ui.closeNodeMenu()
    }
  },
)

// —— 端口位置计算(用于 ConnectionLine)——

/**
 * 计算节点输出端口在画布上的位置(节点右边界中点)。
 * 简化:取第一个 output 端口的近似 y 位置。
 */
function getOutputPortPos(nodeId: string): { x: number; y: number } | null {
  const node = graph.getNode(nodeId)
  if (!node || node.outputs.length === 0) return null
  return {
    x: node.position.x + NODE_SIZE.width,
    y: node.position.y + NODE_SIZE.headerHeight + 16,
  }
}

/**
 * 计算节点输入端口在画布上的位置(节点左边界中点)。
 */
function getInputPortPos(nodeId: string): { x: number; y: number } | null {
  const node = graph.getNode(nodeId)
  if (!node || node.inputs.length === 0) return null
  return {
    x: node.position.x,
    y: node.position.y + NODE_SIZE.headerHeight + 16,
  }
}

// —— 临时连线位置(用户正在拖拽时)——
const tempLine = computed(() => {
  if (!ui.connecting) return null
  const from = getOutputPortPos(ui.connecting.fromNodeId)
  if (!from) return null
  return {
    fromX: from.x,
    fromY: from.y,
    toX: ui.connecting.currentPos.x,
    toY: ui.connecting.currentPos.y,
  }
})

// —— 事件处理 ——

/**
 * 节点 header mousedown:
 * - Ctrl/Cmd + Click → toggleNodeSelection(多选,不拖动)
 * - 普通 Click → selectNode + startNodeDrag
 */
function handleNodeHeaderMouseDown(
  nodeId: string,
  ctrlKey: boolean,
  clientX: number,
  clientY: number,
): void {
  if (ctrlKey) {
    ui.toggleNodeSelection(nodeId)
    return
  }
  if (!ui.isNodeSelected(nodeId)) {
    ui.selectNode(nodeId)
  }
  interaction.startNodeDrag(nodeId, clientX, clientY)
}

/** 端口 mousedown:开始连线 */
function handlePortStartConnect(
  nodeId: string,
  portId: string,
  _direction: 'input' | 'output',
  clientX: number,
  clientY: number,
): void {
  // GraphPort 只在 output 上触发 mousedown,input 不触发
  interaction.startConnecting(nodeId, portId, clientX, clientY)
}

/** 点击 edge:选中 */
function handleSelectEdge(edgeId: string): void {
  ui.selectEdge(edgeId)
}

/** 删除节点:入 graphHistory(支持 undo) */
function handleRemoveNode(nodeId: string): void {
  const node = graph.getNode(nodeId)
  if (!node) return
  const relatedEdges = [
    ...graph.getIncomingEdges(nodeId),
    ...graph.getOutgoingEdges(nodeId),
  ]
  history.execute(new RemoveNodeCommand(node, relatedEdges, graph))
  ui.clearSelection()
}

/**
 * NodeMenu 创建节点:
 * - 把 menu 的 screen 坐标转换为 world 坐标
 * - 构造 GraphNode(从 NodeRegistry 实例化)
 * - 入 AddNodeCommand(支持 undo,execute 会调用 addNodeDirect)
 */
function handleCreateNode(key: NodeRegistryKey, screenPos: { x: number; y: number }): void {
  // menu 坐标是 canvas-relative,需加上 canvasEl 的 client rect 转为 client 坐标
  const rect = canvasEl.value?.getBoundingClientRect()
  const clientX = (rect?.left ?? 0) + screenPos.x
  const clientY = (rect?.top ?? 0) + screenPos.y
  const world = interaction.screenToWorld(clientX, clientY)

  // 从 NodeRegistry 实例化节点(复刻 graphStore.addNode 的逻辑,但本地生成 id)
  const def = getNodeDefinition(key)
  const nodeId = `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const node: GraphNodeType = {
    id: nodeId,
    type: def.type,
    name: def.label,
    position: world,
    inputs: def.inputs.map((p) => ({ ...p })),
    outputs: def.outputs.map((p) => ({ ...p })),
    params: { ...def.defaultParams },
    opcodeName: def.opcodeName,
    templateKey: def.key,
  }

  // 入 history(execute 会调用 addNodeDirect)
  history.execute(new AddNodeCommand(node, graph))

  // 选中新创建的节点
  ui.selectNode(nodeId)
  ui.closeNodeMenu()
}

/**
 * 自动布局:计算新位置,入 AutoLayoutCommand(支持 undo)
 */
function handleAutoLayout(): void {
  if (graph.nodes.length === 0) return
  const currentGraph = graph.exportGraph()
  const result = autoLayout(currentGraph)

  // 快照旧位置
  const oldPositions = new Map<string, { x: number; y: number }>()
  for (const node of graph.nodes) {
    oldPositions.set(node.id, { ...node.position })
  }

  // 执行批量移动(由 AutoLayoutCommand.execute 应用新位置)
  history.execute(new AutoLayoutCommand(oldPositions, result.positions, graph))

  // 自动 fit view
  const bounds = computeNodeBounds(graph.nodes)
  ui.fitView(bounds, canvasSize.value)
}

/** 适应视图 */
function handleFitView(): void {
  if (graph.nodes.length === 0) return
  const bounds = computeNodeBounds(graph.nodes)
  ui.fitView(bounds, canvasSize.value)
}

/** 清空所有节点(同时清空 history) */
function handleClear(): void {
  graph.clearGraph()
  history.clear()
  compileStatus.value = 'idle'
  compileMessage.value = null
  ui.clearSelection()
}

/** 编译 Graph 为 RenderIR 并 emit applyIR */
function handleCompile(): void {
  try {
    const graphData = graph.exportGraph()
    const result = compileGraph(graphData)
    emit('applyIR', result.ir)
    compileStatus.value = 'success'
    compileMessage.value = summarizeCompileResult(result)
  } catch (e) {
    compileStatus.value = 'error'
    compileMessage.value = (e as Error).message
  }
}

/** 打开节点菜单(在画布中心位置) */
function handleOpenNodeMenu(): void {
  // 在画布中心打开
  const rect = canvasEl.value?.getBoundingClientRect()
  if (!rect) return
  ui.openNodeMenu({
    x: rect.width / 2 - 120,  // 菜单宽 240px,居中
    y: rect.height / 2 - 80,
  })
}

/** 关闭编辑器 */
function handleClose(): void {
  emit('update:visible', false)
}

// —— Canvas 事件代理(转发给 interaction)——

function onCanvasWheel(e: WheelEvent): void {
  interaction.handleWheel(e)
}

function onCanvasMouseDown(e: MouseEvent): void {
  interaction.handleCanvasMouseDown(e)
}

function onCanvasContextMenu(e: MouseEvent): void {
  interaction.handleContextMenu(e)
}
</script>

<template>
  <Transition name="graph-fade">
    <div v-if="visible" class="graph-overlay">
      <Transition name="graph-pop">
        <div v-if="visible" class="graph-container">
          <!-- 顶部工具栏 -->
          <GraphToolbar
            :validation="graph.validation"
            :node-count="graph.nodeCount"
            :edge-count="graph.edgeCount"
            :can-compile="graph.isValid"
            :compile-status="compileStatus"
            :compile-message="compileMessage"
            @open-node-menu="handleOpenNodeMenu"
            @auto-layout="handleAutoLayout"
            @fit-view="handleFitView"
            @compile="handleCompile"
            @clear="handleClear"
            @close="handleClose"
          />

          <!-- 画布区(相对定位,便于 NodeMenu / Minimap 浮层) -->
          <div
            ref="canvasEl"
            class="graph-canvas-wrapper"
            @wheel="onCanvasWheel"
            @mousedown="onCanvasMouseDown"
            @contextmenu="onCanvasContextMenu"
          >
            <!-- 无限画布(应用 world 变换) -->
            <GraphCanvas>
              <!-- SVG 连接线层(在节点下方) -->
              <template #edges>
                <svg class="connections-svg">
                  <ConnectionLine
                    v-for="edge in graph.edges"
                    :key="edge.id"
                    :from-x="getOutputPortPos(edge.from)?.x ?? 0"
                    :from-y="getOutputPortPos(edge.from)?.y ?? 0"
                    :to-x="getInputPortPos(edge.to)?.x ?? 0"
                    :to-y="getInputPortPos(edge.to)?.y ?? 0"
                    :selected="ui.isEdgeSelected(edge.id)"
                    :edge-id="edge.id"
                    @select-edge="handleSelectEdge"
                  />
                  <!-- 临时连线(用户正在拖拽) -->
                  <ConnectionLine
                    v-if="tempLine"
                    :from-x="tempLine.fromX"
                    :from-y="tempLine.fromY"
                    :to-x="tempLine.toX"
                    :to-y="tempLine.toY"
                    :temporary="true"
                  />
                </svg>
              </template>

              <!-- 节点层 -->
              <GraphNodeComp
                v-for="node in graph.nodes"
                :key="node.id"
                :node="node"
                :selected="ui.isNodeSelected(node.id)"
                :connecting-active="ui.connecting !== null"
                @header-mouse-down="handleNodeHeaderMouseDown"
                @port-start-connect="handlePortStartConnect"
                @remove-node="handleRemoveNode"
              />
            </GraphCanvas>

            <!-- 节点搜索菜单(浮层) -->
            <NodeMenu @create-node="handleCreateNode" />

            <!-- 右下角缩略图 -->
            <Minimap :canvas-size="canvasSize" />
          </div>

          <!-- 底部状态栏 -->
          <footer class="graph-footer">
            <span class="footer-hint">
              滚轮缩放 · 拖空白平移 · 拖节点移动 · 拖端口连线 · 右键添加节点 · F 适应 · Del 删除 · Esc 取消
            </span>
          </footer>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.graph-overlay {
  position: fixed;
  inset: 0;
  background: rgba(250, 247, 240, 0.92);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  z-index: 900;
  padding: 16px;
}

.graph-container {
  width: 100%;
  height: 100%;
  background: var(--pf-surface);
  border-radius: var(--pf-r-xl);
  border: 1px solid var(--pf-line);
  box-shadow: 0 12px 40px rgba(20, 18, 14, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 画布容器(相对定位,用于 NodeMenu / Minimap 浮层) */
.graph-canvas-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
}

/* 让 GraphCanvas 填满 wrapper */
.graph-canvas-wrapper :deep(.graph-canvas) {
  width: 100%;
  height: 100%;
}

.connections-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}

.connections-svg :deep(path) {
  pointer-events: stroke;
}

.graph-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  background: var(--pf-surface);
  border-top: 1px solid var(--pf-line);
  min-height: 36px;
}

.footer-hint {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink-soft);
  opacity: 0.7;
}

/* —— 过渡动画(与 ClarifierDialog 风格一致) —— */
.graph-fade-enter-active,
.graph-fade-leave-active {
  transition: opacity 200ms cubic-bezier(0.22, 1, 0.36, 1);
}

.graph-fade-enter-from,
.graph-fade-leave-to {
  opacity: 0;
}

.graph-pop-enter-active {
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 240ms cubic-bezier(0.22, 1, 0.36, 1);
}

.graph-pop-leave-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.graph-pop-enter-from {
  transform: scale(0.96) translateY(8px);
  opacity: 0;
}

.graph-pop-leave-to {
  transform: scale(0.98);
  opacity: 0;
}
</style>
