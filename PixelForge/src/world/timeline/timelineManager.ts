/**
 * PixelForge - Timeline 管理器（骨架 §6 Phase F）
 *
 * 提供 Timeline 的创建、轨道管理、关键帧 CRUD 等操作。
 *
 * 所有操作都是 immutable 的（返回新对象，不修改输入）。
 */

import type {
  TimelineContent,
  TimelineTrack,
  TimelineKeyframe,
  KeyframeInterpolation,
} from '../types'
import type { JsonLiteral } from '@/shared/types'

// ============================================================================
// ID 生成
// ============================================================================

let idCounter = 0

function genId(prefix: string): string {
  idCounter++
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

// ============================================================================
// 关键帧创建
// ============================================================================

/**
 * 创建关键帧。
 */
export function createKeyframe(
  time: number,
  value: JsonLiteral,
  interpolation: KeyframeInterpolation = 'linear',
  bezierControl?: { cp1: [number, number]; cp2: [number, number] },
): TimelineKeyframe {
  return {
    id: genId('kf'),
    time,
    value,
    interpolation,
    bezierControl,
  }
}

// ============================================================================
// 轨道创建
// ============================================================================

/**
 * 创建时间轴轨道。
 */
export function createTrack(
  name: string,
  targetEntity: 'layer' | 'effect',
  targetId: string,
  paramKey: string,
): TimelineTrack {
  return {
    id: genId('track'),
    name,
    targetEntity,
    targetId,
    paramKey,
    keyframes: [],
    enabled: true,
  }
}

// ============================================================================
// 时间轴创建
// ============================================================================

/**
 * 创建空时间轴。
 */
export function createTimeline(
  duration: number = 10,
  fps: number = 30,
  loop: boolean = false,
): TimelineContent {
  return {
    id: genId('timeline'),
    tracks: [],
    duration,
    loop,
    fps,
  }
}

// ============================================================================
// 轨道管理（immutable）
// ============================================================================

/**
 * 添加轨道到时间轴。
 */
export function addTrack(
  timeline: TimelineContent,
  track: TimelineTrack,
): TimelineContent {
  return {
    ...timeline,
    tracks: [...timeline.tracks, track],
  }
}

/**
 * 从时间轴移除轨道。
 */
export function removeTrack(
  timeline: TimelineContent,
  trackId: string,
): TimelineContent {
  return {
    ...timeline,
    tracks: timeline.tracks.filter((t) => t.id !== trackId),
  }
}

/**
 * 更新轨道。
 */
export function updateTrack(
  timeline: TimelineContent,
  trackId: string,
  updates: Partial<Omit<TimelineTrack, 'id'>>,
): TimelineContent {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId ? { ...t, ...updates } : t,
    ),
  }
}

// ============================================================================
// 关键帧管理（immutable）
// ============================================================================

/**
 * 向轨道添加关键帧。
 *
 * 关键帧按 time 升序排列。
 */
export function addKeyframe(
  timeline: TimelineContent,
  trackId: string,
  keyframe: TimelineKeyframe,
): TimelineContent {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.id !== trackId) return t
      const keyframes = [...t.keyframes, keyframe]
      keyframes.sort((a, b) => a.time - b.time)
      return { ...t, keyframes }
    }),
  }
}

/**
 * 从轨道移除关键帧。
 */
export function removeKeyframe(
  timeline: TimelineContent,
  trackId: string,
  keyframeId: string,
): TimelineContent {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId
        ? { ...t, keyframes: t.keyframes.filter((k) => k.id !== keyframeId) }
        : t,
    ),
  }
}

/**
 * 更新关键帧。
 */
export function updateKeyframe(
  timeline: TimelineContent,
  trackId: string,
  keyframeId: string,
  updates: Partial<Omit<TimelineKeyframe, 'id'>>,
): TimelineContent {
  return {
    ...timeline,
    tracks: timeline.tracks.map((t) => {
      if (t.id !== trackId) return t
      const keyframes = t.keyframes.map((k) =>
        k.id === keyframeId ? { ...k, ...updates } : k,
      )
      // 如果更新了 time，需要重新排序
      if ('time' in updates) {
        keyframes.sort((a, b) => a.time - b.time)
      }
      return { ...t, keyframes }
    }),
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 获取时间轴的总时长（所有关键帧的最大 time）。
 */
export function getTimelineDuration(timeline: TimelineContent): number {
  let maxTime = 0
  for (const track of timeline.tracks) {
    for (const kf of track.keyframes) {
      if (kf.time > maxTime) maxTime = kf.time
    }
  }
  return maxTime
}

/**
 * 规范化时间轴：更新 duration 为实际关键帧最大时间。
 */
export function normalizeTimeline(timeline: TimelineContent): TimelineContent {
  const actualDuration = getTimelineDuration(timeline)
  return {
    ...timeline,
    duration: Math.max(timeline.duration, actualDuration),
  }
}

/**
 * 重置 ID 生成器（用于测试隔离）。
 */
export function resetTimelineIdCounter(): void {
  idCounter = 0
}
