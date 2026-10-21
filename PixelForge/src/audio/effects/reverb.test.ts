import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REVERB_PARAMS,
  clampReverbParams,
  computeWetDryGains,
  createRandomSource,
  estimateReverbTailSamples,
  generateImpulseResponse,
} from '@/audio/effects/reverb'

const SR = 48000

// ============================================================================
// clampReverbParams 测试
// ============================================================================

describe('clampReverbParams', () => {
  it('默认参数应原样保留', () => {
    expect(clampReverbParams(DEFAULT_REVERB_PARAMS)).toEqual(DEFAULT_REVERB_PARAMS)
  })

  it('混响时间应在 0.1~10 秒', () => {
    expect(clampReverbParams({ ...DEFAULT_REVERB_PARAMS, decaySeconds: 100 }).decaySeconds).toBe(10)
    expect(clampReverbParams({ ...DEFAULT_REVERB_PARAMS, decaySeconds: 0.01 }).decaySeconds).toBe(0.1)
  })

  it('阻尼、干湿比、房间大小应在 0~1', () => {
    const p = clampReverbParams({
      ...DEFAULT_REVERB_PARAMS,
      damping: 5,
      mix: -3,
      roomSize: 99,
    })
    expect(p.damping).toBe(1)
    expect(p.mix).toBe(0)
    expect(p.roomSize).toBe(1)
  })

  it('预延迟应在 0~200ms', () => {
    expect(clampReverbParams({ ...DEFAULT_REVERB_PARAMS, preDelayMs: 9999 }).preDelayMs).toBe(200)
  })

  it('NaN 应回落到默认值', () => {
    const p = clampReverbParams({ ...DEFAULT_REVERB_PARAMS, decaySeconds: Number.NaN })
    expect(p.decaySeconds).toBe(DEFAULT_REVERB_PARAMS.decaySeconds)
  })
})

// ============================================================================
// createRandomSource 测试
// ============================================================================

describe('createRandomSource', () => {
  it('同种子应产生完全相同的序列', () => {
    const a = createRandomSource(12345)
    const b = createRandomSource(12345)
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b())
    }
  })

  it('不同种子应产生不同序列', () => {
    const a = createRandomSource(1)
    const b = createRandomSource(2)
    let diff = 0
    for (let i = 0; i < 50; i++) {
      if (a() !== b()) diff++
    }
    expect(diff).toBeGreaterThan(40)
  })

  it('输出应落在 [0,1)', () => {
    const r = createRandomSource(7)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('分布应大致均匀', () => {
    const r = createRandomSource(99)
    const buckets = new Array(4).fill(0)
    for (let i = 0; i < 4000; i++) {
      buckets[Math.floor(r() * 4)]++
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700)
      expect(count).toBeLessThan(1300)
    }
  })
})

// ============================================================================
// generateImpulseResponse 测试
// ============================================================================

describe('generateImpulseResponse', () => {
  it('长度应等于时长 × 采样率', () => {
    const ir = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 1)
    expect(ir.length).toBe(SR)
  })

  it('默认时长应为混响时间的 1.2 倍', () => {
    const ir = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR)
    expect(ir.length).toBe(Math.floor(2 * 1.2 * SR))
  })

  it('预延迟段应为静音', () => {
    const ir = generateImpulseResponse({ ...DEFAULT_REVERB_PARAMS, preDelayMs: 100 }, SR, 1)
    const preDelaySamples = Math.floor(0.1 * SR)
    for (let i = 0; i < preDelaySamples; i++) {
      expect(ir[i]).toBe(0)
    }
  })

  it('峰值应被归一化到 1', () => {
    const ir = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 1)
    let peak = 0
    for (let i = 0; i < ir.length; i++) {
      peak = Math.max(peak, Math.abs(ir[i]))
    }
    expect(peak).toBeCloseTo(1, 5)
  })

  it('同种子应产生完全相同的 IR', () => {
    const a = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 0.5, 42)
    const b = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 0.5, 42)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('不同种子应产生不同的 IR', () => {
    const a = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 0.5, 1)
    const b = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 0.5, 2)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('能量应随时间衰减', () => {
    const ir = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 2)
    const half = Math.floor(ir.length / 2)
    const energyOf = (start: number, end: number): number => {
      let sum = 0
      for (let i = start; i < end; i++) sum += ir[i] * ir[i]
      return sum
    }
    const firstHalf = energyOf(0, half)
    const secondHalf = energyOf(half, ir.length)
    expect(secondHalf).toBeLessThan(firstHalf)
  })

  it('混响时间越长尾音能量越高', () => {
    const short = generateImpulseResponse(
      { ...DEFAULT_REVERB_PARAMS, decaySeconds: 0.5 },
      SR,
      1,
    )
    const long = generateImpulseResponse({ ...DEFAULT_REVERB_PARAMS, decaySeconds: 5 }, SR, 1)
    const tailEnergy = (ir: Float32Array): number => {
      let sum = 0
      const start = Math.floor(ir.length * 0.8)
      for (let i = start; i < ir.length; i++) sum += ir[i] * ir[i]
      return sum
    }
    expect(tailEnergy(long)).toBeGreaterThan(tailEnergy(short))
  })

  it('非法采样率应返回空数组', () => {
    expect(generateImpulseResponse(DEFAULT_REVERB_PARAMS, 0, 1).length).toBe(0)
    expect(generateImpulseResponse(DEFAULT_REVERB_PARAMS, Number.NaN, 1).length).toBe(0)
  })

  it('非法时长应返回空数组', () => {
    expect(generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 0).length).toBe(0)
  })

  it('不应产生 NaN', () => {
    const ir = generateImpulseResponse(DEFAULT_REVERB_PARAMS, SR, 0.5)
    for (let i = 0; i < ir.length; i++) {
      expect(Number.isNaN(ir[i])).toBe(false)
    }
  })
})

// ============================================================================
// computeWetDryGains 测试
// ============================================================================

describe('computeWetDryGains', () => {
  it('mix 为 0 时应全干', () => {
    const g = computeWetDryGains(0)
    expect(g.dry).toBeCloseTo(1, 10)
    expect(g.wet).toBeCloseTo(0, 10)
  })

  it('mix 为 1 时应全湿', () => {
    const g = computeWetDryGains(1)
    expect(g.dry).toBeCloseTo(0, 10)
    expect(g.wet).toBeCloseTo(1, 10)
  })

  it('等功率混合:功率和应恒为 1', () => {
    for (const mix of [0, 0.25, 0.5, 0.75, 1]) {
      const g = computeWetDryGains(mix)
      expect(g.dry * g.dry + g.wet * g.wet).toBeCloseTo(1, 6)
    }
  })

  it('越界值应被 clamp', () => {
    expect(computeWetDryGains(5).wet).toBeCloseTo(1, 10)
    expect(computeWetDryGains(-5).dry).toBeCloseTo(1, 10)
  })

  it('NaN 应视为全干', () => {
    expect(computeWetDryGains(Number.NaN).dry).toBeCloseTo(1, 10)
  })
})

// ============================================================================
// estimateReverbTailSamples 测试
// ============================================================================

describe('estimateReverbTailSamples', () => {
  it('应包含尾音与预延迟', () => {
    const p = { ...DEFAULT_REVERB_PARAMS, decaySeconds: 1, preDelayMs: 50 }
    const samples = estimateReverbTailSamples(p, SR)
    expect(samples).toBe(Math.ceil(1 * 1.2 * SR) + Math.floor(0.05 * SR))
  })

  it('非法采样率应返回 0', () => {
    expect(estimateReverbTailSamples(DEFAULT_REVERB_PARAMS, 0)).toBe(0)
  })
})
