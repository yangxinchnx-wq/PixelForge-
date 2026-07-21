/**
 * PixelForge Timeline UI — TimelineRenderer。
 *
 * Canvas 渲染器：读取 Timeline Store 状态，计算可见 Clip，绘制到 Canvas。
 *
 * 渲染循环：
 *   Frame → 读取 Timeline State → 计算可见 Clip → 绘制 → 下一帧
 *
 * 不能事件驱动，需要持续刷新（requestAnimationFrame）。
 */

import type { TimelineCanvas, Viewport } from './TimelineCanvas';
import type { Track, TrackType } from '@/timeline/core/track';
import type { Clip } from '@/timeline/core/clip';

/** 轨道视觉参数。 */
export const TRACK_HEIGHT = 40;
export const TRACK_HEADER_WIDTH = 120;
export const RULER_HEIGHT = 24;

/** 轨道类型颜色。 */
const TRACK_COLORS: Record<TrackType, string> = {
  video: '#1e3a5f',
  audio: '#1e5f3a',
  text: '#3a1e5f',
  effect: '#5f3a1e',
};

/** 选中 Clip 高亮颜色。 */
const SELECTED_COLOR = '#fbbf24';

/**
 * TimelineRenderer — 负责把 Timeline 数据绘制到 Canvas。
 */
export class TimelineRenderer {
  private canvas: TimelineCanvas;
  private playhead: number = 0;
  private selectedClipId: string | null = null;

  constructor(canvas: TimelineCanvas) {
    this.canvas = canvas;
  }

  /** 设置播放头位置（秒）。 */
  setPlayhead(time: number): void {
    this.playhead = time;
  }

  /** 设置选中 Clip。 */
  setSelectedClip(clipId: string | null): void {
    this.selectedClipId = clipId;
  }

  /**
   * 绘制一帧。
   *
   * @param tracks   所有轨道
   * @param viewport 视口
   */
  draw(tracks: Track[], viewport: Viewport): void {
    this.canvas.clear();

    // 1. 绘制轨道背景
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      const y = i * TRACK_HEIGHT - viewport.scrollY;

      // 跳过不可见轨道
      if (y + TRACK_HEIGHT < 0 || y > viewport.height) continue;

      // 轨道背景
      this.canvas.drawRect(
        TRACK_HEADER_WIDTH,
        y,
        viewport.width - TRACK_HEADER_WIDTH,
        TRACK_HEIGHT,
        track.enabled ? '#1a1a2e' : '#0d0d1a',
      );

      // 轨道分隔线
      this.canvas.drawLine(
        TRACK_HEADER_WIDTH,
        y,
        viewport.width,
        y,
        { strokeStyle: '#2a2a3e', lineWidth: 1 },
      );
    }

    // 2. 绘制 Clip
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track.enabled) continue;

      const y = i * TRACK_HEIGHT - viewport.scrollY;
      if (y + TRACK_HEIGHT < 0 || y > viewport.height) continue;

      for (const clip of track.clips) {
        this.drawClip(clip, y, viewport, track.type);
      }
    }

    // 3. 绘制播放头
    this.drawPlayhead(viewport);
  }

  /** 绘制单个 Clip。 */
  private drawClip(
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
    const bgColor = TRACK_COLORS[trackType] ?? '#333';

    this.canvas.drawRect(
      x,
      y + 2,
      Math.max(width - 2, 1),
      TRACK_HEIGHT - 4,
      isSelected ? SELECTED_COLOR : bgColor,
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

  /** 绘制播放头红线。 */
  private drawPlayhead(viewport: Viewport): void {
    const x = this.playhead * viewport.zoom - viewport.scrollX + TRACK_HEADER_WIDTH;
    if (x < TRACK_HEADER_WIDTH || x > viewport.width) return;

    this.canvas.drawLine(
      x,
      0,
      x,
      viewport.height,
      { strokeStyle: '#ef4444', lineWidth: 2 },
    );
  }
}

/**
 * 渲染循环：requestAnimationFrame 驱动。
 *
 * @param renderer  渲染器
 * @param getTracks  获取轨道列表的函数
 * @param getViewport 获取视口的函数
 */
export function startRenderLoop(
  renderer: TimelineRenderer,
  getTracks: () => Track[],
  getViewport: () => Viewport,
): () => void {
  let running = true;

  function render(): void {
    if (!running) return;
    renderer.draw(getTracks(), getViewport());
    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);

  // 返回停止函数
  return () => {
    running = false;
  };
}
