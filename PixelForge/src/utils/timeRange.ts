/**
 * TimeRange — 时间区间工具（基于 number 秒）。
 *
 * 半开区间 [start, end)。
 * 提取自 ProTimeline 的 range.ts，适配为 number 秒版本。
 * 用于 Clip 的时间范围、轨道占用范围、碰撞检测等。
 */

export interface TimeRange {
  start: number;
  end: number;
}

/** 从 start + duration 构造 */
export function fromStartDuration(start: number, duration: number): TimeRange {
  if (duration < 0) throw new Error(`fromStartDuration: duration 不能为负，收到 ${duration}`);
  return { start, end: start + duration };
}

/** 从 start + end 构造（自动保证 start <= end） */
export function fromStartEnd(start: number, end: number): TimeRange {
  if (start > end) return { start: end, end: start };
  return { start, end };
}

/** 区间时长 */
export function duration(r: TimeRange): number {
  return r.end - r.start;
}

/** 区间是否为空 */
export function isEmpty(r: TimeRange): boolean {
  return r.start === r.end;
}

/** 时间点是否在区间内 [start, end) */
export function contains(r: TimeRange, time: number): boolean {
  return time >= r.start && time < r.end;
}

/** 时间点是否在区间内 [start, end]（闭区间，用于边界吸附） */
export function containsInclusive(r: TimeRange, time: number): boolean {
  return time >= r.start && time <= r.end;
}

/** 两个区间是否重叠 */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 两个区间的交集 */
export function intersection(a: TimeRange, b: TimeRange): TimeRange | null {
  if (!overlaps(a, b)) return null;
  return { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) };
}

/** 两个区间的并集 */
export function union(a: TimeRange, b: TimeRange): TimeRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/** 平移区间 */
export function shift(r: TimeRange, delta: number): TimeRange {
  const start = Math.max(0, r.start + delta);
  return { start, end: start + (r.end - r.start) };
}

/** 裁剪区间到 [lo, hi] 范围内 */
export function clampRange(r: TimeRange, lo: number, hi: number): TimeRange {
  return {
    start: Math.max(lo, Math.min(hi, r.start)),
    end: Math.max(lo, Math.min(hi, r.end)),
  };
}
