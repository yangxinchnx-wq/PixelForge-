/**
 * Multi-Clip Commands(Step 31.4)— 批量 Clip 操作的 Command 实现。
 *
 * 与 commands.ts 单 Clip Command 区别:
 * - 单 Clip Command 一次操作一个 clip
 * - Multi Command 一次操作多个 clip(多选场景),undo 时整体回滚
 *
 * 命令列表:
 * - MultiDeleteClipCommand: 批量删除(含 ripple 选项)
 * - MultiMoveClipCommand:   批量平移(多选拖拽,保持相对时间偏移)
 * - PasteClipCommand:       粘贴(从剪贴板生成新 clip + 添加到 track)
 * - DuplicateClipCommand:   原位复制(生成新 ID,粘贴到原 clip 之后)
 * - GroupClipsCommand:      设置相同 groupId(群组化)
 * - UngroupClipsCommand:    清除 groupId(解组)
 * - UpdateClipPropertyCommand: 修改单个 clip 属性(label/speed/volume/transform 等)
 */

import type { Clip, ClipTransform } from '../core/clip'
import {
  cloneClip,
  setClipGroupId,
  genGroupId,
} from '../core/clip'
import type { Track } from '../core/track'
import { findTrackById } from '../core/sequence'
import { BaseCommand, genCommandId, type MutableSequenceState } from './command'
import {
  type ClipboardEntry,
} from './clipboard'
export type { ClipboardEntry }
import { ZERO } from '../core/time'

// ============================================================================
// 1. MultiDeleteClipCommand — 批量删除
// ============================================================================

/**
 * 批量删除多个 Clip。
 *
 * execute: 记录每个 clip 的 (trackId, oldTrackSnapshot),然后从对应 track 移除
 * undo:    恢复每个 track 的快照
 */
export class MultiDeleteClipCommand extends BaseCommand {
  readonly id = genCommandId('multi-del')
  readonly label = '批量删除片段'
  private clipIds: string[]
  private oldTracks: Map<string, Track> = new Map()

  constructor(state: MutableSequenceState, clipIds: string[]) {
    super(state)
    this.clipIds = [...clipIds]
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.oldTracks.clear()
    // 记录受影响 track 的快照
    const affectedTrackIds = new Set<string>()
    for (const track of seq.tracks) {
      for (const clipId of this.clipIds) {
        if (track.clips.some((c) => c.id === clipId)) {
          affectedTrackIds.add(track.id)
          break
        }
      }
    }
    for (const tid of affectedTrackIds) {
      const t = findTrackById(seq, tid)
      if (t) this.oldTracks.set(tid, { ...t, clips: [...t.clips] })
    }

    // 执行删除
    for (const track of seq.tracks) {
      if (!affectedTrackIds.has(track.id)) continue
      track.clips = track.clips.filter((c) => !this.clipIds.includes(c.id))
    }
  }

  protected doUndo(): void {
    const seq = this.state.sequence
    for (const [tid, oldTrack] of this.oldTracks) {
      const t = findTrackById(seq, tid)
      if (t) {
        t.clips = oldTrack.clips
      }
    }
    this.oldTracks.clear()
  }
}

// ============================================================================
// 2. MultiMoveClipCommand — 批量平移
// ============================================================================

/**
 * 批量平移多个 Clip(多选拖拽)。
 *
 * execute: 给每个 clip 的 timelineStart 加 delta(若 < 0 则 clamp 到 0)
 * undo:    恢复每个 clip 的原 timelineStart
 *
 * 注:delta 来自拖拽过程中"主选中 clip"的位移,
 *     其余 clip 跟随相同 delta,保持相对偏移。
 */
export class MultiMoveClipCommand extends BaseCommand {
  readonly id = genCommandId('multi-move')
  readonly label = '批量移动片段'
  private clipIds: string[]
  private deltaUs: bigint
  private oldStarts: Map<string, bigint> = new Map()

  constructor(state: MutableSequenceState, clipIds: string[], deltaUs: bigint) {
    super(state)
    this.clipIds = [...clipIds]
    this.deltaUs = deltaUs
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.oldStarts.clear()
    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        if (this.clipIds.includes(clip.id)) {
          this.oldStarts.set(clip.id, clip.timelineStart)
          let newStart = clip.timelineStart + this.deltaUs
          if (newStart < 0n) newStart = 0n
          clip.timelineStart = newStart
        }
      }
    }
    // 重新排序受影响 track
    for (const track of seq.tracks) {
      if (track.clips.some((c) => this.clipIds.includes(c.id))) {
        track.clips.sort((a, b) => {
          if (a.timelineStart < b.timelineStart) return -1
          if (a.timelineStart > b.timelineStart) return 1
          return 0
        })
      }
    }
  }

  protected doUndo(): void {
    const seq = this.state.sequence
    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        const oldStart = this.oldStarts.get(clip.id)
        if (oldStart !== undefined) {
          clip.timelineStart = oldStart
        }
      }
      // 重新排序
      if (track.clips.some((c) => this.oldStarts.has(c.id))) {
        track.clips.sort((a, b) => {
          if (a.timelineStart < b.timelineStart) return -1
          if (a.timelineStart > b.timelineStart) return 1
          return 0
        })
      }
    }
    this.oldStarts.clear()
  }
}

// ============================================================================
// 3. PasteClipCommand — 粘贴(从剪贴板生成新 clip + 添加到 track)
// ============================================================================

/**
 * 粘贴剪贴板内容。
 *
 * execute:
 *   1. 调用 pasteFromClipboard(pasteAt) 生成新 clip 数组
 *   2. 把每个新 clip 添加到对应 trackId(若 track 不存在则跳过)
 *   3. 记录新增的 (clipId, trackId),用于 undo
 * undo: 移除新增的 clip
 */
export class PasteClipCommand extends BaseCommand {
  readonly id = genCommandId('paste')
  readonly label = '粘贴片段'
  private pasteAt: bigint
  /** 已复制到剪贴板的快照(粘贴时使用) */
  private clipboardSnapshot: ClipboardEntry[]
  /** 新创建的 clip 记录(用于 undo + UI 高亮) */
  createdClips: { clipId: string; trackId: string }[] = []

  constructor(state: MutableSequenceState, pasteAt: bigint, clipboardSnapshot: ClipboardEntry[]) {
    super(state)
    this.pasteAt = pasteAt
    this.clipboardSnapshot = clipboardSnapshot
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.createdClips = []

    if (this.clipboardSnapshot.length === 0) return

    // 找最早偏移
    let firstOffset = ZERO
    for (const e of this.clipboardSnapshot) {
      if (e.timelineOffsetFromFirst < firstOffset) firstOffset = e.timelineOffsetFromFirst
    }

    for (const entry of this.clipboardSnapshot) {
      const newClip = cloneClip(entry.clipSnapshot) // 新 ID
      newClip.timelineStart = this.pasteAt + entry.timelineOffsetFromFirst - firstOffset
      if (newClip.timelineStart < 0n) newClip.timelineStart = 0n

      const track = findTrackById(seq, entry.sourceTrackId)
      if (!track) continue // track 不存在则跳过

      track.clips.push(newClip)
      track.clips.sort((a, b) => {
        if (a.timelineStart < b.timelineStart) return -1
        if (a.timelineStart > b.timelineStart) return 1
        return 0
      })
      this.createdClips.push({ clipId: newClip.id, trackId: track.id })
    }
  }

  protected doUndo(): void {
    const seq = this.state.sequence
    const createdIds = new Set(this.createdClips.map((c) => c.clipId))
    for (const track of seq.tracks) {
      track.clips = track.clips.filter((c) => !createdIds.has(c.id))
    }
    this.createdClips = []
  }
}

// ============================================================================
// 4. DuplicateClipCommand — 原位复制(粘贴到原 clip 之后)
// ============================================================================

/**
 * 原位复制多个 Clip。
 *
 * execute:
 *   1. 对每个 clip 生成新 clip(新 ID),timelineStart = 原 clip 结束位置
 *   2. 添加到同一 track
 * undo: 移除新增 clip
 */
export class DuplicateClipCommand extends BaseCommand {
  readonly id = genCommandId('dup-clip')
  readonly label = '复制片段'
  private clipIds: string[]
  private createdClips: { clipId: string; trackId: string }[] = []

  constructor(state: MutableSequenceState, clipIds: string[]) {
    super(state)
    this.clipIds = [...clipIds]
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.createdClips = []

    for (const track of seq.tracks) {
      const toDup = track.clips.filter((c) => this.clipIds.includes(c.id))
      for (const orig of toDup) {
        const newClip = cloneClip(orig) // 新 ID
        newClip.timelineStart = orig.timelineStart + orig.duration
        track.clips.push(newClip)
        this.createdClips.push({ clipId: newClip.id, trackId: track.id })
      }
    }

    // 排序受影响 track
    for (const track of seq.tracks) {
      if (track.clips.some((c) => this.clipIds.includes(c.id)) ||
          this.createdClips.some((cc) => cc.trackId === track.id)) {
        track.clips.sort((a, b) => {
          if (a.timelineStart < b.timelineStart) return -1
          if (a.timelineStart > b.timelineStart) return 1
          return 0
        })
      }
    }
  }

  protected doUndo(): void {
    const seq = this.state.sequence
    const createdIds = new Set(this.createdClips.map((c) => c.clipId))
    for (const track of seq.tracks) {
      track.clips = track.clips.filter((c) => !createdIds.has(c.id))
    }
    this.createdClips = []
  }
}

// ============================================================================
// 5. GroupClipsCommand — 群组化
// ============================================================================

/**
 * 把多个 Clip 设为同一 groupId(创建新群组)。
 *
 * execute: 生成新 groupId,设置到所有目标 clip
 * undo:    恢复每个 clip 的原 groupId(可能是 undefined)
 */
export class GroupClipsCommand extends BaseCommand {
  readonly id = genCommandId('group')
  readonly label = '群组化片段'
  private clipIds: string[]
  private newGroupId: string
  private oldGroupIds: Map<string, string | undefined> = new Map()

  constructor(state: MutableSequenceState, clipIds: string[]) {
    super(state)
    this.clipIds = [...clipIds]
    this.newGroupId = genGroupId()
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.oldGroupIds.clear()
    for (const track of seq.tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i]
        if (this.clipIds.includes(clip.id)) {
          this.oldGroupIds.set(clip.id, clip.groupId)
          track.clips[i] = setClipGroupId(clip, this.newGroupId)
        }
      }
    }
  }

  protected doUndo(): void {
    const seq = this.state.sequence
    for (const track of seq.tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i]
        if (this.oldGroupIds.has(clip.id)) {
          track.clips[i] = setClipGroupId(clip, this.oldGroupIds.get(clip.id))
        }
      }
    }
    this.oldGroupIds.clear()
  }

  /** 获取新群组 ID(用于 UI 提示) */
  getGroupId(): string {
    return this.newGroupId
  }
}

// ============================================================================
// 6. UngroupClipsCommand — 解组
// ============================================================================

/**
 * 解除群组:把指定 groupId 的所有 clip 的 groupId 设为 undefined。
 *
 * execute: 清除所有匹配 groupId 的 clip.groupId
 * undo:    恢复原 groupId
 */
export class UngroupClipsCommand extends BaseCommand {
  readonly id = genCommandId('ungroup')
  readonly label = '解除群组'
  private groupId: string
  private oldClips: Map<string, string> = new Map() // clipId → 原 groupId

  constructor(state: MutableSequenceState, groupId: string) {
    super(state)
    this.groupId = groupId
  }

  protected doExecute(): void {
    const seq = this.state.sequence
    this.oldClips.clear()
    for (const track of seq.tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i]
        if (clip.groupId === this.groupId) {
          this.oldClips.set(clip.id, clip.groupId)
          track.clips[i] = setClipGroupId(clip, undefined)
        }
      }
    }
  }

  protected doUndo(): void {
    const seq = this.state.sequence
    for (const track of seq.tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i]
        if (this.oldClips.has(clip.id)) {
          track.clips[i] = setClipGroupId(clip, this.groupId)
        }
      }
    }
    this.oldClips.clear()
  }
}

// ============================================================================
// 7. UpdateClipPropertyCommand — 修改单个 clip 属性
// ============================================================================

/**
 * 修改单个 Clip 的属性(用于 Inspector 面板编辑)。
 *
 * 支持属性:
 * - label:    string
 * - speed:    number
 * - volume:   number
 * - enabled:  boolean
 * - locked:   boolean
 * - transform: Partial<ClipTransform>
 *
 * execute: 应用新值
 * undo:    恢复旧值
 */
export class UpdateClipPropertyCommand extends BaseCommand {
  readonly id = genCommandId('update-clip')
  readonly label = '修改片段属性'
  private clipId: string
  private propertyName: 'label' | 'speed' | 'volume' | 'enabled' | 'locked' | 'transform'
  private newValue: string | number | boolean | Partial<ClipTransform>
  private oldValue: string | number | boolean | Partial<ClipTransform> | undefined

  constructor(
    state: MutableSequenceState,
    clipId: string,
    propertyName: 'label' | 'speed' | 'volume' | 'enabled' | 'locked' | 'transform',
    newValue: string | number | boolean | Partial<ClipTransform>,
  ) {
    super(state)
    this.clipId = clipId
    this.propertyName = propertyName
    this.newValue = newValue
  }

  private findClip(): { clip: Clip; track: Track; index: number } | null {
    const seq = this.state.sequence
    for (const track of seq.tracks) {
      const index = track.clips.findIndex((c) => c.id === this.clipId)
      if (index >= 0) {
        return { clip: track.clips[index], track, index }
      }
    }
    return null
  }

  protected doExecute(): void {
    const found = this.findClip()
    if (!found) throw new Error(`UpdateClipPropertyCommand: clip ${this.clipId} 不存在`)
    const { clip, track, index } = found

    // 记录旧值
    if (this.propertyName === 'transform') {
      this.oldValue = { ...clip.transform }
    } else {
      this.oldValue = clip[this.propertyName] as string | number | boolean
    }

    // 应用新值
    let newClip: Clip
    if (this.propertyName === 'transform') {
      newClip = { ...clip, transform: { ...clip.transform, ...(this.newValue as Partial<ClipTransform>) } }
    } else {
      newClip = { ...clip, [this.propertyName]: this.newValue } as Clip
    }
    track.clips[index] = newClip
  }

  protected doUndo(): void {
    const found = this.findClip()
    if (!found) return
    const { clip, track, index } = found

    let newClip: Clip
    if (this.propertyName === 'transform') {
      newClip = { ...clip, transform: { ...(this.oldValue as ClipTransform) } }
    } else {
      newClip = { ...clip, [this.propertyName]: this.oldValue } as Clip
    }
    track.clips[index] = newClip
    this.oldValue = undefined
  }
}
