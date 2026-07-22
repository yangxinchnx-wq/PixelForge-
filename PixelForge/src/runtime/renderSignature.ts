/**
 * Render Signature(Step 39.4)— 渲染签名生成 + L1 签名缓存。
 *
 * 核心问题:
 *   现有 L2 artifact 缓存(compileCache.ts)基于三层 CacheKeySet(static/structural/dynamic),
 *   命中后可跳过编译,但仍需 GPU dispatch 重渲染。
 *   L1 签名缓存在此基础上提供"快速短路":签名匹配表示"完全相同的渲染请求近期已执行过",
 *   理论上可复用上一帧输出纹理(跳过编译 + GPU dispatch)。
 *
 * 设计要点:
 * - 签名 = FNV-1a(staticKey + structuralKey + dynamicKey + canvasSize),8 位 hex
 * - L1 缓存采用 LRU 淘汰(访问更新 lastUsedAt,优于 compileCache 的 FIFO)
 * - 命中率统计:hits / misses / hitRate / evictions(对齐 shaderCache 模式)
 * - 不持有 GPU 资源引用(纹理由 L3 TexturePool 管理,这里只存元数据)
 * - 与 PatchScope 失效联动(通过 invalidateBySignature 或外部 clear)
 *
 * 与 compileCache.ts 的关系:
 * - compileCache 的 CacheKeySet 是签名的输入来源
 * - L1 命中 ⊃ L2 命中(签名匹配意味着三层 key 完全一致,artifact 必然命中)
 * - L1 未命中时仍可查 L2(签名不匹配但 artifact 可能匹配 — 不可能,因为签名包含 dynamicKey)
 *   实际上:L1 命中 ⟺ L2 命中(签名由三层 key 派生),L1 的额外价值是"记录近期渲染历史"
 *   + 为未来"纹理复用"提供基础
 */

// ============================================================================
// FNV-1a 32-bit hash(与 compileCache.ts / pixelSignature.ts 同算法)
// ============================================================================

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1aHash(data: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // 转 unsigned 32-bit + 8 位 hex
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ============================================================================
// 渲染签名
// ============================================================================

/**
 * 渲染签名输入(对齐 compileCache.ts 的 CacheKeySet)。
 */
export interface RenderSignatureInput {
  /** 静态层 key(opcodes + blendModes + canvas + profile) */
  staticKey: string
  /** 结构层 key(visible + layerOrder + regionBounds) */
  structuralKey: string
  /** 动态层 key(params + seed + compileHints) */
  dynamicKey: string
  /** 画布尺寸(参与签名,尺寸变 → 签名变) */
  canvasSize: { width: number; height: number }
}

/**
 * 渲染签名结果。
 */
export interface RenderSignature {
  /** 8 位 hex hash(FNV-1a) */
  hash: string
  /** 完整 key(用于调试 / 日志) */
  fullKey: string
}

/**
 * 计算渲染签名。
 *
 * @param input 签名输入(三层 key + 画布尺寸)
 * @returns 渲染签名(hash + fullKey)
 *
 * @example
 * const sig = computeRenderSignature({
 *   staticKey: 's_abc12345',
 *   structuralKey: 'st_def67890',
 *   dynamicKey: 'd_ghi13579',
 *   canvasSize: { width: 1920, height: 1080 },
 * })
 * // sig.hash = 'a1b2c3d4'
 */
export function computeRenderSignature(input: RenderSignatureInput): RenderSignature {
  const fullKey = `${input.staticKey}|${input.structuralKey}|${input.dynamicKey}|${input.canvasSize.width}x${input.canvasSize.height}`
  return {
    hash: fnv1aHash(fullKey),
    fullKey,
  }
}

// ============================================================================
// L1 签名缓存
// ============================================================================

/**
 * L1 缓存条目。
 */
export interface SignatureCacheEntry {
  /** 签名 */
  signature: RenderSignature
  /** 首次插入时的帧序号 */
  frameIndex: number
  /** 首次插入时间戳(performance.now()) */
  timestamp: number
  /** 最后访问时间戳(LRU 依据,每次 query 命中时更新) */
  lastUsedAt: number
  /** 命中次数(统计用) */
  hitCount: number
}

/**
 * L1 签名缓存选项。
 */
export interface SignatureCacheOptions {
  /** 最大条目数(默认 64) */
  maxSize?: number
  /** 时间函数(测试注入用,默认 performance.now) */
  now?: () => number
}

/**
 * L1 签名缓存统计。
 */
export interface SignatureCacheStats {
  /** 当前条目数 */
  size: number
  /** 最大条目数 */
  maxSize: number
  /** 命中次数 */
  hits: number
  /** 未命中次数 */
  misses: number
  /** 命中率(0~1) */
  hitRate: number
  /** LRU 淘汰次数 */
  evictions: number
}

/**
 * L1 渲染签名缓存(LRU + 命中率统计)。
 *
 * @example
 * const cache = new SignatureCache({ maxSize: 64 })
 * const sig = computeRenderSignature(input)
 *
 * // 查询
 * const hit = cache.query(sig, frameIndex)
 * if (hit) {
 *   // L1 命中:可跳过编译 + GPU dispatch
 * } else {
 *   // L1 未命中:查 L2 artifact 缓存
 *   cache.insert(sig, frameIndex)
 * }
 *
 * const stats = cache.getStats()
 * console.log(`L1 hitRate: ${(stats.hitRate * 100).toFixed(1)}%`)
 */
export class SignatureCache {
  private readonly map = new Map<string, SignatureCacheEntry>()
  private readonly maxSize: number
  private readonly now: () => number

  private hits = 0
  private misses = 0
  private evictions = 0

  constructor(options: SignatureCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 64
    this.now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  }

  /**
   * 查询签名是否命中。
   *
   * @param signature 渲染签名
   * @param frameIndex 当前帧序号(未命中时插入用,命中时忽略)
   * @returns true=命中(并更新 lastUsedAt + hitCount),false=未命中(自动插入新条目)
   */
  query(signature: RenderSignature, frameIndex: number): boolean {
    const existing = this.map.get(signature.hash)
    if (existing) {
      existing.lastUsedAt = this.now()
      existing.hitCount++
      this.hits++
      return true
    }
    // 未命中:插入新条目
    this.insert(signature, frameIndex)
    this.misses++
    return false
  }

  /**
   * 插入新条目(不增加 misses 计数,仅用于显式插入场景)。
   * 若签名已存在,更新 lastUsedAt + hitCount。
   */
  insert(signature: RenderSignature, frameIndex: number): void {
    const existing = this.map.get(signature.hash)
    if (existing) {
      existing.lastUsedAt = this.now()
      existing.hitCount++
      return
    }

    // 容量检查 + LRU 淘汰
    if (this.map.size >= this.maxSize) {
      this.evictLRU()
    }

    const now = this.now()
    this.map.set(signature.hash, {
      signature,
      frameIndex,
      timestamp: now,
      lastUsedAt: now,
      hitCount: 0,
    })
  }

  /**
   * 获取签名对应的缓存条目(不更新 lastUsedAt,不增加 hits 计数)。
   */
  get(signature: RenderSignature): SignatureCacheEntry | undefined {
    return this.map.get(signature.hash)
  }

  /**
   * 检查签名是否存在于缓存中(不更新统计)。
   */
  has(signature: RenderSignature): boolean {
    return this.map.has(signature.hash)
  }

  /**
   * 按签名失效单条条目。
   * @returns true=存在并删除,false=不存在
   */
  invalidate(signature: RenderSignature): boolean {
    return this.map.delete(signature.hash)
  }

  /**
   * 清空所有条目(不清零统计计数器,用 resetStats 清统计)。
   */
  clear(): void {
    this.map.clear()
  }

  /**
   * 获取当前条目数。
   */
  get size(): number {
    return this.map.size
  }

  /**
   * 获取统计信息。
   */
  getStats(): SignatureCacheStats {
    const total = this.hits + this.misses
    return {
      size: this.map.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      evictions: this.evictions,
    }
  }

  /**
   * 重置统计计数器(hits/misses/evictions 归零,不清空条目)。
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
    this.evictions = 0
  }

  /**
   * 获取所有条目(调试用)。
   */
  entries(): SignatureCacheEntry[] {
    return Array.from(this.map.values())
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  /**
   * LRU 淘汰:lastUsedAt 最小的条目被淘汰。
   */
  private evictLRU(): void {
    let oldestHash: string | null = null
    let oldestTime = Infinity
    for (const [hash, entry] of this.map) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt
        oldestHash = hash
      }
    }
    if (oldestHash !== null) {
      this.map.delete(oldestHash)
      this.evictions++
    }
  }
}

// ============================================================================
// 便捷工厂
// ============================================================================

/**
 * 从 CacheKeySet + 画布尺寸快速创建签名(对齐 compileCache.ts 的 CacheKeySet 接口)。
 *
 * @param keys 三层 CacheKeySet(staticKey / structuralKey / dynamicKey)
 * @param canvasSize 画布尺寸
 * @returns 渲染签名
 */
export function createSignatureFromKeys(
  keys: { staticKey: string; structuralKey: string; dynamicKey: string },
  canvasSize: { width: number; height: number },
): RenderSignature {
  return computeRenderSignature({
    staticKey: keys.staticKey,
    structuralKey: keys.structuralKey,
    dynamicKey: keys.dynamicKey,
    canvasSize,
  })
}
