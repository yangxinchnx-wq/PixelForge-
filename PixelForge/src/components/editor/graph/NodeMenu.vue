<script setup lang="ts">
/**
 * NodeMenu(Step 27.11)— 节点搜索菜单(右键 / Tab 触发)。
 *
 * 职责:
 * - 在 ui.nodeMenuPosition 处显示浮层
 * - 提供搜索框(autofocus),按 key / label / description 过滤 NodeRegistry
 * - 点击节点条目 → emit createNode(key, screenPos)
 * - Esc / 点击外部 → 关闭
 *
 * 设计:
 * - 紧凑浮层(宽 240px,最大高 320px,超出滚动)
 * - 按 category 分组显示(背景 / 形状 / 效果 / 合成 / 输出)
 * - 文字标签(非图标),与项目设计语言一致
 * - 平滑 fade-in + 轻微 scale(0.96 → 1,与项目 iOS 风格一致)
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { useGraphUIStore } from '@/graph/uiStore'
import {
  listNodeKeysByCategory,
  type NodeDefinition,
  type NodeRegistryKey,
} from '@/graph/nodeRegistry'
import { NodeRegistry } from '@/graph/nodeRegistry'

const ui = useGraphUIStore()

const emit = defineEmits<{
  /** 用户选中节点 key,在 screenPos 处创建 */
  createNode: [key: NodeRegistryKey, screenPos: { x: number; y: number }]
}>()

const searchInput = ref<HTMLInputElement | null>(null)

/** 类别中文标签 */
const categoryLabels: Record<string, string> = {
  background: '背景',
  shape: '形状',
  effect: '效果',
  composite: '合成',
  output: '输出',
}

/** 全部节点定义(按 category 分组) */
const allGrouped = computed(() => {
  const groups = listNodeKeysByCategory()
  const result: Array<{ category: string; label: string; items: NodeDefinition[] }> = []
  for (const [category, keys] of Object.entries(groups)) {
    const items = keys.map((k) => NodeRegistry[k])
    result.push({
      category,
      label: categoryLabels[category] ?? category,
      items,
    })
  }
  return result
})

/** 过滤后的分组(按 searchQuery 匹配 key / label / description) */
const filteredGroups = computed(() => {
  const q = ui.searchQuery.trim().toLowerCase()
  if (!q) return allGrouped.value
  return allGrouped.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        return (
          item.key.toLowerCase().includes(q) ||
          item.label.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.type.toLowerCase().includes(q)
        )
      }),
    }))
    .filter((group) => group.items.length > 0)
})

/** 是否有匹配结果 */
const hasResults = computed(() => filteredGroups.value.length > 0)

/** 菜单样式(定位到 ui.nodeMenuPosition) */
const menuStyle = computed(() => ({
  left: `${ui.nodeMenuPosition.x}px`,
  top: `${ui.nodeMenuPosition.y}px`,
}))

/** 选中节点条目 → emit createNode */
function handleSelect(key: NodeRegistryKey): void {
  emit('createNode', key, { ...ui.nodeMenuPosition })
  ui.closeNodeMenu()
}

/** 点击外部关闭 */
function handleOutsideClick(e: MouseEvent): void {
  const target = e.target as HTMLElement
  if (!target.closest('.node-menu')) {
    ui.closeNodeMenu()
  }
}

/** Esc 关闭(由 useGraphShortcuts 也会触发,这里冗余处理菜单内 Esc) */
function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && ui.nodeMenuVisible) {
    e.stopPropagation()
    ui.closeNodeMenu()
  }
}

/** 菜单显示时:autofocus 搜索框 + 注册全局点击/键盘监听 */
watch(
  () => ui.nodeMenuVisible,
  async (visible) => {
    if (visible) {
      await nextTick()
      searchInput.value?.focus()
      window.addEventListener('mousedown', handleOutsideClick, true)
      window.addEventListener('keydown', handleKeydown, true)
    } else {
      window.removeEventListener('mousedown', handleOutsideClick, true)
      window.removeEventListener('keydown', handleKeydown, true)
    }
  },
)

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', handleOutsideClick, true)
  window.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <Transition name="menu-pop">
    <div
      v-if="ui.nodeMenuVisible"
      class="node-menu"
      :style="menuStyle"
      @mousedown.stop
    >
      <!-- 搜索框 -->
      <div class="menu-search">
        <input
          ref="searchInput"
          v-model="ui.searchQuery"
          type="text"
          placeholder="搜索节点(如:Noise / 模糊 / 输出)"
          class="search-input"
          spellcheck="false"
          autocomplete="off"
        />
      </div>

      <!-- 节点列表(按 category 分组) -->
      <div class="menu-list">
        <template v-if="hasResults">
          <div
            v-for="group in filteredGroups"
            :key="group.category"
            class="menu-group"
          >
            <div class="group-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :key="item.key"
              class="menu-item"
              :data-tip="item.description"
              @click="handleSelect(item.key as NodeRegistryKey)"
            >
              <span class="item-name">{{ item.label }}</span>
              <span class="item-key">{{ item.key }}</span>
            </button>
          </div>
        </template>
        <div v-else class="menu-empty">无匹配节点</div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.node-menu {
  position: absolute;
  width: 240px;
  max-height: 320px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-md, 10px);
  box-shadow: 0 8px 24px rgba(20, 18, 14, 0.14);
  z-index: 950;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.menu-search {
  padding: 8px;
  border-bottom: 1px solid var(--pf-line);
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  background: var(--pf-paper, #faf7f0);
  border: 1px solid var(--pf-line);
  border-radius: 6px;
  color: var(--pf-ink);
  outline: none;
  transition: border-color 150ms cubic-bezier(0.22, 1, 0.36, 1);
  font-family: inherit;
}

.search-input:focus {
  border-color: var(--pf-accent);
}

.menu-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.menu-group {
  margin-bottom: 4px;
}

.group-label {
  font-size: 10px;
  color: var(--pf-ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 6px 8px 2px;
  font-weight: 600;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1);
  font-family: inherit;
}

.menu-item:hover {
  background: rgba(184, 92, 46, 0.08);
}

.item-name {
  font-size: 12px;
  color: var(--pf-ink);
  font-weight: 500;
}

.item-key {
  font-size: 10px;
  color: var(--pf-ink-soft);
  font-family: 'JetBrains Mono', monospace;
}

.menu-empty {
  padding: 16px;
  font-size: 11px;
  color: var(--pf-ink-soft);
  text-align: center;
  font-style: italic;
}

/* —— 过渡:fade-in + 轻微 scale —— */
.menu-pop-enter-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.menu-pop-leave-active {
  transition: transform 120ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.menu-pop-enter-from {
  transform: scale(0.96) translateY(-4px);
  opacity: 0;
}

.menu-pop-leave-to {
  transform: scale(0.98);
  opacity: 0;
}
</style>
