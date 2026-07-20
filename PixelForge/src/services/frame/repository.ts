import type { RuntimeFrameRecord } from '@/runtime/types'
import type { FrameRepository } from './types'

/**
 * 内存版仓储实现。
 *
 * 当前作为测试环境和 fallback 默认实现。
 * 不持久化数据，页面刷新后数据丢失。
 * 生产环境应使用 IndexedDBFrameRepository。
 */
export class InMemoryFrameRepository implements FrameRepository {
  private frames = new Map<number, RuntimeFrameRecord>()

  constructor(initialFrames: RuntimeFrameRecord[] = []) {
    initialFrames.forEach((frame) => {
      this.frames.set(frame.frame, frame)
    })
  }

  listFrames(): RuntimeFrameRecord[] {
    return Array.from(this.frames.values()).sort((a, b) => a.frame - b.frame)
  }

  getFrame(frame: number): RuntimeFrameRecord | undefined {
    return this.frames.get(frame)
  }

  upsertFrame(frame: RuntimeFrameRecord): void {
    this.frames.set(frame.frame, frame)
  }

  clear(): void {
    this.frames.clear()
  }

  async initialize(): Promise<void> {
    // 内存实现无需初始化
  }

  async flush(): Promise<void> {
    // 内存实现无需 flush
  }

  isPersistent(): boolean {
    return false
  }
}
