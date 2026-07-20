/**
 * Commands(Step 31.1)— 具体命令实现。
 *
 * 所有时间轴操作都封装为 Command,支持 undo/redo。
 *
 * 命令列表:
 * - AddClipCommand:       添加 Clip 到轨道
 * - DeleteClipCommand:    删除 Clip
 * - MoveClipCommand:      移动 Clip 位置(timelineStart)
 * - TrimClipCommand:      修剪 Clip 边界(left / right)
 * - CutClipCommand:       在指定时间点切割 Clip(一分为二)
 * - RippleDeleteCommand:  涟漪删除(删除 Clip 并后移前方填补空隙)
 */

import type { Time } from '../core/time'
import type { Clip } from '../core/clip'
import { createClip, trimClipLeft, trimClipRight } from '../core/clip'
import type { Track } from '../core/track'
import { addClipToTrack, removeClipFromTrack, replaceClipInTrack } from '../core/track'
import type { Sequence } from '../core/sequence'
import { findTrackById } from '../core/sequence'
import { BaseCommand, genCommandId, type MutableSequenceState } from './command'

// ============================================================================
// 辅助:在 sequence 中替换 Track
// ============================================================================

/**
 * 在 Sequence.tracks 中替换指定的 Track(原地修改)。
 *
 * @param sequence 目标 Sequence
 * @param trackId  要替换的 Track ID
 * @param newTrack 新 Track
 */
function swapTrack(sequence: Sequence, trackId: string, newTrack: Track): void {
  const idx = sequence.tracks.findIndex((t) => t.id === trackId)
  if (idx >= 0) {
    sequence.tracks[idx] = newTrack
  }
}

// ============================================================================
// 1. AddClipCommand — 添加 Clip
// ============================================================================

/**
 * 添加 Clip 到指定轨道。
 *
 * execute: 把 clip 加入 track
 * undo:    从 track 移除 clip
 */
export class AddClipCommand extends BaseCommand {
  readonly id = genCommandId('add')
  readonly label = '添加片段'
  private trackId: string
  private clip: Clip
  private oldTrack: Track | null = null

  constructor(state: MutableSequenceState, trackId: string, clip: Clip) {
    super(state)
    this.trackId = trackId
    this.clip = clip
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`AddClipCommand: 轨道 ${this.trackId} 不存在`)
    this.oldTrack = track
    const newTrack = addClipToTrack(track, this.clip)
    swapTrack(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (!this.oldTrack) return
    // 恢复旧 Track(不含新 Clip)
    swapTrack(this.state.sequence, this.trackId, this.oldTrack)
  }
}

// ============================================================================
// 2. DeleteClipCommand — 删除 Clip
// ============================================================================

/**
 * 删除指定 Clip。
 *
 * execute: 从 track 移除 clip
 * undo:    把 clip 重新加入 track
 */
export class DeleteClipCommand extends BaseCommand {
  readonly id = genCommandId('del')
  readonly label = '删除片段'
  private trackId: string
  private clipId: string
  private oldTrack: Track | null = null
  private deletedClip: Clip | null = null

  constructor(state: MutableSequenceState, trackId: string, clipId: string) {
    super(state)
    this.trackId = trackId
    this.clipId = clipId
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`DeleteClipCommand: 轨道 ${this.trackId} 不存在`)
    this.oldTrack = track
    this.deletedClip = track.clips.find((c) => c.id === this.clipId) ?? null
    if (!this.deletedClip) return
    const newTrack = removeClipFromTrack(track, this.clipId)
    swapTrack(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (!this.oldTrack || !this.deletedClip) return
    // 恢复旧 Track(含被删除的 Clip)
    swapTrack(this.state.sequence, this.trackId, this.oldTrack)
  }
}

// ============================================================================
// 3. MoveClipCommand — 移动 Clip
// ============================================================================

/**
 * 移动 Clip 到新的 timelineStart。
 *
 * execute: 设置 clip.timelineStart = newStart
 * undo:    恢复原 timelineStart
 */
export class MoveClipCommand extends BaseCommand {
  readonly id = genCommandId('move')
  readonly label = '移动片段'
  private trackId: string
  private clipId: string
  private newStart: Time
  private oldTrack: Track | null = null

  constructor(state: MutableSequenceState, trackId: string, clipId: string, newStart: Time) {
    super(state)
    this.trackId = trackId
    this.clipId = clipId
    this.newStart = newStart < 0n ? 0n : newStart
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`MoveClipCommand: 轨道 ${this.trackId} 不存在`)
    const clip = track.clips.find((c) => c.id === this.clipId)
    if (!clip) throw new Error(`MoveClipCommand: 片段 ${this.clipId} 不存在`)

    this.oldTrack = track

    const newClip = { ...clip, timelineStart: this.newStart }
    const newTrack = replaceClipInTrack(track, this.clipId, newClip)
    swapTrack(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (!this.oldTrack) return
    swapTrack(this.state.sequence, this.trackId, this.oldTrack)
  }
}

// ============================================================================
// 4. TrimClipCommand — 修剪 Clip
// ============================================================================

/**
 * 修剪 Clip 的左/右边界。
 *
 * @param side  'left' 或 'right'
 * @param delta 修剪量(正=缩短,负=延长)
 */
export class TrimClipCommand extends BaseCommand {
  readonly id = genCommandId('trim')
  readonly label = '修剪片段'
  private trackId: string
  private clipId: string
  private side: 'left' | 'right'
  private delta: Time
  private oldTrack: Track | null = null

  constructor(
    state: MutableSequenceState,
    trackId: string,
    clipId: string,
    side: 'left' | 'right',
    delta: Time,
  ) {
    super(state)
    this.trackId = trackId
    this.clipId = clipId
    this.side = side
    this.delta = delta
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`TrimClipCommand: 轨道 ${this.trackId} 不存在`)
    const clip = track.clips.find((c) => c.id === this.clipId)
    if (!clip) throw new Error(`TrimClipCommand: 片段 ${this.clipId} 不存在`)

    this.oldTrack = track

    const newClip = this.side === 'left'
      ? trimClipLeft(clip, this.delta)
      : trimClipRight(clip, this.delta)

    const newTrack = replaceClipInTrack(track, this.clipId, newClip)
    swapTrack(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (!this.oldTrack) return
    swapTrack(this.state.sequence, this.trackId, this.oldTrack)
  }
}

// ============================================================================
// 5. CutClipCommand — 切割 Clip
// ============================================================================

/**
 * 在指定时间点切割 Clip(一分为二)。
 *
 * execute:
 *   原 Clip [start, cutTime) → 缩短右边界
 *   新 Clip [cutTime, end)   → 从 cutTime 开始
 *
 * undo: 恢复原 Clip,移除新 Clip
 */
export class CutClipCommand extends BaseCommand {
  readonly id = genCommandId('cut')
  readonly label = '切割片段'
  private trackId: string
  private clipId: string
  private cutTime: Time
  private oldTrack: Track | null = null

  constructor(state: MutableSequenceState, trackId: string, clipId: string, cutTime: Time) {
    super(state)
    this.trackId = trackId
    this.clipId = clipId
    this.cutTime = cutTime
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`CutClipCommand: 轨道 ${this.trackId} 不存在`)
    const clip = track.clips.find((c) => c.id === this.clipId)
    if (!clip) throw new Error(`CutClipCommand: 片段 ${this.clipId} 不存在`)

    this.oldTrack = track

    // 计算 cut 在 Clip 内的偏移
    const cutOffset = this.cutTime - clip.timelineStart
    if (cutOffset <= 0n || cutOffset >= clip.duration) {
      // 切割点不在 Clip 内部,不操作
      return
    }

    // 原 Clip 缩短右边界
    const leftClip = trimClipRight(clip, clip.duration - cutOffset)

    // 新 Clip 从 cutTime 开始
    const rightClip = createClip({
      assetId: clip.assetId,
      kind: clip.kind,
      timelineStart: this.cutTime,
      sourceStart: clip.sourceStart + cutOffset,
      sourceEnd: clip.sourceEnd,
      transform: { ...clip.transform },
      speed: clip.speed,
      volume: clip.volume,
      enabled: clip.enabled,
      locked: clip.locked,
      label: clip.label,
      effects: [...clip.effects],
    })

    // 替换原 Clip + 添加新 Clip
    let newTrack = replaceClipInTrack(track, this.clipId, leftClip)
    newTrack = addClipToTrack(newTrack, rightClip)
    swapTrack(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (!this.oldTrack) return
    swapTrack(this.state.sequence, this.trackId, this.oldTrack)
  }
}

// ============================================================================
// 6. RippleDeleteCommand — 涟漪删除
// ============================================================================

/**
 * 涟漪删除:删除 Clip,并将同轨道后续 Clip 向左移动填补空隙。
 *
 * execute:
 *   1. 删除指定 Clip
 *   2. 同轨道中 timelineStart >= 被删 Clip 的 end 的所有 Clip 向左移动(被删 Clip 时长)
 *
 * undo: 恢复所有 Clip 原位
 */
export class RippleDeleteCommand extends BaseCommand {
  readonly id = genCommandId('ripple')
  readonly label = '涟漪删除'
  private trackId: string
  private clipId: string
  private oldTrack: Track | null = null

  constructor(state: MutableSequenceState, trackId: string, clipId: string) {
    super(state)
    this.trackId = trackId
    this.clipId = clipId
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`RippleDeleteCommand: 轨道 ${this.trackId} 不存在`)
    const clip = track.clips.find((c) => c.id === this.clipId)
    if (!clip) throw new Error(`RippleDeleteCommand: 片段 ${this.clipId} 不存在`)

    this.oldTrack = track

    const clipEnd = clip.timelineStart + clip.duration
    const shiftAmount = clip.duration

    // 移除被删 Clip
    let newTrack = removeClipFromTrack(track, this.clipId)

    // 后续 Clip 向左移动
    newTrack = {
      ...newTrack,
      clips: newTrack.clips.map((c) => {
        if (c.timelineStart >= clipEnd) {
          return { ...c, timelineStart: c.timelineStart - shiftAmount }
        }
        return c
      }).sort((a, b) => {
        if (a.timelineStart < b.timelineStart) return -1
        if (a.timelineStart > b.timelineStart) return 1
        return 0
      }),
    }

    swapTrack(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (!this.oldTrack) return
    swapTrack(this.state.sequence, this.trackId, this.oldTrack)
  }
}
