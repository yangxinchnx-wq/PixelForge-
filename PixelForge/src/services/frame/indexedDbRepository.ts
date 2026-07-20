import type { RuntimeFrameRecord } from '@/runtime/types'
import type { FrameRepository } from './types'

// ============================================================================
// 常量
// ============================================================================

const DB_NAME = 'pixelforge'
const DB_VERSION = 1
const FRAME_STORE = 'frames'
const META_STORE = 'meta'
const META_KEY = 'schemaVersion'

/**
 * 当前帧记录持久化 schema 版本。
 * 当帧记录结构发生 breaking change 时递增此版本。
 * initialize() 时检测到版本不匹配会触发迁移逻辑。
 */
const CURRENT_FRAME_SCHEMA_VERSION = 'frame-record-v1'

// ============================================================================
// IndexedDBFrameRepository
// ============================================================================

/**
 * IndexedDB 持久化帧仓储实现。
 *
 * 架构：write-behind cache
 * - 内存 Map 作为热读缓存（所有同步读操作直接命中缓存）
 * - upsertFrame 同步写缓存 + 异步写 IndexedDB
 * - clear 同步清缓存 + 异步清 IndexedDB
 * - initialize 从 IndexedDB 加载全部帧到缓存
 *
 * 持久化特性：
 * - 页面刷新后帧记录可恢复
 * - typed arrays（Uint32Array/Float32Array）通过 structured clone 原生支持
 * - schema 版本存储在 meta store，支持未来迁移
 *
 * 降级策略：
 * - IndexedDB 不可用时（隐私模式/旧浏览器），自动降级为纯内存模式
 * - 异步写入失败时记录错误但不影响同步读路径
 */
export class IndexedDBFrameRepository implements FrameRepository {
  private cache = new Map<number, RuntimeFrameRecord>()
  private db: IDBDatabase | null = null
  private pendingWrites = new Set<Promise<void>>()
  private dbAvailable = true

  /**
   * 初始化：打开 IndexedDB，检查 schema 版本，加载全部帧到缓存。
   * 应在应用启动时调用一次。
   *
   * 如果 IndexedDB 不可用，自动降级为纯内存模式（dbAvailable = false）。
   */
  async initialize(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      this.dbAvailable = false
      return
    }

    try {
      this.db = await this.openDatabase()
      await this.checkAndMigrateSchema()
      await this.loadAllFramesIntoCache()
    } catch (error) {
      // IndexedDB 不可用（隐私模式/权限问题等），降级为内存模式
      console.warn('[IndexedDBFrameRepository] IndexedDB 不可用，降级为内存模式:', error)
      this.dbAvailable = false
      this.db = null
    }
  }

  listFrames(): RuntimeFrameRecord[] {
    return Array.from(this.cache.values()).sort((a, b) => a.frame - b.frame)
  }

  getFrame(frame: number): RuntimeFrameRecord | undefined {
    return this.cache.get(frame)
  }

  upsertFrame(frame: RuntimeFrameRecord): void {
    // 同步写内存缓存
    this.cache.set(frame.frame, frame)

    // 异步写 IndexedDB
    if (this.db && this.dbAvailable) {
      const writePromise = this.asyncUpsert(frame)
      this.pendingWrites.add(writePromise)
      writePromise.finally(() => {
        this.pendingWrites.delete(writePromise)
      })
    }
  }

  clear(): void {
    // 同步清内存
    this.cache.clear()

    // 异步清 IndexedDB
    if (this.db && this.dbAvailable) {
      const clearPromise = this.asyncClear()
      this.pendingWrites.add(clearPromise)
      clearPromise.finally(() => {
        this.pendingWrites.delete(clearPromise)
      })
    }
  }

  /**
   * 等待所有挂起的异步写入完成。
   * 用于确保数据在关闭/导出前已全部落盘。
   */
  async flush(): Promise<void> {
    await Promise.all(Array.from(this.pendingWrites))
  }

  isPersistent(): boolean {
    return this.dbAvailable && this.db !== null
  }

  // ------------------------------------------------------------------------
  // 内部方法
  // ------------------------------------------------------------------------

  /**
   * 打开 IndexedDB 数据库。
   * 如果数据库不存在，创建并初始化 object stores。
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result

        // 帧记录 store：keyPath = 'frame'（帧号）
        if (!db.objectStoreNames.contains(FRAME_STORE)) {
          db.createObjectStore(FRAME_STORE, { keyPath: 'frame' })
        }

        // 元数据 store：key-value 形式
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' })
        }
      }

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  /**
   * 检查存储的 schema 版本，必要时执行迁移。
   *
   * 当前版本 frame-record-v1 是首个版本，无需迁移。
   * 如果发现未知版本（未来版本或损坏数据），清空 store 重新开始。
   */
  private async checkAndMigrateSchema(): Promise<void> {
    if (!this.db) return

    const storedVersion = await this.readMeta(META_KEY)

    if (storedVersion === undefined) {
      // 首次初始化，写入当前版本
      await this.writeMeta(META_KEY, CURRENT_FRAME_SCHEMA_VERSION)
      return
    }

    if (storedVersion === CURRENT_FRAME_SCHEMA_VERSION) {
      // 版本匹配，无需迁移
      return
    }

    // 版本不匹配：当前策略是清空重新开始（首个版本没有旧版可迁移）
    // 未来版本在此添加迁移逻辑
    console.warn(
      `[IndexedDBFrameRepository] schema 版本不匹配 (stored=${storedVersion}, current=${CURRENT_FRAME_SCHEMA_VERSION})，清空存储重新初始化`
    )
    await this.asyncClear()
    await this.writeMeta(META_KEY, CURRENT_FRAME_SCHEMA_VERSION)
  }

  /**
   * 从 IndexedDB 加载全部帧记录到内存缓存。
   */
  private async loadAllFramesIntoCache(): Promise<void> {
    if (!this.db) return

    const records = await this.readAllFrames()
    for (const record of records) {
      this.cache.set(record.frame, record)
    }
  }

  /**
   * 异步写入单条帧记录到 IndexedDB。
   * RuntimeFrameRecord 含 typed arrays，structured clone 原生支持。
   */
  private asyncUpsert(frame: RuntimeFrameRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve()
        return
      }

      const tx = this.db.transaction([FRAME_STORE], 'readwrite')
      const store = tx.objectStore(FRAME_STORE)
      const request = store.put(frame)

      request.onsuccess = () => resolve()
      request.onerror = () => {
        console.error(`[IndexedDBFrameRepository] 写入帧 ${frame.frame} 失败:`, request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 异步清空 IndexedDB 中的全部帧记录。
   */
  private asyncClear(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve()
        return
      }

      const tx = this.db.transaction([FRAME_STORE], 'readwrite')
      const store = tx.objectStore(FRAME_STORE)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => {
        console.error('[IndexedDBFrameRepository] 清空帧存储失败:', request.error)
        reject(request.error)
      }
    })
  }

  /**
   * 从 IndexedDB 读取全部帧记录。
   */
  private readAllFrames(): Promise<RuntimeFrameRecord[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([])
        return
      }

      const tx = this.db.transaction([FRAME_STORE], 'readonly')
      const store = tx.objectStore(FRAME_STORE)
      const request = store.getAll()

      request.onsuccess = () => {
        resolve(request.result as RuntimeFrameRecord[])
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  /**
   * 读取元数据。
   */
  private readMeta(key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(undefined)
        return
      }

      const tx = this.db.transaction([META_STORE], 'readonly')
      const store = tx.objectStore(META_STORE)
      const request = store.get(key)

      request.onsuccess = () => {
        const result = request.result as { key: string; value: unknown } | undefined
        resolve(result?.value)
      }

      request.onerror = () => {
        reject(request.error)
      }
    })
  }

  /**
   * 写入元数据。
   */
  private writeMeta(key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve()
        return
      }

      const tx = this.db.transaction([META_STORE], 'readwrite')
      const store = tx.objectStore(META_STORE)
      const request = store.put({ key, value })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
