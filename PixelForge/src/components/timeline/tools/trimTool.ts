/**
 * PixelForge Timeline UI — TrimTool（裁剪工具）。
 *
 * 拖动 Clip 左右边缘改变长度。
 */

import type { TimelineTool, ToolMouseEvent } from './timelineTool';

/** 裁剪工具。 */
export class TrimTool implements TimelineTool {
  name = 'trim';

  onDown(_event: ToolMouseEvent): void {
    // 检测点击是否在 Clip 边缘
  }

  onMove(_event: ToolMouseEvent): void {
    // 拖动改变 duration / sourceStart
  }

  onUp(_event: ToolMouseEvent): void {
    // 生成 TrimClipCommand
  }
}
