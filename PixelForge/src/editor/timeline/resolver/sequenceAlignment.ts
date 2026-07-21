/**
 * Sequence Alignment(Step 31.7)— 多 Sequence 时间标尺对齐辅助。
 *
 * 提供跨 Sequence 的:
 * - 播放头位置对齐(切换 Sequence 时保留/映射播放头)
 * - 时间码对齐(不同 fps 的 Sequence 间帧边界对齐)
 * - 视口位置对齐(切换 Sequence 时保留滚动位置)
 * - 时间标尺刻度对齐建议(主刻度间隔统一)
 *
 * 设计:
 * - 时间用 bigint 微秒,跨 fps 无漂移
 * - 切换 Sequence 时由调用方决定是否调用对齐函数
 * - 不维护状态,纯函数
 */
import type { Time } from '../core/time'
import { ZERO, timeToFrame, frames, sub, add, clamp, max, min } from '../core/time'
import type { Sequence } from '../core/sequence'
import { getActualDuration } from '../core/sequence'

// ============================================================================
// 1. 播放头对齐
// ============================================================================

/**
 * 切换 Sequence 时映射播放头位置。
 *
 * 规则:
 * - 若 mode = 'preserve':保留原时间(钳制到目标 Sequence 时长)
 * - 若 mode = 'restart':重置为 0
 * - 若 mode = 'snap-to-frame':保留时间并对齐到目标 Sequence 的帧边界
 *
 * @param sourceTime      源 Sequence 的播放头位置
 * @param targetSequence  目标 Sequence
 * @param mode            对齐模式
 * @returns 映射后的播放头位置
 */
export type PlayheadAlignMode = 'preserve' | 'restart' | 'snap-to-frame'

export function alignPlayheadOnSwitch(
  sourceTime: Time,
  targetSequence: Sequence,
  mode: PlayheadAlignMode = 'preserve',
): Time {
  if (mode === 'restart') return ZERO

  const targetDuration = getActualDuration(targetSequence)

  if (mode === 'snap-to-frame') {
    // 对齐到目标 Sequence 的帧边界
    const frame = timeToFrame(sourceTime, targetSequence.fps)
    const snapped = frames(frame, targetSequence.fps)
    return clamp(snapped, ZERO, targetDuration)
  }

  // preserve:钳制到目标时长
  return clamp(sourceTime, ZERO, targetDuration)
}

// ============================================================================
// 2. 时间码对齐
// ============================================================================

/**
 * 把时间点对齐到指定 Sequence 的帧边界。
 *
 * @param time      原时间
 * @param sequence  目标 Sequence(提供 fps)
 * @param direction 对齐方向:'floor' / 'ceil' / 'round'(默认 round)
 */
export function snapToFrameBoundary(
  time: Time,
  sequence: Sequence,
  direction: 'floor' | 'ceil' | 'round' = 'round',
): Time {
  const fps = sequence.fps
  if (fps <= 0) return time
  const frame = timeToFrame(time, fps)
  let targetFrame: number
  if (direction === 'floor') {
    targetFrame = Math.floor(Number(time) / Number(frames(1, fps)))
  } else if (direction === 'ceil') {
    targetFrame = Math.ceil(Number(time) / Number(frames(1, fps)))
  } else {
    targetFrame = frame
  }
  return frames(targetFrame, fps)
}

// ============================================================================
// 3. 视口对齐
// ============================================================================

export interface ViewportAlignment {
  /** 切换后应设置的 scrollLeft(像素) */
  scrollLeft: number
  /** 切换后应设置的 pixelsPerSecond(像素/秒,可选) */
  pixelsPerSecond?: number
}

/**
 * 切换 Sequence 时映射视口位置。
 *
 * 规则:
 * - 保留源 Sequence 的"可视时间区间",映射到目标 Sequence 的像素坐标
 * - 若目标 Sequence 时长 < 视口区间,滚动到 0 并缩小 pixelsPerSecond
 *
 * @param sourceViewportStart  源 Sequence 视口起始时间
 * @param sourceViewportEnd    源 Sequence 视口结束时间
 * @param sourcePps            源 Sequence pixelsPerSecond
 * @param targetSequence       目标 Sequence
 * @param targetPps            目标 Sequence pixelsPerSecond(可选,默认用 sourcePps)
 */
export function alignViewportOnSwitch(
  sourceViewportStart: Time,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sourceViewportEnd: Time,
  sourcePps: number,
  targetSequence: Sequence,
  targetPps?: number,
): ViewportAlignment {
  const pps = targetPps ?? sourcePps
  const targetDuration = getActualDuration(targetSequence)
  const targetDurationSec = Number(targetDuration) / 1_000_000

  // 视口区间(秒)
  const viewStartSec = Number(sourceViewportStart) / 1_000_000

  // 若目标 Sequence 时长 < 视口起始时间,说明视口完全在目标之外,重置到 0
  // pps 保持不变(目标完全可见时无需缩放)
  if (targetDurationSec < viewStartSec && targetDurationSec > 0) {
    return {
      scrollLeft: 0,
      pixelsPerSecond: pps,
    }
  }

  // 保留视口起始时间(以秒为单位映射到目标 pps)
  const scrollLeft = Math.max(0, viewStartSec * pps)
  return { scrollLeft, pixelsPerSecond: pps }
}

// ============================================================================
// 4. 主刻度对齐
// ============================================================================

export interface RulerAlignment {
  /** 推荐的主刻度间隔(秒) */
  majorStepSec: number
  /** 是否与源 Sequence 共享主刻度 */
  shared: boolean
}

/**
 * 计算多 Sequence 共享的主刻度间隔。
 *
 * 用于在 Sequence 切换时保持标尺刻度视觉一致。
 *
 * 规则:
 * - 取所有 Sequence 的"推荐主刻度"的最大公约数(向下取到候选值)
 * - 若所有 Sequence 推荐同一值,shared = true
 *
 * @param sequences  所有 Sequence
 * @param viewportWidth 视口宽度(像素)
 */
export function computeSharedMajorStep(
  sequences: Sequence[],
  viewportWidth: number,
): RulerAlignment {
  if (sequences.length === 0) {
    return { majorStepSec: 1, shared: false }
  }

  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600]
  const steps = sequences.map((seq) => {
    // 假设每个 Sequence 共享同一 pps(由调用方保证)
    // 简化:用 sequence.duration 估算可见区间
    const visibleSec = viewportWidth > 0
      ? viewportWidth / 50 // 假设默认 pps = 50
      : Number(seq.duration) / 1_000_000
    for (const c of candidates) {
      if (visibleSec / c <= 10) return c
    }
    return 600
  })

  // 取最大值(刻度更稀疏,保证所有 Sequence 都能显示)
  const shared = new Set(steps).size === 1
  const majorStepSec = Math.max(...steps)
  return { majorStepSec, shared }
}

// ============================================================================
// 5. Sequence 时间区间比较
// ============================================================================

/**
 * 比较两个 Sequence 的时间区间是否重叠(基于实际时长)。
 *
 * 用于判断两个 Sequence 在时间轴上是否有交集
 * (例如渲染队列调度、嵌套 Sequence 时间映射)。
 */
export function sequencesTimeOverlap(a: Sequence, b: Sequence): boolean {
  const aDur = getActualDuration(a)
  const bDur = getActualDuration(b)
  // Sequence 起始都是 0,所以只要时长都 > 0 就算重叠
  return aDur > ZERO && bDur > ZERO
}

/**
 * 计算 Sequence 的"有效时间区间"[0, actualDuration]。
 */
export function getSequenceEffectiveRange(sequence: Sequence): { start: Time; end: Time } {
  const dur = getActualDuration(sequence)
  return { start: ZERO, end: dur }
}

// ============================================================================
// 6. 多 Sequence 时间偏移
// ============================================================================

/**
 * 把目标 Sequence 的时间点偏移 offsetUs(用于嵌套 Sequence 在父 Sequence 中的定位)。
 *
 * @param innerTime  内层 Sequence 的时间
 * @param offsetUs   偏移量(微秒)
 * @returns 偏移后的时间
 */
export function offsetInnerTimeToOuter(innerTime: Time, offsetUs: Time): Time {
  return add(innerTime, offsetUs)
}

/**
 * 把外层 Sequence 的时间点反向偏移到内层 Sequence(用于嵌套 Sequence 的反向映射)。
 *
 * @param outerTime  外层 Sequence 的时间
 * @param offsetUs   偏移量(微秒)
 * @returns 内层 Sequence 的时间(钳制到 >= 0)
 */
export function offsetOuterTimeToInner(outerTime: Time, offsetUs: Time): Time {
  return max(ZERO, sub(outerTime, offsetUs))
}

/** 工具:取两个 Time 的较大值 */
export function maxTime(a: Time, b: Time): Time {
  return max(a, b)
}

/** 工具:取两个 Time 的较小值 */
export function minTime(a: Time, b: Time): Time {
  return min(a, b)
}
