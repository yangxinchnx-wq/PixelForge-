import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BEAT_CONFIG,
  computeMean,
  computeThresholdCoef,
  computeVariance,
  createBeatDetectorState,
  detectBeat,
  isBeatEnergy,
} from '@/audio/analysis/beatDetector'

// ============================================================================
// 统计量测试
// ============================================================================

describe('computeMean', () => {
  it('空数组应为 0', () => {
    expect(computeMean([])).toBe(0)
  })

  it('应计算算术平均', () => {
    expect(computeMean([1, 2, 3, 4])).toBeCloseTo(2.5, 10)
  })

  it('应跳过 NaN', () => {
    expect(computeMean([1, Number.NaN, 3])).toBeCloseTo(2, 10)
  })
})

describe('computeVariance', () => {
  it('空数组应为 0', () => {
    expect(computeVariance([])).toBe(0)
  })

  it('恒定序列方差应为 0', () => {
    expect(computeVariance([0.5, 0.5, 0.5])).toBeCloseTo(0, 10)
  })

  it('应计算方差', () => {
    // [0, 2] 均值 1,方差 ((0-1)² + (2-1)²)/2 = 1
    expect(computeVariance([0, 2])).toBeCloseTo(1, 10)
  })

  it('离散程度越大方差越大', () => {
    const tight = computeVariance([0.49, 0.5, 0.51])
    const loose = computeVariance([0.1, 0.5, 0.9])
    expect(loose).toBeGreaterThan(tight)
  })
})

describe('computeThresholdCoef', () => {
  it('方差为 0 时应使用基准系数', () => {
    expect(computeThresholdCoef(0)).toBeCloseTo(1.5142857, 6)
  })

  it('方差越大系数越小(阈值放宽)', () => {
    const smallVar = computeThresholdCoef(1)
    const largeVar = computeThresholdCoef(100)
    expect(largeVar).toBeLessThan(smallVar)
  })

  it('系数应被限制在 [1.1, 2.0]', () => {
    expect(computeThresholdCoef(1e9)).toBeGreaterThanOrEqual(1.1)
    expect(computeThresholdCoef(0)).toBeLessThanOrEqual(2.0)
  })

  it('NaN 应回落到基准系数', () => {
    expect(computeThresholdCoef(Number.NaN)).toBeCloseTo(1.5142857, 6)
  })
})

// ============================================================================
// createBeatDetectorState 测试
// ============================================================================

describe('createBeatDetectorState', () => {
  it('初始应无历史且从未触发', () => {
    const s = createBeatDetectorState()
    expect(s.history).toEqual([])
    expect(s.lastBeatMs).toBe(Number.NEGATIVE_INFINITY)
  })

  it('可注入初始历史', () => {
    const s = createBeatDetectorState([0.1, 0.2])
    expect(s.history).toEqual([0.1, 0.2])
  })

  it('注入的历史应是副本而非引用', () => {
    const src = [0.1]
    const s = createBeatDetectorState(src)
    expect(s.history).not.toBe(src)
  })
})

// ============================================================================
// detectBeat 测试
// ============================================================================

/** 用固定能量跑若干帧,返回最终状态 */
function runFrames(
  energies: number[],
  config = DEFAULT_BEAT_CONFIG,
  startMs = 0,
  stepMs = 16,
): Array<{ isBeat: boolean; strength: number }> {
  let state = createBeatDetectorState()
  const results: Array<{ isBeat: boolean; strength: number }> = []
  energies.forEach((e, i) => {
    const r = detectBeat(state, e, startMs + i * stepMs, config)
    results.push({ isBeat: r.isBeat, strength: r.strength })
    state = r.state
  })
  return results
}

describe('detectBeat', () => {
  const size = DEFAULT_BEAT_CONFIG.historySize

  it('历史未满时不应判定节拍(冷启动保护)', () => {
    // 只喂 size-1 帧,历史永远达不到窗口长度,即使出现极端峰值也不判定
    const energies = new Array(size - 1).fill(0.2)
    energies[size - 2] = 1.0
    const results = runFrames(energies)
    expect(results.every((r) => !r.isBeat)).toBe(true)
  })

  it('能量平稳时不应产生节拍', () => {
    const energies = new Array(size + 20).fill(0.5)
    const results = runFrames(energies)
    expect(results.every((r) => !r.isBeat)).toBe(true)
  })

  it('平稳后出现明显峰值应判定节拍', () => {
    const energies = new Array(size).fill(0.3).concat([0.9])
    const results = runFrames(energies)
    expect(results[results.length - 1].isBeat).toBe(true)
  })

  it('节拍强度应在 0~1', () => {
    const energies = new Array(size).fill(0.3).concat([1.0])
    const results = runFrames(energies)
    const strength = results[results.length - 1].strength
    expect(strength).toBeGreaterThan(0)
    expect(strength).toBeLessThanOrEqual(1)
  })

  it('非节拍帧强度应为 0', () => {
    const energies = new Array(size + 10).fill(0.4)
    const results = runFrames(energies)
    expect(results.every((r) => r.strength === 0)).toBe(true)
  })

  it('最小间隔内不应重复触发', () => {
    const cfg = { ...DEFAULT_BEAT_CONFIG, minIntervalMs: 1000 }
    // 历史填满后连续两帧都是峰值,间隔仅 16ms
    const energies = new Array(size).fill(0.3).concat([0.9, 0.9, 0.9])
    const results = runFrames(energies, cfg)
    const beats = results.filter((r) => r.isBeat)
    expect(beats).toHaveLength(1)
  })

  it('超过最小间隔后可再次触发', () => {
    const cfg = { ...DEFAULT_BEAT_CONFIG, minIntervalMs: 100 }
    const energies = new Array(size).fill(0.3).concat([0.9, 0.31, 0.31, 0.9])
    // 帧间隔 16ms,第 size+3 帧距第一次触发 48ms —— 仍不足 100ms
    const results = runFrames(energies, cfg)
    expect(results.filter((r) => r.isBeat).length).toBeLessThanOrEqual(1)

    // 放大帧间隔到 60ms,第 4 帧距首次触发 180ms,应可再次触发
    const results2 = runFrames(energies, cfg, 0, 60)
    expect(results2.filter((r) => r.isBeat).length).toBeGreaterThanOrEqual(1)
  })

  it('静音段不应触发节拍(绝对能量下限)', () => {
    const cfg = { ...DEFAULT_BEAT_CONFIG, minEnergy: 0.05 }
    // 极低能量即使相对突出也应被抑制
    const energies = new Array(size).fill(0.001).concat([0.02])
    const results = runFrames(energies, cfg)
    expect(results.every((r) => !r.isBeat)).toBe(true)
  })

  it('灵敏度越高越难触发', () => {
    const energies = new Array(size).fill(0.3).concat([0.6])
    const loose = runFrames(energies, { ...DEFAULT_BEAT_CONFIG, sensitivity: 0.8 })
    const strict = runFrames(energies, { ...DEFAULT_BEAT_CONFIG, sensitivity: 2.0 })
    expect(loose[loose.length - 1].isBeat).toBe(true)
    expect(strict[strict.length - 1].isBeat).toBe(false)
  })

  it('不应修改传入的状态对象', () => {
    const state = createBeatDetectorState(new Array(size).fill(0.3))
    const historyBefore = [...state.history]
    detectBeat(state, 1.0, 1000)
    expect(state.history).toEqual(historyBefore)
  })

  it('状态中的历史应按窗口长度裁剪', () => {
    let state = createBeatDetectorState()
    for (let i = 0; i < size + 30; i++) {
      state = detectBeat(state, 0.3, i * 16).state
    }
    expect(state.history.length).toBe(size)
  })

  it('历史应保持最新值在末尾', () => {
    let state = createBeatDetectorState()
    for (let i = 0; i < size + 5; i++) {
      state = detectBeat(state, i / 100, i * 16).state
    }
    expect(state.history[state.history.length - 1]).toBeCloseTo((size + 4) / 100, 6)
  })

  it('NaN 能量应按 0 处理而不崩溃', () => {
    const energies = new Array(size + 1).fill(0.3)
    energies[size] = Number.NaN
    const results = runFrames(energies)
    expect(results[results.length - 1].isBeat).toBe(false)
  })

  it('能量超出 1 应被截断', () => {
    let state = createBeatDetectorState(new Array(size).fill(0.3))
    const r = detectBeat(state, 5, 1000)
    expect(r.state.history[r.state.history.length - 1]).toBe(1)
  })
})

// ============================================================================
// isBeatEnergy 测试
// ============================================================================

describe('isBeatEnergy', () => {
  it('空历史应返回 false', () => {
    expect(isBeatEnergy([], 1.0)).toBe(false)
  })

  it('显著超过局部均值应为 true', () => {
    expect(isBeatEnergy(new Array(40).fill(0.3), 0.9)).toBe(true)
  })

  it('接近局部均值应为 false', () => {
    expect(isBeatEnergy(new Array(40).fill(0.3), 0.32)).toBe(false)
  })

  it('低于绝对下限应为 false', () => {
    expect(isBeatEnergy(new Array(40).fill(0.001), 0.01)).toBe(false)
  })

  it('不应受最小间隔约束影响', () => {
    const history = new Array(40).fill(0.3)
    expect(isBeatEnergy(history, 0.9)).toBe(true)
    expect(isBeatEnergy(history, 0.9)).toBe(true)
  })
})
