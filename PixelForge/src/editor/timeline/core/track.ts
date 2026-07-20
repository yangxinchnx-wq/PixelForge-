/**
 * Track(Step 31.1)— 轨道模型。
 *
 * 轨道是 Clip 的容器,按类型分层:
 * - VIDEO: 视频轨道(上层覆盖下层,类似 PS 图层)
 * - AUDIO: 音频轨道(混合播放)
 * - TEXT:  字幕轨道
 * - EFFECT: 特效轨道(整轨特效,如调色)
 *
 * 轨道有 index 属性,index 越大显示在上方(VIDEO 类型)。
 */

import type { Clip } from './clip'
import { compareClipByStart } from './clip'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * 轨道类型。
 *
 * - VIDEO:    视频轨道(可含 video/image clip,上层覆盖下层)
 * - AUDIO:    音频轨道(可含 audio/video clip 的音频部分)
 * - TEXT:     字幕轨道(文字 clip)
 * - EFFECT:   特效轨道(整轨特效,不含 clip,直接作用于下方所有轨道)
 */
export enum TrackType {
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  EFFECT = 'effect',
}

/**
 * Track — 时间轴轨道。
 *
 * @property id       唯一 ID
 * @property type     轨道类型
 * @property index    轨道序号(VIDEO 类型中 index 越大越靠上)
 * @property name     轨道名称(如 "Video 1")
 * @property clips    片段列表(按 timelineStart 排序)
 * @property visible  是否可见(渲染时是否参与)
 * @property locked   是否锁定(锁定后不可编辑)
 * @property muted    是否静音(仅 AUDIO 类型)
 * @property height   轨道高度(UI,像素)
 * @property volume   轨道音量(0-1,仅 AUDIO 类型)
 */
export interface Track {
  id: string
  type: TrackType
  index: number
  name: string
  clips: Clip[]
  visible: boolean
  locked: boolean
  muted: boolean
  height: number
  volume: number
}

// ============================================================================
// 2. 构造
// ============================================================================

let trackIdCounter = 0

/** 生成唯一 Track ID */
export function genTrackId(): string {
  trackIdCounter++
  return `track_${trackIdCounter.toString(36)}`
}

/**
 * 创建 Track。
 *
 * @param type  轨道类型
 * @param index 轨道序号
 * @param name  轨道名称(可选,默认自动生成)
 */
export function createTrack(
  type: TrackType,
  index: number,
  name?: string,
): Track {
  const defaultName = name ?? `${type.charAt(0).toUpperCase() + type.slice(1)} ${index + 1}`
  return {
    id: genTrackId(),
    type,
    index,
    name: defaultName,
    clips: [],
    visible: true,
    locked: false,
    muted: false,
    height: type === TrackType.AUDIO ? 64 : 80,
    volume: 1,
  }
}

// ============================================================================
// 3. Clip 管理(不可变操作,返回新 Track)
// ============================================================================

/**
 * 向轨道添加 Clip(自动保持按 timelineStart 排序)。
 *
 * @returns 新的 Track(clips 已排序)
 */
export function addClipToTrack(track: Track, clip: Clip): Track {
  const clips = [...track.clips, clip].sort(compareClipByStart)
  return { ...track, clips }
}

/**
 * 从轨道移除指定 ID 的 Clip。
 */
export function removeClipFromTrack(track: Track, clipId: string): Track {
  return {
    ...track,
    clips: track.clips.filter((c) => c.id !== clipId),
  }
}

/**
 * 替换轨道中的 Clip(用于 move/trim 操作)。
 *
 * @param track    原 Track
 * @param clipId   要替换的 Clip ID
 * @param newClip  新 Clip
 * @returns 新的 Track(clips 已重新排序)
 */
export function replaceClipInTrack(track: Track, clipId: string, newClip: Clip): Track {
  const clips = track.clips
    .map((c) => (c.id === clipId ? newClip : c))
    .sort(compareClipByStart)
  return { ...track, clips }
}

/**
 * 按时间点查找轨道上活跃的 Clip。
 *
 * @returns 第一个 timelineStart <= time < end 的 Clip,或 null
 */
export function findClipAt(track: Track, time: bigint): Clip | null {
  for (const clip of track.clips) {
    if (time >= clip.timelineStart && time < clip.timelineStart + clip.duration) {
      return clip
    }
  }
  return null
}

/**
 * 按区间查找重叠的 Clip。
 *
 * @returns 所有与 [start, end) 重叠的 Clip
 */
export function findClipsInRange(track: Track, start: bigint, end: bigint): Clip[] {
  return track.clips.filter(
    (clip) => clip.timelineStart < end && clip.timelineStart + clip.duration > start,
  )
}

// ============================================================================
// 4. 属性修改
// ============================================================================

export function setTrackVisible(track: Track, visible: boolean): Track {
  return { ...track, visible }
}

export function setTrackLocked(track: Track, locked: boolean): Track {
  return { ...track, locked }
}

export function setTrackMuted(track: Track, muted: boolean): Track {
  return { ...track, muted }
}

export function setTrackVolume(track: Track, volume: number): Track {
  return { ...track, volume: Math.max(0, Math.min(1, volume)) }
}

// ============================================================================
// 5. 工具
// ============================================================================

/** 轨道总时长(最后一个 Clip 的结束时间) */
export function getTrackDuration(track: Track): bigint {
  if (track.clips.length === 0) return 0n
  let max = 0n
  for (const clip of track.clips) {
    const end = clip.timelineStart + clip.duration
    if (end > max) max = end
  }
  return max
}

/** 轨道是否为空(无 Clip) */
export function isTrackEmpty(track: Track): boolean {
  return track.clips.length === 0
}
