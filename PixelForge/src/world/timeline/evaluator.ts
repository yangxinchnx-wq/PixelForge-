/**
 * PixelForge - Timeline 求值器（骨架 §6 / §7.2 Phase F）
 *
 * 给定时间点，求值所有轨道，生成 ValuePatch 列表。
 *
 * 数据流（骨架 §7.2 Phase F）：
 *   Timeline(time) → evaluate(timeline, time) → ValuePatch[] → patchEngine → RenderIR
 *
 * 关键帧驱动的参数 owner = 'l3_timeline'（骨架 §4.1.5）。
 * Patch source = 'l3_timeline'（骨架 §4.2.10）。
 */

import type { JsonLiteral } from '@/shared/types'
import type { ValuePatch } from '@/compiler/ir/patch'
import type {
  TimelineContent,
  TimelineTrack,
  TimelineKeyframe,
  TimelineEvaluationResult,
} from '../types'

// ============================================================================
// 1. 插值函数
// ============================================================================

/**
 * 在两个关键帧之间插值。
 *
 * @param t 当前时间
 * @param k1 前一关键帧
 * @param k2 后一关键帧
 * @returns 插值后的值，或 null（无法插值）
 */
export function interpolateKeyframes(
  t: number,
  k1: TimelineKeyframe,
  k2: TimelineKeyframe,
): JsonLiteral | null {
  const t1 = k1.time
  const t2 = k2.time

  // 时间完全相等：取后一帧
  if (t1 === t2) return k2.value

  // 归一化时间 [0, 1]
  const u = (t - t1) / (t2 - t1)
  // clamp
  const clampedU = Math.max(0, Math.min(1, u))

  switch (k1.interpolation) {
    case 'linear':
      return lerpJsonLiteral(k1.value, k2.value, clampedU)

    case 'bezier':
      return bezierInterpolate(k1, k2, clampedU)

    case 'step':
    case 'hold':
      // 阶跃：保持前一帧值
      return k1.value

    default:
      return k1.value
  }
}

/**
 * 线性插值 JsonLiteral。
 *
 * 支持 number 和 [number, number, number, number] 颜色数组。
 * 其他类型取前一帧值（不插值）。
 */
function lerpJsonLiteral(a: JsonLiteral, b: JsonLiteral, t: number): JsonLiteral {
  // number 插值
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * t
  }

  // 数组插值（逐元素）
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((ai, i) => {
      const bi = b[i]
      if (typeof ai === 'number' && typeof bi === 'number') {
        return ai + (bi - ai) * t
      }
      return ai // 非数字元素不插值
    })
  }

  // 其他类型不插值，取前一帧值
  return a
}

/**
 * 贝塞尔曲线插值。
 *
 * 使用三次贝塞尔曲线：B(u) = (1-u)³P0 + 3(1-u)²uP1 + 3(1-u)u²P2 + u³P3
 * 其中 P0 = k1.value, P3 = k2.value, P1/P2 由 bezierControl 决定。
 */
function bezierInterpolate(
  k1: TimelineKeyframe,
  k2: TimelineKeyframe,
  u: number,
): JsonLiteral {
  // 无控制点时退化为线性
  if (!k1.bezierControl) {
    return lerpJsonLiteral(k1.value, k2.value, u)
  }

  // 对 number 值使用贝塞尔
  if (typeof k1.value === 'number' && typeof k2.value === 'number') {
    const cp1y = k1.bezierControl.cp1[1]
    const cp2y = k1.bezierControl.cp2[1]
    // 三次贝塞尔 Y 分量
    const u3 = u * u * u
    const u2 = u * u
    const v = (1 - u) ** 3 * k1.value
      + 3 * (1 - u) ** 2 * u * cp1y
      + 3 * (1 - u) * u2 * cp2y
      + u3 * k2.value
    return v
  }

  // 非 number 退化为线性
  return lerpJsonLiteral(k1.value, k2.value, u)
}

// ============================================================================
// 2. 单轨道求值
// ============================================================================

/**
 * 求值单条轨道在指定时间点的值。
 *
 * @param track 轨道
 * @param time 当前时间（秒）
 * @returns 插值后的值，或 null（无关键帧）
 */
export function evaluateTrack(
  track: TimelineTrack,
  time: number,
): JsonLiteral | null {
  if (!track.enabled || track.keyframes.length === 0) {
    return null
  }

  const keyframes = track.keyframes

  // 时间在第一帧之前
  if (time <= keyframes[0].time) {
    return keyframes[0].value
  }

  // 时间在最后一帧之后
  const last = keyframes[keyframes.length - 1]
  if (time >= last.time) {
    return last.value
  }

  // 二分查找关键帧区间
  let lo = 0
  let hi = keyframes.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (time < keyframes[mid].time) {
      hi = mid
    } else {
      lo = mid
    }
  }

  // 在 keyframes[lo] 和 keyframes[hi] 之间插值
  return interpolateKeyframes(time, keyframes[lo], keyframes[hi])
}

// ============================================================================
// 3. 完整时间轴求值
// ============================================================================

/**
 * 求值整个时间轴在指定时间点的所有轨道。
 *
 * 为每条启用的轨道生成一个 ValuePatch（source = 'l3_timeline'）。
 *
 * @param timeline 时间轴内容
 * @param time 当前时间（秒）
 * @returns 求值结果，包含 ValuePatch 列表
 */
export function evaluateTimeline(
  timeline: TimelineContent,
  time: number,
): TimelineEvaluationResult {
  const patches: ValuePatch[] = []
  const skippedTracks: string[] = []

  for (const track of timeline.tracks) {
    if (!track.enabled || track.keyframes.length === 0) {
      skippedTracks.push(track.id)
      continue
    }

    const value = evaluateTrack(track, time)
    if (value === null) {
      skippedTracks.push(track.id)
      continue
    }

    const patch: ValuePatch = {
      patchId: `timeline_${timeline.id}_${track.id}_${time.toFixed(6)}`,
      tier: 'value',
      source: 'l3_timeline',
      targetEntity: track.targetEntity,
      targetId: track.targetId,
      paramKey: track.paramKey,
      value,
    }

    patches.push(patch)
  }

  return {
    currentTime: time,
    patches,
    skippedTracks,
  }
}
