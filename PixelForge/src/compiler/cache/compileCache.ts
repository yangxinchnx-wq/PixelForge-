/**
 * PixelForge - 编译缓存模块（Phase C 升级版）
 *
 * Phase B 占位 → Phase C 实现：三层 key 系统 + artifact 缓存。
 *
 * 设计原则:
 * - patchEngine 是纯函数,不直接操作缓存(返回 affectedScopes 给调用方)
 * - runtime store 作为编排者,消费 affectedScopes + targetId 决定失效范围
 * - 三层 key 对应骨架 §4.6 CacheKeySet（staticKey / structuralKey / dynamicKey）
 * - artifact 缓存键 = 三层 key 拼接，按 PatchScope 精确失效
 *
 * PatchScope 语义(与 patch.ts §4.6.5 对齐):
 *   - 'dynamic'    → 仅 dynamicKey 失效(参数值变化)
 *   - 'structural' → structuralKey + dynamicKey 失效(visible / bounds 变化)
 *   - 'topology'   → staticKey + structuralKey + dynamicKey 全部失效(增删图层)
 *   - 'metadata'   → 仅 metadataKey 失效(source / worldMetadata 变化)
 *   - 'none'       → 无 cache 影响
 */

import type { PatchScope } from '@/compiler/ir/patch'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { CompileContext } from '@/compiler/context'
import type { CapabilityProfile as RuntimeCapabilityProfile } from '@/runtime/types'

// ============================================================================
// 1. 基础缓存（Phase B 占位 → 保持兼容）
// ============================================================================

interface CacheEntry {
  value: unknown
  scope: PatchScope
  /** 关联的 layerId(便于按 layer 失效) */
  layerId?: string
}

const cache = new Map<string, CacheEntry>()

/** 读取缓存 */
export function getCache<T = unknown>(key: string): T | undefined {
  const entry = cache.get(key)
  return entry ? (entry.value as T) : undefined
}

/** 写入缓存(可带 layerId 与 scope,便于后续按范围失效) */
export function setCache(
  key: string,
  value: unknown,
  scope: PatchScope = 'dynamic',
  layerId?: string,
): void {
  cache.set(key, { value, scope, layerId })
}

/** 精确失效单个 key */
export function invalidate(key: string): boolean {
  return cache.delete(key)
}

/**
 * 按 layerId 失效:
 * - entry.layerId 严格等于 layerId 的清掉
 * - key 字符串包含 layerId 的也清掉(兼容 key 命名约定 layerId.paramKey)
 */
export function invalidateByLayerId(layerId: string): number {
  let count = 0
  for (const [key, entry] of cache) {
    if (entry.layerId === layerId || key.includes(layerId)) {
      cache.delete(key)
      count++
    }
  }
  return count
}

/**
 * 按 PatchScope 失效:
 * - 'topology' 最重,清 dynamic + structural + topology 三档
 * - 'structural' 清 dynamic + structural 两档
 * - 'dynamic' / 'metadata' / 'none' 精确匹配单档
 */
export function invalidateByScopes(scopes: PatchScope[]): number {
  if (scopes.length === 0) return 0

  const expanded = new Set<PatchScope>()
  for (const s of scopes) {
    expanded.add(s)
    if (s === 'topology') {
      expanded.add('dynamic')
      expanded.add('structural')
    } else if (s === 'structural') {
      expanded.add('dynamic')
    }
  }

  let count = 0
  for (const [key, entry] of cache) {
    if (expanded.has(entry.scope)) {
      cache.delete(key)
      count++
    }
  }

  // 同时失效 artifact 缓存中对应 scope 的条目
  count += invalidateArtifactCacheByScopes(expanded)

  return count
}

/** 清空整个缓存(测试 / 场景切换时用) */
export function clearCache(): void {
  cache.clear()
  artifactCache.clear()
}

/** 当前缓存条目数(测试 / 调试用) */
export function cacheSize(): number {
  return cache.size + artifactCache.size
}

// ============================================================================
// 2. FNV-1a 哈希（与 shared/ids.ts 一致）
// ============================================================================

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1aHash(input: string): string {
  let hash = FNV_OFFSET
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ============================================================================
// 3. 三层 Cache Key 计算（骨架 §4.6）
// ============================================================================

/**
 * 从运行时 CapabilityProfile 计算 profileId 字符串。
 *
 * 用于 StaticKey 中的 profileId 字段（骨架 §4.6.3 StaticKeyInput.profileId）。
 * 不依赖 shared/types.ts 的 CapabilityProfile（有 profileId 字段），
 * 而是从 runtime/types.ts 的 CapabilityProfile 字段合成。
 */
function computeProfileId(cap: RuntimeCapabilityProfile): string {
  return `${cap.storageFormat}_${cap.maxTextureDimension2D}_${cap.maxStorageBufferBindingSize}`
}

/**
 * 计算 StaticKey（编译形态）。
 *
 * 包含字段（骨架 §4.6.3 StaticKeyInput）：
 *   - canvas（来自 ir.canvas）
 *   - opcodes（来自 ir.layers，按顺序）
 *   - blendModes（来自 ir.layers，按顺序）
 *   - effectTypes（来自 ir.effects，按顺序）
 *   - outputStrategy（固定 'storage_texture'）
 *   - profileId（来自 ctx.capability）
 */
function computeStaticKey(ir: RenderIR, ctx: CompileContext): string {
  const parts: string[] = [
    `canvas:${ir.canvas.width}x${ir.canvas.height}`,
    `opcodes:${ir.layers.map((l) => l.opcode).join(',')}`,
    `blend:${ir.layers.map((l) => l.blendMode ?? 'normal').join(',')}`,
    `effects:${ir.effects.map((e) => e.type).join(',')}`,
    `output:storage_texture`,
    `profile:${computeProfileId(ctx.capability)}`,
  ]
  return fnv1aHash(parts.join('|'))
}

/**
 * 计算 StructuralKey（局部结构）。
 *
 * 包含字段（骨架 §4.6.3 StructuralKeyInput）：
 *   - visibleFlags（来自 ir.layers，按顺序）
 *   - layerOrder（来自 ir.layers.id，按顺序）
 *   - regionBounds（来自 ir.regions.bounds，按顺序）
 *   - regionOrder（来自 ir.regions.id，按顺序）
 *   - layerRefs（来自 ir.regions.layerRefs，按顺序）
 */
function computeStructuralKey(ir: RenderIR): string {
  const parts: string[] = [
    `visible:${ir.layers.map((l) => l.visible).join(',')}`,
    `layerOrder:${ir.layers.map((l) => l.id).join(',')}`,
    `regionBounds:${ir.regions.map((r) => `${r.bounds.x},${r.bounds.y},${r.bounds.width},${r.bounds.height}`).join(';')}`,
    `regionOrder:${ir.regions.map((r) => r.id).join(',')}`,
    `layerRefs:${ir.regions.map((r) => r.layerRefs.join(',')).join(';')}`,
  ]
  return fnv1aHash(parts.join('|'))
}

/**
 * 计算 DynamicKey（求值参数）。
 *
 * 包含字段（骨架 §4.6.3 DynamicKeyInput）：
 *   - paramEntries（按 ownerId + paramKey 字典序排列）
 *   - seed
 *   - compileHints
 */
function computeDynamicKey(ir: RenderIR, ctx: CompileContext): string {
  // 收集所有参数项
  const entries: string[] = []
  for (const layer of ir.layers) {
    for (const key of Object.keys(layer.params)) {
      entries.push(`${layer.id}.${key}=${JSON.stringify(layer.params[key])}`)
    }
  }
  for (const effect of ir.effects) {
    for (const key of Object.keys(effect.params)) {
      entries.push(`${effect.id}.${key}=${JSON.stringify(effect.params[key])}`)
    }
  }
  // 字典序排列
  entries.sort()

  const parts: string[] = [
    `params:${entries.join('|')}`,
    `seed:${ctx.seed}`,
    `hints:${JSON.stringify(ir.compileHints)}`,
  ]
  return fnv1aHash(parts.join('|'))
}

/**
 * 三层 cache key 集合。
 */
export interface CacheKeySet {
  staticKey: string
  structuralKey: string
  dynamicKey: string
}

/**
 * 计算三层 cache key。
 *
 * @param ir RenderIR
 * @param ctx CompileContext
 * @returns CacheKeySet
 */
export function computeCacheKeys(ir: RenderIR, ctx: CompileContext): CacheKeySet {
  return {
    staticKey: computeStaticKey(ir, ctx),
    structuralKey: computeStructuralKey(ir),
    dynamicKey: computeDynamicKey(ir, ctx),
  }
}

/**
 * 组合三层 key 为完整 artifact 缓存键。
 */
function composeArtifactKey(keys: CacheKeySet): string {
  return `artifact:${keys.staticKey}:${keys.structuralKey}:${keys.dynamicKey}`
}

// ============================================================================
// 4. Artifact 缓存（Phase C 新增）
// ============================================================================

interface ArtifactCacheEntry {
  artifact: RegionCompileArtifact
  keys: CacheKeySet
  /** 创建时间戳（用于 LRU 淘汰） */
  createdAt: number
}

/** Artifact 缓存（key = composeArtifactKey） */
const artifactCache = new Map<string, ArtifactCacheEntry>()

/** 最大 artifact 缓存条目数（防止内存无限增长） */
const MAX_ARTIFACT_CACHE_SIZE = 32

/**
 * 从缓存中获取编译产物。
 *
 * @param ir RenderIR
 * @param ctx CompileContext
 * @returns 命中时返回 artifact，未命中返回 undefined
 */
export function getCachedArtifact(
  ir: RenderIR,
  ctx: CompileContext,
): RegionCompileArtifact | undefined {
  const keys = computeCacheKeys(ir, ctx)
  const key = composeArtifactKey(keys)
  const entry = artifactCache.get(key)
  return entry?.artifact
}

/**
 * 将编译产物存入缓存。
 *
 * @param ir RenderIR
 * @param ctx CompileContext
 * @param artifact 编译产物
 */
export function setCachedArtifact(
  ir: RenderIR,
  ctx: CompileContext,
  artifact: RegionCompileArtifact,
): void {
  const keys = computeCacheKeys(ir, ctx)
  const key = composeArtifactKey(keys)

  // LRU 淘汰：超过最大容量时删除最旧条目
  if (artifactCache.size >= MAX_ARTIFACT_CACHE_SIZE) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [k, v] of artifactCache) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt
        oldestKey = k
      }
    }
    if (oldestKey) {
      artifactCache.delete(oldestKey)
    }
  }

  artifactCache.set(key, {
    artifact,
    keys,
    createdAt: performance.now(),
  })
}

/**
 * 按 PatchScope 失效 artifact 缓存。
 *
 * 内部函数，由 invalidateByScopes 调用。
 */
function invalidateArtifactCacheByScopes(expanded: Set<PatchScope>): number {
  if (expanded.size === 0) return 0
  if (artifactCache.size === 0) return 0

  let count = 0
  for (const key of artifactCache.keys()) {
    // 由于 artifact key 是三层组合(static + dynamic + topology),
    // 任何一层变化都会导致 key 不同,所以直接清除即可。
    let shouldInvalidate = false
    if (expanded.has('dynamic')) {
      // dynamic 变化 → 所有 dynamic key 变化 → 对应 artifact 失效
      shouldInvalidate = true
    } else if (expanded.has('structural')) {
      // structural 变化 → structural + dynamic key 变化
      shouldInvalidate = true
    } else if (expanded.has('topology')) {
      // topology 变化 → 三层 key 都变化
      shouldInvalidate = true
    } else if (expanded.has('metadata')) {
      // metadata 变化 → 不影响 artifact（metadata 不参与 artifact key）
      shouldInvalidate = false
    }

    if (shouldInvalidate) {
      artifactCache.delete(key)
      count++
    }
  }
  return count
}

/**
 * 按 layerId 失效 artifact 缓存。
 *
 * 由于 artifact key 不包含 layerId，此函数为 no-op。
 * 实际的按 layer 失效由 invalidateByScopes 处理
 * （patchEngine 返回 affectedScopes，runtime store 调用 invalidateByScopes）。
 */
export function invalidateArtifactByLayerId(_layerId: string): number {
  // artifact key 是三层组合，不包含 layerId
  // 按层失效通过 invalidateByScopes 实现
  return 0
}

// ============================================================================
// 5. 缓存统计（调试用）
// ============================================================================

/** Artifact 缓存条目数 */
export function artifactCacheSize(): number {
  return artifactCache.size
}

/** 基础缓存条目数 */
export function baseCacheSize(): number {
  return cache.size
}
