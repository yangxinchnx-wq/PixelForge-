/**
 * PixelForge Timeline — ClipMover（Clip 移动系统）。
 *
 * 用户拖动 Clip 改变时间位置。
 *
 * 流程：
 *   Drag Start → 保存旧状态
 *   Drag Move  → 实时修改 clip.timelineStart（预览）
 *   Drag End   → 生成 MoveClipCommand → CommandStack.execute
 *
 * 拖动计算：
 *   鼠标：像素
 *   时间：秒
 *   转换：deltaTime = pixelDelta / pixelsPerSecond
 */

import type { Clip } from '../core/clip';
import type { Time } from '../core/time';
import { sec } from '../core/time';
import type { CommandStack } from '../operation/commandStack';
import { MoveClipCommand } from '../operation/moveClipCommand';

/**
 * 像素转时间。
 *
 * @param px    像素偏移量
 * @param scale 每秒像素数（pixelsPerSecond）
 * @returns 时间偏移量（微秒 Time）
 *
 * @example
 * pixelToTime(200, 100)  // 2000000n = 2 秒
 */
export function pixelToTime(px: number, scale: number): Time {
  return sec(px / scale);
}

/**
 * ClipMover — 管理 Clip 拖动流程。
 *
 * 用法：
 *   const mover = new ClipMover(100); // 100px/s
 *   mover.onDragStart(clip);
 *   mover.onDragMove(pixelDelta);     // 实时预览
 *   mover.onDragEnd(commandStack);    // 提交 Command
 */
export class ClipMover {
  private clip: Clip | null = null;
  private beforeTime: Time = 0n;
  private scale: number;

  /**
   * @param scale 每秒像素数（pixelsPerSecond），默认 100
   */
  constructor(scale: number = 100) {
    this.scale = scale;
  }

  /** 设置缩放（pixelsPerSecond）。 */
  setScale(scale: number): void {
    this.scale = scale;
  }

  /** 拖动开始：保存旧状态。 */
  onDragStart(clip: Clip): void {
    this.clip = clip;
    this.beforeTime = clip.timelineStart;
  }

  /** 拖动中：实时修改 clip 时间位置（预览）。 */
  onDragMove(pixelDelta: number): void {
    if (!this.clip) return;
    const deltaTime = pixelToTime(pixelDelta, this.scale);
    this.clip.timelineStart = this.beforeTime + deltaTime;
  }

  /** 拖动结束：生成 MoveClipCommand 并通过 CommandStack 提交。 */
  onDragEnd(commandStack: CommandStack): void {
    if (!this.clip) return;

    const afterTime = this.clip.timelineStart;

    // 恢复到 before，让 CommandStack.execute 重新设置到 after
    this.clip.timelineStart = this.beforeTime;

    // 只有实际移动了才记录 Command
    if (afterTime !== this.beforeTime) {
      const cmd = new MoveClipCommand(this.clip, this.beforeTime, afterTime);
      commandStack.execute(cmd);
    }

    this.clip = null;
  }

  /** 取消拖动（不提交 Command）。 */
  cancel(): void {
    if (this.clip) {
      this.clip.timelineStart = this.beforeTime;
      this.clip = null;
    }
  }
}
