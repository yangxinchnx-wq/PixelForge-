/**
 * Reference Graph Tests(Step 35.2)— 引用图测试套件。
 *
 * 覆盖:
 * - F (Factory): createReferenceGraph / createReference
 * - C (CRUD): add / remove / removeAllForAsset / clear
 * - Q (Query): getReferences / getReferencers / hasReference / byType / degree
 * - S (Store): Pinia Store
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import {
  ALL_REFERENCE_TYPES,
  REFERENCE_TYPE_DISPLAY_NAME,
  createReferenceGraph,
  createReference,
  addReference,
  removeReference,
  removeAllReferencesForAsset,
  clearReferenceGraph,
  getReferences,
  getReferencers,
  hasReference,
  getReferenceById,
  getAllReferences,
  getReferenceCount,
  getReferencesByType,
  getOutDegree,
  getInDegree,
  isAssetInGraph,
} from './referenceGraph'
import { useReferenceGraphStore } from './referenceGraphStore'

// ============================================================================
// F — Factory
// ============================================================================

describe('Reference Graph — Factory (F)', () => {
  it('F01: createReferenceGraph 返回空图', () => {
    const g = createReferenceGraph()
    expect(g.adjacency.size).toBe(0)
    expect(g.reverseIndex.size).toBe(0)
  })

  it('F02: createReference 创建引用', () => {
    const ref = createReference('a', 'b', 'uses', 'test note')
    expect(ref.id).toMatch(/^ref_/)
    expect(ref.sourceId).toBe('a')
    expect(ref.targetId).toBe('b')
    expect(ref.type).toBe('uses')
    expect(ref.note).toBe('test note')
    expect(ref.createdAt).toBeGreaterThan(0)
  })

  it('F03: createReference 默认类型为 uses', () => {
    const ref = createReference('a', 'b')
    expect(ref.type).toBe('uses')
  })

  it('F04: createReference 自引用抛错', () => {
    expect(() => createReference('a', 'a')).toThrow(/自引用/)
  })

  it('F05: ALL_REFERENCE_TYPES 包含 3 种类型', () => {
    expect(ALL_REFERENCE_TYPES).toEqual(['uses', 'extends', 'embeds'])
  })

  it('F06: REFERENCE_TYPE_DISPLAY_NAME 提供中文显示名', () => {
    expect(REFERENCE_TYPE_DISPLAY_NAME.uses).toBe('使用')
    expect(REFERENCE_TYPE_DISPLAY_NAME.extends).toBe('继承')
    expect(REFERENCE_TYPE_DISPLAY_NAME.embeds).toBe('嵌入')
  })
})

// ============================================================================
// C — CRUD
// ============================================================================

describe('Reference Graph — CRUD (C)', () => {
  let g: ReturnType<typeof createReferenceGraph>

  beforeEach(() => {
    g = createReferenceGraph()
  })

  it('C01: addReference 添加引用', () => {
    const ref = createReference('a', 'b')
    g = addReference(g, ref)
    expect(getReferenceCount(g)).toBe(1)
    expect(getReferences(g, 'a')).toHaveLength(1)
    expect(getReferencers(g, 'b')).toHaveLength(1)
  })

  it('C02: addReference 重复(同 source+target+type)返回原图', () => {
    const ref1 = createReference('a', 'b', 'uses')
    g = addReference(g, ref1)
    const before = g
    const ref2 = createReference('a', 'b', 'uses')
    g = addReference(g, ref2)
    expect(g).toBe(before)
    expect(getReferenceCount(g)).toBe(1)
  })

  it('C03: addReference 同 source+target 但不同 type 可共存', () => {
    g = addReference(g, createReference('a', 'b', 'uses'))
    g = addReference(g, createReference('a', 'b', 'embeds'))
    expect(getReferenceCount(g)).toBe(2)
  })

  it('C04: addReference 返回新图(不可变)', () => {
    const before = g
    g = addReference(g, createReference('a', 'b'))
    expect(g).not.toBe(before)
  })

  it('C05: removeReference 按 ID 移除', () => {
    const ref = createReference('a', 'b')
    g = addReference(g, ref)
    g = removeReference(g, ref.id)
    expect(getReferenceCount(g)).toBe(0)
    expect(getReferences(g, 'a')).toHaveLength(0)
    expect(getReferencers(g, 'b')).toHaveLength(0)
  })

  it('C06: removeReference 不存在的 ID 返回原图', () => {
    const before = g
    g = removeReference(g, 'nonexistent')
    expect(g).toBe(before)
  })

  it('C07: removeReference 清理空 Set(从 Map 中删除 key)', () => {
    g = addReference(g, createReference('a', 'b'))
    const ref = getReferences(g, 'a')[0]
    g = removeReference(g, ref.id)
    expect(g.adjacency.has('a')).toBe(false)
    expect(g.reverseIndex.has('b')).toBe(false)
  })

  it('C08: removeAllReferencesForAsset 移除出边+入边', () => {
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('c', 'a'))
    g = addReference(g, createReference('a', 'd'))
    g = removeAllReferencesForAsset(g, 'a')
    expect(getReferences(g, 'a')).toHaveLength(0)
    expect(getReferencers(g, 'a')).toHaveLength(0)
    expect(getReferenceCount(g)).toBe(0)
  })

  it('C09: clearReferenceGraph 清空图', () => {
    g = addReference(g, createReference('a', 'b'))
    g = addReference(g, createReference('c', 'd'))
    g = clearReferenceGraph(g)
    expect(getReferenceCount(g)).toBe(0)
  })

  it('C10: clearReferenceGraph 空图返回原引用', () => {
    const before = g
    g = clearReferenceGraph(g)
    expect(g).toBe(before)
  })
})

// ============================================================================
// Q — Query
// ============================================================================

describe('Reference Graph — Query (Q)', () => {
  let g: ReturnType<typeof createReferenceGraph>

  beforeEach(() => {
    g = createReferenceGraph()
    // 构建测试图:
    //   a → b (uses)
    //   a → c (uses)
    //   b → c (embeds)
    //   d → a (uses)
    g = addReference(g, createReference('a', 'b', 'uses'))
    g = addReference(g, createReference('a', 'c', 'uses'))
    g = addReference(g, createReference('b', 'c', 'embeds'))
    g = addReference(g, createReference('d', 'a', 'uses'))
  })

  it('Q01: getReferences 返回出边', () => {
    expect(getReferences(g, 'a')).toHaveLength(2)
    expect(getReferences(g, 'b')).toHaveLength(1)
    expect(getReferences(g, 'c')).toHaveLength(0)
  })

  it('Q02: getReferencers 返回入边', () => {
    expect(getReferencers(g, 'a')).toHaveLength(1) // d → a
    expect(getReferencers(g, 'b')).toHaveLength(1) // a → b
    expect(getReferencers(g, 'c')).toHaveLength(2) // a → c, b → c
  })

  it('Q03: hasReference 检查引用存在性', () => {
    expect(hasReference(g, 'a', 'b')).toBe(true)
    expect(hasReference(g, 'a', 'c')).toBe(true)
    expect(hasReference(g, 'a', 'd')).toBe(false)
    expect(hasReference(g, 'c', 'a')).toBe(false)
  })

  it('Q04: hasReference 按 type 过滤', () => {
    expect(hasReference(g, 'a', 'b', 'uses')).toBe(true)
    expect(hasReference(g, 'a', 'b', 'embeds')).toBe(false)
    expect(hasReference(g, 'b', 'c', 'embeds')).toBe(true)
    expect(hasReference(g, 'b', 'c', 'uses')).toBe(false)
  })

  it('Q05: getReferenceById 按 ID 查找', () => {
    const ref = getReferences(g, 'a')[0]
    const found = getReferenceById(g, ref.id)
    expect(found).toBeDefined()
    expect(found?.sourceId).toBe('a')
    expect(getReferenceById(g, 'nonexistent')).toBeUndefined()
  })

  it('Q06: getAllReferences 返回所有引用', () => {
    expect(getAllReferences(g)).toHaveLength(4)
  })

  it('Q07: getReferenceCount 返回总数', () => {
    expect(getReferenceCount(g)).toBe(4)
  })

  it('Q08: getReferencesByType 按类型筛选', () => {
    expect(getReferencesByType(g, 'uses')).toHaveLength(3)
    expect(getReferencesByType(g, 'embeds')).toHaveLength(1)
    expect(getReferencesByType(g, 'extends')).toHaveLength(0)
  })

  it('Q09: getOutDegree 出度', () => {
    expect(getOutDegree(g, 'a')).toBe(2)
    expect(getOutDegree(g, 'b')).toBe(1)
    expect(getOutDegree(g, 'c')).toBe(0)
    expect(getOutDegree(g, 'd')).toBe(1)
  })

  it('Q10: getInDegree 入度', () => {
    expect(getInDegree(g, 'a')).toBe(1)
    expect(getInDegree(g, 'b')).toBe(1)
    expect(getInDegree(g, 'c')).toBe(2)
    expect(getInDegree(g, 'd')).toBe(0)
  })

  it('Q11: isAssetInGraph 检查资产是否在图中', () => {
    expect(isAssetInGraph(g, 'a')).toBe(true)
    expect(isAssetInGraph(g, 'b')).toBe(true)
    expect(isAssetInGraph(g, 'c')).toBe(true)
    expect(isAssetInGraph(g, 'd')).toBe(true)
    expect(isAssetInGraph(g, 'x')).toBe(false)
  })
})

// ============================================================================
// S — Store
// ============================================================================

describe('Reference Graph — Store (S)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('S01: store 初始为空', () => {
    const store = useReferenceGraphStore()
    expect(store.count).toBe(0)
    expect(store.isEmpty).toBe(true)
  })

  it('S02: add 添加引用', () => {
    const store = useReferenceGraphStore()
    const ref = store.add('a', 'b', 'uses')
    expect(store.count).toBe(1)
    expect(ref.sourceId).toBe('a')
    expect(ref.targetId).toBe('b')
  })

  it('S03: remove 移除引用', () => {
    const store = useReferenceGraphStore()
    const ref = store.add('a', 'b')
    store.remove(ref.id)
    expect(store.count).toBe(0)
  })

  it('S04: removeAllForAsset 移除资产所有引用', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b')
    store.add('c', 'a')
    store.add('a', 'd')
    store.removeAllForAsset('a')
    expect(store.count).toBe(0)
  })

  it('S05: refsOf / refBy 查询', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b')
    store.add('a', 'c')
    store.add('d', 'a')
    expect(store.refsOf('a')).toHaveLength(2)
    expect(store.refBy('a')).toHaveLength(1)
  })

  it('S06: has 检查存在性', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b', 'uses')
    expect(store.has('a', 'b')).toBe(true)
    expect(store.has('a', 'b', 'uses')).toBe(true)
    expect(store.has('a', 'b', 'embeds')).toBe(false)
    expect(store.has('b', 'a')).toBe(false)
  })

  it('S07: listByType 按类型筛选', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b', 'uses')
    store.add('c', 'd', 'embeds')
    expect(store.listByType('uses')).toHaveLength(1)
    expect(store.listByType('embeds')).toHaveLength(1)
  })

  it('S08: outDegree / inDegree', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b')
    store.add('a', 'c')
    store.add('d', 'a')
    expect(store.outDegree('a')).toBe(2)
    expect(store.inDegree('a')).toBe(1)
  })

  it('S09: isInGraph', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b')
    expect(store.isInGraph('a')).toBe(true)
    expect(store.isInGraph('b')).toBe(true)
    expect(store.isInGraph('x')).toBe(false)
  })

  it('S10: clear 清空', () => {
    const store = useReferenceGraphStore()
    store.add('a', 'b')
    store.clear()
    expect(store.count).toBe(0)
  })

  it('S11: 响应式更新', () => {
    const store = useReferenceGraphStore()
    expect(store.count).toBe(0)
    store.add('a', 'b')
    expect(store.count).toBe(1)
    store.add('c', 'd')
    expect(store.count).toBe(2)
  })
})
