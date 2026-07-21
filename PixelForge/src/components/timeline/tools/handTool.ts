/**
 * PixelForge Timeline UI — HandTool（手型工具）。
 *
 * 拖动平移时间轴视图。
 */

import type { TimelineTool, ToolMouseEvent } from './timelineTool';

/** 手型工具。 */
export class HandTool implements TimelineTool {
  name = 'hand';
  private panStartX = 0;
  private isPanning = false;
  /** 当前帧的 X 偏移量（供 controller 读取平移） */
  deltaX = 0;

  onDown(event: ToolMouseEvent): void {
    this.panStartX = event.x;
    this.isPanning = true;
    this.deltaX = 0;
  }

  onMove(event: ToolMouseEvent): void {
    if (!this.isPanning) return;
    this.deltaX = event.x - this.panStartX;
    this.panStartX = event.x;
  }

  onUp(_event: ToolMouseEvent): void {
    this.isPanning = false;
    this.deltaX = 0;
  }

  /** 是否在平移。 */
  get isPan(): boolean {
    return this.isPanning;
  }
}
