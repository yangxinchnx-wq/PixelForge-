import { describe, expect, it } from 'vitest'

import {
  computeMagnitudeSpectrum,
  fftInPlace,
  floorPowerOfTwo,
  hammingWindow,
  hannWindow,
  isPowerOfTwo,
  nextPowerOfTwo,
  rectangularWindow,
  spectrumToDb,
} from '@/audio/analysis/fft'

const SR = 48000
const N = 1024

/** 生成正弦采样 */
function makeSine(freqHz: number, sampleRate = SR, length = N): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate)
  }
  return out
}

/** 找出幅度谱中的峰值 bin */
function peakBin(spectrum: Float32Array): number {
  let best = 0
  let bestIdx = 0
  for (let i = 0; i < spectrum.length; i++) {
    if (spectrum[i] > best) {
      best = spectrum[i]
      bestIdx = i
    }
  }
  return bestIdx
}

// ============================================================================
// 幂次工具测试
// ============================================================================

describe('isPowerOfTwo', () => {
  it('2 的幂应为 true', () => {
    for (const n of [1, 2, 4, 8, 16, 1024, 2048]) {
      expect(isPowerOfTwo(n)).toBe(true)
    }
  })

  it('非 2 的幂应为 false', () => {
    for (const n of [3, 5, 6, 7, 100, 1000]) {
      expect(isPowerOfTwo(n)).toBe(false)
    }
  })

  it('非正数应为 false', () => {
    expect(isPowerOfTwo(0)).toBe(false)
    expect(isPowerOfTwo(-8)).toBe(false)
    expect(isPowerOfTwo(Number.NaN)).toBe(false)
  })
})

describe('nextPowerOfTwo', () => {
  it('应返回不小于输入的最小 2 的幂', () => {
    expect(nextPowerOfTwo(1)).toBe(1)
    expect(nextPowerOfTwo(2)).toBe(2)
    expect(nextPowerOfTwo(3)).toBe(4)
    expect(nextPowerOfTwo(1000)).toBe(1024)
  })

  it('非法输入应返回 1', () => {
    expect(nextPowerOfTwo(0)).toBe(1)
    expect(nextPowerOfTwo(-5)).toBe(1)
  })
})

describe('floorPowerOfTwo', () => {
  it('应返回不大于输入的最大 2 的幂', () => {
    expect(floorPowerOfTwo(1)).toBe(1)
    expect(floorPowerOfTwo(3)).toBe(2)
    expect(floorPowerOfTwo(1024)).toBe(1024)
    expect(floorPowerOfTwo(1500)).toBe(1024)
  })

  it('非法输入应返回 1', () => {
    expect(floorPowerOfTwo(0)).toBe(1)
  })
})

// ============================================================================
// 窗函数测试
// ============================================================================

describe('窗函数', () => {
  it('Hann 窗两端应为 0、中点应为 1', () => {
    expect(hannWindow(0, 1024)).toBeCloseTo(0, 10)
    expect(hannWindow(1023, 1024)).toBeCloseTo(0, 6)
    expect(hannWindow(511, 1024)).toBeCloseTo(1, 2)
  })

  it('Hann 窗应左右对称', () => {
    for (const i of [1, 100, 300, 500]) {
      expect(hannWindow(i, 1024)).toBeCloseTo(hannWindow(1023 - i, 1024), 10)
    }
  })

  it('矩形窗应恒为 1', () => {
    for (const i of [0, 100, 1023]) {
      expect(rectangularWindow(i, 1024)).toBe(1)
    }
  })

  it('Hamming 窗两端应为 0.08', () => {
    expect(hammingWindow(0, 1024)).toBeCloseTo(0.08, 10)
    expect(hammingWindow(1023, 1024)).toBeCloseTo(0.08, 2)
  })

  it('所有窗函数取值范围都应在 0~1', () => {
    for (const win of [hannWindow, rectangularWindow, hammingWindow]) {
      for (let i = 0; i < 64; i++) {
        const v = win(i, 64)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ============================================================================
// fftInPlace 测试
// ============================================================================

describe('fftInPlace', () => {
  it('直流信号应把能量集中在 bin 0', () => {
    const re = new Float64Array(N).fill(1)
    const im = new Float64Array(N)
    fftInPlace(re, im)
    let maxIdx = 0
    for (let i = 1; i < N; i++) {
      if (Math.abs(re[i]) + Math.abs(im[i]) > Math.abs(re[maxIdx]) + Math.abs(im[maxIdx])) {
        maxIdx = i
      }
    }
    expect(maxIdx).toBe(0)
  })

  it('单频正弦应在对应 bin 处出现峰值', () => {
    const freqHz = 1000
    const samples = makeSine(freqHz)
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = samples[i]
    fftInPlace(re, im)

    const expectedBin = Math.round((freqHz * N) / SR)
    let maxIdx = 0
    let maxMag = 0
    for (let i = 0; i < N / 2; i++) {
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i])
      if (mag > maxMag) {
        maxMag = mag
        maxIdx = i
      }
    }
    expect(maxIdx).toBe(expectedBin)
  })

  it('长度不是 2 的幂时应直接返回不修改数据', () => {
    const re = new Float64Array([1, 2, 3])
    const im = new Float64Array([0, 0, 0])
    const reCopy = Array.from(re)
    fftInPlace(re, im)
    expect(Array.from(re)).toEqual(reCopy)
  })

  it('长度为 1 时应直接返回', () => {
    const re = new Float64Array([5])
    const im = new Float64Array([0])
    fftInPlace(re, im)
    expect(re[0]).toBe(5)
  })

  it('虚部全零的实信号应满足共轭对称性', () => {
    const samples = makeSine(800)
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = samples[i]
    fftInPlace(re, im)

    // X[k] 与 X[N-k] 的实部相等、虚部相反
    for (const k of [1, 5, 37, 100]) {
      expect(re[k]).toBeCloseTo(re[N - k], 6)
      expect(im[k]).toBeCloseTo(-im[N - k], 6)
    }
  })
})

// ============================================================================
// computeMagnitudeSpectrum 测试
// ============================================================================

describe('computeMagnitudeSpectrum', () => {
  it('应返回 fftSize/2 个 bin', () => {
    const spectrum = computeMagnitudeSpectrum(makeSine(1000), N)
    expect(spectrum.length).toBe(N / 2)
  })

  it('未指定 fftSize 时应取不大于采样数的最大 2 的幂', () => {
    const spectrum = computeMagnitudeSpectrum(new Float32Array(1000))
    expect(spectrum.length).toBe(256) // floorPowerOfTwo(1000)=512 → 512/2
  })

  it('静音信号的频谱应全为 0', () => {
    const spectrum = computeMagnitudeSpectrum(new Float32Array(N), N)
    for (let i = 0; i < spectrum.length; i++) {
      expect(spectrum[i]).toBeCloseTo(0, 10)
    }
  })

  it('空输入应返回空数组', () => {
    expect(computeMagnitudeSpectrum(new Float32Array(0), N).length).toBe(0)
  })

  it('单频正弦的峰值应落在正确 bin', () => {
    const freqHz = 1000
    const spectrum = computeMagnitudeSpectrum(makeSine(freqHz), N, {
      window: rectangularWindow,
    })
    expect(peakBin(spectrum)).toBe(Math.round((freqHz * N) / SR))
  })

  it('直流信号应集中在 bin 0', () => {
    const spectrum = computeMagnitudeSpectrum(new Float32Array(N).fill(1), N, {
      window: rectangularWindow,
    })
    expect(peakBin(spectrum)).toBe(0)
  })

  it('满幅正弦的峰值幅度应接近 1(矩形窗 + bin 对齐频率)', () => {
    // 频率对齐到整数 bin,避免非整数周期造成频谱泄漏
    const alignedHz = (21 * SR) / N
    const spectrum = computeMagnitudeSpectrum(makeSine(alignedHz), N, {
      window: rectangularWindow,
    })
    const idx = peakBin(spectrum)
    expect(spectrum[idx]).toBeCloseTo(1, 2)
  })

  it('Hann 窗的相干增益约为 0.5', () => {
    const alignedHz = (21 * SR) / N
    const spectrum = computeMagnitudeSpectrum(makeSine(alignedHz), N)
    const idx = peakBin(spectrum)
    expect(spectrum[idx]).toBeGreaterThan(0.45)
    expect(spectrum[idx]).toBeLessThan(0.55)
  })

  it('非整数周期频率会产生频谱泄漏(bin 对齐后可对比)', () => {
    // 1000Hz 对应 bin 21.33,不是整数,能量会分散到相邻 bin
    const spectrum = computeMagnitudeSpectrum(makeSine(1000), N, {
      window: rectangularWindow,
    })
    const idx = peakBin(spectrum)
    expect(spectrum[idx]).toBeLessThan(0.95)
  })

  it('采样数不足 fftSize 时应补零而不是报错', () => {
    const short = new Float32Array(100).fill(0.5)
    const spectrum = computeMagnitudeSpectrum(short, N)
    expect(spectrum.length).toBe(N / 2)
  })

  it('NaN 采样应按 0 处理', () => {
    const dirty = new Float32Array(N).fill(0.5)
    dirty[10] = Number.NaN
    const spectrum = computeMagnitudeSpectrum(dirty, N)
    for (let i = 0; i < spectrum.length; i++) {
      expect(Number.isNaN(spectrum[i])).toBe(false)
    }
  })

  it('应支持注入自定义 FFT 实现', () => {
    let called = false
    const spy = (re: Float64Array, im: Float64Array): void => {
      called = true
      fftInPlace(re, im)
    }
    computeMagnitudeSpectrum(makeSine(1000), N, { fft: spy })
    expect(called).toBe(true)
  })

  it('非 2 的幂 fftSize 应被降为合法的 2 的幂', () => {
    const spectrum = computeMagnitudeSpectrum(makeSine(1000), 1000)
    expect(spectrum.length).toBe(256)
  })
})

// ============================================================================
// spectrumToDb 测试
// ============================================================================

describe('spectrumToDb', () => {
  it('幅度 1 应为 0dB', () => {
    const db = spectrumToDb(new Float32Array([1]))
    expect(db[0]).toBeCloseTo(0, 6)
  })

  it('幅度 0.5 应约为 -6dB', () => {
    const db = spectrumToDb(new Float32Array([0.5]))
    expect(db[0]).toBeCloseTo(-6.0206, 3)
  })

  it('幅度 0 应被截断到下限', () => {
    const db = spectrumToDb(new Float32Array([0]), -100)
    expect(db[0]).toBe(-100)
  })

  it('极小幅度不应低于下限', () => {
    const db = spectrumToDb(new Float32Array([1e-10]), -80)
    expect(db[0]).toBe(-80)
  })
})
