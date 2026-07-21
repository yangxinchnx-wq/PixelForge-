<!--
  PixelForge Timeline UI — Timeline 主组件。

  负责布局：
    ┌───────────────┬───────────────────────────┐
    │ TrackHeader   │    Timeline Canvas       │
    │ V1            │  ┌───────────────┐       │
    │ V2            │  │  Video Clip    │       │
    │ A1            │  └───────────────┘       │
    ├───────────────┴───────────────────────────┤
    │               Time Ruler                   │
    └───────────────────────────────────────────┘

  真正绘制：Canvas（不是 Vue v-for）
-->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useTimelineStore } from '@/timeline/store/timelineStore'
import { TimelineCanvas, type Viewport } from './canvas/TimelineCanvas'
import { TimelineRenderer, TRACK_HEIGHT, TRACK_HEADER_WIDTH, RULER_HEIGHT, startRenderLoop } from './canvas/TimelineRenderer'
import TimeRuler from './ruler/TimeRuler.vue'
import TrackHeader from './track/TrackHeader.vue'
import TrackLane from './track/TrackLane.vue'

const store = useTimelineStore()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const containerEl = ref<HTMLDivElement | null>(null)

let timelineCanvas: TimelineCanvas | null = null
let renderer: TimelineRenderer | null = null
let stopRender: (() => void) | null = null

const scrollX = ref(0)
const zoom = ref(100)

function getViewport(): Viewport {
  return {
    scrollX: scrollX.value,
    scrollY: 0,
    zoom: zoom.value,
    width: containerEl.value?.clientWidth ?? 800,
    height: containerEl.value?.clientHeight ?? 400,
  }
}

function handleWheel(e: WheelEvent) {
  if (e.ctrlKey) {
    // Ctrl + 滚轮：缩放
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(10, Math.min(500, zoom.value * delta))
    // 保持鼠标位置对应的时间不变
    const rect = canvasEl.value?.getBoundingClientRect()
    const mousePx = e.clientX - (rect?.left ?? 0) - TRACK_HEADER_WIDTH
    const mouseTime = (mousePx + scrollX.value) / zoom.value
    zoom.value = newZoom
    scrollX.value = mouseTime * newZoom - mousePx
  } else {
    // 普通滚轮：水平滚动
    scrollX.value = Math.max(0, scrollX.value + e.deltaY)
  }
}

onMounted(() => {
  if (!canvasEl.value) return
  timelineCanvas = new TimelineCanvas(canvasEl.value)
  timelineCanvas.setViewport(getViewport())
  renderer = new TimelineRenderer(timelineCanvas)

  const tracks = () => store.activeSequenceObj?.tracks ?? []
  stopRender = startRenderLoop(renderer, tracks, getViewport)
})

onUnmounted(() => {
  stopRender?.()
  stopRender = null
  timelineCanvas = null
  renderer = null
})
</script>

<template>
  <div class="timeline-container" ref="containerEl">
    <!-- 左侧轨道头部 -->
    <div class="track-headers">
      <TrackHeader
        v-for="track in (store.activeSequenceObj?.tracks ?? [])"
        :key="track.id"
        :track="track"
      />
    </div>

    <!-- 右侧 Canvas 渲染区 -->
    <div class="canvas-area" @wheel="handleWheel">
      <canvas ref="canvasEl" class="timeline-canvas"></canvas>
    </div>

    <!-- 底部时间刻度尺 -->
    <TimeRuler
      :zoom="zoom"
      :width="containerEl?.clientWidth ?? 800"
      :scroll-x="scrollX"
    />
  </div>
</template>

<style scoped>
.timeline-container {
  display: grid;
  grid-template-columns: 120px 1fr;
  grid-template-rows: 1fr auto;
  height: 100%;
  background: #0a0a14;
  overflow: hidden;
}

.track-headers {
  grid-column: 1;
  grid-row: 1;
  overflow-y: auto;
}

.canvas-area {
  grid-column: 2;
  grid-row: 1;
  overflow: hidden;
  position: relative;
}

.timeline-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* TimeRuler 占据底部两列 */
:deep(.time-ruler) {
  grid-column: 1 / -1;
  grid-row: 2;
}
</style>
