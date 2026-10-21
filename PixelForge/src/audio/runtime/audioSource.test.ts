import { describe, expect, it } from 'vitest'

import {
  US_PER_SECOND,
  computePlaybackWindow,
  decodeAudioFile,
  isSourceFinished,
  scheduleTrack,
  secondsToUs,
  stopSource,
  toMono,
  usToSeconds,
} from '@/audio/runtime/audioSource'
import { createTrackNodes } from '@/audio/runtime/audioGraph'
import {
  FakeAudioBuffer,
  FakeAudioBufferSourceNode,
  FakeAudioContext,
} from '@/audio/runtime/fakeAudioContext'
import type { AudioTrack } from '@/audio/core/types'

function makeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 't1',
    name: 'Track 1',
    assetId: 'a1',
    startTimeUs: 0n,
    inPointUs: 0n,
    outPointUs: 0n,
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    effects: [],
    ...overrides,
  }
}

// ============================================================================
// 时间换算测试
// ============================================================================

describe('usToSeconds', () => {
  it('应将微秒转为秒', () => {
    expect(usToSeconds(1_000_000n)).toBe(1)
    expect(usToSeconds(2_500_000n)).toBe(2.5)
  })

  it('0 应为 0', () => {
    expect(usToSeconds(0n)).toBe(0)
  })
})

describe('secondsToUs', () => {
  it('应将秒转为微秒', () => {
    expect(secondsToUs(1)).toBe(BigInt(US_PER_SECOND))
    expect(secondsToUs(2.5)).toBe(2_500_000n)
  })

  it('应与 usToSeconds 互逆', () => {
    expect(usToSeconds(secondsToUs(3.75))).toBeCloseTo(3.75, 6)
  })

  it('非法值应返回 0', () => {
    expect(secondsToUs(Number.NaN)).toBe(0n)
    expect(secondsToUs(Number.POSITIVE_INFINITY)).toBe(0n)
  })
})

// ============================================================================
// computePlaybackWindow 测试
// ============================================================================

describe('computePlaybackWindow', () => {
  const duration = 10

  it('未设置入出点时应播放整段', () => {
    const w = computePlaybackWindow(makeTrack(), duration)
    expect(w.offset).toBe(0)
    expect(w.duration).toBe(10)
  })

  it('设置入点应从入点开始', () => {
    const w = computePlaybackWindow(makeTrack({ inPointUs: 2_000_000n }), duration)
    expect(w.offset).toBe(2)
    expect(w.duration).toBe(8)
  })

  it('设置出点应在出点结束', () => {
    const w = computePlaybackWindow(makeTrack({ outPointUs: 5_000_000n }), duration)
    expect(w.offset).toBe(0)
    expect(w.duration).toBe(5)
  })

  it('同时设置入出点应取区间', () => {
    const w = computePlaybackWindow(
      makeTrack({ inPointUs: 2_000_000n, outPointUs: 5_000_000n }),
      duration,
    )
    expect(w.offset).toBe(2)
    expect(w.duration).toBe(3)
  })

  it('出点早于入点时应退化为播放到末尾', () => {
    const w = computePlaybackWindow(
      makeTrack({ inPointUs: 5_000_000n, outPointUs: 2_000_000n }),
      duration,
    )
    expect(w.offset).toBe(5)
    expect(w.duration).toBe(5)
  })

  it('入点超出缓冲时长时应被限制', () => {
    const w = computePlaybackWindow(makeTrack({ inPointUs: 20_000_000n }), duration)
    expect(w.offset).toBe(10)
    expect(w.duration).toBe(0)
  })

  it('出点超出缓冲时长时应被限制', () => {
    const w = computePlaybackWindow(makeTrack({ outPointUs: 999_000_000n }), duration)
    expect(w.duration).toBe(10)
  })

  it('非法缓冲时长应返回零窗口', () => {
    expect(computePlaybackWindow(makeTrack(), 0)).toEqual({ offset: 0, duration: 0 })
    expect(computePlaybackWindow(makeTrack(), Number.NaN)).toEqual({ offset: 0, duration: 0 })
  })

  it('负入点应按 0 处理', () => {
    const w = computePlaybackWindow(makeTrack({ inPointUs: -5_000_000n }), duration)
    expect(w.offset).toBe(0)
  })
})

// ============================================================================
// decodeAudioFile 测试
// ============================================================================

describe('decodeAudioFile', () => {
  it('应返回解码后的缓冲', async () => {
    const ctx = new FakeAudioContext()
    const buffer = await decodeAudioFile(ctx, new ArrayBuffer(4096))
    expect(buffer).not.toBeNull()
    expect(ctx.decodeCount).toBe(1)
  })

  it('空数据应返回 null 而不调用解码', async () => {
    const ctx = new FakeAudioContext()
    expect(await decodeAudioFile(ctx, new ArrayBuffer(0))).toBeNull()
    expect(ctx.decodeCount).toBe(0)
  })

  it('解码失败应返回 null 而不是抛异常', async () => {
    const ctx = new FakeAudioContext({ decodeSucceeds: false })
    expect(await decodeAudioFile(ctx, new ArrayBuffer(1024))).toBeNull()
  })
})

// ============================================================================
// toMono 测试
// ============================================================================

describe('toMono', () => {
  it('单声道应原样返回', () => {
    const buf = new FakeAudioBuffer(1, 4, 48000)
    const data = buf.getChannelData(0)
    data.set([0.1, 0.2, 0.3, 0.4])
    const mono = toMono(buf)
    // Float32Array 有精度损失,逐元素近似比较
    for (let i = 0; i < mono.length; i++) {
      expect(mono[i]).toBeCloseTo([0.1, 0.2, 0.3, 0.4][i], 6)
    }
  })

  it('双声道应取平均', () => {
    const buf = new FakeAudioBuffer(2, 2, 48000)
    buf.getChannelData(0).set([1, 0])
    buf.getChannelData(1).set([0, 1])
    const mono = toMono(buf)
    expect(mono[0]).toBeCloseTo(0.5, 6)
    expect(mono[1]).toBeCloseTo(0.5, 6)
  })

  it('空缓冲应返回空数组', () => {
    expect(toMono(new FakeAudioBuffer(2, 0, 48000)).length).toBe(0)
  })
})

// ============================================================================
// scheduleTrack 测试
// ============================================================================

describe('scheduleTrack', () => {
  function setup(overrides: Partial<AudioTrack> = {}) {
    const ctx = new FakeAudioContext({ sampleRate: 48000 })
    const track = makeTrack(overrides)
    const chain = createTrackNodes(ctx, track)
    const buffer = new FakeAudioBuffer(2, 48000 * 10, 48000) // 10 秒
    return { ctx, track, chain, buffer }
  }

  it('应创建并启动缓冲源', () => {
    const { ctx, track, chain, buffer } = setup()
    const handle = scheduleTrack(ctx, chain, buffer, track, 1)
    expect(handle).not.toBeNull()
    const src = handle!.source as unknown as FakeAudioBufferSourceNode
    expect(src.startArgs).not.toBeNull()
  })

  it('应把源连接到轨道入口', () => {
    const { ctx, track, chain, buffer } = setup()
    const handle = scheduleTrack(ctx, chain, buffer, track, 0)
    expect((handle!.source as unknown as FakeAudioBufferSourceNode).outputs).toContain(
      chain.input,
    )
  })

  it('应按入出点裁剪 start 参数', () => {
    const { ctx, track, chain, buffer } = setup({
      inPointUs: 2_000_000n,
      outPointUs: 5_000_000n,
    })
    const handle = scheduleTrack(ctx, chain, buffer, track, 1)
    const args = (handle!.source as unknown as FakeAudioBufferSourceNode).startArgs
    expect(args?.when).toBe(1)
    expect(args?.offset).toBe(2)
    expect(args?.duration).toBe(3)
  })

  it('应正确计算结束时间', () => {
    const { ctx, track, chain, buffer } = setup({ outPointUs: 4_000_000n })
    const handle = scheduleTrack(ctx, chain, buffer, track, 2)
    expect(handle!.endTime).toBe(6)
    expect(handle!.startTime).toBe(2)
    expect(handle!.duration).toBe(4)
  })

  it('窗口无效时应返回 null', () => {
    const { ctx, track, chain, buffer } = setup({ inPointUs: 20_000_000n })
    expect(scheduleTrack(ctx, chain, buffer, track, 0)).toBeNull()
  })

  it('应携带 trackId', () => {
    const { ctx, track, chain, buffer } = setup({ id: 'abc' })
    expect(scheduleTrack(ctx, chain, buffer, track, 0)!.trackId).toBe('abc')
  })
})

// ============================================================================
// stopSource / isSourceFinished 测试
// ============================================================================

describe('stopSource', () => {
  it('应停止并断开源', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack()
    const chain = createTrackNodes(ctx, track)
    const buffer = new FakeAudioBuffer(2, 48000, 48000)
    const handle = scheduleTrack(ctx, chain, buffer, track, 0)!
    const src = handle.source as unknown as FakeAudioBufferSourceNode

    stopSource(handle)
    expect(src.stopCount).toBe(1)
    expect(src.disconnected).toBe(true)
  })

  it('重复停止不应抛异常', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack()
    const chain = createTrackNodes(ctx, track)
    const buffer = new FakeAudioBuffer(2, 48000, 48000)
    const handle = scheduleTrack(ctx, chain, buffer, track, 0)!
    stopSource(handle)
    expect(() => stopSource(handle)).not.toThrow()
  })
})

describe('isSourceFinished', () => {
  it('未到结束时间应为 false', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack()
    const chain = createTrackNodes(ctx, track)
    const buffer = new FakeAudioBuffer(2, 48000 * 4, 48000)
    const handle = scheduleTrack(ctx, chain, buffer, track, 1)!
    expect(isSourceFinished(handle, 2)).toBe(false)
  })

  it('到达结束时间应为 true', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack()
    const chain = createTrackNodes(ctx, track)
    const buffer = new FakeAudioBuffer(2, 48000 * 4, 48000)
    const handle = scheduleTrack(ctx, chain, buffer, track, 1)!
    expect(isSourceFinished(handle, 5)).toBe(true)
  })

  it('恰好在结束时刻应为 true', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack()
    const chain = createTrackNodes(ctx, track)
    const buffer = new FakeAudioBuffer(2, 48000 * 4, 48000)
    const handle = scheduleTrack(ctx, chain, buffer, track, 1)!
    expect(isSourceFinished(handle, handle.endTime)).toBe(true)
  })
})
