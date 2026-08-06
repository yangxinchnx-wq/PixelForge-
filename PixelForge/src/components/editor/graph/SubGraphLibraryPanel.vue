<script setup lang="ts">
/**
 * SubGraphLibraryPanel(Step 40.6)— 子图库面板。
 *
 * 职责:
 * - 列出 graphStore.subgraphLibrary 中所有可复用子图定义
 * - 点击定义 → emit addToCanvas(defId):在画布视口中心生成一个 SUBGRAPH 节点
 * - 删除按钮 → emit remove(defId):删除定义并级联删除引用它的节点
 * - 展示每个子图的节点数 / 输入端口数 / 输出端口数摘要
 *
 * 设计:
 * - 固定宽度左停靠栏(220px),作为 GraphEditor 浮层内部左侧面板
 * - 不改动 App.vue 主布局
 * - 空库时显示引导提示
 */

import { computed } from 'vue'

import { useGraphStore } from '@/graph/graphStore'
import type { SubGraphDefinition } from '@/graph/types'

const graph = useGraphStore()

const emit = defineEmits<{
  /** 将某子图定义实例化到画布 */
  addToCanvas: [defId: string]
  /** 删除某子图定义 */
  remove: [defId: string]
}>()

const definitions = computed<SubGraphDefinition[]>(() => graph.subgraphLibrary)

function summary(def: SubGraphDefinition): string {
  return `${def.nodes.length} 节点 · ${def.inputPorts.length} 入 / ${def.outputPorts.length} 出`
}

function handleAdd(def: SubGraphDefinition): void {
  emit('addToCanvas', def.id)
}

function handleRemove(def: SubGraphDefinition): void {
  emit('remove', def.id)
}
</script>

<template>
  <aside class="subgraph-panel">
    <header class="panel-header">
      <span class="panel-title">子图库</span>
      <span class="panel-count">{{ definitions.length }}</span>
    </header>

    <div v-if="definitions.length === 0" class="panel-empty">
      <p>还没有子图。</p>
      <p class="panel-empty-hint">
        在画布中选中若干节点，点击工具栏「打包为子图」即可创建一个可复用子图。
      </p>
    </div>

    <ul v-else class="panel-list">
      <li
        v-for="def in definitions"
        :key="def.id"
        class="panel-item"
        :data-tip="def.description"
        @click="handleAdd(def)"
      >
        <div class="item-main">
          <span class="item-name">{{ def.name }}</span>
          <span class="item-summary">{{ summary(def) }}</span>
        </div>
        <button
          class="item-remove"
          data-tip="删除子图定义(同时移除引用它的节点)"
          @click.stop="handleRemove(def)"
        >
          ×
        </button>
      </li>
    </ul>

    <footer class="panel-footer">点击子图 → 在画布生成实例</footer>
  </aside>
</template>

<style scoped>
.subgraph-panel {
  width: 220px;
  flex: 0 0 220px;
  display: flex;
  flex-direction: column;
  background: var(--base-bg);
  border-right: 1px solid var(--separator);
  min-height: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--separator);
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-count {
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
  background: var(--glass-bg);
  border: 1px solid var(--separator);
  border-radius: 999px;
  padding: 1px 8px;
}

.panel-empty {
  padding: 16px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.panel-empty-hint {
  margin-top: 8px;
  opacity: 0.8;
}

.panel-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.panel-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-lg);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 160ms cubic-bezier(0.22, 1, 0.36, 1);
}

.panel-item:hover {
  background: var(--glass-bg);
  border-color: var(--separator);
}

.item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-summary {
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
}

.item-remove {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  border-radius: 50%;
  transition: all 150ms cubic-bezier(0.22, 1, 0.36, 1);
}

.item-remove:hover {
  background: var(--toggle-mute);
  color: white;
}

.panel-footer {
  padding: 6px 12px;
  font-size: 10px;
  color: var(--text-secondary);
  border-top: 1px solid var(--separator);
  opacity: 0.8;
}
</style>
