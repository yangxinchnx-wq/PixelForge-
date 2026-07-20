/**
 * History(Step 31.1)— 命令历史栈(undo/redo)。
 *
 * 核心设计:
 * - undoStack: 已执行的命令栈(FILO)
 * - redoStack: 被撤销的命令栈(FILO)
 * - execute(cmd): 执行命令并入 undoStack,清空 redoStack
 * - undo(): 从 undoStack 弹出命令,执行其 undo(),入 redoStack
 * - redo(): 从 redoStack 弹出命令,执行其 execute(),入 undoStack
 *
 * 容量限制:
 *   undoStack 有最大容量(默认 100),
 *   超出时丢弃最旧的命令(无法 undo 到最初状态)。
 */

import type { Command } from './command'

// ============================================================================
// 1. 类型
// ============================================================================

/** 默认最大历史记录数 */
export const DEFAULT_HISTORY_LIMIT = 100

/**
 * History 事件监听器(用于 UI 更新按钮状态)。
 */
export type HistoryListener = (event: HistoryEvent) => void

/**
 * History 事件类型。
 */
export type HistoryEvent =
  | { type: 'execute'; command: Command; stackSize: number; redoSize: number }
  | { type: 'undo'; command: Command; stackSize: number; redoSize: number }
  | { type: 'redo'; command: Command; stackSize: number; redoSize: number }
  | { type: 'clear'; stackSize: number; redoSize: number }

// ============================================================================
// 2. CommandHistory
// ============================================================================

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
  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private limit: number
  private listeners: Set<HistoryListener> = new Set()

  constructor(limit: number = DEFAULT_HISTORY_LIMIT) {
    this.limit = limit
  }

  // —— 执行 / 撤销 / 重做 ——

  /**
   * 执行命令并入栈。
   *
   * - 执行 command.execute()
   * - 入 undoStack
   * - 清空 redoStack(新操作后,旧的 redo 失效)
   * - 若 undoStack 超出 limit,丢弃最旧的命令
   */
  execute(command: Command): void {
    command.execute()
    this.undoStack.push(command)
    this.redoStack.length = 0

    // 容量限制:丢弃最旧
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift()
    }

    this.emit({ type: 'execute', command, stackSize: this.undoStack.length, redoSize: 0 })
  }

  /** 撤销最后一条命令 */
  undo(): boolean {
    const command = this.undoStack.pop()
    if (!command) return false
    command.undo()
    this.redoStack.push(command)
    this.emit({ type: 'undo', command, stackSize: this.undoStack.length, redoSize: this.redoStack.length })
    return true
  }

  /** 重做最后一条被撤销的命令 */
  redo(): boolean {
    const command = this.redoStack.pop()
    if (!command) return false
    command.execute()
    this.undoStack.push(command)
    this.emit({ type: 'redo', command, stackSize: this.undoStack.length, redoSize: this.redoStack.length })
    return true
  }

  // —— 状态查询 ——

  /** 是否可撤销 */
  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  /** 是否可重做 */
  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** undo 栈大小 */
  get undoCount(): number {
    return this.undoStack.length
  }

  /** redo 栈大小 */
  get redoCount(): number {
    return this.redoStack.length
  }

  /** 下一条 undo 命令的 label(用于 UI 显示) */
  get nextUndoLabel(): string | null {
    const cmd = this.undoStack[this.undoStack.length - 1]
    return cmd ? cmd.label : null
  }

  /** 下一条 redo 命令的 label */
  get nextRedoLabel(): string | null {
    const cmd = this.redoStack[this.redoStack.length - 1]
    return cmd ? cmd.label : null
  }

  // —— 管理 ——

  /** 清空所有历史 */
  clear(): void {
    this.undoStack.length = 0
    this.redoStack.length = 0
    this.emit({ type: 'clear', stackSize: 0, redoSize: 0 })
  }

  /** 设置容量限制(不会裁剪已有记录) */
  setLimit(limit: number): void {
    this.limit = limit
  }

  // —— 事件监听 ——

  /** 添加监听器 */
  on(listener: HistoryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: HistoryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (e) {
        console.error('[CommandHistory] listener error:', e)
      }
    }
  }
}
