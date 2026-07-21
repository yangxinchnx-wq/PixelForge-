/**
 * PixelForge Timeline UI — BladeTool（切割工具）。
 *
 * 快捷键：C
 * 点击 Clip 在当前位置切割。
 */

import type { TimelineTool, ToolMouseEvent } from './timelineTool';

/** 切割工具。 */
export class BladeTool implements TimelineTool {
  name = 'blade';

  onDown(_event: ToolMouseEvent): void {
    // 点击位置由 controller 转为时间，调用 BladeTool.split
  }

  onMove(_event: ToolMouseEvent): void {
    // 切割工具不需要 move
  }

  onUp(_event: ToolMouseEvent): void {
    // 切割在 down 时完成
  }
}
