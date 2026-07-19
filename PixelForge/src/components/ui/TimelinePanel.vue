<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlaybackState, TimelineFrame } from './types'
import { useTimelineViewport } from '@/services/frame/timelineViewport'

const props = defineProps<{
  frames: TimelineFrame[]
  currentFrame: number | null
  presentedFrame: number | null
  playbackState: PlaybackState
  replayStatus: 'idle' | 'success' | 'error'
}>()

const emit = defineEmits<{
  selectFrame: [frame: number]
  selectRange: [start: number, end: number]
  play: []
  pause: []
  stepForward: []
  stepBackward: []
}>()

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const containerWidth = ref(800)

const frameCount = computed(() => props.frames.length)

const viewport = useTimelineViewport({
  frameCount,
  containerWidth,
  baseFrameWidth: 56,
  minZoom: 1,
  maxZoom: 10,
})

const zoomPercent = computed(() => Math.round(viewport.zoomLevel.value * 100))
const showKeyframeLabels = computed(() => viewport.zoomLevel.value >= 1.5)
const keyframeCount = computed(() => props.frames.filter((f) => f.isKeyframe).length)
const patchCount = computed(() => props.frames.filter((f) => f.hasPatch).length)
const verifiedCount = computed(() => props.frames.filter((f) => f.renderVerificationState === '一致').length)
const mismatchCount = computed(() => props.frames.filter((f) => f.renderVerificationState === '不一致').length)

function verificationClipClass(state: string): string {
  return `timeline-clip--verify-${state}`
}

function keyframeStatusClass(frame: TimelineFrame): string {
  return `timeline-clip--key-${frame.status}`
}

function syncContainerWidth() {
  if (scrollContainerRef.value) {
    containerWidth.value = scrollContainerRef.value.clientWidth
  }
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  syncContainerWidth()
  if (scrollContainerRef.value) {
    resizeObserver = new ResizeObserver(() => syncContainerWidth())
    resizeObserver.observe(scrollContainerRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

watch(
  () => props.currentFrame,
  (frame) => {
    if (frame === null) return
    const index = props.frames.findIndex((item) => item.frame === frame)
    if (index >= 0) {
      viewport.scrollToFrame(index)
      if (scrollContainerRef.value) {
        scrollContainerRef.value.scrollLeft = viewport.scrollLeft.value
      }
    }
  },
)

function handleScroll() {
  if (scrollContainerRef.value) {
    viewport.setScrollLeft(scrollContainerRef.value.scrollLeft)
  }
}

function handleWheel(event: WheelEvent) {
  viewport.handleWheel(event)
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollLeft = viewport.scrollLeft.value
  }
}

function zoomIn() {
  viewport.zoomIn()
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollLeft = viewport.scrollLeft.value
  }
}

function zoomOut() {
  viewport.zoomOut()
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollLeft = viewport.scrollLeft.value
  }
}

function resetZoom() {
  viewport.resetZoom()
  if (scrollContainerRef.value) {
    scrollContainerRef.value.scrollLeft = 0
  }
}

function frameLeftPx(frame: number): number {
  const index = props.frames.findIndex((item) => item.frame === frame)
  if (index < 0) return 0
  return index * viewport.frameWidth.value
}

function playheadLeftPx(): number {
  if (props.currentFrame === null) return 0
  return frameLeftPx(props.currentFrame)
}

const isDragging = ref(false)

function pixelToFrameIndex(pixelX: number): number {
  const scrollOffset = scrollContainerRef.value?.scrollLeft ?? 0
  const relativeX = pixelX + scrollOffset
  return Math.floor(relativeX / viewport.frameWidth.value)
}

function handleRulerMouseDown(event: MouseEvent) {
  if (event.button !== 0) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const index = pixelToFrameIndex(event.clientX - rect.left)
  if (index < 0 || index >= props.frames.length) return

  if (event.shiftKey && viewport.rangeStart.value !== null) {
    viewport.extendRange(index)
  } else {
    viewport.startRange(index)
  }
  isDragging.value = true
  event.preventDefault()
}

function handleRulerMouseMove(event: MouseEvent) {
  if (!isDragging.value) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const index = pixelToFrameIndex(event.clientX - rect.left)
  if (index < 0 || index >= props.frames.length) return
  viewport.extendRange(index)
}

function handleRulerMouseUp() {
  if (!isDragging.value) return
  isDragging.value = false
  if (viewport.hasRange.value) {
    const start = Math.min(viewport.rangeStart.value!, viewport.rangeEnd.value!)
    const end = Math.max(viewport.rangeStart.value!, viewport.rangeEnd.value!)
    if (start === end) {
      emit('selectFrame', props.frames[start].frame)
      viewport.clearRange()
    } else {
      emit('selectRange', props.frames[start].frame, props.frames[end].frame)
    }
  }
}

function handleRulerMouseLeave() {
  if (isDragging.value) {
    handleRulerMouseUp()
  }
}

function clearSelection() {
  viewport.clearRange()
}
</script>

<template>
  <section class="timeline-panel timeline-panel--editor">
    <header class="timeline-header">
      <div>
        <p class="section-kicker">时间轴</p>
        <h3>逐帧编辑</h3>
      </div>
      <div class="timeline-summary">
        <div class="timeline-summary-item">
          <span>编辑帧</span>
          <strong>{{ playbackState.currentFrame ?? '—' }}</strong>
        </div>
        <div v-if="playbackState.presentedFrame !== null && playbackState.presentedFrame !== playbackState.currentFrame" class="timeline-summary-item">
          <span>展示帧</span>
          <strong class="timeline-presented-frame">{{ playbackState.presentedFrame }}</strong>
        </div>
        <span class="timeline-summary-divider">/</span>
        <div class="timeline-summary-item">
          <span>关键帧</span>
          <strong>{{ keyframeCount }}</strong>
        </div>
        <div
          v-if="replayStatus !== 'idle'"
          class="timeline-replay-indicator"
          :data-status="replayStatus"
        >
          {{ replayStatus === 'success' ? '回放一致' : '回放异常' }}
        </div>
      </div>
    </header>

    <div class="timeline-controls timeline-controls--editor">
      <div class="timeline-button-group">
        <button
          type="button"
          class="tool-button"
          :disabled="!playbackState.canStepBackward"
          @click="emit('stepBackward')"
        >
          上一帧
        </button>
        <button
          v-if="!playbackState.isPlaying"
          type="button"
          class="tool-button primary"
          :disabled="!playbackState.canPlay"
          @click="emit('play')"
        >
          播放
        </button>
        <button
          v-else
          type="button"
          class="tool-button primary"
          @click="emit('pause')"
        >
          暂停
        </button>
        <button
          type="button"
          class="tool-button"
          :disabled="!playbackState.canStepForward"
          @click="emit('stepForward')"
        >
          下一帧
        </button>
      </div>

      <div class="timeline-button-group timeline-zoom-controls">
        <button
          type="button"
          class="tool-button timeline-zoom-button"
          :disabled="!viewport.canZoomOut.value"
          title="缩小"
          @click="zoomOut"
        >
          −
        </button>
        <span class="timeline-zoom-label">{{ zoomPercent }}%</span>
        <button
          type="button"
          class="tool-button timeline-zoom-button"
          :disabled="!viewport.canZoomIn.value"
          title="放大"
          @click="zoomIn"
        >
          +
        </button>
        <button
          type="button"
          class="tool-button timeline-zoom-reset"
          title="重置缩放"
          @click="resetZoom"
        >
          1:1
        </button>
      </div>

      <div class="timeline-button-group timeline-info-group">
        <span class="timeline-meta">总帧数 {{ playbackState.frameCount }}</span>
        <button
          v-if="viewport.hasRange.value"
          type="button"
          class="tool-button timeline-clear-range"
          @click="clearSelection"
        >
          清除区间
        </button>
      </div>
    </div>

    <div
      ref="scrollContainerRef"
      class="timeline-scroll-container"
      @scroll="handleScroll"
      @wheel="handleWheel"
    >
      <div
        class="timeline-content"
        :style="{ width: `${viewport.contentWidth.value}px` }"
      >
        <div
          class="timeline-ruler"
          role="list"
          @mousedown="handleRulerMouseDown"
          @mousemove="handleRulerMouseMove"
          @mouseup="handleRulerMouseUp"
          @mouseleave="handleRulerMouseLeave"
        >
          <div
            v-if="viewport.hasRange.value"
            class="timeline-range-overlay"
            :style="{
              left: `${Math.min(viewport.rangeStartPx.value, viewport.rangeEndPx.value)}px`,
              width: `${Math.abs(viewport.rangeEndPx.value - viewport.rangeStartPx.value)}px`,
            }"
          />
          <button
            v-for="(frame, index) in frames"
            :key="frame.frame"
            type="button"
            class="timeline-ruler-mark"
            :class="{
              active: frame.frame === currentFrame,
              'timeline-ruler-mark--keyframe': frame.isKeyframe,
            }"
            :style="{
              position: 'absolute',
              left: `${index * viewport.frameWidth.value}px`,
              width: `${viewport.frameWidth.value - 4}px`,
            }"
            @click.stop="emit('selectFrame', frame.frame)"
            @click.shift.prevent.stop="viewport.extendRange(index)"
          >
            <span class="timeline-ruler-mark-label">{{ frame.frame }}</span>
            <span v-if="frame.isKeyframe" class="timeline-keyframe-indicator" />
          </button>
        </div>

        <div class="timeline-lanes">
          <div class="timeline-lane-row">
            <div class="timeline-lane-label">补丁轨道<span class="timeline-lane-count">{{ patchCount }}</span></div>
            <div class="timeline-lane-track">
              <button
                v-for="frame in frames.filter((item) => item.hasPatch)"
                :key="`patch-${frame.frame}`"
                type="button"
                class="timeline-clip timeline-clip--patch"
                :style="{ left: `${frameLeftPx(frame.frame)}px` }"
                @click="emit('selectFrame', frame.frame)"
              >
                <span v-if="showKeyframeLabels" class="timeline-clip-label">{{ frame.label }}</span>
                <span v-else class="timeline-clip-marker" />
              </button>
            </div>
          </div>

          <div class="timeline-lane-row">
            <div class="timeline-lane-label">关键帧轨道<span class="timeline-lane-count">{{ keyframeCount }}</span></div>
            <div class="timeline-lane-track">
              <button
                v-for="frame in frames.filter((item) => item.isKeyframe)"
                :key="`key-${frame.frame}`"
                type="button"
                class="timeline-clip timeline-clip--key"
                :class="[keyframeStatusClass(frame)]"
                :style="{ left: `${frameLeftPx(frame.frame)}px` }"
                @click="emit('selectFrame', frame.frame)"
              >
                <span v-if="showKeyframeLabels" class="timeline-clip-label">{{ frame.label }}</span>
                <span v-else class="timeline-clip-marker" />
              </button>
            </div>
          </div>

          <div class="timeline-lane-row">
            <div class="timeline-lane-label">
              验证轨道
              <span class="timeline-lane-count">{{ verifiedCount + mismatchCount }}</span>
            </div>
            <div class="timeline-lane-track">
              <button
                v-for="frame in frames.filter((item) => item.renderVerificationState !== '未校验')"
                :key="`verify-${frame.frame}`"
                type="button"
                class="timeline-clip timeline-clip--verify"
                :class="[verificationClipClass(frame.renderVerificationState)]"
                :style="{ left: `${frameLeftPx(frame.frame)}px` }"
                @click="emit('selectFrame', frame.frame)"
              >
                <span v-if="showKeyframeLabels" class="timeline-clip-label">{{ frame.renderVerificationState }}</span>
                <span v-else class="timeline-clip-marker" />
              </button>
            </div>
          </div>

          <div
            class="timeline-playhead"
            :style="{ left: `${playheadLeftPx()}px` }"
          >
            <span class="timeline-playhead-handle" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
