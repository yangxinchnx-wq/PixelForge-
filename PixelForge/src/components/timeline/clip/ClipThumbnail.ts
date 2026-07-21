/**
 * PixelForge Timeline UI — ClipThumbnail（Clip 缩略图）。
 *
 * 视频编辑器核心：不是显示蓝色块，需要显示视频帧缩略图。
 *
 * 流程：
 *   Video Asset → Seek Frame → VideoFrame → ImageBitmap → Cache → Canvas
 *
 * 缩略图绘制：
 *   Clip 内部排列多个缩略图帧
 *   [ ][ ][ ][ ]
 */

import type { TimelineCanvas } from '../canvas/TimelineCanvas';
import type { Viewport } from '../canvas/TimelineCanvas';
import { TRACK_HEIGHT, TRACK_HEADER_WIDTH } from '../canvas/TimelineRenderer';

/** 缩略图缓存条目。 */
export interface ThumbnailEntry {
  /** 对应的时间戳（秒） */
  time: number;
  /** 缩略图图片 */
  bitmap: ImageBitmap | null;
}

/**
 * ClipThumbnail — 管理 Clip 的视频缩略图绘制。
 *
 * 不能每次重新解码，需要缓存。
 */
export class ClipThumbnail {
  private canvas: TimelineCanvas;
  /** assetId → 缩略图列表 */
  private cache: Map<string, ThumbnailEntry[]> = new Map();

  constructor(canvas: TimelineCanvas) {
    this.canvas = canvas;
  }

  /**
   * 设置某 asset 的缩略图列表。
   *
   * @param assetId   素材 ID
   * @param entries   缩略图列表
   */
  setThumbnails(assetId: string, entries: ThumbnailEntry[]): void {
    this.cache.set(assetId, entries);
  }

  /**
   * 绘制 Clip 的缩略图。
   *
   * @param assetId  素材 ID
   * @param x        Clip X 坐标
   * @param y        Clip Y 坐标
   * @param width    Clip 宽度
   * @param viewport 视口
   */
  drawThumbnails(
    assetId: string,
    x: number,
    y: number,
    width: number,
    viewport: Viewport,
  ): void {
    const entries = this.cache.get(assetId);
    if (!entries || entries.length === 0) return;

    // 计算每个缩略图的宽度
    const thumbWidth = TRACK_HEIGHT - 4;
    const thumbHeight = TRACK_HEIGHT - 4;
    const count = Math.floor(width / thumbWidth);

    for (let i = 0; i < count && i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.bitmap) continue;

      const thumbX = x + i * thumbWidth;
      if (thumbX + thumbWidth < TRACK_HEADER_WIDTH || thumbX > viewport.width) continue;

      this.canvas.drawImage(
        entry.bitmap,
        thumbX,
        y + 2,
        thumbWidth,
        thumbHeight,
      );
    }
  }

  /** 清空缓存。 */
  clearCache(): void {
    this.cache.clear();
  }
}
