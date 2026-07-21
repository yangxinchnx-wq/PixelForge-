<script setup lang="ts">
/**
 * ProTimelineBreadcrumb(Step 31.8)— 嵌套 Sequence 编辑面包屑导航。
 *
 * 功能:
 * - 显示当前嵌套层级(根 > 父 > 当前)
 * - 点击任意层级跳转回去
 * - "返回上层"按钮(仅在嵌套时显示)
 * - 双击 Clip 进入子 Sequence 时自动显示
 *
 * 设计:
 * - 中文文字标签,层级间用 ">" 分隔
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - --pf-* 设计令牌
 * - 当前层高亮,可点击层带 hover 效果
 */
import { computed } from 'vue'
import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'

const store = useProTimelineStore()

const entries = computed(() => store.breadcrumbEntries)
const isNested = computed(() => store.isNestedEditing)
const depth = computed(() => store.nestedDepth)

function onClickLevel(level: number) {
  if (level === entries.value.length - 1) return // 已是当前层
  store.jumpToBreadcrumbLevel(level)
}

function onExit() {
  store.exitNestedSequence()
}
</script>

<template>
  <div v-if="entries.length > 0" class="breadcrumb-bar">
    <button
      v-if="isNested"
      class="exit-btn"
      title="返回上层(Esc)"
      @click="onExit"
    >
      ← 返回上层
    </button>

    <div class="breadcrumb-trail">
      <template v-for="(entry, idx) in entries" :key="entry.sequenceId">
        <button
          class="crumb"
          :class="{
            current: idx === entries.length - 1,
            clickable: idx < entries.length - 1,
          }"
          :title="idx === entries.length - 1 ? '当前序列' : `跳转到 ${entry.label}`"
          @click="onClickLevel(idx)"
        >
          {{ entry.label }}
        </button>
        <span v-if="idx < entries.length - 1" class="crumb-sep">›</span>
      </template>
    </div>

    <span v-if="isNested" class="depth-badge">嵌套层级 {{ depth }}</span>
  </div>
</template>

<style scoped>
.breadcrumb-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  background: var(--pf-surface-soft);
  border-bottom: 1px solid var(--pf-line);
  min-height: 32px;
  font-size: 12px;
}

.exit-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-sm);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-size: 11.5px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.exit-btn:hover {
  background: var(--pf-surface-sunk);
  border-color: var(--pf-line-strong);
}

.exit-btn:active {
  transform: scale(0.97);
}

.breadcrumb-trail {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

.breadcrumb-trail::-webkit-scrollbar {
  height: 2px;
}

.crumb {
  border: none;
  background: transparent;
  color: var(--pf-ink-muted);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: var(--pf-r-xs);
  cursor: default;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  white-space: nowrap;
}

.crumb.clickable {
  cursor: pointer;
}

.crumb.clickable:hover {
  background: var(--pf-surface-sunk);
  color: var(--pf-ink);
}

.crumb.current {
  color: var(--pf-accent);
  font-weight: 600;
  cursor: default;
}

.crumb-sep {
  color: var(--pf-ink-faint);
  font-size: 13px;
  user-select: none;
}

.depth-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--pf-accent);
  background: var(--pf-accent-soft);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--pf-accent);
  flex-shrink: 0;
}
</style>
