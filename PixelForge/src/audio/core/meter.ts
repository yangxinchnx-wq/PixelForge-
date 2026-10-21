/**
 * 电平计算(Step 41.1)— RMS / 峰值 / 电平表衰减。
 *
 * 职责:
 * - 从采样数据计算 RMS 与峰值电平
 * - 提供电平表读数的衰减模型(峰值保持 + 回落)
 *
 * 全部为纯函数,零 Web Audio / DOM 依赖。
 *
 * 数据流:
 *   AnalyserNode 时域数据(Float32Array)
 *     ↓ computeMeter
 *   MeterReading(rms / peak / clipped)
 *     ↓ meterDriver(RAF 采样)
 *   AudioMeter.vue 渲染
 *
 * 约定:
 * - 所有电平值归一化到 0 ~ 1
 * - 削波判定阈值为 1.0
 */

import type { MeterReading } from './types'
import { clamp, normalizeAmplitude } from './units'

// ============================================================================
// 1. 常量
// ============================================================================

/** 削波判定阈值 */
export const CLIP_THRESHOLD = 1.0

/** 默认峰值保持帧数(约 1 秒 @60fps) */
export const DEFAULT_PEAK_HOLD_FRAMES = 60

/** 默认电平回落系数(每帧乘以此值,越小回落越快) */
export const DEFAULT_DECAY_COEF = 0.92

// ============================================================================
// 2. 基础电平计算
// ============================================================================

/**
 * 计算采样序列的 RMS(均方根)电平。
 *
 * @param samples 采样数据
 * @returns 归一化 RMS(0 ~ 1)
 */
export function computeRms(samples: ArrayLike<number>): number {
  const n = samples.length
  if (n === 0) return 0
  let sumOfSquares = 0
  let validCount = 0
  for (let i = 0; i < n; i++) {
    const v = samples[i]
    // 跳过 NaN,且不计入有效样本数,避免拉低均值
    if (Number.isNaN(v)) continue
    sumOfSquares += v * v
    validCount++
  }
  if (validCount === 0) return 0
  return normalizeAmplitude(Math.sqrt(sumOfSquares / validCount))
}

/**
 * 计算采样序列的峰值电平(绝对值最大者)。
 *
 * @param samples 采样数据
 * @returns 归一化峰值(0 ~ 1)
 */
export function computePeak(samples: ArrayLike<number>): number {
  const n = samples.length
  if (n === 0) return 0
  let peak = 0
  for (let i = 0; i < n; i++) {
    const v = Math.abs(samples[i])
    if (Number.isNaN(v)) continue
    if (v > peak) peak = v
  }
  return normalizeAmplitude(peak)
}

/**
 * 一次性计算完整电平读数。
 *
 * @param samples 采样数据
 * @returns 电平读数(rms / peak / clipped)
 */
export function computeMeter(samples: ArrayLike<number>): MeterReading {
  const peak = computePeak(samples)
  return {
    rms: computeRms(samples),
    peak,
    clipped: peak >= CLIP_THRESHOLD,
  }
}

// ============================================================================
// 3. 电平表衰减模型
// ============================================================================

/**
 * 电平表回落:新值高于当前显示值时立即跟随,低于时按系数缓慢回落。
 *
 * 这让电平表看起来"抬起快、落下慢",符合专业音频设备的观感。
 *
 * @param previous 上一帧显示值
 * @param current 本帧实测值
 * @param decayCoef 回落系数(0 ~ 1),默认 DEFAULT_DECAY_COEF
 */
export function applyMeterDecay(
  previous: number,
  current: number,
  decayCoef: number = DEFAULT_DECAY_COEF,
): number {
  const prev = clamp(previous, 0, 1)
  const cur = clamp(current, 0, 1)
  if (cur >= prev) return cur
  return prev * decayCoef + cur * (1 - decayCoef)
}

/**
 * 峰值保持:在保持期内维持历史峰值,超过保持期后开始回落。
 *
 * @param state 上一帧状态(显示值 + 已保持帧数)
 * @param current 本帧实测峰值
 * @param holdFrames 峰值保持帧数
 * @param decayCoef 回落系数
 */
export function applyPeakHold(
  state: { value: number; holdFrames: number },
  current: number,
  holdFrames: number = DEFAULT_PEAK_HOLD_FRAMES,
  decayCoef: number = DEFAULT_DECAY_COEF,
): { value: number; holdFrames: number } {
  const cur = clamp(current, 0, 1)

  // 新峰值:重置保持计数
  if (cur >= state.value) {
    return { value: cur, holdFrames: 0 }
  }

  // 仍在保持期内:维持原值
  if (state.holdFrames < holdFrames) {
    return { value: state.value, holdFrames: state.holdFrames + 1 }
  }

  // 超过保持期:开始回落
  return {
    value: applyMeterDecay(state.value, cur, decayCoef),
    holdFrames: state.holdFrames + 1,
  }
}

// ============================================================================
// 4. 合并
// ============================================================================

/**
 * 合并左右声道电平读数为单声道显示值(取较大者)。
 */
export function mergeStereoReading(left: MeterReading, right: MeterReading): MeterReading {
  return {
    rms: Math.max(left.rms, right.rms),
    peak: Math.max(left.peak, right.peak),
    clipped: left.clipped || right.clipped,
  }
}
