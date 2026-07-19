import type { RuntimeFrameRecord } from '@/runtime/types'
import type { FrameRepository } from './types'

/**
 * 内存版仓储实现。
 *
 * 当前作为前端默认实现，后续可替换为：
 * - Pinia 持久仓储
 * - Tauri bridge 仓储
 * - 回放文件仓储
 * - 远端调试会话仓储
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
}
