<script setup lang="ts">
/**
 * ProTimelineClip(Step 31.2 / 31.4)— 时间轴片段块。
 *
 * 交互:
 * - 中间拖动(move):平移 timelineStart(若多选则批量平移)
 * - 左边缘 8px 拖动(trim-left):修改 timelineStart + duration
 * - 右边缘 8px 拖动(trim-right):修改 duration
 * - 单击:选中(replace 模式)
 * - Ctrl+单击:切换选中(toggle 模式)
 * - Shift+单击:追加选中(add 模式)
 * - 右键:打开上下文菜单
 *
 * 状态:
 * - preview: 拖拽过程中的预览 Clip(本地状态)
 * - 正常显示时使用 props.clip
 *
 * Step 31.4 增强:
 * - 多选高亮(selected + 多选框样式)
 * - 群组颜色边框(同 groupId 的 Clip 显示一致颜色边框)
 * - 拖拽时若属于多选,只 move 模式生效(trim 不多选)
 */
import { computed } from 'vue'

import type { Time } from '@/editor/timeline/core/time'
import { toSeconds, formatTimecode } from '@/editor/timeline/core/time'
import type { Clip } from '@/editor/timeline/core/clip'
import { getClipEnd, isNestedSequenceClip } from '@/editor/timeline/core/clip'
import type { ProTimelineLayout } from './useProTimelineLayout'
import type { DragKind } from './useClipDrag'
import type { SelectionMode } from '@/editor/timeline/store/selectionStore'

interface Props {
  clip: Clip
  /** 拖拽预览 Clip(若当前 Clip 正在拖拽) */
  previewClip?: Clip | null
  trackId: string
  layout: ProTimelineLayout
  fps: number
  isSelected: boolean
  isPrimary: boolean
  isDragging: boolean
  isSnapping: boolean
  /** 吸附高亮目标时间 */
  snapTime: Time | null
  /** 群组颜色(同 groupId 的 Clip 共享一个色;null 表示无群组) */
  groupColor?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'begin-drag': [kind: DragKind, clip: Clip, trackId: string, startContentX: number]
  'select': [mode: SelectionMode]
  'context-menu': [event: MouseEvent]
  'enter-nested': [clipId: string]
}>()

const displayClip = computed(() => props.previewClip ?? props.clip)

/** 是否为嵌套 Sequence Clip(双击可进入子 Sequence 编辑) */
const isNestedClip = computed(() => isNestedSequenceClip(displayClip.value))

const leftPx = computed(() => props.layout.timeToContentX(displayClip.value.timelineStart))
const widthPx = computed(() => {
  const durSec = toSeconds(displayClip.value.duration)
  return Math.max(2, durSec * props.layout.pixelsPerSecond.value)
})

const kindLabel = computed(() => {
  switch (displayClip.value.kind) {
    case 'video': return '视频'
    case 'audio': return '音频'
    case 'image': return '图片'
    case 'text': return '文字'
    case 'effect': return '特效'
    default: return '片段'
  }
})

const label = computed(() => {
  const c = displayClip.value
  const assetTag = c.assetId.slice(0, 8)
  const custom = c.label?.trim()
  return custom || `${kindLabel.value} ${assetTag}`
})

const startTc = computed(() => formatTimecode(displayClip.value.timelineStart, props.fps))
const endTc = computed(() => formatTimecode(getClipEnd(displayClip.value), props.fps))

const snapHighlight = computed(() => {
  if (!props.isSnapping || !props.snapTime) return false
  const snapX = props.layout.timeToContentX(props.snapTime)
  return Math.abs(snapX - leftPx.value) < 2 || Math.abs(snapX - (leftPx.value + widthPx.value)) < 2
})

function onClipMouseDown(event: MouseEvent) {
  if (event.button !== 0) return // 仅响应左键
  event.stopPropagation()

  // 根据修饰键判断选择模式
  let mode: SelectionMode = 'replace'
  if (event.ctrlKey || event.metaKey) mode = 'toggle'
  else if (event.shiftKey) mode = 'add'

  emit('select', mode)

  // 锁定的 clip 不响应拖拽
  if (displayClip.value.locked) return

  // 根据点击位置判断 drag 类型
  // 注:多选时只有 move 模式生效(trim 只针对单选主 clip)
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const localX = event.clientX - rect.left
  const edgeSize = 8
  let kind: DragKind
  if (localX < edgeSize && !props.isSelected) {
    kind = 'trim-left'
  } else if (localX > rect.width - edgeSize && !props.isSelected) {
    kind = 'trim-right'
  } else {
    kind = 'move'
  }

  // 转换为内容坐标(鼠标 X 相对内容左边缘)
  const contentX = props.layout.timeToContentX(displayClip.value.timelineStart) + localX
  emit('begin-drag', kind, props.clip, props.trackId, contentX)
}

function onContextMenu(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  // 右键若未选中,先选中(单选)
  if (!props.isSelected) emit('select', 'replace')
  emit('context-menu', event)
}

// —— Step 31.7: 跨 Sequence 拖拽支持(HTML5 DnD)——
// 注:仅启动 drag,drop 处理在 SequenceBar 标签页上
// Alt + 拖拽 = 跨 Sequence 复制;普通拖拽到其他 Sequence 标签 = 移动
function onDragStart(event: DragEvent) {
  if (!event.dataTransfer) return
  // 不让 dragstart 干扰普通 mousedown(单击/拖动 trim)
  // 通过设置 effectAllowed + 数据
  const isCopy = event.altKey
  event.dataTransfer.effectAllowed = isCopy ? 'copy' : 'move'
  event.dataTransfer.setData('text/pf-clip-id', props.clip.id)
  event.dataTransfer.setData('text/pf-clip-kind', props.clip.kind)
  event.dataTransfer.setData('text/pf-clip-source-seq', '')
  // 注:source sequence 由 store 在 drop 时反查
  event.dataTransfer.setData('text/pf-cross-seq', isCopy ? 'copy' : 'move')
  // 隐藏默认拖拽预览的闪烁(浏览器原生处理)
  // 设置一个简单的数据,用于在 drop 时识别
}

// —— Step 31.8: 双击嵌套 Sequence Clip 进入子 Sequence 编辑 ——
function onDoubleClick(event: MouseEvent) {
  if (!isNestedClip.value) return
  event.stopPropagation()
  emit('enter-nested', props.clip.id)
}
</script>

<template>
  <div
    class="pro-clip"
    :class="{
      selected: isSelected,
      primary: isPrimary,
      dragging: isDragging,
      snap: snapHighlight,
      locked: displayClip.locked,
      disabled: !displayClip.enabled,
      grouped: !!groupColor,
      nested: isNestedClip,
    }"
    :style="{
      left: leftPx + 'px',
      width: widthPx + 'px',
      '--group-color': groupColor || 'transparent',
    }"
    draggable="true"
    :title="isNestedClip ? '双击进入子序列编辑' : undefined"
    @mousedown="onClipMouseDown"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
    @dragstart="onDragStart"
  >
    <div class="clip-resize-left" data-tip="拖动修剪左边缘"></div>
    <div class="clip-body">
      <div class="clip-label">{{ label }}</div>
      <div class="clip-tc">
        <span class="tc-start">{{ startTc }}</span>
        <span class="tc-sep">→</span>
        <span class="tc-end">{{ endTc }}</span>
      </div>
    </div>
    <div class="clip-resize-right" data-tip="拖动修剪右边缘"></div>
  </div>
</template>

<style scoped>
.pro-clip {
  position: absolute;
  top: 6px;
  bottom: 6px;
  display: flex;
  align-items: stretch;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  overflow: hidden;
  transition: box-shadow 180ms cubic-bezier(0.22, 1, 0.36, 1),
              border-color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.pro-clip:hover {
  border-color: var(--pf-accent);
  box-shadow: 0 2px 8px rgba(184, 92, 46, 0.12);
}
.pro-clip.selected {
  border-color: var(--pf-accent);
  background: var(--pf-accent-soft);
  box-shadow: 0 0 0 2px rgba(184, 92, 46, 0.25);
}
.pro-clip.primary {
  /* 主选中:加粗边框 + 更深阴影,与普通选中区分 */
  box-shadow: 0 0 0 3px rgba(184, 92, 46, 0.45);
  z-index: 3;
}
.pro-clip.grouped {
  /* 群组:顶部 3px 色条标识同群组 */
  border-top: 3px solid var(--group-color);
}
.pro-clip.nested {
  /* 嵌套 Sequence Clip:虚线边框 + 渐变背景,提示可双击进入 */
  border-style: dashed;
  border-color: var(--pf-accent);
  background: linear-gradient(135deg,
    var(--pf-surface) 0%,
    var(--pf-accent-soft) 100%);
  cursor: pointer;
}
.pro-clip.nested:hover {
  border-color: var(--pf-accent);
  box-shadow: 0 0 0 2px var(--pf-accent-soft);
}
.pro-clip.dragging {
  opacity: 0.85;
  cursor: grabbing;
  z-index: 5;
}
.pro-clip.snap {
  border-color: var(--pf-success);
  box-shadow: 0 0 0 2px rgba(74, 122, 62, 0.3);
}
.pro-clip.locked {
  cursor: not-allowed;
  opacity: 0.55;
}
.pro-clip.disabled {
  opacity: 0.35;
}

.clip-resize-left,
.clip-resize-right {
  width: 8px;
  background: var(--pf-line);
  cursor: ew-resize;
  flex-shrink: 0;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.clip-resize-left:hover,
.clip-resize-right:hover {
  background: var(--pf-accent);
}

.clip-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 6px;
  gap: 2px;
  overflow: hidden;
}
.clip-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--pf-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clip-tc {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: var(--pf-ink-muted);
  overflow: hidden;
  white-space: nowrap;
}
.tc-sep {
  color: var(--pf-ink-faint);
}
</style>
