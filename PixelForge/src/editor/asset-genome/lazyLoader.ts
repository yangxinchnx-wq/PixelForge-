/**
 * Lazy Loading & Index(Step 35.5)— 增量加载 + 索引。
 *
 * 职责:
 * - 资产加载状态管理(loading / loaded / error / unloaded)
 * - 按需加载(payload loader 回调,不绑定具体 IO)
 * - 多维索引(name / kind / category / tags)
 * - 加载优先级(priority queue)
 *
 * 不职责:
 * - 不做具体文件 IO(由调用方提供 loader 回调)
 * - 不做缓存(由 textureCache 等模块负责)
 *
 * 设计:
 * - AssetLoadState: 记录每个资产的加载状态
 * - AssetIndex: 多维倒排索引(name / kind / category / tags)
 * - LazyLoader: 按需加载协调器
 */
import type { AssetCategory, AssetKind } from './assetRegistry'

// ============================================================================
// 1. 加载状态
// ============================================================================

/** 加载状态 */
export type LoadState = 'unloaded' | 'loading' | 'loaded' | 'error'

/** 加载状态记录 */
export interface AssetLoadStatus {
  /** 资产 ID */
  assetId: string
  /** 当前状态 */
  state: LoadState
  /** 加载开始时间(loading 状态时) */
  startedAt?: number
  /** 加载完成时间(loaded 状态时) */
  completedAt?: number
  /** 错误信息(error 状态时) */
  error?: string
  /** 加载优先级(数字越大优先级越高,默认 0) */
  priority: number
}

/** 加载状态表(assetId → status) */
export type LoadStatusTable = Map<string, AssetLoadStatus>

// ============================================================================
// 2. 加载状态纯函数
// ============================================================================

/** 创建空加载状态表 */
export function createLoadStatusTable(): LoadStatusTable {
  return new Map()
}

/**
 * 标记资产为 loading 状态。
 *
 * @param table 原状态表
 * @param assetId 资产 ID
 * @param priority 优先级(默认 0)
 */
export function markLoading(
  table: LoadStatusTable,
  assetId: string,
  priority = 0,
): LoadStatusTable {
  const next = new Map(table)
  next.set(assetId, {
    assetId,
    state: 'loading',
    startedAt: Date.now(),
    priority,
  })
  return next
}

/**
 * 标记资产为 loaded 状态。
 */
export function markLoaded(table: LoadStatusTable, assetId: string): LoadStatusTable {
  const existing = table.get(assetId)
  const next = new Map(table)
  next.set(assetId, {
    assetId,
    state: 'loaded',
    startedAt: existing?.startedAt,
    completedAt: Date.now(),
    priority: existing?.priority ?? 0,
  })
  return next
}

/**
 * 标记资产为 error 状态。
 */
export function markError(table: LoadStatusTable, assetId: string, error: string): LoadStatusTable {
  const existing = table.get(assetId)
  const next = new Map(table)
  next.set(assetId, {
    assetId,
    state: 'error',
    startedAt: existing?.startedAt,
    priority: existing?.priority ?? 0,
    error,
  })
  return next
}

/**
 * 重置资产为 unloaded 状态。
 */
export function markUnloaded(table: LoadStatusTable, assetId: string): LoadStatusTable {
  const existing = table.get(assetId)
  const next = new Map(table)
  next.set(assetId, {
    assetId,
    state: 'unloaded',
    priority: existing?.priority ?? 0,
  })
  return next
}

/**
 * 移除资产的加载状态。
 */
export function removeLoadStatus(table: LoadStatusTable, assetId: string): LoadStatusTable {
  if (!table.has(assetId)) return table
  const next = new Map(table)
  next.delete(assetId)
  return next
}

/**
 * 获取资产的加载状态。
 */
export function getLoadStatus(table: LoadStatusTable, assetId: string): AssetLoadStatus | undefined {
  return table.get(assetId)
}

/**
 * 检查资产是否已加载。
 */
export function isLoaded(table: LoadStatusTable, assetId: string): boolean {
  return table.get(assetId)?.state === 'loaded'
}

/**
 * 检查资产是否正在加载。
 */
export function isLoading(table: LoadStatusTable, assetId: string): boolean {
  return table.get(assetId)?.state === 'loading'
}

/**
 * 获取按优先级排序的待加载列表(state=unloaded 或 error,按 priority 降序)。
 */
export function getPendingLoads(table: LoadStatusTable): AssetLoadStatus[] {
  const result: AssetLoadStatus[] = []
  for (const status of table.values()) {
    if (status.state === 'unloaded' || status.state === 'error') {
      result.push(status)
    }
  }
  return result.sort((a, b) => b.priority - a.priority)
}

/**
 * 统计各状态的资产数。
 */
export function getLoadStats(table: LoadStatusTable): Record<LoadState, number> {
  const stats: Record<LoadState, number> = {
    unloaded: 0,
    loading: 0,
    loaded: 0,
    error: 0,
  }
  for (const status of table.values()) {
    stats[status.state]++
  }
  return stats
}

// ============================================================================
// 3. 资产索引(多维倒排)
// ============================================================================

/** 资产索引(name / kind / category / tags 倒排) */
export interface AssetIndex {
  /** 名称索引(小写,资产 ID 列表) */
  nameIndex: Map<string, Set<string>>
  /** 种类索引 */
  kindIndex: Map<AssetKind, Set<string>>
  /** 大类索引 */
  categoryIndex: Map<AssetCategory, Set<string>>
  /** 标签索引 */
  tagIndex: Map<string, Set<string>>
}

/** 创建空索引 */
export function createAssetIndex(): AssetIndex {
  return {
    nameIndex: new Map(),
    kindIndex: new Map(),
    categoryIndex: new Map(),
    tagIndex: new Map(),
  }
}

/** 索引项(可索引的资产元数据) */
export interface IndexableAsset {
  id: string
  name: string
  kind: AssetKind
  category: AssetCategory
  tags: string[]
}

/**
 * 把资产添加到索引。
 */
export function indexAsset(index: AssetIndex, asset: IndexableAsset): AssetIndex {
  const next: AssetIndex = {
    nameIndex: new Map(index.nameIndex),
    kindIndex: new Map(index.kindIndex),
    categoryIndex: new Map(index.categoryIndex),
    tagIndex: new Map(index.tagIndex),
  }

  // 名称索引(小写)
  const nameKey = asset.name.toLowerCase()
  const nameSet = new Set(next.nameIndex.get(nameKey) ?? [])
  nameSet.add(asset.id)
  next.nameIndex.set(nameKey, nameSet)

  // 种类索引
  const kindSet = new Set(next.kindIndex.get(asset.kind) ?? [])
  kindSet.add(asset.id)
  next.kindIndex.set(asset.kind, kindSet)

  // 大类索引
  const catSet = new Set(next.categoryIndex.get(asset.category) ?? [])
  catSet.add(asset.id)
  next.categoryIndex.set(asset.category, catSet)

  // 标签索引
  for (const tag of asset.tags) {
    const tagSet = new Set(next.tagIndex.get(tag) ?? [])
    tagSet.add(asset.id)
    next.tagIndex.set(tag, tagSet)
  }

  return next
}

/**
 * 批量索引资产。
 */
export function indexManyAssets(index: AssetIndex, assets: IndexableAsset[]): AssetIndex {
  let next = index
  for (const asset of assets) {
    next = indexAsset(next, asset)
  }
  return next
}

/**
 * 从索引中移除资产。
 */
export function unindexAsset(index: AssetIndex, assetId: string, asset?: IndexableAsset): AssetIndex {
  const next: AssetIndex = {
    nameIndex: new Map(index.nameIndex),
    kindIndex: new Map(index.kindIndex),
    categoryIndex: new Map(index.categoryIndex),
    tagIndex: new Map(index.tagIndex),
  }

  // 若提供了完整 asset 信息,精确移除
  if (asset) {
    const nameKey = asset.name.toLowerCase()
    removeFromIndexSet(next.nameIndex, nameKey, assetId)
    removeFromIndexSet(next.kindIndex, asset.kind, assetId)
    removeFromIndexSet(next.categoryIndex, asset.category, assetId)
    for (const tag of asset.tags) {
      removeFromIndexSet(next.tagIndex, tag, assetId)
    }
  } else {
    // 否则全量扫描移除(性能低,但保证正确)
    removeFromIndexSetValues(next.nameIndex, assetId)
    removeFromIndexSetValues(next.kindIndex, assetId)
    removeFromIndexSetValues(next.categoryIndex, assetId)
    removeFromIndexSetValues(next.tagIndex, assetId)
  }

  return next
}

/** 从 Map<key, Set> 中移除某个 value */
function removeFromIndexSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const set = map.get(key)
  if (!set) return
  set.delete(value)
  if (set.size === 0) map.delete(key)
}

/** 全量扫描 Map<key, Set> 移除某个 value */
function removeFromIndexSetValues<K>(map: Map<K, Set<string>>, value: string): void {
  for (const [key, set] of map) {
    set.delete(value)
    if (set.size === 0) map.delete(key)
  }
}

/**
 * 按名称查询(精确匹配,大小写不敏感)。
 */
export function queryByName(index: AssetIndex, name: string): string[] {
  const set = index.nameIndex.get(name.toLowerCase())
  return set ? Array.from(set) : []
}

/**
 * 按种类查询。
 */
export function queryByKind(index: AssetIndex, kind: AssetKind): string[] {
  const set = index.kindIndex.get(kind)
  return set ? Array.from(set) : []
}

/**
 * 按大类查询。
 */
export function queryByCategory(index: AssetIndex, category: AssetCategory): string[] {
  const set = index.categoryIndex.get(category)
  return set ? Array.from(set) : []
}

/**
 * 按标签查询(OR 语义)。
 */
export function queryByTags(index: AssetIndex, tags: string[]): string[] {
  const result = new Set<string>()
  for (const tag of tags) {
    const set = index.tagIndex.get(tag)
    if (set) {
      for (const id of set) result.add(id)
    }
  }
  return Array.from(result)
}

/**
 * 获取索引统计信息。
 */
export function getIndexStats(index: AssetIndex): {
  nameKeys: number
  kindKeys: number
  categoryKeys: number
  tagKeys: number
  totalIndexed: number
} {
  let total = 0
  for (const set of index.kindIndex.values()) total += set.size
  return {
    nameKeys: index.nameIndex.size,
    kindKeys: index.kindIndex.size,
    categoryKeys: index.categoryIndex.size,
    tagKeys: index.tagIndex.size,
    totalIndexed: total,
  }
}

// ============================================================================
// 4. 懒加载协调器
// ============================================================================

/** Loader 回调(由调用方提供) */
export type AssetLoader = (assetId: string) => Promise<void>

/**
 * 懒加载协调器。
 * - 接受 loader 回调
 * - 按优先级加载
 * - 防重复加载(loading 状态的不重复触发)
 */
export interface LazyLoader {
  /** 加载状态表 */
  statusTable: LoadStatusTable
  /** loader 回调 */
  loader: AssetLoader
}

/**
 * 创建懒加载协调器。
 *
 * @param loader 实际加载回调
 */
export function createLazyLoader(loader: AssetLoader): LazyLoader {
  return {
    statusTable: createLoadStatusTable(),
    loader,
  }
}

/**
 * 请求加载资产(若已加载或正在加载则跳过)。
 *
 * 标记为 unloaded 状态(表示"加入待加载队列"),
 * 由 executeBatchLoads 统一调度执行。
 *
 * @param lazyLoader 协调器
 * @param assetId 资产 ID
 * @param priority 优先级
 * @returns 更新后的协调器
 */
export function requestLoad(
  lazyLoader: LazyLoader,
  assetId: string,
  priority = 0,
): LazyLoader {
  const existing = lazyLoader.statusTable.get(assetId)
  if (existing?.state === 'loading' || existing?.state === 'loaded') {
    return lazyLoader // 已加载或正在加载
  }

  // 标记为 unloaded + priority(加入待加载队列)
  const nextTable: LoadStatusTable = new Map(lazyLoader.statusTable)
  nextTable.set(assetId, {
    assetId,
    state: 'unloaded',
    priority,
  })
  return { ...lazyLoader, statusTable: nextTable }
}

/**
 * 执行加载(调用 loader 回调,更新状态)。
 * 标记为 loading,执行 loader,标记为 loaded / error。
 *
 * @param lazyLoader 协调器
 * @param assetId 资产 ID
 */
export async function executeLoad(
  lazyLoader: LazyLoader,
  assetId: string,
): Promise<LazyLoader> {
  // 先标记为 loading
  const loadingTable = markLoading(
    lazyLoader.statusTable,
    assetId,
    lazyLoader.statusTable.get(assetId)?.priority ?? 0,
  )
  const loading = { ...lazyLoader, statusTable: loadingTable }

  try {
    await lazyLoader.loader(assetId)
    return { ...loading, statusTable: markLoaded(loading.statusTable, assetId) }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...loading, statusTable: markError(loading.statusTable, assetId, msg) }
  }
}

/**
 * 批量加载(按优先级顺序)。
 *
 * 采用顺序执行(而非并行),避免多个 executeLoad 基于同一份状态导致合并冲突。
 *
 * @param lazyLoader 协调器
 * @param maxConcurrent 最大并发数(保留参数,当前实现为顺序)
 */
export async function executeBatchLoads(
  lazyLoader: LazyLoader,
  _maxConcurrent = 4,
): Promise<LazyLoader> {
  const pending = getPendingLoads(lazyLoader.statusTable)
  if (pending.length === 0) return lazyLoader

  let current = lazyLoader
  for (const p of pending) {
    current = await executeLoad(current, p.assetId)
  }
  return current
}
