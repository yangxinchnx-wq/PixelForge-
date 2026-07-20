/**
 * Track 工具(Step 29.3)— 动画轨道的创建与关键帧管理。
 *
 * 职责:
 * - createTrack:          创建空轨道
 * - createKeyframeTrack:  创建含初始关键帧的轨道
 * - createExpressionTrack: 创建表达式轨道
 * - addKeyframe:          向轨道添加关键帧(不可变,返回新轨道)
 * - removeKeyframe:       删除关键帧
 * - updateKeyframe:       更新关键帧
 * - clearKeyframes:       清空关键帧
 * - getTrackDuration:     获取轨道实际时长(最后一个关键帧的 time)
 */

import type { AnimationMode, AnimationTrack, Keyframe } from './types'
import { DEFAULT_TRACK_COLOR, genAnimId } from './types'
import {
  createKeyframe,
  insertKeyframe,
  removeKeyframe,
  updateKeyframe,
} from './keyframe'

// ============================================================================
// 1. 创建轨道
// ============================================================================

/**
 * 创建空轨道(无关键帧)。
 *
 * @param targetKind 目标类型(graph / material)
 * @param nodeId     绑定节点 id
 * @param property   绑定参数 key
 * @param label      显示名(可选,默认用 property)
 */
export function createTrack(
  targetKind: AnimationTrack['targetKind'],
  nodeId: string,
  property: string,
  label?: string,
): AnimationTrack {
  return {
    id: genAnimId('track'),
    label: label ?? property,
    targetKind,
    nodeId,
    property,
    mode: 'KEYFRAME',
    keyframes: [],
    expression: '',
    enabled: true,
    color: DEFAULT_TRACK_COLOR,
  }
}

/**
 * 创建含初始关键帧的轨道(起点 → 终点线性插值)。
 *
 * @param targetKind 目标类型
 * @param nodeId     节点 id
 * @param property   参数 key
 * @param startValue 起点值(t=0)
 * @param endValue   终点值(t=duration)
 * @param duration   时长(秒)
 * @param label      显示名
 */
export function createKeyframeTrack(
  targetKind: AnimationTrack['targetKind'],
  nodeId: string,
  property: string,
  startValue: number,
  endValue: number,
  duration: number,
  label?: string,
): AnimationTrack {
  const track = createTrack(targetKind, nodeId, property, label)
  track.keyframes = [
    createKeyframe(0, startValue, 'linear'),
    createKeyframe(duration, endValue, 'linear'),
  ]
  return track
}

/**
 * 创建表达式轨道。
 *
 * @param expression 表达式代码(如 "sin(time) * 0.5")
 */
export function createExpressionTrack(
  targetKind: AnimationTrack['targetKind'],
  nodeId: string,
  property: string,
  expression: string,
  label?: string,
): AnimationTrack {
  const track = createTrack(targetKind, nodeId, property, label)
  track.mode = 'EXPRESSION'
  track.expression = expression
  return track
}

// ============================================================================
// 2. 关键帧管理(不可变更新,返回新轨道)
// ============================================================================

/**
 * 向轨道添加关键帧(若同时刻已存在则更新)。
 */
export function addKeyframe(track: AnimationTrack, kf: Keyframe): AnimationTrack {
  return {
    ...track,
    keyframes: insertKeyframe(track.keyframes, kf),
  }
}

/**
 * 在指定时间添加关键帧(便捷方法)。
 */
export function addKeyframeAt(
  track: AnimationTrack,
  time: number,
  value: number,
  interpolation: Keyframe['interpolation'] = 'linear',
): AnimationTrack {
  return addKeyframe(track, createKeyframe(time, value, interpolation))
}

/**
 * 按 id 删除关键帧。
 */
export function removeKeyframeFromTrack(
  track: AnimationTrack,
  keyframeId: string,
): AnimationTrack {
  return {
    ...track,
    keyframes: removeKeyframe(track.keyframes, keyframeId),
  }
}

/**
 * 更新关键帧。
 */
export function updateKeyframeInTrack(
  track: AnimationTrack,
  keyframeId: string,
  updates: Partial<Pick<Keyframe, 'time' | 'value' | 'interpolation' | 'cp1' | 'cp2'>>,
): AnimationTrack {
  return {
    ...track,
    keyframes: updateKeyframe(track.keyframes, keyframeId, updates),
  }
}

/**
 * 清空关键帧。
 */
export function clearKeyframes(track: AnimationTrack): AnimationTrack {
  return { ...track, keyframes: [] }
}

// ============================================================================
// 3. 轨道属性
// ============================================================================

/**
 * 获取轨道的实际时长(最后一个关键帧的 time)。
 *
 * 表达式轨道返回 Infinity(持续运行)。
 * 空轨道返回 0。
 */
export function getTrackDuration(track: AnimationTrack): number {
  if (track.mode === 'EXPRESSION') return Infinity
  if (track.keyframes.length === 0) return 0
  return track.keyframes[track.keyframes.length - 1].time
}

/**
 * 切换轨道模式。
 */
export function setTrackMode(
  track: AnimationTrack,
  mode: AnimationMode,
): AnimationTrack {
  return { ...track, mode }
}

/**
 * 启用 / 禁用轨道。
 */
export function setTrackEnabled(
  track: AnimationTrack,
  enabled: boolean,
): AnimationTrack {
  return { ...track, enabled }
}

/**
 * 深拷贝轨道(用于撤销 / 重做)。
 */
export function cloneTrack(track: AnimationTrack): AnimationTrack {
  return {
    ...track,
    keyframes: track.keyframes.map((k) => ({ ...k })),
  }
}
