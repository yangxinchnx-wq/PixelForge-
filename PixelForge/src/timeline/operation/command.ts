/**
 * PixelForge Timeline Core — Command 命令接口。
 *
 * 所有编辑操作都封装为 Command，支持 execute / undo。
 * 配合 CommandStack 实现 Undo / Redo 历史。
 */

/** 命令接口。 */
export interface Command {
  /** 执行操作 */
  execute(): void;
  /** 撤销操作 */
  undo(): void;
}
