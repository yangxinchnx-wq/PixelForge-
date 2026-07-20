<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useTimelineStore } from '@/stores/timeline'

interface Frame {
  frame: number
  render: string
  status: 'ok' | 'err'
  note: string
}

interface Props {
  frames: Frame[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  select: [frame: number]
  seek: [frame: number]
}>()

const timeline = useTimelineStore()

const rulerRef = ref<HTMLElement | null>(null)
const thumbRow = ref<HTMLElement | null>(null)

/** 标尺刻度:每 30 帧一个主刻度(0, 30, 60, ..., totalFrames) */
const ticks = computed(() => {
  const step = 30
  const arr: number[] = []
  for (let f = 0; f <= timeline.totalFrames; f += step) {
    arr.push(f)
  }
  return arr
})

/** 帧号 → 标尺百分比位置 */
function frameToPercent(frame: number): number {
  if (timeline.totalFrames <= 0) return 0
  return (frame / timeline.totalFrames) * 100
}

function onSelect(frame: number) {
  emit('select', frame)
}

/** 根据鼠标位置计算帧号并 seek(点击 / 拖动共用) */
function seekFromEvent(event: MouseEvent) {
  if (!rulerRef.value) return
  const rect = rulerRef.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const frame = Math.round((x / rect.width) * timeline.totalFrames)
  timeline.seek(frame)
  emit('seek', frame)
}

/** 标尺按下:立即跳到点击位置,并支持拖动持续 seek */
function onRulerMouseDown(event: MouseEvent) {
  event.preventDefault()
  seekFromEvent(event)

  const onMove = (e: MouseEvent) => seekFromEvent(e)
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function onWheel(event: WheelEvent) {
  if (!thumbRow.value) return
  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  if (delta === 0) return
  event.preventDefault()
  const factor = event.shiftKey ? 2.4 : 1.4
  thumbRow.value.scrollLeft += delta * factor
}

onMounted(() => {
  thumbRow.value?.addEventListener('wheel', onWheel, { passive: false })
})

onBeforeUnmount(() => {
  thumbRow.value?.removeEventListener('wheel', onWheel)
})
</script>

<template>
  <div class="timeline">
    <div class="timeline-head">
      <span>时间轴</span>
      <span>
        <strong>{{ timeline.currentFrame }}</strong> / {{ timeline.totalFrames }} 帧
        · {{ timeline.fps }} FPS
        · 共 <strong>{{ props.frames.length }}</strong> 条记录
      </span>
    </div>

    <!-- 标尺 + 播放头 -->
    <div
      ref="rulerRef"
      class="ruler"
      @mousedown="onRulerMouseDown"
    >
      <div
        v-for="tick in ticks"
        :key="tick"
        class="ruler-tick"
        :style="{ left: frameToPercent(tick) + '%' }"
      >
        <div class="tick-mark"></div>
        <div class="tick-label">{{ tick }}</div>
      </div>
      <div class="playhead" :style="{ left: timeline.playheadPercent + '%' }">
        <div class="playhead-handle"></div>
      </div>
    </div>

    <!-- 缩略图条(历史渲染记录) -->
    <div ref="thumbRow" class="thumb-row">
      <div
        v-for="f in props.frames"
        :key="f.frame"
        class="thumb"
        :data-tip="'帧 ' + f.frame + ' · ' + f.note"
        @click="onSelect(f.frame)"
      >
        <div class="thumb-render" :class="f.render"></div>
        <span class="thumb-status" :class="{ err: f.status === 'err' }"></span>
        <span class="thumb-label">{{ f.frame }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xl);
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.timeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--pf-ink-muted);
}
.timeline-head strong {
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink);
  font-weight: 600;
}

/* —— 标尺 —— */
.ruler {
  position: relative;
  height: 40px;
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-sm);
  border: 1px solid var(--pf-line);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
}
.ruler-tick {
  position: absolute;
  top: 0;
  bottom: 0;
  transform: translateX(-50%);
  pointer-events: none;
}
.tick-mark {
  position: absolute;
  top: 0;
  left: 50%;
  width: 1px;
  height: 8px;
  background: var(--pf-line-strong);
  transform: translateX(-50%);
}
.tick-label {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-muted);
  white-space: nowrap;
}

/* —— 播放头 —— */
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--pf-accent);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 3;
  transition: left 60ms linear;
}
.playhead-handle {
  position: absolute;
  top: -3px;
  left: 50%;
  width: 10px;
  height: 10px;
  background: var(--pf-accent);
  border: 2px solid var(--pf-surface);
  border-radius: 999px;
  transform: translateX(-50%);
  box-shadow: 0 2px 4px rgba(184, 92, 46, 0.4);
}

/* —— 缩略图条 —— */
.thumb-row {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 2px 0 4px;
  scroll-behavior: smooth;
}
.thumb-row::-webkit-scrollbar { height: 6px; }
.thumb-row::-webkit-scrollbar-track { background: transparent; }
.thumb-row::-webkit-scrollbar-thumb {
  background: var(--pf-line-strong);
  border-radius: 999px;
}
.thumb {
  flex: 0 0 auto;
  width: 88px;
  height: 52px;
  border-radius: var(--pf-r-sm);
  background: #0d0c10;
  border: 1px solid var(--pf-line);
  overflow: hidden;
  position: relative;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 2px 6px rgba(20, 18, 14, 0.08);
}
.thumb-render { position: absolute; inset: 0; }
.thumb-render.g1 { background:
  radial-gradient(circle at 22% 28%, rgba(255, 200, 90, 0.5), transparent 0 32%),
  radial-gradient(circle at 78% 22%, rgba(90, 130, 220, 0.55), transparent 0 30%),
  linear-gradient(135deg, #0e1a2a 0%, #08070a 100%);
}
.thumb-render.g2 { background:
  radial-gradient(circle at 30% 40%, rgba(255, 180, 90, 0.5), transparent 0 32%),
  radial-gradient(circle at 70% 70%, rgba(180, 100, 200, 0.55), transparent 0 30%),
  linear-gradient(135deg, #1a0e1a 0%, #08070a 100%);
}
.thumb-render.g3 { background: linear-gradient(135deg, #c47a1a 0%, #8a4a14 100%); }
.thumb-render.g4 { background:
  radial-gradient(circle at 50% 50%, rgba(240, 200, 90, 0.9), transparent 0 35%),
  linear-gradient(135deg, #1a1612 0%, #08070a 100%);
}
.thumb-render.g5 { background:
  radial-gradient(circle at 22% 28%, rgba(255, 180, 130, 0.42), transparent 0 32%),
  radial-gradient(circle at 78% 22%, rgba(90, 130, 220, 0.45), transparent 0 30%),
  radial-gradient(circle at 50% 80%, rgba(220, 160, 90, 0.36), transparent 0 34%),
  linear-gradient(135deg, #0e1a2a 0%, #1a0e1a 50%, #08070a 100%);
}
.thumb-render.g6 { background:
  radial-gradient(circle at 50% 50%, rgba(180, 220, 160, 0.55), transparent 0 40%),
  linear-gradient(135deg, #0a141a 0%, #060808 100%);
}
.thumb-render.g7 { background:
  radial-gradient(circle at 35% 50%, rgba(220, 80, 100, 0.5), transparent 0 30%),
  radial-gradient(circle at 65% 50%, rgba(80, 160, 220, 0.5), transparent 0 30%),
  linear-gradient(135deg, #14101a 0%, #08070a 100%);
}
.thumb-render.g8 { background:
  radial-gradient(circle at 50% 45%, rgba(240, 200, 100, 0.85), transparent 0 28%),
  linear-gradient(135deg, #2a1a0e 0%, #0e0806 100%);
}
.thumb-render.g9 { background:
  radial-gradient(circle at 50% 50%, rgba(120, 180, 240, 0.7), transparent 0 32%),
  linear-gradient(135deg, #0e1418 0%, #060808 100%);
}
.thumb-render.g10 { background: linear-gradient(135deg, #2a3a4a 0%, #0a1018 100%); }
.thumb-label {
  position: absolute;
  bottom: 3px;
  left: 5px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  z-index: 2;
}
.thumb-status {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--pf-success);
  z-index: 2;
}
.thumb-status.err { background: var(--pf-danger); }
.thumb:hover {
  transform: translateY(-2px) scale(1.06);
  box-shadow: 0 6px 14px rgba(20, 18, 14, 0.2);
  z-index: 5;
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
