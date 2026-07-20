/**
 * Shader Cache(Step 28.12)— Shader 编译缓存。
 *
 * 职责:
 * - 按 WGSL 源码 hash 缓存已编译的 GPUShaderModule / GPURenderPipeline
 * - 避免重复编译(编译 shader 很慢,~10-50ms)
 * - 提供 LRU 淘汰策略(默认 32 条)
 *
 * 缓存键:
 *   hash = djb2(wgsl source)(由 compiler.computeHash 生成)
 *
 * 数据流:
 *   第一次:
 *     compileMaterialGraph(graph) → wgsl + hash
 *     shaderCache.get(hash) → undefined
 *     device.createShaderModule(wgsl) → module
 *     shaderCache.set(hash, module)
 *
 *   第二次(同 graph):
 *     compileMaterialGraph(graph) → wgsl + hash(相同)
 *     shaderCache.get(hash) → module(命中)
 *
 * 失效策略:
 *   - LRU(最近最少使用):cache 满时淘汰最久未访问的条目
 *   - 手动 clear():切换场景 / 资源释放时调用
 */

import type { CompileResult } from './types'

/**
 * Cache 条目。
 *
 * - hash:       WGSL 源码 hash(键)
 * - module:     GPUShaderModule(由 device.createShaderModule 创建)
 * - pipeline:   GPURenderPipeline(可选,由 device.createRenderPipeline 创建)
 * - lastUsed:   最后访问时间戳(用于 LRU)
 * - wgslPreview: WGSL 源码预览(前 200 字符,调试用)
 */
export interface ShaderCacheEntry {
  hash: string
  module: GPUShaderModule
  pipeline?: GPURenderPipeline
  lastUsed: number
  wgslPreview: string
}

/**
 * Shader 缓存(LRU)。
 *
 * 注:GPUShaderModule / GPURenderPipeline 是浏览器对象,
 *     不在 src/shared/types.ts 的 JsonLiteral 体系内。
 */
export class ShaderCache {
  private cache = new Map<string, ShaderCacheEntry>()
  private maxSize: number
  /**
   * 单调递增计数器(替代 Date.now())。
   *
   * 原因:Date.now() 毫秒精度在快速连续调用时可能返回相同值,
   * 导致 LRU 无法区分「先访问」与「后访问」(测试 SC3 曾因此误淘汰 h1)。
   * 改用计数器确保每次访问都有唯一且递增的 lastUsed。
   */
  private clock = 0

  constructor(maxSize = 32) {
    this.maxSize = maxSize
  }

  /**
   * 查询缓存。
   * 命中时更新 lastUsed(用于 LRU)。
   */
  get(hash: string): ShaderCacheEntry | undefined {
    const entry = this.cache.get(hash)
    if (entry) {
      entry.lastUsed = ++this.clock
    }
    return entry
  }

  /**
   * 写入缓存。
   * 如果 cache 满,淘汰最久未使用的条目(LRU)。
   */
  set(hash: string, module: GPUShaderModule, pipeline?: GPURenderPipeline): void {
    // 若已存在,更新
    if (this.cache.has(hash)) {
      const existing = this.cache.get(hash)!
      existing.module = module
      existing.pipeline = pipeline
      existing.lastUsed = ++this.clock
      return
    }

    // 检查容量,淘汰 LRU
    while (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

    this.cache.set(hash, {
      hash,
      module,
      pipeline,
      lastUsed: ++this.clock,
      wgslPreview: '',  // 由 setWithResult 填充
    })
  }

  /**
   * 写入缓存(用 CompileResult 填充预览)。
   */
  setWithResult(result: CompileResult, module: GPUShaderModule, pipeline?: GPURenderPipeline): void {
    // 先调 set 创建条目
    this.set(result.hash, module, pipeline)
    // 再填充预览
    const entry = this.cache.get(result.hash)
    if (entry) {
      entry.wgslPreview = result.wgsl.slice(0, 200)
    }
  }

  /** 淘汰最久未使用的条目 */
  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of this.cache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestKey = key
      }
    }
    if (oldestKey) {
      const entry = this.cache.get(oldestKey)
      // 释放 GPU 资源(若支持)
      // 注:GPUShaderModule 没有显式 destroy 方法,由 GC 处理
      // GPURenderPipeline 也没有显式 destroy
      void entry
      this.cache.delete(oldestKey)
    }
  }

  /** 清空所有缓存 */
  clear(): void {
    this.cache.clear()
  }

  /** 当前缓存条目数 */
  get size(): number {
    return this.cache.size
  }

  /** 缓存命中率(用于调试) */
  private hits = 0
  private misses = 0

  recordHit(): void {
    this.hits++
  }

  recordMiss(): void {
    this.misses++
  }

  get hitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : this.hits / total
  }

  get stats(): { hits: number; misses: number; hitRate: number; size: number; maxSize: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hitRate,
      size: this.cache.size,
      maxSize: this.maxSize,
    }
  }

  /** 调整最大容量 */
  setMaxSize(size: number): void {
    this.maxSize = size
    while (this.cache.size > this.maxSize) {
      this.evictLRU()
    }
  }
}

/**
 * 全局单例(供 material/runtime.ts 使用)。
 *
 * 设计:
 * - 单例避免每个 MaterialGraph 实例都创建独立 cache(浪费)
 * - 切换场景时由 App.vue 调用 shaderCache.clear()
 */
export const shaderCache = new ShaderCache()
