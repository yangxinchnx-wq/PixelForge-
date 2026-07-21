/**
 * Step 31.4 单元测试 — Clip 高级编辑(多选 + 复制粘贴 + 群组 + 属性修改)。
 *
 * 覆盖:
 * - M:  Clip 模型扩展(groupId + setter)
 * - S:  selectionStore(replace/toggle/add/range + marquee)
 * - C:  clipboard(copyToClipboard + pasteFromClipboard)
 * - I:  Store 集成(copyClips/pasteClips/deleteClips/moveClips/duplicateClips/groupClips/ungroupClips/updateClipProperty)
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  createClip,
  setClipGroupId,
  setClipLabel,
  setClipSpeed,
  setClipVolume,
  setClipEnabled,
  setClipLocked,
  setClipTransform,
  genGroupId,
} from '@/editor/timeline/core/clip'
import { seconds, ZERO } from '@/editor/timeline/core/time'
import {
  copyToClipboard,
  pasteFromClipboard,
  isClipboardEmpty,
  getClipboardSize,
  clearClipboard,
  getClipboardSpan,
} from '@/editor/timeline/operation/clipboard'
import { useClipSelectionStore } from '@/editor/timeline/store/selectionStore'
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

function makeStoreWithClips() {
  const store = useProTimelineStore()
  store.reset()
  const seq = store.activeSequence!
  // 给默认 video 轨加几个 clip
  const v1 = seq.tracks[0]
  v1.clips.push(makeClip(0, 5, 'c1'))
  v1.clips.push(makeClip(8, 4, 'c2'))
  // 默认 audio 轨加一个
  const a1 = seq.tracks[1]
  a1.clips.push(makeClip(2, 6, 'c3'))
  return store
}

// ============================================================================
// M: Clip 模型扩展(Step 31.4)
// ============================================================================

describe('M: Clip 模型扩展(Step 31.4)', () => {
  it('setClipGroupId 设置群组 ID', () => {
    const clip = makeClip(0, 5, 'c1')
    expect(clip.groupId).toBeUndefined()
    const gid = genGroupId()
    const newClip = setClipGroupId(clip, gid)
    expect(newClip.groupId).toBe(gid)
    expect(clip.groupId).toBeUndefined() // 原 clip 不变
  })

  it('setClipGroupId 传 undefined 解除群组', () => {
    const clip = makeClip(0, 5, 'c1')
    const gid = genGroupId()
    const grouped = setClipGroupId(clip, gid)
    const ungrouped = setClipGroupId(grouped, undefined)
    expect(ungrouped.groupId).toBeUndefined()
  })

  it('setClipLabel trim + 空字符串保留原 label', () => {
    const clip = makeClip(0, 5, 'c1')
    const labeled = setClipLabel(clip, '我的片段')
    expect(labeled.label).toBe('我的片段')
    const empty = setClipLabel(labeled, '   ')
    expect(empty.label).toBe('我的片段')
  })

  it('setClipSpeed clamp 到 [0.1, 10]', () => {
    const clip = makeClip(0, 5, 'c1')
    expect(setClipSpeed(clip, 0).speed).toBe(0.1)
    expect(setClipSpeed(clip, 100).speed).toBe(10)
    expect(setClipSpeed(clip, 2).speed).toBe(2)
  })

  it('setClipVolume clamp 到 [0, 1]', () => {
    const clip = makeClip(0, 5, 'c1')
    expect(setClipVolume(clip, -1).volume).toBe(0)
    expect(setClipVolume(clip, 2).volume).toBe(1)
    expect(setClipVolume(clip, 0.5).volume).toBe(0.5)
  })

  it('setClipEnabled / setClipLocked 切换状态', () => {
    const clip = makeClip(0, 5, 'c1')
    expect(clip.enabled).toBe(true)
    expect(clip.locked).toBe(false)
    expect(setClipEnabled(clip, false).enabled).toBe(false)
    expect(setClipLocked(clip, true).locked).toBe(true)
  })

  it('setClipTransform 部分更新', () => {
    const clip = makeClip(0, 5, 'c1')
    expect(clip.transform.x).toBe(0)
    expect(clip.transform.opacity).toBe(1)
    const newClip = setClipTransform(clip, { x: 100, opacity: 0.5 })
    expect(newClip.transform.x).toBe(100)
    expect(newClip.transform.opacity).toBe(0.5)
    expect(newClip.transform.y).toBe(0) // 未修改字段保持
    expect(newClip.transform.scale).toBe(1)
  })

  it('genGroupId 生成唯一 ID', () => {
    const g1 = genGroupId()
    const g2 = genGroupId()
    expect(g1).not.toBe(g2)
    expect(g1.startsWith('grp_')).toBe(true)
  })
})

// ============================================================================
// S: selectionStore(多选 + 框选)
// ============================================================================

describe('S: selectionStore(Step 31.4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('select replace 模式替换选择', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    expect(s.selectedIds).toEqual(['c1'])
    s.select('c2')
    expect(s.selectedIds).toEqual(['c2'])
    expect(s.primaryId).toBe('c2')
  })

  it('select toggle 模式切换选中', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    s.select('c2', 'toggle')
    expect(s.selectedIds.length).toBe(2)
    s.select('c1', 'toggle') // 取消 c1
    expect(s.selectedIds).toEqual(['c2'])
    expect(s.primaryId).toBe('c2') // c1 取消后,主选中切到最后 remaining
  })

  it('select add 模式追加', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    s.select('c2', 'add')
    s.select('c3', 'add')
    expect(s.selectedIds.length).toBe(3)
    expect(s.primaryId).toBe('c3')
  })

  it('selectRange 范围选择(基于有序 ID 列表)', () => {
    const s = useClipSelectionStore()
    const orderedIds = ['c1', 'c2', 'c3', 'c4', 'c5']
    s.selectRange(orderedIds, 'c2', 'c4')
    expect(s.selectedIds).toEqual(['c2', 'c3', 'c4'])
    expect(s.primaryId).toBe('c4')
  })

  it('selectRange 反向(fromIdx > toIdx)', () => {
    const s = useClipSelectionStore()
    const orderedIds = ['c1', 'c2', 'c3', 'c4', 'c5']
    s.selectRange(orderedIds, 'c4', 'c2')
    expect(s.selectedIds).toEqual(['c2', 'c3', 'c4'])
  })

  it('selectRange additive 追加到当前选择', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    const orderedIds = ['c1', 'c2', 'c3', 'c4', 'c5']
    s.selectRange(orderedIds, 'c3', 'c4', true)
    expect(s.selectedIds.length).toBe(3)
    expect(s.selectedIds).toContain('c1')
    expect(s.selectedIds).toContain('c3')
    expect(s.selectedIds).toContain('c4')
  })

  it('selectAll 全选', () => {
    const s = useClipSelectionStore()
    s.selectAll(['c1', 'c2', 'c3'])
    expect(s.selectedIds.length).toBe(3)
    expect(s.primaryId).toBe('c3')
  })

  it('invertSelection 反选', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    s.invertSelection(['c1', 'c2', 'c3'])
    expect(s.selectedIds).toEqual(['c2', 'c3'])
  })

  it('clear 清空选择', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    s.select('c2', 'add')
    s.clear()
    expect(s.hasSelection).toBe(false)
    expect(s.primaryId).toBeNull()
  })

  it('removeFromSelection 移除单个 + 主选中切换', () => {
    const s = useClipSelectionStore()
    s.selectAll(['c1', 'c2', 'c3'])
    expect(s.primaryId).toBe('c3')
    s.removeFromSelection('c3')
    expect(s.selectedIds).toEqual(['c1', 'c2'])
    expect(s.primaryId).toBe('c2') // 主选中被移除,切到末尾 remaining
  })

  it('setSelection 手动设置 + 指定 primary', () => {
    const s = useClipSelectionStore()
    s.setSelection(['c1', 'c2', 'c3'], 'c1')
    expect(s.selectedIds.length).toBe(3)
    expect(s.primaryId).toBe('c1')
  })

  it('beginMarquee + updateMarquee + endMarquee', () => {
    const s = useClipSelectionStore()
    s.beginMarquee(10, 20)
    s.updateMarquee(100, 80)
    expect(s.marqueeRect).not.toBeNull()
    expect(s.marqueeRect!.x).toBe(10)
    expect(s.marqueeRect!.y).toBe(20)
    expect(s.marqueeRect!.width).toBe(90)
    expect(s.marqueeRect!.height).toBe(60)
    s.endMarquee(['c1', 'c2'])
    expect(s.marqueeRect).toBeNull()
    expect(s.selectedIds).toEqual(['c1', 'c2'])
  })

  it('endMarquee additive 追加', () => {
    const s = useClipSelectionStore()
    s.select('c0')
    s.beginMarquee(0, 0)
    s.endMarquee(['c1', 'c2'], true)
    expect(s.selectedIds.length).toBe(3)
  })

  it('cancelMarquee 取消框选(不应用结果)', () => {
    const s = useClipSelectionStore()
    s.beginMarquee(0, 0)
    s.cancelMarquee()
    expect(s.marqueeRect).toBeNull()
    expect(s.hasSelection).toBe(false)
  })

  it('isSelected 查询', () => {
    const s = useClipSelectionStore()
    s.select('c1')
    expect(s.isSelected('c1')).toBe(true)
    expect(s.isSelected('c2')).toBe(false)
  })

  it('isMulti getter', () => {
    const s = useClipSelectionStore()
    expect(s.isMulti).toBe(false)
    s.select('c1')
    expect(s.isMulti).toBe(false)
    s.select('c2', 'add')
    expect(s.isMulti).toBe(true)
  })
})

// ============================================================================
// C: clipboard(copyToClipboard + pasteFromClipboard)
// ============================================================================

describe('C: clipboard(Step 31.4)', () => {
  beforeEach(() => {
    clearClipboard()
  })

  it('空剪贴板状态', () => {
    expect(isClipboardEmpty()).toBe(true)
    expect(getClipboardSize()).toBe(0)
  })

  it('copyToClipboard + pasteFromClipboard 基本流程', () => {
    const c1 = makeClip(0, 5, 'c1')
    const c2 = makeClip(8, 4, 'c2')
    copyToClipboard([c1, c2], ['track-a', 'track-b'])
    expect(isClipboardEmpty()).toBe(false)
    expect(getClipboardSize()).toBe(2)

    const result = pasteFromClipboard(seconds(10))
    expect(result.clips.length).toBe(2)
    expect(result.trackIds).toEqual(['track-a', 'track-b'])
    // c1 原始 start=0,offset=0 → 粘贴到 10s
    expect(result.clips[0].timelineStart).toBe(seconds(10))
    // c2 原始 start=8,offset=8 → 粘贴到 10+8=18s
    expect(result.clips[1].timelineStart).toBe(seconds(18))
    // 新 ID
    expect(result.clips[0].id).not.toBe('c1')
    expect(result.clips[1].id).not.toBe('c2')
  })

  it('copyToClipboard 空数组清空剪贴板', () => {
    const c1 = makeClip(0, 5, 'c1')
    copyToClipboard([c1], ['track-a'])
    expect(isClipboardEmpty()).toBe(false)
    copyToClipboard([], [])
    expect(isClipboardEmpty()).toBe(true)
  })

  it('pasteFromClipboard 空剪贴板返回空数组', () => {
    const result = pasteFromClipboard(seconds(10))
    expect(result.clips).toEqual([])
    expect(result.trackIds).toEqual([])
  })

  it('getClipboardSpan 返回总时间跨度', () => {
    const c1 = makeClip(0, 5, 'c1')   // [0, 5)
    const c2 = makeClip(8, 4, 'c2')   // [8, 12)
    copyToClipboard([c1, c2], ['t1', 't2'])
    // earliest start = 0, latest end = 12 → span = 12s
    expect(getClipboardSpan()).toBe(seconds(12))
  })

  it('clearClipboard 清空', () => {
    const c1 = makeClip(0, 5, 'c1')
    copyToClipboard([c1], ['t1'])
    clearClipboard()
    expect(isClipboardEmpty()).toBe(true)
  })
})

// ============================================================================
// I: Store 集成(Step 31.4 全部新 action)
// ============================================================================

describe('I: useProTimelineStore clip actions(Step 31.4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('store 暴露 copyClips/pasteClips/deleteClips/moveClips/duplicateClips/groupClips/ungroupClips/updateClipProperty', () => {
    const store = useProTimelineStore()
    store.reset()
    expect(typeof store.copyClips).toBe('function')
    expect(typeof store.pasteClips).toBe('function')
    expect(typeof store.deleteClips).toBe('function')
    expect(typeof store.moveClips).toBe('function')
    expect(typeof store.duplicateClips).toBe('function')
    expect(typeof store.groupClips).toBe('function')
    expect(typeof store.ungroupClips).toBe('function')
    expect(typeof store.updateClipProperty).toBe('function')
    expect(typeof store.findClipTrackId).toBe('function')
    expect(typeof store.getClipsByIds).toBe('function')
  })

  it('copyClips + pasteClips 复制粘贴流程', () => {
    const store = makeStoreWithClips()
    const v1Id = store.tracks[0].id
    const c1 = store.tracks[0].clips[0]

    // 复制 c1
    store.copyClips([{ clip: c1, trackId: v1Id }])
    expect(store.isClipClipboardEmpty()).toBe(false)
    expect(store.getClipClipboardSize()).toBe(1)

    // 粘贴到 20s
    const newIds = store.pasteClips(seconds(20))
    expect(newIds.length).toBe(1)
    // 新 clip 在 v1 轨道,start=20s
    const newClip = store.tracks[0].clips.find((c) => c.id === newIds[0])
    expect(newClip).toBeDefined()
    expect(newClip!.timelineStart).toBe(seconds(20))
    expect(newClip!.id).not.toBe(c1.id)

    // undo 移除粘贴的 clip
    store.undo()
    expect(store.tracks[0].clips.find((c) => c.id === newIds[0])).toBeUndefined()
  })

  it('deleteClips 批量删除 + 可 undo', () => {
    const store = makeStoreWithClips()
    const v1 = store.tracks[0]
    const initialCount = v1.clips.length
    const ids = v1.clips.map((c) => c.id)

    store.deleteClips(ids)
    expect(v1.clips.length).toBe(0)

    store.undo()
    expect(v1.clips.length).toBe(initialCount)
  })

  it('moveClips 批量平移 + 保持相对偏移 + 可 undo', () => {
    const store = makeStoreWithClips()
    const v1 = store.tracks[0]
    const c1 = v1.clips[0] // start=0
    const c2 = v1.clips[1] // start=8
    const originalDelta = c2.timelineStart - c1.timelineStart

    store.moveClips([c1.id, c2.id], seconds(3))
    // 两个 clip 都 +3s
    expect(v1.clips[0].timelineStart).toBe(seconds(3))
    expect(v1.clips[1].timelineStart).toBe(seconds(11))
    // 相对偏移保持
    expect(v1.clips[1].timelineStart - v1.clips[0].timelineStart).toBe(originalDelta)

    store.undo()
    expect(v1.clips[0].timelineStart).toBe(seconds(0))
    expect(v1.clips[1].timelineStart).toBe(seconds(8))
  })

  it('moveClips 负位移 clamp 到 0', () => {
    const store = makeStoreWithClips()
    const v1 = store.tracks[0]
    const c1 = v1.clips[0] // start=0
    const c2 = v1.clips[1] // start=8

    // 向左移动 100s(超出范围)
    store.moveClips([c1.id, c2.id], seconds(-100))
    expect(v1.clips[0].timelineStart).toBe(ZERO) // clamp 到 0
    expect(v1.clips[1].timelineStart).toBe(ZERO) // 8 - 100 < 0 → 0
  })

  it('duplicateClips 原位复制(粘贴到原 clip 之后) + 可 undo', () => {
    const store = makeStoreWithClips()
    const v1 = store.tracks[0]
    const c1 = v1.clips[0] // start=0, dur=5
    const initialCount = v1.clips.length

    store.duplicateClips([c1.id])
    expect(v1.clips.length).toBe(initialCount + 1)
    // 新 clip 应在 c1 之后(start = c1.start + c1.duration = 5s)
    const newClip = v1.clips.find((c) => c.timelineStart === seconds(5))
    expect(newClip).toBeDefined()
    expect(newClip!.id).not.toBe(c1.id)

    store.undo()
    expect(v1.clips.length).toBe(initialCount)
  })

  it('groupClips + ungroupClips 群组化与解组', () => {
    const store = makeStoreWithClips()
    const v1 = store.tracks[0]
    const c1 = v1.clips[0]
    const c2 = v1.clips[1]

    const gid = store.groupClips([c1.id, c2.id])
    expect(gid).not.toBeNull()
    // 重新读取(因 store command 会替换 clip)
    const c1After = store.tracks[0].clips.find((c) => c.id === c1.id)!
    const c2After = store.tracks[0].clips.find((c) => c.id === c2.id)!
    expect(c1After.groupId).toBe(gid)
    expect(c2After.groupId).toBe(gid)

    // undo 群组化
    store.undo()
    const c1Undo = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(c1Undo.groupId).toBeUndefined()

    // 重新群组化 + 解组
    const gid2 = store.groupClips([c1.id, c2.id])
    expect(gid2).not.toBeNull()
    store.ungroupClips(gid2!)
    const c1Ungrp = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(c1Ungrp.groupId).toBeUndefined()

    // undo 解组(恢复 groupId)
    store.undo()
    const c1Regroup = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(c1Regroup.groupId).toBe(gid2)
  })

  it('groupClips 单个 clip 返回 null(需 >= 2)', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    const gid = store.groupClips([c1.id])
    expect(gid).toBeNull()
  })

  it('updateClipProperty 修改 label + 可 undo', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    const originalLabel = c1.label

    store.updateClipProperty(c1.id, 'label', '新标签')
    const after = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after.label).toBe('新标签')

    store.undo()
    const undoed = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(undoed.label).toBe(originalLabel)
  })

  it('updateClipProperty 修改 speed + 可 undo', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    const originalSpeed = c1.speed

    store.updateClipProperty(c1.id, 'speed', 2)
    const after = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after.speed).toBe(2)

    store.undo()
    const undoed = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(undoed.speed).toBe(originalSpeed)
  })

  it('updateClipProperty 修改 volume + 可 undo', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    store.updateClipProperty(c1.id, 'volume', 0.5)
    expect(store.tracks[0].clips.find((c) => c.id === c1.id)!.volume).toBe(0.5)
    store.undo()
    expect(store.tracks[0].clips.find((c) => c.id === c1.id)!.volume).toBe(1)
  })

  it('updateClipProperty 修改 enabled + 可 undo', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    expect(c1.enabled).toBe(true)
    store.updateClipProperty(c1.id, 'enabled', false)
    expect(store.tracks[0].clips.find((c) => c.id === c1.id)!.enabled).toBe(false)
    store.undo()
    expect(store.tracks[0].clips.find((c) => c.id === c1.id)!.enabled).toBe(true)
  })

  it('updateClipProperty 修改 transform + 可 undo', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    store.updateClipProperty(c1.id, 'transform', { x: 100, opacity: 0.5 })
    const after = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after.transform.x).toBe(100)
    expect(after.transform.opacity).toBe(0.5)
    expect(after.transform.y).toBe(0) // 未修改字段保持
    store.undo()
    const undoed = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(undoed.transform.x).toBe(0)
    expect(undoed.transform.opacity).toBe(1)
  })

  it('findClipTrackId 查找 clip 所属 trackId', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    const v1Id = store.tracks[0].id
    expect(store.findClipTrackId(c1.id)).toBe(v1Id)
    expect(store.findClipTrackId('nonexistent')).toBeNull()
  })

  it('getClipsByIds 批量查找', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]
    const c3 = store.tracks[1].clips[0] // audio 轨
    const result = store.getClipsByIds([c1.id, c3.id])
    expect(result.length).toBe(2)
    expect(result[0].clip.id).toBe(c1.id)
    expect(result[1].clip.id).toBe(c3.id)
    expect(result[0].trackId).toBe(store.tracks[0].id)
    expect(result[1].trackId).toBe(store.tracks[1].id)
  })

  it('多步操作 history 累积(undo / redo 链路完整)', () => {
    const store = makeStoreWithClips()
    const c1 = store.tracks[0].clips[0]

    store.updateClipProperty(c1.id, 'label', '步骤1')
    store.updateClipProperty(c1.id, 'speed', 2)
    store.updateClipProperty(c1.id, 'volume', 0.5)

    const after1 = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after1.label).toBe('步骤1')
    expect(after1.speed).toBe(2)
    expect(after1.volume).toBe(0.5)

    store.undo() // 撤销 volume
    const after2 = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after2.volume).toBe(1)
    expect(after2.speed).toBe(2)
    expect(after2.label).toBe('步骤1')

    store.undo() // 撤销 speed
    const after3 = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after3.speed).toBe(1)
    expect(after3.label).toBe('步骤1')

    store.undo() // 撤销 label
    const after4 = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after4.label).toBeUndefined()

    store.redo()
    const after5 = store.tracks[0].clips.find((c) => c.id === c1.id)!
    expect(after5.label).toBe('步骤1')
  })
})
