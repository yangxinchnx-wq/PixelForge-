<script setup lang="ts">
/**
 * AnimationRuler — 时间标尺(秒级)。
 *
 * 与 frame-based Timeline.vue 的标尺不同:
 * - 基于 time(秒),刻度间隔随 duration 自适应(1s / 0.5s / 0.1s)
 * - 点击 / 拖动 → store.seek(time)
 * - 暴露 rulerRef 给父组件用于 Playhead 定位校准
 */
import { computed, ref } from 'vue'

import { useAnimationStore } from '@/animation/timeline'

const store = useAnimationStore()

const rulerRef = ref<HTMLElement | null>(null)

/** 自适应刻度间隔:目标 ~8-12 个主刻度 */
const tickStep = computed(() => {
  const d = store.duration
  if (d <= 0) return 1
  // 候选间隔(秒):0.1 / 0.25 / 0.5 / 1 / 2 / 5 / 10
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]
  for (const c of candidates) {
    if (d / c <= 12) return c
  }
  return 60
})

/** 主刻度列表(秒) */
const ticks = computed(() => {
  const step = tickStep.value
  const arr: number[] = []
  for (let t = 0; t <= store.duration + 1e-6; t += step) {
    arr.push(Math.round(t * 1000) / 1000) // 消除浮点累加误差
  }
  return arr
})

/** 次刻度(主刻度间的 4 等分,不显示数字) */
const minorTicks = computed(() => {
  const step = tickStep.value / 4
  const arr: number[] = []
  for (let t = 0; t <= store.duration + 1e-6; t += step) {
    const rounded = Math.round(t * 1000) / 1000
    if (!ticks.value.includes(rounded)) arr.push(rounded)
  }
  return arr
})

function timeToPercent(time: number): number {
  if (store.duration <= 0) return 0
  return (time / store.duration) * 100
}

function formatTime(t: number): string {
  if (t < 1) return t.toFixed(2)
  if (t < 10) return t.toFixed(1)
  return t.toFixed(0)
}

/** 根据鼠标位置计算时间并 seek(点击 / 拖动共用) */
function seekFromEvent(event: MouseEvent) {
  if (!rulerRef.value || store.duration <= 0) return
  const rect = rulerRef.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const time = (x / rect.width) * store.duration
  store.seek(time)
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

defineExpose({ rulerRef })
</script>

<template>
  <div
    ref="rulerRef"
    class="anim-ruler"
    @mousedown="onRulerMouseDown"
  >
    <!-- 次刻度 -->
    <div
      v-for="t in minorTicks"
      :key="'m' + t"
      class="ruler-minor"
      :style="{ left: timeToPercent(t) + '%' }"
    ></div>
    <!-- 主刻度 -->
    <div
      v-for="t in ticks"
      :key="t"
      class="ruler-tick"
      :style="{ left: timeToPercent(t) + '%' }"
    >
      <div class="tick-mark"></div>
      <div class="tick-label">{{ formatTime(t) }}s</div>
    </div>
  </div>
</template>

<style scoped>
.anim-ruler {
  position: relative;
  height: 36px;
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-sm);
  border: 1px solid var(--pf-line);
  cursor: pointer;
  user-select: none;
  overflow: hidden;
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
