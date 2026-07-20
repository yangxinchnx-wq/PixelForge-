/**
 * TimelineResolver(Step 31.1)— 时间轴解析器。
 *
 * 核心职责:
 * 给定时间点,返回所有轨道上活跃的 Clip。
 *
 * 数据流:
 *   Sequence + time
 *     ↓
 *   TimelineIndex(每轨道一个)
 *     ↓ queryPoint
 *   Active Clips(按轨道分组)
 *     ↓
 *   FrameResolver → RenderQueue
 */

import type { Sequence } from '../core/sequence'
import type { Time } from '../core/time'
import type { Clip } from '../core/clip'
import type { Track } from '../core/track'
import { TrackType } from '../core/track'
import {
  buildSequenceIndex,
  queryPoint,
  type TimelineIndex,
} from '../core/timelineIndex'

// ============================================================================
// 1. 解析结果
// ============================================================================

/**
 * 单个轨道在某时间点的解析结果。
 */
export interface TrackResolveResult {
  track: Track
  /** 活跃的 Clip(按 timelineStart 升序) */
  activeClips: Clip[]
}

/**
 * 整个 Sequence 在某时间点的解析结果。
 */
export interface TimelineResolveResult {
  /** 查询的时间点 */
  time: Time
  /** 按轨道分组的活跃 Clip */
  tracks: TrackResolveResult[]
  /** 所有轨道的活跃 Clip 扁平化(按轨道顺序 + start 排序) */
  allActiveClips: Clip[]
  /** 活跃 VIDEO Clip(用于渲染合成) */
  videoClips: Clip[]
  /** 活跃 AUDIO Clip(用于音频混合) */
  audioClips: Clip[]
  /** 活跃 TEXT Clip(用于字幕渲染) */
  textClips: Clip[]
}

// ============================================================================
// 2. 缓存的解析器
// ============================================================================

/**
 * CachedTimelineResolver — 带 Sequence 索引缓存的解析器。
 *
 * 用法:
 *   const resolver = new CachedTimelineResolver(sequence)
 *   resolver.build()                          // 构建/重建索引
 *   const result = resolver.resolve(time)     // 查询
 *   // Clip 修改后:
 *   resolver.rebuild()                        // 重建索引
 *
 * 适合在播放循环中复用(避免每帧重建索引)。
 */
export class CachedTimelineResolver {
  private sequence: Sequence
  private indexMap: Map<string, TimelineIndex> = new Map()

  constructor(sequence: Sequence) {
    this.sequence = sequence
    this.build()
  }

  /** 更新 Sequence(自动重建索引) */
  setSequence(sequence: Sequence): void {
    this.sequence = sequence
    this.build()
  }

  /** 构建/重建索引 */
  build(): void {
    this.indexMap = buildSequenceIndex(this.sequence.tracks)
  }

  /** 重建索引(build 的别名,语义更清晰) */
  rebuild(): void {
    this.build()
  }

  /** 解析指定时间点的活跃 Clip */
  resolve(time: Time): TimelineResolveResult {
    const trackResults: TrackResolveResult[] = []
    const allActiveClips: Clip[] = []
    const videoClips: Clip[] = []
    const audioClips: Clip[] = []
    const textClips: Clip[] = []

    for (const track of this.sequence.tracks) {
      // 跳过不可见 / 锁定轨道(锁定仍渲染,只是不可编辑)
      if (!track.visible) {
        trackResults.push({ track, activeClips: [] })
        continue
      }

      const index = this.indexMap.get(track.id)
      const activeClips = index ? queryPoint(index, time) : []

      trackResults.push({ track, activeClips })

      for (const clip of activeClips) {
        if (!clip.enabled) continue
        allActiveClips.push(clip)
        switch (track.type) {
          case TrackType.VIDEO:
            videoClips.push(clip)
            break
          case TrackType.AUDIO:
            audioClips.push(clip)
            break
          case TrackType.TEXT:
            textClips.push(clip)
            break
        }
      }
    }

    return {
      time,
      tracks: trackResults,
      allActiveClips,
      videoClips,
      audioClips,
      textClips,
    }
  }

  /** 获取当前 Sequence */
  getSequence(): Sequence {
    return this.sequence
  }
}

// ============================================================================
// 3. 一次性解析(无缓存,适合偶尔查询)
// ============================================================================

/**
 * 解析 Sequence 在指定时间点的活跃 Clip(无缓存)。
 *
 * 每次调用都会重建索引,适合偶尔查询。
 * 播放循环中应使用 CachedTimelineResolver。
 *
 * @param sequence 目标 Sequence
 * @param time     查询时间点
 */
export function resolveTimeline(
  sequence: Sequence,
  time: Time,
): TimelineResolveResult {
  const resolver = new CachedTimelineResolver(sequence)
  return resolver.resolve(time)
}

/**
 * 解析单个轨道在某时间点的活跃 Clip(无缓存)。
 *
 * @param track 目标轨道
 * @param time  查询时间点
 * @returns 活跃 Clip 列表
 */
export function resolveTrack(track: Track, time: Time): Clip[] {
  if (!track.visible) return []
  // 对单轨道查询,直接线性扫描(轨道内 Clip 数通常不大)
  return track.clips.filter(
    (clip) => clip.enabled && time >= clip.timelineStart && time < clip.timelineStart + clip.duration,
  )
}
