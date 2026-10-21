/**
 * 音频特征提取(Step 41.6)— 频段能量 + 频谱质心。
 *
 * 职责:
 * - 在幅度谱上按频率区间积分出 bass / mid / treble 能量
 * - 计算总能量与频谱质心(音色明亮度的粗略度量)
 * - 汇总为 AudioFeatures,供 inputRouter 驱动画面
 *
 * 纯函数,零 Web Audio / DOM 依赖。
 *
 * 数据流:
 *   magnitude spectrum
 *     ↓ extractAudioFeatures
 *   AudioFeatures(bass/mid/treble/energy/centroid)
 *     ↓ audioInput → inputRouter.setSignal('audio.bass', ...)
 *   GraphNode / MaterialNode 参数 → 画面律动
 */

import type { AudioFeatures } from '../core/types'

// ============================================================================
// 1. 常量
// ============================================================================

/** 默认频段划分(Hz) */
export const DEFAULT_BANDS = {
  /** 低频下限 */
  bassLow: 20,
  /** 低频上限 = 中频下限 */
  bassHigh: 250,
  /** 中频上限 = 高频下限 */
  midHigh: 4000,
  /** 高频上限 */
  trebleHigh: 16000,
} as const

/** 用于避免除零的极小值 */
const EPSILON = 1e-9

// ============================================================================
// 2. 频率与 bin 的换算
// ============================================================================

/**
 * bin 序号转频率(Hz)。
 *
 * 第 i 个 bin 的中心频率为 `i × sampleRate / fftSize`。
 */
export function binToHz(bin: number, sampleRate: number, fftSize: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0
  if (!Number.isFinite(fftSize) || fftSize <= 0) return 0
  return (bin * sampleRate) / fftSize
}

/**
 * 频率(Hz)转最近的 bin 序号。
 */
export function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0
  if (!Number.isFinite(fftSize) || fftSize <= 0) return 0
  if (!Number.isFinite(hz) || hz <= 0) return 0
  return Math.round((hz * fftSize) / sampleRate)
}

// ============================================================================
// 3. 频段能量
// ============================================================================

/**
 * 计算指定频率区间内的能量。
 *
 * 对区间内所有 bin 求平方和后开方(RMS 式聚合),再按 bin 数量归一,
 * 避免低频( bin 稀疏)与高频(bin 密集)在数值上不可比。
 *
 * @param spectrum 幅度谱
 * @param sampleRate 采样率
 * @param fftSize FFT 长度
 * @param lowHz 频率下限
 * @param highHz 频率上限
 * @returns 归一化能量(0 ~ 1)
 */
export function computeBandEnergy(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  lowHz: number,
  highHz: number,
): number {
  const bins = spectrum.length
  if (bins === 0) return 0
  if (!Number.isFinite(lowHz) || !Number.isFinite(highHz) || highHz <= lowHz) return 0

  const nyquist = sampleRate / 2
  const startBin = Math.max(0, hzToBin(lowHz, sampleRate, fftSize))
  const endBin = Math.min(bins - 1, hzToBin(Math.min(highHz, nyquist), sampleRate, fftSize))
  if (endBin < startBin) return 0

  let sumOfSquares = 0
  let count = 0
  for (let i = startBin; i <= endBin; i++) {
    const v = spectrum[i]
    if (Number.isNaN(v)) continue
    sumOfSquares += v * v
    count++
  }
  if (count === 0) return 0

  const rms = Math.sqrt(sumOfSquares / count)
  // 单 bin 满幅时 rms 接近 1,多 bin 同时满幅也接近 1,因此无需再除 count
  return Math.min(1, rms)
}

// ============================================================================
// 4. 频谱质心
// ============================================================================

/**
 * 计算频谱质心并归一化到 0~1。
 *
 * 质心 = Σ(频率 × 幅度) / Σ(幅度),再除以奈奎斯特频率归一化。
 * 质心越高表示音色越"明亮",越低表示越"厚重"。
 *
 * 静音(总幅度为 0)时返回 0。
 */
export function computeSpectralCentroid(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
): number {
  const bins = spectrum.length
  if (bins === 0) return 0
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 0
  if (!Number.isFinite(fftSize) || fftSize <= 0) return 0

  let weighted = 0
  let total = 0
  for (let i = 0; i < bins; i++) {
    const v = spectrum[i]
    if (Number.isNaN(v) || v <= 0) continue
    weighted += binToHz(i, sampleRate, fftSize) * v
    total += v
  }

  if (total <= EPSILON) return 0

  const centroidHz = weighted / total
  const nyquist = sampleRate / 2
  const normalized = centroidHz / nyquist
  return Math.min(1, Math.max(0, normalized))
}

// ============================================================================
// 5. 汇总
// ============================================================================

/**
 * 从幅度谱提取完整音频特征。
 *
 * @param spectrum 幅度谱(由 computeMagnitudeSpectrum 得出)
 * @param sampleRate 采样率
 * @param fftSize FFT 长度
 * @param beat 节拍强度(由 beatDetector 得出,此处原样带入)
 * @returns 音频特征
 */
export function extractAudioFeatures(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  fftSize: number,
  beat = 0,
): AudioFeatures {
  const bass = computeBandEnergy(spectrum, sampleRate, fftSize, DEFAULT_BANDS.bassLow, DEFAULT_BANDS.bassHigh)
  const mid = computeBandEnergy(spectrum, sampleRate, fftSize, DEFAULT_BANDS.bassHigh, DEFAULT_BANDS.midHigh)
  const treble = computeBandEnergy(spectrum, sampleRate, fftSize, DEFAULT_BANDS.midHigh, DEFAULT_BANDS.trebleHigh)
  const centroid = computeSpectralCentroid(spectrum, sampleRate, fftSize)

  // 总能量取三个频段的均方根,避免简单相加导致超过 1
  const energy = Math.min(1, Math.sqrt((bass * bass + mid * mid + treble * treble) / 3))

  return {
    bass: clamp01(bass),
    mid: clamp01(mid),
    treble: clamp01(treble),
    energy: clamp01(energy),
    beat: clamp01(beat),
    centroid: clamp01(centroid),
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.min(1, Math.max(0, v))
}
