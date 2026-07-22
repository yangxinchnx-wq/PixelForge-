/**
 * Render Cache(Step 39.4)— 三级渲染缓存编排器。
 *
 * 三级缓存层级:
 *   L1 渲染签名缓存(SignatureCache) — 签名匹配 → 跳过编译 + GPU dispatch
 *   L2 编译产物缓存(compileCache)  — artifact 复用 → 跳过编译
 *   L3 资源池缓存(TexturePool + BufferPool) — GPU 资源复用 → 跳过资源创建
 *
 * 查询顺序:L1 → L2 → L3(逐级降级)
 *   - L1 命中:签名完全匹配,理论可复用上一帧输出(跳过编译 + dispatch)
 *   - L1 未命中 → 查 L2:artifact 复用(跳过编译,仍需 dispatch)
 *   - L2 未命中 → 编译 + 查 L3:GPU 资源复用(跳过纹理/buffer 创建)
 *
 * 设计要点:
 * - 纯统计编排(不直接管理 L2/L3,由 compileCache / ResourceManager 各自管理)
 * - L2/L3 命中率由外部注入(recordL2Hit/Miss, setL3Stats)
 * - 统一 RenderCacheStats 聚合三级统计 + levelDistribution
 * - overallHitRate = (L1 hits + L2 hits + L3 hits) / totalQueries
 *   注:L3 命中率独立计算(资源池命中率 = 资源复用 / 资源申请),不纳入 overallHitRate
 *   overallHitRate 仅统计 L1+L2(渲染级缓存),L3 单独展示
 *
 * 与 runtime.ts 的集成方式(不侵入 compileCache.ts):
 *   const renderCache = new RenderCache()
 *   // 在 renderCurrentIR 中:
 *   const sig = computeRenderSignature({ ...keys, canvasSize })
 *   const l2Hit = !!getCachedArtifact(ir, ctx)
 *   const result = renderCache.query(sig, frameIndex, l2Hit)
 *   if (result.l1Hit) { /* 跳过编译 + dispatch *\/ }
 *   else if (result.l2Hit) { /* 跳过编译,仍需 dispatch *\/ }
 *   else { /* 编译 + dispatch *\/ }
 */

import {
  SignatureCache,
  computeRenderSignature,
  type RenderSignature,
  type RenderSignatureInput,
  type SignatureCacheStats,
} from './renderSignature'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 缓存层级标识。
 */
export type CacheLevel = 'L1' | 'L2' | 'L3' | 'miss'

/**
 * 三级缓存查询结果。
 */
export interface CacheQueryResult {
  /** 命中的最高层级(L1 > L2 > L3 > miss) */
  level: CacheLevel
  /** L1 签名缓存是否命中 */
  l1Hit: boolean
  /** L2 artifact 缓存是否命中 */
  l2Hit: boolean
  /** L3 资源池是否有复用(由外部注入,query 时不判断 L3) */
  l3Hit: boolean
  /** 渲染签名 */
  signature: RenderSignature
  /** 帧序号 */
  frameIndex: number
}

/**
 * L2 编译产物缓存统计(由外部注入)。
 */
export interface L2CacheStats {
  /** 命中次数 */
  hits: number
  /** 未命中次数 */
  misses: number
  /** 命中率(0~1) */
  hitRate: number
  /** 当前条目数 */
  size: number
  /** 最大条目数(compileCache 硬编码 32) */
  maxSize: number
}

/**
 * L3 资源池缓存统计(由 ResourceManager 注入)。
 */
export interface L3CacheStats {
  /** 纹理池命中次数 */
  textureHits: number
  /** 纹理池未命中次数 */
  textureMisses: number
  /** 纹理池命中率 */
  textureHitRate: number
  /** Buffer 池命中次数 */
  bufferHits: number
  /** Buffer 池未命中次数 */
  bufferMisses: number
  /** Buffer 池命中率 */
  bufferHitRate: number
  /** 纹理池当前大小 */
  texturePoolSize: number
  /** Buffer 池当前大小 */
  bufferPoolSize: number
}

/**
 * 三级缓存统一统计。
 */
export interface RenderCacheStats {
  /** L1 签名缓存统计 */
  l1: SignatureCacheStats
  /** L2 编译产物缓存统计 */
  l2: L2CacheStats
  /** L3 资源池缓存统计 */
  l3: L3CacheStats
  /** 总查询次数 */
  totalQueries: number
  /** 至少一级命中的次数(L1 或 L2) */
  totalHits: number
  /** 整体命中率(L1+L2 命中 / 总查询,L3 独立统计) */
  overallHitRate: number
  /** 层级分布(命中层级计数) */
  levelDistribution: { L1: number; L2: number; L3: number; miss: number }
}

/**
 * RenderCache 选项。
 */
export interface RenderCacheOptions {
  /** L1 签名缓存(可选,不传则内部新建) */
  l1Cache?: SignatureCache
  /** L1 最大条目数(默认 64,仅在内部新建 L1 时生效) */
  l1MaxSize?: number
  /** L2 最大条目数(默认 32,对齐 compileCache MAX_ARTIFACT_CACHE_SIZE) */
  l2MaxSize?: number
}

// ============================================================================
// RenderCache 类
// ============================================================================

/**
 * 三级渲染缓存编排器。
 *
 * @example
 * const renderCache = new RenderCache()
 *
 * // 在 renderCurrentIR 中:
 * const sig = computeRenderSignature({ staticKey, structuralKey, dynamicKey, canvasSize })
 * const l2Hit = !!getCachedArtifact(ir, ctx)  // 查 L2
 * const result = renderCache.query(sig, frameIndex, l2Hit)
 *
 * if (result.l1Hit) {
 *   // L1 命中:跳过编译 + GPU dispatch(理论可复用上一帧输出)
 * } else if (result.l2Hit) {
 *   // L2 命中:跳过编译,仍需 GPU dispatch
 * } else {
 *   // L1+L2 未命中:编译 + dispatch
 *   setCachedArtifact(ir, ctx, artifact)  // 写入 L2
 * }
 *
 * // L3 资源池统计(由 ResourceManager 注入):
 * renderCache.setL3Stats({
 *   textureHits: rm.getStats().textureTotalHits,
 *   textureMisses: rm.getStats().textureTotalMisses,
 *   ...
 * })
 *
 * const stats = renderCache.getStats()
 * console.log(`L1: ${(stats.l1.hitRate * 100).toFixed(1)}%`)
 * console.log(`L2: ${(stats.l2.hitRate * 100).toFixed(1)}%`)
 * console.log(`Overall: ${(stats.overallHitRate * 100).toFixed(1)}%`)
 */
export class RenderCache {
  private readonly l1Cache: SignatureCache
  private readonly l2MaxSize: number

  // L2 统计(由外部 recordL2Hit/Miss 累加)
  private l2Hits = 0
  private l2Misses = 0

  // L3 统计(由外部 setL3Stats 注入快照)
  private l3Stats: L3CacheStats = {
    textureHits: 0,
    textureMisses: 0,
    textureHitRate: 0,
    bufferHits: 0,
    bufferMisses: 0,
    bufferHitRate: 0,
    texturePoolSize: 0,
    bufferPoolSize: 0,
  }

  // 整体统计
  private totalQueries = 0
  private levelDistribution = { L1: 0, L2: 0, L3: 0, miss: 0 }

  constructor(options: RenderCacheOptions = {}) {
    this.l1Cache = options.l1Cache ?? new SignatureCache({ maxSize: options.l1MaxSize })
    this.l2MaxSize = options.l2MaxSize ?? 32
  }

  /**
   * 查询三级缓存。
   *
   * @param input 签名输入(三层 key + 画布尺寸)
   * @param frameIndex 当前帧序号
   * @param l2Hit L2 artifact 缓存是否命中(由外部查询 compileCache 后传入)
   * @returns 查询结果(含各层级命中状态)
   */
  query(
    input: RenderSignatureInput,
    frameIndex: number,
    l2Hit: boolean,
  ): CacheQueryResult {
    const signature = computeRenderSignature(input)
    this.totalQueries++

    // 查 L1
    const l1Hit = this.l1Cache.query(signature, frameIndex)

    // 记录 L2 统计
    if (l2Hit) {
      this.l2Hits++
    } else {
      this.l2Misses++
    }

    // 确定命中层级
    let level: CacheLevel
    if (l1Hit) {
      level = 'L1'
      this.levelDistribution.L1++
    } else if (l2Hit) {
      level = 'L2'
      this.levelDistribution.L2++
    } else {
      level = 'miss'
      this.levelDistribution.miss++
    }

    return {
      level,
      l1Hit,
      l2Hit,
      l3Hit: false, // L3 由资源池独立统计,query 时不判断
      signature,
      frameIndex,
    }
  }

  /**
   * 显式记录 L2 命中(不经过 query 流程时使用,如直接调用 compileCache)。
   */
  recordL2Hit(): void {
    this.l2Hits++
  }

  /**
   * 显式记录 L2 未命中。
   */
  recordL2Miss(): void {
    this.l2Misses++
  }

  /**
   * 注入 L3 资源池统计快照(由 ResourceManager.getStats() 转换而来)。
   */
  setL3Stats(stats: Partial<L3CacheStats>): void {
    this.l3Stats = { ...this.l3Stats, ...stats }
    // 重新计算 hitRate
    if (stats.textureHits !== undefined || stats.textureMisses !== undefined) {
      const total = this.l3Stats.textureHits + this.l3Stats.textureMisses
      this.l3Stats.textureHitRate = total === 0 ? 0 : this.l3Stats.textureHits / total
    }
    if (stats.bufferHits !== undefined || stats.bufferMisses !== undefined) {
      const total = this.l3Stats.bufferHits + this.l3Stats.bufferMisses
      this.l3Stats.bufferHitRate = total === 0 ? 0 : this.l3Stats.bufferHits / total
    }
  }

  /**
   * 获取 L1 签名缓存(供外部直接操作,如 invalidate)。
   */
  getL1Cache(): SignatureCache {
    return this.l1Cache
  }

  /**
   * 获取统计信息。
   */
  getStats(): RenderCacheStats {
    const l1Stats = this.l1Cache.getStats()
    const l2Total = this.l2Hits + this.l2Misses
    const totalHits = this.levelDistribution.L1 + this.levelDistribution.L2

    return {
      l1: l1Stats,
      l2: {
        hits: this.l2Hits,
        misses: this.l2Misses,
        hitRate: l2Total === 0 ? 0 : this.l2Hits / l2Total,
        size: 0, // L2 size 由 compileCache 管理,此处不感知(外部注入)
        maxSize: this.l2MaxSize,
      },
      l3: { ...this.l3Stats },
      totalQueries: this.totalQueries,
      totalHits,
      overallHitRate: this.totalQueries === 0 ? 0 : totalHits / this.totalQueries,
      levelDistribution: { ...this.levelDistribution },
    }
  }

  /**
   * 重置所有统计(L1 + L2 + 整体,不清空 L3 注入值,不清空 L1 缓存条目)。
   */
  resetStats(): void {
    this.l1Cache.resetStats()
    this.l2Hits = 0
    this.l2Misses = 0
    this.totalQueries = 0
    this.levelDistribution = { L1: 0, L2: 0, L3: 0, miss: 0 }
  }

  /**
   * 清空 L1 缓存条目(用于场景切换 / 全量失效)。
   * 注意:不清空 L2(由 compileCache.invalidateByScopes 管理)和 L3(由 ResourceManager 管理)。
   */
  clearL1(): void {
    this.l1Cache.clear()
  }

  /**
   * 销毁(清空 L1 + 重置统计)。
   */
  dispose(): void {
    this.l1Cache.clear()
    this.resetStats()
    this.l3Stats = {
      textureHits: 0,
      textureMisses: 0,
      textureHitRate: 0,
      bufferHits: 0,
      bufferMisses: 0,
      bufferHitRate: 0,
      texturePoolSize: 0,
      bufferPoolSize: 0,
    }
  }
}
