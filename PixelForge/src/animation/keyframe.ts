/**
 * Keyframe 工具(Step 29.4)— 关键帧的创建 / 排序 / 查找。
 *
 * 职责:
 * - createKeyframe:    创建关键帧(自动填充默认 cp1/cp2)
 * - sortKeyframes:     按 time 升序排序(返回新数组)
 * - findKeyframeAt:    精确查找指定时间的关键帧
 * - findSurrounding:   找到包含 time 的 [k1, k2] 区间
 * - insertKeyframe:    插入关键帧(自动保持排序)
 * - removeKeyframe:    按 id 删除关键帧
 * - updateKeyframe:    更新关键帧的 time/value(自动重新排序)
 */

import type { Keyframe } from './types'
import { DEFAULT_BEZIER_CP1, DEFAULT_BEZIER_CP2, genAnimId } from './types'

// ============================================================================
// 1. 创建关键帧
// ============================================================================

/**
 * 创建关键帧。
 *
 * - interpolation 为 'bezier' 时自动填充默认 cp1/cp2
 * - 其他插值方式 cp1/cp2 为 undefined
 *
 * @param time          时间(秒)
 * @param value         值
 * @param interpolation 插值方式(默认 'linear')
 * @param id            可选 id(不传则自动生成)
 */
export function createKeyframe(
  time: number,
  value: number,
  interpolation: Keyframe['interpolation'] = 'linear',
  id?: string,
): Keyframe {
  const kf: Keyframe = {
    id: id ?? genAnimId('kf'),
    time,
    value,
    interpolation,
  }
  if (interpolation === 'bezier') {
    kf.cp1 = { ...DEFAULT_BEZIER_CP1 }
    kf.cp2 = { ...DEFAULT_BEZIER_CP2 }
  }
  return kf
}

// ============================================================================
// 2. 排序
// ============================================================================

/**
 * 按 time 升序排序(返回新数组,不修改原数组)。
 */
export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time)
}

// ============================================================================
// 3. 查找
// ============================================================================

/**
 * 精确查找指定时间的关键帧(允许容差,默认 0.001 秒)。
 */
export function findKeyframeAt(
  keyframes: Keyframe[],
  time: number,
  tolerance: number = 0.001,
): Keyframe | undefined {
  return keyframes.find((k) => Math.abs(k.time - time) < tolerance)
}

/**
 * 按 id 查找关键帧。
 */
export function findKeyframeById(
  keyframes: Keyframe[],
  id: string,
): Keyframe | undefined {
  return keyframes.find((k) => k.id === id)
}

/**
 * 找到包含 time 的关键帧区间 [k1, k2]。
 *
 * - time 在第一个关键帧之前:返回 [undefined, first]
 * - time 在最后一个关键帧之后:返回 [last, undefined]
 * - time 在两个关键帧之间:返回 [k1, k2]
 * - 只有一个关键帧:返回 [kf, undefined] 或 [undefined, kf] 取决于 time
 * - 无关键帧:返回 [undefined, undefined]
 *
 * 注:假设 keyframes 已按 time 升序排序(调用 sortKeyframes 后)。
 */
export function findSurrounding(
  keyframes: Keyframe[],
  time: number,
): { k1: Keyframe | undefined; k2: Keyframe | undefined } {
  if (keyframes.length === 0) {
    return { k1: undefined, k2: undefined }
  }
  if (keyframes.length === 1) {
    return time <= keyframes[0].time
      ? { k1: undefined, k2: keyframes[0] }
      : { k1: keyframes[0], k2: undefined }
  }

  // time 在第一个之前
  if (time <= keyframes[0].time) {
    return { k1: undefined, k2: keyframes[0] }
  }
  // time 在最后一个之后
  if (time >= keyframes[keyframes.length - 1].time) {
    return { k1: keyframes[keyframes.length - 1], k2: undefined }
  }

  // 二分查找区间
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
      return { k1: keyframes[i], k2: keyframes[i + 1] }
    }
  }

  // 不应到达
  return { k1: keyframes[0], k2: keyframes[keyframes.length - 1] }
}

// ============================================================================
// 4. 增删改
// ============================================================================

/**
 * 插入关键帧(自动保持排序,返回新数组)。
 *
 * 若同一时间已有关键帧(容差 0.001),则更新其值。
 */
export function insertKeyframe(
  keyframes: Keyframe[],
  kf: Keyframe,
): Keyframe[] {
  const existing = findKeyframeAt(keyframes, kf.time)
  if (existing) {
    return keyframes.map((k) => (k.id === existing.id ? { ...kf, id: existing.id } : k))
  }
  const result = [...keyframes, kf]
  result.sort((a, b) => a.time - b.time)
  return result
}

/**
 * 按 id 删除关键帧(返回新数组)。
 */
export function removeKeyframe(
  keyframes: Keyframe[],
  id: string,
): Keyframe[] {
  return keyframes.filter((k) => k.id !== id)
}

/**
 * 更新关键帧的 time / value / interpolation(返回新数组,自动重新排序)。
 */
export function updateKeyframe(
  keyframes: Keyframe[],
  id: string,
  updates: Partial<Pick<Keyframe, 'time' | 'value' | 'interpolation' | 'cp1' | 'cp2'>>,
): Keyframe[] {
  const result = keyframes.map((k) =>
    k.id === id ? { ...k, ...updates } : k,
  )
  result.sort((a, b) => a.time - b.time)
  return result
}

// ============================================================================
// 5. 统计
// ============================================================================

/**
 * 获取关键帧列表的时间范围 [minTime, maxTime]。
 *
 * 空列表返回 [0, 0]。
 */
export function getKeyframeRange(
  keyframes: Keyframe[],
): { min: number; max: number } {
  if (keyframes.length === 0) return { min: 0, max: 0 }
  let min = Infinity
  let max = -Infinity
  for (const kf of keyframes) {
    if (kf.time < min) min = kf.time
    if (kf.time > max) max = kf.time
  }
  return { min, max }
}

/**
 * 获取关键帧列表的值范围 [minValue, maxValue]。
 *
 * 空列表返回 [0, 1]。
 */
export function getValueRange(
  keyframes: Keyframe[],
): { min: number; max: number } {
  if (keyframes.length === 0) return { min: 0, max: 1 }
  let min = Infinity
  let max = -Infinity
  for (const kf of keyframes) {
    if (kf.value < min) min = kf.value
    if (kf.value > max) max = kf.value
  }
  return { min, max }
}
