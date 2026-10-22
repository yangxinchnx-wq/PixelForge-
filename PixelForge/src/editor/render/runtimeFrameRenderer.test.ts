/**
 * RuntimeFrameRenderer 导出确定性测试。
 *
 * 覆盖:
 * - RD: 时间轴求值策略(导出模式每帧必求值 / 预览模式跳过未变化时间)
 * - RW: 首帧预热(丢弃式渲染次数,保证第 0 帧不依赖未就绪的 GPU 管线)
 * - RR: 第 0 帧重置求值记忆(渲染任务之间不残留状态)
 */

import { describe, it, expect, vi } from 'vitest'

import type { useRuntimeStore } from '@/stores/runtime'
import type { TimelineContent } from '@/world/types'
import { createRuntimeFrameRenderer } from './runtimeFrameRenderer'
import { seconds } from './timelineTypes'

type RuntimeStore = ReturnType<typeof useRuntimeStore>

function createFakeRuntime() {
  const runtime = {
    currentIr: {
      layers: [{ id: 'layer-1' }],
      effects: [],
    },
    currentRenderTime: 0,
    setRenderTime: vi.fn(),
    applyValuePatches: vi.fn(() => ({ success: true, appliedCount: 1 })),
    renderCurrentIR: vi.fn(async () => {}),
    captureCanvas: vi.fn(async () => 'data:image/png;base64,AAAA'),
    setRenderIR: vi.fn(async () => {}),
  }
  return runtime as unknown as RuntimeStore & typeof runtime
}

function createTimeline(): TimelineContent {
  return {
    id: 'timeline-test',
    duration: 2,
    loop: false,
    fps: 30,
    tracks: [
      {
        id: 'track-1',
        name: 'opacity',
        targetEntity: 'layer',
        targetId: 'layer-1',
        paramKey: 'opacity',
        enabled: true,
        keyframes: [
          { id: 'kf-0', time: 0, value: 0, interpolation: 'linear' },
          { id: 'kf-1', time: 1, value: 1, interpolation: 'linear' },
        ],
      },
    ],
  }
}

describe('RuntimeFrameRenderer: 时间轴求值确定性', () => {
  it('RD1: 默认导出模式——同一时间重复渲染仍逐帧求值', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, { timeline: createTimeline() })

    await adapter.frameRenderer(0, seconds(0))
    await adapter.frameRenderer(1, seconds(0))
    await adapter.frameRenderer(2, seconds(0))

    expect(adapter.getTimelineEvaluationCount()).toBe(3)
  })

  it('RD2: 预览模式——时间未变化时跳过求值', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, {
      timeline: createTimeline(),
      deterministicTimeline: false,
    })

    await adapter.frameRenderer(0, seconds(0))
    await adapter.frameRenderer(1, seconds(0))
    await adapter.frameRenderer(2, seconds(0))

    expect(adapter.getTimelineEvaluationCount()).toBe(1)
  })

  it('RD3: 预览模式下时间变化时正常求值', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, {
      timeline: createTimeline(),
      deterministicTimeline: false,
    })

    await adapter.frameRenderer(0, seconds(0))
    await adapter.frameRenderer(1, seconds(1))

    expect(adapter.getTimelineEvaluationCount()).toBe(2)
  })

  it('RR1: 第 0 帧重置求值记忆——上一次渲染的状态不影响下一次', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, {
      timeline: createTimeline(),
      deterministicTimeline: false,
    })

    // 第一次任务：第 0 帧，时间 0
    await adapter.frameRenderer(0, seconds(0))
    // 第二次任务：第 0 帧，时间仍为 0（若残留记忆会被跳过）
    await adapter.frameRenderer(0, seconds(0))

    expect(adapter.getTimelineEvaluationCount()).toBe(2)
  })
})

describe('RuntimeFrameRenderer: 首帧预热', () => {
  it('RW1: 第 0 帧默认预热 1 次（总渲染 2 次，其中 1 次丢弃）', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, { timeline: null })

    await adapter.frameRenderer(0, seconds(0))

    expect(adapter.getWarmupRenderCount()).toBe(1)
    expect(runtime.renderCurrentIR).toHaveBeenCalledTimes(2)
  })

  it('RW2: 预热只发生在第 0 帧', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, { timeline: null })

    await adapter.frameRenderer(0, seconds(0))
    await adapter.frameRenderer(1, seconds(1))

    expect(adapter.getWarmupRenderCount()).toBe(1)
    expect(runtime.renderCurrentIR).toHaveBeenCalledTimes(3)
  })

  it('RW3: warmupPasses: 0 可关闭预热', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, { timeline: null, warmupPasses: 0 })

    await adapter.frameRenderer(0, seconds(0))

    expect(adapter.getWarmupRenderCount()).toBe(0)
    expect(runtime.renderCurrentIR).toHaveBeenCalledTimes(1)
  })

  it('RW4: 预热发生在时间设置与补丁应用之后', async () => {
    const runtime = createFakeRuntime()
    const adapter = createRuntimeFrameRenderer(runtime, { timeline: createTimeline() })

    await adapter.frameRenderer(0, seconds(0))

    expect(runtime.setRenderTime).toHaveBeenCalledWith(0)
    expect(runtime.applyValuePatches).toHaveBeenCalledTimes(1)
    expect(runtime.renderCurrentIR).toHaveBeenCalledTimes(2)
  })
})
