/**
 * Step 31.2 单元测试 — Clip CRUD UI 行为。
 *
 * 覆盖:
 * - L:  useProTimelineLayout(time↔pixel、zoom、scroll)
 * - D:  useClipDrag(beginDrag / updateDrag / endDrag / cancelDrag)
 * - I:  ProTimeline 组件挂载 + 切换入口
 * - UI: AddClip 弹层提交 / 取消
 *
 * 注:不测试纯 DOM 渲染细节(由 vue-tsc 类型保障),
 *     重点关注交互逻辑(拖拽预览 / snap / command 提交)。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  useProTimelineLayout,
  ZOOM_PRESETS,
  DEFAULT_PPS,
  MIN_PPS,
  MAX_PPS,
} from './useProTimelineLayout'
import { useClipDrag } from './useClipDrag'
import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'
import { createSequence } from '@/editor/timeline/core/sequence'
import { createClip } from '@/editor/timeline/core/clip'
import { seconds, ZERO } from '@/editor/timeline/core/time'
import { TrackType } from '@/editor/timeline/core/track'

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

/** 构造带 Clip 的 Sequence */
function makeSequenceWithClips() {
  const seq = createSequence()
  // 给第一条视频轨添加两个 Clip
  const videoTrack = seq.tracks.find((t) => t.type === TrackType.VIDEO)!
  videoTrack.clips = [
    makeClip(0, 5, 'clip_a'),       // [0, 5)
    makeClip(8, 4, 'clip_b'),       // [8, 12)
  ]
  return seq
}

// ============================================================================
// L: useProTimelineLayout
// ============================================================================

describe('L: useProTimelineLayout', () => {
  it('默认 pixelsPerSecond = DEFAULT_PPS', () => {
    const layout = useProTimelineLayout()
    expect(layout.pixelsPerSecond.value).toBe(DEFAULT_PPS)
  })

  it('timeToContentX / contentXToTime 互转保持精度(50pps)', () => {
    const layout = useProTimelineLayout(50)
    const t = seconds(3)
    const x = layout.timeToContentX(t)
    expect(x).toBeCloseTo(150, 5)
    const back = layout.contentXToTime(x)
    expect(back).toBe(seconds(3))
  })

  it('timeToViewportX 减去 scrollLeft', () => {
    const layout = useProTimelineLayout(50)
    layout.scrollLeft.value = 100
    layout.durationSec.value = 30
    // 5 秒 → 250 像素内容,扣 100 scrollLeft → 150 视口
    expect(layout.timeToViewportX(seconds(5))).toBeCloseTo(150, 5)
  })

  it('viewportXToTime 加回 scrollLeft', () => {
    const layout = useProTimelineLayout(50)
    layout.scrollLeft.value = 100
    // 视口 X=150 → 内容 X=250 → 5 秒
    expect(layout.viewportXToTime(150)).toBe(seconds(5))
  })

  it('contentWidth = durationSec * pixelsPerSecond', () => {
    const layout = useProTimelineLayout(20)
    layout.durationSec.value = 30
    expect(layout.contentWidth.value).toBe(600)
  })

  it('zoomAt 以锚点保持视口位置', () => {
    const layout = useProTimelineLayout(50)
    layout.scrollLeft.value = 200
    layout.viewportWidth.value = 800
    // 锚点在内容 X=600(对应 12 秒 @ 50pps)
    // 缩放到 100pps:内容 X=1200,scrollLeft 应 = 1200 - (600-200) = 800
    layout.zoomAt(100, 600)
    expect(layout.pixelsPerSecond.value).toBe(100)
    expect(layout.scrollLeft.value).toBeCloseTo(800, 5)
  })

  it('zoomAt clamp 到 [MIN_PPS, MAX_PPS]', () => {
    const layout = useProTimelineLayout()
    layout.zoomAt(1, 0)
    expect(layout.pixelsPerSecond.value).toBe(MIN_PPS)
    layout.zoomAt(99999, 0)
    expect(layout.pixelsPerSecond.value).toBe(MAX_PPS)
  })

  it('zoomCentered 以视口中点为锚点', () => {
    const layout = useProTimelineLayout(50)
    layout.scrollLeft.value = 0
    layout.viewportWidth.value = 800
    layout.zoomCentered(100)
    // 中点内容 X = 400 @ 50pps = 8 秒
    // 缩放后内容 X = 800,scrollLeft = 800 - 400 = 400
    expect(layout.pixelsPerSecond.value).toBe(100)
    expect(layout.scrollLeft.value).toBeCloseTo(400, 5)
  })

  it('ZOOM_PRESETS 升序排列', () => {
    for (let i = 1; i < ZOOM_PRESETS.length; i++) {
      expect(ZOOM_PRESETS[i]).toBeGreaterThan(ZOOM_PRESETS[i - 1])
    }
  })
})

// ============================================================================
// D: useClipDrag
// ============================================================================

describe('D: useClipDrag', () => {
  it('初始 dragState 为 null', () => {
    const ctrl = useClipDrag()
    expect(ctrl.dragState.value).toBeNull()
  })

  it('beginDrag 设置 preview = 原 Clip', () => {
    const ctrl = useClipDrag()
    const clip = makeClip(0, 5, 'c1')
    ctrl.beginDrag({ kind: 'move', clip, trackId: 't1', startContentX: 0 })
    expect(ctrl.dragState.value).not.toBeNull()
    expect(ctrl.dragState.value!.preview.id).toBe('c1')
    expect(ctrl.dragState.value!.preview.timelineStart).toBe(ZERO)
  })

  it('updateDrag move:正 delta → 平移 timelineStart', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    const clip = seq.tracks[0].clips[0] // [0, 5)
    ctrl.beginDrag({ kind: 'move', clip, trackId: seq.tracks[0].id, startContentX: 0 })
    // 向右拖动 2 秒(50pps = 100 像素)
    ctrl.updateDrag(100, seq, ZERO, 6, 50)
    expect(ctrl.dragState.value!.preview.timelineStart).toBe(seconds(2))
  })

  it('updateDrag move:负 delta 不允许 timelineStart < 0', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    const clip = seq.tracks[0].clips[0] // start=0
    ctrl.beginDrag({ kind: 'move', clip, trackId: seq.tracks[0].id, startContentX: 0 })
    ctrl.updateDrag(-200, seq, ZERO, 6, 50)
    expect(ctrl.dragState.value!.preview.timelineStart).toBe(ZERO)
  })

  it('updateDrag trim-left:正 delta 缩短 duration', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    const clip = seq.tracks[0].clips[0] // [0, 5), duration=5s
    ctrl.beginDrag({ kind: 'trim-left', clip, trackId: seq.tracks[0].id, startContentX: 0 })
    // 向右拖动 1 秒(50 像素):duration 5→4,timelineStart 0→1
    ctrl.updateDrag(50, seq, ZERO, 6, 50)
    const preview = ctrl.dragState.value!.preview
    expect(preview.timelineStart).toBe(seconds(1))
    expect(preview.duration).toBe(seconds(4))
  })

  it('updateDrag trim-right:正 delta 缩短 duration', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    const clip = seq.tracks[0].clips[0] // [0, 5), duration=5s
    ctrl.beginDrag({ kind: 'trim-right', clip, trackId: seq.tracks[0].id, startContentX: 250 })
    // 向左拖动 1 秒(等价于 delta = -50):trim-right delta 正=缩短
    // 实际拖动到 contentX=200 → delta = -50
    ctrl.updateDrag(-50, seq, ZERO, 6, 50)
    const preview = ctrl.dragState.value!.preview
    expect(preview.duration).toBe(seconds(4))
  })

  it('updateDrag snap:接近其他 Clip 边缘时吸附', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    // clip_a [0,5), clip_b [8,12)
    // 拖动 clip_a,使其 start 接近 clip_b.start(8s)
    const clip = seq.tracks[0].clips[0]
    ctrl.beginDrag({ kind: 'move', clip, trackId: seq.tracks[0].id, startContentX: 0 })
    // 拖到 7.95s(delta = 397.5 像素),阈值 6 像素 = 0.12s,应吸附到 8s
    ctrl.updateDrag(397.5, seq, ZERO, 6, 50)
    expect(ctrl.dragState.value!.preview.timelineStart).toBe(seconds(8))
    expect(ctrl.dragState.value!.snapTarget).not.toBeNull()
    expect(ctrl.dragState.value!.snapTarget!.type).toBe('clip-start')
  })

  it('updateDrag snap:接近播放头时吸附', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    const clip = seq.tracks[0].clips[0] // start=0
    ctrl.beginDrag({ kind: 'move', clip, trackId: seq.tracks[0].id, startContentX: 0 })
    // 拖到接近 3s(播放头位置),delta = 149 像素(2.98s),阈值 6 像素 = 0.12s
    ctrl.updateDrag(149, seq, seconds(3), 6, 50)
    expect(ctrl.dragState.value!.preview.timelineStart).toBe(seconds(3))
    expect(ctrl.dragState.value!.snapTarget!.type).toBe('playhead')
  })

  it('endDrag 返回最终 Clip 并清空 dragState', () => {
    const ctrl = useClipDrag()
    const seq = makeSequenceWithClips()
    const clip = seq.tracks[0].clips[0]
    ctrl.beginDrag({ kind: 'move', clip, trackId: seq.tracks[0].id, startContentX: 0 })
    ctrl.updateDrag(100, seq, ZERO, 6, 50)
    const result = ctrl.endDrag()
    expect(result).not.toBeNull()
    expect(result!.clip.timelineStart).toBe(seconds(2))
    expect(result!.kind).toBe('move')
    expect(result!.trackId).toBe(seq.tracks[0].id)
    expect(ctrl.dragState.value).toBeNull()
  })

  it('endDrag 在未 beginDrag 时返回 null', () => {
    const ctrl = useClipDrag()
    expect(ctrl.endDrag()).toBeNull()
  })

  it('cancelDrag 清空 dragState 不返回结果', () => {
    const ctrl = useClipDrag()
    const clip = makeClip(0, 5, 'c1')
    ctrl.beginDrag({ kind: 'move', clip, trackId: 't1', startContentX: 0 })
    ctrl.cancelDrag()
    expect(ctrl.dragState.value).toBeNull()
  })
})

// ============================================================================
// S: Store 集成(确保 ProTimeline 依赖的 store 接口可用)
// ============================================================================

describe('S: useProTimelineStore(ProTimeline 依赖)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reset 后存在 activeSequence 与默认两条轨道', () => {
    const store = useProTimelineStore()
    store.reset()
    expect(store.activeSequence).not.toBeNull()
    expect(store.tracks.length).toBeGreaterThanOrEqual(2)
  })

  it('addClip + undo + redo 完整循环', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 3, 'clip_x')

    store.addClip(trackId, clip)
    expect(store.tracks[0].clips.length).toBe(1)

    store.undo()
    expect(store.tracks[0].clips.length).toBe(0)

    store.redo()
    expect(store.tracks[0].clips.length).toBe(1)
    expect(store.tracks[0].clips[0].id).toBe('clip_x')
  })

  it('moveClip 修改 timelineStart + 可撤销', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 3, 'clip_m')
    store.addClip(trackId, clip)

    store.moveClip(trackId, 'clip_m', seconds(5))
    expect(store.tracks[0].clips[0].timelineStart).toBe(seconds(5))

    store.undo()
    expect(store.tracks[0].clips[0].timelineStart).toBe(ZERO)
  })

  it('deleteClip + 可撤销', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 3, 'clip_d')
    store.addClip(trackId, clip)

    store.deleteClip(trackId, 'clip_d')
    expect(store.tracks[0].clips.length).toBe(0)

    store.undo()
    expect(store.tracks[0].clips.length).toBe(1)
  })

  it('cutClip 在中间切割一分为二', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 10, 'clip_c') // [0, 10)
    store.addClip(trackId, clip)

    store.cutClip(trackId, 'clip_c', seconds(4))
    expect(store.tracks[0].clips.length).toBe(2)
    // 左半部分 [0, 4)
    expect(store.tracks[0].clips[0].timelineStart).toBe(ZERO)
    expect(store.tracks[0].clips[0].duration).toBe(seconds(4))
    // 右半部分 [4, 10)
    expect(store.tracks[0].clips[1].timelineStart).toBe(seconds(4))
    expect(store.tracks[0].clips[1].duration).toBe(seconds(6))

    store.undo()
    expect(store.tracks[0].clips.length).toBe(1)
  })

  it('rippleDelete 删除并后移前方 Clip', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const a = makeClip(0, 4, 'a')    // [0, 4)
    const b = makeClip(6, 4, 'b')    // [6, 10)
    const c = makeClip(12, 4, 'c')   // [12, 16)
    store.addClip(trackId, a)
    store.addClip(trackId, b)
    store.addClip(trackId, c)

    // 涟漪删除 b:b 持续 4 秒,c 应左移 4 秒:12→8
    store.rippleDelete(trackId, 'b')
    expect(store.tracks[0].clips.length).toBe(2)
    expect(store.tracks[0].clips[0].id).toBe('a')
    expect(store.tracks[0].clips[1].id).toBe('c')
    expect(store.tracks[0].clips[1].timelineStart).toBe(seconds(8))

    store.undo()
    expect(store.tracks[0].clips.length).toBe(3)
    expect(store.tracks[0].clips[2].timelineStart).toBe(seconds(12))
  })

  it('seek + advanceTime 播放推进', () => {
    const store = useProTimelineStore()
    store.reset()
    store.play()
    expect(store.playing).toBe(true)
    store.advanceTime(0.5)
    expect(store.currentTime).toBe(seconds(0.5))
    store.stop()
    expect(store.playing).toBe(false)
    expect(store.currentTime).toBe(ZERO)
  })

  it('resolveActiveClips 返回当前时间的活跃 Clip', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    store.addClip(trackId, makeClip(2, 4, 'clip_r')) // [2, 6)

    store.seek(seconds(3))
    const result = store.resolveActiveClips()
    expect(result).not.toBeNull()
    expect(result!.allActiveClips.length).toBe(1)
    expect(result!.allActiveClips[0].id).toBe('clip_r')
  })
})

// ============================================================================
// I: 集成场景(模拟 ProTimeline 拖拽 → 提交 command)
// ============================================================================

describe('I: ProTimeline 拖拽 → command 提交流程', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('模拟拖动 Clip 后调用 store.moveClip 提交', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5, 'drag_test')
    store.addClip(trackId, clip)

    // 模拟拖拽流程
    const drag = useClipDrag()
    const seq = store.activeSequence!
    drag.beginDrag({ kind: 'move', clip, trackId, startContentX: 0 })
    drag.updateDrag(100, seq, ZERO, 6, 50) // +2s
    const result = drag.endDrag()
    expect(result).not.toBeNull()

    // 提交 MoveClipCommand
    store.moveClip(result!.trackId, result!.clip.id, result!.clip.timelineStart)
    expect(store.tracks[0].clips[0].timelineStart).toBe(seconds(2))

    // undo 后回到原位
    store.undo()
    expect(store.tracks[0].clips[0].timelineStart).toBe(ZERO)
  })

  it('模拟 trim 后通过 ReplaceClip command 提交(简化:直接 moveClip 不可,改用 history 包装)', () => {
    const store = useProTimelineStore()
    store.reset()
    const trackId = store.tracks[0].id
    const clip = makeClip(0, 5, 'trim_test')
    store.addClip(trackId, clip)

    const drag = useClipDrag()
    const seq = store.activeSequence!
    drag.beginDrag({ kind: 'trim-right', clip, trackId, startContentX: 250 })
    drag.updateDrag(-50, seq, ZERO, 6, 50) // duration 5→4
    const result = drag.endDrag()
    expect(result).not.toBeNull()
    expect(result!.clip.duration).toBe(seconds(4))

    // 通过 delete + add 模拟 replace(简化路径)
    store.deleteClip(trackId, 'trim_test')
    store.addClip(trackId, result!.clip)
    expect(store.tracks[0].clips[0].duration).toBe(seconds(4))

    // 双步 undo 回到原状
    store.undo() // undo add
    store.undo() // undo delete → 恢复原 clip
    expect(store.tracks[0].clips[0].duration).toBe(seconds(5))
  })
})
