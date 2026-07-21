/**
 * PixelForge Timeline UI — TimelineMouse（鼠标交互层）。
 *
 * 事件：mousedown, mousemove, mouseup
 *
 * 流程：
 *   Mouse → Hit Test → Tool → Command → Store → Render
 *
 * 不要让 Vue 直接改数据：
 *   错误：Vue MouseMove → clip.start = ...
 *   正确：Vue → Interaction Controller → Command → Store → Renderer
 */

import type { TimelineTool, ToolMouseEvent } from '../tools/timelineTool';
import { hitTestClip, type ClipRect } from '@/timeline/utils/collision';

/** 鼠标交互管理器。 */
export class TimelineMouse {
  private currentTool: TimelineTool | null = null;

  /** 设置当前工具。 */
  setTool(tool: TimelineTool): void {
    this.currentTool = tool;
  }

  /** 鼠标按下。 */
  onMouseDown(event: ToolMouseEvent): void {
    this.currentTool?.onDown(event);
  }

  /** 鼠标移动。 */
  onMouseMove(event: ToolMouseEvent): void {
    this.currentTool?.onMove(event);
  }

  /** 鼠标释放。 */
  onMouseUp(event: ToolMouseEvent): void {
    this.currentTool?.onUp(event);
  }

  /**
   * 点击检测：鼠标坐标 → Clip ID。
   *
   * @param px    鼠标 X
   * @param py    鼠标 Y
   * @param rects 所有 Clip 的矩形区域列表
   * @returns 命中的 Clip ID，或 null
   */
  hitTest(
    px: number,
    py: number,
    rects: ClipRect[],
  ): string | null {
    for (const rect of rects) {
      if (hitTestClip(px, py, rect)) {
        return rect.clipId;
      }
    }
    return null;
  }
}
