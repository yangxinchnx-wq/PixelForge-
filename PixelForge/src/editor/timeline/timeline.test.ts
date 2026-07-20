/**
 * Timeline Core(Step 31.1)单元测试。
 *
 * 覆盖:
 * - T:  time(SECOND/seconds/millis/frames/toSeconds/toMillis/timeToFrame/运算/格式化)
 * - R:  range(fromStartDuration/contains/overlaps/intersection/union/shift)
 * - C:  clip(createClip/getTimelineRange/isClipActiveAt/mapToSource/moveClip/trimClip)
 * - TR: track(createTrack/addClip/removeClip/replaceClip/findClipAt/getTrackDuration)
 * - S:  sequence(createSequence/addTrack/replaceTrack/findClipById/getActualDuration)
 * - P:  project(createProject/addAsset/addSequence/getActiveSequence)
 * - I:  timelineIndex(buildIndex/queryPoint/queryRange)
 * - RES: resolver(resolveTimeline/resolveTrack/CachedTimelineResolver)
 * - FQ: frameResolver(buildRenderQueue/buildAudioQueue)
 * - CMD: commands(Add/Delete/Move/Trim/Cut/RippleDelete + undo)
 * - H:  history(execute/undo/redo/clear/limit/listeners)
 * - SNAP: snap(collectSnapTargets/findSnap/snapClipPosition)
 * - STORE: useProTimelineStore(init/addClip/undo/redo/play/seek/resolve)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// —— time ——
import {
  SECOND, MILLI, ZERO, seconds, millis, frames,
  toSeconds, toMillis, timeToFrame,
  add, sub, mul, div, min, max, clamp,
  formatTime, formatTimecode,
} from './core/time'

// —— range ——
import {
  fromStartDuration, fromStartEnd, duration as rangeDuration,
  isEmpty, contains, containsInclusive, overlaps, intersection, union,
  shift, compareByStart,
} from './core/range'

// —— clip ——
import {
  createClip, getTimelineRange, getClipEnd, isClipActiveAt,
  mapToSource, cloneClip, moveClip, trimClipLeft, trimClipRight,
  compareClipByStart, getClipDuration,
} from './core/clip'

// —— track ——
import {
  TrackType, createTrack,
  addClipToTrack, removeClipFromTrack, replaceClipInTrack,
  findClipAt, findClipsInRange, getTrackDuration, isTrackEmpty,
} from './core/track'

// —— sequence ——
import {
  createSequence, addTrack, removeTrack, replaceTrack,
  findTrackById, getTracksByType, getActualDuration, findClipById, getTotalClipCount,
} from './core/sequence'
import type { Sequence } from './core/sequence'

// —— project ——
import {
  createProject, addAsset, findAsset, addSequence, getActiveSequence,
  setActiveSequence,
} from './core/project'

// —— timelineIndex ——
import {
  buildIndex, buildSequenceIndex, queryPoint, queryRange, indexSize,
} from './core/timelineIndex'

// —— resolver ——
import {
  CachedTimelineResolver, resolveTimeline, resolveTrack,
} from './resolver/timelineResolver'

// —— frameResolver ——
import {
  buildRenderQueue, buildAudioQueue,
} from './resolver/frameResolver'

// —— command + history ——
import type { MutableSequenceState } from './operation/command'
import { CommandHistory, DEFAULT_HISTORY_LIMIT } from './operation/history'
import {
  AddClipCommand, DeleteClipCommand, MoveClipCommand,
  TrimClipCommand, CutClipCommand, RippleDeleteCommand,
} from './operation/commands'

// —— snap ——
import {
  collectSnapTargets, findSnap, snapClipPosition,
} from './operation/snap'

// —— store ——
import { useProTimelineStore } from './store/timelineStore'

// ============================================================================
// 辅助
// ============================================================================

/** 创建测试用 Clip(简写) */
function makeClip(
  startSec: number,
  durSec: number,
  sourceStartSec: number = startSec,
  id?: string,
) {
  return createClip({
    assetId: 'test-asset',
    kind: 'video',
    timelineStart: seconds(startSec),
    sourceStart: seconds(sourceStartSec),
    sourceEnd: seconds(sourceStartSec + durSec),
    id,
  })
}

/** 创建测试用 MutableSequenceState */
function makeMutableState(seq = createSequence()): MutableSequenceState & { seq: Sequence } {
  const state: MutableSequenceState & { seq: Sequence } = {
    seq,
    get sequence() { return this.seq },
    set sequence(v) { this.seq = v },
    notify: () => { /* no-op for tests */ },
  }
  return state
}

// ============================================================================
// T: time
// ============================================================================

describe('T: Time 时间系统', () => {
  it('T1: SECOND / MILLI / ZERO 常量', () => {
    expect(SECOND).toBe(1_000_000n)
    expect(MILLI).toBe(1_000n)
    expect(ZERO).toBe(0n)
  })

  it('T2: seconds() 构造', () => {
    expect(seconds(0)).toBe(0n)
    expect(seconds(1)).toBe(1_000_000n)
    expect(seconds(5)).toBe(5_000_000n)
    expect(seconds(3.5)).toBe(3_500_000n)
    expect(seconds(0.033)).toBe(33_000n)
  })

  it('T3: millis() 构造', () => {
    expect(millis(0)).toBe(0n)
    expect(millis(1000)).toBe(1_000_000n)
    expect(millis(500)).toBe(500_000n)
  })

  it('T4: frames() 精确无漂移', () => {
    expect(frames(0, 30)).toBe(0n)
    expect(frames(30, 30)).toBe(1_000_000n)
    expect(frames(60, 30)).toBe(2_000_000n)
    expect(frames(1, 30)).toBe(33_333n)
  })

  it('T5: frames() 不同 fps', () => {
    expect(frames(24, 24)).toBe(1_000_000n)
    expect(frames(60, 60)).toBe(1_000_000n)
    expect(frames(1, 60)).toBe(16_666n)
  })

  it('T6: frames() 错误参数', () => {
    expect(() => frames(1, 0)).toThrow()
    expect(() => frames(-1, 30)).toThrow()
  })

  it('T7: toSeconds / toMillis', () => {
    expect(toSeconds(1_000_000n)).toBe(1)
    expect(toSeconds(500_000n)).toBe(0.5)
    expect(toMillis(1_000_000n)).toBe(1000)
    expect(toMillis(500_000n)).toBe(500)
  })

  it('T8: timeToFrame 四舍五入', () => {
    expect(timeToFrame(1_000_000n, 30)).toBe(30)
    expect(timeToFrame(500_000n, 30)).toBe(15)
    expect(timeToFrame(0n, 30)).toBe(0)
    expect(timeToFrame(2_000_000n, 30)).toBe(60)
  })

  it('T9: timeToFrame 四舍五入边界', () => {
    // 33_333n 对应 0.99999 帧 → 四舍五入为 1
    expect(timeToFrame(33_333n, 30)).toBe(1)
    // 16_666n 对应 0.49998 帧 → 四舍五入为 0
    expect(timeToFrame(16_666n, 30)).toBe(0)
  })

  it('T10: add / sub / mul / div', () => {
    expect(add(1_000_000n, 500_000n)).toBe(1_500_000n)
    expect(sub(1_000_000n, 500_000n)).toBe(500_000n)
    expect(sub(500_000n, 1_000_000n)).toBe(0n) // 钳制到 0
    expect(mul(1_000_000n, 2)).toBe(2_000_000n)
    expect(div(1_000_000n, 4)).toBe(250_000n)
  })

  it('T11: min / max / clamp', () => {
    expect(min(1n, 2n)).toBe(1n)
    expect(max(1n, 2n)).toBe(2n)
    expect(clamp(5n, 0n, 10n)).toBe(5n)
    expect(clamp(-1n, 0n, 10n)).toBe(0n)
    expect(clamp(15n, 0n, 10n)).toBe(10n)
  })

  it('T12: formatTime', () => {
    expect(formatTime(0n)).toBe('00:00:00.000')
    expect(formatTime(1_000_000n)).toBe('00:00:01.000')
    expect(formatTime(3_661_500_000n)).toBe('01:01:01.500')
  })

  it('T13: formatTimecode', () => {
    expect(formatTimecode(0n, 30)).toBe('00:00:00:00')
    expect(formatTimecode(1_000_000n, 30)).toBe('00:00:01:00')
    expect(formatTimecode(frames(31, 30), 30)).toBe('00:00:01:01')
  })
})

// ============================================================================
// R: range
// ============================================================================

describe('R: Range 时间区间', () => {
  it('R1: fromStartDuration', () => {
    const r = fromStartDuration(1_000_000n, 2_000_000n)
    expect(r.start).toBe(1_000_000n)
    expect(r.end).toBe(3_000_000n)
  })

  it('R2: fromStartEnd 自动排序', () => {
    const r = fromStartEnd(3_000_000n, 1_000_000n)
    expect(r.start).toBe(1_000_000n)
    expect(r.end).toBe(3_000_000n)
  })

  it('R3: duration / isEmpty', () => {
    expect(rangeDuration(fromStartDuration(0n, 5_000_000n))).toBe(5_000_000n)
    expect(isEmpty(fromStartDuration(0n, 0n))).toBe(true)
    expect(isEmpty(fromStartDuration(0n, 1n))).toBe(false)
  })

  it('R4: contains 半开区间', () => {
    const r = fromStartDuration(1_000_000n, 3_000_000n)
    expect(contains(r, 1_000_000n)).toBe(true)  // start 包含
    expect(contains(r, 3_999_999n)).toBe(true)  // end 之前
    expect(contains(r, 4_000_000n)).toBe(false) // end 不包含
    expect(contains(r, 0n)).toBe(false)
  })

  it('R5: containsInclusive 闭区间', () => {
    const r = fromStartDuration(1_000_000n, 3_000_000n)
    expect(containsInclusive(r, 4_000_000n)).toBe(true) // end 包含
  })

  it('R6: overlaps', () => {
    const a = fromStartDuration(1_000_000n, 3_000_000n) // [1, 4)
    const b = fromStartDuration(2_000_000n, 3_000_000n) // [2, 5)
    const c = fromStartDuration(5_000_000n, 2_000_000n) // [5, 7)
    expect(overlaps(a, b)).toBe(true)
    expect(overlaps(a, c)).toBe(false)
  })

  it('R7: intersection', () => {
    const a = fromStartDuration(1_000_000n, 3_000_000n) // [1, 4)
    const b = fromStartDuration(2_000_000n, 3_000_000n) // [2, 5)
    const inter = intersection(a, b)
    expect(inter.start).toBe(2_000_000n)
    expect(inter.end).toBe(4_000_000n)
  })

  it('R8: union', () => {
    const a = fromStartDuration(1_000_000n, 3_000_000n)
    const b = fromStartDuration(5_000_000n, 2_000_000n)
    const u = union(a, b)
    expect(u.start).toBe(1_000_000n)
    expect(u.end).toBe(7_000_000n)
  })

  it('R9: shift 正向', () => {
    const r = fromStartDuration(1_000_000n, 2_000_000n)
    const s = shift(r, 1_000_000n)
    expect(s.start).toBe(2_000_000n)
    expect(s.end).toBe(4_000_000n)
  })

  it('R10: shift 负向(钳制到 0)', () => {
    const r = fromStartDuration(1_000_000n, 2_000_000n)
    const s = shift(r, -500_000n)
    expect(s.start).toBe(500_000n)
    expect(s.end).toBe(2_500_000n)

    const s2 = shift(r, -2_000_000n)
    expect(s2.start).toBe(0n)
  })

  it('R11: compareByStart', () => {
    const a = fromStartDuration(1_000_000n, 1n)
    const b = fromStartDuration(2_000_000n, 1n)
    expect(compareByStart(a, b)).toBe(-1)
    expect(compareByStart(b, a)).toBe(1)
    expect(compareByStart(a, a)).toBe(0)
  })
})

// ============================================================================
// C: clip
// ============================================================================

describe('C: Clip 片段模型', () => {
  it('C1: createClip 基本', () => {
    const clip = makeClip(0, 10, 30)
    expect(clip.assetId).toBe('test-asset')
    expect(clip.kind).toBe('video')
    expect(clip.timelineStart).toBe(0n)
    expect(clip.duration).toBe(10_000_000n)
    expect(clip.sourceStart).toBe(30_000_000n)
    expect(clip.sourceEnd).toBe(40_000_000n)
  })

  it('C2: createClip sourceEnd <= sourceStart 抛错', () => {
    expect(() => createClip({
      assetId: 'a', kind: 'video',
      timelineStart: 0n, sourceStart: 10_000_000n, sourceEnd: 10_000_000n,
    })).toThrow()
  })

  it('C3: createClip 默认值', () => {
    const clip = makeClip(0, 5)
    expect(clip.speed).toBe(1)
    expect(clip.volume).toBe(1)
    expect(clip.enabled).toBe(true)
    expect(clip.locked).toBe(false)
    expect(clip.effects).toEqual([])
    expect(clip.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 })
  })

  it('C4: getTimelineRange / getClipEnd', () => {
    const clip = makeClip(5, 10)
    const range = getTimelineRange(clip)
    expect(range.start).toBe(5_000_000n)
    expect(range.end).toBe(15_000_000n)
    expect(getClipEnd(clip)).toBe(15_000_000n)
  })

  it('C5: isClipActiveAt 半开区间', () => {
    const clip = makeClip(5, 10)
    expect(isClipActiveAt(clip, 5_000_000n)).toBe(true)
    expect(isClipActiveAt(clip, 14_999_999n)).toBe(true)
    expect(isClipActiveAt(clip, 15_000_000n)).toBe(false)
    expect(isClipActiveAt(clip, 4_999_999n)).toBe(false)
  })

  it('C6: mapToSource 正常映射', () => {
    const clip = makeClip(0, 10, 30) // timeline [0, 10), source [30, 40)
    expect(mapToSource(clip, 0n)).toBe(30_000_000n)
    expect(mapToSource(clip, 5_000_000n)).toBe(35_000_000n)
    expect(mapToSource(clip, 10_000_000n)).toBe(40_000_000n) // 闭区间端点
  })

  it('C7: mapToSource 超范围返回 null', () => {
    const clip = makeClip(0, 10, 30)
    expect(mapToSource(clip, -1n)).toBe(null)
    expect(mapToSource(clip, 10_000_001n)).toBe(null)
  })

  it('C8: mapToSource 速度倍率', () => {
    const clip = createClip({
      assetId: 'a', kind: 'video', speed: 2,
      timelineStart: 0n, sourceStart: 0n, sourceEnd: 20_000_000n,
    })
    // 2x speed: timeline 5s → source 10s
    expect(mapToSource(clip, 5_000_000n)).toBe(10_000_000n)
  })

  it('C9: cloneClip 新 ID', () => {
    const clip = makeClip(0, 5, 0, 'original')
    const cloned = cloneClip(clip)
    expect(cloned.id).not.toBe('original')
    expect(cloned.timelineStart).toBe(0n)
    expect(cloned.transform).toEqual(clip.transform)
  })

  it('C10: moveClip', () => {
    const clip = makeClip(0, 5)
    const moved = moveClip(clip, 10_000_000n)
    expect(moved.timelineStart).toBe(10_000_000n)
    expect(moved.duration).toBe(5_000_000n)
  })

  it('C11: moveClip 负值钳制到 0', () => {
    const clip = makeClip(5, 5)
    const moved = moveClip(clip, -1_000_000n)
    expect(moved.timelineStart).toBe(0n)
  })

  it('C12: trimClipLeft 缩短', () => {
    const clip = makeClip(0, 10, 0)
    const trimmed = trimClipLeft(clip, 2_000_000n)
    expect(trimmed.timelineStart).toBe(2_000_000n)
    expect(trimmed.sourceStart).toBe(2_000_000n)
    expect(trimmed.duration).toBe(8_000_000n)
  })

  it('C13: trimClipRight 缩短', () => {
    const clip = makeClip(0, 10, 0)
    const trimmed = trimClipRight(clip, 3_000_000n)
    expect(trimmed.duration).toBe(7_000_000n)
    expect(trimmed.sourceEnd).toBe(7_000_000n)
  })

  it('C14: trimClip 时长为 0 抛错', () => {
    const clip = makeClip(0, 10, 0)
    expect(() => trimClipLeft(clip, 10_000_000n)).toThrow()
    expect(() => trimClipRight(clip, 10_000_000n)).toThrow()
  })

  it('C15: compareClipByStart', () => {
    const a = makeClip(5, 5)
    const b = makeClip(10, 5)
    expect(compareClipByStart(a, b)).toBe(-1)
    expect(compareClipByStart(b, a)).toBe(1)
  })

  it('C16: getClipDuration', () => {
    const clip = makeClip(0, 10)
    expect(getClipDuration(clip)).toBe(10_000_000n)
  })
})

// ============================================================================
// TR: track
// ============================================================================

describe('TR: Track 轨道模型', () => {
  it('TR1: createTrack 默认值', () => {
    const track = createTrack(TrackType.VIDEO, 0)
    expect(track.type).toBe(TrackType.VIDEO)
    expect(track.index).toBe(0)
    expect(track.clips).toEqual([])
    expect(track.visible).toBe(true)
    expect(track.locked).toBe(false)
  })

  it('TR2: createTrack 自动命名', () => {
    const track = createTrack(TrackType.AUDIO, 2)
    expect(track.name).toBe('Audio 3')
  })

  it('TR3: addClipToTrack 自动排序', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    const clip1 = makeClip(10, 5)
    const clip2 = makeClip(0, 5)
    track = addClipToTrack(track, clip1)
    track = addClipToTrack(track, clip2)
    expect(track.clips[0].id).toBe(clip2.id)
    expect(track.clips[1].id).toBe(clip1.id)
  })

  it('TR4: removeClipFromTrack', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    const clip = makeClip(0, 5, 0, 'c1')
    track = addClipToTrack(track, clip)
    track = removeClipFromTrack(track, 'c1')
    expect(track.clips.length).toBe(0)
  })

  it('TR5: replaceClipInTrack', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    const clip = makeClip(0, 5, 0, 'c1')
    track = addClipToTrack(track, clip)
    const newClip = { ...clip, timelineStart: 10_000_000n }
    track = replaceClipInTrack(track, 'c1', newClip)
    expect(track.clips[0].timelineStart).toBe(10_000_000n)
  })

  it('TR6: findClipAt', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    track = addClipToTrack(track, makeClip(0, 5, 0, 'a'))
    track = addClipToTrack(track, makeClip(10, 5, 0, 'b'))
    expect(findClipAt(track, 2_000_000n)?.id).toBe('a')
    expect(findClipAt(track, 12_000_000n)?.id).toBe('b')
    expect(findClipAt(track, 8_000_000n)).toBe(null)
  })

  it('TR7: findClipsInRange', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    track = addClipToTrack(track, makeClip(0, 5, 0, 'a'))   // [0, 5)
    track = addClipToTrack(track, makeClip(10, 5, 0, 'b'))  // [10, 15)
    track = addClipToTrack(track, makeClip(20, 5, 0, 'c'))  // [20, 25)
    const found = findClipsInRange(track, 3_000_000n, 12_000_000n)
    expect(found.length).toBe(2)
    expect(found[0].id).toBe('a')
    expect(found[1].id).toBe('b')
  })

  it('TR8: getTrackDuration / isTrackEmpty', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    expect(isTrackEmpty(track)).toBe(true)
    expect(getTrackDuration(track)).toBe(0n)
    track = addClipToTrack(track, makeClip(5, 10))
    expect(isTrackEmpty(track)).toBe(false)
    expect(getTrackDuration(track)).toBe(15_000_000n)
  })
})

// ============================================================================
// S: sequence
// ============================================================================

describe('S: Sequence 时间线工程', () => {
  it('S1: createSequence 默认值', () => {
    const seq = createSequence()
    expect(seq.fps).toBe(30)
    expect(seq.width).toBe(1920)
    expect(seq.height).toBe(1080)
    expect(seq.tracks.length).toBe(2) // 1 video + 1 audio
    expect(seq.tracks[0].type).toBe(TrackType.VIDEO)
    expect(seq.tracks[1].type).toBe(TrackType.AUDIO)
  })

  it('S2: addTrack', () => {
    let seq = createSequence()
    seq = addTrack(seq, TrackType.TEXT)
    expect(seq.tracks.length).toBe(3)
    expect(seq.tracks.some((t) => t.type === TrackType.TEXT)).toBe(true)
  })

  it('S3: removeTrack', () => {
    let seq = createSequence()
    const trackId = seq.tracks[0].id
    seq = removeTrack(seq, trackId)
    expect(seq.tracks.length).toBe(1)
  })

  it('S4: findTrackById', () => {
    const seq = createSequence()
    const trackId = seq.tracks[0].id
    expect(findTrackById(seq, trackId)?.type).toBe(TrackType.VIDEO)
    expect(findTrackById(seq, 'nonexistent')).toBe(null)
  })

  it('S5: getTracksByType', () => {
    let seq = createSequence()
    seq = addTrack(seq, TrackType.VIDEO)
    const videoTracks = getTracksByType(seq, TrackType.VIDEO)
    expect(videoTracks.length).toBe(2)
  })

  it('S6: replaceTrack', () => {
    let seq = createSequence()
    const oldTrack = seq.tracks[0]
    const newTrack = { ...oldTrack, name: 'Renamed' }
    seq = replaceTrack(seq, oldTrack.id, newTrack)
    expect(seq.tracks[0].name).toBe('Renamed')
  })

  it('S7: getActualDuration', () => {
    let seq = createSequence({ duration: seconds(60) })
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 100, 0)) // 100s clip
    seq = replaceTrack(seq, track.id, track)
    expect(getActualDuration(seq)).toBe(100_000_000n)
  })

  it('S8: findClipById', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    const clip = makeClip(0, 5, 0, 'clip-x')
    track = addClipToTrack(track, clip)
    seq = replaceTrack(seq, track.id, track)
    const found = findClipById(seq, 'clip-x')
    expect(found?.clip.id).toBe('clip-x')
    expect(found?.track.type).toBe(TrackType.VIDEO)
  })

  it('S9: getTotalClipCount', () => {
    let seq = createSequence()
    let vTrack = seq.tracks[0]
    let aTrack = seq.tracks[1]
    vTrack = addClipToTrack(vTrack, makeClip(0, 5))
    vTrack = addClipToTrack(vTrack, makeClip(10, 5))
    aTrack = addClipToTrack(aTrack, makeClip(0, 15))
    seq = replaceTrack(seq, vTrack.id, vTrack)
    seq = replaceTrack(seq, aTrack.id, aTrack)
    expect(getTotalClipCount(seq)).toBe(3)
  })
})

// ============================================================================
// P: project
// ============================================================================

describe('P: Project 项目模型', () => {
  it('P1: createProject 默认值', () => {
    const proj = createProject('测试')
    expect(proj.name).toBe('测试')
    expect(proj.sequences.length).toBe(1)
    expect(proj.activeSequenceId).toBe(proj.sequences[0].id)
    expect(proj.assets).toEqual([])
  })

  it('P2: addAsset / findAsset', () => {
    let proj = createProject()
    const asset = {
      id: 'a1', name: 'video.mp4', path: '/tmp/v.mp4',
      kind: 'video' as const, duration: 120_000_000n,
      width: 1920, height: 1080, fps: 30,
    }
    proj = addAsset(proj, asset)
    expect(findAsset(proj, 'a1')?.name).toBe('video.mp4')
    expect(findAsset(proj, 'nonexistent')).toBe(null)
  })

  it('P3: getActiveSequence', () => {
    const proj = createProject()
    expect(getActiveSequence(proj)?.id).toBe(proj.activeSequenceId)
  })

  it('P4: addSequence / setActiveSequence', () => {
    let proj = createProject()
    const newSeq = createSequence({ name: '片头' })
    proj = addSequence(proj, newSeq)
    expect(proj.sequences.length).toBe(2)
    proj = setActiveSequence(proj, newSeq.id) as typeof proj
    // setActiveSequence returns Project with readonly sequences; cast
  })
})

// ============================================================================
// I: timelineIndex
// ============================================================================

describe('I: TimelineIndex 区间索引', () => {
  it('I1: buildIndex 排序', () => {
    const clips = [
      makeClip(10, 5, 0, 'b'),
      makeClip(0, 5, 0, 'a'),
      makeClip(20, 5, 0, 'c'),
    ]
    const index = buildIndex('track1', clips)
    expect(index.entries[0].clip.id).toBe('a')
    expect(index.entries[1].clip.id).toBe('b')
    expect(index.entries[2].clip.id).toBe('c')
  })

  it('I2: queryPoint 空索引', () => {
    const index = buildIndex('t1', [])
    expect(queryPoint(index, 1_000_000n)).toEqual([])
  })

  it('I3: queryPoint 找到活跃 Clip', () => {
    const clips = [
      makeClip(0, 5, 0, 'a'),   // [0, 5)
      makeClip(10, 5, 0, 'b'),  // [10, 15)
    ]
    const index = buildIndex('t1', clips)
    expect(queryPoint(index, 2_000_000n).map((c) => c.id)).toEqual(['a'])
    expect(queryPoint(index, 12_000_000n).map((c) => c.id)).toEqual(['b'])
  })

  it('I4: queryPoint 边界(start 包含, end 不包含)', () => {
    const clips = [makeClip(0, 5, 0, 'a')] // [0, 5)
    const index = buildIndex('t1', clips)
    expect(queryPoint(index, 0n).length).toBe(1)
    expect(queryPoint(index, 4_999_999n).length).toBe(1)
    expect(queryPoint(index, 5_000_000n).length).toBe(0)
  })

  it('I5: queryPoint 重叠 Clip', () => {
    const clips = [
      makeClip(0, 10, 0, 'a'),  // [0, 10)
      makeClip(5, 10, 0, 'b'),  // [5, 15)
    ]
    const index = buildIndex('t1', clips)
    // t=7 同时在 a 和 b 中
    const result = queryPoint(index, 7_000_000n)
    expect(result.length).toBe(2)
  })

  it('I6: queryPoint 无活跃', () => {
    const clips = [makeClip(0, 5, 0, 'a')]
    const index = buildIndex('t1', clips)
    expect(queryPoint(index, 10_000_000n)).toEqual([])
  })

  it('I7: queryRange 重叠', () => {
    const clips = [
      makeClip(0, 5, 0, 'a'),   // [0, 5)
      makeClip(10, 5, 0, 'b'),  // [10, 15)
      makeClip(20, 5, 0, 'c'),  // [20, 25)
    ]
    const index = buildIndex('t1', clips)
    // 查询 [3, 12)
    const result = queryRange(index, 3_000_000n, 12_000_000n)
    expect(result.length).toBe(2)
    expect(result.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('I8: queryRange 无重叠', () => {
    const clips = [makeClip(0, 5, 0, 'a')]
    const index = buildIndex('t1', clips)
    expect(queryRange(index, 10_000_000n, 15_000_000n)).toEqual([])
  })

  it('I9: indexSize', () => {
    const index = buildIndex('t1', [makeClip(0, 5), makeClip(10, 5)])
    expect(indexSize(index)).toBe(2)
  })

  it('I10: buildSequenceIndex 多轨道', () => {
    const seq = createSequence()
    let track1 = seq.tracks[0]
    let track2 = seq.tracks[1]
    track1 = addClipToTrack(track1, makeClip(0, 5, 0, 'v1'))
    track2 = addClipToTrack(track2, makeClip(0, 5, 0, 'a1'))
    const indexMap = buildSequenceIndex([track1, track2])
    expect(indexMap.size).toBe(2)
    expect(indexMap.get(track1.id)?.entries.length).toBe(1)
    expect(indexMap.get(track2.id)?.entries.length).toBe(1)
  })
})

// ============================================================================
// RES: resolver
// ============================================================================

describe('RES: TimelineResolver 解析器', () => {
  it('RES1: resolveTimeline 返回活跃 Clip', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 0, 'a'))
    track = addClipToTrack(track, makeClip(20, 5, 0, 'b'))
    seq = replaceTrack(seq, track.id, track)

    const result = resolveTimeline(seq, 5_000_000n)
    expect(result.allActiveClips.length).toBe(1)
    expect(result.allActiveClips[0].id).toBe('a')
  })

  it('RES2: resolveTimeline 多轨道', () => {
    let seq = createSequence()
    let vTrack = seq.tracks[0]
    let aTrack = seq.tracks[1]
    vTrack = addClipToTrack(vTrack, makeClip(0, 10, 0, 'v1'))
    aTrack = addClipToTrack(aTrack, makeClip(0, 10, 0, 'a1',))
    seq = replaceTrack(seq, vTrack.id, vTrack)
    seq = replaceTrack(seq, aTrack.id, aTrack)

    const result = resolveTimeline(seq, 5_000_000n)
    expect(result.videoClips.length).toBe(1)
    expect(result.audioClips.length).toBe(1)
  })

  it('RES3: resolveTimeline 跳过不可见轨道', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 0, 'v1'))
    track = { ...track, visible: false }
    seq = replaceTrack(seq, track.id, track)

    const result = resolveTimeline(seq, 5_000_000n)
    expect(result.videoClips.length).toBe(0)
  })

  it('RES4: resolveTimeline 跳过禁用 Clip', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    const clip = { ...makeClip(0, 10, 0, 'v1'), enabled: false }
    track = addClipToTrack(track, clip)
    seq = replaceTrack(seq, track.id, track)

    const result = resolveTimeline(seq, 5_000_000n)
    expect(result.allActiveClips.length).toBe(0)
  })

  it('RES5: CachedTimelineResolver 缓存复用', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 0, 'a'))
    seq = replaceTrack(seq, track.id, track)

    const resolver = new CachedTimelineResolver(seq)
    const r1 = resolver.resolve(5_000_000n)
    expect(r1.allActiveClips.length).toBe(1)

    // 修改 sequence 后重建
    let track2 = resolver.getSequence().tracks[0]
    track2 = addClipToTrack(track2, makeClip(20, 5, 0, 'b'))
    seq = replaceTrack(seq, track2.id, track2)
    resolver.setSequence(seq)
    const r2 = resolver.resolve(22_000_000n)
    expect(r2.allActiveClips.length).toBe(1)
    expect(r2.allActiveClips[0].id).toBe('b')
  })

  it('RES6: resolveTrack', () => {
    let track = createTrack(TrackType.VIDEO, 0)
    track = addClipToTrack(track, makeClip(0, 10, 0, 'a'))
    const active = resolveTrack(track, 5_000_000n)
    expect(active.length).toBe(1)
    expect(active[0].id).toBe('a')
  })
})

// ============================================================================
// FQ: frameResolver
// ============================================================================

describe('FQ: FrameResolver 渲染队列', () => {
  it('FQ1: buildRenderQueue 基本构建', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 0, 'v1'))
    seq = replaceTrack(seq, track.id, track)

    const resolveResult = resolveTimeline(seq, 5_000_000n)
    const queue = buildRenderQueue(resolveResult)
    expect(queue.items.length).toBe(1)
    expect(queue.items[0].clip.id).toBe('v1')
    expect(queue.items[0].zOrder).toBe(0)
  })

  it('FQ2: buildRenderQueue zOrder 顺序', () => {
    let seq = createSequence()
    seq = addTrack(seq, TrackType.VIDEO) // 第二条视频轨
    let track0 = seq.tracks[0]
    let track1 = seq.tracks.find((t) => t.index === 1 && t.type === TrackType.VIDEO)!
    track0 = addClipToTrack(track0, makeClip(0, 10, 0, 'v0'))
    track1 = addClipToTrack(track1, makeClip(0, 10, 0, 'v1'))
    seq = replaceTrack(seq, track0.id, track0)
    seq = replaceTrack(seq, track1.id, track1)

    const resolveResult = resolveTimeline(seq, 5_000_000n)
    const queue = buildRenderQueue(resolveResult)
    expect(queue.items.length).toBe(2)
    expect(queue.items[0].zOrder).toBe(0)
    expect(queue.items[1].zOrder).toBe(1)
  })

  it('FQ3: buildRenderQueue sourceTime 映射', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 30, 'v1')) // source [30, 40)
    seq = replaceTrack(seq, track.id, track)

    const resolveResult = resolveTimeline(seq, 5_000_000n)
    const queue = buildRenderQueue(resolveResult)
    expect(queue.items[0].sourceTime).toBe(35_000_000n)
  })

  it('FQ4: buildAudioQueue', () => {
    let seq = createSequence()
    let aTrack = seq.tracks[1] // Audio 1
    aTrack = addClipToTrack(aTrack, makeClip(0, 10, 0, 'a1'))
    seq = replaceTrack(seq, aTrack.id, aTrack)

    const resolveResult = resolveTimeline(seq, 5_000_000n)
    const audioQueue = buildAudioQueue(resolveResult)
    expect(audioQueue.length).toBe(1)
    expect(audioQueue[0].clip.id).toBe('a1')
  })

  it('FQ5: buildAudioQueue 跳过静音轨道', () => {
    let seq = createSequence()
    let aTrack = seq.tracks[1]
    aTrack = addClipToTrack(aTrack, makeClip(0, 10, 0, 'a1'))
    aTrack = { ...aTrack, muted: true }
    seq = replaceTrack(seq, aTrack.id, aTrack)

    const resolveResult = resolveTimeline(seq, 5_000_000n)
    const audioQueue = buildAudioQueue(resolveResult)
    expect(audioQueue.length).toBe(0)
  })
})

// ============================================================================
// CMD: commands
// ============================================================================

describe('CMD: Commands 命令系统', () => {
  let state: ReturnType<typeof makeMutableState>

  beforeEach(() => {
    state = makeMutableState()
  })

  it('CMD1: AddClipCommand + undo', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 5, 0, 'c1')

    const cmd = new AddClipCommand(state, track.id, clip)
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(1)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(0)
  })

  it('CMD2: DeleteClipCommand + undo', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 5, 0, 'c1')
    track = addClipToTrack(track, clip)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new DeleteClipCommand(state, track.id, 'c1')
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(0)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(1)
  })

  it('CMD3: MoveClipCommand + undo', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 5, 0, 'c1')
    track = addClipToTrack(track, clip)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new MoveClipCommand(state, track.id, 'c1', 10_000_000n)
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips[0].timelineStart).toBe(10_000_000n)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips[0].timelineStart).toBe(0n)
  })

  it('CMD4: TrimClipCommand left + undo', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 10, 0, 'c1')
    track = addClipToTrack(track, clip)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new TrimClipCommand(state, track.id, 'c1', 'left', 2_000_000n)
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips[0].timelineStart).toBe(2_000_000n)
    expect(track.clips[0].duration).toBe(8_000_000n)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips[0].timelineStart).toBe(0n)
    expect(track.clips[0].duration).toBe(10_000_000n)
  })

  it('CMD5: TrimClipCommand right + undo', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 10, 0, 'c1')
    track = addClipToTrack(track, clip)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new TrimClipCommand(state, track.id, 'c1', 'right', 3_000_000n)
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips[0].duration).toBe(7_000_000n)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips[0].duration).toBe(10_000_000n)
  })

  it('CMD6: CutClipCommand + undo', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 10, 0, 'c1')
    track = addClipToTrack(track, clip)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new CutClipCommand(state, track.id, 'c1', 4_000_000n)
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(2)
    // 左半部分 [0, 4)
    expect(track.clips[0].timelineStart).toBe(0n)
    expect(track.clips[0].duration).toBe(4_000_000n)
    // 右半部分 [4, 10)
    expect(track.clips[1].timelineStart).toBe(4_000_000n)
    expect(track.clips[1].duration).toBe(6_000_000n)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(1)
  })

  it('CMD7: CutClipCommand 切割点在边界外不操作', () => {
    let track = state.seq.tracks[0]
    const clip = makeClip(0, 10, 0, 'c1')
    track = addClipToTrack(track, clip)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new CutClipCommand(state, track.id, 'c1', 15_000_000n)
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(1) // 未切割
  })

  it('CMD8: RippleDeleteCommand + undo', () => {
    let track = state.seq.tracks[0]
    const clipA = makeClip(0, 5, 0, 'a')   // [0, 5)
    const clipB = makeClip(5, 5, 0, 'b')   // [5, 10) — 将被删除
    const clipC = makeClip(10, 5, 0, 'c')  // [10, 15) — 应左移到 [5, 10)
    track = addClipToTrack(track, clipA)
    track = addClipToTrack(track, clipB)
    track = addClipToTrack(track, clipC)
    state.seq = replaceTrack(state.seq, track.id, track)

    const cmd = new RippleDeleteCommand(state, track.id, 'b')
    cmd.execute()

    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(2)
    // clipC 应左移 5s: [10, 15) → [5, 10)
    expect(track.clips[1].timelineStart).toBe(5_000_000n)

    cmd.undo()
    track = state.seq.tracks[0]
    expect(track.clips.length).toBe(3)
    expect(track.clips[2].timelineStart).toBe(10_000_000n)
  })
})

// ============================================================================
// H: history
// ============================================================================

describe('H: CommandHistory 历史栈', () => {
  let state: ReturnType<typeof makeMutableState>

  beforeEach(() => {
    state = makeMutableState()
  })

  it('H1: execute / canUndo / undo', () => {
    const history = new CommandHistory()
    expect(history.canUndo()).toBe(false)

    const clip = makeClip(0, 5, 0, 'c1')
    const cmd = new AddClipCommand(state, state.seq.tracks[0].id, clip)
    history.execute(cmd)

    expect(history.canUndo()).toBe(true)
    expect(history.undoCount).toBe(1)

    history.undo()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)
  })

  it('H2: redo', () => {
    const history = new CommandHistory()
    const clip = makeClip(0, 5, 0, 'c1')
    history.execute(new AddClipCommand(state, state.seq.tracks[0].id, clip))
    history.undo()
    history.redo()

    expect(history.canUndo()).toBe(true)
    expect(history.canRedo()).toBe(false)
    expect(state.seq.tracks[0].clips.length).toBe(1)
  })

  it('H3: execute 清空 redo stack', () => {
    const history = new CommandHistory()
    history.execute(new AddClipCommand(state, state.seq.tracks[0].id, makeClip(0, 5, 0, 'a')))
    history.undo()
    // 此时 redo stack 有 1 项
    expect(history.canRedo()).toBe(true)

    // 执行新命令 → redo 清空
    history.execute(new AddClipCommand(state, state.seq.tracks[0].id, makeClip(10, 5, 0, 'b')))
    expect(history.canRedo()).toBe(false)
  })

  it('H4: clear', () => {
    const history = new CommandHistory()
    history.execute(new AddClipCommand(state, state.seq.tracks[0].id, makeClip(0, 5)))
    history.clear()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })

  it('H5: limit 丢弃最旧', () => {
    const history = new CommandHistory(3)
    for (let i = 0; i < 5; i++) {
      history.execute(new AddClipCommand(state, state.seq.tracks[0].id, makeClip(i * 100, 5, 0, `c${i}`)))
    }
    expect(history.undoCount).toBe(3) // 限制为 3
  })

  it('H6: nextUndoLabel / nextRedoLabel', () => {
    const history = new CommandHistory()
    expect(history.nextUndoLabel).toBe(null)

    history.execute(new AddClipCommand(state, state.seq.tracks[0].id, makeClip(0, 5)))
    expect(history.nextUndoLabel).toBe('添加片段')

    history.undo()
    expect(history.nextRedoLabel).toBe('添加片段')
  })

  it('H7: listeners', () => {
    const history = new CommandHistory()
    const events: string[] = []
    const off = history.on((e) => events.push(e.type))

    history.execute(new AddClipCommand(state, state.seq.tracks[0].id, makeClip(0, 5)))
    history.undo()
    history.redo()

    expect(events).toEqual(['execute', 'undo', 'redo'])
    off()
  })

  it('H8: DEFAULT_HISTORY_LIMIT', () => {
    expect(DEFAULT_HISTORY_LIMIT).toBe(100)
  })
})

// ============================================================================
// SNAP: snap
// ============================================================================

describe('SNAP: Snap 吸附系统', () => {
  it('SNAP1: collectSnapTargets 收集目标', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 0, 'a'))  // start=0, end=10
    track = addClipToTrack(track, makeClip(20, 5, 0, 'b'))  // start=20, end=25
    seq = replaceTrack(seq, track.id, track)

    const targets = collectSnapTargets(seq, 15_000_000n)
    // 目标: origin(0), clip-a start(0), clip-a end(10), clip-b start(20), clip-b end(25), playhead(15)
    expect(targets.length).toBe(6)
    expect(targets.some((t) => t.type === 'origin')).toBe(true)
    expect(targets.some((t) => t.type === 'playhead')).toBe(true)
  })

  it('SNAP2: collectSnapTargets 排除指定 Clip', () => {
    let seq = createSequence()
    let track = seq.tracks[0]
    track = addClipToTrack(track, makeClip(0, 10, 0, 'a'))
    track = addClipToTrack(track, makeClip(20, 5, 0, 'b'))
    seq = replaceTrack(seq, track.id, track)

    const targets = collectSnapTargets(seq, undefined, undefined, 'a')
    // 不含 clip-a 的 start/end
    expect(targets.filter((t) => t.clipId === 'a').length).toBe(0)
  })

  it('SNAP3: findSnap 吸附成功', () => {
    const targets = [
      { time: 0n, type: 'origin' as const },
      { time: 10_000_000n, type: 'clip-start' as const },
    ]
    // 9.99s 距 10s 10000 微秒,在阈值内
    const result = findSnap(9_990_000n, targets, 100_000n)
    expect(result.snapped).toBe(true)
    expect(result.time).toBe(10_000_000n)
  })

  it('SNAP4: findSnap 无吸附', () => {
    const targets = [{ time: 0n, type: 'origin' as const }]
    const result = findSnap(5_000_000n, targets, 100_000n)
    expect(result.snapped).toBe(false)
    expect(result.time).toBe(5_000_000n)
  })

  it('SNAP5: snapClipPosition 吸附 start', () => {
    const targets = [{ time: 10_000_000n, type: 'clip-start' as const }]
    // Clip start=9.99s, end=19.99s → start 吸附到 10s
    const result = snapClipPosition(9_990_000n, 19_990_000n, targets, 100_000n)
    expect(result.snapped).toBe(true)
    expect(result.start).toBe(10_000_000n)
  })

  it('SNAP6: snapClipPosition 吸附 end', () => {
    const targets = [{ time: 20_000_000n, type: 'clip-end' as const }]
    // Clip start=9.99s, end=19.99s → end 吸附到 20s
    const result = snapClipPosition(9_990_000n, 19_990_000n, targets, 100_000n)
    expect(result.snapped).toBe(true)
    expect(result.end).toBe(20_000_000n)
    expect(result.start).toBe(10_000_000n)
  })
})

// ============================================================================
// STORE: useProTimelineStore
// ============================================================================

describe('STORE: ProTimelineStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('STORE1: init 初始化项目', () => {
    const store = useProTimelineStore()
    const proj = createProject('测试项目')
    store.init(proj)
    expect(store.project.name).toBe('测试项目')
    expect(store.playing).toBe(false)
    expect(store.currentTime).toBe(0n)
  })

  it('STORE2: addClip + undo + redo', () => {
    const store = useProTimelineStore()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5, 0, 'c1')

    store.addClip(trackId, clip)
    expect(store.tracks[0].clips.length).toBe(1)
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.tracks[0].clips.length).toBe(0)

    store.redo()
    expect(store.tracks[0].clips.length).toBe(1)
  })

  it('STORE3: moveClip + undo', () => {
    const store = useProTimelineStore()
    const trackId = store.tracks[0].id
    store.addClip(trackId, makeClip(0, 5, 0, 'c1'))

    store.moveClip(trackId, 'c1', 10_000_000n)
    expect(store.tracks[0].clips[0].timelineStart).toBe(10_000_000n)

    store.undo()
    expect(store.tracks[0].clips[0].timelineStart).toBe(0n)
  })

  it('STORE4: cutClip', () => {
    const store = useProTimelineStore()
    const trackId = store.tracks[0].id
    store.addClip(trackId, makeClip(0, 10, 0, 'c1'))

    store.cutClip(trackId, 'c1', 4_000_000n)
    expect(store.tracks[0].clips.length).toBe(2)
  })

  it('STORE5: rippleDelete', () => {
    const store = useProTimelineStore()
    const trackId = store.tracks[0].id
    store.addClip(trackId, makeClip(0, 5, 0, 'a'))
    store.addClip(trackId, makeClip(5, 5, 0, 'b'))
    store.addClip(trackId, makeClip(10, 5, 0, 'c'))

    store.rippleDelete(trackId, 'b')
    expect(store.tracks[0].clips.length).toBe(2)
    // clip-c 左移到 5s
    expect(store.tracks[0].clips[1].timelineStart).toBe(5_000_000n)
  })

  it('STORE6: play / pause / seek', () => {
    const store = useProTimelineStore()
    store.play()
    expect(store.playing).toBe(true)
    store.pause()
    expect(store.playing).toBe(false)
    store.seek(seconds(5))
    expect(store.currentTime).toBe(5_000_000n)
  })

  it('STORE7: seek 钳制到 duration', () => {
    const store = useProTimelineStore()
    const dur = store.duration
    store.seek(dur + seconds(10))
    expect(store.currentTime).toBe(dur)
  })

  it('STORE8: advanceTime 播放推进', () => {
    const store = useProTimelineStore()
    store.play()
    store.advanceTime(0.5) // 0.5 秒
    expect(store.currentTime).toBe(500_000n)
  })

  it('STORE9: advanceTime 到达末尾停止', () => {
    const store = useProTimelineStore()
    store.seek(store.duration - seconds(0.1))
    store.play()
    store.advanceTime(0.5) // 超过末尾
    expect(store.playing).toBe(false)
    expect(store.currentTime).toBe(store.duration)
  })

  it('STORE10: resolveActiveClips', () => {
    const store = useProTimelineStore()
    const trackId = store.tracks[0].id
    store.addClip(trackId, makeClip(0, 10, 0, 'a'))
    store.seek(seconds(5))
    const result = store.resolveActiveClips()
    expect(result).not.toBeNull()
    expect(result!.allActiveClips.length).toBe(1)
    expect(result!.allActiveClips[0].id).toBe('a')
  })

  it('STORE11: activeClips computed', () => {
    const store = useProTimelineStore()
    const trackId = store.tracks[0].id
    store.addClip(trackId, makeClip(0, 10, 0, 'a'))
    store.seek(seconds(5))
    expect(store.activeClips.length).toBe(1)
  })

  it('STORE12: currentFrame / totalFrames', () => {
    const store = useProTimelineStore()
    expect(store.fps).toBe(30)
    expect(store.totalFrames).toBeGreaterThan(0)
    store.seek(seconds(1))
    expect(store.currentFrame).toBe(30)
  })

  it('STORE13: videoTracks / audioTracks', () => {
    const store = useProTimelineStore()
    expect(store.videoTracks.length).toBe(1)
    expect(store.audioTracks.length).toBe(1)
  })

  it('STORE14: historyVersion 递增', () => {
    const store = useProTimelineStore()
    const v0 = store.historyVersion
    store.addClip(store.tracks[0].id, makeClip(0, 5, 0, 'a'))
    expect(store.historyVersion).toBeGreaterThan(v0)
  })
})
