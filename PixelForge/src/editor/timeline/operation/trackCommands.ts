/**
 * Track Commands(Step 31.3)— 轨道级操作的 Command 实现。
 *
 * 与 commands.ts 中 Clip 级 Command 的区别:
 * - Clip Command 修改单个 Track 内的 clips 数组
 * - Track Command 修改 Sequence.tracks 数组本身(顺序、属性、增删)
 *
 * 命令列表:
 * - ReorderTrackCommand:    拖拽改变轨道顺序
 * - ResizeTrackCommand:     调整轨道高度
 * - SetTrackColorCommand:   设置轨道颜色
 * - RenameTrackCommand:     重命名轨道
 * - DeleteTrackCommand:     删除整条轨道(含其上所有 Clip)
 * - DuplicateTrackCommand:  复制轨道(深拷贝,生成新 ID)
 */

import type { Track } from '../core/track'
import {
  duplicateTrack as duplicateTrackFn,
  setTrackColor as setTrackColorFn,
  setTrackHeight as setTrackHeightFn,
  setTrackName as setTrackNameFn,
} from '../core/track'
import {
  findTrackById,
  reorderTracks,
  removeTrack,
  insertTrack,
} from '../core/sequence'
import { genClipId } from '../core/clip'
import { BaseCommand, genCommandId, type MutableSequenceState } from './command'

// ============================================================================
// 1. ReorderTrackCommand — 拖拽改变轨道顺序
// ============================================================================

/**
 * 把 fromId 轨道移动到 toId 轨道的位置(插入到 toId 之前)。
 *
 * execute: 在 tracks 数组中把 fromId 移动到 toId 之前
 * undo:    恢复原 tracks 顺序
 */
export class ReorderTrackCommand extends BaseCommand {
  readonly id = genCommandId('reorder-track')
  readonly label = '调整轨道顺序'
  private fromId: string
  private toId: string
  private oldTracks: Track[] | null = null

  constructor(state: MutableSequenceState, fromId: string, toId: string) {
    super(state)
    this.fromId = fromId
    this.toId = toId
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.oldTracks = seq.tracks.map((t) => ({ ...t, clips: [...t.clips] }))
    const newSeq = reorderTracks(seq, this.fromId, this.toId)
    // 直接替换 tracks 引用(reorderTracks 已生成新数组)
    seq.tracks = newSeq.tracks
  }

  protected doUndo(): void {
    if (!this.oldTracks) return
    this.state.sequence.tracks = this.oldTracks
    this.oldTracks = null
  }
}

// ============================================================================
// 2. ResizeTrackCommand — 调整轨道高度
// ============================================================================

/**
 * 调整轨道高度(像素)。
 *
 * execute: 设置 track.height = newHeight(自动 clamp)
 * undo:    恢复原 height
 */
export class ResizeTrackCommand extends BaseCommand {
  readonly id = genCommandId('resize-track')
  readonly label = '调整轨道高度'
  private trackId: string
  private newHeight: number
  private oldHeight: number | null = null

  constructor(state: MutableSequenceState, trackId: string, newHeight: number) {
    super(state)
    this.trackId = trackId
    this.newHeight = newHeight
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`ResizeTrackCommand: 轨道 ${this.trackId} 不存在`)
    this.oldHeight = track.height
    const newTrack = setTrackHeightFn(track, this.newHeight)
    replaceTrackInPlace(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (this.oldHeight === null) return
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) return
    const newTrack = setTrackHeightFn(track, this.oldHeight)
    replaceTrackInPlace(this.state.sequence, this.trackId, newTrack)
    this.oldHeight = null
  }
}

// ============================================================================
// 3. SetTrackColorCommand — 设置轨道颜色
// ============================================================================

export class SetTrackColorCommand extends BaseCommand {
  readonly id = genCommandId('color-track')
  readonly label = '设置轨道颜色'
  private trackId: string
  private newColor: string
  private oldColor: string | null = null

  constructor(state: MutableSequenceState, trackId: string, newColor: string) {
    super(state)
    this.trackId = trackId
    this.newColor = newColor
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`SetTrackColorCommand: 轨道 ${this.trackId} 不存在`)
    this.oldColor = track.color
    const newTrack = setTrackColorFn(track, this.newColor)
    replaceTrackInPlace(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (this.oldColor === null) return
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) return
    const newTrack = setTrackColorFn(track, this.oldColor)
    replaceTrackInPlace(this.state.sequence, this.trackId, newTrack)
    this.oldColor = null
  }
}

// ============================================================================
// 4. RenameTrackCommand — 重命名轨道
// ============================================================================

export class RenameTrackCommand extends BaseCommand {
  readonly id = genCommandId('rename-track')
  readonly label = '重命名轨道'
  private trackId: string
  private newName: string
  private oldName: string | null = null

  constructor(state: MutableSequenceState, trackId: string, newName: string) {
    super(state)
    this.trackId = trackId
    this.newName = newName
  }

  protected doExecute(): void {
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) throw new Error(`RenameTrackCommand: 轨道 ${this.trackId} 不存在`)
    this.oldName = track.name
    const newTrack = setTrackNameFn(track, this.newName)
    replaceTrackInPlace(this.state.sequence, this.trackId, newTrack)
  }

  protected doUndo(): void {
    if (this.oldName === null) return
    const track = findTrackById(this.state.sequence, this.trackId)
    if (!track) return
    const newTrack = setTrackNameFn(track, this.oldName)
    replaceTrackInPlace(this.state.sequence, this.trackId, newTrack)
    this.oldName = null
  }
}

// ============================================================================
// 5. DeleteTrackCommand — 删除整条轨道
// ============================================================================

/**
 * 删除轨道(含其上所有 Clip)。
 *
 * execute: 从 sequence.tracks 中移除该轨道
 * undo:    把轨道插入回原位置
 */
export class DeleteTrackCommand extends BaseCommand {
  readonly id = genCommandId('delete-track')
  readonly label = '删除轨道'
  private trackId: string
  private oldTracks: Track[] | null = null
  private deletedIndex: number = -1

  constructor(state: MutableSequenceState, trackId: string) {
    super(state)
    this.trackId = trackId
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    const idx = seq.tracks.findIndex((t) => t.id === this.trackId)
    if (idx < 0) throw new Error(`DeleteTrackCommand: 轨道 ${this.trackId} 不存在`)
    this.oldTracks = seq.tracks.map((t) => ({ ...t, clips: [...t.clips] }))
    this.deletedIndex = idx
    const newSeq = removeTrack(seq, this.trackId)
    seq.tracks = newSeq.tracks
  }

  protected doUndo(): void {
    if (!this.oldTracks || this.deletedIndex < 0) return
    this.state.sequence.tracks = this.oldTracks
    this.oldTracks = null
    this.deletedIndex = -1
  }
}

// ============================================================================
// 6. DuplicateTrackCommand — 复制轨道
// ============================================================================

/**
 * 复制轨道(深拷贝,生成新 ID),并把新轨道插入到原轨道之后。
 *
 * execute:
 *   1. duplicateTrackFn(原轨道,新 index,genClipId)
 *   2. insertTrack(sequence, 新轨道, 原 index + 1)
 * undo: 移除新轨道
 */
export class DuplicateTrackCommand extends BaseCommand {
  readonly id = genCommandId('dup-track')
  readonly label = '复制轨道'
  private sourceTrackId: string
  private oldTracks: Track[] | null = null

  constructor(state: MutableSequenceState, sourceTrackId: string) {
    super(state)
    this.sourceTrackId = sourceTrackId
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    const sourceIdx = seq.tracks.findIndex((t) => t.id === this.sourceTrackId)
    if (sourceIdx < 0) throw new Error(`DuplicateTrackCommand: 轨道 ${this.sourceTrackId} 不存在`)

    this.oldTracks = seq.tracks.map((t) => ({ ...t, clips: [...t.clips] }))

    const source = seq.tracks[sourceIdx]
    const newTrack = duplicateTrackFn(source, source.index + 1, genClipId)
    const newSeq = insertTrack(seq, newTrack, sourceIdx + 1)
    seq.tracks = newSeq.tracks
  }

  protected doUndo(): void {
    if (!this.oldTracks) return
    this.state.sequence.tracks = this.oldTracks
    this.oldTracks = null
  }
}

// ============================================================================
// 辅助:原地替换 Sequence.tracks 中的 Track
// ============================================================================

function replaceTrackInPlace(sequence: import('../core/sequence').Sequence, trackId: string, newTrack: Track): void {
  const idx = sequence.tracks.findIndex((t) => t.id === trackId)
  if (idx >= 0) {
    sequence.tracks[idx] = newTrack
  }
}
