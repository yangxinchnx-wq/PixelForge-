/**
 * PixelForge Timeline — Snap 磁吸系统。
 *
 * 专业体验关键：拖动 Clip 靠近其他 Clip 边缘 / 播放头时自动吸附。
 *
 * Snap 目标：
 *   - Clip Start
 *   - Clip End
 *   - Playhead
 *   - Marker
 *
 * 算法：
 *   遍历所有 target，找到 |time - target| < threshold 的最近目标。
 */

import type { Time } from '../core/time';

/**
 * 吸附到最近的目标点。
 *
 * @param time      当前时间
 * @param targets   所有可吸附目标点
 * @param threshold 吸附阈值（小于此距离才吸附）
 * @returns 吸附后的时间（如果没有命中则返回原时间）
 */
export function snap(
  time: Time,
  targets: Time[],
  threshold: Time,
): Time {
  let bestTarget: Time | null = null;
  let bestDiff: Time = threshold;

  for (const target of targets) {
    const diff = time - target;
    const absDiff = diff < 0n ? -diff : diff;
    if (absDiff < bestDiff) {
      bestDiff = absDiff;
      bestTarget = target;
    }
  }

  return bestTarget !== null ? bestTarget : time;
}

/**
 * SnapEngine — 管理吸附目标并执行吸附。
 *
 * 用法：
 *   const engine = new SnapEngine();
 *   engine.setThreshold(sec(0.1));
 *   engine.setTargets([clipStart, clipEnd, playhead]);
 *   const snapped = engine.snap(time);
 */
export class SnapEngine {
  private targets: Time[] = [];
  private thresholdValue: Time;

  constructor(threshold: Time = 100000n) {
    this.thresholdValue = threshold;
  }

  /** 设置吸附阈值。 */
  setThreshold(threshold: Time): void {
    this.thresholdValue = threshold;
  }

  /** 设置吸附目标列表。 */
  setTargets(targets: Time[]): void {
    this.targets = targets;
  }

  /** 添加一个吸附目标。 */
  addTarget(target: Time): void {
    this.targets.push(target);
  }

  /** 清空所有吸附目标。 */
  clearTargets(): void {
    this.targets = [];
  }

  /** 执行吸附。 */
  snap(time: Time): Time {
    return snap(time, this.targets, this.thresholdValue);
  }
}
