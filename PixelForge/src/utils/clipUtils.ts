/**
 * Clip 工具函数 — 速度、修剪、时间映射。
 *
 * 提取自 ProTimeline 的 clip.ts，适配当前 number 秒系统。
 */

import type { Clip } from '../types';
import { clamp } from './timeUtils';

/** Clip 的结束时间 */
export function getClipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

/** 时间点是否在 Clip 区间内 [start, end) */
export function isClipActiveAt(clip: Clip, time: number): boolean {
  return time >= clip.start && time < getClipEnd(clip);
}

/**
 * 把时间轴时间映射到源素材时间（考虑速度）。
 *
 * 公式: sourceTime = sourceStart + (timelineTime - timelineStart) * speed
 *
 * @param clip Clip（需含可选的 sourceStart 和 speed 字段）
 * @param timelineTime 时间轴时间
 * @returns 源素材时间，或 null（不在 Clip 范围内）
 */
export function mapToSource(
  clip: Clip & { sourceStart?: number; speed?: number },
  timelineTime: number,
): number | null {
  if (!isClipActiveAt(clip, timelineTime)) return null;
  const sourceStart = clip.sourceStart ?? 0;
  const speed = clip.speed ?? 1;
  const offset = timelineTime - clip.start;
  return sourceStart + offset * speed;
}

/**
 * 修剪 Clip 左边界。
 *
 * delta 为正表示向右缩短，为负表示向左延长。
 */
export function trimClipLeft(clip: Clip, delta: number, minDuration: number = 0.5): Clip {
  const newDuration = clip.duration - delta;
  if (newDuration < minDuration) return clip;
  const newStart = Math.max(0, clip.start + delta);
  return { ...clip, start: newStart, duration: newDuration };
}

/**
 * 修剪 Clip 右边界。
 *
 * delta 为正表示缩短，为负表示延长。
 */
export function trimClipRight(clip: Clip, delta: number, minDuration: number = 0.5): Clip {
  const newDuration = clip.duration - delta;
  if (newDuration < minDuration) return clip;
  return { ...clip, duration: newDuration };
}

/** 移动 Clip 到新起始时间 */
export function moveClip(clip: Clip, newStart: number, totalDuration: number): Clip {
  const clamped = clamp(newStart, 0, Math.max(0, totalDuration - clip.duration));
  return { ...clip, start: clamped };
}

/** 设置 Clip 速度（同时调整 duration 保持源时长不变） */
export function setClipSpeed(
  clip: Clip & { speed?: number },
  speed: number,
): Clip & { speed: number } {
  const clamped = clamp(speed, 0.1, 10);
  const oldSpeed = clip.speed ?? 1;
  const newDuration = (clip.duration * oldSpeed) / clamped;
  return { ...clip, speed: clamped, duration: newDuration };
}

/** 克隆 Clip（新 ID） */
export function cloneClip(clip: Clip, newId: string): Clip {
  return { ...clip, id: newId };
}

/** 按 start 排序的比较器 */
export function compareClipByStart(a: Clip, b: Clip): number {
  return a.start - b.start;
}

/** 获取轨道上所有 Clip（按 start 排序） */
export function clipsForTrack(clips: Clip[], trackId: string): Clip[] {
  return clips
    .filter((c) => c.trackId === trackId)
    .sort(compareClipByStart);
}

/** 拼接间隙容差（秒），低于此值视为已拼接 */
export const SPLICE_TOLERANCE = 0.01;

/**
 * 判断两个 Clip 是否拼接（end ≈ start，在容差范围内）。
 * a 在前，b 在后。
 */
export function isSpliced(a: Clip, b: Clip): boolean {
  const gap = b.start - (a.start + a.duration);
  return Math.abs(gap) <= SPLICE_TOLERANCE;
}

/**
 * 获取与指定 Clip 拼接的所有 Clip ID（含自身），形成连续链。
 * 向左和向右递归查找同轨道上相邻拼接的 Clip。
 *
 * @param clips 所有 Clip
 * @param clipId 起始 Clip ID
 * @returns 拼接组中所有 Clip 的 ID 集合
 */
export function getSplicedGroup(clips: Clip[], clipId: string): Set<string> {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return new Set([clipId]);

  const group = new Set<string>([clipId]);
  const trackClips = clips
    .filter((c) => c.trackId === clip.trackId)
    .sort(compareClipByStart);

  // 向左查找
  let current = clip;
  for (let i = trackClips.length - 1; i >= 0; i--) {
    const candidate = trackClips[i];
    if (candidate.id === current.id) continue;
    if (candidate.start + candidate.duration <= current.start + SPLICE_TOLERANCE &&
        candidate.start + candidate.duration >= current.start - SPLICE_TOLERANCE) {
      // candidate 的右边缘 == current 的左边缘
      if (!group.has(candidate.id)) {
        group.add(candidate.id);
        current = candidate;
        i = trackClips.length; // 重新从头扫描
      }
    }
  }

  // 向右查找
  current = clip;
  for (let i = 0; i < trackClips.length; i++) {
    const candidate = trackClips[i];
    if (candidate.id === current.id) continue;
    if (current.start + current.duration <= candidate.start + SPLICE_TOLERANCE &&
        current.start + current.duration >= candidate.start - SPLICE_TOLERANCE) {
      // current 的右边缘 == candidate 的左边缘
      if (!group.has(candidate.id)) {
        group.add(candidate.id);
        current = candidate;
        i = -1; // 重新从头扫描
      }
    }
  }

  return group;
}

/**
 * 获取拼接组的整体时间范围 [minStart, maxEnd]。
 */
export function getGroupRange(clips: Clip[], groupIds: Set<string>): { start: number; end: number } {
  const groupClips = clips.filter((c) => groupIds.has(c.id));
  if (groupClips.length === 0) return { start: 0, end: 0 };
  const start = Math.min(...groupClips.map((c) => c.start));
  const end = Math.max(...groupClips.map((c) => c.start + c.duration));
  return { start, end };
}
