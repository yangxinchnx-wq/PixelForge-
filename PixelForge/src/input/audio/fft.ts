/**
 * FFT(Step 30.7)— 频谱分析与频段提取。
 *
 * 职责:
 * - computeBands:    把 FFT 数据(frequencyBinCount)按 Hz 范围划分成 bass/mid/high
 * - computeVolume:   从时域数据(time domain)计算 RMS 音量
 * - hzToBin:         频率(Hz)→ bin 索引
 * - binToHz:         bin 索引 → 频率(Hz)
 *
 * 与 spec §7-8 对齐:
 *   getByteFrequencyData(data) → [12, 45, 90, 230, ...]
 *   ↓ computeBands
 *   { bass: 0.82, mid: 0.4, high: 0.7 }
 *
 * 设计:
 * - 纯函数,不持有状态(便于测试)
 * - 输入:Uint8Array(0-255)+ sampleRate + binCount
 * - 输出:归一化到 0-1 的频段能量
 */

import type { BandRanges } from '../types'
import { DEFAULT_BAND_RANGES } from '../types'

// ============================================================================
// 1. 频率 ↔ bin 索引换算
// ============================================================================

/**
 * 频率(Hz)→ bin 索引。
 *
 * 公式: bin = round(hz * fftSize / sampleRate)
 * 但 frequencyBinCount = fftSize / 2,所以:
 *   bin = round(hz * frequencyBinCount * 2 / sampleRate)
 *        = round(hz * fftSize / sampleRate)
 *
 * @param hz          目标频率
 * @param sampleRate  采样率(如 44100)
 * @param fftSize     FFT 大小(如 2048)
 * @returns bin 索引(整数)
 */
export function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  if (sampleRate <= 0) return 0
  return Math.round((hz * fftSize) / sampleRate)
}

/**
 * bin 索引 → 频率(Hz)。
 */
export function binToHz(bin: number, sampleRate: number, fftSize: number): number {
  return (bin * sampleRate) / fftSize
}

// ============================================================================
// 2. 频段能量计算
// ============================================================================

/**
 * 计算指定 bin 范围 [startBin, endBin) 的平均能量(归一化到 0-1)。
 *
 * @param data      FFT 数据(Uint8Array,0-255)
 * @param startBin  起始 bin(包含)
 * @param endBin    结束 bin(不包含)
 * @returns 平均能量(0-1)
 */
export function getBandEnergy(
  data: Uint8Array,
  startBin: number,
  endBin: number,
): number {
  if (endBin <= startBin) return 0
  // 钳制到数据范围
  const start = Math.max(0, Math.floor(startBin))
  const end = Math.min(data.length, Math.ceil(endBin))
  if (end <= start) return 0

  let sum = 0
  for (let i = start; i < end; i++) {
    sum += data[i]
  }
  return sum / (end - start) / 255 // 归一化到 0-1
}

/**
 * 把 FFT 数据划分成 bass / mid / high 三个频段。
 *
 * 默认频段(与 spec §8 对齐):
 * - bass: 0-200 Hz
 * - mid:  200-2000 Hz
 * - high: 2000-8000 Hz
 *
 * @param data        FFT 数据
 * @param sampleRate  采样率
 * @param fftSize     FFT 大小
 * @param ranges      频段范围(可选,默认 DEFAULT_BAND_RANGES)
 */
export function computeBands(
  data: Uint8Array,
  sampleRate: number,
  fftSize: number,
  ranges: BandRanges = DEFAULT_BAND_RANGES,
): { bass: number; mid: number; high: number } {
  const bassStart = hzToBin(ranges.bass.min, sampleRate, fftSize)
  const bassEnd = hzToBin(ranges.bass.max, sampleRate, fftSize)
  const midStart = hzToBin(ranges.mid.min, sampleRate, fftSize)
  const midEnd = hzToBin(ranges.mid.max, sampleRate, fftSize)
  const highStart = hzToBin(ranges.high.min, sampleRate, fftSize)
  const highEnd = hzToBin(ranges.high.max, sampleRate, fftSize)

  return {
    bass: getBandEnergy(data, bassStart, bassEnd),
    mid: getBandEnergy(data, midStart, midEnd),
    high: getBandEnergy(data, highStart, highEnd),
  }
}

// ============================================================================
// 3. 音量(RMS)
// ============================================================================

/**
 * 从时域数据(time domain)计算 RMS 音量(归一化到 0-1)。
 *
 * 时域数据是 -1 到 1 的波形(在 getByteTimeDomainData 中是 0-255,
 * 中心值 128 表示 0)。
 *
 * RMS = sqrt(sum(x²) / N)
 *
 * @param timeData 时域数据(Uint8Array,0-255,中心 128)
 * @returns RMS 音量(0-1)
 */
export function computeVolume(timeData: Uint8Array): number {
  if (timeData.length === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < timeData.length; i++) {
    // 中心化:0-255 → -128-127,然后归一化到 -1-1
    const sample = (timeData[i] - 128) / 128
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / timeData.length)
  // RMS 通常在 0-0.5 之间,放大 2 倍使其更接近 0-1
  return Math.min(1, rms * 2)
}

// ============================================================================
// 4. 便捷:构造测试用 FFT 数据
// ============================================================================

/**
 * 生成全 0 的 FFT 数据(用于测试)。
 */
export function makeEmptyFftData(binCount: number): Uint8Array {
  return new Uint8Array(binCount)
}

/**
 * 生成全满(255)的 FFT 数据(用于测试)。
 */
export function makeFullFftData(binCount: number): Uint8Array {
  const arr = new Uint8Array(binCount)
  arr.fill(255)
  return arr
}

/**
 * 生成指定频段有能量的 FFT 数据(用于测试)。
 *
 * @param binCount  bin 总数
 * @param startBin  起始 bin(包含)
 * @param endBin    结束 bin(不包含)
 * @param value     能量值(0-255)
 */
export function makeBandFftData(
  binCount: number,
  startBin: number,
  endBin: number,
  value: number,
): Uint8Array {
  const arr = new Uint8Array(binCount)
  const start = Math.max(0, startBin)
  const end = Math.min(binCount, endBin)
  for (let i = start; i < end; i++) {
    arr[i] = value
  }
  return arr
}
