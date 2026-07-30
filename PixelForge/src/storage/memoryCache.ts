/**
 * L1 内存 LRU 缓存
 *
 * 读写延迟：~100ns（Map.get / Map.set 是 O(1)）
 * 容量：受 RAM 限制，默认 2GB
 * 用途：当前编辑帧、最近回放帧、活跃着色器、热 prompt
 *
 * 设计要点：
 * - 使用 Map 的插入顺序天然实现 LRU（delete + set 即可重新排序）
 * - 按字节容量淘汰，避免单条大对象撑爆
 * - 支持原子批量操作，避免半途淘汰造成抖动
 * - 提供 hit/miss 统计，便于性能分析
 */

/**
 * 缓存条目类型：二进制数据 + 元信息
 * - binary: 图片/视频帧的 Uint8Array（或任意 typed array）
 * - text: AI 代码、prompt 等文本
 * - json: RenderIR、元数据等结构化数据
 */
export interface CacheEntry<T = unknown> {
  /** 数据载荷，可能是 Uint8Array / string / object */
  data: T
  /** 载荷字节大小（用于容量管理） */
  size: number
  /** 写入时间戳（ms） */
  createdAt: number
  /** 最后访问时间戳（ms） */
  accessedAt: number
  /** 命中次数 */
  hitCount: number
}

export interface MemoryCacheStats {
  /** 当前条目数 */
  entries: number
  /** 当前字节数 */
  bytes: number
  /** 容量上限（字节） */
  maxBytes: number
  /** 总命中次数 */
  hits: number
  /** 总未命中次数 */
  misses: number
  /** 命中率（0-1） */
  hitRate: number
  /** 累计淘汰条目数 */
  evictions: number
}

/**
 * 估算任意值的字节大小。
 * - ArrayBuffer/typed array: byteLength
 * - string: utf8 长度近似
 * - object: JSON 序列化长度近似
 */
export function estimateSize(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) {
    return (value as ArrayBufferView).byteLength
  }
  if (typeof value === 'string') {
    // utf8 近似：每个 ASCII 1 字节，非 ASCII 约 3 字节
    let bytes = 0
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i)
      if (code < 0x80) bytes += 1
      else if (code < 0x800) bytes += 2
      else bytes += 3
    }
    return bytes
  }
  if (typeof value === 'number') return 8
  if (typeof value === 'boolean') return 4
  try {
    return new Blob([JSON.stringify(value)]).size
  } catch {
    return 1024 // 兜底
  }
}

export interface MemoryCacheOptions {
  /** 最大字节容量（默认 2GB） */
  maxBytes?: number
  /** 最大条目数（安全阀，默认 100000） */
  maxEntries?: number
  /** 单条最大字节（超过直接拒绝写入，默认 512MB） */
  maxItemBytes?: number
}

export class MemoryCache {
  private cache = new Map<string, CacheEntry>()
  private maxBytes: number
  private maxEntries: number
  private maxItemBytes: number

  // 统计
  private _hits = 0
  private _misses = 0
  private _evictions = 0
  private _bytes = 0

  constructor(options: MemoryCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024 * 1024
    this.maxEntries = options.maxEntries ?? 100000
    this.maxItemBytes = options.maxItemBytes ?? 512 * 1024 * 1024
  }

  /** 当前已用字节 */
  get bytes(): number {
    return this._bytes
  }

  /** 当前条目数 */
  get size(): number {
    return this.cache.size
  }

  /**
   * 读取数据。命中时更新访问时间与命中次数，并将条目移到末尾（LRU 标记）。
   */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (entry === undefined) {
      this._misses++
      return undefined
    }
    // LRU 重新排序：删后重设
    this.cache.delete(key)
    entry.accessedAt = Date.now()
    entry.hitCount++
    this.cache.set(key, entry)
    this._hits++
    return entry.data as T
  }

  /**
   * 写入数据。若条目已存在则替换（先释放旧条目字节）。
   * 容量不足时按 LRU 顺序淘汰，直到能容纳新条目。
   */
  set<T = unknown>(key: string, data: T): void {
    const size = estimateSize(data)
    if (size > this.maxItemBytes) {
      throw new Error(
        `Item too large: ${size} bytes > maxItemBytes ${this.maxItemBytes}`
      )
    }

    // 旧条目先释放
    const old = this.cache.get(key)
    if (old) {
      this._bytes -= old.size
      this.cache.delete(key)
    }

    // 淘汰到能容纳
    this.evictUntil(size)

    const now = Date.now()
    this.cache.set(key, {
      data,
      size,
      createdAt: now,
      accessedAt: now,
      hitCount: 0,
    })
    this._bytes += size
  }

  /**
   * 批量写入，作为一个原子操作进行容量检查与淘汰。
   * 避免 setA 触发淘汰把 setB 即将写入的互斥条目踢掉。
   */
  setMany<T = unknown>(entries: Array<{ key: string; data: T }>): void {
    let totalNewBytes = 0
    const sizes = new Map<string, number>()
    for (const { key, data } of entries) {
      const size = estimateSize(data)
      if (size > this.maxItemBytes) {
        throw new Error(`Item too large: ${key} = ${size} bytes`)
      }
      // 扣除同名旧条目
      const old = this.cache.get(key)
      totalNewBytes += size - (old?.size ?? 0)
      sizes.set(key, size)
    }

    if (this._bytes + totalNewBytes > this.maxBytes) {
      const need = this._bytes + totalNewBytes - this.maxBytes
      this.evictUntilBytesAtLeast(need)
    }

    for (const { key, data } of entries) {
      const old = this.cache.get(key)
      if (old) {
        this._bytes -= old.size
        this.cache.delete(key)
      }
      const size = sizes.get(key)!
      const now = Date.now()
      this.cache.set(key, {
        data,
        size,
        createdAt: now,
        accessedAt: now,
        hitCount: 0,
      })
      this._bytes += size
    }
  }

  /** 删除条目 */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (entry === undefined) return false
    this._bytes -= entry.size
    this.cache.delete(key)
    return true
  }

  /** 判断是否存在（不更新访问时间） */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /** 清空所有 */
  clear(): void {
    this.cache.clear()
    this._bytes = 0
  }

  /**
   * 列出所有键（按 LRU 顺序，最旧在前）。
   * 主要用于调试与导出。
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /** 获取统计 */
  stats(): MemoryCacheStats {
    const total = this._hits + this._misses
    return {
      entries: this.cache.size,
      bytes: this._bytes,
      maxBytes: this.maxBytes,
      hits: this._hits,
      misses: this._misses,
      hitRate: total === 0 ? 0 : this._hits / total,
      evictions: this._evictions,
    }
  }

  /** 重置统计计数器（不清空缓存数据） */
  resetStats(): void {
    this._hits = 0
    this._misses = 0
    this._evictions = 0
  }

  /**
   * 调整容量上限。缩小会立即触发淘汰。
   */
  resize(maxBytes: number): void {
    this.maxBytes = maxBytes
    if (this._bytes > maxBytes) {
      this.evictUntilBytesAtLeast(this._bytes - maxBytes)
    }
  }

  // ===== 内部方法 =====

  private evictUntil(neededBytes: number): void {
    while (
      this.cache.size >= this.maxEntries ||
      this._bytes + neededBytes > this.maxBytes
    ) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      const entry = this.cache.get(oldest)!
      this._bytes -= entry.size
      this.cache.delete(oldest)
      this._evictions++
    }
  }

  private evictUntilBytesAtLeast(needToFree: number): void {
    let freed = 0
    while (freed < needToFree && this.cache.size > 0) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      const entry = this.cache.get(oldest)!
      this._bytes -= entry.size
      freed += entry.size
      this.cache.delete(oldest)
      this._evictions++
    }
  }
}

/**
 * 全局单例：帧数据缓存
 * 用于 runtime.ts / replayFrame 等热路径读取
 */
export const frameMemoryCache = new MemoryCache({
  maxBytes: 1 * 1024 * 1024 * 1024, // 1GB
  maxItemBytes: 256 * 1024 * 1024, // 单帧最大 256MB
})

/**
 * 全局单例：AI 代码/WGSL/prompt 缓存
 * 文本类数据，容量需求较小
 */
export const textMemoryCache = new MemoryCache({
  maxBytes: 64 * 1024 * 1024, // 64MB
  maxItemBytes: 4 * 1024 * 1024, // 单条最大 4MB
})
