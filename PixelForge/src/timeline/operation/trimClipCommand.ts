/**
 * PixelForge Timeline — TrimClipCommand。
 *
 * 裁剪 Clip（改变 duration / sourceStart / timelineStart）。
 *
 * Right Trim：改变 duration
 *   原：0----60 → 0----30
 *   数据：duration = 30
 *
 * Left Trim：改变 sourceStart + duration + timelineStart
 *   原：source 0----60, timeline 0----60
 *   左裁 10 秒：source 10----60, timeline 0----50
 *   数据：sourceStart += 10, duration -= 10
 */

import type { Command } from './command';
import type { Clip } from '../core/clip';
import type { Time } from '../core/time';

/** Clip 裁剪相关状态（Trim 操作修改的字段子集）。 */
export interface ClipTrimState {
  timelineStart: Time;
  duration: Time;
  sourceStart: Time;
  sourceDuration: Time;
}

/** 裁剪 Clip 的命令。 */
export class TrimClipCommand implements Command {
  readonly clipId: string;
  private clip: Clip;
  private oldState: ClipTrimState;
  private newState: ClipTrimState;

  /**
   * @param clip     要裁剪的 Clip 引用
   * @param oldState 裁剪前的状态
   * @param newState 裁剪后的状态
   */
  constructor(clip: Clip, oldState: ClipTrimState, newState: ClipTrimState) {
    this.clip = clip;
    this.clipId = clip.id;
    this.oldState = oldState;
    this.newState = newState;
  }

  execute(): void {
    Object.assign(this.clip, this.newState);
  }

  undo(): void {
    Object.assign(this.clip, this.oldState);
  }
}
