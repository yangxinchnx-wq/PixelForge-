/**
 * useProTimelineLayout(Step 31.2)— 时间轴布局坐标系。
 *
 * 职责:
 * - 持有 pixelsPerSecond(缩放)与 scrollLeft(滚动)状态
 * - 提供 time ↔ pixel 互转函数
 * - 提供 Ctrl+滚轮缩放逻辑(以鼠标为锚点)
 *
 * 坐标约定:
 * - 时间 0 → pixel 0(轨道条左边缘)
 * - pixel = time_seconds * pixelsPerSecond - scrollLeft
 * - 时间 = (pixel + scrollLeft) / pixelsPerSecond
 *
 * 与 AnimationRuler 不同:
 * - 这里基于 bigint 微秒,不是 float 秒
 * - 支持缩放,不是固定百分比
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'

import type { Time } from '@/editor/timeline/core/time'
import { toSeconds } from '@/editor/timeline/core/time'

export interface ProTimelineLayout {
  /** 每秒像素数(横向缩放) */
  pixelsPerSecond: Ref<number>
  /** 当前滚动位置(像素) */
  scrollLeft: Ref<number>
  /** 视口宽度(像素) */
  viewportWidth: Ref<number>
  /** 总时长(秒,用于计算内容宽度) */
  durationSec: Ref<number>
  /** 内容总宽度(像素) */
  contentWidth: ComputedRef<number>
  /** 时间 → 视口内 X 像素(相对当前可见区) */
  timeToViewportX: (t: Time) => number
  /** 时间 → 内容绝对 X 像素(相对内容左边缘,不受滚动影响) */
  timeToContentX: (t: Time) => number
  /** 视口内 X 像素 → 时间(自动加 scrollLeft) */
  viewportXToTime: (x: number) => Time
  /** 内容绝对 X 像素 → 时间 */
  contentXToTime: (x: number) => Time
  /** 设置缩放(以指定内容 X 为锚点保持位置) */
  zoomAt: (newPps: number, anchorContentX: number) => void
  /** 设置缩放(以视口中点为锚点) */
  zoomCentered: (newPps: number) => void
}

/** 预设缩放级别(每秒像素数) */
export const ZOOM_PRESETS: number[] = [10, 20, 30, 50, 80, 120, 200, 300, 500]

/** 默认缩放 */
export const DEFAULT_PPS = 50

/** 最小缩放 */
export const MIN_PPS = 5

/** 最大缩放 */
export const MAX_PPS = 2000

export function useProTimelineLayout(
  initialPps: number = DEFAULT_PPS,
): ProTimelineLayout {
  const pixelsPerSecond = ref(initialPps)
  const scrollLeft = ref(0)
  const viewportWidth = ref(800)
  const durationSec = ref(0)

  const contentWidth = computed(() => Math.ceil(durationSec.value * pixelsPerSecond.value))

  function timeToContentX(t: Time): number {
    return Number(toSeconds(t)) * pixelsPerSecond.value
  }

  function timeToViewportX(t: Time): number {
    return timeToContentX(t) - scrollLeft.value
  }

  function contentXToTime(x: number): Time {
    const sec = x / pixelsPerSecond.value
    // 用 bigint 微秒精度(向下取整)
    return BigInt(Math.floor(sec * 1_000_000))
  }

  function viewportXToTime(x: number): Time {
    return contentXToTime(x + scrollLeft.value)
  }

  /**
   * 以指定内容 X 为锚点缩放:
   * - 锚点对应的时间在缩放前后应位于同一视口位置
   * - 公式: newScrollLeft = anchorContentX_new - anchorViewportX
   *   其中 anchorViewportX = anchorContentX_old - scrollLeft_old
   *   anchorContentX_new = anchorTime * newPps
   */
  function zoomAt(newPps: number, anchorContentX: number): void {
    const clamped = Math.max(MIN_PPS, Math.min(MAX_PPS, newPps))
    const oldPps = pixelsPerSecond.value
    const anchorTimeSec = anchorContentX / oldPps
    const anchorViewportX = anchorContentX - scrollLeft.value
    const newScrollLeft = anchorTimeSec * clamped - anchorViewportX
    pixelsPerSecond.value = clamped
    scrollLeft.value = Math.max(0, newScrollLeft)
  }

  function zoomCentered(newPps: number): void {
    const centerContentX = scrollLeft.value + viewportWidth.value / 2
    zoomAt(newPps, centerContentX)
  }

  return {
    pixelsPerSecond,
    scrollLeft,
    viewportWidth,
    durationSec,
    contentWidth,
    timeToViewportX,
    timeToContentX,
    viewportXToTime,
    contentXToTime,
    zoomAt,
    zoomCentered,
  }
}
