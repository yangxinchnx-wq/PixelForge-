/**
 * PixelForge Media Video — FrameCache（帧缓存）。
 *
 * 视频编辑不能每次重新解码，需要缓存。
 *
 * 例如：当前 10 秒，缓存 9/10/11 秒。
 * 4K 视频一帧约 8MB，100 帧 800MB，所以使用 LRU。
 *
 * limit = 120（约 120 帧）
 */

/** 帧缓存条目。 */
export interface FrameCacheEntry {
  /** 帧时间戳（微秒） */
  timestamp: number;
  /** 解码后的视频帧 */
  frame: VideoFrame | null;
}

/**
 * FrameCache — 按时间缓存解码后的 VideoFrame。
 *
 * 结构：Map<frameNumber, VideoFrame>
 * LRU 淘汰策略，limit = 120。
 *
 * 用法：
 *   const cache = new FrameCache();
 *   cache.set(30, videoFrame);
 *   const frame = cache.get(30);
 */
export class FrameCache {
  private frames: Map<number, VideoFrame | null> = new Map();
  private limit: number;

  constructor(limit: number = 120) {
    this.limit = limit;
  }

  /**
   * 获取指定帧号的缓存帧。
   *
   * @param frameNumber 帧号
   * @returns VideoFrame，或 undefined（未缓存）
   */
  get(frameNumber: number): VideoFrame | null | undefined {
    const frame = this.frames.get(frameNumber);
    if (frame !== undefined) {
      // 更新为最近使用
      this.frames.delete(frameNumber);
      this.frames.set(frameNumber, frame);
    }
    return frame;
  }

  /**
   * 设置帧缓存（淘汰最旧的）。
   *
   * @param frameNumber 帧号
   * @param frame      VideoFrame
   */
  set(frameNumber: number, frame: VideoFrame | null): void {
    if (this.frames.has(frameNumber)) {
      this.frames.delete(frameNumber);
    } else if (this.frames.size >= this.limit) {
      // 淘汰最旧的（Map 迭代顺序 = 插入顺序）
      const oldest = this.frames.keys().next();
      if (!oldest.done) {
        const oldFrame = this.frames.get(oldest.value);
        if (oldFrame instanceof VideoFrame) {
          oldFrame.close();
        }
        this.frames.delete(oldest.value);
      }
    }
    this.frames.set(frameNumber, frame);
  }

  /** 是否已缓存。 */
  has(frameNumber: number): boolean {
    return this.frames.has(frameNumber);
  }

  /** 当前缓存大小。 */
  get size(): number {
    return this.frames.size;
  }

  /** 清空缓存（关闭所有 VideoFrame）。 */
  clear(): void {
    for (const frame of this.frames.values()) {
      if (frame instanceof VideoFrame) {
        frame.close();
      }
    }
    this.frames.clear();
  }

  /** 设置缓存上限。 */
  setLimit(limit: number): void {
    this.limit = limit;
    while (this.frames.size > limit) {
      const oldest = this.frames.keys().next();
      if (oldest.done) break;
      const oldFrame = this.frames.get(oldest.value);
      if (oldFrame instanceof VideoFrame) {
        oldFrame.close();
      }
      this.frames.delete(oldest.value);
    }
  }
}
