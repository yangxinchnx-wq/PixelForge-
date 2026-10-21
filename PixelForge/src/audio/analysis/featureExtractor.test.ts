import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BANDS,
  binToHz,
  computeBandEnergy,
  computeSpectralCentroid,
  extractAudioFeatures,
  hzToBin,
} from '@/audio/analysis/featureExtractor'

const SR = 48000
const N = 1024
const BINS = N / 2

/** 构造只在指定 bin 区间有能量的频谱 */
function spectrumWithBand(startBin: number, endBin: number, value = 1): Float32Array {
  const s = new Float32Array(BINS)
  for (let i = startBin; i <= endBin && i < BINS; i++) {
    s[i] = value
  }
  return s
}

// ============================================================================
// bin ↔ Hz 换算测试
// ============================================================================

describe('binToHz', () => {
  it('bin 0 应为 0Hz', () => {
    expect(binToHz(0, SR, N)).toBe(0)
  })

  it('bin 1 应为 sampleRate / fftSize', () => {
    expect(binToHz(1, SR, N)).toBeCloseTo(SR / N, 10)
  })

  it('奈奎斯特 bin 应为采样率的一半', () => {
    expect(binToHz(BINS, SR, N)).toBeCloseTo(SR / 2, 6)
  })

  it('非法采样率应返回 0', () => {
    expect(binToHz(10, 0, N)).toBe(0)
  })
})

describe('hzToBin', () => {
  it('应与 binToHz 互逆(误差不超过一个 bin 宽度)', () => {
    const binWidth = SR / N
    for (const hz of [100, 1000, 5000, 10000]) {
      const bin = hzToBin(hz, SR, N)
      expect(Math.abs(binToHz(bin, SR, N) - hz)).toBeLessThanOrEqual(binWidth)
    }
  })

  it('奈奎斯特频率应映射到最后一个 bin', () => {
    expect(hzToBin(SR / 2, SR, N)).toBe(BINS)
  })

  it('超过奈奎斯特的频率应被限制在最后一个 bin', () => {
    expect(hzToBin(SR, SR, N)).toBe(BINS * 2)
  })

  it('非法输入应返回 0', () => {
    expect(hzToBin(-100, SR, N)).toBe(0)
    expect(hzToBin(1000, 0, N)).toBe(0)
  })
})

// ============================================================================
// computeBandEnergy 测试
// ============================================================================

describe('computeBandEnergy', () => {
  it('空频谱应为 0', () => {
    expect(computeBandEnergy(new Float32Array(0), SR, N, 20, 250)).toBe(0)
  })

  it('频段内有能量时应大于 0', () => {
    const s = spectrumWithBand(0, 5)
    expect(computeBandEnergy(s, SR, N, 20, 250)).toBeGreaterThan(0)
  })

  it('频段外有能量时该频段应为 0', () => {
    // 能量只放在高频(4000Hz 以上)
    const s = spectrumWithBand(hzToBin(5000, SR, N), hzToBin(10000, SR, N))
    expect(computeBandEnergy(s, SR, N, DEFAULT_BANDS.bassLow, DEFAULT_BANDS.bassHigh)).toBe(0)
  })

  it('低频能量应只体现在低频段', () => {
    const s = spectrumWithBand(hzToBin(50, SR, N), hzToBin(150, SR, N))
    const bass = computeBandEnergy(s, SR, N, 20, 250)
    const treble = computeBandEnergy(s, SR, N, 4000, 16000)
    expect(bass).toBeGreaterThan(0)
    expect(treble).toBe(0)
  })

  it('高频能量应只体现在高频段', () => {
    const s = spectrumWithBand(hzToBin(6000, SR, N), hzToBin(12000, SR, N))
    const bass = computeBandEnergy(s, SR, N, 20, 250)
    const treble = computeBandEnergy(s, SR, N, 4000, 16000)
    expect(treble).toBeGreaterThan(0)
    expect(bass).toBe(0)
  })

  it('结果不应超过 1', () => {
    const s = new Float32Array(BINS).fill(5)
    expect(computeBandEnergy(s, SR, N, 20, 250)).toBeLessThanOrEqual(1)
  })

  it('频段上下限颠倒时应返回 0', () => {
    const s = spectrumWithBand(0, 100)
    expect(computeBandEnergy(s, SR, N, 4000, 250)).toBe(0)
  })

  it('能量越高结果越大', () => {
    const quiet = spectrumWithBand(0, 5, 0.2)
    const loud = spectrumWithBand(0, 5, 0.9)
    expect(computeBandEnergy(loud, SR, N, 20, 250)).toBeGreaterThan(
      computeBandEnergy(quiet, SR, N, 20, 250),
    )
  })
})

// ============================================================================
// computeSpectralCentroid 测试
// ============================================================================

describe('computeSpectralCentroid', () => {
  it('静音应返回 0', () => {
    expect(computeSpectralCentroid(new Float32Array(BINS), SR, N)).toBe(0)
  })

  it('低频集中时质心应偏低', () => {
    const low = spectrumWithBand(hzToBin(30, SR, N), hzToBin(200, SR, N))
    const centroid = computeSpectralCentroid(low, SR, N)
    expect(centroid).toBeLessThan(0.1)
  })

  it('高频集中时质心应偏高', () => {
    const high = spectrumWithBand(hzToBin(10000, SR, N), hzToBin(20000, SR, N))
    const centroid = computeSpectralCentroid(high, SR, N)
    expect(centroid).toBeGreaterThan(0.4)
  })

  it('全频段均匀时质心应接近 0.5', () => {
    const flat = new Float32Array(BINS).fill(1)
    const centroid = computeSpectralCentroid(flat, SR, N)
    expect(centroid).toBeGreaterThan(0.4)
    expect(centroid).toBeLessThan(0.6)
  })

  it('结果应在 0~1', () => {
    const s = new Float32Array(BINS).fill(3)
    const centroid = computeSpectralCentroid(s, SR, N)
    expect(centroid).toBeGreaterThanOrEqual(0)
    expect(centroid).toBeLessThanOrEqual(1)
  })

  it('空频谱应返回 0', () => {
    expect(computeSpectralCentroid(new Float32Array(0), SR, N)).toBe(0)
  })
})

// ============================================================================
// extractAudioFeatures 测试
// ============================================================================

describe('extractAudioFeatures', () => {
  it('静音时所有特征应为 0', () => {
    const f = extractAudioFeatures(new Float32Array(BINS), SR, N)
    expect(f.bass).toBe(0)
    expect(f.mid).toBe(0)
    expect(f.treble).toBe(0)
    expect(f.energy).toBe(0)
    expect(f.centroid).toBe(0)
    expect(f.beat).toBe(0)
  })

  it('低频信号应只点亮 bass', () => {
    const s = spectrumWithBand(hzToBin(40, SR, N), hzToBin(120, SR, N), 1)
    const f = extractAudioFeatures(s, SR, N)
    expect(f.bass).toBeGreaterThan(0)
    expect(f.mid).toBe(0)
    expect(f.treble).toBe(0)
  })

  it('中频信号应只点亮 mid', () => {
    const s = spectrumWithBand(hzToBin(500, SR, N), hzToBin(2000, SR, N), 1)
    const f = extractAudioFeatures(s, SR, N)
    expect(f.mid).toBeGreaterThan(0)
    expect(f.bass).toBe(0)
    expect(f.treble).toBe(0)
  })

  it('高频信号应只点亮 treble', () => {
    const s = spectrumWithBand(hzToBin(6000, SR, N), hzToBin(12000, SR, N), 1)
    const f = extractAudioFeatures(s, SR, N)
    expect(f.treble).toBeGreaterThan(0)
    expect(f.bass).toBe(0)
    expect(f.mid).toBe(0)
  })

  it('beat 应原样带入', () => {
    const f = extractAudioFeatures(new Float32Array(BINS), SR, N, 0.7)
    expect(f.beat).toBeCloseTo(0.7, 10)
  })

  it('beat 超过 1 应被截断', () => {
    const f = extractAudioFeatures(new Float32Array(BINS), SR, N, 5)
    expect(f.beat).toBe(1)
  })

  it('所有特征都应在 0~1', () => {
    const s = new Float32Array(BINS).fill(2)
    const f = extractAudioFeatures(s, SR, N, 1)
    for (const v of [f.bass, f.mid, f.treble, f.energy, f.beat, f.centroid]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('总能量应不超过最大单频段能量', () => {
    const s = spectrumWithBand(hzToBin(40, SR, N), hzToBin(120, SR, N), 1)
    const f = extractAudioFeatures(s, SR, N)
    expect(f.energy).toBeLessThanOrEqual(f.bass)
  })

  it('应包含全部六个特征字段', () => {
    const f = extractAudioFeatures(new Float32Array(BINS), SR, N)
    expect(Object.keys(f).sort()).toEqual(
      ['bass', 'beat', 'centroid', 'energy', 'mid', 'treble'],
    )
  })
})
