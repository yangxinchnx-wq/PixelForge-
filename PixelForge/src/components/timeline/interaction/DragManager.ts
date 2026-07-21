/**
 * PixelForge Timeline UI — DragManager（拖动管理器）。
 *
 * 管理拖动操作的生命周期：
 *   mousedown → 找到 clip
 *   mousemove → 计算 delta
 *   mouseup   → MoveClipCommand
 */

import type { ToolMouseEvent } from '../tools/timelineTool';

/** 拖动状态。 */
export type DragState = 'idle' | 'dragging' | 'trimming';

/** 拖动管理器。 */
export class DragManager {
  private state: DragState = 'idle';
  private startX = 0;
  private startY = 0;
  private currentX = 0;
  private currentY = 0;

  /** 开始拖动。 */
  startDrag(event: ToolMouseEvent): void {
    this.startX = event.x;
    this.startY = event.y;
    this.currentX = event.x;
    this.currentY = event.y;
    this.state = 'dragging';
  }

  /** 更新拖动位置。 */
  updateDrag(event: ToolMouseEvent): void {
    this.currentX = event.x;
    this.currentY = event.y;
  }

  /** 结束拖动。 */
  endDrag(): void {
    this.state = 'idle';
  }

  /** 获取 X 方向偏移量（相对于拖动起点）。 */
  getDeltaX(): number {
    return this.currentX - this.startX;
  }

  /** 获取 Y 方向偏移量。 */
  getDeltaY(): number {
    return this.currentY - this.startY;
  }

  /** 当前是否在拖动。 */
  get isActive(): boolean {
    return this.state === 'dragging';
  }

  /** 当前拖动状态。 */
  get dragState(): DragState {
    return this.state;
  }
}
