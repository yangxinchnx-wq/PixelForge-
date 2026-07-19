import { computed, ref, type ComputedRef, type Ref } from 'vue'

export interface TimelineViewportOptions {
  frameCount: ComputedRef<number>
  containerWidth: Ref<number>
  baseFrameWidth?: number
  minZoom?: number
  maxZoom?: number
}

export interface TimelineViewport {
  zoomLevel: Ref<number>
  scrollLeft: Ref<number>
  frameWidth: ComputedRef<number>
  contentWidth: ComputedRef<number>
  maxScrollLeft: ComputedRef<number>
  canZoomIn: ComputedRef<boolean>
  canZoomOut: ComputedRef<boolean>
  rangeStart: Ref<number | null>
  rangeEnd: Ref<number | null>
  hasRange: ComputedRef<boolean>
  rangeStartPx: ComputedRef<number>
  rangeEndPx: ComputedRef<number>
  zoomIn: () => void
  zoomOut: () => void
  resetZoom: () => void
  setScrollLeft: (value: number) => void
  scrollToFrame: (frameIndex: number) => void
  handleWheel: (event: WheelEvent) => void
  startRange: (frameIndex: number) => void
  extendRange: (frameIndex: number) => void
  clearRange: () => void
}

export function useTimelineViewport(options: TimelineViewportOptions): TimelineViewport {
  const baseFrameWidth = options.baseFrameWidth ?? 56
  const minZoom = options.minZoom ?? 1
  const maxZoom = options.maxZoom ?? 10

  const zoomLevel = ref(1)
  const scrollLeft = ref(0)
  const rangeStart = ref<number | null>(null)
  const rangeEnd = ref<number | null>(null)

  const frameWidth = computed(() => baseFrameWidth * zoomLevel.value)

  const contentWidth = computed(() => {
    const count = options.frameCount.value
    if (count <= 0) {
      return options.containerWidth.value
    }
    return Math.max(count * frameWidth.value, options.containerWidth.value)
  })

  const maxScrollLeft = computed(() =>
    Math.max(0, contentWidth.value - options.containerWidth.value),
  )

  const canZoomIn = computed(() => zoomLevel.value < maxZoom)
  const canZoomOut = computed(() => zoomLevel.value > minZoom)

  const hasRange = computed(() => rangeStart.value !== null && rangeEnd.value !== null)
  const rangeStartPx = computed(() => (rangeStart.value ?? 0) * frameWidth.value)
  const rangeEndPx = computed(() => {
    const end = rangeEnd.value ?? rangeStart.value ?? 0
    return (end + 1) * frameWidth.value
  })

  function clampScrollLeft(value: number): number {
    return Math.max(0, Math.min(value, maxScrollLeft.value))
  }

  function zoomIn(): void {
    if (!canZoomIn.value) return
    zoomLevel.value = Math.min(zoomLevel.value * 1.5, maxZoom)
    scrollLeft.value = clampScrollLeft(scrollLeft.value)
  }

  function zoomOut(): void {
    if (!canZoomOut.value) return
    zoomLevel.value = Math.max(zoomLevel.value / 1.5, minZoom)
    scrollLeft.value = clampScrollLeft(scrollLeft.value)
  }

  function resetZoom(): void {
    zoomLevel.value = 1
    scrollLeft.value = 0
  }

  function setScrollLeft(value: number): void {
    scrollLeft.value = clampScrollLeft(value)
  }

  function scrollToFrame(frameIndex: number): void {
    if (frameIndex < 0) return
    const targetLeft = frameIndex * frameWidth.value
    const viewportStart = scrollLeft.value
    const viewportEnd = scrollLeft.value + options.containerWidth.value

    if (targetLeft >= viewportStart && targetLeft < viewportEnd - frameWidth.value) {
      return
    }

    scrollLeft.value = clampScrollLeft(
      targetLeft - options.containerWidth.value / 2 + frameWidth.value / 2,
    )
  }

  function handleWheel(event: WheelEvent): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      if (event.deltaY < 0) {
        zoomIn()
      } else {
        zoomOut()
      }
      return
    }

    event.preventDefault()
    setScrollLeft(scrollLeft.value + event.deltaX + event.deltaY)
  }

  function clampFrameIndex(frameIndex: number): number {
    const count = options.frameCount.value
    if (count <= 0) return 0
    return Math.max(0, Math.min(frameIndex, count - 1))
  }

  function startRange(frameIndex: number): void {
    const clamped = clampFrameIndex(frameIndex)
    rangeStart.value = clamped
    rangeEnd.value = clamped
  }

  function extendRange(frameIndex: number): void {
    if (rangeStart.value === null) return
    rangeEnd.value = clampFrameIndex(frameIndex)
  }

  function clearRange(): void {
    rangeStart.value = null
    rangeEnd.value = null
  }

  return {
    zoomLevel,
    scrollLeft,
    frameWidth,
    contentWidth,
    maxScrollLeft,
    canZoomIn,
    canZoomOut,
    rangeStart,
    rangeEnd,
    hasRange,
    rangeStartPx,
    rangeEndPx,
    zoomIn,
    zoomOut,
    resetZoom,
    setScrollLeft,
    scrollToFrame,
    handleWheel,
    startRange,
    extendRange,
    clearRange,
  }
}
