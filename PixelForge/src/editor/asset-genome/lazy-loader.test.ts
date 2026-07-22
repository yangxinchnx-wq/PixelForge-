/**
 * Lazy Loading & Index Tests(Step 35.5)— 增量加载 + 索引测试套件。
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  createLoadStatusTable,
  markLoading,
  markLoaded,
  markError,
  markUnloaded,
  removeLoadStatus,
  getLoadStatus,
  isLoaded,
  isLoading,
  getPendingLoads,
  getLoadStats,
  createAssetIndex,
  indexAsset,
  indexManyAssets,
  unindexAsset,
  queryByName,
  queryByKind,
  queryByCategory,
  queryByTags,
  getIndexStats,
  createLazyLoader,
  requestLoad,
  executeLoad,
  executeBatchLoads,
} from './lazyLoader'
import type { IndexableAsset } from './lazyLoader'

// ============================================================================
// LS — Load Status
// ============================================================================

describe('Lazy Loading — Load Status (LS)', () => {
  let table: ReturnType<typeof createLoadStatusTable>

  beforeEach(() => {
    table = createLoadStatusTable()
  })

  it('LS01: createLoadStatusTable 返回空 Map', () => {
    expect(table.size).toBe(0)
  })

  it('LS02: markLoading 设置 loading 状态', () => {
    table = markLoading(table, 'a1', 5)
    const status = table.get('a1')
    expect(status?.state).toBe('loading')
    expect(status?.priority).toBe(5)
    expect(status?.startedAt).toBeGreaterThan(0)
  })

  it('LS03: markLoaded 设置 loaded 状态', () => {
    table = markLoading(table, 'a1')
    table = markLoaded(table, 'a1')
    expect(table.get('a1')?.state).toBe('loaded')
    expect(table.get('a1')?.completedAt).toBeGreaterThan(0)
  })

  it('LS04: markError 设置 error 状态', () => {
    table = markLoading(table, 'a1')
    table = markError(table, 'a1', '加载失败')
    expect(table.get('a1')?.state).toBe('error')
    expect(table.get('a1')?.error).toBe('加载失败')
  })

  it('LS05: markUnloaded 重置为 unloaded', () => {
    table = markLoaded(table, 'a1')
    table = markUnloaded(table, 'a1')
    expect(table.get('a1')?.state).toBe('unloaded')
  })

  it('LS06: removeLoadStatus 移除状态', () => {
    table = markLoading(table, 'a1')
    table = removeLoadStatus(table, 'a1')
    expect(table.has('a1')).toBe(false)
  })

  it('LS07: removeLoadStatus 不存在返回原表', () => {
    const before = table
    const after = removeLoadStatus(table, 'nonexistent')
    expect(after).toBe(before)
  })

  it('LS08: getLoadStatus 获取状态', () => {
    table = markLoading(table, 'a1')
    expect(getLoadStatus(table, 'a1')?.state).toBe('loading')
    expect(getLoadStatus(table, 'nope')).toBeUndefined()
  })

  it('LS09: isLoaded / isLoading', () => {
    table = markLoading(table, 'a1')
    expect(isLoading(table, 'a1')).toBe(true)
    expect(isLoaded(table, 'a1')).toBe(false)
    table = markLoaded(table, 'a1')
    expect(isLoading(table, 'a1')).toBe(false)
    expect(isLoaded(table, 'a1')).toBe(true)
  })

  it('LS10: getPendingLoads 返回 unloaded + error,按优先级排序', () => {
    table = markLoading(table, 'a1', 1)
    table = markUnloaded(table, 'a2')
    table = markLoading(table, 'a2', 5)
    table = markUnloaded(table, 'a2') // 重置为 unloaded
    table = markUnloaded(table, 'a3')
    const pending = getPendingLoads(table)
    // a2 和 a3 是 unloaded,a1 是 loading(不在 pending)
    expect(pending).toHaveLength(2)
    expect(pending.map((p) => p.assetId)).toContain('a2')
    expect(pending.map((p) => p.assetId)).toContain('a3')
  })

  it('LS11: getLoadStats 统计各状态', () => {
    table = markLoading(table, 'a1')
    table = markLoaded(table, 'a2')
    table = markUnloaded(table, 'a3')
    table = markError(table, 'a4', 'e')
    const stats = getLoadStats(table)
    expect(stats.loading).toBe(1)
    expect(stats.loaded).toBe(1)
    expect(stats.unloaded).toBe(1)
    expect(stats.error).toBe(1)
  })
})

// ============================================================================
// AI — Asset Index
// ============================================================================

describe('Lazy Loading — Asset Index (AI)', () => {
  let index: ReturnType<typeof createAssetIndex>

  beforeEach(() => {
    index = createAssetIndex()
  })

  it('AI01: createAssetIndex 返回空索引', () => {
    expect(index.nameIndex.size).toBe(0)
    expect(index.kindIndex.size).toBe(0)
    expect(index.categoryIndex.size).toBe(0)
    expect(index.tagIndex.size).toBe(0)
  })

  it('AI02: indexAsset 添加到名称索引', () => {
    const asset: IndexableAsset = {
      id: 'a1',
      name: 'test',
      kind: 'image',
      category: 'media',
      tags: [],
    }
    index = indexAsset(index, asset)
    expect(queryByName(index, 'test')).toEqual(['a1'])
    expect(queryByName(index, 'TEST')).toEqual(['a1']) // 大小写不敏感
  })

  it('AI03: indexAsset 添加到种类索引', () => {
    index = indexAsset(index, { id: 'a1', name: 't', kind: 'image', category: 'media', tags: [] })
    expect(queryByKind(index, 'image')).toEqual(['a1'])
  })

  it('AI04: indexAsset 添加到大类索引', () => {
    index = indexAsset(index, { id: 'a1', name: 't', kind: 'image', category: 'media', tags: [] })
    expect(queryByCategory(index, 'media')).toEqual(['a1'])
  })

  it('AI05: indexAsset 添加到标签索引', () => {
    index = indexAsset(index, { id: 'a1', name: 't', kind: 'image', category: 'media', tags: ['fav', 'nature'] })
    expect(queryByTags(index, ['fav'])).toEqual(['a1'])
    expect(queryByTags(index, ['nature'])).toEqual(['a1'])
    expect(queryByTags(index, ['fav', 'nature'])).toEqual(['a1']) // OR 语义去重
  })

  it('AI06: indexManyAssets 批量索引', () => {
    const assets: IndexableAsset[] = [
      { id: 'a1', name: 'a', kind: 'image', category: 'media', tags: [] },
      { id: 'a2', name: 'b', kind: 'audio', category: 'media', tags: [] },
    ]
    index = indexManyAssets(index, assets)
    expect(queryByName(index, 'a')).toEqual(['a1'])
    expect(queryByName(index, 'b')).toEqual(['a2'])
  })

  it('AI07: unindexAsset 精确移除(提供完整信息)', () => {
    const asset: IndexableAsset = {
      id: 'a1',
      name: 'test',
      kind: 'image',
      category: 'media',
      tags: ['fav'],
    }
    index = indexAsset(index, asset)
    index = unindexAsset(index, 'a1', asset)
    expect(queryByName(index, 'test')).toEqual([])
    expect(queryByKind(index, 'image')).toEqual([])
    expect(queryByTags(index, ['fav'])).toEqual([])
  })

  it('AI08: unindexAsset 全量扫描移除(不提供信息)', () => {
    index = indexAsset(index, { id: 'a1', name: 't', kind: 'image', category: 'media', tags: ['x'] })
    index = unindexAsset(index, 'a1')
    expect(queryByName(index, 't')).toEqual([])
    expect(queryByKind(index, 'image')).toEqual([])
    expect(queryByTags(index, ['x'])).toEqual([])
  })

  it('AI09: queryByTags OR 语义', () => {
    index = indexAsset(index, { id: 'a1', name: 't', kind: 'image', category: 'media', tags: ['x'] })
    index = indexAsset(index, { id: 'a2', name: 't2', kind: 'image', category: 'media', tags: ['y'] })
    const result = queryByTags(index, ['x', 'y'])
    expect(result).toHaveLength(2)
    expect(result).toContain('a1')
    expect(result).toContain('a2')
  })

  it('AI10: getIndexStats 统计', () => {
    index = indexAsset(index, { id: 'a1', name: 't', kind: 'image', category: 'media', tags: ['x', 'y'] })
    index = indexAsset(index, { id: 'a2', name: 't2', kind: 'audio', category: 'media', tags: ['x'] })
    const stats = getIndexStats(index)
    expect(stats.nameKeys).toBe(2)
    expect(stats.kindKeys).toBe(2)
    expect(stats.categoryKeys).toBe(1)
    expect(stats.tagKeys).toBe(2)
    expect(stats.totalIndexed).toBe(2)
  })
})

// ============================================================================
// LL — Lazy Loader
// ============================================================================

describe('Lazy Loading — LazyLoader (LL)', () => {
  it('LL01: createLazyLoader 创建协调器', () => {
    const loader = createLazyLoader(async () => {})
    expect(loader.statusTable.size).toBe(0)
  })

  it('LL02: requestLoad 标记为 unloaded + priority(待加载队列)', () => {
    const loader = createLazyLoader(async () => {})
    const next = requestLoad(loader, 'a1', 5)
    expect(next.statusTable.get('a1')?.state).toBe('unloaded')
    expect(next.statusTable.get('a1')?.priority).toBe(5)
  })

  it('LL03: requestLoad 已加载的不重复触发', () => {
    let loader = createLazyLoader(async () => {})
    loader = requestLoad(loader, 'a1')
    // 手动标记为 loaded,模拟已加载
    loader = { ...loader, statusTable: markLoaded(loader.statusTable, 'a1') }
    const before = loader
    loader = requestLoad(loader, 'a1') // 再次请求
    expect(loader).toBe(before) // 返回原对象
  })

  it('LL04: executeLoad 成功后状态为 loaded', async () => {
    let loaded = false
    const loader = createLazyLoader(async () => {
      loaded = true
    })
    let next = requestLoad(loader, 'a1')
    next = await executeLoad(next, 'a1')
    expect(loaded).toBe(true)
    expect(next.statusTable.get('a1')?.state).toBe('loaded')
  })

  it('LL05: executeLoad 失败后状态为 error', async () => {
    const loader = createLazyLoader(async () => {
      throw new Error('加载失败')
    })
    let next = requestLoad(loader, 'a1')
    next = await executeLoad(next, 'a1')
    expect(next.statusTable.get('a1')?.state).toBe('error')
    expect(next.statusTable.get('a1')?.error).toBe('加载失败')
  })

  it('LL06: executeBatchLoads 批量加载', async () => {
    const loadedIds: string[] = []
    const loader = createLazyLoader(async (id: string) => {
      loadedIds.push(id)
    })
    let next = requestLoad(loader, 'a1', 1)
    next = requestLoad(next, 'a2', 2)
    next = requestLoad(next, 'a3', 3)
    next = await executeBatchLoads(next, 2)
    expect(loadedIds).toHaveLength(3)
    expect(next.statusTable.get('a1')?.state).toBe('loaded')
    expect(next.statusTable.get('a2')?.state).toBe('loaded')
    expect(next.statusTable.get('a3')?.state).toBe('loaded')
  })

  it('LL07: executeBatchLoads 无待加载返回原协调器', async () => {
    const loader = createLazyLoader(async () => {})
    const next = await executeBatchLoads(loader)
    expect(next).toBe(loader)
  })
})
