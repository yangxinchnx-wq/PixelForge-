<!--
  PixelForge Timeline UI — TimeRuler（时间刻度尺）。

  显示：00:00  00:05  00:10  00:15

  根据 zoom 自动变化：
    zoom > 200 → 显示 frame
    zoom < 50  → 显示 seconds
-->
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 缩放：每秒像素数 */
  zoom: number
  /** 视口宽度 */
  width: number
  /** 水平滚动位置 */
  scrollX: number
}>()

/** 刻度间隔（秒），根据 zoom 自适应。 */
const tickInterval = computed(() => {
  if (props.zoom > 200) return 1 / 30 // 帧级（30fps → 每 1/30 秒）
  if (props.zoom > 100) return 1     // 每秒
  if (props.zoom > 50) return 2      // 每 2 秒
  if (props.zoom > 20) return 5      // 每 5 秒
  return 10                          // 每 10 秒
})

/** 刻度标签列表。 */
const ticks = computed(() => {
  const result: { x: number; label: string }[] = []
  const interval = tickInterval.value
  const startTime = props.scrollX / props.zoom
  const endTime = (props.scrollX + props.width) / props.zoom
  const startTick = Math.floor(startTime / interval) * interval

  for (let t = startTick; t <= endTime; t += interval) {
    const x = t * props.zoom - props.scrollX
    const label = props.zoom > 200
      ? `${Math.floor(t * 30)}`         // 帧号
      : formatTime(t)                    // 时间格式
    result.push({ x, label })
  }
  return result
})

/** 格式化秒数为 MM:SS。 */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="time-ruler" :style="{ width: width + 'px' }">
    <div
      v-for="tick in ticks"
      :key="tick.x"
      class="tick"
      :style="{ left: tick.x + 'px' }"
    >
      <span class="tick-label">{{ tick.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.time-ruler {
  height: 24px;
  background: #0d0d1a;
  border-bottom: 1px solid #2a2a3e;
  position: relative;
  overflow: hidden;
}

.tick {
  position: absolute;
  top: 0;
  height: 100%;
  border-left: 1px solid #3a3a4e;
}

.tick-label {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 10px;
  color: #6b7280;
  font-family: monospace;
  white-space: nowrap;
}
</style>
