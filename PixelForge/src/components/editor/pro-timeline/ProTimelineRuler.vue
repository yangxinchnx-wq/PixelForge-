<script setup lang="ts">
/**
 * ProTimelineRuler(Step 31.2)— 专业时间标尺。
 *
 * 与 AnimationRuler 区别:
 * - 基于 bigint 微秒,通过 layout.timeToViewportX 定位
 * - 支持横向滚动与缩放
 * - 刻度间隔自适应(秒/帧)
 * - 点击 / 拖动 seek
 * - 主刻度显示 timecode(HH:MM:SS:FF)
 */
import { computed, ref, type Ref } from 'vue'

import type { Time } from '@/editor/timeline/core/time'
import { seconds, timeToFrame, formatTimecode } from '@/editor/timeline/core/time'
import type { ProTimelineLayout } from './useProTimelineLayout'

interface Props {
  layout: ProTimelineLayout
  duration: Time
  fps: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  seek: [time: Time]
}>()

const rulerRef = ref<HTMLElement | null>(null)

/** 主刻度间隔(秒)— 目标 ~10 个主刻度 */
const majorStepSec = computed(() => {
  const visibleSec = props.layout.viewportWidth.value / props.layout.pixelsPerSecond.value
  // 候选间隔(秒)
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
  for (const c of candidates) {
    if (visibleSec / c <= 10) return c
  }
  return 600
})

/** 主刻度列表(秒) */
const majorTicks = computed(() => {
  const step = majorStepSec.value
  const arr: number[] = []
  const durSec = Number(props.duration) / 1_000_000
  for (let t = 0; t <= durSec + 1e-6; t += step) {
    arr.push(Math.round(t * 1000) / 1000)
  }
  return arr
})

/** 次刻度(主刻度间的 5 等分) */
const minorTicks = computed(() => {
  const step = majorStepSec.value / 5
  const arr: number[] = []
  const durSec = Number(props.duration) / 1_000_000
  for (let t = 0; t <= durSec + 1e-6; t += step) {
    const rounded = Math.round(t * 1000) / 1000
    if (!majorTicks.value.includes(rounded)) arr.push(rounded)
  }
  return arr
})

function timeToViewportX(t: Time): number {
  return props.layout.timeToViewportX(t)
}

function formatTick(tSec: number): string {
  const us = BigInt(Math.floor(tSec * 1_000_000))
  return formatTimecode(us, props.fps)
}

/** 根据鼠标位置计算时间并 seek */
function seekFromEvent(event: MouseEvent) {
  if (!rulerRef.value) return
  const rect = rulerRef.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const t = props.layout.viewportXToTime(x)
  // 吸附到最近帧
  const frame = timeToFrame(t, props.fps)
  const snapped: Time = (BigInt(frame) * 1_000_000n) / BigInt(props.fps)
  emit('seek', snapped)
}

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

defineExpose<{ rulerRef: Ref<HTMLElement | null> }>({ rulerRef })
</script>

<template>
  <div
    ref="rulerRef"
    class="pro-ruler"
    :style="{ width: layout.contentWidth.value + 'px' }"
    @mousedown="onRulerMouseDown"
  >
    <!-- 次刻度 -->
    <div
      v-for="t in minorTicks"
      :key="'m' + t"
      class="ruler-minor"
      :style="{ left: timeToViewportX(seconds(t)) + 'px' }"
    ></div>
    <!-- 主刻度 -->
    <div
      v-for="t in majorTicks"
      :key="t"
      class="ruler-tick"
      :style="{ left: timeToViewportX(seconds(t)) + 'px' }"
    >
      <div class="tick-mark"></div>
      <div class="tick-label">{{ formatTick(t) }}</div>
    </div>
  </div>
</template>

<style scoped>
.pro-ruler {
  position: relative;
  height: 36px;
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-sm);
  border: 1px solid var(--pf-line);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
  flex-shrink: 0;
}
.ruler-minor {
  position: absolute;
  top: 0;
  width: 1px;
  height: 4px;
  background: var(--pf-line-strong);
  transform: translateX(-50%);
  pointer-events: none;
  opacity: 0.5;
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
  top: 11px;
  left: 50%;
  transform: translateX(-50%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-muted);
  white-space: nowrap;
  letter-spacing: 0.02em;
}
</style>
