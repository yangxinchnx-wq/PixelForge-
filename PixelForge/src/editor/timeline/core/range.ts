/**
 * Range(Step 31.1)— 时间区间工具。
 *
 * TimeRange 表示 [start, end) 半开区间。
 * 用于 Clip 的时间范围、轨道占用范围等。
 */

import type { Time } from './time'
import { ZERO, max, min, sub } from './time'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * 时间区间(半开区间 [start, end))。
 *
 * - start: 起始时间(包含)
 * - end:   结束时间(不包含)
 * - duration: end - start(始终 >= 0)
 */
export interface TimeRange {
  start: Time
  end: Time
}

// ============================================================================
// 2. 构造
// ============================================================================

/** 从 start + duration 构造 */
export function fromStartDuration(start: Time, duration: Time): TimeRange {
  if (duration < 0n) throw new Error(`fromStartDuration: duration 不能为负,收到 ${duration}`)
  return { start, end: start + duration }
}

/** 从 start + end 构造(自动保证 start <= end) */
export function fromStartEnd(start: Time, end: Time): TimeRange {
  if (start > end) {
    return { start: end, end: start }
  }
  return { start, end }
}

/** 空区间 */
export function emptyRange(): TimeRange {
  return { start: ZERO, end: ZERO }
}

// ============================================================================
// 3. 属性查询
// ============================================================================

/** 区间时长 */
export function duration(r: TimeRange): Time {
  return sub(r.end, r.start)
}

/** 区间是否为空(start == end) */
export function isEmpty(r: TimeRange): boolean {
  return r.start === r.end
}

/** 时间点是否在区间内 [start, end) */
export function contains(r: TimeRange, time: Time): boolean {
  return time >= r.start && time < r.end
}

/** 时间点是否在区间内 [start, end](闭区间,用于边界吸附) */
export function containsInclusive(r: TimeRange, time: Time): boolean {
  return time >= r.start && time <= r.end
}

// ============================================================================
// 4. 区间运算
// ============================================================================

/** 两个区间是否重叠 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end
}

/** 两个区间的交集(若不重叠则返回空区间) */
export function intersection(a: TimeRange, b: TimeRange): TimeRange {
  if (!overlaps(a, b)) return emptyRange()
  return { start: max(a.start, b.start), end: min(a.end, b.end) }
}

/** 两个区间的并集(若不相邻则返回包含两者的最小区间) */
export function union(a: TimeRange, b: TimeRange): TimeRange {
  return { start: min(a.start, b.start), end: max(a.end, b.end) }
}

/** 平移区间 */
export function shift(r: TimeRange, delta: Time): TimeRange {
  if (delta >= 0n) {
    return { start: r.start + delta, end: r.end + delta }
  }
  const d = -delta
  // 确保 start >= 0
  if (r.start < d) {
    const offset = d - r.start
    return { start: ZERO, end: r.end > offset ? r.end - offset : ZERO }
  }
  return { start: r.start - d, end: r.end - d }
}

/** 裁剪区间到 [lo, hi] 范围内 */
export function clampRange(r: TimeRange, lo: Time, hi: Time): TimeRange {
  const start = r.start < lo ? lo : r.start > hi ? hi : r.start
  const end = r.end < lo ? lo : r.end > hi ? hi : r.end
  return { start, end }
}

// ============================================================================
// 5. 比较与排序
// ============================================================================

/** 按 start 比较(用于排序) */
export function compareByStart(a: TimeRange, b: TimeRange): number {
  if (a.start < b.start) return -1
  if (a.start > b.start) return 1
  if (a.end < b.end) return -1
  if (a.end > b.end) return 1
  return 0
}
