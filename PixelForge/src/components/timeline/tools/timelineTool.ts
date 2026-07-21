/**
 * PixelForge Timeline UI — TimelineTool 工具接口。
 *
 * 不要写大量 if，建立工具系统。
 *
 * 接口：
 *   onDown()  鼠标按下
 *   onMove()  鼠标移动
 *   onUp()    鼠标释放
 */

/** 鼠标事件参数。 */
export interface ToolMouseEvent {
  /** 鼠标 X 坐标（像素） */
  x: number;
  /** 鼠标 Y 坐标（像素） */
  y: number;
  /** 是否按住 Shift */
  shiftKey: boolean;
  /** 是否按住 Ctrl */
  ctrlKey: boolean;
}

/** Timeline 工具接口。 */
export interface TimelineTool {
  /** 工具名称 */
  name: string;
  /** 鼠标按下 */
  onDown(event: ToolMouseEvent): void;
  /** 鼠标移动 */
  onMove(event: ToolMouseEvent): void;
  /** 鼠标释放 */
  onUp(event: ToolMouseEvent): void;
}
