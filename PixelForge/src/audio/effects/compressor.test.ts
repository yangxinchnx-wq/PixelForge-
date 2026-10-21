import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COMPRESSOR_PARAMS,
  clampCompressorParams,
  computeCompressorOutputDb,
  computeEnvelopeCoef,
  computeEnvelopeCoefs,
  computeGainReductionDb,
  computeMakeupGainDb,
} from '@/audio/effects/compressor'

// ============================================================================
// clampCompressorParams 测试
// ============================================================================

describe('clampCompressorParams', () => {
  it('默认参数应原样保留', () => {
    expect(clampCompressorParams(DEFAULT_COMPRESSOR_PARAMS)).toEqual(
      DEFAULT_COMPRESSOR_PARAMS,
    )
  })

  it('阈值应在 -60~0dB', () => {
    expect(clampCompressorParams({ ...DEFAULT_COMPRESSOR_PARAMS, thresholdDb: 10 }).thresholdDb).toBe(0)
    expect(clampCompressorParams({ ...DEFAULT_COMPRESSOR_PARAMS, thresholdDb: -90 }).thresholdDb).toBe(-60)
  })

  it('压缩比应在 1~20', () => {
    expect(clampCompressorParams({ ...DEFAULT_COMPRESSOR_PARAMS, ratio: 100 }).ratio).toBe(20)
    expect(clampCompressorParams({ ...DEFAULT_COMPRESSOR_PARAMS, ratio: 0.1 }).ratio).toBe(1)
  })

  it('时间参数应在合法区间', () => {
    const p = clampCompressorParams({
      ...DEFAULT_COMPRESSOR_PARAMS,
      attackMs: 9999,
      releaseMs: 0.01,
    })
    expect(p.attackMs).toBe(200)
    expect(p.releaseMs).toBe(10)
  })

  it('拐点应在 0~24dB', () => {
    expect(clampCompressorParams({ ...DEFAULT_COMPRESSOR_PARAMS, kneeDb: 99 }).kneeDb).toBe(24)
  })

  it('NaN 应回落到默认值', () => {
    const p = clampCompressorParams({ ...DEFAULT_COMPRESSOR_PARAMS, ratio: Number.NaN })
    expect(p.ratio).toBe(DEFAULT_COMPRESSOR_PARAMS.ratio)
  })
})

// ============================================================================
// computeGainReductionDb 测试
// ============================================================================

describe('computeGainReductionDb (硬拐点)', () => {
  const hard = { ...DEFAULT_COMPRESSOR_PARAMS, kneeDb: 0 }

  it('低于阈值不应压缩', () => {
    expect(computeGainReductionDb(-30, hard)).toBe(0)
  })

  it('恰好等于阈值不应压缩', () => {
    expect(computeGainReductionDb(-18, hard)).toBe(0)
  })

  it('超出 8dB、比值 4 时应衰减 6dB', () => {
    // 8 × (1 - 1/4) = 6
    expect(computeGainReductionDb(-10, hard)).toBeCloseTo(-6, 6)
  })

  it('比值越大衰减越多', () => {
    const r4 = computeGainReductionDb(-10, { ...hard, ratio: 4 })
    const r8 = computeGainReductionDb(-10, { ...hard, ratio: 8 })
    expect(r8).toBeLessThan(r4)
  })

  it('比值为 1 时不应压缩', () => {
    expect(computeGainReductionDb(0, { ...hard, ratio: 1 })).toBe(0)
  })

  it('衰减量应恒为非正数', () => {
    for (const input of [-60, -40, -20, -10, 0]) {
      expect(computeGainReductionDb(input, hard)).toBeLessThanOrEqual(0)
    }
  })

  it('应随输入电平单调递减(越响压得越多)', () => {
    let prev = 0
    for (const input of [-18, -14, -10, -6, -2]) {
      const gr = computeGainReductionDb(input, hard)
      expect(gr).toBeLessThanOrEqual(prev)
      prev = gr
    }
  })

  it('输入为 NaN 时应返回 0', () => {
    expect(computeGainReductionDb(Number.NaN, hard)).toBe(0)
  })
})

describe('computeGainReductionDb (软拐点)', () => {
  const soft = { ...DEFAULT_COMPRESSOR_PARAMS, kneeDb: 6 } // 拐点区间 [-21, -15]

  it('拐点以下不应压缩', () => {
    expect(computeGainReductionDb(-21, soft)).toBe(0)
  })

  it('拐点区间内应产生部分压缩', () => {
    const gr = computeGainReductionDb(-18, soft)
    expect(gr).toBeLessThan(0)
    // 软拐点在阈值处已提前介入,硬拐点此时仍完全不压缩
    expect(computeGainReductionDb(-18, { ...soft, kneeDb: 0 })).toBe(0)
  })

  it('拐点下半区应提前开始压缩(硬拐点此时仍为 0)', () => {
    // -19 位于 lower(-21) 与 threshold(-18) 之间:软拐点已介入,硬拐点尚未触发
    const softGr = computeGainReductionDb(-19, soft)
    const hardGr = computeGainReductionDb(-19, { ...soft, kneeDb: 0 })
    expect(hardGr).toBe(0)
    expect(softGr).toBeLessThan(0)
  })

  it('拐点起点处斜率应接近 0(平滑进入压缩)', () => {
    const lower = soft.thresholdDb - soft.kneeDb / 2
    const nearStart =
      computeGainReductionDb(lower + 0.5, soft) - computeGainReductionDb(lower, soft)
    const nearEnd =
      computeGainReductionDb(lower + 5.5, soft) - computeGainReductionDb(lower + 5, soft)
    expect(Math.abs(nearStart)).toBeLessThan(Math.abs(nearEnd))
  })

  it('拐点区间应单调递增压缩量', () => {
    let prev = 0
    for (const input of [-21, -20, -19, -18, -17, -16, -15]) {
      const gr = computeGainReductionDb(input, soft)
      expect(gr).toBeLessThanOrEqual(prev + 1e-9)
      prev = gr
    }
  })

  it('拐点上边界处应与硬拐点解连续', () => {
    const upper = soft.thresholdDb + soft.kneeDb / 2 // -15
    const softGr = computeGainReductionDb(upper, soft)
    const hardGr = computeGainReductionDb(upper, { ...soft, kneeDb: 0 })
    expect(softGr).toBeCloseTo(hardGr, 6)
  })

  it('远超拐点后软硬应一致', () => {
    const softGr = computeGainReductionDb(-5, soft)
    const hardGr = computeGainReductionDb(-5, { ...soft, kneeDb: 0 })
    expect(softGr).toBeCloseTo(hardGr, 6)
  })
})

// ============================================================================
// computeCompressorOutputDb 测试
// ============================================================================

describe('computeCompressorOutputDb', () => {
  it('低于阈值时输出应等于输入', () => {
    expect(computeCompressorOutputDb(-30, DEFAULT_COMPRESSOR_PARAMS)).toBeCloseTo(-30, 6)
  })

  it('压缩后输出应低于输入', () => {
    const out = computeCompressorOutputDb(-10, { ...DEFAULT_COMPRESSOR_PARAMS, kneeDb: 0 })
    expect(out).toBeLessThan(-10)
  })

  it('压缩后动态范围应变小', () => {
    const p = { ...DEFAULT_COMPRESSOR_PARAMS, kneeDb: 0, thresholdDb: -20, ratio: 4 }
    const quiet = computeCompressorOutputDb(-30, p)
    const loud = computeCompressorOutputDb(-5, p)
    // 输入相差 25dB,输出相差应明显更小
    expect(loud - quiet).toBeLessThan(25)
  })
})

// ============================================================================
// computeMakeupGainDb 测试
// ============================================================================

describe('computeMakeupGainDb', () => {
  it('比值为 1 时不应补偿', () => {
    expect(computeMakeupGainDb({ ...DEFAULT_COMPRESSOR_PARAMS, ratio: 1 })).toBe(0)
  })

  it('压缩量越大补偿越多', () => {
    const light = computeMakeupGainDb({ ...DEFAULT_COMPRESSOR_PARAMS, ratio: 2, kneeDb: 0 })
    const heavy = computeMakeupGainDb({ ...DEFAULT_COMPRESSOR_PARAMS, ratio: 10, kneeDb: 0 })
    expect(heavy).toBeGreaterThan(light)
  })

  it('补偿应恰好抵消目标电平上的损失', () => {
    const p = { ...DEFAULT_COMPRESSOR_PARAMS, ratio: 4, kneeDb: 0, thresholdDb: -18 }
    const makeup = computeMakeupGainDb(p, -6)
    const out = computeCompressorOutputDb(-6, p) + makeup
    expect(out).toBeCloseTo(-6, 6)
  })
})

// ============================================================================
// 时间常数测试
// ============================================================================

describe('computeEnvelopeCoef', () => {
  it('时间越短系数越小(跟随越快)', () => {
    const fast = computeEnvelopeCoef(1, 48000)
    const slow = computeEnvelopeCoef(100, 48000)
    expect(fast).toBeLessThan(slow)
  })

  it('系数应在 0~1 之间', () => {
    const coef = computeEnvelopeCoef(10, 48000)
    expect(coef).toBeGreaterThan(0)
    expect(coef).toBeLessThan(1)
  })

  it('采样率越高系数越接近 1', () => {
    const lowRate = computeEnvelopeCoef(10, 8000)
    const highRate = computeEnvelopeCoef(10, 96000)
    expect(highRate).toBeGreaterThan(lowRate)
  })

  it('非法输入应返回 0', () => {
    expect(computeEnvelopeCoef(0, 48000)).toBe(0)
    expect(computeEnvelopeCoef(10, 0)).toBe(0)
    expect(computeEnvelopeCoef(Number.NaN, 48000)).toBe(0)
  })
})

describe('computeEnvelopeCoefs', () => {
  it('release 系数应大于 attack 系数(释放慢于启动)', () => {
    const { attack, release } = computeEnvelopeCoefs(DEFAULT_COMPRESSOR_PARAMS, 48000)
    expect(release).toBeGreaterThan(attack)
  })
})
