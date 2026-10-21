import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GAIN_PARAMS,
  FADE_CURVE,
  FADE_CURVE_LABELS,
  applyFadeCurve,
  applyGainEnvelope,
  clampGainParams,
  type FadeCurve,
  computeFadeMultiplier,
  computeFadeTimeAt,
  computeTotalGainLinear,
} from '@/audio/effects/gain'

// ============================================================================
// clampGainParams 测试
// ============================================================================

describe('clampGainParams', () => {
  it('默认参数应原样保留', () => {
    expect(clampGainParams(DEFAULT_GAIN_PARAMS)).toEqual(DEFAULT_GAIN_PARAMS)
  })

  it('增益应被限制在 -60~+12dB', () => {
    expect(clampGainParams({ ...DEFAULT_GAIN_PARAMS, gainDb: 99 }).gainDb).toBe(12)
    expect(clampGainParams({ ...DEFAULT_GAIN_PARAMS, gainDb: -99 }).gainDb).toBe(-60)
  })

  it('淡变时长不应为负', () => {
    const p = clampGainParams({ ...DEFAULT_GAIN_PARAMS, fadeInMs: -5, fadeOutMs: -10 })
    expect(p.fadeInMs).toBe(0)
    expect(p.fadeOutMs).toBe(0)
  })

  it('曲线类型应在 0~2', () => {
    // 故意传入越界值验证 clamp,故需要断言类型
    expect(clampGainParams({ ...DEFAULT_GAIN_PARAMS, fadeCurve: 99 as FadeCurve }).fadeCurve).toBe(2)
    expect(clampGainParams({ ...DEFAULT_GAIN_PARAMS, fadeCurve: -1 as FadeCurve }).fadeCurve).toBe(0)
  })

  it('NaN 增益应回落到 -60dB', () => {
    expect(clampGainParams({ ...DEFAULT_GAIN_PARAMS, gainDb: Number.NaN }).gainDb).toBe(-60)
  })
})

describe('FADE_CURVE_LABELS', () => {
  it('三种曲线都应有显示名', () => {
    expect(FADE_CURVE_LABELS[FADE_CURVE.LINEAR]).toBeTruthy()
    expect(FADE_CURVE_LABELS[FADE_CURVE.EXPONENTIAL]).toBeTruthy()
    expect(FADE_CURVE_LABELS[FADE_CURVE.SCURVE]).toBeTruthy()
  })
})

// ============================================================================
// applyFadeCurve 测试
// ============================================================================

describe('applyFadeCurve', () => {
  it('所有曲线的端点都应严格为 0 和 1', () => {
    for (const curve of [FADE_CURVE.LINEAR, FADE_CURVE.EXPONENTIAL, FADE_CURVE.SCURVE]) {
      expect(applyFadeCurve(0, curve)).toBeCloseTo(0, 10)
      expect(applyFadeCurve(1, curve)).toBeCloseTo(1, 6)
    }
  })

  it('线性曲线在中点应为 0.5', () => {
    expect(applyFadeCurve(0.5, FADE_CURVE.LINEAR)).toBeCloseTo(0.5, 10)
  })

  it('S 曲线在中点应为 0.5', () => {
    expect(applyFadeCurve(0.5, FADE_CURVE.SCURVE)).toBeCloseTo(0.5, 10)
  })

  it('指数曲线在中点应大于 0.5(先快后慢)', () => {
    expect(applyFadeCurve(0.5, FADE_CURVE.EXPONENTIAL)).toBeGreaterThan(0.5)
  })

  it('越界输入应被 clamp', () => {
    expect(applyFadeCurve(2, FADE_CURVE.LINEAR)).toBe(1)
    expect(applyFadeCurve(-1, FADE_CURVE.LINEAR)).toBe(0)
  })

  it('NaN 应视为 0', () => {
    expect(applyFadeCurve(Number.NaN, FADE_CURVE.LINEAR)).toBe(0)
  })

  it('所有曲线都应单调递增', () => {
    for (const curve of [FADE_CURVE.LINEAR, FADE_CURVE.EXPONENTIAL, FADE_CURVE.SCURVE]) {
      let prev = -1
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const v = applyFadeCurve(t, curve)
        expect(v).toBeGreaterThanOrEqual(prev)
        prev = v
      }
    }
  })
})

// ============================================================================
// computeFadeMultiplier 测试
// ============================================================================

describe('computeFadeMultiplier', () => {
  const total = 10000 // 10 秒素材

  it('无淡变时全程应为 1', () => {
    expect(computeFadeMultiplier(DEFAULT_GAIN_PARAMS, 0, total)).toBe(1)
    expect(computeFadeMultiplier(DEFAULT_GAIN_PARAMS, 5000, total)).toBe(1)
    expect(computeFadeMultiplier(DEFAULT_GAIN_PARAMS, total, total)).toBe(1)
  })

  it('淡入起点应为 0,终点应为 1', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, fadeInMs: 2000 }
    expect(computeFadeMultiplier(p, 0, total)).toBeCloseTo(0, 6)
    expect(computeFadeMultiplier(p, 2000, total)).toBeCloseTo(1, 6)
  })

  it('淡入过程中应递增', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, fadeInMs: 2000 }
    let prev = -1
    for (const t of [0, 500, 1000, 1500, 2000]) {
      const v = computeFadeMultiplier(p, t, total)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('淡出起点应为 1,终点应为 0', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, fadeOutMs: 2000 }
    expect(computeFadeMultiplier(p, 8000, total)).toBeCloseTo(1, 6)
    expect(computeFadeMultiplier(p, total, total)).toBeCloseTo(0, 6)
  })

  it('淡出过程中应递减', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, fadeOutMs: 2000 }
    let prev = 2
    for (const t of [8000, 8500, 9000, 9500, 10000]) {
      const v = computeFadeMultiplier(p, t, total)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
  })

  it('区间外应返回 0', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, fadeInMs: 1000 }
    expect(computeFadeMultiplier(p, -1, total)).toBe(0)
    expect(computeFadeMultiplier(p, total + 1, total)).toBe(0)
  })

  it('淡入淡出重叠时应取乘积,保证末尾归零', () => {
    // 素材 1000ms,淡入 800ms、淡出 800ms,必然重叠
    const p = { ...DEFAULT_GAIN_PARAMS, fadeInMs: 800, fadeOutMs: 800 }
    const atEnd = computeFadeMultiplier(p, 1000, 1000)
    expect(atEnd).toBeCloseTo(0, 6)
  })

  it('非法总时长应返回 0', () => {
    expect(computeFadeMultiplier(DEFAULT_GAIN_PARAMS, 100, 0)).toBe(0)
    expect(computeFadeMultiplier(DEFAULT_GAIN_PARAMS, 100, Number.NaN)).toBe(0)
  })

  it('结果应始终在 0~1', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, fadeInMs: 3000, fadeOutMs: 3000 }
    for (let t = 0; t <= 10000; t += 250) {
      const v = computeFadeMultiplier(p, t, 10000)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

// ============================================================================
// computeTotalGainLinear 测试
// ============================================================================

describe('computeTotalGainLinear', () => {
  it('0dB 无淡变时应为 1', () => {
    expect(computeTotalGainLinear(DEFAULT_GAIN_PARAMS, 1000, 10000)).toBeCloseTo(1, 10)
  })

  it('+6dB 时应约为 2 倍', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, gainDb: 6 }
    expect(computeTotalGainLinear(p, 1000, 10000)).toBeCloseTo(1.9953, 3)
  })

  it('淡入期间应小于静态增益', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, gainDb: 6, fadeInMs: 2000 }
    expect(computeTotalGainLinear(p, 1000, 10000)).toBeLessThan(1.9953)
  })

  it('静音阈值以下应为 0', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, gainDb: -60 }
    expect(computeTotalGainLinear(p, 1000, 10000)).toBe(0)
  })
})

describe('applyGainEnvelope', () => {
  it('单位增益应不改变采样值', () => {
    expect(applyGainEnvelope(0.5, DEFAULT_GAIN_PARAMS, 1000, 10000)).toBeCloseTo(0.5, 10)
  })

  it('应正确叠加增益与包络', () => {
    const p = { ...DEFAULT_GAIN_PARAMS, gainDb: 6, fadeInMs: 2000 }
    const out = applyGainEnvelope(0.5, p, 1000, 10000)
    expect(out).toBeGreaterThan(0)
    expect(out).toBeLessThan(1)
  })

  it('NaN 采样应返回 0', () => {
    expect(applyGainEnvelope(Number.NaN, DEFAULT_GAIN_PARAMS, 1000, 10000)).toBe(0)
  })
})

// ============================================================================
// computeFadeTimeAt 测试
// ============================================================================

describe('computeFadeTimeAt', () => {
  it('比例为 0 时淡入时间应为 0', () => {
    expect(computeFadeTimeAt(0, 2000, FADE_CURVE.LINEAR)).toBeCloseTo(0, 6)
  })

  it('比例为 1 时淡入时间应等于淡变时长', () => {
    expect(computeFadeTimeAt(1, 2000, FADE_CURVE.LINEAR)).toBeCloseTo(2000, 6)
  })

  it('线性曲线中点应落在淡变时长的中点', () => {
    expect(computeFadeTimeAt(0.5, 2000, FADE_CURVE.LINEAR)).toBeCloseTo(1000, 6)
  })

  it('指数曲线达到 0.5 的时间应早于线性(先快后慢)', () => {
    const expTime = computeFadeTimeAt(0.5, 2000, FADE_CURVE.EXPONENTIAL)
    const linTime = computeFadeTimeAt(0.5, 2000, FADE_CURVE.LINEAR)
    expect(expTime).toBeLessThan(linTime)
  })

  it('S 曲线中点应落在中点附近', () => {
    expect(computeFadeTimeAt(0.5, 2000, FADE_CURVE.SCURVE)).toBeCloseTo(1000, 1)
  })

  it('淡出模式应返回距末尾的时间', () => {
    const t = computeFadeTimeAt(0.5, 2000, FADE_CURVE.LINEAR, true)
    expect(t).toBeCloseTo(1000, 6)
  })

  it('求逆结果应与正算一致', () => {
    for (const curve of [FADE_CURVE.LINEAR, FADE_CURVE.EXPONENTIAL, FADE_CURVE.SCURVE]) {
      const t = computeFadeTimeAt(0.3, 3000, curve)
      expect(applyFadeCurve(t / 3000, curve)).toBeCloseTo(0.3, 3)
    }
  })
})
