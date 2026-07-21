/**
 * PixelForge Timeline UI — SelectTool（选择工具）。
 *
 * 点击 Clip 选中，拖动 Clip 移动。
 */

import type { TimelineTool, ToolMouseEvent } from './timelineTool';

/** 选择工具。 */
export class SelectTool implements TimelineTool {
  name = 'select';
  private isDragging = false;
  private downX = 0;
  private downY = 0;

  onDown(event: ToolMouseEvent): void {
    this.downX = event.x;
    this.downY = event.y;
    this.isDragging = false;
  }

  onMove(event: ToolMouseEvent): void {
    if (Math.abs(event.x - this.downX) > 3 || Math.abs(event.y - this.downY) > 3) {
      this.isDragging = true;
    }
  }

  onUp(_event: ToolMouseEvent): void {
    this.isDragging = false;
  }

  /** 当前是否在拖动。 */
  get isDrag(): boolean {
    return this.isDragging;
  }
}
