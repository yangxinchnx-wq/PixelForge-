<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Keyframe, ParameterTrack } from '@/editor/timeline/types'
import { useTimelineStore } from '@/stores/timeline'

import KeyframePoint from './KeyframePoint.vue'

interface Props {
  track: ParameterTrack
}

const props = defineProps<Props>()

const timeline = useTimelineStore()

const canvasRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)

/** 关键帧按 frame 排序后的副本(避免修改原数组顺序) */
const sortedKeyframes = computed(() =>
  [...props.track.keyframes].sort((a, b) => a.frame - b.frame),
)

/** 当前帧在轨道上的百分比位置(0-100) */
const playheadPercent = computed(() => timeline.playheadPercent)

/**
 * 构建 SVG 路径:按 easing 分段绘制
 * - linear: 直线 L
 * - ease:   三次贝塞尔 C(控制点在水平中点,形成 S 曲线)
 * - hold:   阶梯 L(先水平再垂直)
 */
const pathData = computed(() => {
  const keys = sortedKeyframes.value
  if (keys.length === 0) return ''
  const total = timeline.totalFrames
  if (total <= 0) return ''

  const x = (f: number) => (f / total) * 100
  const y = (v: number) => 100 - v * 100

  let d = `M ${x(keys[0].frame).toFixed(2)} ${y(keys[0].value).toFixed(2)}`
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1]
    const curr = keys[i]
    const x0 = x(prev.frame), y0 = y(prev.value)
    const x1 = x(curr.frame), y1 = y(curr.value)

    if (prev.easing === 'hold') {
      d += ` L ${x1.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)}`
    } else if (prev.easing === 'ease') {
      const cx = x0 + (x1 - x0) * 0.5
      d += ` C ${cx.toFixed(2)} ${y0.toFixed(2)} ${cx.toFixed(2)} ${y1.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`
    } else {
      d += ` L ${x1.toFixed(2)} ${y1.toFixed(2)}`
    }
  }
  return d
})

/** 是否为当前帧最近的关键帧(高亮显示) */
function isActive(kf: Keyframe): boolean {
  const current = timeline.currentFrame
  let nearest: Keyframe | undefined
  let minDist = Infinity
  for (const k of props.track.keyframes) {
    const d = Math.abs(k.frame - current)
    if (d < minDist) {
      minDist = d
      nearest = k
    }
  }
  return nearest?.id === kf.id
}

function frameToPercent(frame: number): string {
  if (timeline.totalFrames <= 0) return '0%'
  return (frame / timeline.totalFrames) * 100 + '%'
}

function valueToPercent(value: number): string {
  return (1 - value) * 100 + '%'
}

/** 关键帧拖动:mousedown 进入拖动模式,window 监听 mousemove/mouseup */
function onKeyframeMouseDown(kf: Keyframe, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  draggingId.value = kf.id

  const onMove = (e: MouseEvent) => {
    if (!canvasRef.value) return
    const rect = canvasRef.value.getBoundingClientRect()
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const yPct = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    const frame = Math.round(xPct * timeline.totalFrames)
    const value = Math.round((1 - yPct) * 100) / 100
    timeline.updateKeyframe(props.track.id, kf.id, frame, value)
  }

  const onUp = () => {
    draggingId.value = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 右键关键帧 → 删除 */
function onKeyframeContextMenu(kf: Keyframe, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  timeline.removeKeyframe(props.track.id, kf.id)
}

/** 双击空白 → 在该位置添加关键帧 */
function onCanvasDblClick(event: MouseEvent) {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const xPct = (event.clientX - rect.left) / rect.width
  const yPct = (event.clientY - rect.top) / rect.height
  const frame = Math.round(xPct * timeline.totalFrames)
  const value = Math.round((1 - yPct) * 100) / 100
  timeline.addKeyframe(props.track.id, frame, value)
}
</script>

<template>
  <div
    ref="canvasRef"
    class="curve-canvas"
    @dblclick="onCanvasDblClick"
  >
    <!-- 网格背景 -->
    <div class="grid"></div>

    <!-- 曲线 SVG -->
    <svg class="curve-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <path class="curve-path" :d="pathData" />
    </svg>

    <!-- 播放头 -->
    <div class="playhead" :style="{ left: playheadPercent + '%' }"></div>

    <!-- 关键帧点 -->
    <KeyframePoint
      v-for="kf in sortedKeyframes"
      :key="kf.id"
      :keyframe="kf"
      :left="frameToPercent(kf.frame)"
      :top="valueToPercent(kf.value)"
      :active="isActive(kf)"
      :dragging="kf.id === draggingId"
      @mousedown="onKeyframeMouseDown(kf, $event)"
      @contextmenu="onKeyframeContextMenu(kf, $event)"
    />
  </div>
</template>

<style scoped>
.curve-canvas {
  position: relative;
  height: 72px;
  background: var(--pf-surface);
  border-radius: var(--pf-r-sm);
  border: 1px solid var(--pf-line);
  overflow: hidden;
  cursor: crosshair;
}

/* 网格:纵向每 10% 一条,横向 25/50/75 三条 */
.grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(90deg, rgba(30, 25, 20, 0.04) 1px, transparent 1px),
    linear-gradient(0deg, rgba(30, 25, 20, 0.05) 1px, transparent 1px);
  background-size: 10% 100%, 100% 25%;
  pointer-events: none;
}

.curve-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.curve-path {
  fill: none;
  stroke: var(--pf-accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  transition: d 60ms linear;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--pf-ink);
  opacity: 0.4;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 1;
  transition: left 60ms linear;
}
</style>
