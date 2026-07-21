/**
 * PixelForge Timeline — ClipTrimmer（Clip 裁剪系统）。
 *
 * 视频编辑最重要的操作：改变 Clip 长度。
 *
 * Right Trim（右裁剪）：
 *   原：0----60 → 0----30
 *   改变：duration = newDuration
 *
 * Left Trim（左裁剪）：
 *   原：source 0----60, timeline 0----60
 *   左裁 10 秒：source 10----60, timeline 0----50
 *   改变：sourceStart += delta, duration -= delta
 */

import type { Clip } from '../core/clip';
import type { Time } from '../core/time';
import type { CommandStack } from '../operation/commandStack';
import { TrimClipCommand, type ClipTrimState } from '../operation/trimClipCommand';

/** ClipTrimmer — 管理 Clip 裁剪操作。 */
export class ClipTrimmer {
  /**
   * 右裁剪：改变 duration。
   *
   * @param clip        要裁剪的 Clip
   * @param newDuration 新的 duration（必须 > 0）
   * @param commandStack Command 栈
   */
  rightTrim(
    clip: Clip,
    newDuration: Time,
    commandStack: CommandStack,
  ): void {
    if (newDuration <= 0n) return;

    const oldState: ClipTrimState = {
      timelineStart: clip.timelineStart,
      duration: clip.duration,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
    };
    const newState: ClipTrimState = {
      ...oldState,
      duration: newDuration,
      sourceDuration: newDuration,
    };

    const cmd = new TrimClipCommand(clip, oldState, newState);
    commandStack.execute(cmd);
  }

  /**
   * 左裁剪：跳过 Clip 开头部分。
   *
   * 原：source 0----60, timeline 0----60
   * 左裁 delta：source delta----60, timeline 0----(60-delta)
   * 改变：sourceStart += delta, duration -= delta, sourceDuration -= delta
   *
   * @param clip        要裁剪的 Clip
   * @param delta      裁剪量（微秒 Time，必须 > 0 且 < duration）
   * @param commandStack Command 栈
   */
  leftTrim(
    clip: Clip,
    delta: Time,
    commandStack: CommandStack,
  ): void {
    if (delta <= 0n || delta >= clip.duration) return;

    const oldState: ClipTrimState = {
      timelineStart: clip.timelineStart,
      duration: clip.duration,
      sourceStart: clip.sourceStart,
      sourceDuration: clip.sourceDuration,
    };
    const newState: ClipTrimState = {
      // timelineStart 不变（在时间轴上的位置不变）
      timelineStart: clip.timelineStart,
      duration: clip.duration - delta,
      sourceStart: clip.sourceStart + delta,
      sourceDuration: clip.sourceDuration - delta,
    };

    const cmd = new TrimClipCommand(clip, oldState, newState);
    commandStack.execute(cmd);
  }
}
