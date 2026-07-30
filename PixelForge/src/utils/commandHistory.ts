/**
 * CommandHistory — 命令历史栈（undo/redo）。
 *
 * 提取自 ProTimeline 的 history.ts，通用化适配当前系统。
 * 核心设计:
 * - undoStack: 已执行的命令栈（FILO）
 * - redoStack: 被撤销的命令栈（FILO）
 * - execute(cmd): 执行命令并入 undoStack，清空 redoStack
 * - undo(): 从 undoStack 弹出，执行 undo()，入 redoStack
 * - redo(): 从 redoStack 弹出，执行 execute()，入 undoStack
 */

/** 命令接口 */
export interface Command {
  /** 命令名（用于 UI 显示） */
  readonly label: string;
  /** 执行 */
  execute(): void;
  /** 撤销 */
  undo(): void;
}

/** 默认最大历史记录数 */
export const DEFAULT_HISTORY_LIMIT = 100;

/** History 事件 */
export type HistoryEvent =
  | { type: 'execute'; label: string; undoSize: number; redoSize: number }
  | { type: 'undo'; label: string; undoSize: number; redoSize: number }
  | { type: 'redo'; label: string; undoSize: number; redoSize: number }
  | { type: 'clear'; undoSize: number; redoSize: number };

export type HistoryListener = (event: HistoryEvent) => void;

/**
 * CommandHistory — 命令历史管理器。
 *
 * 用法:
 *   const history = new CommandHistory()
 *   history.execute(new MoveClipCommand(...))
 *   history.canUndo()  // true
 *   history.undo()
 *   history.canRedo()  // true
 *   history.redo()
 */
export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit: number;
  private listeners: Set<HistoryListener> = new Set();

  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    this.limit = limit;
  }

  /** 执行命令并入栈 */
  execute(command: Command): void {
    command.execute();
    this.undoStack.push(command);
    this.redoStack.length = 0;
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.emit({ type: 'execute', label: command.label, undoSize: this.undoStack.length, redoSize: 0 });
  }

  /** 撤销最后一条命令 */
  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.undo();
    this.redoStack.push(command);
    this.emit({ type: 'undo', label: command.label, undoSize: this.undoStack.length, redoSize: this.redoStack.length });
    return true;
  }

  /** 重做最后一条被撤销的命令 */
  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.execute();
    this.undoStack.push(command);
    this.emit({ type: 'redo', label: command.label, undoSize: this.undoStack.length, redoSize: this.redoStack.length });
    return true;
  }

  /** 是否可撤销 */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 是否可重做 */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  get nextUndoLabel(): string | null {
    const cmd = this.undoStack[this.undoStack.length - 1];
    return cmd ? cmd.label : null;
  }

  get nextRedoLabel(): string | null {
    const cmd = this.redoStack[this.redoStack.length - 1];
    return cmd ? cmd.label : null;
  }

  /** 清空所有历史 */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit({ type: 'clear', undoSize: 0, redoSize: 0 });
  }

  /** 添加监听器 */
  on(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: HistoryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[CommandHistory] listener error:', e);
      }
    }
  }
}

// ============ 常用命令实现 ============

/** 移动 Clip 命令 */
export class MoveClipCommand implements Command {
  readonly label: string;
  private clips: () => import('../types').Clip[];
  private setClips: (clips: import('../types').Clip[]) => void;
  private clipId: string;
  private oldStart: number;
  private newStart: number;

  constructor(
    clips: () => import('../types').Clip[],
    setClips: (clips: import('../types').Clip[]) => void,
    clipId: string,
    oldStart: number,
    newStart: number,
  ) {
    this.label = '移动片段';
    this.clips = clips;
    this.setClips = setClips;
    this.clipId = clipId;
    this.oldStart = oldStart;
    this.newStart = newStart;
  }

  execute(): void {
    this.setClips(this.clips().map((c) => (c.id === this.clipId ? { ...c, start: this.newStart } : c)));
  }

  undo(): void {
    this.setClips(this.clips().map((c) => (c.id === this.clipId ? { ...c, start: this.oldStart } : c)));
  }
}

/** 修剪 Clip 命令 */
export class TrimClipCommand implements Command {
  readonly label: string;
  private clips: () => import('../types').Clip[];
  private setClips: (clips: import('../types').Clip[]) => void;
  private clipId: string;
  private oldStart: number;
  private oldDuration: number;
  private newStart: number;
  private newDuration: number;

  constructor(
    clips: () => import('../types').Clip[],
    setClips: (clips: import('../types').Clip[]) => void,
    clipId: string,
    oldStart: number,
    oldDuration: number,
    newStart: number,
    newDuration: number,
  ) {
    this.label = '修剪片段';
    this.clips = clips;
    this.setClips = setClips;
    this.clipId = clipId;
    this.oldStart = oldStart;
    this.oldDuration = oldDuration;
    this.newStart = newStart;
    this.newDuration = newDuration;
  }

  execute(): void {
    this.setClips(
      this.clips().map((c) =>
        c.id === this.clipId ? { ...c, start: this.newStart, duration: this.newDuration } : c,
      ),
    );
  }

  undo(): void {
    this.setClips(
      this.clips().map((c) =>
        c.id === this.clipId ? { ...c, start: this.oldStart, duration: this.oldDuration } : c,
      ),
    );
  }
}

/** 删除 Clip 命令 */
export class DeleteClipCommand implements Command {
  readonly label: string;
  private clips: () => import('../types').Clip[];
  private setClips: (clips: import('../types').Clip[]) => void;
  private clipId: string;
  private deletedClip: import('../types').Clip | null = null;

  constructor(
    clips: () => import('../types').Clip[],
    setClips: (clips: import('../types').Clip[]) => void,
    clipId: string,
  ) {
    this.label = '删除片段';
    this.clips = clips;
    this.setClips = setClips;
    this.clipId = clipId;
  }

  execute(): void {
    this.deletedClip = this.clips().find((c) => c.id === this.clipId) ?? null;
    this.setClips(this.clips().filter((c) => c.id !== this.clipId));
  }

  undo(): void {
    if (this.deletedClip) {
      this.setClips([...this.clips(), this.deletedClip]);
    }
  }
}

/** 切割 Clip 命令 */
export class SplitClipCommand implements Command {
  readonly label: string;
  private clips: () => import('../types').Clip[];
  private setClips: (clips: import('../types').Clip[]) => void;
  private clipId: string;
  private cutTime: number;
  private newClipId: string | null = null;

  constructor(
    clips: () => import('../types').Clip[],
    setClips: (clips: import('../types').Clip[]) => void,
    clipId: string,
    cutTime: number,
  ) {
    this.label = '切割片段';
    this.clips = clips;
    this.setClips = setClips;
    this.clipId = clipId;
    this.cutTime = cutTime;
  }

  execute(): void {
    const clip = this.clips().find((c) => c.id === this.clipId);
    if (!clip) return;
    if (this.cutTime <= clip.start || this.cutTime >= clip.start + clip.duration) return;

    const firstHalf: import('../types').Clip = {
      ...clip,
      duration: this.cutTime - clip.start,
    };
    this.newClipId = clip.id + '-split-' + Date.now().toString(36);
    const secondHalf: import('../types').Clip = {
      ...clip,
      id: this.newClipId,
      start: this.cutTime,
      duration: clip.start + clip.duration - this.cutTime,
    };

    this.setClips(
      this.clips().flatMap((c) => (c.id === this.clipId ? [firstHalf, secondHalf] : [c])),
    );
  }

  undo(): void {
    if (!this.newClipId) return;
    const original = this.clips().find((c) => c.id === this.clipId);
    if (!original) return;
    const firstDuration = original.duration;
    const second = this.clips().find((c) => c.id === this.newClipId);
    if (!second) return;
    const restored: import('../types').Clip = {
      ...original,
      duration: firstDuration + second.duration,
    };
    this.setClips(
      this.clips()
        .filter((c) => c.id !== this.newClipId)
        .map((c) => (c.id === this.clipId ? restored : c)),
    );
  }
}
