/**
 * PixelForge Timeline — BladeTool（切割工具）。
 *
 * 快捷键：C
 * 功能：一个 Clip 切两个。
 *
 * 原：Clip A [0 ──────────── 60]
 * 点击：30 秒
 * 生成：
 *   Clip A [0 ──── 30]
 *   Clip B [30 ──── 60]
 *
 * 实现（通过 SplitClipCommand）：
 *   1. 复制 Clip
 *   2. 修改左边 clip.duration = cutTime
 *   3. 修改右边 newClip.sourceStart += cutTime, newClip.timelineStart += cutTime
 *   4. 插入 Track
 */

import type { Clip } from '../core/clip';
import type { Track } from '../core/track';
import type { Time } from '../core/time';
import type { CommandStack } from '../operation/commandStack';
import { SplitClipCommand } from '../operation/splitClipCommand';

/** BladeTool — 切割 Clip 工具。 */
export class BladeTool {
  /**
   * 在指定时间点切割 Clip。
   *
   * @param clip         要切割的 Clip
   * @param track        所在轨道
   * @param time         切割时间点（Timeline 绝对时间）
   * @param commandStack Command 栈
   * @returns 新创建的右侧 Clip ID，或 null（切割点不在 Clip 范围内）
   */
  split(
    clip: Clip,
    track: Track,
    time: Time,
    commandStack: CommandStack,
  ): string | null {
    // 切割点必须在 Clip 内部（不能在边界上）
    const cutTime = time - clip.timelineStart;
    if (cutTime <= 0n || cutTime >= clip.duration) return null;

    const cmd = new SplitClipCommand(clip, track, cutTime);
    commandStack.execute(cmd);
    return cmd.getNewClipId();
  }
}
