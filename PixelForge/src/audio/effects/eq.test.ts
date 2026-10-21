import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EQ_PARAMS,
  clampEqParams,
  computeEqGainDb,
  computeEqGainLinear,
  highBandWeight,
  lowBandWeight,
  sampleEqResponse,
} from '@/audio/effects/eq'

// ============================================================================
// clampEqParams 测试
// ============================================================================

describe('clampEqParams', () => {
  it('默认参数应原样保留', () => {
    expect(clampEqParams(DEFAULT_EQ_PARAMS)).toEqual(DEFAULT_EQ_PARAMS)
  })

  it('增益应被限制在 ±24dB', () => {
    const p = clampEqParams({ ...DEFAULT_EQ_PARAMS, lowGainDb: 100, highGainDb: -100 })
    expect(p.lowGainDb).toBe(24)
    expect(p.highGainDb).toBe(-24)
  })

  it('NaN 应回落到默认值', () => {
    const p = clampEqParams({ ...DEFAULT_EQ_PARAMS, midGainDb: Number.NaN })
    expect(p.midGainDb).toBe(0)
  })

  it('分频点乱序时应被修正为升序', () => {
    const p = clampEqParams({ ...DEFAULT_EQ_PARAMS, lowFreqHz: 8000, highFreqHz: 250 })
    expect(p.highFreqHz).toBeGreaterThan(p.lowFreqHz)
  })

  it('分频点相等时应被拉开而不是保持相等', () => {
    const p = clampEqParams({ ...DEFAULT_EQ_PARAMS, lowFreqHz: 1000, highFreqHz: 1000 })
    expect(p.highFreqHz).toBeGreaterThan(p.lowFreqHz)
  })

  it('频率应在 20~20000Hz 内', () => {
    const p = clampEqParams({ ...DEFAULT_EQ_PARAMS, lowFreqHz: 1, highFreqHz: 99999 })
    expect(p.lowFreqHz).toBeGreaterThanOrEqual(20)
    expect(p.highFreqHz).toBeLessThanOrEqual(20000)
  })
})

// ============================================================================
// 频段权重测试
// ============================================================================

describe('lowBandWeight', () => {
  it('远低于分频点时应接近 1', () => {
    expect(lowBandWeight(10, 1000)).toBeGreaterThan(0.99)
  })

  it('远高于分频点时应接近 0', () => {
    expect(lowBandWeight(10000, 1000)).toBeLessThan(0.01)
  })

  it('等于分频点时应为 0.5', () => {
    expect(lowBandWeight(1000, 1000)).toBeCloseTo(0.5, 10)
  })

  it('应随频率单调递减', () => {
    let prev = 1
    for (const f of [50, 100, 250, 500, 1000, 2000]) {
      const w = lowBandWeight(f, 500)
      expect(w).toBeLessThanOrEqual(prev)
      prev = w
    }
  })

  it('频率为 0 时应为 1(全低频)', () => {
    expect(lowBandWeight(0, 500)).toBe(1)
  })
})

describe('highBandWeight', () => {
  it('远高于分频点时应接近 1', () => {
    expect(highBandWeight(20000, 1000)).toBeGreaterThan(0.99)
  })

  it('远低于分频点时应接近 0', () => {
    expect(highBandWeight(50, 1000)).toBeLessThan(0.01)
  })

  it('等于分频点时应为 0.5', () => {
    expect(highBandWeight(1000, 1000)).toBeCloseTo(0.5, 10)
  })

  it('应随频率单调递增', () => {
    let prev = 0
    for (const f of [50, 100, 250, 500, 1000, 2000]) {
      const w = highBandWeight(f, 500)
      expect(w).toBeGreaterThanOrEqual(prev)
      prev = w
    }
  })
})

// ============================================================================
// computeEqGainDb 测试
// ============================================================================

describe('computeEqGainDb', () => {
  it('全平设置下任意频点应为 0dB', () => {
    for (const f of [20, 100, 1000, 10000]) {
      expect(computeEqGainDb(DEFAULT_EQ_PARAMS, f)).toBeCloseTo(0, 10)
    }
  })

  it('提升低频应只在低频生效', () => {
    const params = { ...DEFAULT_EQ_PARAMS, lowGainDb: 6 }
    expect(computeEqGainDb(params, 50)).toBeGreaterThan(5)
    expect(computeEqGainDb(params, 8000)).toBeLessThan(0.1)
  })

  it('提升高频应只在高频生效', () => {
    const params = { ...DEFAULT_EQ_PARAMS, highGainDb: 6 }
    expect(computeEqGainDb(params, 10000)).toBeGreaterThan(5)
    expect(computeEqGainDb(params, 50)).toBeLessThan(0.1)
  })

  it('提升中频应在中频最明显', () => {
    const params = { ...DEFAULT_EQ_PARAMS, midGainDb: 6 }
    const mid = computeEqGainDb(params, 1000)
    expect(mid).toBeGreaterThan(computeEqGainDb(params, 50))
    expect(mid).toBeGreaterThan(computeEqGainDb(params, 15000))
  })

  it('衰减低频应产生负增益', () => {
    const params = { ...DEFAULT_EQ_PARAMS, lowGainDb: -12 }
    expect(computeEqGainDb(params, 50)).toBeLessThan(-10)
  })

  it('增益不应超出设置的极值(权重归一化)', () => {
    const params = { ...DEFAULT_EQ_PARAMS, lowGainDb: 24 }
    for (const f of [20, 100, 1000, 10000, 20000]) {
      const g = computeEqGainDb(params, f)
      expect(g).toBeLessThanOrEqual(24.0001)
      expect(g).toBeGreaterThanOrEqual(-24.0001)
    }
  })

  it('三段同时等量提升时任意频点都应等于该量', () => {
    const params = {
      ...DEFAULT_EQ_PARAMS,
      lowGainDb: 6,
      midGainDb: 6,
      highGainDb: 6,
    }
    for (const f of [50, 500, 5000]) {
      expect(computeEqGainDb(params, f)).toBeCloseTo(6, 6)
    }
  })

  it('非法频率应返回 0', () => {
    expect(computeEqGainDb({ ...DEFAULT_EQ_PARAMS, lowGainDb: 6 }, 0)).toBe(0)
    expect(computeEqGainDb({ ...DEFAULT_EQ_PARAMS, lowGainDb: 6 }, Number.NaN)).toBe(0)
  })
})

describe('computeEqGainLinear', () => {
  it('0dB 应为单位增益', () => {
    expect(computeEqGainLinear(DEFAULT_EQ_PARAMS, 1000)).toBeCloseTo(1, 10)
  })

  it('+6dB 应约为 2 倍', () => {
    const params = { ...DEFAULT_EQ_PARAMS, lowGainDb: 6 }
    expect(computeEqGainLinear(params, 50)).toBeGreaterThan(1.8)
  })
})

// ============================================================================
// sampleEqResponse 测试
// ============================================================================

describe('sampleEqResponse', () => {
  it('应返回指定数量的采样点', () => {
    expect(sampleEqResponse(DEFAULT_EQ_PARAMS, 32)).toHaveLength(32)
  })

  it('采样点数不足应返回空数组', () => {
    expect(sampleEqResponse(DEFAULT_EQ_PARAMS, 1)).toEqual([])
  })

  it('频率应按对数分布且覆盖起止范围', () => {
    const points = sampleEqResponse(DEFAULT_EQ_PARAMS, 16, 20, 20000)
    expect(points[0].freqHz).toBeCloseTo(20, 6)
    expect(points[points.length - 1].freqHz).toBeCloseTo(20000, 6)
    // 对数分布:相邻间隔应递增
    const gap1 = points[1].freqHz - points[0].freqHz
    const gapLast = points[15].freqHz - points[14].freqHz
    expect(gapLast).toBeGreaterThan(gap1)
  })

  it('全平设置下所有采样点应为 0dB', () => {
    const points = sampleEqResponse(DEFAULT_EQ_PARAMS, 16)
    for (const p of points) {
      expect(p.gainDb).toBeCloseTo(0, 10)
    }
  })
})
