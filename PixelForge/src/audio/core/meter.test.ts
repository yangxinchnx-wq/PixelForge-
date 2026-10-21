import { describe, expect, it } from 'vitest'

import {
  CLIP_THRESHOLD,
  DEFAULT_DECAY_COEF,
  DEFAULT_PEAK_HOLD_FRAMES,
  applyMeterDecay,
  applyPeakHold,
  computeMeter,
  computePeak,
  computeRms,
  mergeStereoReading,
} from '@/audio/core/meter'

// ============================================================================
// computeRms 测试
// ============================================================================

describe('computeRms', () => {
  it('空序列应为 0', () => {
    expect(computeRms([])).toBe(0)
  })

  it('全零序列应为 0', () => {
    expect(computeRms(new Float32Array([0, 0, 0, 0]))).toBe(0)
  })

  it('恒定直流应为该值的绝对值', () => {
    expect(computeRms(new Float32Array([0.5, 0.5, 0.5, 0.5]))).toBeCloseTo(0.5, 6)
  })

  it('负直流应取绝对值', () => {
    expect(computeRms(new Float32Array([-0.5, -0.5]))).toBeCloseTo(0.5, 6)
  })

  it('正弦波 RMS 应为峰值的 1/√2', () => {
    const n = 1024
    const samples = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      samples[i] = Math.sin((2 * Math.PI * i) / n)
    }
    expect(computeRms(samples)).toBeCloseTo(Math.SQRT1_2, 2)
  })

  it('RMS 应始终不大于峰值', () => {
    const samples = new Float32Array([0.1, 0.9, 0.3, 0.5])
    expect(computeRms(samples)).toBeLessThanOrEqual(computePeak(samples))
  })

  it('超出范围的值应被归一化到 1', () => {
    expect(computeRms(new Float32Array([2, 2, 2, 2]))).toBe(1)
  })

  it('NaN 应被跳过而不污染结果', () => {
    const samples = new Float32Array([0.5, Number.NaN, 0.5])
    expect(computeRms(samples)).toBeCloseTo(0.5, 6)
  })
})

// ============================================================================
// computePeak 测试
// ============================================================================

describe('computePeak', () => {
  it('空序列应为 0', () => {
    expect(computePeak([])).toBe(0)
  })

  it('应取绝对值最大者', () => {
    expect(computePeak(new Float32Array([0.1, -0.9, 0.3]))).toBeCloseTo(0.9, 6)
  })

  it('全负序列应取绝对值', () => {
    expect(computePeak(new Float32Array([-0.2, -0.8]))).toBeCloseTo(0.8, 6)
  })

  it('超出 1 应归一化为 1', () => {
    expect(computePeak(new Float32Array([0.5, 3]))).toBe(1)
  })

  it('NaN 应被跳过', () => {
    expect(computePeak(new Float32Array([0.5, Number.NaN]))).toBeCloseTo(0.5, 6)
  })
})

// ============================================================================
// computeMeter 测试
// ============================================================================

describe('computeMeter', () => {
  it('未削波时 clipped 应为 false', () => {
    const m = computeMeter(new Float32Array([0.2, 0.5, 0.3]))
    expect(m.clipped).toBe(false)
    expect(m.peak).toBeCloseTo(0.5, 6)
  })

  it('达到阈值应判定削波', () => {
    const m = computeMeter(new Float32Array([0.5, 1.0]))
    expect(m.clipped).toBe(true)
  })

  it('超过阈值应判定削波', () => {
    const m = computeMeter(new Float32Array([0.5, 1.5]))
    expect(m.clipped).toBe(true)
    expect(m.peak).toBe(CLIP_THRESHOLD)
  })

  it('静音应全零且不削波', () => {
    const m = computeMeter(new Float32Array(256))
    expect(m.rms).toBe(0)
    expect(m.peak).toBe(0)
    expect(m.clipped).toBe(false)
  })

  it('rms 应不大于 peak', () => {
    const m = computeMeter(new Float32Array([0.1, 0.9, 0.4, 0.2]))
    expect(m.rms).toBeLessThanOrEqual(m.peak)
  })
})

// ============================================================================
// applyMeterDecay 测试
// ============================================================================

describe('applyMeterDecay', () => {
  it('新值更高时应立即跟随(起振快)', () => {
    expect(applyMeterDecay(0.2, 0.8)).toBeCloseTo(0.8, 10)
  })

  it('新值更低时应缓慢回落', () => {
    const out = applyMeterDecay(1.0, 0.0)
    expect(out).toBeLessThan(1.0)
    expect(out).toBeGreaterThan(0.0)
  })

  it('回落幅度应随系数变化', () => {
    const fast = applyMeterDecay(1.0, 0.0, 0.5)
    const slow = applyMeterDecay(1.0, 0.0, 0.95)
    expect(fast).toBeLessThan(slow)
  })

  it('相等时应保持', () => {
    expect(applyMeterDecay(0.5, 0.5)).toBeCloseTo(0.5, 10)
  })

  it('连续回落应单调递减并趋近目标', () => {
    let v = 1.0
    for (let i = 0; i < 50; i++) {
      v = applyMeterDecay(v, 0, DEFAULT_DECAY_COEF)
    }
    expect(v).toBeLessThan(0.1)
    expect(v).toBeGreaterThanOrEqual(0)
  })

  it('结果应始终在 [0,1] 内', () => {
    const out = applyMeterDecay(5, -5)
    expect(out).toBeGreaterThanOrEqual(0)
    expect(out).toBeLessThanOrEqual(1)
  })
})

// ============================================================================
// applyPeakHold 测试
// ============================================================================

describe('applyPeakHold', () => {
  it('新峰值应重置保持计数', () => {
    const out = applyPeakHold({ value: 0.5, holdFrames: 30 }, 0.9)
    expect(out.value).toBeCloseTo(0.9, 10)
    expect(out.holdFrames).toBe(0)
  })

  it('保持期内应维持原值', () => {
    const out = applyPeakHold({ value: 0.9, holdFrames: 10 }, 0.2, 60)
    expect(out.value).toBeCloseTo(0.9, 10)
    expect(out.holdFrames).toBe(11)
  })

  it('超过保持期后应开始回落', () => {
    const out = applyPeakHold(
      { value: 0.9, holdFrames: DEFAULT_PEAK_HOLD_FRAMES },
      0.0,
      DEFAULT_PEAK_HOLD_FRAMES,
    )
    expect(out.value).toBeLessThan(0.9)
    expect(out.value).toBeGreaterThan(0)
  })

  it('保持期内即使信号归零也不应立刻掉下来', () => {
    let state = { value: 0, holdFrames: 0 }
    state = applyPeakHold(state, 1.0, 3)
    for (let i = 0; i < 3; i++) {
      state = applyPeakHold(state, 0, 3)
    }
    expect(state.value).toBeCloseTo(1.0, 6)
  })

  it('保持期结束后应持续回落', () => {
    let state = { value: 0, holdFrames: 0 }
    state = applyPeakHold(state, 1.0, 2)
    for (let i = 0; i < 40; i++) {
      state = applyPeakHold(state, 0, 2)
    }
    expect(state.value).toBeLessThan(0.2)
  })
})

// ============================================================================
// mergeStereoReading 测试
// ============================================================================

describe('mergeStereoReading', () => {
  it('应取左右较大者', () => {
    const merged = mergeStereoReading(
      { rms: 0.2, peak: 0.4, clipped: false },
      { rms: 0.6, peak: 0.8, clipped: false },
    )
    expect(merged.rms).toBeCloseTo(0.6, 10)
    expect(merged.peak).toBeCloseTo(0.8, 10)
  })

  it('任一侧削波即判定削波', () => {
    const merged = mergeStereoReading(
      { rms: 0.2, peak: 0.4, clipped: false },
      { rms: 0.6, peak: 1.0, clipped: true },
    )
    expect(merged.clipped).toBe(true)
  })

  it('两侧均未削波时为 false', () => {
    const merged = mergeStereoReading(
      { rms: 0.2, peak: 0.4, clipped: false },
      { rms: 0.3, peak: 0.5, clipped: false },
    )
    expect(merged.clipped).toBe(false)
  })
})
