import type { RuntimeFrameRecord } from '@/runtime/types'

/**
 * 帧数据仓储接口。
 *
 * 统一约束：
 * - 前端界面不直接依赖具体持久化/通信方式。
 * - 真实实现可以来自 Pinia、本地缓存、worker、Tauri 命令或后端 API。
 * - 所有实现都必须先输出 RuntimeFrameRecord，再进入 UI 适配层。
 */
export interface FrameRepository {
  listFrames(): RuntimeFrameRecord[]
  getFrame(frame: number): RuntimeFrameRecord | undefined
  upsertFrame(frame: RuntimeFrameRecord): void
  clear(): void
}
