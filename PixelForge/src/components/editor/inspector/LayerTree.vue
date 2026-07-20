<script setup lang="ts">
import { computed } from 'vue'

import type { Layer } from '@/compiler/ir/renderIR'

interface Props {
  layers: Layer[]
  selectedLayerId: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  select: [layerId: string]
  toggleVisible: [layerId: string]
}>()

/** 把 layer.id 转成更友好的显示名 */
function displayName(layer: Layer): string {
  return layer.id
    .replace(/^layer_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** layer 状态指示器颜色 */
function statusColor(layer: Layer): string {
  if (!layer.visible) return 'var(--pf-ink-faint)'
  return 'var(--pf-accent)'
}

const layerCount = computed(() => props.layers.length)
</script>

<template>
  <div class="layer-tree">
    <div class="tree-head">
      <span class="tree-title">图层</span>
      <span class="tree-count">{{ layerCount }}</span>
    </div>
    <div class="tree-list">
      <div
        v-for="layer in props.layers"
        :key="layer.id"
        class="tree-node"
        :class="{ active: layer.id === props.selectedLayerId, hidden: !layer.visible }"
        @click="emit('select', layer.id)"
      >
        <button
          class="visibility-btn"
          :data-tip="layer.visible ? '隐藏图层' : '显示图层'"
          @click.stop="emit('toggleVisible', layer.id)"
        >
          <span class="visibility-dot" :style="{ background: statusColor(layer) }"></span>
        </button>
        <div class="node-label">
          <span class="node-name">{{ displayName(layer) }}</span>
          <span class="node-opcode">{{ layer.opcode }}</span>
        </div>
        <span class="node-blend" v-if="layer.blendMode && layer.blendMode !== 'normal'">
          {{ layer.blendMode }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layer-tree {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-lg);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 4px;
  border-bottom: 1px solid var(--pf-line);
}
.tree-title {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--pf-ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.tree-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink-muted);
  font-weight: 600;
}
.tree-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.tree-list::-webkit-scrollbar { width: 4px; }
.tree-list::-webkit-scrollbar-thumb { background: var(--pf-line-strong); border-radius: 999px; }

.tree-node {
  display: grid;
  grid-template-columns: 24px 1fr auto;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--pf-r-xs);
  cursor: pointer;
  transition: background 160ms ease;
}
.tree-node:hover { background: var(--pf-surface-soft); }
.tree-node.active {
  background: var(--pf-accent-soft);
  box-shadow: inset 2px 0 0 var(--pf-accent);
}
.tree-node.hidden .node-name { color: var(--pf-ink-faint); }

.visibility-btn {
  width: 20px;
  height: 20px;
  border: 0;
  background: transparent;
  border-radius: 999px;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: background 160ms ease;
}
.visibility-btn:hover { background: var(--pf-surface-sunk); }
.visibility-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  transition: background 160ms ease;
}

.node-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.node-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--pf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.node-opcode {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  color: var(--pf-ink-muted);
  letter-spacing: 0.02em;
}

.node-blend {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  color: var(--pf-ink-muted);
  padding: 1px 6px;
  background: var(--pf-surface-soft);
  border-radius: 999px;
}

[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%) scale(0.95);
  padding: 5px 10px;
  background: var(--pf-ink);
  color: var(--pf-paper);
  font-size: 11px;
  border-radius: 7px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) scale(1); }
</style>
