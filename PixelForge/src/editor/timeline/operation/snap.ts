/**
 * Snap(Step 31.1)— 吸附系统。
 *
 * 核心体验:
 * 拖动 Clip 时,若 Clip 的 start/end 接近某个"吸附目标"(其他 Clip 边缘、
 * 播放头、标记点),自动吸附到该目标。
 *
 * 吸附目标:
 * - 其他 Clip 的 start / end
 * - 播放头位置
 * - 标记点(Markers)
 * - 时间轴起点(0)
 *
 * 算法:
 *   1. 收集所有吸附目标时间点
 *   2. 计算 Clip 的 start/end 与每个目标的距离
 *   3. 若距离 < threshold,返回最近的目标时间
 */

import type { Time } from '../core/time'
import { ZERO } from '../core/time'
import { getClipEnd } from '../core/clip'
import type { Sequence } from '../core/sequence'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * 吸附目标类型。
 */
export type SnapTargetType = 'clip-start' | 'clip-end' | 'playhead' | 'marker' | 'origin'

/**
 * 单个吸附目标。
 */
export interface SnapTarget {
  time: Time
  type: SnapTargetType
  /** 关联的 Clip ID(若 type 是 clip-start / clip-end) */
  clipId?: string
}

/**
 * 吸附结果。
 */
export interface SnapResult {
  /** 是否吸附成功 */
  snapped: boolean
  /** 吸附后的时间(若 snapped=false 则为原值) */
  time: Time
  /** 吸附到的目标(若 snapped=false 则为 null) */
  target: SnapTarget | null
}

// ============================================================================
// 2. 收集吸附目标
// ============================================================================

/**
 * 收集 Sequence 中所有可吸附的时间点。
 *
 * @param sequence      目标 Sequence
 * @param playheadTime  播放头位置(可选)
 * @param markers       标记点列表(可选)
 * @param excludeClipId 排除的 Clip ID(拖动中的 Clip 自身边缘不作为目标)
 * @returns 吸附目标列表
 */
export function collectSnapTargets(
  sequence: Sequence,
  playheadTime?: Time,
  markers?: Time[],
  excludeClipId?: string,
): SnapTarget[] {
  const targets: SnapTarget[] = []

  // 时间轴起点
  targets.push({ time: ZERO, type: 'origin' })

  // 所有 Clip 的 start / end
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue
      targets.push({ time: clip.timelineStart, type: 'clip-start', clipId: clip.id })
      targets.push({ time: getClipEnd(clip), type: 'clip-end', clipId: clip.id })
    }
  }

  // 播放头
  if (playheadTime !== undefined) {
    targets.push({ time: playheadTime, type: 'playhead' })
  }

  // 标记点
  if (markers) {
    for (const m of markers) {
      targets.push({ time: m, type: 'marker' })
    }
  }

  return targets
}

// ============================================================================
// 3. 吸附查找
// ============================================================================

/**
 * 查找最近的吸附目标。
 *
 * @param time       待吸附的时间
 * @param targets    吸附目标列表
 * @param threshold  吸附阈值(微秒,默认 100ms = 100_000n)
 * @returns 吸附结果
 */
export function findSnap(
  time: Time,
  targets: SnapTarget[],
  threshold: Time = 100_000n,
): SnapResult {
  let bestTarget: SnapTarget | null = null
  let bestDist = threshold

  for (const target of targets) {
    const dist = time > target.time ? time - target.time : target.time - time
    if (dist < bestDist) {
      bestDist = dist
      bestTarget = target
    }
  }

  if (bestTarget) {
    return { snapped: true, time: bestTarget.time, target: bestTarget }
  }

  return { snapped: false, time, target: null }
}

/**
 * 对 Clip 的 start/end 同时进行吸附(拖动时用)。
 *
 * 优先吸附 start,若 start 未吸附则尝试 end。
 *
 * @param clipStart    Clip 的起始时间
 * @param clipEnd      Clip 的结束时间
 * @param targets      吸附目标
 * @param threshold    阈值
 * @returns 吸附后的 start(若吸附了 end,则 start = snappedEnd - duration)
 */
export function snapClipPosition(
  clipStart: Time,
  clipEnd: Time,
  targets: SnapTarget[],
  threshold: Time = 100_000n,
): { start: Time; end: Time; snapped: boolean; target: SnapTarget | null } {
  // 先吸附 start
  const startSnap = findSnap(clipStart, targets, threshold)
  if (startSnap.snapped) {
    const duration = clipEnd - clipStart
    return {
      start: startSnap.time,
      end: startSnap.time + duration,
      snapped: true,
      target: startSnap.target,
    }
  }

  // 再吸附 end
  const endSnap = findSnap(clipEnd, targets, threshold)
  if (endSnap.snapped) {
    const duration = clipEnd - clipStart
    const newEnd = endSnap.time
    const newStart = newEnd - duration
    if (newStart >= 0n) {
      return {
        start: newStart,
        end: newEnd,
        snapped: true,
        target: endSnap.target,
      }
    }
  }

  return { start: clipStart, end: clipEnd, snapped: false, target: null }
}
