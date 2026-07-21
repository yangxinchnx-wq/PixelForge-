/**
 * PixelForge Timeline — MoveClipCommand。
 *
 * 移动 Clip 时间位置。
 *
 * 不要直接 clip.timelineStart = newTime（没有历史）。
 * 正确：Drag Start → 保存旧状态 → Drag Move → 生成 Command → Execute。
 */

import type { Command } from './command';
import type { Clip } from '../core/clip';
import type { Time } from '../core/time';

/** 移动 Clip 的命令。 */
export class MoveClipCommand implements Command {
  /** 目标 Clip ID */
  readonly clipId: string;
  private clip: Clip;
  private before: Time;
  private after: Time;

  /**
   * @param clip  要移动的 Clip 引用
   * @param before 移动前的时间
   * @param after  移动后的时间
   */
  constructor(clip: Clip, before: Time, after: Time) {
    this.clip = clip;
    this.clipId = clip.id;
    this.before = before;
    this.after = after;
  }

  execute(): void {
    this.clip.timelineStart = this.after;
  }

  undo(): void {
    this.clip.timelineStart = this.before;
  }
}
