import type { Easing, Keyframe, ParameterTrack } from './types'

/**
 * 关键帧求值器 —— 给定一条参数轨道和当前帧,计算插值后的参数值。
 *
 * 支持三种缓动:
 * - linear:线性插值
 * - ease:smoothstep 缓动(两端慢、中间快)
 * - hold:保持左侧关键帧的值,直到遇到下一个关键帧才跳变
 *
 * 边界:
 * - frame 在所有关键帧之前:返回第一帧的值
 * - frame 在所有关键帧之后:返回最后一帧的值
 * - 只有一个关键帧:返回该帧的值
 * - 没有关键帧:返回 0
 */

/** smoothstep 缓动函数(用于 ease) */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** 根据 easing 计算插值因子 t(0-1) */
function applyEasing(easing: Easing, t: number): number {
  switch (easing) {
    case 'ease':   return smoothstep(t)
    case 'hold':   return 0  // hold 模式下,区间内始终用左端点值
    case 'linear':
    default:       return t
  }
}

/**
 * 在指定帧上求值单条轨道。
 *
 * @param track 参数轨道(包含关键帧列表)
 * @param frame 当前帧号
 * @returns 插值后的参数值(0-1)
 */
export function evaluateTrack(track: ParameterTrack, frame: number): number {
  const keys = track.keyframes
  if (keys.length === 0) return 0
  if (keys.length === 1) return keys[0].value

  // 已按 frame 排序的关键帧
  const sorted = [...keys].sort((a, b) => a.frame - b.frame)

  // frame 在第一帧之前
  if (frame <= sorted[0].frame) return sorted[0].value
  // frame 在最后一帧之后
  if (frame >= sorted[sorted.length - 1].frame) return sorted[sorted.length - 1].value

  // 找到包含 frame 的区间 [left, right]
  let left: Keyframe = sorted[0]
  let right: Keyframe = sorted[sorted.length - 1]
  for (let i = 0; i < sorted.length - 1; i++) {
    if (frame >= sorted[i].frame && frame <= sorted[i + 1].frame) {
      left = sorted[i]
      right = sorted[i + 1]
      break
    }
  }

  const span = right.frame - left.frame
  if (span <= 0) return left.value

  const rawT = (frame - left.frame) / span
  const t = applyEasing(left.easing, rawT)
  return left.value + (right.value - left.value) * t
}

/**
 * 批量求值:把当前帧应用到所有轨道,返回 [{ track, value }] 列表。
 * 供 player.ts 一次性生成多个 ValuePatch。
 */
export function evaluateAllTracks(
  tracks: ParameterTrack[],
  frame: number,
): Array<{ track: ParameterTrack; value: number }> {
  return tracks.map((track) => ({ track, value: evaluateTrack(track, frame) }))
}
