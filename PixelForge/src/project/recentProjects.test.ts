/**
 * recentProjects.test.ts — 最近项目记录模块测试。
 *
 * 测试分组:
 *   F: 工厂  / R: 添加/移除/清空 / Q: 查询 / S: 排序
 *   LS: localStorage 序列化反序列化 / SE: 搜索 / ST: Store
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import {
  addRecent,
  clearRecent,
  createRecentList,
  findRecent,
  searchRecent,
  sortByOpenedAt,
  removeRecent,
  serializeRecentList,
  deserializeRecentList,
  loadRecentFromStorage,
  saveRecentToStorage,
  clearRecentStorage,
  useRecentProjectsStore,
  MAX_RECENT_PROJECTS,
  RECENT_PROJECTS_STORAGE_KEY,
  type RecentProjectEntry,
} from './recentProjects'

// —— 测试辅助 ——

function makeEntry(overrides: Partial<RecentProjectEntry> = {}): RecentProjectEntry {
  return {
    id: overrides.id ?? 'p1',
    name: overrides.name ?? 'Project 1',
    filePath: overrides.filePath ?? '',
    fileSize: overrides.fileSize ?? 1024,
    openedAt: overrides.openedAt ?? 1000,
    createdAt: overrides.createdAt ?? 500,
    canvasSize: overrides.canvasSize ?? { width: 1024, height: 768 },
  }
}

// ============================================================================
// 1. 工厂
// ============================================================================

describe('recentProjects / 工厂', () => {
  it('F01: createRecentList 返回空数组', () => {
    expect(createRecentList()).toEqual([])
  })
})

// ============================================================================
// 2. 添加 / 移除 / 清空 (LRU)
// ============================================================================

describe('recentProjects / 添加 (LRU)', () => {
  it('R01: 空列表添加一条', () => {
    const list = createRecentList()
    const next = addRecent(list, makeEntry({ id: 'a' }))
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('a')
  })

  it('R02: 新条目插入到列表顶部', () => {
    const list = [makeEntry({ id: 'a', openedAt: 1000 })]
    const next = addRecent(list, makeEntry({ id: 'b', openedAt: 2000 }))
    expect(next[0].id).toBe('b')
    expect(next[1].id).toBe('a')
  })

  it('R03: 同 id 重复打开,更新条目并移到顶部', () => {
    const list = [
      makeEntry({ id: 'a', openedAt: 1000 }),
      makeEntry({ id: 'b', openedAt: 2000 }),
    ]
    const next = addRecent(list, makeEntry({ id: 'a', openedAt: 3000, name: 'Updated' }))
    expect(next).toHaveLength(2)
    expect(next[0].id).toBe('a')
    expect(next[0].name).toBe('Updated')
    expect(next[0].openedAt).toBe(3000)
    expect(next[1].id).toBe('b')
  })

  it('R04: 超过 maxItems 淘汰列表末尾', () => {
    const list = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `p${i}`, openedAt: 1000 + i }),
    )
    const next = addRecent(list, makeEntry({ id: 'new', openedAt: 9999 }), 10)
    expect(next).toHaveLength(10)
    expect(next[0].id).toBe('new')
    expect(next[9].id).toBe('p8')  // p9 被淘汰
  })

  it('R05: 自定义 maxItems', () => {
    const list = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
    const next = addRecent(list, makeEntry({ id: 'c' }), 2)
    expect(next).toHaveLength(2)
    expect(next[0].id).toBe('c')
    expect(next[1].id).toBe('a')
  })

  it('R06: 不修改原数组(不可变)', () => {
    const list = [makeEntry({ id: 'a' })]
    const original = [...list]
    addRecent(list, makeEntry({ id: 'b' }))
    expect(list).toEqual(original)
  })
})

describe('recentProjects / 移除', () => {
  it('R07: 移除指定 id', () => {
    const list = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
    const next = removeRecent(list, 'a')
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('b')
  })

  it('R08: 移除不存在的 id 无变化', () => {
    const list = [makeEntry({ id: 'a' })]
    const next = removeRecent(list, 'xyz')
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe('a')
  })

  it('R09: clearRecent 返回空数组', () => {
    expect(clearRecent()).toEqual([])
  })
})

// ============================================================================
// 3. 查询
// ============================================================================

describe('recentProjects / 查询', () => {
  it('Q01: findRecent 找到条目', () => {
    const list = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
    const found = findRecent(list, 'b')
    expect(found?.id).toBe('b')
  })

  it('Q02: findRecent 未找到返回 undefined', () => {
    const list = [makeEntry({ id: 'a' })]
    expect(findRecent(list, 'xyz')).toBeUndefined()
  })

  it('Q03: searchRecent 模糊匹配(大小写不敏感)', () => {
    const list = [
      makeEntry({ id: '1', name: 'Starry Night' }),
      makeEntry({ id: '2', name: 'Ocean Sunset' }),
      makeEntry({ id: '3', name: 'starry sky' }),
    ]
    const results = searchRecent(list, 'star')
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('1')
    expect(results[1].id).toBe('3')
  })

  it('Q04: searchRecent 空查询返回全部', () => {
    const list = [makeEntry({ id: '1' }), makeEntry({ id: '2' })]
    const results = searchRecent(list, '')
    expect(results).toHaveLength(2)
  })

  it('Q05: searchRecent 无匹配返回空', () => {
    const list = [makeEntry({ id: '1', name: 'Project' })]
    expect(searchRecent(list, 'xyz')).toHaveLength(0)
  })

  it('Q06: sortByOpenedAt 按时间降序', () => {
    const list = [
      makeEntry({ id: 'a', openedAt: 1000 }),
      makeEntry({ id: 'b', openedAt: 3000 }),
      makeEntry({ id: 'c', openedAt: 2000 }),
    ]
    const sorted = sortByOpenedAt(list)
    expect(sorted[0].id).toBe('b')
    expect(sorted[1].id).toBe('c')
    expect(sorted[2].id).toBe('a')
  })
})

// ============================================================================
// 4. 序列化 / 反序列化
// ============================================================================

describe('recentProjects / 序列化', () => {
  it('LS01: serializeRecentList 输出 JSON 字符串', () => {
    const list = [makeEntry({ id: 'a' })]
    const json = serializeRecentList(list)
    expect(JSON.parse(json)).toEqual(list)
  })

  it('LS02: deserializeRecentList 正常解析', () => {
    const list = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })]
    const json = serializeRecentList(list)
    const restored = deserializeRecentList(json)
    expect(restored).toEqual(list)
  })

  it('LS03: deserializeRecentList JSON 解析失败返回空', () => {
    expect(deserializeRecentList('not json')).toEqual([])
  })

  it('LS04: deserializeRecentList 非数组返回空', () => {
    expect(deserializeRecentList('{"id":"a"}')).toEqual([])
  })

  it('LS05: deserializeRecentList 跳过字段缺失的条目', () => {
    const json = JSON.stringify([
      makeEntry({ id: 'a' }),
      { id: 'b', name: 'B' },  // 缺 filePath / openedAt / createdAt / canvasSize
      makeEntry({ id: 'c' }),
    ])
    const restored = deserializeRecentList(json)
    expect(restored).toHaveLength(2)
    expect(restored[0].id).toBe('a')
    expect(restored[1].id).toBe('c')
  })

  it('LS06: deserializeRecentList 跳过 id 非字符串的条目', () => {
    const json = JSON.stringify([
      makeEntry({ id: 'a' }),
      { id: 123, name: 'B', filePath: '', openedAt: 1, createdAt: 1, canvasSize: { width: 1, height: 1 } },
    ])
    const restored = deserializeRecentList(json)
    expect(restored).toHaveLength(1)
  })
})

// ============================================================================
// 5. localStorage 读写
// ============================================================================

describe('recentProjects / localStorage', () => {
  let storage: Record<string, string> = {}

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v },
      removeItem: (k: string) => { delete storage[k] },
      clear: () => { storage = {} },
      key: (i: number) => Object.keys(storage)[i] ?? null,
      length: 0,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('LS07: saveRecentToStorage 写入 localStorage', () => {
    const list = [makeEntry({ id: 'a' })]
    const ok = saveRecentToStorage(list)
    expect(ok).toBe(true)
    expect(storage[RECENT_PROJECTS_STORAGE_KEY]).toBeDefined()
  })

  it('LS08: loadRecentFromStorage 读取', () => {
    const list = [makeEntry({ id: 'a' })]
    saveRecentToStorage(list)
    const restored = loadRecentFromStorage()
    expect(restored).toEqual(list)
  })

  it('LS09: loadRecentFromStorage 无数据返回空', () => {
    expect(loadRecentFromStorage()).toEqual([])
  })

  it('LS10: clearRecentStorage 清空', () => {
    saveRecentToStorage([makeEntry({ id: 'a' })])
    clearRecentStorage()
    expect(loadRecentFromStorage()).toEqual([])
  })

  it('LS11: 自定义 key', () => {
    const list = [makeEntry({ id: 'a' })]
    saveRecentToStorage(list, 'custom-key')
    expect(storage['custom-key']).toBeDefined()
    expect(loadRecentFromStorage('custom-key')).toEqual(list)
  })

  it('LS12: loadRecentFromStorage 损坏数据返回空', () => {
    storage[RECENT_PROJECTS_STORAGE_KEY] = 'corrupted{json'
    expect(loadRecentFromStorage()).toEqual([])
  })
})

// ============================================================================
// 6. Store
// ============================================================================

describe('recentProjects / Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 清空 localStorage
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ST01: 初始状态为空', () => {
    const store = useRecentProjectsStore()
    store.init()
    expect(store.list).toEqual([])
    expect(store.count).toBe(0)
    expect(store.isEmpty).toBe(true)
    expect(store.latest).toBeNull()
  })

  it('ST02: recordOpen 添加条目', () => {
    const store = useRecentProjectsStore()
    store.init()
    store.recordOpen(makeEntry({ id: 'a' }))
    expect(store.count).toBe(1)
    expect(store.list[0].id).toBe('a')
    expect(store.latest?.id).toBe('a')
  })

  it('ST03: recordOpen 多次 LRU 更新', () => {
    const store = useRecentProjectsStore()
    store.init()
    store.recordOpen(makeEntry({ id: 'a', openedAt: 1000 }))
    store.recordOpen(makeEntry({ id: 'b', openedAt: 2000 }))
    store.recordOpen(makeEntry({ id: 'a', openedAt: 3000 }))
    expect(store.count).toBe(2)
    expect(store.list[0].id).toBe('a')
    expect(store.list[0].openedAt).toBe(3000)
  })

  it('ST04: removeEntry 移除', () => {
    const store = useRecentProjectsStore()
    store.init()
    store.recordOpen(makeEntry({ id: 'a' }))
    store.recordOpen(makeEntry({ id: 'b' }))
    store.removeEntry('a')
    expect(store.count).toBe(1)
    expect(store.list[0].id).toBe('b')
  })

  it('ST05: clearAll 清空', () => {
    const store = useRecentProjectsStore()
    store.init()
    store.recordOpen(makeEntry({ id: 'a' }))
    store.clearAll()
    expect(store.isEmpty).toBe(true)
  })

  it('ST06: findById 查找', () => {
    const store = useRecentProjectsStore()
    store.init()
    store.recordOpen(makeEntry({ id: 'a' }))
    expect(store.findById('a')?.id).toBe('a')
    expect(store.findById('xyz')).toBeUndefined()
  })

  it('ST07: search 搜索', () => {
    const store = useRecentProjectsStore()
    store.init()
    store.recordOpen(makeEntry({ id: '1', name: 'Starry' }))
    store.recordOpen(makeEntry({ id: '2', name: 'Ocean' }))
    expect(store.search('star')).toHaveLength(1)
    expect(store.search('star')[0].id).toBe('1')
  })

  it('ST08: init 从 localStorage 加载', () => {
    const data = [makeEntry({ id: 'preloaded' })]
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => k === RECENT_PROJECTS_STORAGE_KEY ? JSON.stringify(data) : null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    })
    const store = useRecentProjectsStore()
    store.init()
    expect(store.count).toBe(1)
    expect(store.list[0].id).toBe('preloaded')
  })
})

// ============================================================================
// 7. 常量
// ============================================================================

describe('recentProjects / 常量', () => {
  it('C01: MAX_RECENT_PROJECTS = 10', () => {
    expect(MAX_RECENT_PROJECTS).toBe(10)
  })
  it('C02: RECENT_PROJECTS_STORAGE_KEY', () => {
    expect(RECENT_PROJECTS_STORAGE_KEY).toBe('pixelforge:recent-projects')
  })
})
