import { computed, getCurrentInstance, onBeforeUnmount, ref, watchEffect, type ComputedRef, type Ref } from 'vue'

import type { FrameSnapshot, PlaybackState } from '@/components/ui/types'

interface FramePlaybackControllerOptions {
  frames: ComputedRef<FrameSnapshot[]>
  selectedFrame: Ref<number | null>
  presentedFrame: Ref<number | null>
  onSelectFrame: (frame: number) => void
  onReplayFrame: (frame: number) => void
  intervalMs?: number
}

export function useFramePlaybackController(options: FramePlaybackControllerOptions) {
  const isPlaying = ref(false)
  const playbackIntervalMs = options.intervalMs ?? 420
  let timer: ReturnType<typeof setInterval> | null = null

  const frameIndexMap = computed(() => {
    return new Map(options.frames.value.map((frame, index) => [frame.frame, index]))
  })

  const currentIndex = computed(() => {
    if (options.selectedFrame.value === null) {
      return -1
    }

    return frameIndexMap.value.get(options.selectedFrame.value) ?? -1
  })

  const state = computed<PlaybackState>(() => ({
    currentFrame: options.selectedFrame.value,
    presentedFrame: options.presentedFrame.value,
    isPlaying: isPlaying.value,
    canPlay: options.frames.value.length > 1,
    canStepForward: currentIndex.value >= 0 && currentIndex.value < options.frames.value.length - 1,
    canStepBackward: currentIndex.value > 0,
    frameCount: options.frames.value.length,
  }))

  function stopPlayback() {
    isPlaying.value = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }

  function selectFirstFrameIfNeeded() {
    if (options.frames.value.length === 0) {
      stopPlayback()
      return
    }

    if (options.selectedFrame.value === null) {
      const firstFrame = options.frames.value[0].frame
      options.onSelectFrame(firstFrame)
      options.onReplayFrame(firstFrame)
    }
  }

  function stepForward() {
    if (!state.value.canStepForward) {
      stopPlayback()
      return
    }

    const nextFrame = options.frames.value[currentIndex.value + 1]
    if (nextFrame) {
      options.onSelectFrame(nextFrame.frame)
      options.onReplayFrame(nextFrame.frame)
    }
  }

  function stepBackward() {
    if (!state.value.canStepBackward) {
      return
    }

    const previousFrame = options.frames.value[currentIndex.value - 1]
    if (previousFrame) {
      options.onSelectFrame(previousFrame.frame)
      options.onReplayFrame(previousFrame.frame)
    }
  }

  function play() {
    selectFirstFrameIfNeeded()
    if (!state.value.canPlay || isPlaying.value) {
      return
    }

    isPlaying.value = true
    timer = setInterval(() => {
      if (!state.value.canStepForward) {
        stopPlayback()
        return
      }

      stepForward()
    }, playbackIntervalMs)
  }

  function pause() {
    stopPlayback()
  }

  function togglePlayback() {
    if (isPlaying.value) {
      pause()
      return
    }

    play()
  }

  watchEffect(() => {
    if (options.frames.value.length === 0) {
      stopPlayback()
      return
    }

    if (options.selectedFrame.value !== null && !frameIndexMap.value.has(options.selectedFrame.value)) {
      const firstFrame = options.frames.value[0].frame
      options.onSelectFrame(firstFrame)
      options.onReplayFrame(firstFrame)
    }
  })

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      stopPlayback()
    })
  }

  return {
    state,
    play,
    pause,
    togglePlayback,
    stepForward,
    stepBackward,
    stopPlayback,
  }
}
