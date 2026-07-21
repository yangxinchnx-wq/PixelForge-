/**
 * PixelForge Media Video — FrameScheduler（帧调度器）。
 *
 * 控制什么时候请求帧。
 *
 * 状态：
 *   FrameRequest { time, priority }
 *
 * 播放：高优先级（当前帧）
 * 缩略图：低优先级（未来帧）
 */

/** 帧请求。 */
export interface FrameRequest {
  /** 请求的时间（微秒） */
  time: number;
  /** 优先级（越大越高） */
  priority: number;
}

/** 帧请求优先级常量。 */
export const PRIORITY = {
  /** 播放当前帧（最高） */
  PLAYBACK: 100,
  /** Seek 后的即时帧 */
  SEEK: 90,
  /** 缩略图生成（低） */
  THUMBNAIL: 10,
} as const;

/**
 * FrameScheduler — 管理帧请求队列，按优先级调度。
 *
 * 用法：
 *   const scheduler = new FrameScheduler();
 *   scheduler.request({ time: 10000000, priority: PRIORITY.PLAYBACK });
 *   const next = scheduler.next();  // 取出最高优先级请求
 */
export class FrameScheduler {
  private queue: FrameRequest[] = [];

  /** 添加帧请求。 */
  request(req: FrameRequest): void {
    this.queue.push(req);
  }

  /** 取出下一个最高优先级的帧请求（并从队列移除）。 */
  next(): FrameRequest | null {
    if (this.queue.length === 0) return null;

    // 找到最高优先级
    let maxIdx = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.queue[i].priority > this.queue[maxIdx].priority) {
        maxIdx = i;
      }
    }

    return this.queue.splice(maxIdx, 1)[0] ?? null;
  }

  /** 清空队列。 */
  clear(): void {
    this.queue = [];
  }

  /** 队列大小。 */
  get size(): number {
    return this.queue.length;
  }
}
