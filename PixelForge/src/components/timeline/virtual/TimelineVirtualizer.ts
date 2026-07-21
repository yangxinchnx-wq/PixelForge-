/**
 * PixelForge Timeline UI — TimelineVirtualizer（虚拟滚动）。
 *
 * 大型项目（1000 轨道）不能全部绘制。
 * 计算当前 scrollY，只画可见轨道。
 *
 * 例如：轨道高度 40px，窗口高度 800px，只需要 20 轨。
 */

/** 虚拟滚动计算结果。 */
export interface VirtualRange {
  /** 可见轨道起始索引 */
  start: number;
  /** 可见轨道结束索引（不含） */
  end: number;
  /** 可见轨道数量 */
  count: number;
}

/**
 * 计算可见轨道范围。
 *
 * @param scrollY     垂直滚动位置
 * @param viewportHeight 视口高度
 * @param trackHeight  单轨高度
 * @param totalTracks  总轨道数
 * @returns 可见轨道范围
 */
export function computeVisibleRange(
  scrollY: number,
  viewportHeight: number,
  trackHeight: number,
  totalTracks: number,
): VirtualRange {
  const start = Math.max(0, Math.floor(scrollY / trackHeight));
  const visibleCount = Math.ceil(viewportHeight / trackHeight) + 1;
  const end = Math.min(totalTracks, start + visibleCount);

  return {
    start,
    end,
    count: end - start,
  };
}

/**
 * TimelineVirtualizer — 管理虚拟滚动。
 *
 * 用法：
 *   const v = new TimelineVirtualizer(40);
 *   v.update(scrollY, 800, totalTracks);
 *   const visible = v.getVisibleRange();
 */
export class TimelineVirtualizer {
  private trackHeight: number;
  private range: VirtualRange = { start: 0, end: 0, count: 0 };

  constructor(trackHeight: number = 40) {
    this.trackHeight = trackHeight;
  }

  /** 设置单轨高度。 */
  setTrackHeight(height: number): void {
    this.trackHeight = height;
  }

  /**
   * 更新可见范围。
   *
   * @param scrollY       当前垂直滚动位置
   * @param viewportHeight 视口高度
   * @param totalTracks    总轨道数
   */
  update(scrollY: number, viewportHeight: number, totalTracks: number): void {
    this.range = computeVisibleRange(
      scrollY,
      viewportHeight,
      this.trackHeight,
      totalTracks,
    );
  }

  /** 获取可见轨道范围。 */
  getVisibleRange(): VirtualRange {
    return this.range;
  }

  /** 获取轨道 Y 坐标。 */
  getTrackY(trackIndex: number): number {
    return trackIndex * this.trackHeight;
  }
}
