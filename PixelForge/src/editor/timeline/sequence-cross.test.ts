/**
 * Step 31.7 单元测试 — 跨 Sequence 操作 + 时间对齐。
 *
 * 覆盖:
 * - CSC:  CrossSequenceCommands(Move / Copy + undo)
 * - CSCX: 跨 Sequence 边界情况(同 Sequence 内 / 找不到 / 校验)
 * - ALN:  辅助函数(mapTimeAcrossSequences / clampClipStartToSequence / findCompatibleTrack)
 * - SA:   SequenceAlignment(alignPlayheadOnSwitch / snapToFrameBoundary / alignViewportOnSwitch)
 * - SI:   Store 集成(moveClipToSequence / copyClipToSequence / setPlayheadAlignMode)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createClip, type Clip } from './core/clip'
import { createSequence, addTrack } from './core/sequence'
import type { Sequence } from './core/sequence'
import { TrackType } from './core/track'
import { createProject, addSequence } from './core/project'
import type { Project } from './core/project'
import { seconds, ZERO } from './core/time'
import type { MutableProjectState } from './operation/command'
import { CommandHistory } from './operation/history'
import {
  MoveClipCrossSequenceCommand,
  CopyClipCrossSequenceCommand,
  mapTimeAcrossSequences,
  clampClipStartToSequence,
  findCompatibleTrack,
  type MoveClipCrossSequenceParams,
  type CopyClipCrossSequenceParams,
} from './operation/crossSequenceCommands'
import {
  alignPlayheadOnSwitch,
  snapToFrameBoundary,
  alignViewportOnSwitch,
  computeSharedMajorStep,
  sequencesTimeOverlap,
  getSequenceEffectiveRange,
  offsetInnerTimeToOuter,
  offsetOuterTimeToInner,
} from './resolver/sequenceAlignment'
import { useProTimelineStore } from './store/timelineStore'

// ============================================================================
// 辅助
// ============================================================================

function makeClip(
  startSec: number,
  durSec: number,
  id?: string,
  kind: Clip['kind'] = 'video',
): Clip {
  return createClip({
    assetId: 'test-asset',
    kind,
    timelineStart: seconds(startSec),
    sourceStart: seconds(0),
    sourceEnd: seconds(durSec),
    id,
  })
}

function makeMutableProjectState(project: Project): MutableProjectState & { proj: Project } {
  const state: MutableProjectState & { proj: Project } = {
    proj: project,
    get project(): Project { return this.proj },
    set project(p: Project) { this.proj = p },
    notify: () => { /* no-op for tests */ },
  }
  return state
}

function makeProjectWithTwoSequences(): {
  project: Project
  seqA: Sequence
  seqB: Sequence
  clipA1: Clip
  clipA2: Clip
} {
  const seqA = createSequence({ name: 'A' })
  const seqB = createSequence({ name: 'B' })

  const clipA1 = makeClip(0, 10, 'clip_a1')
  const clipA2 = makeClip(15, 5, 'clip_a2')

  // 把 clipA1 / clipA2 加到 seqA 的第一个 VIDEO 轨道
  const videoTrackA = seqA.tracks.find((t) => t.type === TrackType.VIDEO)!
  videoTrackA.clips.push(clipA1, clipA2)

  let project = createProject('测试项目')
  project = { ...project, sequences: [seqA], activeSequenceId: seqA.id }
  project = addSequence(project, seqB)

  return { project, seqA, seqB, clipA1, clipA2 }
}

// ============================================================================
// CSC: CrossSequenceCommands
// ============================================================================

describe('CSC: CrossSequenceCommands', () => {
  let history: CommandHistory

  beforeEach(() => {
    history = new CommandHistory()
  })

  it('CSC1: MoveClipCrossSequence 跨序列移动 Clip', () => {
    const { project, seqA, seqB, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackB = seqB.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqB.id,
      targetTrackId: targetTrackB.id,
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    history.execute(cmd)

    // seqA 不再有 clipA1
    const seqANew = state.project.sequences.find((s) => s.id === seqA.id)!
    const seqBNew = state.project.sequences.find((s) => s.id === seqB.id)!
    const aHas = seqANew.tracks
      .find((t) => t.type === TrackType.VIDEO)!
      .clips.some((c) => c.id === clipA1.id)
    const bHas = seqBNew.tracks
      .find((t) => t.type === TrackType.VIDEO)!
      .clips.some((c) => c.id === clipA1.id)
    expect(aHas).toBe(false)
    expect(bHas).toBe(true)
  })

  it('CSC2: MoveClipCrossSequence undo 反向', () => {
    const { project, seqA, seqB, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackB = seqB.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqB.id,
      targetTrackId: targetTrackB.id,
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    history.execute(cmd)
    history.undo()

    // seqA 恢复有 clipA1
    const seqANew = state.project.sequences.find((s) => s.id === seqA.id)!
    const seqBNew = state.project.sequences.find((s) => s.id === seqB.id)!
    const aHas = seqANew.tracks
      .find((t) => t.type === TrackType.VIDEO)!
      .clips.some((c) => c.id === clipA1.id)
    const bHas = seqBNew.tracks
      .find((t) => t.type === TrackType.VIDEO)!
      .clips.some((c) => c.id === clipA1.id)
    expect(aHas).toBe(true)
    expect(bHas).toBe(false)
  })

  it('CSC3: MoveClipCrossSequence 同 Sequence 内更换 Track', () => {
    const { project, seqA, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    // 在 seqA 中加一条新 VIDEO 轨道
    const seqAWithNewTrack = addTrack(seqA, TrackType.VIDEO, 'Video 2')
    state.proj = { ...state.project, sequences: state.project.sequences.map((s) => s.id === seqA.id ? seqAWithNewTrack : s) }
    const newTrack = state.proj.sequences.find((s) => s.id === seqA.id)!.tracks.find((t) => t.name === 'Video 2')!

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqA.id,
      targetTrackId: newTrack.id,
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    history.execute(cmd)

    const seqANew = state.project.sequences.find((s) => s.id === seqA.id)!
    const oldTrackClips = seqANew.tracks.find((t) => t.name === 'Video 1')!.clips
    const newTrackClips = seqANew.tracks.find((t) => t.name === 'Video 2')!.clips
    expect(oldTrackClips.some((c) => c.id === clipA1.id)).toBe(false)
    expect(newTrackClips.some((c) => c.id === clipA1.id)).toBe(true)
  })

  it('CSC4: MoveClipCrossSequence 更新 timelineStart', () => {
    const { project, seqA, seqB, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackB = seqB.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqB.id,
      targetTrackId: targetTrackB.id,
      newTimelineStart: seconds(20),
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    history.execute(cmd)

    const seqBNew = state.project.sequences.find((s) => s.id === seqB.id)!
    const movedClip = seqBNew.tracks
      .find((t) => t.type === TrackType.VIDEO)!
      .clips.find((c) => c.id === clipA1.id)!
    expect(movedClip.timelineStart).toBe(seconds(20))
  })

  it('CSC5: CopyClipCrossSequence 复制 Clip(深拷贝,新 ID)', () => {
    const { project, seqA, seqB, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackB = seqB.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: CopyClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqB.id,
      targetTrackId: targetTrackB.id,
    }
    const cmd = new CopyClipCrossSequenceCommand(state, params)
    history.execute(cmd)

    // seqA 仍有 clipA1(复制不删除源)
    const seqANew = state.project.sequences.find((s) => s.id === seqA.id)!
    expect(seqANew.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.some((c) => c.id === clipA1.id)).toBe(true)

    // seqB 有新 Clip(ID 不同)
    const seqBNew = state.project.sequences.find((s) => s.id === seqB.id)!
    const newClips = seqBNew.tracks.find((t) => t.type === TrackType.VIDEO)!.clips
    expect(newClips.length).toBe(1)
    expect(newClips[0].id).not.toBe(clipA1.id)
    expect(newClips[0].assetId).toBe(clipA1.assetId)
    expect(cmd.newClipId).toBe(newClips[0].id)
  })

  it('CSC6: CopyClipCrossSequence undo 移除新 Clip', () => {
    const { project, seqA, seqB, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackB = seqB.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: CopyClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqB.id,
      targetTrackId: targetTrackB.id,
    }
    const cmd = new CopyClipCrossSequenceCommand(state, params)
    history.execute(cmd)
    history.undo()

    const seqBNew = state.project.sequences.find((s) => s.id === seqB.id)!
    expect(seqBNew.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.length).toBe(0)
  })

  it('CSC7: MoveClipCrossSequence 找不到 Clip 抛错', () => {
    const { project, seqA, seqB } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackB = seqB.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: 'nonexistent_clip',
      targetSequenceId: seqB.id,
      targetTrackId: targetTrackB.id,
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    expect(() => history.execute(cmd)).toThrow()
  })

  it('CSC8: MoveClipCrossSequence 找不到目标 Track 抛错', () => {
    const { project, seqA, seqB, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqB.id,
      targetTrackId: 'nonexistent_track',
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    expect(() => history.execute(cmd)).toThrow()
  })

  it('CSC9: CopyClipCrossSequence 同 Sequence 内复制(类似 Duplicate)', () => {
    const { project, seqA, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackA = seqA.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: CopyClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqA.id,
      targetTrackId: targetTrackA.id,
      newTimelineStart: seconds(30),
    }
    const cmd = new CopyClipCrossSequenceCommand(state, params)
    history.execute(cmd)

    const seqANew = state.project.sequences.find((s) => s.id === seqA.id)!
    const clips = seqANew.tracks.find((t) => t.type === TrackType.VIDEO)!.clips
    expect(clips.length).toBe(3) // 原 2 + 新 1
    const newClip = clips.find((c) => c.id === cmd.newClipId)
    expect(newClip).toBeDefined()
    expect(newClip!.timelineStart).toBe(seconds(30))
  })

  it('CSC10: MoveClipCrossSequence 同 Sequence 同 Track 不变更 Clip 内容(仅 timelineStart)', () => {
    const { project, seqA, clipA1 } = makeProjectWithTwoSequences()
    const state = makeMutableProjectState(project)
    const targetTrackA = seqA.tracks.find((t) => t.type === TrackType.VIDEO)!

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId: seqA.id,
      clipId: clipA1.id,
      targetSequenceId: seqA.id,
      targetTrackId: targetTrackA.id,
      newTimelineStart: seconds(50),
    }
    const cmd = new MoveClipCrossSequenceCommand(state, params)
    history.execute(cmd)

    const seqANew = state.project.sequences.find((s) => s.id === seqA.id)!
    const moved = seqANew.tracks.find((t) => t.type === TrackType.VIDEO)!.clips.find((c) => c.id === clipA1.id)!
    expect(moved.timelineStart).toBe(seconds(50))
    expect(moved.duration).toBe(clipA1.duration)
  })
})

// ============================================================================
// ALN: 辅助函数
// ============================================================================

describe('ALN: 跨 Sequence 辅助函数', () => {
  it('ALN1: mapTimeAcrossSequences 保留时间', () => {
    expect(mapTimeAcrossSequences(seconds(5))).toBe(seconds(5))
  })

  it('ALN2: mapTimeAcrossSequences 钳制到目标时长', () => {
    expect(mapTimeAcrossSequences(seconds(15), seconds(10))).toBe(seconds(10))
  })

  it('ALN3: mapTimeAcrossSequences 负值钳制为 0', () => {
    expect(mapTimeAcrossSequences(seconds(-5))).toBe(ZERO)
  })

  it('ALN4: clampClipStartToSequence 正常范围内', () => {
    expect(clampClipStartToSequence(seconds(5), seconds(3), seconds(60))).toBe(seconds(5))
  })

  it('ALN5: clampClipStartToSequence 超出最大 start', () => {
    // maxStart = 60 - 3 = 57
    expect(clampClipStartToSequence(seconds(70), seconds(3), seconds(60))).toBe(seconds(57))
  })

  it('ALN6: clampClipStartToSequence 负值', () => {
    expect(clampClipStartToSequence(seconds(-5), seconds(3), seconds(60))).toBe(ZERO)
  })

  it('ALN7: clampClipStartToSequence 时长超过 Sequence', () => {
    // clipDuration > sequenceDuration → maxStart <= 0 → 返回 0
    expect(clampClipStartToSequence(seconds(5), seconds(70), seconds(60))).toBe(ZERO)
  })

  it('ALN8: findCompatibleTrack video → VIDEO Track', () => {
    const seq = createSequence({ name: 'test' })
    const trackId = findCompatibleTrack(seq, 'video')
    expect(trackId).not.toBeNull()
    const track = seq.tracks.find((t) => t.id === trackId)
    expect(track?.type).toBe(TrackType.VIDEO)
  })

  it('ALN9: findCompatibleTrack audio → AUDIO Track', () => {
    const seq = createSequence({ name: 'test' })
    const trackId = findCompatibleTrack(seq, 'audio')
    expect(trackId).not.toBeNull()
    const track = seq.tracks.find((t) => t.id === trackId)
    expect(track?.type).toBe(TrackType.AUDIO)
  })

  it('ALN10: findCompatibleTrack 首选 Track 类型不匹配 → 退回兼容', () => {
    const seq = createSequence({ name: 'test' })
    const audioTrackId = seq.tracks.find((t) => t.type === TrackType.AUDIO)!.id
    // 给 video clip 但首选 audio track → 应退回 video track
    const trackId = findCompatibleTrack(seq, 'video', audioTrackId)
    expect(trackId).not.toBeNull()
    expect(trackId).not.toBe(audioTrackId)
  })

  it('ALN11: findCompatibleTrack 首选 Track 类型匹配 → 用首选', () => {
    const seq = createSequence({ name: 'test' })
    const videoTrackId = seq.tracks.find((t) => t.type === TrackType.VIDEO)!.id
    const trackId = findCompatibleTrack(seq, 'video', videoTrackId)
    expect(trackId).toBe(videoTrackId)
  })

  it('ALN12: findCompatibleTrack 无匹配返回 null(空 Sequence)', () => {
    const seq = createSequence({ name: 'test' })
    // 移除所有 Track
    const emptySeq: Sequence = { ...seq, tracks: [] }
    const trackId = findCompatibleTrack(emptySeq, 'video')
    expect(trackId).toBeNull()
  })
})

// ============================================================================
// SA: SequenceAlignment
// ============================================================================

describe('SA: SequenceAlignment', () => {
  it('SA1: alignPlayheadOnSwitch preserve 模式(范围内)', () => {
    const seq = createSequence({ name: 'test', duration: seconds(60) })
    const result = alignPlayheadOnSwitch(seconds(30), seq, 'preserve')
    expect(result).toBe(seconds(30))
  })

  it('SA2: alignPlayheadOnSwitch preserve 模式(超出钳制)', () => {
    const seq = createSequence({ name: 'test', duration: seconds(60) })
    const result = alignPlayheadOnSwitch(seconds(70), seq, 'preserve')
    expect(result).toBe(seconds(60))
  })

  it('SA3: alignPlayheadOnSwitch restart 模式', () => {
    const seq = createSequence({ name: 'test', duration: seconds(60) })
    const result = alignPlayheadOnSwitch(seconds(30), seq, 'restart')
    expect(result).toBe(ZERO)
  })

  it('SA4: alignPlayheadOnSwitch snap-to-frame 模式', () => {
    const seq = createSequence({ name: 'test', duration: seconds(60), fps: 30 })
    // 1.5 秒 = 45 帧 → 应 snap 到 45 帧 = 1.5 秒
    const result = alignPlayheadOnSwitch(seconds(1.5), seq, 'snap-to-frame')
    expect(result).toBe(seconds(1.5))
  })

  it('SA5: snapToFrameBoundary floor 方向', () => {
    const seq = createSequence({ name: 'test', fps: 30 })
    // 1.0166... 秒 → floor 到 30 帧(1 秒)
    const result = snapToFrameBoundary(seconds(1.0166), seq, 'floor')
    expect(result).toBe(seconds(1))
  })

  it('SA6: snapToFrameBoundary ceil 方向', () => {
    const seq = createSequence({ name: 'test', fps: 30 })
    // 1.01 秒 → ceil 到 31 帧(≈1.0333 秒)
    const result = snapToFrameBoundary(seconds(1.01), seq, 'ceil')
    const expectedFrames = BigInt(31) * 1_000_000n / BigInt(30)
    expect(result).toBe(expectedFrames)
  })

  it('SA7: alignViewportOnSwitch 视口区间内', () => {
    const seq = createSequence({ name: 'test', duration: seconds(60) })
    const result = alignViewportOnSwitch(seconds(10), seconds(20), 50, seq)
    expect(result.scrollLeft).toBe(500) // 10 秒 * 50 pps
    expect(result.pixelsPerSecond).toBe(50)
  })

  it('SA8: alignViewportOnSwitch 目标 Sequence 过短 → 重置 scrollLeft', () => {
    const seq = createSequence({ name: 'test', duration: seconds(5) })
    // 视口起始 10 秒,目标时长 5 秒 → 视口在目标之外,重置
    const result = alignViewportOnSwitch(seconds(10), seconds(20), 50, seq)
    expect(result.scrollLeft).toBe(0)
    expect(result.pixelsPerSecond).toBe(50)
  })

  it('SA9: computeSharedMajorStep 多 Sequence', () => {
    const seq1 = createSequence({ name: 'a', duration: seconds(60) })
    const seq2 = createSequence({ name: 'b', duration: seconds(120) })
    const result = computeSharedMajorStep([seq1, seq2], 1000)
    expect(result.majorStepSec).toBeGreaterThan(0)
  })

  it('SA10: computeSharedMajorStep 空 Sequence', () => {
    const result = computeSharedMajorStep([], 1000)
    expect(result.majorStepSec).toBe(1)
    expect(result.shared).toBe(false)
  })

  it('SA11: sequencesTimeOverlap 都有时长', () => {
    const a = createSequence({ name: 'a', duration: seconds(10) })
    const b = createSequence({ name: 'b', duration: seconds(20) })
    expect(sequencesTimeOverlap(a, b)).toBe(true)
  })

  it('SA12: sequencesTimeOverlap 一个时长为 0', () => {
    const a = createSequence({ name: 'a', duration: ZERO })
    const b = createSequence({ name: 'b', duration: seconds(20) })
    expect(sequencesTimeOverlap(a, b)).toBe(false)
  })

  it('SA13: getSequenceEffectiveRange', () => {
    const seq = createSequence({ name: 'a', duration: seconds(30) })
    const range = getSequenceEffectiveRange(seq)
    expect(range.start).toBe(ZERO)
    expect(range.end).toBe(seconds(30))
  })

  it('SA14: offsetInnerTimeToOuter', () => {
    const result = offsetInnerTimeToOuter(seconds(5), seconds(10))
    expect(result).toBe(seconds(15))
  })

  it('SA15: offsetOuterTimeToInner 正常', () => {
    const result = offsetOuterTimeToInner(seconds(15), seconds(10))
    expect(result).toBe(seconds(5))
  })

  it('SA16: offsetOuterTimeToInner 钳制到 0', () => {
    const result = offsetOuterTimeToInner(seconds(5), seconds(10))
    expect(result).toBe(ZERO)
  })
})

// ============================================================================
// SI: Store 集成
// ============================================================================

describe('SI: Store 跨 Sequence 集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('SI1: moveClipToSequence 跨序列移动', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    // 添加第二个 Sequence
    const seqBId = store.addSequence()
    // 在当前 Sequence 添加一个 Clip
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    // 移动到 seqB
    const movedId = store.moveClipToSequence(clip.id, seqBId)
    expect(movedId).toBe(clip.id)
    // 切换到 seqB 查看
    store.switchSequence(seqBId)
    // seqB 应该有这个 Clip(在 VIDEO Track)
    const videoTrackB = store.tracks.find((t) => t.type === TrackType.VIDEO)
    expect(videoTrackB).toBeDefined()
    expect(videoTrackB!.clips.some((c) => c.id === clip.id)).toBe(true)
  })

  it('SI2: moveClipToSequence undo 反向', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    store.moveClipToSequence(clip.id, seqBId)
    store.undo() // 撤销移动

    // 当前 Sequence 应恢复 Clip(undo 后 activeId 不变)
    const videoTrackA = store.tracks.find((t) => t.type === TrackType.VIDEO)
    expect(videoTrackA!.clips.some((c) => c.id === clip.id)).toBe(true)
  })

  it('SI3: copyClipToSequence 跨序列复制', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    const newId = store.copyClipToSequence(clip.id, seqBId)
    expect(newId).not.toBeNull()
    expect(newId).not.toBe(clip.id)

    // 切换到 seqB 查看
    store.switchSequence(seqBId)
    const videoTrackB = store.tracks.find((t) => t.type === TrackType.VIDEO)
    expect(videoTrackB!.clips.some((c) => c.id === newId)).toBe(true)
  })

  it('SI4: copyClipToSequence 源保留', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    store.copyClipToSequence(clip.id, seqBId)
    // 当前 Sequence 仍应有 clip
    const videoTrackA = store.tracks.find((t) => t.type === TrackType.VIDEO)
    expect(videoTrackA!.clips.some((c) => c.id === clip.id)).toBe(true)
  })

  it('SI5: moveClipToSequence 自动选择兼容 Track', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5, undefined, 'video')
    store.addClip(trackId, clip)
    // 不指定 targetTrackId,应自动找 VIDEO Track
    const movedId = store.moveClipToSequence(clip.id, seqBId)
    expect(movedId).toBe(clip.id)
  })

  it('SI6: moveClipToSequence 失败返回 null(不存在的 Clip)', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const result = store.moveClipToSequence('nonexistent', seqBId)
    expect(result).toBeNull()
  })

  it('SI7: moveClipToSequence 失败返回 null(不存在的目标 Sequence)', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    const result = store.moveClipToSequence(clip.id, 'nonexistent_seq')
    expect(result).toBeNull()
  })

  it('SI8: setPlayheadAlignMode 设置模式', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    store.setPlayheadAlignMode('restart')
    expect(store.playheadAlignMode).toBe('restart')
    store.setPlayheadAlignMode('preserve')
    expect(store.playheadAlignMode).toBe('preserve')
  })

  it('SI9: alignPlayhead restart 模式', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    store.seek(seconds(10))
    store.alignPlayhead('restart')
    expect(store.currentTime).toBe(ZERO)
  })

  it('SI10: alignPlayhead snap-to-frame 模式', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    // 设置 fps = 30,seek 到 1.0166 秒,snap 后应到 1.0 秒(round)
    store.setSequenceProperties(store.activeSequenceId, { fps: 30 })
    store.seek(seconds(1.0166))
    store.alignPlayhead('snap-to-frame')
    // 应接近 1 秒(可能因 frame 精度略有偏差)
    const t = Number(store.currentTime) / 1_000_000
    expect(Math.abs(t - 1.0)).toBeLessThan(0.05)
  })

  it('SI11: 切换 Sequence 时按 restart 模式重置播放头', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    store.seek(seconds(20))
    store.setPlayheadAlignMode('restart')
    store.switchSequence(seqBId)
    expect(store.currentTime).toBe(ZERO)
  })

  it('SI12: 切换 Sequence 时 preserve 模式保留播放头', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    store.seek(seconds(20))
    store.setPlayheadAlignMode('preserve')
    store.switchSequence(seqBId)
    // 应保留 20 秒(若超出目标时长会钳制,但默认 Sequence 60 秒)
    expect(store.currentTime).toBe(seconds(20))
  })

  it('SI13: 切换 Sequence 时 preserve 模式钳制播放头', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    // 让 seqB 时长较短
    store.switchSequence(seqBId)
    store.setSequenceProperties(seqBId, { duration: seconds(10) })
    // 切回 seqA,seek 到 50 秒,再切到 seqB(应钳制到 10 秒)
    const allSeqs = store.sequences
    const seqA = allSeqs[0]
    store.switchSequence(seqA.id)
    store.seek(seconds(50))
    store.setPlayheadAlignMode('preserve')
    store.switchSequence(seqBId)
    expect(store.currentTime).toBe(seconds(10))
  })

  it('SI14: copyClipToSequence 多次 undo/redo', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    store.copyClipToSequence(clip.id, seqBId)
    store.copyClipToSequence(clip.id, seqBId)
    store.undo() // 撤销第二次复制
    store.undo() // 撤销第一次复制
    // seqB 应无 Clip
    store.switchSequence(seqBId)
    const videoTrackB = store.tracks.find((t) => t.type === TrackType.VIDEO)
    expect(videoTrackB!.clips.length).toBe(0)
  })

  it('SI15: moveClipToSequence 同 Sequence 内更换 Track', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    // 添加第二条 VIDEO 轨道
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    // 添加新 VIDEO Track
    // 注:store 无直接 addTrack 接口,用 executeCommand 包装
    // 这里通过 store 内部 mutableState 直接操作(测试用)
    const seq = store.activeSequence!
    const newSeq = addTrack(seq, TrackType.VIDEO, 'Video 2')
    // 直接通过 project 替换
    const newProject = { ...store.project, sequences: store.project.sequences.map((s) => s.id === seq.id ? newSeq : s) }
    // 用 init 重置(简化)
    store.init(newProject)
    const newTrackId = store.tracks.find((t) => t.name === 'Video 2')!.id
    // 同 Sequence 内移动到新 Track
    const movedId = store.moveClipToSequence(clip.id, store.activeSequenceId, newTrackId)
    expect(movedId).toBe(clip.id)
    // 原 Track 无 Clip
    expect(store.tracks.find((t) => t.id === trackId)!.clips.some((c) => c.id === clip.id)).toBe(false)
    // 新 Track 有 Clip
    expect(store.tracks.find((t) => t.id === newTrackId)!.clips.some((c) => c.id === clip.id)).toBe(true)
  })

  it('SI16: 跨 Sequence 移动后 undo 还原源 Sequence', () => {
    const store = useProTimelineStore()
    if (!store.activeSequence) store.reset()
    const seqBId = store.addSequence()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5)
    store.addClip(trackId, clip)
    store.moveClipToSequence(clip.id, seqBId)
    store.undo() // 撤销移动

    // seqA 应恢复 Clip
    const videoTrackA = store.tracks.find((t) => t.type === TrackType.VIDEO)
    expect(videoTrackA!.clips.some((c) => c.id === clip.id)).toBe(true)
  })
})
