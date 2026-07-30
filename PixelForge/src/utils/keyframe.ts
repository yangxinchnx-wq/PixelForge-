/**
 * 关键帧动画系统 — 求值器 + 管理工具。
 *
 * 合并了帧级参数动画（linear/ease/hold）和秒级动画（bezier/step）的优点。
 * 基于秒（number），支持四种插值方式。
 *
 * 类型定义在 src/types.ts 中，此处仅导入使用。
 *
 * 数据流:
 *   时间轴拖动 / 播放头推进
 *     ↓ evaluateTrack
 *   参数值(number)
 *     ↓ 应用到渲染层
 *   画面更新
 */

import type { Keyframe, ParameterTrack, Interpolation } from '../types';

// 重新导出类型，方便外部直接从此文件导入
export type { Keyframe, ParameterTrack, Interpolation };

// ============================================================================
// 1. 常量
// ============================================================================

/** bezier 默认控制点（近似 CSS ease） */
export const DEFAULT_BEZIER_CP1 = { x: 0.25, y: 0.1 };
export const DEFAULT_BEZIER_CP2 = { x: 0.75, y: 0.9 };

/** 生成简单唯一 ID */
let _kfIdCounter = 0;
export function genKeyframeId(): string {
  _kfIdCounter++;
  return `kf-${Date.now().toString(36)}-${_kfIdCounter.toString(36)}`;
}

// ============================================================================
// 2. 缓动函数

/** smoothstep 缓动（用于 ease） */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 三次贝塞尔求值 */
function cubicBezier(t: number, p1x: number, p1y: number, p2x: number, p2y: number): number {
  // 使用牛顿迭代法求解贝塞尔曲线的 y 值
  // P0 = (0,0), P1 = (p1x,p1y), P2 = (p2x,p2y), P3 = (1,1)
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  // 求 x(t) = time 的 t 值
  let t0 = t;
  for (let i = 0; i < 8; i++) {
    const x = ((ax * t0 + bx) * t0 + cx) * t0 - t;
    const d = (3 * ax * t0 + 2 * bx) * t0 + cx;
    if (Math.abs(d) < 1e-6) break;
    t0 -= x / d;
  }
  // 返回 y(t0)
  return ((ay * t0 + by) * t0 + cy) * t0;
}

/** 根据插值方式计算因子 t (0→1) */
function applyInterpolation(interpolation: Interpolation, t: number, left: Keyframe): number {
  switch (interpolation) {
    case 'ease':
      return smoothstep(t);
    case 'hold':
      return 0; // hold: 始终用左端点值
    case 'step':
      return 0; // step: 与 hold 相同
    case 'bezier': {
      const cp1 = left.cp1 ?? DEFAULT_BEZIER_CP1;
      const cp2 = left.cp2 ?? DEFAULT_BEZIER_CP2;
      return cubicBezier(t, cp1.x, cp1.y, cp2.x, cp2.y);
    }
    case 'linear':
    default:
      return t;
  }
}

// ============================================================================
// 3. 求值器

/**
 * 在指定时间上求值单条轨道。
 *
 * @param track 参数轨道
 * @param time 当前时间（秒）
 * @returns 插值后的参数值
 */
export function evaluateTrack(track: ParameterTrack, time: number): number {
  const keys = track.keyframes;
  if (keys.length === 0) return 0;
  if (keys.length === 1) return keys[0].value;

  const sorted = [...keys].sort((a, b) => a.time - b.time);

  // time 在第一帧之前
  if (time <= sorted[0].time) return sorted[0].value;
  // time 在最后一帧之后
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  // 找到包含 time 的区间 [left, right]
  let left = sorted[0];
  let right = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      left = sorted[i];
      right = sorted[i + 1];
      break;
    }
  }

  const span = right.time - left.time;
  if (span <= 0) return left.value;

  const rawT = (time - left.time) / span;
  const t = applyInterpolation(left.interpolation, rawT, left);
  return left.value + (right.value - left.value) * t;
}

/**
 * 批量求值：把当前时间应用到所有轨道。
 */
export function evaluateAllTracks(
  tracks: ParameterTrack[],
  time: number,
): Array<{ track: ParameterTrack; value: number }> {
  return tracks.map((track) => ({ track, value: evaluateTrack(track, time) }));
}

// ============================================================================
// 4. 关键帧管理工具

/** 创建关键帧 */
export function createKeyframe(
  time: number,
  value: number,
  interpolation: Interpolation = 'linear',
): Keyframe {
  const kf: Keyframe = {
    id: genKeyframeId(),
    time,
    value,
    interpolation,
  };
  if (interpolation === 'bezier') {
    kf.cp1 = { ...DEFAULT_BEZIER_CP1 };
    kf.cp2 = { ...DEFAULT_BEZIER_CP2 };
  }
  return kf;
}

/** 按时间排序关键帧 */
export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

/** 插入关键帧（自动保持排序） */
export function insertKeyframe(keyframes: Keyframe[], kf: Keyframe): Keyframe[] {
  return sortKeyframes([...keyframes, kf]);
}

/** 按 ID 删除关键帧 */
export function removeKeyframe(keyframes: Keyframe[], id: string): Keyframe[] {
  return keyframes.filter((k) => k.id !== id);
}

/** 更新关键帧（自动重新排序） */
export function updateKeyframe(
  keyframes: Keyframe[],
  id: string,
  time: number,
  value: number,
): Keyframe[] {
  return sortKeyframes(
    keyframes.map((k) => (k.id === id ? { ...k, time, value } : k)),
  );
}
