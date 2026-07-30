/**
 * 碰撞检测 — Clip 重叠检测与避让。
 *
 * 提取自 Core Timeline 的 collision.ts，适配当前 number 秒系统。
 * 用于在拖拽 Clip 时检测同轨道是否与其他 Clip 重叠。
 */

import type { Clip } from '../types';
import { overlaps, type TimeRange } from './timeRange';

/** Clip 的时间范围 */
export function clipRange(clip: Clip): TimeRange {
  return { start: clip.start, end: clip.start + clip.duration };
}

/**
 * 检测指定 Clip 是否与同轨道的其他 Clip 重叠。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要检测的 Clip ID
 * @returns 重叠的 Clip 数组（空 = 无碰撞）
 */
export function checkCollision(clips: Clip[], clipId: string): Clip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return [];

  const targetRange = clipRange(target);
  return clips.filter(
    (c) =>
      c.id !== clipId &&
      c.trackId === target.trackId &&
      overlaps(targetRange, clipRange(c)),
  );
}

/**
 * 命中测试：找到指定时间点在指定轨道上活跃的 Clip。
 *
 * @param clips 所有 Clip 列表
 * @param trackId 轨道 ID
 * @param time 时间点
 * @returns 命中的 Clip 或 null
 */
export function hitTestClip(clips: Clip[], trackId: string, time: number): Clip | null {
  return (
    clips.find(
      (c) => c.trackId === trackId && time >= c.start && time < c.start + c.duration,
    ) ?? null
  );
}

/**
 * 查找指定轨道上与给定时间范围重叠的所有 Clip。
 *
 * @param clips 所有 Clip 列表
 * @param trackId 轨道 ID
 * @param range 时间范围
 * @returns 重叠的 Clip 数组
 */
export function findClipsInRange(
  clips: Clip[],
  trackId: string,
  range: TimeRange,
): Clip[] {
  return clips.filter(
    (c) =>
      c.trackId === trackId &&
      c.start < range.end &&
      c.start + c.duration > range.start,
  );
}

/**
 * 尝试将 Clip 移动到新位置，自动避让碰撞。
 * 如果新位置与同轨道其他 Clip 重叠，返回调整后不重叠的起始时间。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要移动的 Clip ID
 * @param desiredStart 期望的起始时间
 * @param totalDuration 时间轴总时长
 * @returns 实际可用的起始时间
 */
export function resolveCollision(
  clips: Clip[],
  clipId: string,
  desiredStart: number,
  totalDuration: number,
): number {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return desiredStart;

  // 钳制到 [0, totalDuration - duration]
  let start = Math.max(0, Math.min(desiredStart, totalDuration - clip.duration));

  // 检测碰撞
  const collisions = checkCollision(clips, clipId);
  if (collisions.length === 0) return start;

  // 简单策略：如果目标位置碰撞，尝试向左或向右微移
  const clipEnd = start + clip.duration;
  for (const other of collisions) {
    const otherEnd = other.start + other.duration;
    // 如果在 other 内部，推到 other 的后面
    if (start >= other.start && start < otherEnd) {
      start = otherEnd;
    }
    // 如果 other 在 clip 内部，推到 other 的前面
    if (other.start >= start && other.start < clipEnd) {
      const newStart = other.start - clip.duration;
      if (newStart >= 0) {
        start = newStart;
      }
    }
  }

  return Math.max(0, Math.min(start, totalDuration - clip.duration));
}
