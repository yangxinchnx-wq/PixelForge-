/**
 * Step 31.3 单元测试 — 多轨道编辑增强(Track CRUD + Reorder + Resize + Color + Rename + Duplicate)。
 *
 * 覆盖:
 * - T:  Track 模型扩展(color / height / duplicateTrack)
 * - S:  Sequence 扩展(reorderTracks / moveTrackByIndex / insertTrack)
 * - I:  Store 集成(全部 6 个新 action,含 Command execute + undo 循环)
 *
 * 注:C 块(Command 直接 new)与 I 块(通过 store action 触发 Command)重复,
 *     且 Command 需要 MutableSequenceState(私有),故合并到 I 块通过 store action 测试。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  createTrack,
  setTrackColor,
  setTrackHeight,
  setTrackName,
  setTrackIndex,
  duplicateTrack,
  TRACK_DEFAULT_COLORS,
  MIN_TRACK_HEIGHT,
  MAX_TRACK_HEIGHT,
  TrackType,
} from '@/editor/timeline/core/track'
import { createClip, genClipId } from '@/editor/timeline/core/clip'
import {
  createSequence,
  reorderTracks,
  moveTrackByIndex,
  insertTrack,
  removeTrack,
} from '@/editor/timeline/core/sequence'
import { seconds } from '@/editor/timeline/core/time'
import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'

// ============================================================================
// 辅助
// ============================================================================

function makeClip(startSec: number, durSec: number, id?: string) {
  return createClip({
    assetId: 'test-asset',
    kind: 'video',
    timelineStart: seconds(startSec),
    sourceStart: seconds(startSec),
    sourceEnd: seconds(startSec + durSec),
    id,
  })
}

function makeSeqWith3VideoTracks() {
  let seq = createSequence({ id: 'seq_test' })
  // createSequence 默认已含 1 video + 1 audio,先把默认 video 改名为 V1,再追加 V2 V3
  seq.tracks[0].name = 'V1'
  seq.tracks[0].index = 0
  seq = insertTrack(seq, createTrack(TrackType.VIDEO, 1, 'V2'), 1)
  seq = insertTrack(seq, createTrack(TrackType.VIDEO, 2, 'V3'), 2)
  // 把默认 audio 移到末尾(保持 video 在前)
  return seq
}

// ============================================================================
// T: Track 模型扩展
// ============================================================================

describe('T: Track 模型扩展(Step 31.3)', () => {
  it('createTrack 默认 color 按 TrackType 分配', () => {
    const v = createTrack(TrackType.VIDEO, 0)
    const a = createTrack(TrackType.AUDIO, 0)
    const t = createTrack(TrackType.TEXT, 0)
    const e = createTrack(TrackType.EFFECT, 0)
    expect(v.color).toBe(TRACK_DEFAULT_COLORS[TrackType.VIDEO])
    expect(a.color).toBe(TRACK_DEFAULT_COLORS[TrackType.AUDIO])
    expect(t.color).toBe(TRACK_DEFAULT_COLORS[TrackType.TEXT])
    expect(e.color).toBe(TRACK_DEFAULT_COLORS[TrackType.EFFECT])
  })

  it('createTrack 接受自定义 color', () => {
    const t = createTrack(TrackType.VIDEO, 0, 'Custom', '#FF0000')
    expect(t.color).toBe('#FF0000')
  })

  it('setTrackColor 修改 color', () => {
    const t = createTrack(TrackType.VIDEO, 0)
    const newT = setTrackColor(t, '#ABCDEF')
    expect(newT.color).toBe('#ABCDEF')
    expect(t.color).toBe(TRACK_DEFAULT_COLORS[TrackType.VIDEO]) // 原 track 不变
  })

  it('setTrackHeight clamp 到 [MIN, MAX]', () => {
    const t = createTrack(TrackType.VIDEO, 0)
    expect(setTrackHeight(t, 10).height).toBe(MIN_TRACK_HEIGHT)
    expect(setTrackHeight(t, 99999).height).toBe(MAX_TRACK_HEIGHT)
    expect(setTrackHeight(t, 100).height).toBe(100)
    expect(setTrackHeight(t, 100.4).height).toBe(100)
    expect(setTrackHeight(t, 100.5).height).toBe(101)
  })

  it('setTrackName trim + 空字符串保留原名', () => {
    const t = createTrack(TrackType.VIDEO, 0, 'Original')
    expect(setTrackName(t, '新名字').name).toBe('新名字')
    expect(setTrackName(t, '  带空格  ').name).toBe('带空格')
    expect(setTrackName(t, '   ').name).toBe('Original')
    expect(setTrackName(t, '').name).toBe('Original')
  })

  it('setTrackIndex 负值会被 clamp 到 0', () => {
    const t = createTrack(TrackType.VIDEO, 0)
    expect(setTrackIndex(t, -5).index).toBe(0)
    expect(setTrackIndex(t, 5).index).toBe(5)
  })

  it('duplicateTrack 生成新 ID + 名称加 " 副本" + 深拷贝 clips', () => {
    const t = createTrack(TrackType.VIDEO, 0, 'V1')
    const c1 = makeClip(0, 5, 'c1')
    const c2 = makeClip(8, 4, 'c2')
    t.clips = [c1, c2]

    const newT = duplicateTrack(t, 1, genClipId)
    expect(newT.id).not.toBe(t.id)
    expect(newT.name).toBe('V1 副本')
    expect(newT.index).toBe(1)
    expect(newT.color).toBe(t.color)
    expect(newT.clips.length).toBe(2)
    expect(newT.clips[0].id).not.toBe('c1')
    expect(newT.clips[1].id).not.toBe('c2')
    expect(t.clips[0].id).toBe('c1')
    expect(t.clips.length).toBe(2)
  })
})

// ============================================================================
// S: Sequence 扩展(reorderTracks / moveTrackByIndex / insertTrack)
// ============================================================================

describe('S: Sequence 扩展(Step 31.3)', () => {
  it('reorderTracks 把 fromId 移动到 toId 之前', () => {
    const seq = makeSeqWith3VideoTracks()
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const v3 = seq.tracks.find((t) => t.name === 'V3')!
    // V3 → V1 之前
    const newSeq = reorderTracks(seq, v3.id, v1.id)
    const names = newSeq.tracks.map((t) => t.name)
    expect(names[0]).toBe('V3')
    expect(names[1]).toBe('V1')
  })

  it('reorderTracks fromId === toId 无操作(返回原 sequence)', () => {
    const seq = makeSeqWith3VideoTracks()
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const newSeq = reorderTracks(seq, v1.id, v1.id)
    expect(newSeq).toBe(seq)
  })

  it('reorderTracks 不存在的 ID 无操作', () => {
    const seq = makeSeqWith3VideoTracks()
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const newSeq = reorderTracks(seq, 'nonexistent', v1.id)
    const names = newSeq.tracks.map((t) => t.name)
    expect(names).toContain('V1')
    expect(names).toContain('V2')
    expect(names).toContain('V3')
  })

  it('reorderTracks 后同类型轨道 index 重新编号(0 起递增)', () => {
    const seq = makeSeqWith3VideoTracks()
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const v3 = seq.tracks.find((t) => t.name === 'V3')!
    const newSeq = reorderTracks(seq, v3.id, v1.id)
    const videoTracks = newSeq.tracks.filter((t) => t.type === TrackType.VIDEO)
    expect(videoTracks.map((t) => t.index)).toEqual([0, 1, 2])
  })

  it('reorderTracks 后向移动(fromIdx < toIdx)正确插入', () => {
    const seq = makeSeqWith3VideoTracks()
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const v3 = seq.tracks.find((t) => t.name === 'V3')!
    // V1 → V3 之前
    const newSeq = reorderTracks(seq, v1.id, v3.id)
    const names = newSeq.tracks.map((t) => t.name)
    // V1 从位置 0 移到 V3 之前:V2, V1, V3
    expect(names.indexOf('V2')).toBeLessThan(names.indexOf('V1'))
    expect(names.indexOf('V1')).toBeLessThan(names.indexOf('V3'))
  })

  it('moveTrackByIndex 按数组下标移动', () => {
    const seq = makeSeqWith3VideoTracks()
    // seq.tracks = [V1, V2, V3, Audio 1]
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const newSeq = moveTrackByIndex(seq, v1.id, 3)
    const names = newSeq.tracks.map((t) => t.name)
    // V1 从 0 移到 3(末尾):V2, V3, Audio 1, V1
    expect(names[names.length - 1]).toBe('V1')
    expect(names[0]).toBe('V2')
  })

  it('moveTrackByIndex 下标 clamp 到 [0, len-1]', () => {
    const seq = makeSeqWith3VideoTracks()
    const v1 = seq.tracks.find((t) => t.name === 'V1')!
    const newSeq = moveTrackByIndex(seq, v1.id, 999)
    const names = newSeq.tracks.map((t) => t.name)
    // clamp 到 len-1=3,V1 移到末尾
    expect(names[names.length - 1]).toBe('V1')
  })

  it('insertTrack 在指定位置插入', () => {
    const seq = makeSeqWith3VideoTracks()
    const newTrack = createTrack(TrackType.TEXT, 0, 'T1')
    const newSeq = insertTrack(seq, newTrack, 1)
    expect(newSeq.tracks.length).toBe(seq.tracks.length + 1)
    expect(newSeq.tracks[1].name).toBe('T1')
  })

  it('insertTrack 未指定 atIndex 追加到末尾', () => {
    const seq = makeSeqWith3VideoTracks()
    const newTrack = createTrack(TrackType.AUDIO, 0, 'A1')
    const newSeq = insertTrack(seq, newTrack)
    expect(newSeq.tracks.length).toBe(seq.tracks.length + 1)
    expect(newSeq.tracks[newSeq.tracks.length - 1].name).toBe('A1')
  })

  it('insertTrack atIndex 越界追加到末尾', () => {
    const seq = makeSeqWith3VideoTracks()
    const newTrack = createTrack(TrackType.AUDIO, 0, 'A1')
    const newSeq = insertTrack(seq, newTrack, 999)
    expect(newSeq.tracks.length).toBe(seq.tracks.length + 1)
    expect(newSeq.tracks[newSeq.tracks.length - 1].name).toBe('A1')
  })

  it('removeTrack 移除指定轨道', () => {
    const seq = makeSeqWith3VideoTracks()
    const v2 = seq.tracks.find((t) => t.name === 'V2')!
    const newSeq = removeTrack(seq, v2.id)
    expect(newSeq.tracks.length).toBe(seq.tracks.length - 1)
    expect(newSeq.tracks.find((t) => t.name === 'V2')).toBeUndefined()
  })
})

// ============================================================================
// I: Store 集成(Step 31.3 全部 6 个新 action,含 Command execute + undo)
// ============================================================================

describe('I: useProTimelineStore track actions(Step 31.3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('store 暴露 reorderTrack / resizeTrack / setTrackColor / renameTrack / deleteTrack / duplicateTrack', () => {
    const store = useProTimelineStore()
    store.reset()
    expect(typeof store.reorderTrack).toBe('function')
    expect(typeof store.resizeTrack).toBe('function')
    expect(typeof store.setTrackColor).toBe('function')
    expect(typeof store.renameTrack).toBe('function')
    expect(typeof store.deleteTrack).toBe('function')
    expect(typeof store.duplicateTrack).toBe('function')
  })

  it('resizeTrack 修改高度 + 进入 history(可 undo)', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const originalHeight = store.tracks[0].height

    store.resizeTrack(trackId, 150)
    expect(store.tracks[0].height).toBe(150)
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.tracks[0].height).toBe(originalHeight)
  })

  it('resizeTrack clamp 到 MAX_TRACK_HEIGHT', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id

    store.resizeTrack(trackId, 99999)
    expect(store.tracks[0].height).toBe(MAX_TRACK_HEIGHT)
  })

  it('resizeTrack clamp 到 MIN_TRACK_HEIGHT', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id

    store.resizeTrack(trackId, 1)
    expect(store.tracks[0].height).toBe(MIN_TRACK_HEIGHT)
  })

  it('setTrackColor 修改颜色 + 可 undo', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const original = store.tracks[0].color

    store.setTrackColor(trackId, '#ABCDEF')
    expect(store.tracks[0].color).toBe('#ABCDEF')

    store.undo()
    expect(store.tracks[0].color).toBe(original)
  })

  it('renameTrack 重命名 + 可 undo', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id

    store.renameTrack(trackId, '新名')
    expect(store.tracks[0].name).toBe('新名')

    store.undo()
    expect(store.tracks[0].name).toBe('Video 1')
  })

  it('renameTrack 空字符串保留原名', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id

    store.renameTrack(trackId, '   ')
    expect(store.tracks[0].name).toBe('Video 1')
  })

  it('deleteTrack 删除 + 可 undo', () => {
    const store = useProTimelineStore()
    store.reset()
    const initialCount = store.tracks.length
    const trackId = store.tracks[0].id

    store.deleteTrack(trackId)
    expect(store.tracks.length).toBe(initialCount - 1)
    expect(store.tracks.find((t) => t.id === trackId)).toBeUndefined()

    store.undo()
    expect(store.tracks.length).toBe(initialCount)
    expect(store.tracks.find((t) => t.id === trackId)).toBeDefined()
  })

  it('duplicateTrack 复制(深拷贝 clips) + 可 undo', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    // 给原轨道加 clip,验证深拷贝
    store.addClip(trackId, makeClip(0, 5, 'c1'))
    const initialCount = store.tracks.length

    store.duplicateTrack(trackId)
    expect(store.tracks.length).toBe(initialCount + 1)
    // 新轨道名称带 " 副本",且 clips 深拷贝(新 ID)
    const newTrack = store.tracks.find((t) => t.name.endsWith('副本'))
    expect(newTrack).toBeDefined()
    expect(newTrack!.clips.length).toBe(1)
    expect(newTrack!.clips[0].id).not.toBe('c1')

    store.undo()
    expect(store.tracks.length).toBe(initialCount)
    expect(store.tracks.find((t) => t.name.endsWith('副本'))).toBeUndefined()
  })

  it('reorderTrack 调整顺序 + 可 undo', () => {
    const store = useProTimelineStore()
    store.reset()
    // 追加一条 video 轨(默认只有 1 video + 1 audio)
    // 使用 store.activeSequence 的响应式 sequence 直接追加会触发更新
    const seq = store.activeSequence!
    const v2 = createTrack(TrackType.VIDEO, 1, 'V2')
    seq.tracks.push(v2)
    // 此时 tracks = [Video 1, Audio 1, V2]
    const initialOrder = store.tracks.map((t) => t.name)
    expect(initialOrder).toEqual(['Video 1', 'Audio 1', 'V2'])

    // 把 V2(index 2)移到 Video 1(index 0)之前
    const fromId = v2.id
    const toId = store.tracks[0].id // Video 1
    store.reorderTrack(fromId, toId)

    // 期望 [V2, Video 1, Audio 1]
    expect(store.tracks[0].name).toBe('V2')
    expect(store.tracks[1].name).toBe('Video 1')
    expect(store.tracks[2].name).toBe('Audio 1')

    store.undo()
    expect(store.tracks.map((t) => t.name)).toEqual(initialOrder)
  })

  it('reorderTrack fromId === toId 无操作', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const initialOrder = store.tracks.map((t) => t.name)

    store.reorderTrack(trackId, trackId)
    expect(store.tracks.map((t) => t.name)).toEqual(initialOrder)
  })

  it('多步操作 history 累积(undo / redo 链路完整)', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id

    store.renameTrack(trackId, '步骤1')
    store.resizeTrack(trackId, 100)
    store.setTrackColor(trackId, '#111111')

    expect(store.tracks[0].name).toBe('步骤1')
    expect(store.tracks[0].height).toBe(100)
    expect(store.tracks[0].color).toBe('#111111')

    store.undo() // 撤销 setTrackColor
    expect(store.tracks[0].color).not.toBe('#111111')
    expect(store.tracks[0].name).toBe('步骤1')
    expect(store.tracks[0].height).toBe(100)

    store.undo() // 撤销 resizeTrack
    expect(store.tracks[0].height).not.toBe(100)
    expect(store.tracks[0].name).toBe('步骤1')

    store.undo() // 撤销 renameTrack
    expect(store.tracks[0].name).toBe('Video 1')

    store.redo()
    expect(store.tracks[0].name).toBe('步骤1')
  })
})
