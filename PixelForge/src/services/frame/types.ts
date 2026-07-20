import type { RuntimeFrameRecord } from '@/runtime/types'

/**
 * 帧数据仓储接口。
 *
 * 统一约束：
 * - 前端界面不直接依赖具体持久化/通信方式。
 * - 真实实现可以来自 Pinia、本地缓存、worker、Tauri 命令或后端 API。
 * - 所有实现都必须先输出 RuntimeFrameRecord，再进入 UI 适配层。
 *
 * 阶段五扩展（持久化仓储）：
 * - initialize(): 异步加载持久化数据到内存缓存，启动时调用
 * - flush(): 等待所有挂起的异步写入完成，关闭/导出时调用
 * - isPersistent(): 标识此实现是否真正持久化数据
 *
 * 同步方法（listFrames/getFrame/upsertFrame/clear）操作内存缓存，
 * 异步持久化在后台自动执行（write-behind cache 模式）。
 */
export interface FrameRepository {
  /** 列出所有帧记录（按帧号升序），从内存缓存读取 */
  listFrames(): RuntimeFrameRecord[]

  /** 获取指定帧记录，从内存缓存读取 */
  getFrame(frame: number): RuntimeFrameRecord | undefined

  /** 写入或更新帧记录，同步写入内存缓存 + 异步持久化 */
  upsertFrame(frame: RuntimeFrameRecord): void

  /** 清除所有帧记录，同步清内存 + 异步清持久化 */
  clear(): void

  /**
   * 初始化：从持久化层加载已有数据到内存缓存。
   * 对于非持久化实现，此方法为 no-op。
   * 应在应用启动时调用一次。
   */
  initialize(): Promise<void>

  /**
   * 等待所有挂起的异步写入完成。
   * 用于确保数据在关闭/导出前已全部落盘。
   */
  flush(): Promise<void>

  /** 标识此实现是否真正持久化数据（IndexedDB = true, 内存 = false） */
  isPersistent(): boolean
}
