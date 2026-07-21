/**
 * PixelForge Timeline UI — TimelineCanvas。
 *
 * Canvas 2D 画布管理器。
 *
 * 视频编辑器 Timeline 是高性能二维编辑器，
 * 不能用 v-for 渲染大量 DOM（电影工程 50 tracks 50000 clips 会崩溃）。
 * 使用 Canvas + DOM 混合方案。
 */

/** Viewport 视口状态。 */
export interface Viewport {
  /** 水平滚动位置（像素） */
  scrollX: number;
  /** 垂直滚动位置（像素） */
  scrollY: number;
  /** 缩放：每秒像素数（pixelsPerSecond） */
  zoom: number;
  /** 视口宽度（像素） */
  width: number;
  /** 视口高度（像素） */
  height: number;
}

/**
 * TimelineCanvas — 管理 Canvas 2D 上下文。
 *
 * 用法：
 *   const canvas = new TimelineCanvas(htmlCanvasElement);
 *   canvas.setViewport({ scrollX: 0, scrollY: 0, zoom: 100, width: 800, height: 600 });
 *   canvas.clear();
 *   canvas.drawRect(0, 0, 100, 40, '#3b82f6');
 */
export class TimelineCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  private viewport: Viewport;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法创建 Canvas 2D 上下文');
    }
    this.ctx = ctx;
    this.viewport = {
      scrollX: 0,
      scrollY: 0,
      zoom: 100,
      width: canvas.width,
      height: canvas.height,
    };
  }

  /** 初始化 Canvas 尺寸。 */
  init(): void {
    this.ctx = this.canvas.getContext('2d') ?? this.ctx;
    this.syncSize();
  }

  /** 同步 Canvas 尺寸到 DOM 元素。 */
  syncSize(): void {
    this.canvas.width = this.viewport.width;
    this.canvas.height = this.viewport.height;
  }

  /** 设置视口。 */
  setViewport(viewport: Partial<Viewport>): void {
    this.viewport = { ...this.viewport, ...viewport };
    this.syncSize();
  }

  /** 获取视口。 */
  getViewport(): Viewport {
    return this.viewport;
  }

  /** 清空画布。 */
  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 时间转像素（考虑视口 scrollX 和 zoom）。
   * pixel = time × zoom - scrollX
   */
  timeToPixel(time: number): number {
    return (time * this.viewport.zoom) - this.viewport.scrollX;
  }

  /**
   * 像素转时间（考虑视口 scrollX 和 zoom）。
   * time = (pixel + scrollX) / zoom
   */
  pixelToTime(pixel: number): number {
    return (pixel + this.viewport.scrollX) / this.viewport.zoom;
  }

  /** 绘制矩形。 */
  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    fillStyle: string,
  ): void {
    this.ctx.fillStyle = fillStyle;
    this.ctx.fillRect(x, y, width, height);
  }

  /** 绘制文本。 */
  drawText(
    text: string,
    x: number,
    y: number,
    options?: { font?: string; fillStyle?: string },
  ): void {
    this.ctx.font = options?.font ?? '12px sans-serif';
    this.ctx.fillStyle = options?.fillStyle ?? '#e5e7eb';
    this.ctx.fillText(text, x, y);
  }

  /** 绘制直线。 */
  drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: { strokeStyle?: string; lineWidth?: number },
  ): void {
    this.ctx.strokeStyle = options?.strokeStyle ?? '#ef4444';
    this.ctx.lineWidth = options?.lineWidth ?? 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }

  /** 绘制图片（用于缩略图）。 */
  drawImage(
    image: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    this.ctx.drawImage(image, x, y, width, height);
  }
}
