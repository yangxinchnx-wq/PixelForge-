/**
 * PixelForge Timeline Core — Command Stack（命令历史栈）。
 *
 * 保存执行历史，支持 Undo / Redo。
 *
 * 结构：
 *   undoStack: [Move, Cut, Delete]   （已执行，可撤销）
 *   redoStack: []                     （已撤销，可重做）
 *
 * 执行新命令时清空 redoStack（分支失效）。
 */

import type { Command } from './command';

/** 命令历史栈。 */
export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  /** 执行命令并压入 undoStack，同时清空 redoStack。 */
  execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
  }

  /** 撤销最近一条命令。 */
  undo(): void {
    const cmd = this.undoStack.pop();
    if (cmd === undefined) return;
    cmd.undo();
    this.redoStack.push(cmd);
  }

  /** 重做最近一条被撤销的命令。 */
  redo(): void {
    const cmd = this.redoStack.pop();
    if (cmd === undefined) return;
    cmd.execute();
    this.undoStack.push(cmd);
  }

  /** 是否可以撤销。 */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 是否可以重做。 */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 清空所有历史。 */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
