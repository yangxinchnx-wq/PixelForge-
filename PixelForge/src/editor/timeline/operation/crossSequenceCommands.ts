/**
 * Cross-Sequence Commands(Step 31.7)— 跨 Sequence Clip 移动/复制命令。
 *
 * 与 commands.ts 区别:
 * - commands.ts:操作单个 Sequence 内的 Clip(AddClip / MoveClip / DeleteClip)
 * - 本模块:跨 Sequence 操作(从 Sequence A 移动 Clip 到 Sequence B)
 *
 * 命令列表:
 * - MoveClipCrossSequenceCommand:  移动 Clip 到另一 Sequence(源删除 + 目标添加)
 * - CopyClipCrossSequenceCommand:  复制 Clip 到另一 Sequence(源保留 + 目标添加,新 Clip ID)
 *
 * 用法:
 *   const cmd = new MoveClipCrossSequenceCommand(state, {
 *     sourceSequenceId: 'seq_a',
 *     clipId: 'clip_1',
 *     targetSequenceId: 'seq_b',
 *     targetTrackId: 'track_xy',
 *     newTimelineStart: ZERO,
 *   })
 *   history.execute(cmd)
 */
import type { Time } from '../core/time'
import { ZERO, sub } from '../core/time'
import type { Clip } from '../core/clip'
import { cloneClip, moveClip } from '../core/clip'
import type { Track } from '../core/track'
import { TrackType } from '../core/track'
import { addClipToTrack, removeClipFromTrack } from '../core/track'
import type { Project } from '../core/project'
import type { MutableProjectState } from './command'
import { genCommandId } from './command'
import { ProjectCommand } from './sequenceCommands'

// ============================================================================
// 1. 辅助:在 Project 中查找 Sequence / Track / Clip
// ============================================================================

interface ClipLocation {
  sequenceIndex: number
  trackIndex: number
  clipIndex: number
  clip: Clip
  track: Track
}

/** 在 Project 中按 clipId 查找 Clip 位置(返回所在 Sequence / Track / Clip 索引) */
function locateClip(project: Project, clipId: string): ClipLocation | null {
  for (let si = 0; si < project.sequences.length; si++) {
    const seq = project.sequences[si]
    for (let ti = 0; ti < seq.tracks.length; ti++) {
      const track = seq.tracks[ti]
      for (let ci = 0; ci < track.clips.length; ci++) {
        const clip = track.clips[ci]
        if (clip.id === clipId) {
          return { sequenceIndex: si, trackIndex: ti, clipIndex: ci, clip, track }
        }
      }
    }
  }
  return null
}

/** 在 Project 中按 sequenceId + trackId 查找 Track 索引 */
function locateTrack(
  project: Project,
  sequenceId: string,
  trackId: string,
): { sequenceIndex: number; trackIndex: number; track: Track } | null {
  for (let si = 0; si < project.sequences.length; si++) {
    const seq = project.sequences[si]
    if (seq.id !== sequenceId) continue
    for (let ti = 0; ti < seq.tracks.length; ti++) {
      if (seq.tracks[ti].id === trackId) {
        return { sequenceIndex: si, trackIndex: ti, track: seq.tracks[ti] }
      }
    }
  }
  return null
}

// ============================================================================
// 2. MoveClipCrossSequenceCommand
// ============================================================================

export interface MoveClipCrossSequenceParams {
  /** 源 Sequence ID */
  sourceSequenceId: string
  /** 要移动的 Clip ID */
  clipId: string
  /** 目标 Sequence ID */
  targetSequenceId: string
  /** 目标 Track ID(必须属于 targetSequenceId) */
  targetTrackId: string
  /** 移动后新 timelineStart(可选,默认保留原值) */
  newTimelineStart?: Time
}

/**
 * 把 Clip 从一个 Sequence 的 Track 移动到另一个 Sequence 的 Track。
 *
 * execute: 源 Track 移除 Clip + 目标 Track 添加 Clip(可能更新 timelineStart)
 * undo:    目标 Track 移除 Clip + 源 Track 恢复 Clip(还原原始 timelineStart)
 *
 * 规则:
 * - 若 sourceSequenceId === targetSequenceId 且 sourceTrackId === targetTrackId,
 *   退化为单 Sequence 内的 MoveClipCommand(仍可使用,但建议直接用 MoveClipCommand)
 * - Clip ID 在跨 Sequence 移动后保持不变(便于外部引用追踪)
 * - newTimelineStart < 0 时钳制为 0
 */
export class MoveClipCrossSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('mvCrossSeq')
  readonly label = '跨序列移动片段'

  private params: MoveClipCrossSequenceParams
  /** 备份源 Sequence / 目标 Sequence 的原始状态(用于 undo) */
  private originalSourceSeq: import('../core/sequence').Sequence | null = null
  private originalTargetSeq: import('../core/sequence').Sequence | null = null
  /** 实际源 Track ID(从 Clip 位置反查,不依赖调用方传入) */
  private resolvedSourceTrackId: string | null = null

  constructor(state: MutableProjectState, params: MoveClipCrossSequenceParams) {
    super(state)
    this.params = params
  }

  protected doExecute(): void {
    const project = this.state.project
    const { sourceSequenceId, clipId, targetSequenceId, targetTrackId, newTimelineStart } = this.params

    // 校验:源 == 目标的情况(同 Sequence 内移动)
    if (sourceSequenceId === targetSequenceId) {
      // 同 Sequence 内:仅更新 timelineStart + 可能更换 Track
      // 找到 Clip 当前位置
      const loc = locateClip(project, clipId)
      if (!loc) throw new Error(`MoveClipCrossSequenceCommand: Clip ${clipId} 不存在`)
      const seq = project.sequences[loc.sequenceIndex]
      if (seq.id !== sourceSequenceId) {
        throw new Error(`MoveClipCrossSequenceCommand: Clip ${clipId} 不在 Sequence ${sourceSequenceId} 中`)
      }
      this.originalSourceSeq = seq
      this.resolvedSourceTrackId = loc.track.id

      // 准备新 Clip(更新 timelineStart + 可能更换 Track)
      let newClip: Clip = loc.clip
      if (newTimelineStart !== undefined) {
        newClip = moveClip(newClip, newTimelineStart)
      }

      // 同 Sequence 内更换 Track:从源 Track 移除,加入目标 Track
      const sourceTrack = seq.tracks[loc.trackIndex]
      const targetTrack = seq.tracks.find((t) => t.id === targetTrackId)
      if (!targetTrack) throw new Error(`MoveClipCrossSequenceCommand: 目标 Track ${targetTrackId} 不存在`)

      const isSameTrack = sourceTrack.id === targetTrack.id
      let newTracks: Track[]
      if (isSameTrack) {
        // 同 Track:替换 Clip(moveClip 已生成新 Clip 对象)
        const replacedClips = sourceTrack.clips.map((c) => (c.id === clipId ? newClip : c))
        const newTrack: Track = { ...sourceTrack, clips: replacedClips }
        newTracks = seq.tracks.map((t) => (t.id === sourceTrack.id ? newTrack : t))
      } else {
        // 不同 Track:从源移除 + 加入目标
        const trackWithoutClip = removeClipFromTrack(sourceTrack, clipId)
        const trackWithClip = addClipToTrack(targetTrack, newClip)
        newTracks = seq.tracks.map((t) => {
          if (t.id === sourceTrack.id) return trackWithoutClip
          if (t.id === targetTrack.id) return trackWithClip
          return t
        })
      }
      const newSeq = { ...seq, tracks: newTracks, updatedAt: Date.now() }
      const newSequences = [...project.sequences]
      newSequences[loc.sequenceIndex] = newSeq
      this.state.project = { ...project, sequences: newSequences, updatedAt: Date.now() }
      return
    }

    // 跨 Sequence 移动
    const sourceLoc = locateClip(project, clipId)
    if (!sourceLoc) throw new Error(`MoveClipCrossSequenceCommand: Clip ${clipId} 不存在`)
    const sourceSeq = project.sequences[sourceLoc.sequenceIndex]
    if (sourceSeq.id !== sourceSequenceId) {
      throw new Error(
        `MoveClipCrossSequenceCommand: Clip ${clipId} 不在源 Sequence ${sourceSequenceId} 中`,
      )
    }

    const targetTrackLoc = locateTrack(project, targetSequenceId, targetTrackId)
    if (!targetTrackLoc) {
      throw new Error(
        `MoveClipCrossSequenceCommand: 目标 Track ${targetTrackId} 在 Sequence ${targetSequenceId} 中不存在`,
      )
    }
    const targetSeq = project.sequences[targetTrackLoc.sequenceIndex]

    // 备份(浅拷贝整个 Sequence,undo 时还原)
    this.originalSourceSeq = sourceSeq
    this.originalTargetSeq = targetSeq
    this.resolvedSourceTrackId = sourceLoc.track.id

    // 准备移动后的 Clip
    let movedClip: Clip = sourceLoc.clip
    if (newTimelineStart !== undefined) {
      movedClip = moveClip(movedClip, newTimelineStart)
    }

    // 源 Track 移除 Clip
    const newSourceTrack = removeClipFromTrack(sourceLoc.track, clipId)
    // 目标 Track 添加 Clip
    const newTargetTrack = addClipToTrack(targetTrackLoc.track, movedClip)

    // 构建新 Sequence
    const newSourceSeq: import('../core/sequence').Sequence = {
      ...sourceSeq,
      tracks: sourceSeq.tracks.map((t) => (t.id === sourceLoc.track.id ? newSourceTrack : t)),
      updatedAt: Date.now(),
    }
    const newTargetSeq: import('../core/sequence').Sequence = {
      ...targetSeq,
      tracks: targetSeq.tracks.map((t) => (t.id === targetTrackLoc.track.id ? newTargetTrack : t)),
      updatedAt: Date.now(),
    }

    const newSequences = [...project.sequences]
    newSequences[sourceLoc.sequenceIndex] = newSourceSeq
    newSequences[targetTrackLoc.sequenceIndex] = newTargetSeq

    this.state.project = { ...project, sequences: newSequences, updatedAt: Date.now() }
  }

  protected doUndo(): void {
    if (!this.originalSourceSeq || !this.resolvedSourceTrackId) return
    const project = this.state.project

    // 跨 Sequence:还原源 + 目标 Sequence
    if (this.originalTargetSeq && this.params.sourceSequenceId !== this.params.targetSequenceId) {
      const sourceIdx = project.sequences.findIndex((s) => s.id === this.originalSourceSeq!.id)
      const targetIdx = project.sequences.findIndex((s) => s.id === this.originalTargetSeq!.id)
      if (sourceIdx < 0 || targetIdx < 0) return
      const newSequences = [...project.sequences]
      newSequences[sourceIdx] = this.originalSourceSeq
      newSequences[targetIdx] = this.originalTargetSeq
      this.state.project = { ...project, sequences: newSequences, updatedAt: Date.now() }
      return
    }

    // 同 Sequence 内:还原源 Sequence(包含原始 Track / Clip 位置)
    const sourceIdx = project.sequences.findIndex((s) => s.id === this.originalSourceSeq!.id)
    if (sourceIdx < 0) return
    const newSequences = [...project.sequences]
    newSequences[sourceIdx] = this.originalSourceSeq
    this.state.project = { ...project, sequences: newSequences, updatedAt: Date.now() }
  }
}

// ============================================================================
// 3. CopyClipCrossSequenceCommand
// ============================================================================

export interface CopyClipCrossSequenceParams {
  /** 源 Sequence ID */
  sourceSequenceId: string
  /** 要复制的 Clip ID */
  clipId: string
  /** 目标 Sequence ID */
  targetSequenceId: string
  /** 目标 Track ID */
  targetTrackId: string
  /** 复制后新 Clip 的 timelineStart(可选,默认保留原值) */
  newTimelineStart?: Time
}

/**
 * 把 Clip 从一个 Sequence 复制到另一个 Sequence(深拷贝,新 Clip ID)。
 *
 * execute: 目标 Track 添加 Clip 的克隆(新 ID)
 * undo:    目标 Track 移除新 Clip
 *
 * 规则:
 * - 源 Sequence 不变
 * - 新 Clip 的 ID 通过 cloneClip 重新生成
 * - 同 Sequence 内复制也支持(类似 DuplicateClipCommand,但可指定目标 Track)
 */
export class CopyClipCrossSequenceCommand extends ProjectCommand {
  readonly id = genCommandId('cpCrossSeq')
  readonly label = '跨序列复制片段'

  private params: CopyClipCrossSequenceParams
  private originalTargetSeq: import('../core/sequence').Sequence | null = null
  /** 实际生成的新 Clip ID(用于 undo 移除) */
  private _newClipId: string | null = null

  constructor(state: MutableProjectState, params: CopyClipCrossSequenceParams) {
    super(state)
    this.params = params
  }

  protected doExecute(): void {
    const project = this.state.project
    const { sourceSequenceId, clipId, targetSequenceId, targetTrackId, newTimelineStart } = this.params

    // 查找源 Clip
    const sourceLoc = locateClip(project, clipId)
    if (!sourceLoc) throw new Error(`CopyClipCrossSequenceCommand: Clip ${clipId} 不存在`)
    const sourceSeq = project.sequences[sourceLoc.sequenceIndex]
    if (sourceSeq.id !== sourceSequenceId) {
      throw new Error(
        `CopyClipCrossSequenceCommand: Clip ${clipId} 不在源 Sequence ${sourceSequenceId} 中`,
      )
    }

    // 查找目标 Track
    const targetTrackLoc = locateTrack(project, targetSequenceId, targetTrackId)
    if (!targetTrackLoc) {
      throw new Error(
        `CopyClipCrossSequenceCommand: 目标 Track ${targetTrackId} 在 Sequence ${targetSequenceId} 中不存在`,
      )
    }
    const targetSeq = project.sequences[targetTrackLoc.sequenceIndex]

    // 备份目标 Sequence(源 Sequence 不变,无需备份)
    this.originalTargetSeq = targetSeq

    // 克隆 Clip(新 ID)
    let newClip = cloneClip(sourceLoc.clip)
    this._newClipId = newClip.id
    if (newTimelineStart !== undefined) {
      newClip = moveClip(newClip, newTimelineStart)
    }

    // 目标 Track 添加新 Clip
    const newTargetTrack = addClipToTrack(targetTrackLoc.track, newClip)
    const newTargetSeq: import('../core/sequence').Sequence = {
      ...targetSeq,
      tracks: targetSeq.tracks.map((t) => (t.id === targetTrackLoc.track.id ? newTargetTrack : t)),
      updatedAt: Date.now(),
    }

    const newSequences = [...project.sequences]
    newSequences[targetTrackLoc.sequenceIndex] = newTargetSeq
    this.state.project = { ...project, sequences: newSequences, updatedAt: Date.now() }
  }

  protected doUndo(): void {
    if (!this.originalTargetSeq) return
    const project = this.state.project
    const targetIdx = project.sequences.findIndex((s) => s.id === this.originalTargetSeq!.id)
    if (targetIdx < 0) return
    const newSequences = [...project.sequences]
    newSequences[targetIdx] = this.originalTargetSeq
    this.state.project = { ...project, sequences: newSequences, updatedAt: Date.now() }
  }

  /** 获取新 Clip 的 ID(execute 后可用) */
  get newClipId(): string | null {
    return this._newClipId
  }
}

// ============================================================================
// 4. 时间对齐辅助
// ============================================================================

/**
 * 跨 Sequence 时间映射:把源 Sequence 的时间点映射到目标 Sequence。
 *
 * 由于 Time 是绝对微秒值,不同 fps 的 Sequence 间映射无漂移。
 * 该函数仅提供语义化封装 + 钳制到目标 Sequence 时长。
 *
 * @param sourceTime       源 Sequence 的时间点
 * @param targetDuration   目标 Sequence 的时长(可选,用于钳制)
 * @returns 映射后的时间(钳制到 [0, targetDuration])
 */
export function mapTimeAcrossSequences(
  sourceTime: Time,
  targetDuration?: Time,
): Time {
  let result = sourceTime
  if (result < 0n) result = ZERO
  if (targetDuration !== undefined && result > targetDuration) {
    result = targetDuration
  }
  return result
}

/**
 * 计算跨 Sequence 拖拽时 Clip 的新 timelineStart。
 *
 * 规则:
 * - 默认保留原始 timelineStart(若未提供 newStart)
 * - 若 newStart > 目标 Sequence 时长,钳制到目标时长 - Clip duration(防止超出)
 * - 若 newStart < 0,钳制为 0
 */
export function clampClipStartToSequence(
  newStart: Time,
  clipDuration: Time,
  sequenceDuration: Time,
): Time {
  if (newStart < 0n) return ZERO
  const maxStart = sub(sequenceDuration, clipDuration)
  if (maxStart <= 0n) return ZERO
  if (newStart > maxStart) return maxStart
  return newStart
}

/**
 * 在目标 Sequence 中查找类型匹配的 Track(用于跨 Sequence 拖拽的默认目标)。
 *
 * @param targetSeq    目标 Sequence
 * @param clipKind     Clip 类型
 * @param preferredTrackId 首选 Track ID(若匹配类型,优先返回)
 * @returns 匹配的 Track ID,若无匹配返回 null
 */
export function findCompatibleTrack(
  targetSeq: import('../core/sequence').Sequence,
  clipKind: Clip['kind'],
  preferredTrackId?: string,
): string | null {
  // 嵌套 Sequence Clip 可放到 VIDEO / EFFECT Track
  // video/image/text → VIDEO Track
  // audio → AUDIO Track
  // effect → EFFECT Track
  const compatibleTypes: Record<Clip['kind'], TrackType[]> = {
    video: [TrackType.VIDEO],
    image: [TrackType.VIDEO],
    text: [TrackType.TEXT, TrackType.VIDEO],
    audio: [TrackType.AUDIO],
    effect: [TrackType.EFFECT],
  }
  const wanted = compatibleTypes[clipKind] ?? []

  // 首选 Track 若类型匹配,直接用
  if (preferredTrackId) {
    const preferred = targetSeq.tracks.find((t) => t.id === preferredTrackId)
    if (preferred && wanted.includes(preferred.type)) {
      return preferred.id
    }
  }

  // 找第一个类型匹配的 Track
  const match = targetSeq.tracks.find((t) => wanted.includes(t.type))
  return match?.id ?? null
}
