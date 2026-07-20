/**
 * Command(Step 31.1)— 命令模式接口。
 *
 * 核心设计:
 * 所有时间轴操作(移动/裁剪/删除/剪切 Clip)都封装为 Command。
 * Command 提供 execute() 和 undo(),支持 Ctrl+Z / Ctrl+Y。
 *
 * 用法:
 *   const cmd = new MoveClipCommand(state, clipId, newStart)
 *   history.execute(cmd)   // 执行 + 入栈
 *   history.undo()         // 撤销
 *   history.redo()          // 重做
 */

import type { Sequence } from '../core/sequence'

// ============================================================================
// 1. Command 接口
// ============================================================================

/**
 * Command — 可撤销的操作。
 *
 * @property id        命令 ID(用于调试 / 日志)
 * @property label     显示名称(如 "移动片段")
 * @property execute  执行操作
 * @property undo      撤销操作
 */
export interface Command {
  readonly id: string
  readonly label: string
  execute(): void
  undo(): void
}

// ============================================================================
// 2. 可变状态容器(命令操作的目标)
// ============================================================================

/**
 * MutableSequenceState — 可变的 Sequence 状态容器。
 *
 * Pinia store 持有 sequence,Command 通过此接口读写。
 * 命令执行后调用 notify() 触发 store 更新。
 *
 * 设计原因:
 * - Command 需要直接修改 sequence(不可变更新太慢,且命令已有 undo 保障)
 * - 但 Vue 响应式需要通过 store 的 setter 通知
 * - 所以 command 操作 mutable state,然后 notify store
 */
export interface MutableSequenceState {
  /** 可变的 Sequence(命令直接修改其属性) */
  sequence: Sequence
  /** 通知 store 状态已变更(触发响应式更新 + 重建索引) */
  notify: () => void
}

// ============================================================================
// 3. 基类
// ============================================================================

/**
 * BaseCommand — 命令基类,提供通用功能。
 *
 * 子类只需实现 doExecute() 和 doUndo(),
 * 基类负责状态管理和通知。
 */
export abstract class BaseCommand implements Command {
  abstract readonly id: string
  abstract readonly label: string

  protected state: MutableSequenceState
  private _executed = false

  constructor(state: MutableSequenceState) {
    this.state = state
  }

  /** 是否已执行 */
  get executed(): boolean {
    return this._executed
  }

  execute(): void {
    if (this._executed) return
    this.doExecute()
    this._executed = true
    this.state.notify()
  }

  undo(): void {
    if (!this._executed) return
    this.doUndo()
    this._executed = false
    this.state.notify()
  }

  /** 子类实现:实际执行逻辑 */
  protected abstract doExecute(): void

  /** 子类实现:实际撤销逻辑 */
  protected abstract doUndo(): void
}

// ============================================================================
// 4. 命令 ID 生成
// ============================================================================

let commandIdCounter = 0

/** 生成唯一命令 ID */
export function genCommandId(prefix: string = 'cmd'): string {
  commandIdCounter++
  return `${prefix}_${commandIdCounter.toString(36)}`
}
