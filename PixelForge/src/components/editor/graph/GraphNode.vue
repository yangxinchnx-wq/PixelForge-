<script setup lang="ts">
/**
 * GraphNode(Step 25.8 / 27.7)— 节点卡片组件。
 *
 * 职责:
 * - 显示节点头部(name / type / 删除按钮)
 * - 显示输入/输出端口(通过 GraphPort 子组件)
 * - 显示关键参数摘要(便于快速预览)
 * - mousedown header → emit headerMouseDown(开始拖动 / 选中)
 * - 支持选中状态(高亮边框)
 *
 * 拖动机制(Step 27 更新):
 * - 旧版:emit dragStart(nodeId, offsetX, offsetY) → 父组件监听 mousemove
 * - 新版:emit headerMouseDown(nodeId, ctrlKey, clientX, clientY)
 *   → 父组件调用 useGraphInteraction.startNodeDrag 统一处理
 *   (坐标转换 / 多选 / history 都在 hook 内)
 *
 * 多选(Step 27 新增):
 * - Ctrl/Cmd + mousedown → emit headerMouseDown with ctrlKey=true
 *   → 父组件调用 ui.toggleNodeSelection(不开始拖动)
 * - 普通 mousedown → selectNode + startNodeDrag
 */

import { computed } from 'vue'
import type { GraphNode } from '@/graph/types'
import GraphPort from './GraphPort.vue'

interface Props {
  node: GraphNode
  /** 是否选中(由父组件根据 uiStore 计算) */
  selected?: boolean
  /** 是否处于连线中(用于高亮可连接的目标端口) */
  connectingActive?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** mousedown on header:开始拖动 / 选中 / 多选 */
  headerMouseDown: [nodeId: string, ctrlKey: boolean, clientX: number, clientY: number]
  /** mousedown on output port:开始连线(透传 GraphPort 的 emit) */
  portStartConnect: [nodeId: string, portId: string, direction: 'input' | 'output', clientX: number, clientY: number]
  /** 删除节点 */
  removeNode: [nodeId: string]
}>()

const nodeStyle = computed(() => ({
  left: `${props.node.position.x}px`,
  top: `${props.node.position.y}px`,
}))

const nodeClass = computed(() => ({
  'graph-node': true,
  'node-selected': props.selected,
  [`node-type-${props.node.type.toLowerCase()}`]: true,
}))

/** 参数摘要(显示前 2 个参数,便于快速预览) */
const paramSummary = computed(() => {
  const entries = Object.entries(props.node.params).slice(0, 2)
  if (entries.length === 0) return ''
  return entries
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${(v as unknown[]).length}]`
      if (typeof v === 'string' && v.length > 12) return `${k}: "${v.slice(0, 10)}…"`
      return `${k}: ${String(v)}`
    })
    .join(' · ')
})

/**
 * header mousedown:
 * - 始终 emit headerMouseDown(包含 ctrlKey 状态)
 * - 父组件决定:多选(Ctrl)还是单选+拖动(普通)
 */
function handleHeaderMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return  // 仅左键
  e.stopPropagation()
  emit('headerMouseDown', props.node.id, e.ctrlKey || e.metaKey, e.clientX, e.clientY)
}

/** 透传 GraphPort 的 portStartConnect emit */
function handlePortStartConnect(
  nodeId: string,
  portId: string,
  direction: 'input' | 'output',
  clientX: number,
  clientY: number,
): void {
  emit('portStartConnect', nodeId, portId, direction, clientX, clientY)
}

function handleRemove(): void {
  emit('removeNode', props.node.id)
}
</script>

<template>
  <div :class="nodeClass" :style="nodeStyle" @mousedown="handleHeaderMouseDown($event)">
    <!-- 节点头部 -->
    <header class="node-header">
      <span class="node-name">{{ node.name }}</span>
      <button
        class="node-remove"
        data-tip="删除节点"
        @mousedown.stop
        @click.stop="handleRemove"
      >×</button>
    </header>

    <!-- 节点类型标签 -->
    <div class="node-type-tag">{{ node.type }}<span v-if="node.opcodeName"> · {{ node.opcodeName }}</span></div>

    <!-- 端口区 -->
    <div class="node-ports">
      <div class="ports-column ports-input">
        <GraphPort
          v-for="port in node.inputs"
          :key="`in-${port.id}`"
          :port="port"
          direction="input"
          :node-id="node.id"
          :active="connectingActive"
          @port-start-connect="handlePortStartConnect"
        />
        <div v-if="node.inputs.length === 0" class="port-empty">(无输入)</div>
      </div>
      <div class="ports-column ports-output">
        <GraphPort
          v-for="port in node.outputs"
          :key="`out-${port.id}`"
          :port="port"
          direction="output"
          :node-id="node.id"
          @port-start-connect="handlePortStartConnect"
        />
        <div v-if="node.outputs.length === 0" class="port-empty">(无输出)</div>
      </div>
    </div>

    <!-- 参数摘要 -->
    <div v-if="paramSummary" class="node-params">{{ paramSummary }}</div>
  </div>
</template>

<style scoped>
.graph-node {
  position: absolute;
  width: 180px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 14px;
  padding: 0;
  user-select: none;
  cursor: move;
  transition: box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1),
              border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 2px 8px rgba(20, 18, 14, 0.04);
}

.graph-node:hover {
  box-shadow: 0 4px 14px rgba(20, 18, 14, 0.08);
}

.node-selected {
  border-color: var(--pf-accent);
  box-shadow: 0 0 0 3px rgba(184, 92, 46, 0.18),
              0 4px 14px rgba(20, 18, 14, 0.08);
}

/* 不同节点类型的左边框颜色(与项目设计语言对齐) */
.node-type-region {
  border-left: 3px solid var(--pf-accent);
}

.node-type-effect {
  border-left: 3px solid #7c3aed;  /* 紫色:effect */
}

.node-type-composite {
  border-left: 3px solid #0891b2;  /* 青色:composite */
}

.node-type-output {
  border-left: 3px solid var(--pf-success, #16a34a);
}

.node-type-input {
  border-left: 3px solid var(--pf-ink-soft);
}

.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
}

.node-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.node-remove {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--pf-ink-soft);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 50%;
  transition: all 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.node-remove:hover {
  background: var(--pf-danger, #dc2626);
  color: white;
}

.node-type-tag {
  padding: 0 12px 6px;
  font-size: 10px;
  color: var(--pf-ink-soft);
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.node-ports {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px 8px;
  gap: 8px;
}

.ports-column {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.ports-input {
  align-items: flex-start;
}

.ports-output {
  align-items: flex-end;
}

.port-empty {
  font-size: 10px;
  color: var(--pf-ink-soft);
  font-style: italic;
  height: 22px;
  display: flex;
  align-items: center;
}

.node-params {
  padding: 4px 12px 8px;
  font-size: 10px;
  color: var(--pf-ink-soft);
  font-family: 'JetBrains Mono', monospace;
  border-top: 1px dashed var(--pf-line);
  word-break: break-all;
}
</style>
