<script setup lang="ts">
/**
 * ProTimelineTrackHeader(Step 31.3)— 轨道头(左侧固定列)。
 *
 * 增强内容(Step 31.3):
 * - 轨道颜色色块(可点击循环切换预设色)
 * - 拖拽手柄(可拖拽到其他轨道位置 reorder)
 * - 双击轨道名进入重命名编辑
 * - 颜色色块右键弹出菜单(复制/删除/重命名)
 * - 高度调整手柄(底部边缘)
 *
 * 显示:
 * - 轨道颜色色块
 * - 类型标签(视频/音频/字幕/特效)
 * - 轨道名(可双击编辑)
 * - 可见/锁定/静音开关(直接文字)
 * - 添加片段按钮
 */
import { computed, ref, nextTick, onBeforeUnmount } from 'vue'

import type { Track } from '@/editor/timeline/core/track'
import { TrackType } from '@/editor/timeline/core/track'

interface Props {
  track: Track
  hasActiveClip: boolean
  /** 是否正在被拖拽(高亮) */
  dragging?: boolean
  /** 是否是拖拽悬停目标(高亮) */
  dragOver?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-visible': []
  'toggle-locked': []
  'toggle-muted': []
  'add-clip': []
  'rename-track': [name: string]
  'set-color': [color: string]
  'delete-track': []
  'duplicate-track': []
  'start-reorder': []
  'reorder-over': []
  'reorder-drop': []
  'resize-start': []
}>()

// ============================================================================
// 1. 类型标签 + 颜色色块
// ============================================================================

const typeLabel = computed(() => {
  switch (props.track.type) {
    case TrackType.VIDEO: return '视频'
    case TrackType.AUDIO: return '音频'
    case TrackType.TEXT: return '字幕'
    case TrackType.EFFECT: return '特效'
    default: return '轨道'
  }
})

/** 可循环切换的预设颜色 */
const PRESET_COLORS = [
  '#5B8DEF', '#52C41A', '#FA8C16', '#722ED1',
  '#EB2F96', '#13C2C2', '#F5222D', '#FAAD14',
  '#A0D911', '#2F54EB', '#735EDE', '#FF85C0',
]

/** 点击颜色色块循环切换颜色 */
function cycleColor() {
  const idx = PRESET_COLORS.indexOf(props.track.color)
  const next = PRESET_COLORS[(idx + 1) % PRESET_COLORS.length]
  emit('set-color', next)
}

// ============================================================================
// 2. 重命名编辑(双击轨道名进入编辑态)
// ============================================================================

const isEditing = ref(false)
const editName = ref('')
const nameInputRef = ref<HTMLInputElement | null>(null)

function startEdit() {
  isEditing.value = true
  editName.value = props.track.name
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}

function commitEdit() {
  if (!isEditing.value) return
  const trimmed = editName.value.trim()
  if (trimmed && trimmed !== props.track.name) {
    emit('rename-track', trimmed)
  }
  isEditing.value = false
}

function cancelEdit() {
  isEditing.value = false
}

// ============================================================================
// 3. 右键菜单(删除/复制)
// ============================================================================

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  menuX.value = event.clientX
  menuY.value = event.clientY
  menuVisible.value = true
  window.addEventListener('mousedown', closeMenuOnOutside, true)
  window.addEventListener('keydown', onMenuEsc, true)
}

function closeMenuOnOutside() {
  if (menuVisible.value) {
    // 简化:任何 mousedown 都关闭
    menuVisible.value = false
    window.removeEventListener('mousedown', closeMenuOnOutside, true)
    window.removeEventListener('keydown', onMenuEsc, true)
  }
}

function onMenuEsc(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    menuVisible.value = false
    window.removeEventListener('mousedown', closeMenuOnOutside, true)
    window.removeEventListener('keydown', onMenuEsc, true)
  }
}

function emitAndCloseMenu(name: 'delete' | 'duplicate' | 'rename') {
  if (name === 'delete') emit('delete-track')
  else if (name === 'duplicate') emit('duplicate-track')
  else if (name === 'rename') startEdit()
  menuVisible.value = false
  window.removeEventListener('mousedown', closeMenuOnOutside, true)
  window.removeEventListener('keydown', onMenuEsc, true)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', closeMenuOnOutside, true)
  window.removeEventListener('keydown', onMenuEsc, true)
})

// ============================================================================
// 4. 拖拽 reorder(原生 HTML5 DnD,跨 track header 排序)
// ============================================================================

function onDragStart(event: DragEvent) {
  emit('start-reorder')
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    // 传递 track ID 用于 drop 时识别
    event.dataTransfer.setData('text/pf-track-id', props.track.id)
  }
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes('text/pf-track-id')) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    emit('reorder-over')
  }
}

function onDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('text/pf-track-id')) {
    event.preventDefault()
    emit('reorder-drop')
  }
}
</script>

<template>
  <div
    class="pro-track-header"
    :class="{
      locked: track.locked,
      muted: track.muted,
      dragging: dragging,
      'drag-over': dragOver,
    }"
    :style="{ height: track.height + 'px' }"
    @contextmenu="onContextMenu"
  >
    <!-- 顶部:颜色色块 + 类型 + 名字 -->
    <div class="header-top">
      <button
        class="color-swatch"
        :style="{ background: track.color }"
        data-tip="点击切换颜色"
        @click="cycleColor"
      ></button>
      <span class="track-type">{{ typeLabel }}</span>
      <span
        v-if="!isEditing"
        class="track-name"
        data-tip="双击重命名"
        @dblclick="startEdit"
      >{{ track.name }}</span>
      <input
        v-else
        ref="nameInputRef"
        v-model="editName"
        class="name-input"
        type="text"
        @blur="commitEdit"
        @keydown.enter="commitEdit"
        @keydown.esc="cancelEdit"
      />
    </div>

    <!-- 底部:开关 + 添加按钮 + 拖拽手柄 -->
    <div class="header-bottom">
      <button
        class="toggle-btn"
        :class="{ off: !track.visible }"
        data-tip="切换可见性"
        @click="emit('toggle-visible')"
      >{{ track.visible ? '可见' : '隐藏' }}</button>
      <button
        class="toggle-btn"
        :class="{ on: track.locked }"
        data-tip="切换锁定"
        @click="emit('toggle-locked')"
      >{{ track.locked ? '已锁' : '未锁' }}</button>
      <button
        v-if="track.type === 'audio'"
        class="toggle-btn"
        :class="{ off: track.muted }"
        data-tip="切换静音"
        @click="emit('toggle-muted')"
      >{{ track.muted ? '静音' : '有声' }}</button>
      <button
        class="add-btn"
        :class="{ active: hasActiveClip }"
        data-tip="在播放头位置添加片段"
        @click="emit('add-clip')"
      >+</button>
      <button
        class="drag-handle"
        data-tip="拖拽调整轨道顺序"
        draggable="true"
        @dragstart="onDragStart"
        @dragover="onDragOver"
        @drop="onDrop"
      >⋮⋮</button>
    </div>

    <!-- 底部高度调整手柄 -->
    <div
      class="resize-handle"
      data-tip="拖拽调整高度"
      @mousedown.prevent="emit('resize-start')"
    ></div>

    <!-- 右键菜单 -->
    <div
      v-if="menuVisible"
      class="track-context-menu"
      :style="{ left: menuX + 'px', top: menuY + 'px' }"
      @mousedown.stop
    >
      <button class="menu-item" @click="emitAndCloseMenu('rename')">
        <span class="item-label">重命名</span>
      </button>
      <button class="menu-item" @click="emitAndCloseMenu('duplicate')">
        <span class="item-label">复制轨道</span>
      </button>
      <div class="menu-divider"></div>
      <button class="menu-item danger" @click="emitAndCloseMenu('delete')">
        <span class="item-label">删除轨道</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pro-track-header {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--pf-surface);
  border-right: 1px solid var(--pf-line);
  border-bottom: 1px solid var(--pf-line);
  flex-shrink: 0;
  width: 180px;
  box-sizing: border-box;
  position: relative;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.pro-track-header.locked {
  background: var(--pf-surface-soft);
}
.pro-track-header.muted {
  opacity: 0.65;
}
.pro-track-header.dragging {
  opacity: 0.5;
  box-shadow: 0 0 0 2px var(--pf-accent) inset;
}
.pro-track-header.drag-over {
  background: var(--pf-accent-soft);
  box-shadow: 0 0 0 2px var(--pf-accent) inset;
}

.header-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.color-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.18);
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.color-swatch:hover {
  transform: scale(1.2);
}
.track-type {
  font-size: 10px;
  font-weight: 600;
  color: var(--pf-ink-muted);
  padding: 1px 6px;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  letter-spacing: 0.05em;
  background: var(--pf-surface-soft);
  flex-shrink: 0;
}
.track-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--pf-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
  cursor: text;
}
.name-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-accent);
  border-radius: 3px;
  padding: 1px 4px;
  outline: none;
  font-family: 'JetBrains Mono', monospace;
}

.header-bottom {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.toggle-btn {
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink-soft);
  font-size: 10px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.toggle-btn:hover {
  border-color: var(--pf-line-strong);
}
.toggle-btn.off {
  color: var(--pf-ink-faint);
  background: var(--pf-surface-soft);
}
.toggle-btn.on {
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  border-color: var(--pf-accent);
}

.add-btn {
  margin-left: auto;
  width: 22px;
  height: 22px;
  border: 1px dashed var(--pf-line-strong);
  background: transparent;
  color: var(--pf-ink-muted);
  font-size: 14px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.add-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
  border-style: solid;
}
.add-btn.active {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
  background: var(--pf-accent-soft);
}

.drag-handle {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--pf-ink-faint);
  font-size: 12px;
  letter-spacing: -2px;
  cursor: grab;
  border-radius: 3px;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'JetBrains Mono', monospace;
}
.drag-handle:hover {
  color: var(--pf-ink);
  background: var(--pf-surface-soft);
}
.drag-handle:active {
  cursor: grabbing;
}

.resize-handle {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 4px;
  cursor: ns-resize;
  background: transparent;
  transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.resize-handle:hover {
  background: var(--pf-accent);
}

.track-context-menu {
  position: fixed;
  min-width: 140px;
  padding: 4px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: var(--pf-r-sm);
  box-shadow: 0 8px 24px rgba(30, 25, 20, 0.18);
  z-index: 1000;
  font-family: 'Inter', system-ui, sans-serif;
  animation: ctx-pop 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes ctx-pop {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
.track-context-menu .menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--pf-ink);
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1);
  text-align: left;
}
.track-context-menu .menu-item:hover {
  background: var(--pf-surface-soft);
}
.track-context-menu .menu-item.danger {
  color: var(--pf-danger);
}
.track-context-menu .menu-item.danger:hover {
  background: rgba(212, 75, 75, 0.08);
}
.track-context-menu .menu-divider {
  height: 1px;
  background: var(--pf-line);
  margin: 4px 0;
}
</style>
