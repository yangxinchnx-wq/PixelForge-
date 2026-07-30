/**
 * 碰撞检测 — Clip 重叠检测与避让。
 *
 * 提取自 Core Timeline 的 collision.ts，适配当前 number 秒系统。
 * 用于在拖拽 Clip 时检测同轨道是否与其他 Clip 重叠。
 *
 * 核心策略：基于"间隙（gap）"的避让。
 * 同一轨道上其他 Clip 之间的空闲区间即为可放置间隙，
 * 拖拽中的 Clip 只能落在某个间隙内，从而保证永不重叠。
 */

import type { Clip } from '../types';
import { overlaps, type TimeRange } from './timeRange';

/** Clip 的时间范围 */
export function clipRange(clip: Clip): TimeRange {
  return { start: clip.start, end: clip.start + clip.duration };
}

/**
 * 检测指定 Clip（在其**当前**位置）是否与同轨道的其他 Clip 重叠。
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
 * 检测给定位置和时长是否与同轨道的其他 Clip 重叠。
 * 与 checkCollision 不同，此函数在**任意期望位置**进行检测。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要检测的 Clip ID（排除自身）
 * @param desiredStart 期望的起始时间
 * @param duration Clip 时长
 * @returns 重叠的 Clip 数组
 */
export function findOverlapsAt(
  clips: Clip[],
  clipId: string,
  desiredStart: number,
  duration: number,
): Clip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return [];

  const desiredRange: TimeRange = { start: desiredStart, end: desiredStart + duration };
  return clips.filter(
    (c) =>
      c.id !== clipId &&
      c.trackId === clip.trackId &&
      overlaps(desiredRange, clipRange(c)),
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
 * 收集同轨道上其他 Clip 之间的所有可放置间隙。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 正在拖拽的 Clip ID（排除自身）
 * @param totalDuration 时间轴总时长
 * @returns 间隙列表，按时间排序
 */
export function collectGaps(
  clips: Clip[],
  clipId: string,
  totalDuration: number,
): TimeRange[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return [{ start: 0, end: totalDuration }];

  // 同轨道的其他 Clip，按 start 排序
  const others = clips
    .filter((c) => c.id !== clipId && c.trackId === clip.trackId)
    .sort((a, b) => a.start - b.start);

  const gaps: TimeRange[] = [];
  let cursor = 0;

  for (const o of others) {
    if (o.start > cursor) {
      gaps.push({ start: cursor, end: o.start });
    }
    cursor = Math.max(cursor, o.start + o.duration);
  }

  if (cursor < totalDuration) {
    gaps.push({ start: cursor, end: totalDuration });
  }

  return gaps;
}

/**
 * 尝试将 Clip 移动到新位置，自动避让碰撞。
 *
 * 基于"间隙"策略：同轨道上其他 Clip 之间的空闲区间即为可放置间隙。
 * 在所有能容纳该 Clip 的间隙中，选择离 desiredStart 最近的位置。
 * 这保证 Clip 永远不会与其他 Clip 重叠。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要移动的 Clip ID
 * @param desiredStart 期望的起始时间
 * @param totalDuration 时间轴总时长
 * @returns 实际可用的起始时间（保证无重叠）
 */
export function resolveCollision(
  clips: Clip[],
  clipId: string,
  desiredStart: number,
  totalDuration: number,
): number {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return desiredStart;

  const duration = clip.duration;
  const maxStart = Math.max(0, totalDuration - duration);

  // 钳制到合法范围
  const clampedStart = Math.max(0, Math.min(desiredStart, maxStart));

  // 快速检查：期望位置是否无碰撞
  if (findOverlapsAt(clips, clipId, clampedStart, duration).length === 0) {
    return clampedStart;
  }

  // 收集所有间隙
  const gaps = collectGaps(clips, clipId, totalDuration);

  // 在每个能容纳 Clip 的间隙中，找到离 desiredStart 最近的位置
  let bestStart = clampedStart;
  let bestDist = Infinity;

  for (const gap of gaps) {
    if (gap.end - gap.start < duration) continue; // 间隙太小

    const lo = Math.max(gap.start, 0);
    const hi = Math.min(gap.end - duration, maxStart);
    if (lo > hi) continue;

    // 在间隙内最接近 desiredStart 的位置
    const candidate = Math.max(lo, Math.min(desiredStart, hi));
    const dist = Math.abs(candidate - desiredStart);
    if (dist < bestDist) {
      bestDist = dist;
      bestStart = candidate;
    }
  }

  return bestDist < Infinity ? bestStart : clampedStart;
}

/**
 * 检测从左侧修剪 Clip 时是否会造成与同轨道其他 Clip 重叠。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要修剪的 Clip ID
 * @param newStart 新的起始时间
 * @param newDuration 新的时长
 * @returns 是否有重叠
 */
export function hasResizeOverlap(
  clips: Clip[],
  clipId: string,
  newStart: number,
  newDuration: number,
): boolean {
  return findOverlapsAt(clips, clipId, newStart, newDuration).length > 0;
}

/**
 * 将左侧修剪的 Clip 钳制到不与同轨道其他 Clip 重叠的范围。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要修剪的 Clip ID
 * @param desiredStart 期望的新起始时间
 * @param fixedEnd 固定的结束时间（originalStart + originalDuration）
 * @returns 钳制后的起始时间
 */
export function clampResizeLeft(
  clips: Clip[],
  clipId: string,
  desiredStart: number,
  fixedEnd: number,
): number {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return desiredStart;

  // 同轨道的其他 Clip，按 start 排序
  const others = clips
    .filter((c) => c.id !== clipId && c.trackId === clip.trackId)
    .sort((a, b) => a.start - b.start);

  let start = desiredStart;

  // 检查是否有 Clip 的结束时间在 [start, fixedEnd) 范围内
  // 即是否有其他 Clip 的 end 落在新 Clip 的范围内
  for (const o of others) {
    const oEnd = o.start + o.duration;
    // 如果 other 的结束时间在 (start, fixedEnd) 内，说明 other 尾部与 Clip 重叠
    // 需要将 start 推到 oEnd 之后
    if (oEnd > start && o.start < fixedEnd) {
      // other 与新范围有重叠
      // 如果 other 完全在 Clip 左侧（oEnd <= fixedEnd），推到 oEnd
      if (oEnd <= fixedEnd) {
        start = Math.max(start, oEnd);
      }
    }
  }

  return start;
}

/**
 * 将右侧修剪的 Clip 钳制到不与同轨道其他 Clip 重叠的范围。
 *
 * @param clips 所有 Clip 列表
 * @param clipId 要修剪的 Clip ID
 * @param clipStart Clip 固定的起始时间
 * @param desiredDuration 期望的新时长
 * @returns 钳制后的时长
 */
export function clampResizeRight(
  clips: Clip[],
  clipId: string,
  clipStart: number,
  desiredDuration: number,
): number {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return desiredDuration;

  // 同轨道的其他 Clip
  const others = clips
    .filter((c) => c.id !== clipId && c.trackId === clip.trackId)
    .sort((a, b) => a.start - b.start);

  let duration = desiredDuration;
  const newEnd = clipStart + duration;

  // 找到第一个 start > clipStart 的 Clip，它可能阻挡右边缘
  for (const o of others) {
    if (o.start >= clipStart && o.start < newEnd) {
      // other 的 start 在 Clip 的新范围内，需要将 duration 限制到 o.start - clipStart
      duration = Math.min(duration, o.start - clipStart);
    }
  }

  return Math.max(0, duration);
}
