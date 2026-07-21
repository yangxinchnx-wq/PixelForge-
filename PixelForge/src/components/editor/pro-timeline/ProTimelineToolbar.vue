<script setup lang="ts">
/**
 * ProTimelineToolbar(Step 31.2)— 专业时间轴工具栏。
 *
 * 包含:
 * - 播放控制(跳到开头 / 上一帧 / 播放暂停 / 下一帧 / 跳到末尾 / 停止)
 * - 撤销 / 重做(对接 useProTimelineStore 的 history)
 * - 速度 / FPS
 * - 缩放控制(缩小 / 缩放百分比 / 放大 / 适应)
 * - 添加轨道(Video / Audio)
 * - 添加 Clip 按钮
 * - 时间码显示(当前时间 / 总时长)
 *
 * 设计:
 * - 中文文字标签,无纯图标
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 与 AnimationTimeline 工具栏风格一致
 */
import { computed } from 'vue'

import type { TrackType } from '@/editor/timeline/core/track'

interface Props {
  isPlaying: boolean
  currentTime: string
  durationTime: string
  currentFrame: number
  totalFrames: number
  fps: number
  speed: number
  canUndo: boolean
  canRedo: boolean
  zoomPct: number
  clipCount: number
  trackCount: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'jump-start': []
  'step-backward': []
  'toggle-play': []
  'step-forward': []
  'jump-end': []
  stop: []
  undo: []
  redo: []
  'add-track': [type: TrackType]
  'add-clip': []
  'zoom-out': []
  'zoom-in': []
  'zoom-fit': []
  'update:fps': [fps: number]
  'update:speed': [speed: number]
}>()

const fpsOptions = [24, 25, 30, 60, 120]
const speedOptions = [0.25, 0.5, 1, 1.5, 2, 4]

const statusText = computed(() => {
  if (props.isPlaying) return '播放中'
  if (props.currentFrame >= props.totalFrames && props.totalFrames > 0) return '已结束'
  return '已暂停'
})

function onFpsChange(event: Event) {
  const v = parseInt((event.target as HTMLSelectElement).value, 10)
  if (Number.isFinite(v) && v > 0) emit('update:fps', v)
}

function onSpeedChange(event: Event) {
  const v = parseFloat((event.target as HTMLSelectElement).value)
  if (Number.isFinite(v)) emit('update:speed', v)
}
</script>

<template>
  <header class="ptl-toolbar">
    <div class="ptl-title">
      <span class="title-zh">专业时间轴</span>
      <sub class="title-sub">{{ trackCount }} 条轨道 · {{ clipCount }} 个片段</sub>
    </div>

    <div class="ptl-controls">
      <button class="ptl-btn" data-tip="跳到开头(Home)" @click="emit('jump-start')">|◀</button>
      <button class="ptl-btn" data-tip="上一帧(←)" @click="emit('step-backward')">◀</button>
      <button
        class="ptl-btn primary"
        :data-tip="isPlaying ? '暂停(空格)' : '播放(空格)'"
        @click="emit('toggle-play')"
      >
        <span v-if="isPlaying">暂停</span>
        <span v-else>播放</span>
      </button>
      <button class="ptl-btn" data-tip="下一帧(→)" @click="emit('step-forward')">▶</button>
      <button class="ptl-btn" data-tip="跳到末尾(End)" @click="emit('jump-end')">▶|</button>
      <button class="ptl-btn" data-tip="停止(回到开头)" @click="emit('stop')">■</button>

      <span class="divider"></span>

      <button
        class="ptl-btn"
        :disabled="!canUndo"
        data-tip="撤销(Ctrl+Z)"
        @click="emit('undo')"
      >撤销</button>
      <button
        class="ptl-btn"
        :disabled="!canRedo"
        data-tip="重做(Ctrl+Y)"
        @click="emit('redo')"
      >重做</button>

      <span class="divider"></span>

      <button class="ptl-btn" data-tip="添加视频轨道" @click="emit('add-track', 'video' as TrackType)">+ 视频轨</button>
      <button class="ptl-btn" data-tip="添加音频轨道" @click="emit('add-track', 'audio' as TrackType)">+ 音频轨</button>
      <button class="ptl-btn primary" data-tip="在播放头位置添加片段" @click="emit('add-clip')">添加片段</button>
    </div>

    <div class="ptl-controls">
      <label class="field-label">
        速度
        <select class="field-select" :value="speed" @change="onSpeedChange">
          <option v-for="s in speedOptions" :key="s" :value="s">{{ s }}x</option>
        </select>
      </label>

      <label class="field-label">
        FPS
        <select class="field-select" :value="fps" @change="onFpsChange">
          <option v-for="f in fpsOptions" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>

      <span class="divider"></span>

      <button class="ptl-btn" data-tip="缩小(Ctrl+-)" @click="emit('zoom-out')">−</button>
      <span class="zoom-pct">{{ zoomPct }}%</span>
      <button class="ptl-btn" data-tip="放大(Ctrl+=)" @click="emit('zoom-in')">+</button>
      <button class="ptl-btn" data-tip="适应窗口" @click="emit('zoom-fit')">适应</button>
    </div>

    <div class="ptl-status">
      <span class="status-time">
        <strong>{{ currentTime }}</strong>
        <span class="time-sep">/</span>
        <span class="time-total">{{ durationTime }}</span>
      </span>
      <span class="status-pill" :class="{ playing: isPlaying }">{{ statusText }}</span>
    </div>
  </header>
</template>

<style scoped>
.ptl-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  flex-wrap: wrap;
  padding: 6px 0;
}
.ptl-title {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  margin-right: auto;
}
.title-zh {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
}
.title-sub {
  font-size: 10.5px;
  color: var(--pf-ink-muted);
  font-weight: 400;
}

.ptl-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.ptl-btn {
  height: 28px;
  min-width: 36px;
  padding: 0 10px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-size: 11.5px;
  font-weight: 500;
  border-radius: var(--pf-r-sm);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ptl-btn:hover:not(:disabled) {
  background: var(--pf-surface-sunk);
  border-color: var(--pf-line-strong);
}
.ptl-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.ptl-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ptl-btn.primary {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
  min-width: 56px;
  font-weight: 600;
}
.ptl-btn.primary:hover {
  filter: brightness(1.08);
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--pf-line);
  margin: 0 4px;
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--pf-ink-muted);
  user-select: none;
}
.field-select {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  border-radius: var(--pf-r-sm);
  cursor: pointer;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
  outline: none;
}
.field-select:hover {
  border-color: var(--pf-line-strong);
}
.field-select:focus {
  border-color: var(--pf-accent);
}

.zoom-pct {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink-muted);
  min-width: 44px;
  text-align: center;
  user-select: none;
}

.ptl-status {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.status-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--pf-ink);
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.status-time strong {
  font-weight: 600;
}
.time-sep {
  color: var(--pf-ink-faint);
}
.time-total {
  color: var(--pf-ink-muted);
  font-size: 11px;
}
.status-pill {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--pf-surface-soft);
  color: var(--pf-ink-muted);
  border: 1px solid var(--pf-line);
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.status-pill.playing {
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  border-color: var(--pf-accent);
}
</style>
