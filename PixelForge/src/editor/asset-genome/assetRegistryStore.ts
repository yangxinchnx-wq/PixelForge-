/**
 * Asset Registry Store(Step 35.1)— 资产注册表 Pinia Store。
 *
 * 职责:
 * - 维护全局资产注册表(Map<id, AssetRecord>)
 * - 提供 computed 查询(all/count/byKind/byCategory/byTag/grouped)
 * - 提供 actions 封装纯函数操作
 *
 * 响应式触发模式:
 * - 每次修改 Map 后用 `registry.value = new Map(registry.value)` 替换引用
 * - 确保所有 computed 重新计算
 *
 * 与 assetRegistry.ts 的关系:
 * - 纯函数在 assetRegistry.ts,Store 在此文件
 * - Store actions 调用纯函数,然后赋值触发响应式
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  type AssetCategory,
  type AssetKind,
  type AssetRecord,
  type AssetRegistry,
  type AssetSource,
  type CreateAssetRecordOptions,
  ALL_ASSET_KINDS,
  addTag,
  bumpVersion,
  clearRegistry,
  createAssetRecord,
  createRegistry,
  getAllAssets,
  getAssetById,
  getAssetCount,
  getAssetsByCategory,
  getAssetsByKind,
  getAssetsBySource,
  getAssetsByTag,
  groupByCategory,
  groupByKind,
  hasAsset,
  registerAsset,
  registerManyAssets,
  removeTag,
  renameAsset,
  searchAssets,
  unregisterAsset,
  updateAssetMetadata,
} from './assetRegistry'

export const useAssetRegistryStore = defineStore('pf-asset-registry', () => {
  // ============================================================================
  // 1. State
  // ============================================================================

  const registry = ref<AssetRegistry>(createRegistry())

  // ============================================================================
  // 2. Computed — 基础查询
  // ============================================================================

  /** 全部资产列表 */
  const all = computed<AssetRecord[]>(() => getAllAssets(registry.value))

  /** 资产总数 */
  const count = computed<number>(() => getAssetCount(registry.value))

  /** 是否为空 */
  const isEmpty = computed<boolean>(() => registry.value.size === 0)

  // ============================================================================
  // 3. Computed — 分组查询
  // ============================================================================

  /** 按大类分组 */
  const grouped = computed<Record<AssetCategory, AssetRecord[]>>(() =>
    groupByCategory(registry.value),
  )

  /** 按种类分组 */
  const groupedByKind = computed<Partial<Record<AssetKind, AssetRecord[]>>>(() =>
    groupByKind(registry.value),
  )

  /** 各大类资产数 */
  const countByCategory = computed<Record<AssetCategory, number>>(() => {
    const g = grouped.value
    return {
      media: g.media.length,
      shader: g.shader.length,
      scene: g.scene.length,
      config: g.config.length,
    }
  })

  /** 各种类资产数 */
  const countByKind = computed<Partial<Record<AssetKind, number>>>(() => {
    const result: Partial<Record<AssetKind, number>> = {}
    for (const kind of ALL_ASSET_KINDS) {
      result[kind] = 0
    }
    for (const record of registry.value.values()) {
      result[record.kind] = (result[record.kind] ?? 0) + 1
    }
    return result
  })

  /** 内置资产数 */
  const builtinCount = computed<number>(() =>
    getAssetsBySource(registry.value, 'builtin').length,
  )

  /** 用户资产数 */
  const userCount = computed<number>(() => getAssetsBySource(registry.value, 'user').length)

  /** 导入资产数 */
  const importedCount = computed<number>(() =>
    getAssetsBySource(registry.value, 'imported').length,
  )

  // ============================================================================
  // 4. Actions — 工厂与注册
  // ============================================================================

  /**
   * 创建并注册资产。
   *
   * @param options 创建参数(见 createAssetRecord)
   * @returns 新资产记录
   * @throws 若 ID 冲突
   */
  function create(options: CreateAssetRecordOptions): AssetRecord {
    const record = createAssetRecord(options)
    registry.value = registerAsset(registry.value, record)
    return record
  }

  /**
   * 注册已有资产记录。
   *
   * @param record 资产记录
   * @throws 若 ID 冲突
   */
  function register(record: AssetRecord): void {
    registry.value = registerAsset(registry.value, record)
  }

  /**
   * 批量注册(已存在的 ID 跳过)。
   */
  function registerMany(records: AssetRecord[]): void {
    registry.value = registerManyAssets(registry.value, records)
  }

  // ============================================================================
  // 5. Actions — CRUD
  // ============================================================================

  /** 注销资产 */
  function unregister(id: string): void {
    registry.value = unregisterAsset(registry.value, id)
  }

  /** 重命名 */
  function rename(id: string, newName: string): void {
    registry.value = renameAsset(registry.value, id, newName)
  }

  /**
   * 更新元数据(patch 模式)。
   */
  function update(
    id: string,
    patch: Partial<Pick<AssetRecord, 'name' | 'description' | 'source' | 'size' | 'thumbnail' | 'payloadRef' | 'contentHash'>>,
  ): void {
    registry.value = updateAssetMetadata(registry.value, id, patch)
  }

  /** 添加标签 */
  function addAssetTag(id: string, tag: string): void {
    registry.value = addTag(registry.value, id, tag)
  }

  /** 移除标签 */
  function removeAssetTag(id: string, tag: string): void {
    registry.value = removeTag(registry.value, id, tag)
  }

  /** 版本号 +1 */
  function bump(id: string): void {
    registry.value = bumpVersion(registry.value, id)
  }

  /** 清空注册表 */
  function clear(): void {
    registry.value = clearRegistry(registry.value)
  }

  /** 重置为空注册表(等价于 clear) */
  function reset(): void {
    registry.value = createRegistry()
  }

  // ============================================================================
  // 6. Actions — 查询(同步函数,读取当前 registry.value)
  // ============================================================================

  function getById(id: string): AssetRecord | undefined {
    return getAssetById(registry.value, id)
  }

  function exists(id: string): boolean {
    return hasAsset(registry.value, id)
  }

  function listByKind(kind: AssetKind): AssetRecord[] {
    return getAssetsByKind(registry.value, kind)
  }

  function listByCategory(category: AssetCategory): AssetRecord[] {
    return getAssetsByCategory(registry.value, category)
  }

  function listByTag(tags: string[]): AssetRecord[] {
    return getAssetsByTag(registry.value, tags)
  }

  function listBySource(source: AssetSource): AssetRecord[] {
    return getAssetsBySource(registry.value, source)
  }

  function search(query: string): AssetRecord[] {
    return searchAssets(registry.value, query)
  }

  return {
    // state
    registry,
    // computed
    all,
    count,
    isEmpty,
    grouped,
    groupedByKind,
    countByCategory,
    countByKind,
    builtinCount,
    userCount,
    importedCount,
    // actions — factory
    create,
    register,
    registerMany,
    // actions — crud
    unregister,
    rename,
    update,
    addAssetTag,
    removeAssetTag,
    bump,
    clear,
    reset,
    // actions — query
    getById,
    exists,
    listByKind,
    listByCategory,
    listByTag,
    listBySource,
    search,
  }
})
