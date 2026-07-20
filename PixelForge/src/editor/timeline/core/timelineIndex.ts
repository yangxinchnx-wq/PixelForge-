/**
 * TimelineIndex(Step 31.1)— 时间轴区间索引。
 *
 * 核心问题:
 *   每帧需要查询"当前时间点有哪些 Clip 活跃"。
 *   朴素方法:遍历所有 Clip → O(n)。
 *   大型项目(10 万 Clip)→ 每秒 600 万次比较 → 性能瓶颈。
 *
 * 解决方案:
 *   按 timelineStart 排序的数组 + 二分查找。
 *   - buildIndex: O(n log n) 排序
 *   - queryPoint: O(log n + k)  k = 活跃 Clip 数
 *   - queryRange: O(log n + k)  k = 重叠 Clip 数
 *
 *   比完整的 Interval Tree 简单且 cache-friendly,
 *   对于典型时间线(clip 不大量重叠)性能更好。
 *
 * 重建策略:
 *   每次 Clip 增删改后调用 buildIndex 重建。
 *   增量更新留待未来优化(如 Red-Black Interval Tree)。
 */

import type { Clip } from './clip'
import type { Time } from './time'

// ============================================================================
// 1. 索引结构
// ============================================================================

/**
 * 排序后的 Clip 条目(按 timelineStart 升序)。
 *
 * @property clip    原始 Clip 引用
 * @property start   = clip.timelineStart(缓存,避免反复访问)
 * @property end     = clip.timelineStart + clip.duration(缓存)
 */
export interface IndexedClipEntry {
  clip: Clip
  start: Time
  end: Time
}

/**
 * TimelineIndex — 单个轨道的区间索引。
 *
 * 内部维护按 start 排序的 entries 数组。
 */
export interface TimelineIndex {
  /** 排序后的 Clip 条目 */
  entries: IndexedClipEntry[]
  /** 关联的 trackId */
  trackId: string
}

// ============================================================================
// 2. 构建
// ============================================================================

/**
 * 为单个轨道构建索引。
 *
 * @param trackId 轨道 ID
 * @param clips   轨道上的 Clip 列表
 * @returns 排序后的索引
 *
 * 复杂度: O(n log n)
 */
export function buildIndex(trackId: string, clips: Clip[]): TimelineIndex {
  const entries: IndexedClipEntry[] = clips.map((clip) => ({
    clip,
    start: clip.timelineStart,
    end: clip.timelineStart + clip.duration,
  }))

  // 按 start 升序排序(start 相同则按 end 升序)
  entries.sort((a, b) => {
    if (a.start < b.start) return -1
    if (a.start > b.start) return 1
    if (a.end < b.end) return -1
    if (a.end > b.end) return 1
    return 0
  })

  return { entries, trackId }
}

/**
 * 为 Sequence 的所有轨道批量构建索引。
 *
 * @param tracks 轨道列表
 * @returns Map<trackId, TimelineIndex>
 */
export function buildSequenceIndex(
  tracks: ReadonlyArray<{ id: string; clips: Clip[] }>,
): Map<string, TimelineIndex> {
  const map = new Map<string, TimelineIndex>()
  for (const track of tracks) {
    map.set(track.id, buildIndex(track.id, track.clips))
  }
  return map
}

// ============================================================================
// 3. 查询 — 按时间点
// ============================================================================

/**
 * 查询时间点处活跃的 Clip 列表。
 *
 * 算法:
 *   1. 二分查找最后一个 start <= time 的 entry
 *   2. 从该位置向前扫描,收集所有 start <= time < end 的 entry
 *   3. 同时向后扫描(处理 start 相同的 entry)
 *
 * 复杂度: O(log n + k)  k = 活跃 Clip 数
 *
 * @param index 轨道索引
 * @param time  查询时间点
 * @returns 活跃的 Clip 列表(按 start 排序)
 */
export function queryPoint(index: TimelineIndex, time: Time): Clip[] {
  const { entries } = index
  if (entries.length === 0) return []

  // 二分查找:找最后一个 start <= time 的位置
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (entries[mid].start <= time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  // lo 现在指向第一个 start > time 的位置
  // 从 lo-1 开始向前扫描

  const result: Clip[] = []

  // 向前扫描:收集所有 start <= time 且 end > time 的 entry
  for (let i = lo - 1; i >= 0; i--) {
    const entry = entries[i]
    if (entry.end > time) {
      result.push(entry.clip)
    }
    // start 已小于 time,继续向前可能有更早 start 但 end > time 的 entry(重叠 Clip)
  }

  // 反转结果(按 start 升序)
  result.reverse()

  return result
}

// ============================================================================
// 4. 查询 — 按区间
// ============================================================================

/**
 * 查询与 [queryStart, queryEnd) 重叠的所有 Clip。
 *
 * 算法:
 *   1. 二分查找第一个 start >= queryStart - maxDuration 的位置
 *   2. 向后扫描,收集 start < queryEnd 且 end > queryStart 的 entry
 *
 * 复杂度: O(log n + k)  k = 重叠 Clip 数
 *
 * @param index      轨道索引
 * @param queryStart 查询区间起始
 * @param queryEnd   查询区间结束
 * @returns 重叠的 Clip 列表(按 start 排序)
 */
export function queryRange(
  index: TimelineIndex,
  queryStart: Time,
  queryEnd: Time,
): Clip[] {
  const { entries } = index
  if (entries.length === 0 || queryStart >= queryEnd) return []

  const result: Clip[] = []

  // 二分查找第一个可能重叠的 entry(start >= 0 的最前位置)
  // 因为 Clip 的 start >= 0,且我们需要 start < queryEnd,
  // 从头扫描即可(或用二分优化)
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (entries[mid].start < queryStart) {
      // 该 entry start < queryStart,但可能 end > queryStart(重叠)
      // 需要继续向右找,但也要检查当前位置
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  // lo 指向第一个 start >= queryStart 的位置
  // 但在此之前可能有 start < queryStart 且 end > queryStart 的 entry

  // 从 max(0, lo-1) 开始向前检查重叠
  const startIdx = Math.max(0, lo - 1)
  for (let i = startIdx; i >= 0; i--) {
    const entry = entries[i]
    if (entry.end <= queryStart) break // end <= queryStart,不重叠,且更早的也不会重叠
    // entry.start < queryStart 且 entry.end > queryStart → 重叠
    result.push(entry.clip)
  }
  result.reverse()

  // 从 lo 开始向后扫描 start < queryEnd 的 entry
  for (let i = lo; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.start >= queryEnd) break // start >= queryEnd,不重叠,且更后的也不会
    // entry.start < queryEnd 且 entry.end > queryStart(因为 start >= queryStart)
    result.push(entry.clip)
  }

  return result
}

// ============================================================================
// 5. 工具
// ============================================================================

/** 索引中的 Clip 数量 */
export function indexSize(index: TimelineIndex): number {
  return index.entries.length
}

/** 索引是否为空 */
export function isIndexEmpty(index: TimelineIndex): boolean {
  return index.entries.length === 0
}
