import { describe, expect, it } from 'vitest'

import {
  applyHardClip,
  applyLimiter,
  computeMasterGain,
  computeTrackGain,
  computeTrackGains,
  isTrackAudible,
  resolveAudibleTracks,
  sumStereo,
} from '@/audio/core/mixer'
import { dbToLinear } from '@/audio/core/units'
import type { AudioTrack, MasterBus } from '@/audio/core/types'

// ============================================================================
// 测试辅助
// ============================================================================

function makeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 't1',
    name: 'Track 1',
    assetId: 'asset-1',
    startTimeUs: 0n,
    inPointUs: 0n,
    outPointUs: 10_000_000n,
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    effects: [],
    ...overrides,
  }
}

function makeMaster(overrides: Partial<MasterBus> = {}): MasterBus {
  return {
    gainDb: 0,
    pan: 0,
    limiterEnabled: false,
    ceilingDb: -1,
    effects: [],
    ...overrides,
  }
}

// ============================================================================
// isTrackAudible 测试
// ============================================================================

describe('isTrackAudible', () => {
  it('无 solo 时未 mute 的轨道应可听', () => {
    expect(isTrackAudible(makeTrack(), false)).toBe(true)
  })

  it('muted 的轨道应不可听', () => {
    expect(isTrackAudible(makeTrack({ muted: true }), false)).toBe(false)
  })

  it('有 solo 存在时非 solo 轨道应不可听', () => {
    expect(isTrackAudible(makeTrack({ soloed: false }), true)).toBe(false)
  })

  it('有 solo 存在时 solo 轨道应可听', () => {
    expect(isTrackAudible(makeTrack({ soloed: true }), true)).toBe(true)
  })

  it('solo 与 mute 同时为真时不可听(mute 优先级更高)', () => {
    expect(isTrackAudible(makeTrack({ soloed: true, muted: true }), true)).toBe(false)
  })
})

// ============================================================================
// resolveAudibleTracks 测试
// ============================================================================

describe('resolveAudibleTracks', () => {
  it('无 solo 时应返回所有未 mute 的轨道', () => {
    const tracks = [
      makeTrack({ id: 'a' }),
      makeTrack({ id: 'b', muted: true }),
      makeTrack({ id: 'c' }),
    ]
    expect(resolveAudibleTracks(tracks).map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('存在 solo 时应只返回 solo 轨道', () => {
    const tracks = [
      makeTrack({ id: 'a' }),
      makeTrack({ id: 'b', soloed: true }),
      makeTrack({ id: 'c' }),
    ]
    expect(resolveAudibleTracks(tracks).map((t) => t.id)).toEqual(['b'])
  })

  it('多个 solo 应全部返回', () => {
    const tracks = [
      makeTrack({ id: 'a', soloed: true }),
      makeTrack({ id: 'b' }),
      makeTrack({ id: 'c', soloed: true }),
    ]
    expect(resolveAudibleTracks(tracks).map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('全部 mute 时应返回空数组', () => {
    const tracks = [
      makeTrack({ id: 'a', muted: true }),
      makeTrack({ id: 'b', muted: true }),
    ]
    expect(resolveAudibleTracks(tracks)).toHaveLength(0)
  })

  it('solo 轨道自身 mute 时应被排除', () => {
    const tracks = [
      makeTrack({ id: 'a', soloed: true, muted: true }),
      makeTrack({ id: 'b' }),
    ]
    expect(resolveAudibleTracks(tracks)).toHaveLength(0)
  })

  it('空数组应返回空数组', () => {
    expect(resolveAudibleTracks([])).toEqual([])
  })

  it('应保持原顺序', () => {
    const tracks = [
      makeTrack({ id: 'c' }),
      makeTrack({ id: 'a' }),
      makeTrack({ id: 'b' }),
    ]
    expect(resolveAudibleTracks(tracks).map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })
})

// ============================================================================
// computeTrackGain 测试
// ============================================================================

describe('computeTrackGain', () => {
  it('0dB 居中应为等功率增益', () => {
    const g = computeTrackGain(makeTrack({ gainDb: 0, pan: 0 }))
    expect(g.left).toBeCloseTo(Math.SQRT1_2, 6)
    expect(g.right).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('增益应线性反映 dB 值', () => {
    const g0 = computeTrackGain(makeTrack({ gainDb: 0, pan: -1 }))
    const g6 = computeTrackGain(makeTrack({ gainDb: 6, pan: -1 }))
    expect(g6.left / g0.left).toBeCloseTo(dbToLinear(6), 6)
  })

  it('极左时右声道应为 0', () => {
    const g = computeTrackGain(makeTrack({ pan: -1 }))
    expect(g.right).toBeCloseTo(0, 10)
  })

  it('静音阈值以下增益应归零', () => {
    const g = computeTrackGain(makeTrack({ gainDb: -60 }))
    expect(g.left).toBe(0)
    expect(g.right).toBe(0)
  })

  it('超出上限的增益应被 clamp', () => {
    const g = computeTrackGain(makeTrack({ gainDb: 100 }))
    expect(g.left).toBeCloseTo(dbToLinear(12) * Math.SQRT1_2, 6)
  })
})

describe('computeMasterGain', () => {
  it('默认应为等功率居中增益', () => {
    const g = computeMasterGain(makeMaster())
    expect(g.left).toBeCloseTo(Math.SQRT1_2, 6)
    expect(g.right).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('应反映总线增益', () => {
    const g = computeMasterGain(makeMaster({ gainDb: -6, pan: 0 }))
    expect(g.left).toBeCloseTo(dbToLinear(-6) * Math.SQRT1_2, 6)
  })
})

// ============================================================================
// computeTrackGains 测试
// ============================================================================

describe('computeTrackGains', () => {
  it('应只包含可听轨道', () => {
    const tracks = [
      makeTrack({ id: 'a' }),
      makeTrack({ id: 'b', muted: true }),
    ]
    const gains = computeTrackGains(tracks, makeMaster())
    expect(gains.map((g) => g.trackId)).toEqual(['a'])
  })

  it('应叠加主输出总线增益', () => {
    const tracks = [makeTrack({ id: 'a', gainDb: 0, pan: -1 })]
    const withMaster = computeTrackGains(tracks, makeMaster({ gainDb: -6, pan: 0 }))
    const trackOnly = computeTrackGain(tracks[0])
    const masterOnly = computeMasterGain(makeMaster({ gainDb: -6, pan: 0 }))
    expect(withMaster[0].left).toBeCloseTo(trackOnly.left * masterOnly.left, 10)
  })

  it('总线增益为 0dB 居中时不应改变相对关系', () => {
    const tracks = [makeTrack({ id: 'a' }), makeTrack({ id: 'b', gainDb: 6 })]
    const gains = computeTrackGains(tracks, makeMaster())
    expect(gains[1].left).toBeGreaterThan(gains[0].left)
  })

  it('空轨道应返回空数组', () => {
    expect(computeTrackGains([], makeMaster())).toEqual([])
  })
})

// ============================================================================
// sumStereo 测试
// ============================================================================

describe('sumStereo', () => {
  it('应加权求和', () => {
    const result = sumStereo(
      [{ left: 1, right: 0.5 }],
      [{ left: 0.5, right: 0.5 }],
    )
    expect(result.left).toBeCloseTo(0.5, 10)
    expect(result.right).toBeCloseTo(0.25, 10)
  })

  it('多轨应累加', () => {
    const result = sumStereo(
      [
        { left: 1, right: 1 },
        { left: 0.5, right: 0.25 },
      ],
      [
        { left: 1, right: 1 },
        { left: 1, right: 1 },
      ],
    )
    expect(result.left).toBeCloseTo(1.5, 10)
    expect(result.right).toBeCloseTo(1.25, 10)
  })

  it('长度不一致时应按较短者计算', () => {
    const result = sumStereo([{ left: 1, right: 1 }], [])
    expect(result.left).toBe(0)
    expect(result.right).toBe(0)
  })

  it('空输入应为零', () => {
    expect(sumStereo([], [])).toEqual({ left: 0, right: 0 })
  })
})

// ============================================================================
// 限幅器测试
// ============================================================================

describe('applyLimiter', () => {
  it('未超过天花板应原样返回', () => {
    expect(applyLimiter(0.5, 1)).toBeCloseTo(0.5, 10)
  })

  it('超过天花板应被压缩而不是硬截断', () => {
    const out = applyLimiter(2, 1)
    expect(out).toBeLessThan(2)
    expect(out).toBeGreaterThan(0.5)
  })

  it('输出绝不能超过天花板(限幅器的核心承诺)', () => {
    for (const input of [1, 1.5, 2, 10, 100, -100]) {
      expect(Math.abs(applyLimiter(input, 1))).toBeLessThanOrEqual(1.0000001)
    }
  })

  it('天花板为 0.5 时输出也不应超过 0.5', () => {
    expect(Math.abs(applyLimiter(10, 0.5))).toBeLessThanOrEqual(0.5000001)
  })

  it('拐点以下应完全线性(不引入任何音色改变)', () => {
    for (const input of [0, 0.1, 0.3, 0.69]) {
      expect(applyLimiter(input, 1)).toBeCloseTo(input, 10)
    }
  })

  it('压缩结果应随输入单调递增', () => {
    const a = applyLimiter(1.2, 1)
    const b = applyLimiter(2.0, 1)
    expect(b).toBeGreaterThan(a)
  })

  it('应保留符号', () => {
    expect(applyLimiter(-2, 1)).toBeLessThan(0)
  })

  it('天花板为 0 时应返回 0', () => {
    expect(applyLimiter(1, 0)).toBe(0)
  })

  it('NaN 应返回 0', () => {
    expect(applyLimiter(Number.NaN, 1)).toBe(0)
  })

  it('软限幅失真应小于硬截断(输出更接近原始比例)', () => {
    const soft = applyLimiter(1.5, 1)
    const softA = applyLimiter(1.2, 1)
    const hard = applyHardClip(1.5, 1)
    // 软限幅保留 1.5 与 1.2 的差异,硬截断则两者都变成 1
    expect(soft).toBeGreaterThan(softA)
    expect(hard).toBe(1)
  })
})

describe('applyHardClip', () => {
  it('应截断到天花板', () => {
    expect(applyHardClip(2, 1)).toBe(1)
    expect(applyHardClip(-2, 1)).toBe(-1)
  })

  it('未超过时不改变', () => {
    expect(applyHardClip(0.5, 1)).toBe(0.5)
  })

  it('NaN 应返回 0', () => {
    expect(applyHardClip(Number.NaN, 1)).toBe(0)
  })
})
