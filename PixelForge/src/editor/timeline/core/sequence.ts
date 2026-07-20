/**
 * Sequence(Step 31.1)— 时间线工程。
 *
 * Sequence 是一个完整的时间线(类似 Premiere 的 Sequence / Resolve 的 Timeline)。
 * 包含多条轨道(Video / Audio / Text / Effect),有独立的分辨率和帧率。
 *
 * 一个 Project 可以包含多个 Sequence(如正片 + 片头 + 片尾)。
 */

import type { Time } from './time'
import { ZERO, seconds } from './time'
import type { Track } from './track'
import { TrackType, createTrack, getTrackDuration } from './track'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * Sequence — 时间线工程。
 *
 * @property id        唯一 ID
 * @property name      工程名称
 * @property duration  工程时长(微秒,可被 Clip 超出)
 * @property fps       帧率(24/25/30/60)
 * @property width     画面宽度(像素)
 * @property height    画面高度(像素)
 * @property tracks    轨道列表(按 index 排序)
 * @property createdAt 创建时间戳
 * @property updatedAt 更新时间戳
 */
export interface Sequence {
  id: string
  name: string
  duration: Time
  fps: number
  width: number
  height: number
  tracks: Track[]
  createdAt: number
  updatedAt: number
}

// ============================================================================
// 2. 常量
// ============================================================================

/** 默认帧率 */
export const DEFAULT_FPS = 30

/** 默认分辨率 1080p */
export const DEFAULT_WIDTH = 1920
export const DEFAULT_HEIGHT = 1080

/** 默认工程时长 60 秒 */
export const DEFAULT_DURATION = seconds(60)

// ============================================================================
// 3. 构造
// ============================================================================

let sequenceIdCounter = 0

/** 生成唯一 Sequence ID */
export function genSequenceId(): string {
  sequenceIdCounter++
  return `seq_${sequenceIdCounter.toString(36)}`
}

/**
 * 创建 Sequence(默认包含 1 条视频轨 + 1 条音频轨)。
 *
 * @param options 部分属性(可选字段有默认值)
 */
export function createSequence(options?: {
  name?: string
  fps?: number
  width?: number
  height?: number
  duration?: Time
  id?: string
}): Sequence {
  const {
    name = '主序列',
    fps = DEFAULT_FPS,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    duration = DEFAULT_DURATION,
    id,
  } = options ?? {}

  const now = Date.now()

  return {
    id: id ?? genSequenceId(),
    name,
    duration,
    fps,
    width,
    height,
    tracks: [
      createTrack(TrackType.VIDEO, 0, 'Video 1'),
      createTrack(TrackType.AUDIO, 0, 'Audio 1'),
    ],
    createdAt: now,
    updatedAt: now,
  }
}

// ============================================================================
// 4. 轨道管理
// ============================================================================

/**
 * 添加轨道(按类型分组,VIDEO 在上方,AUDIO 在下方)。
 *
 * @param sequence 原 Sequence
 * @param type     轨道类型
 * @param name     轨道名称(可选)
 * @returns 新的 Sequence
 */
export function addTrack(
  sequence: Sequence,
  type: TrackType,
  name?: string,
): Sequence {
  // 计算同类型轨道数,作为 index
  const sameTypeCount = sequence.tracks.filter((t) => t.type === type).length
  const newTrack = createTrack(type, sameTypeCount, name)

  const tracks = [...sequence.tracks, newTrack]
  // 排序:VIDEO → TEXT → EFFECT → AUDIO(视频在上,音频在下)
  const order: Record<TrackType, number> = {
    [TrackType.VIDEO]: 0,
    [TrackType.TEXT]: 1,
    [TrackType.EFFECT]: 2,
    [TrackType.AUDIO]: 3,
  }
  tracks.sort((a, b) => {
    const o = order[a.type] - order[b.type]
    if (o !== 0) return o
    return a.index - b.index
  })

  return { ...sequence, tracks, updatedAt: Date.now() }
}

/**
 * 移除轨道。
 */
export function removeTrack(sequence: Sequence, trackId: string): Sequence {
  return {
    ...sequence,
    tracks: sequence.tracks.filter((t) => t.id !== trackId),
    updatedAt: Date.now(),
  }
}

/**
 * 替换轨道(用于 Clip 增删改)。
 */
export function replaceTrack(
  sequence: Sequence,
  trackId: string,
  newTrack: Track,
): Sequence {
  return {
    ...sequence,
    tracks: sequence.tracks.map((t) => (t.id === trackId ? newTrack : t)),
    updatedAt: Date.now(),
  }
}

// ============================================================================
// 5. 查询
// ============================================================================

/** 按 ID 查找轨道 */
export function findTrackById(sequence: Sequence, trackId: string): Track | null {
  return sequence.tracks.find((t) => t.id === trackId) ?? null
}

/** 按类型筛选轨道 */
export function getTracksByType(sequence: Sequence, type: TrackType): Track[] {
  return sequence.tracks.filter((t) => t.type === type)
}

/**
 * 计算 Sequence 的实际时长(所有轨道中最长的 Clip 结束时间)。
 *
 * 若所有轨道为空,返回 duration 属性值。
 */
export function getActualDuration(sequence: Sequence): Time {
  let maxEnd = ZERO
  for (const track of sequence.tracks) {
    const trackDur = getTrackDuration(track)
    if (trackDur > maxEnd) maxEnd = trackDur
  }
  return maxEnd > sequence.duration ? maxEnd : sequence.duration
}

/** 按 ID 查找 Clip(跨所有轨道) */
export function findClipById(
  sequence: Sequence,
  clipId: string,
): { clip: import('./clip').Clip; track: Track } | null {
  for (const track of sequence.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { clip, track }
  }
  return null
}

/** 统计所有 Clip 数量 */
export function getTotalClipCount(sequence: Sequence): number {
  let count = 0
  for (const track of sequence.tracks) {
    count += track.clips.length
  }
  return count
}
