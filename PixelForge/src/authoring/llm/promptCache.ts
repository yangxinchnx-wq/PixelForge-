/**
 * PixelForge - Prompt Cache（骨架 §5.3 Phase E）
 *
 * 缓存 LLM 请求结果，避免相同 prompt 重复调用。
 *
 * 设计原则：
 *   - 缓存 key = hash(prompt + model + temperature + schema)
 *   - LRU 淘汰策略（默认 maxEntries = 100）
 *   - 可选 TTL（默认 30 分钟）
 *   - 线程安全（单线程环境下无锁）
 *   - 可序列化（用于跨 worker 传输，但首期仅主线程使用）
 *
 * 数据流：
 *   callLLM(request)
 *     → computeCacheKey(request)
 *     → cache.get(key) → 命中 → 返回 LLMResponse(cached=true)
 *     → cache miss → 调用 LLM API → cache.set(key, response) → 返回
 */

import type { LLMRequest, LLMResponse } from './types'

// ============================================================================
// CacheKey — 缓存 key 计算
// ============================================================================

/**
 * 计算 LLM 请求的缓存 key。
 *
 * Key = hash(prompt + model + temperature + schema + systemPrompt)
 *
 * 相同输入 → 相同 key → 命中缓存。
 */
export function computeCacheKey(request: LLMRequest): string {
  const parts = [
    request.prompt,
    request.model ?? 'default',
    String(request.temperature ?? 0.3),
    request.systemPrompt ?? '',
    request.schema ? JSON.stringify(request.schema) : '',
  ]
  return fnv1aHash(parts.join('\x00'))
}

/**
 * FNV-1a 64-bit hash（与 shared/ids.ts 一致的算法，但输出 64-bit）。
 */
function fnv1aHash(input: string): string {
  const FNV_OFFSET = 0xcbf29ce484222325n
  const FNV_PRIME = 0x100000001b3n
  const MASK64 = 0xFFFFFFFFFFFFFFFFn

  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK64
  }
  return hash.toString(16).padStart(16, '0')
}

// ============================================================================
// PromptCache — LRU + TTL 缓存
// ============================================================================

/**
 * 缓存条目。
 */
interface CacheEntry {
  response: LLMResponse
  /** 创建时间戳（用于 TTL 判断） */
  createdAt: number
}

/**
 * Prompt Cache 配置。
 */
export interface PromptCacheConfig {
  /** 最大条目数（默认 100） */
  maxEntries?: number
  /** TTL 毫秒（默认 30 分钟 = 1800000），0 = 永不过期 */
  ttlMs?: number
}

/**
 * LLM Prompt 缓存（LRU + TTL）。
 *
 * - LRU：超过 maxEntries 时淘汰最久未访问的条目
 * - TTL：条目超过 ttlMs 后过期（get 时惰性删除）
 *
 * 使用 Map 的插入顺序实现 LRU（JS Map 保持插入顺序）。
 */
export class PromptCache {
  private cache = new Map<string, CacheEntry>()
  private readonly maxEntries: number
  private readonly ttlMs: number

  constructor(config: PromptCacheConfig = {}) {
    this.maxEntries = config.maxEntries ?? 100
    this.ttlMs = config.ttlMs ?? 30 * 60 * 1000
  }

  /**
   * 查询缓存。
   *
   * 命中时将条目移到 Map 末尾（LRU 最近使用）。
   * 过期条目惰性删除。
   *
   * @returns 命中时返回 LLMResponse（cached=true），未命中返回 null
   */
  get(key: string): LLMResponse | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    // TTL 检查
    if (this.ttlMs > 0) {
      const age = Date.now() - entry.createdAt
      if (age > this.ttlMs) {
        this.cache.delete(key)
        return null
      }
    }

    // LRU：移到末尾（最近使用）
    this.cache.delete(key)
    this.cache.set(key, entry)

    // 返回副本，标记 cached=true
    return { ...entry.response, cached: true }
  }

  /**
   * 写入缓存。
   *
   * 超过 maxEntries 时淘汰 Map 第一个条目（最久未使用）。
   */
  set(key: string, response: LLMResponse): void {
    // 如果已存在，先删除（重新插入到末尾）
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // LRU 淘汰
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) break
      this.cache.delete(oldestKey)
    }

    this.cache.set(key, {
      response: { ...response },
      createdAt: Date.now(),
    })
  }

  /**
   * 删除指定 key。
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * 清空缓存。
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * 当前缓存条目数。
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * 检查 key 是否存在且未过期。
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (this.ttlMs > 0) {
      const age = Date.now() - entry.createdAt
      if (age > this.ttlMs) {
        this.cache.delete(key)
        return false
      }
    }
    return true
  }

  /**
   * 获取所有缓存 key（用于调试）。
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }
}

// ============================================================================
// 全局默认缓存实例
// ============================================================================

let globalCache: PromptCache | null = null

/**
 * 获取全局默认 PromptCache 实例。
 *
 * 首次调用时创建，后续复用。
 */
export function getDefaultPromptCache(): PromptCache {
  if (!globalCache) {
    globalCache = new PromptCache()
  }
  return globalCache
}

/**
 * 重置全局缓存（用于测试隔离）。
 */
export function resetDefaultPromptCache(): void {
  globalCache = null
}
