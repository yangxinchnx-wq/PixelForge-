/**
 * SnapEngine — 吸附引擎。
 *
 * 提取自 Core Timeline 的 snapEngine.ts，适配当前 number 秒系统。
 * 在拖拽 Clip / 播放头时，自动吸附到附近的目标点：
 * - 其他 Clip 的边缘（start / end）
 * - 播放头位置
 * - 时间轴原点 (0)
 *
 * 用法:
 *   const snapTargets = collectSnapTargets(clips, playhead);
 *   const snapped = snap(time, snapTargets, threshold);
 *   if (snapped !== null) { /* 使用吸附后的时间 *\/ }
 */

/** 吸附目标点 */
export interface SnapTarget {
  time: number;
  label: string;
}

/** 吸附结果 */
export interface SnapResult {
  /** 吸附后的时间 */
  time: number;
  /** 吸附到的目标 */
  target: SnapTarget;
}

/**
 * 默认吸附阈值（秒）。
 * 0.1 秒 ≈ 3 帧 @ 30fps。
 */
export const DEFAULT_SNAP_THRESHOLD = 0.1;

/**
 * 收集所有吸附目标点。
 *
 * @param clips 所有 Clip 列表
 * @param excludeClipId 排除的 Clip ID（正在拖拽的 Clip 自身不作为吸附目标）
 * @param playhead 播放头时间（可选）
 * @param markerTimes 标记点时间数组（可选）
 */
export function collectSnapTargets(
  clips: { id: string; start: number; duration: number }[],
  excludeClipId?: string | null,
  playhead?: number,
  markerTimes?: number[],
): SnapTarget[] {
  const targets: SnapTarget[] = [];

  // 原点
  targets.push({ time: 0, label: '原点' });

  // Clip 边缘
  for (const clip of clips) {
    if (clip.id === excludeClipId) continue;
    targets.push({ time: clip.start, label: '片段起点' });
    targets.push({ time: clip.start + clip.duration, label: '片段终点' });
  }

  // 播放头
  if (playhead !== undefined && playhead > 0) {
    targets.push({ time: playhead, label: '播放头' });
  }

  // 标记点
  if (markerTimes) {
    for (const t of markerTimes) {
      targets.push({ time: t, label: '标记点' });
    }
  }

  return targets;
}

/**
 * 尝试吸附到最近的目标点。
 *
 * @param time 当前时间
 * @param targets 吸附目标列表
 * @param threshold 吸附阈值（秒），默认 0.1
 * @returns 吸附结果，或 null（未吸附）
 */
export function snap(
  time: number,
  targets: SnapTarget[],
  threshold: number = DEFAULT_SNAP_THRESHOLD,
): SnapResult | null {
  let bestTarget: SnapTarget | null = null;
  let bestDist = threshold;

  for (const target of targets) {
    const dist = Math.abs(time - target.time);
    if (dist <= bestDist) {
      bestDist = dist;
      bestTarget = target;
    }
  }

  if (bestTarget) {
    return { time: bestTarget.time, target: bestTarget };
  }
  return null;
}

/**
 * 批量吸附：对一组时间点尝试吸附，返回吸附后的时间。
 * 如果没有任何目标在阈值内，返回原始时间。
 */
export function snapOrDefault(
  time: number,
  targets: SnapTarget[],
  threshold: number = DEFAULT_SNAP_THRESHOLD,
): number {
  const result = snap(time, targets, threshold);
  return result ? result.time : time;
}
