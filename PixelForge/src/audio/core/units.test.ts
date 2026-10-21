import { describe, expect, it } from 'vitest'

import {
  GAIN_DB_MAX,
  GAIN_DB_MIN,
  SILENCE_DB,
  applyGainDb,
  applyGainToSample,
  clamp,
  clampGainDb,
  clampPan,
  dbToLinear,
  linearToDb,
  normalizeAmplitude,
  panToGainPair,
  panToGainPairLinear,
} from '@/audio/core/units'

// ============================================================================
// dbToLinear 测试
// ============================================================================

describe('dbToLinear', () => {
  it('0dB 应等于单位增益', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 10)
  })

  it('+6dB 应约等于 2 倍幅度', () => {
    expect(dbToLinear(6)).toBeCloseTo(1.9953, 3)
  })

  it('-6dB 应约等于 0.5 倍幅度', () => {
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3)
  })

  it('+20dB 应等于 10 倍幅度', () => {
    expect(dbToLinear(20)).toBeCloseTo(10, 6)
  })

  it('-20dB 应等于 0.1 倍幅度', () => {
    expect(dbToLinear(-20)).toBeCloseTo(0.1, 6)
  })

  it('负无穷应返回 0', () => {
    expect(dbToLinear(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('低于静音阈值应返回 0', () => {
    expect(dbToLinear(SILENCE_DB)).toBe(0)
    expect(dbToLinear(SILENCE_DB - 10)).toBe(0)
  })

  it('NaN 应返回 0', () => {
    expect(dbToLinear(Number.NaN)).toBe(0)
  })

  it('正增益应大于 1,负增益应小于 1', () => {
    expect(dbToLinear(3)).toBeGreaterThan(1)
    expect(dbToLinear(-3)).toBeLessThan(1)
  })
})

// ============================================================================
// linearToDb 测试
// ============================================================================

describe('linearToDb', () => {
  it('单位增益应为 0dB', () => {
    expect(linearToDb(1)).toBeCloseTo(0, 10)
  })

  it('2 倍幅度应约为 +6dB', () => {
    expect(linearToDb(2)).toBeCloseTo(6.0206, 3)
  })

  it('0.5 倍幅度应约为 -6dB', () => {
    expect(linearToDb(0.5)).toBeCloseTo(-6.0206, 3)
  })

  it('0 应返回负无穷', () => {
    expect(linearToDb(0)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('负值应返回负无穷', () => {
    expect(linearToDb(-0.5)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('NaN 应返回负无穷', () => {
    expect(linearToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY)
  })

  it('与 dbToLinear 应可逆(在可表示范围内)', () => {
    for (const db of [-40, -24, -12, -6, 0, 6, 12]) {
      expect(linearToDb(dbToLinear(db))).toBeCloseTo(db, 6)
    }
  })
})

// ============================================================================
// clamp 测试
// ============================================================================

describe('clamp', () => {
  it('区间内应原样返回', () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })

  it('超出上界应取上界', () => {
    expect(clamp(2, 0, 1)).toBe(1)
  })

  it('低于下界应取下界', () => {
    expect(clamp(-2, 0, 1)).toBe(0)
  })

  it('NaN 应返回下界', () => {
    expect(clamp(Number.NaN, -1, 1)).toBe(-1)
  })
})

describe('clampGainDb', () => {
  it('应限制在增益区间内', () => {
    expect(clampGainDb(100)).toBe(GAIN_DB_MAX)
    expect(clampGainDb(-100)).toBe(GAIN_DB_MIN)
  })

  it('合法值应原样返回', () => {
    expect(clampGainDb(6)).toBe(6)
  })

  it('负无穷应取增益下限', () => {
    expect(clampGainDb(Number.NEGATIVE_INFINITY)).toBe(GAIN_DB_MIN)
  })

  it('NaN 应取增益下限', () => {
    expect(clampGainDb(Number.NaN)).toBe(GAIN_DB_MIN)
  })
})

describe('clampPan', () => {
  it('应限制在 [-1, 1]', () => {
    expect(clampPan(5)).toBe(1)
    expect(clampPan(-5)).toBe(-1)
  })

  it('合法值应原样返回', () => {
    expect(clampPan(-0.3)).toBe(-0.3)
  })

  it('NaN 应返回 0(居中)', () => {
    expect(clampPan(Number.NaN)).toBe(0)
  })
})

// ============================================================================
// applyGainDb 测试
// ============================================================================

describe('applyGainDb', () => {
  it('应叠加增益', () => {
    expect(applyGainDb(0, 6)).toBe(6)
    expect(applyGainDb(6, -3)).toBe(3)
  })

  it('叠加后应被 clamp', () => {
    expect(applyGainDb(GAIN_DB_MAX, 10)).toBe(GAIN_DB_MAX)
    expect(applyGainDb(GAIN_DB_MIN, -10)).toBe(GAIN_DB_MIN)
  })
})

describe('applyGainToSample', () => {
  it('0dB 应不改变采样值', () => {
    expect(applyGainToSample(0.5, 0)).toBeCloseTo(0.5, 10)
  })

  it('+6dB 应约放大 2 倍', () => {
    expect(applyGainToSample(0.5, 6)).toBeCloseTo(0.9976, 3)
  })

  it('静音阈值以下应归零', () => {
    expect(applyGainToSample(0.5, SILENCE_DB)).toBe(0)
  })
})

// ============================================================================
// panToGainPair 测试
// ============================================================================

describe('panToGainPair', () => {
  it('极左应只有左声道', () => {
    const g = panToGainPair(-1)
    expect(g.left).toBeCloseTo(1, 6)
    expect(g.right).toBeCloseTo(0, 6)
  })

  it('极右应只有右声道', () => {
    const g = panToGainPair(1)
    expect(g.left).toBeCloseTo(0, 6)
    expect(g.right).toBeCloseTo(1, 6)
  })

  it('居中应左右相等', () => {
    const g = panToGainPair(0)
    expect(g.left).toBeCloseTo(g.right, 10)
  })

  it('居中时单声道应约为 0.707(等功率律)', () => {
    const g = panToGainPair(0)
    expect(g.left).toBeCloseTo(Math.SQRT1_2, 6)
    expect(g.right).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('等功率律应保持总功率恒定', () => {
    for (const pan of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
      const g = panToGainPair(pan)
      // cos² + sin² = 1
      expect(g.left * g.left + g.right * g.right).toBeCloseTo(1, 6)
    }
  })

  it('越界声像应被 clamp 而不是产生非法增益', () => {
    const g = panToGainPair(3)
    expect(g.left).toBeCloseTo(0, 6)
    expect(g.right).toBeCloseTo(1, 6)
  })

  it('左偏时左声道应大于右声道', () => {
    const g = panToGainPair(-0.5)
    expect(g.left).toBeGreaterThan(g.right)
  })

  it('右偏时右声道应大于左声道', () => {
    const g = panToGainPair(0.5)
    expect(g.right).toBeGreaterThan(g.left)
  })

  it('等功率律在中间位置的功率应高于线性律', () => {
    const eq = panToGainPair(0)
    const lin = panToGainPairLinear(0)
    const eqPower = eq.left * eq.left + eq.right * eq.right
    const linPower = lin.left * lin.left + lin.right * lin.right
    expect(eqPower).toBeGreaterThan(linPower)
  })
})

describe('panToGainPairLinear', () => {
  it('居中应左右各 0.5', () => {
    const g = panToGainPairLinear(0)
    expect(g.left).toBeCloseTo(0.5, 10)
    expect(g.right).toBeCloseTo(0.5, 10)
  })

  it('极左与极右应与等功率律一致', () => {
    expect(panToGainPairLinear(-1).left).toBeCloseTo(1, 10)
    expect(panToGainPairLinear(1).right).toBeCloseTo(1, 10)
  })
})

// ============================================================================
// normalizeAmplitude 测试
// ============================================================================

describe('normalizeAmplitude', () => {
  it('应取绝对值', () => {
    expect(normalizeAmplitude(-0.5)).toBe(0.5)
  })

  it('超出 1 应截断为 1', () => {
    expect(normalizeAmplitude(1.5)).toBe(1)
  })

  it('NaN 应返回 0', () => {
    expect(normalizeAmplitude(Number.NaN)).toBe(0)
  })
})
