/**
 * PixelForge Timeline UI — ClipRenderer（Clip 绘制器）。
 *
 * Canvas 上绘制 Clip 矩形。
 *
 * 转换：
 *   x = timeToPixel(clip.timelineStart)
 *   width = timeToPixel(clip.duration)
 *   y = trackIndex * trackHeight
 */

import type { TimelineCanvas } from '../canvas/TimelineCanvas';
import type { Viewport } from '../canvas/TimelineCanvas';
import type { Clip } from '@/timeline/core/clip';
import type { TrackType } from '@/timeline/core/track';
import { TRACK_HEIGHT, TRACK_HEADER_WIDTH } from '../canvas/TimelineRenderer';

/** Clip 视觉颜色。 */
const CLIP_COLORS: Record<TrackType, string> = {
  video: '#1e3a5f',
  audio: '#1e5f3a',
  text: '#3a1e5f',
  effect: '#5f3a1e',
};

/** 选中高亮。 */
const SELECTED_COLOR = '#fbbf24';

/** ClipRenderer — 负责 Clip 的 Canvas 绘制。 */
export class ClipRenderer {
  private canvas: TimelineCanvas;
  private selectedClipId: string | null = null;

  constructor(canvas: TimelineCanvas) {
    this.canvas = canvas;
  }

  /** 设置选中 Clip。 */
  setSelectedClip(clipId: string | null): void {
    this.selectedClipId = clipId;
  }

  /**
   * 绘制单个 Clip。
   *
   * @param clip    Clip 数据
   * @param y       Y 坐标（轨道行 Y）
   * @param viewport 视口
   * @param trackType 轨道类型（决定颜色）
   */
  drawClip(
    clip: Clip,
    y: number,
    viewport: Viewport,
    trackType: TrackType,
  ): void {
    const startSec = Number(clip.timelineStart) / 1000000;
    const durSec = Number(clip.duration) / 1000000;

    const x = startSec * viewport.zoom - viewport.scrollX + TRACK_HEADER_WIDTH;
    const width = durSec * viewport.zoom;

    // 跳过不可见 Clip
    if (x + width < TRACK_HEADER_WIDTH || x > viewport.width) return;

    const isSelected = clip.id === this.selectedClipId;
    const bgColor = CLIP_COLORS[trackType] ?? '#333333';

    // Clip 矩形
    this.canvas.drawRect(
      x,
      y + 2,
      Math.max(width - 2, 1),
      TRACK_HEIGHT - 4,
      isSelected ? SELECTED_COLOR : bgColor,
    );

    // Clip 边框
    this.canvas.drawLine(
      x,
      y + 2,
      x,
      y + TRACK_HEIGHT - 2,
      { strokeStyle: isSelected ? '#f59e0b' : '#00000033', lineWidth: 1 },
    );

    // Clip 文字标签
    if (width > 30) {
      this.canvas.drawText(
        clip.assetId,
        x + 4,
        y + TRACK_HEIGHT / 2 + 4,
        { font: '11px sans-serif', fillStyle: '#e5e7eb' },
      );
    }
  }
}
