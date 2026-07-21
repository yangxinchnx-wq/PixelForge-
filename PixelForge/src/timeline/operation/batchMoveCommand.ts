/**
 * PixelForge Timeline — BatchMoveCommand（多选移动命令）。
 *
 * 多选移动：一个 Command 包含多个 Clip 的移动。
 *
 * 选择 A B C → 整体移动 → 所有 clip.start += delta
 *
 * Command：
 *   一个 Command 包含多个 Clip。
 *
 *   class BatchMoveCommand {
 *     commands: Command[]
 *   }
 */

import type { Command } from './command';
import type { Clip } from '../core/clip';
import type { Time } from '../core/time';
import { MoveClipCommand } from './moveClipCommand';

/** 多选移动命令：批量移动多个 Clip。 */
export class BatchMoveCommand implements Command {
  private commands: MoveClipCommand[] = [];
  /** 所有移动的 Clip ID 列表 */
  readonly clipIds: string[];

  /**
   * @param clips  要移动的 Clip 列表
   * @param delta  时间偏移量（所有 Clip 统一偏移）
   */
  constructor(clips: Clip[], delta: Time) {
    this.clipIds = clips.map((c) => c.id);
    for (const clip of clips) {
      const before = clip.timelineStart;
      const after = before + delta;
      this.commands.push(new MoveClipCommand(clip, before, after));
    }
  }

  execute(): void {
    for (const cmd of this.commands) {
      cmd.execute();
    }
  }

  undo(): void {
    // 逆序撤销
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i].undo();
    }
  }
}
