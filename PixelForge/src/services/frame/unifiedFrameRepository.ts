import type { RuntimeFrameRecord } from '@/runtime/types'
import type { FrameRepository } from './types'
import { unifiedStore } from '@/storage'

// ============================================================================
// 类型化数组序列化
// ============================================================================

/** 类型化数组的 JSON 标记类型 */
interface TypedArrayMarker {
  __typed: string
  data: number[]
}

/** 判断是否为类型化数组 */
function isTypedArray(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value) && !(value instanceof DataView)
}

/** 自定义序列化：typed array → marker 对象 */
function serializeReplacer(_key: string, value: unknown): unknown {
  if (isTypedArray(value)) {
    return {
      __typed: value.constructor.name,
      data: Array.from(value as unknown as number[]),
    } satisfies TypedArrayMarker
  }
  return value
}

/** 自定义反序列化：marker 对象 → typed array */
function deserializeReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__typed' in value) {
    const marker = value as TypedArrayMarker
    const TypedArrayCtor = (globalThis as Record<string, unknown>)[marker.__typed] as
      | { new (arr: number[]): ArrayBufferView }
      | undefined
    if (TypedArrayCtor) {
      return new TypedArrayCtor(marker.data)
    }
  }
  return value
}

/** 将帧记录序列化为 JSON（保留 typed array 类型信息） */
function serializeFrame(record: RuntimeFrameRecord): string {
  return JSON.stringify(record, serializeReplacer)
}

/** 从 JSON 反序列化帧记录（恢复 typed array） */
function deserializeFrame(json: string): RuntimeFrameRecord {
  return JSON.parse(json, deserializeReviver) as RuntimeFrameRecord
}

// ============================================================================
// UnifiedFrameRepository
// ============================================================================

/** 帧记录在 L3 中的 key 前缀 */
const FRAME_KEY_PREFIX = 'frame_record_'

/** 元数据：帧号列表的 key */
const FRAME_INDEX_KEY = 'frame_index'

/**
 * 基于 UnifiedStore 的帧仓储实现。
 *
 * 架构：write-behind cache
 * - 内存 Map 作为热读缓存（同步读路径直接命中）
 * - upsertFrame 同步写缓存 + 异步写 UnifiedStore（L1+L2+L3）
 * - initialize 从 UnifiedStore 加载全部帧到缓存
 *
 * 与 IndexedDBFrameRepository 的区别：
 * - 使用三层存储（L1 LRU + L2 OPFS + L3 Redb）替代单层 IndexedDB
 * - 帧记录 JSON 序列化存储（typed array 通过 marker 保留类型）
 * - 帧号索引存储在 metadata 中，支持快速列举
 *
 * 降级策略：
 * - UnifiedStore 内部已处理 OPFS/Tauri 不可用的降级
 * - 若 L3 写入失败，仅打印警告，不影响同步读路径
 */
export class UnifiedFrameRepository implements FrameRepository {
  private cache = new Map<number, RuntimeFrameRecord>()
  private pendingWrites = new Set<Promise<void>>()
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    try {
      // 读取帧号索引
      const indexJson = await unifiedStore.readMetadata(FRAME_INDEX_KEY)
      if (!indexJson) return

      const frameNumbers = JSON.parse(indexJson) as number[]
      // 并行加载所有帧记录
      const records = await Promise.all(
        frameNumbers.map(async (n) => {
          const json = await unifiedStore.readMetadata(`${FRAME_KEY_PREFIX}${n}`)
          return json ? deserializeFrame(json) : null
        })
      )

      for (const record of records) {
        if (record) {
          this.cache.set(record.frame, record)
        }
      }
    } catch (e) {
      console.warn('[UnifiedFrameRepository] 初始化加载失败，以空状态启动', e)
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

    // 异步写 UnifiedStore
    const writePromise = this.asyncUpsert(frame)
    this.pendingWrites.add(writePromise)
    writePromise.finally(() => {
      this.pendingWrites.delete(writePromise)
    })
  }

  clear(): void {
    // 同步清内存
    const frameNumbers = Array.from(this.cache.keys())
    this.cache.clear()

    // 异步清 UnifiedStore
    const clearPromise = this.asyncClear(frameNumbers)
    this.pendingWrites.add(clearPromise)
    clearPromise.finally(() => {
      this.pendingWrites.delete(clearPromise)
    })
  }

  async flush(): Promise<void> {
    await Promise.all(Array.from(this.pendingWrites))
  }

  isPersistent(): boolean {
    // UnifiedStore 总是可用的（最差降级到内存），但只有 L3 持久化才算 true
    // 简化：返回 true，因为 unifiedStore 内部会处理持久化
    return true
  }

  // ------------------------------------------------------------------------
  // 内部方法
  // ------------------------------------------------------------------------

  private async asyncUpsert(frame: RuntimeFrameRecord): Promise<void> {
    try {
      // 写入帧记录
      const json = serializeFrame(frame)
      await unifiedStore.writeMetadata(`${FRAME_KEY_PREFIX}${frame.frame}`, json)

      // 更新帧号索引
      await this.updateFrameIndex()
    } catch (e) {
      console.warn(`[UnifiedFrameRepository] 写入帧 ${frame.frame} 失败`, e)
    }
  }

  private async asyncClear(frameNumbers: number[]): Promise<void> {
    try {
      // 删除所有帧记录
      await Promise.all(
        frameNumbers.map((n) =>
          unifiedStore.deleteMetadata(`${FRAME_KEY_PREFIX}${n}`)
        )
      )
      // 删除索引
      await unifiedStore.deleteMetadata(FRAME_INDEX_KEY)
    } catch (e) {
      console.warn('[UnifiedFrameRepository] 清空帧存储失败', e)
    }
  }

  /** 更新帧号索引（去重 + 排序） */
  private async updateFrameIndex(): Promise<void> {
    const frameNumbers = Array.from(this.cache.keys()).sort((a, b) => a - b)
    await unifiedStore.writeMetadata(
      FRAME_INDEX_KEY,
      JSON.stringify(frameNumbers)
    )
  }
}
