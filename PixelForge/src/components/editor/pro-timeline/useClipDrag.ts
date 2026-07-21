/**
 * useClipDrag(Step 31.2)— Clip 拖拽/修剪交互逻辑。
 *
 * 设计:
 * - 拖拽过程中维护"未提交"的 preview Clip(本地状态)
 * - 释放鼠标时才提交 MoveClipCommand / TrimClipCommand 到 history
 * - 实时调用 snap 系统吸附
 * - 拖拽过程不出 history(避免每次鼠标移动都产生 undo 步)
 *
 * 交互类型:
 * - 'move': 拖动 Clip 本体 → 修改 timelineStart
 * - 'trim-left': 拖动 Clip 左边缘 → 修改 timelineStart + sourceStart + duration
 * - 'trim-right': 拖动 Clip 右边缘 → 修改 duration + sourceEnd
 */
import { ref, type Ref } from 'vue'

import type { Time } from '@/editor/timeline/core/time'
import { ZERO, seconds, sub, add } from '@/editor/timeline/core/time'
import type { Clip } from '@/editor/timeline/core/clip'
import { getClipEnd } from '@/editor/timeline/core/clip'
import type { Sequence } from '@/editor/timeline/core/sequence'
import {
  collectSnapTargets,
  findSnap,
  type SnapTarget,
} from '@/editor/timeline/operation/snap'

export type DragKind = 'move' | 'trim-left' | 'trim-right'

export interface DragState {
  /** 拖拽类型 */
  kind: DragKind
  /** 原 Clip(拖拽前) */
  originalClip: Clip
  /** 所属 Track ID */
  trackId: string
  /** 拖拽起点 X(内容坐标,像素) */
  startContentX: number
  /** 当前预览 Clip(实时更新) */
  preview: Clip
  /** 当前吸附目标(若有) */
  snapTarget: SnapTarget | null
}

export interface UseClipDragResult {
  /** 当前拖拽状态(为 null 表示未拖拽) */
  dragState: Ref<DragState | null>
  /** 开始拖拽 */
  beginDrag: (params: {
    kind: DragKind
    clip: Clip
    trackId: string
    startContentX: number
  }) => void
  /**
   * 更新拖拽(鼠标移动时调用)。
   *
   * @param deltaContentX 鼠标位移(内容坐标,像素)
   * @param sequence      当前 Sequence(用于 snap 收集)
   * @param playhead      当前播放头位置(用于 snap)
   * @param snapThresholdPx 吸附阈值(像素,默认 6)
   * @param pps           pixelsPerSecond(用于阈值换算)
   * @returns 是否触发了 snap(用于 UI 高亮)
   */
  updateDrag: (
    deltaContentX: number,
    sequence: Sequence,
    playhead: Time,
    snapThresholdPx: number,
    pps: number,
  ) => boolean
  /**
   * 结束拖拽,返回最终 Clip 与操作类型(由调用方提交 command)。
   */
  endDrag: () => { kind: DragKind; clip: Clip; trackId: string } | null
  /** 取消拖拽(丢弃 preview) */
  cancelDrag: () => void
}

export function useClipDrag(): UseClipDragResult {
  const dragState = ref<DragState | null>(null)

  function beginDrag(params: {
    kind: DragKind
    clip: Clip
    trackId: string
    startContentX: number
  }): void {
    dragState.value = {
      kind: params.kind,
      originalClip: params.clip,
      trackId: params.trackId,
      startContentX: params.startContentX,
      preview: { ...params.clip, transform: { ...params.clip.transform }, effects: [...params.clip.effects] },
      snapTarget: null,
    }
  }

  function updateDrag(
    deltaContentX: number,
    sequence: Sequence,
    playhead: Time,
    snapThresholdPx: number,
    pps: number,
  ): boolean {
    if (!dragState.value) return false
    const state = dragState.value
    const original = state.originalClip
    // 像素 → 时间(微秒)
    const deltaSec = deltaContentX / pps
    const deltaUs = BigInt(Math.floor(deltaSec * 1_000_000))

    let newPreview: Clip
    let probeStart: Time
    let probeEnd: Time

    if (state.kind === 'move') {
      let newStart = add(original.timelineStart, deltaUs)
      if (newStart < 0n) newStart = ZERO
      newPreview = { ...original, timelineStart: newStart }
      probeStart = newStart
      probeEnd = getClipEnd(newPreview)
    } else if (state.kind === 'trim-left') {
      // delta 正 = 向右缩短(duration 减小)
      let newDuration = sub(original.duration, deltaUs)
      if (newDuration <= 0n) newDuration = seconds(0.05)
      let newStart = add(original.timelineStart, deltaUs)
      if (newStart < 0n) {
        newStart = ZERO
      }
      let newSourceStart = add(original.sourceStart, deltaUs)
      if (newSourceStart < 0n) {
        newSourceStart = ZERO
      }
      newPreview = {
        ...original,
        timelineStart: newStart,
        sourceStart: newSourceStart,
        duration: newDuration,
      }
      probeStart = newStart
      probeEnd = getClipEnd(newPreview)
    } else {
      // trim-right: delta 正 = 增长(duration 增大,右边缘向右);delta 负 = 缩短
      let newDuration = add(original.duration, deltaUs)
      if (newDuration <= 0n) newDuration = seconds(0.05)
      const newSourceEnd = add(original.sourceStart, newDuration)
      newPreview = {
        ...original,
        duration: newDuration,
        sourceEnd: newSourceEnd,
      }
      probeStart = newPreview.timelineStart
      probeEnd = getClipEnd(newPreview)
    }

    // 吸附阈值(像素 → 时间,微秒)
    const thresholdUs = BigInt(Math.floor((snapThresholdPx / pps) * 1_000_000))
    const targets = collectSnapTargets(sequence, playhead, [], original.id)

    // 不同拖拽类型探测不同边缘:
    // - move: 同时探测 start / end(start 优先,吸附 end 时平移 Clip)
    // - trim-left: 只探测 start(end 绝对位置不变,不应吸附)
    // - trim-right: 只探测 end(start 绝对位置不变,不应吸附)
    if (state.kind === 'trim-right') {
      const snapEnd = findSnap(probeEnd, targets, thresholdUs)
      if (snapEnd.snapped && snapEnd.target) {
        const target = snapEnd.target.time
        let newDur = sub(target, newPreview.timelineStart)
        if (newDur <= 0n) newDur = seconds(0.05)
        newPreview = {
          ...newPreview,
          duration: newDur,
          sourceEnd: add(newPreview.sourceStart, newDur),
        }
        state.snapTarget = snapEnd.target
        state.preview = newPreview
        return true
      }
      state.snapTarget = null
      state.preview = newPreview
      return false
    }

    if (state.kind === 'trim-left') {
      const snapStart = findSnap(probeStart, targets, thresholdUs)
      if (snapStart.snapped && snapStart.target) {
        const target = snapStart.target.time
        // end 绝对位置不变:duration = end - target
        const end = getClipEnd(newPreview)
        let newDur = sub(end, target)
        if (newDur <= 0n) newDur = seconds(0.05)
        const sourceDelta = sub(target, newPreview.timelineStart)
        newPreview = {
          ...newPreview,
          timelineStart: target,
          sourceStart: add(newPreview.sourceStart, sourceDelta),
          duration: newDur,
        }
        state.snapTarget = snapStart.target
        state.preview = newPreview
        return true
      }
      state.snapTarget = null
      state.preview = newPreview
      return false
    }

    // move: 先探测 start,再探测 end(吸附 end 时平移 Clip)
    const snapResult = findSnap(probeStart, targets, thresholdUs)
    if (snapResult.snapped && snapResult.target) {
      newPreview = { ...newPreview, timelineStart: snapResult.target.time }
      state.snapTarget = snapResult.target
      state.preview = newPreview
      return true
    }

    const snapEnd = findSnap(probeEnd, targets, thresholdUs)
    if (snapEnd.snapped && snapEnd.target) {
      // 用 end 吸附:平移 Clip 使 end 对齐到 target
      const target = snapEnd.target.time
      const currentEnd = getClipEnd(newPreview)
      const shift = sub(target, currentEnd)
      let newStart = add(newPreview.timelineStart, shift)
      if (newStart < 0n) newStart = ZERO
      newPreview = { ...newPreview, timelineStart: newStart }
      state.snapTarget = snapEnd.target
      state.preview = newPreview
      return true
    }

    state.snapTarget = null
    state.preview = newPreview
    return false
  }

  function endDrag(): { kind: DragKind; clip: Clip; trackId: string } | null {
    if (!dragState.value) return null
    const state = dragState.value
    dragState.value = null
    return { kind: state.kind, clip: state.preview, trackId: state.trackId }
  }

  function cancelDrag(): void {
    dragState.value = null
  }

  return {
    dragState,
    beginDrag,
    updateDrag,
    endDrag,
    cancelDrag,
  }
}
