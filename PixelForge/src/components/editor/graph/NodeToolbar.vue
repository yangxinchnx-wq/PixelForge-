<script setup lang="ts">
/**
 * NodeToolbar(Step 25.8)— 节点添加工具栏。
 *
 * 职责:
 * - 按 category 分组展示所有可添加的节点
 * - 点击节点 key → emit addNode(key)
 * - 显示 Graph 校验状态(valid / error count / warning count)
 * - 提供「编译并应用」按钮(emit compile)
 * - 提供「清空」按钮(emit clear)
 *
 * 设计:
 * - 紧凑横排(高度 ~48px),不占太多画布空间
 * - 用文字标签(非图标),与项目设计语言一致
 * - 简单下拉式分组,不影响其他界面元素
 */

import { computed } from 'vue'
import type { ValidationResult } from '@/graph/types'
import { listNodeKeysByCategory, type NodeRegistryKey } from '@/graph/nodeRegistry'

interface Props {
  validation: ValidationResult
  /** 节点总数 */
  nodeCount: number
  /** 边总数 */
  edgeCount: number
  /** 是否可编译(valid) */
  canCompile: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  addNode: [key: NodeRegistryKey]
  compile: []
  clear: []
}>()

const groupedKeys = computed(() => listNodeKeysByCategory())

const categoryLabels: Record<string, string> = {
  background: '背景',
  shape: '形状',
  effect: '效果',
  composite: '合成',
  output: '输出',
}

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
</script>

<template>
  <div class="node-toolbar">
    <!-- 节点添加按钮组(按 category 分组) -->
    <div class="toolbar-group" v-for="(keys, category) in groupedKeys" :key="category">
      <span class="group-label">{{ categoryLabels[category] ?? category }}</span>
      <button
        v-for="key in keys"
        :key="key"
        class="node-add-btn"
        :data-tip="`添加 ${key} 节点`"
        @click="emit('addNode', key)"
      >
        {{ key }}
      </button>
    </div>

    <!-- 右侧:状态 + 操作 -->
    <div class="toolbar-actions">
      <span :class="statusClass" :data-tip="validation.errors.join('\n') + validation.warnings.join('\n')">
        {{ statusText }} · {{ nodeCount }} 节点 / {{ edgeCount }} 连接
      </span>
      <button class="btn btn-ghost" data-tip="清空所有节点" @click="emit('clear')">清空</button>
      <button
        class="btn btn-accent"
        :disabled="!canCompile"
        data-tip="编译 Graph 为 RenderIR 并应用到画布"
        @click="emit('compile')"
      >
        编译并应用
      </button>
    </div>
  </div>
</template>

<style scoped>
.node-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  background: var(--pf-surface);
  border-bottom: 1px solid var(--pf-line);
  flex-wrap: wrap;
  min-height: 48px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.group-label {
  font-size: 10px;
  color: var(--pf-ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-right: 4px;
  font-weight: 600;
}

.node-add-btn {
  padding: 4px 10px;
  font-size: 11px;
  background: transparent;
  border: 1px solid var(--pf-line);
  color: var(--pf-ink);
  border-radius: 999px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  font-family: 'JetBrains Mono', monospace;
}

.node-add-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
  background: rgba(184, 92, 46, 0.06);
}

.toolbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-text {
  font-size: 11px;
  color: var(--pf-ink-soft);
  font-family: 'JetBrains Mono', monospace;
  max-width: 280px;
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
}

.btn-ghost {
  background: transparent;
  color: var(--pf-ink-soft);
  border: 1px solid var(--pf-line);
}

.btn-ghost:hover {
  border-color: var(--pf-ink-soft);
  color: var(--pf-ink);
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
</style>
