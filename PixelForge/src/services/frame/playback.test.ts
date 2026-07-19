import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { FrameSnapshot } from '@/components/ui/types'

import { useFramePlaybackController } from './playback'

function createSnapshot(frame: number): FrameSnapshot {
  return {
    frame,
    label: `第 ${frame} 帧`,
    timestampMs: frame * 10,
    durationMs: 2,
    status: 'ready',
    scenario: 'gradient',
    layerId: 'layer_gradient',
    opcode: 'LINEAR_GRADIENT',
    patchId: null,
    patchSummary: null,
    hasPatch: false,
    isKeyframe: frame % 4 === 0,
    canvasSize: { width: 1024, height: 768 },
    outputFormat: 'rgba8unorm',
    error: null,
    artifactSchemaVersion: 'region-artifact-v1',
    renderVerificationState: '未校验',
    renderVerificationMessage: null,
    payload: {},
  }
}

describe('时间轴播放控制器', () => {
  it('在未选中帧时播放应自动选择并回放第一帧', () => {
    const selectedFrame = ref<number | null>(null)
    const presentedFrame = ref<number | null>(null)
    const onSelectFrame = vi.fn((frame: number) => {
      selectedFrame.value = frame
    })
    const onReplayFrame = vi.fn((frame: number) => {
      presentedFrame.value = frame
    })

    const controller = useFramePlaybackController({
      frames: computed(() => [createSnapshot(120), createSnapshot(121)]),
      selectedFrame,
      presentedFrame,
      onSelectFrame,
      onReplayFrame,
      intervalMs: 1000,
    })

    controller.play()
    controller.pause()

    expect(onSelectFrame).toHaveBeenCalledWith(120)
    expect(onReplayFrame).toHaveBeenCalledWith(120)
    expect(controller.state.value.currentFrame).toBe(120)
    expect(controller.state.value.presentedFrame).toBe(120)
  })

  it('下一帧和上一帧应同时触发选择与回放', () => {
    const selectedFrame = ref<number | null>(121)
    const presentedFrame = ref<number | null>(121)
    const onSelectFrame = vi.fn((frame: number) => {
      selectedFrame.value = frame
    })
    const onReplayFrame = vi.fn((frame: number) => {
      presentedFrame.value = frame
    })

    const controller = useFramePlaybackController({
      frames: computed(() => [createSnapshot(120), createSnapshot(121), createSnapshot(122)]),
      selectedFrame,
      presentedFrame,
      onSelectFrame,
      onReplayFrame,
    })

    controller.stepForward()
    expect(onSelectFrame).toHaveBeenLastCalledWith(122)
    expect(onReplayFrame).toHaveBeenLastCalledWith(122)

    controller.stepBackward()
    expect(onSelectFrame).toHaveBeenLastCalledWith(121)
    expect(onReplayFrame).toHaveBeenLastCalledWith(121)
  })

  it('当选中帧不在列表中时应回退到第一帧并触发回放', () => {
    const selectedFrame = ref<number | null>(999)
    const presentedFrame = ref<number | null>(999)
    const onSelectFrame = vi.fn((frame: number) => {
      selectedFrame.value = frame
    })
    const onReplayFrame = vi.fn((frame: number) => {
      presentedFrame.value = frame
    })

    useFramePlaybackController({
      frames: computed(() => [createSnapshot(120), createSnapshot(121)]),
      selectedFrame,
      presentedFrame,
      onSelectFrame,
      onReplayFrame,
    })

    expect(onSelectFrame).toHaveBeenCalledWith(120)
    expect(onReplayFrame).toHaveBeenCalledWith(120)
  })
})
