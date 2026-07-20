<script setup lang="ts">
/**
 * GraphToolbar(Step 27.1 / 27.12)— Graph Editor 顶部工具栏。
 *
 * 职责:
 * - 提供主要操作按钮:添加节点 / 自动布局 / Undo / Redo / 适应视图 / 编译 / 清空
 * - 显示 Graph 校验状态(节点数 / 边数 / 错误数)
 * - 显示当前 zoom 百分比(便于定位)
 * - 不显示节点添加按钮组(由 NodeMenu 替代,通过「添加节点」按钮触发)
 *
 * 与 NodeToolbar.vue 的关系:
 * - NodeToolbar 旧版:按 category 分组展示所有节点按钮(占空间大)
 * - GraphToolbar 新版:只一个「添加节点」按钮,触发 NodeMenu 浮层
 * - 旧版 NodeToolbar 保留(向后兼容),新版 GraphToolbar 是 Step 27 主用
 *
 * 设计:
 * - 紧凑横排(高度 ~44px)
 * - 文字按钮(非图标),与项目设计语言一致
 * - 状态指示用颜色(error=红 / warning=黄 / ok=绿)
 */

import { computed } from 'vue'

import { useGraphUIStore } from '@/graph/uiStore'
import { useGraphHistoryStore } from '@/graph/graphHistory'
import type { ValidationResult } from '@/graph/types'

interface Props {
  /** Graph 校验结果 */
  validation: ValidationResult
  /** 节点总数 */
  nodeCount: number
  /** 边总数 */
  edgeCount: number
  /** 是否可编译(valid) */
  canCompile: boolean
  /** 最近一次编译状态 */
  compileStatus: 'idle' | 'success' | 'error'
  /** 最近一次编译消息 */
  compileMessage: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 触发节点菜单(打开 NodeMenu) */
  openNodeMenu: []
  /** 自动布局 */
  autoLayout: []
  /** 适应视图 */
  fitView: []
  /** 编译并应用 */
  compile: []
  /** 清空所有节点 */
  clear: []
  /** 关闭编辑器 */
  close: []
}>()

const ui = useGraphUIStore()
const history = useGraphHistoryStore()

/** zoom 百分比显示(整数) */
const zoomPercent = computed(() => Math.round(ui.zoom * 100))

/** 校验状态文字 */
const statusText = computed(() => {
  if (props.validation.errors.length > 0) {
    return `${props.validation.errors.length} 错误`
  }
  if (props.validation.warnings.length > 0) {
    return `${props.validation.warnings.length} 警告`
  }
  return '校验通过'
})

const statusClass = computed(() => ({
  'status-text': true,
  'status-error': props.validation.errors.length > 0,
  'status-warning': props.validation.errors.length === 0 && props.validation.warnings.length > 0,
  'status-ok': props.validation.valid && props.validation.warnings.length === 0,
}))

/** 编译消息样式 */
const compileClass = computed(() => ({
  'compile-msg': true,
  [`status-${props.compileStatus}`]: true,
}))

function handleUndo() {
  history.undo()
}

function handleRedo() {
  history.redo()
}

function handleResetZoom() {
  ui.resetViewport()
}
</script>

<template>
  <div class="graph-toolbar">
    <!-- 左侧:主要操作 -->
    <div class="toolbar-left">
      <button
        class="btn btn-accent"
        data-tip="打开节点搜索菜单(或右键画布)"
        @click="emit('openNodeMenu')"
      >
        + 添加节点
      </button>
      <button
        class="btn btn-ghost"
        data-tip="自动布局(按拓扑层级排列)"
        :disabled="nodeCount === 0"
        @click="emit('autoLayout')"
      >
        自动布局
      </button>
      <button
        class="btn btn-ghost"
        data-tip="适应视图(快捷键 F)"
        :disabled="nodeCount === 0"
        @click="emit('fitView')"
      >
        适应视图
      </button>
    </div>

    <!-- 中间:Undo / Redo -->
    <div class="toolbar-mid">
      <button
        class="btn btn-ghost btn-icon"
        data-tip="撤销(Ctrl+Z)"
        :disabled="!history.canUndo"
        @click="handleUndo"
      >
        撤销
      </button>
      <button
        class="btn btn-ghost btn-icon"
        data-tip="重做(Ctrl+Shift+Z)"
        :disabled="!history.canRedo"
        @click="handleRedo"
      >
        重做
      </button>
    </div>

    <!-- 右侧:状态 + 编译 + 清空 -->
    <div class="toolbar-right">
      <span :class="statusClass" :data-tip="validation.errors.join('\n') + validation.warnings.join('\n')">
        {{ statusText }} · {{ nodeCount }} 节点 / {{ edgeCount }} 连接
      </span>
      <button
        class="btn btn-ghost"
        data-tip="重置缩放到 100%"
        @click="handleResetZoom"
      >
        {{ zoomPercent }}%
      </button>
      <button
        class="btn btn-ghost"
        data-tip="清空所有节点(不可撤销将丢失)"
        :disabled="nodeCount === 0"
        @click="emit('clear')"
      >
        清空
      </button>
      <button
        class="btn btn-accent"
        :disabled="!canCompile"
        data-tip="编译 Graph 为 RenderIR 并应用到画布"
        @click="emit('compile')"
      >
        编译并应用
      </button>
      <button
        class="btn btn-ghost close-btn"
        data-tip="关闭 Graph Editor"
        @click="emit('close')"
      >
        关闭
      </button>
    </div>
  </div>

  <!-- 编译消息条(独立一行,节省工具栏空间) -->
  <div v-if="compileMessage" class="compile-bar">
    <span :class="compileClass">{{ compileMessage }}</span>
  </div>
</template>

<style scoped>
.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--pf-surface);
  border-bottom: 1px solid var(--pf-line);
  flex-wrap: nowrap;
  min-height: 44px;
}

.toolbar-left,
.toolbar-mid,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-mid {
  margin-left: 8px;
  padding-left: 12px;
  border-left: 1px solid var(--pf-line);
}

.toolbar-right {
  margin-left: auto;
  gap: 8px;
}

.status-text {
  font-size: 11px;
  color: var(--pf-ink-soft);
  font-family: 'JetBrains Mono', monospace;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-error {
  color: var(--pf-danger, #dc2626);
}

.status-warning {
  color: var(--pf-warning, #d97706);
}

.status-ok {
  color: var(--pf-success, #16a34a);
}

.btn {
  padding: 5px 12px;
  font-size: 11px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  font-family: inherit;
  white-space: nowrap;
}

.btn-ghost {
  background: transparent;
  color: var(--pf-ink-soft);
  border: 1px solid var(--pf-line);
}

.btn-ghost:hover:not(:disabled) {
  border-color: var(--pf-ink-soft);
  color: var(--pf-ink);
}

.btn-ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-accent {
  background: var(--pf-accent);
  color: white;
}

.btn-accent:hover:not(:disabled) {
  background: var(--pf-accent-dark, #9c4a23);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(184, 92, 46, 0.25);
}

.btn-accent:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-icon {
  padding: 5px 10px;
}

.close-btn {
  margin-left: 4px;
}

.compile-bar {
  padding: 4px 12px;
  background: var(--pf-paper, #faf7f0);
  border-bottom: 1px solid var(--pf-line);
  font-size: 11px;
}

.compile-msg {
  font-family: 'JetBrains Mono', monospace;
}

.compile-bar .status-success {
  color: var(--pf-success, #16a34a);
}

.compile-bar .status-error {
  color: var(--pf-danger, #dc2626);
}

.compile-bar .status-idle {
  color: var(--pf-ink-soft);
}
</style>
