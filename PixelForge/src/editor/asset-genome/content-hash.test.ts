/**
 * Content Hash & Dedup Tests(Step 35.4)— 内容哈希 + 去重测试套件。
 */
import { describe, it, expect } from 'vitest'

import {
  fnv1a32,
  computeContentHash,
  computeBinaryHash,
  buildHashIndex,
  findDuplicates,
  findDuplicatesOf,
  computeSimilarity,
  findSimilarPairs,
  findSimilarTo,
  generateDedupSuggestions,
} from './contentHash'

describe('Content Hash — Hashing (CH)', () => {
  it('CH01: fnv1a32 相同输入产生相同输出', () => {
    expect(fnv1a32('hello')).toBe(fnv1a32('hello'))
  })

  it('CH02: fnv1a32 不同输入产生不同输出', () => {
    expect(fnv1a32('hello')).not.toBe(fnv1a32('world'))
  })

  it('CH03: fnv1a32 返回 8 位十六进制', () => {
    const hash = fnv1a32('test')
    expect(hash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('CH04: computeContentHash 返回 fnv1a_ 前缀', () => {
    const hash = computeContentHash({
      kind: 'image',
      name: 'test.png',
      size: 1024,
      payloadRef: 'blob://abc',
      tags: ['nature'],
    })
    expect(hash).toMatch(/^fnv1a_[0-9a-f]{8}$/)
  })

  it('CH05: computeContentHash 相同输入产生相同哈希', () => {
    const params = {
      kind: 'image' as const,
      name: 'test.png',
      size: 1024,
      payloadRef: 'blob://abc',
      tags: ['nature', 'outdoor'],
    }
    expect(computeContentHash(params)).toBe(computeContentHash(params))
  })

  it('CH06: computeContentHash 标签顺序不影响哈希', () => {
    const hash1 = computeContentHash({
      kind: 'image',
      name: 'test',
      tags: ['a', 'b', 'c'],
    })
    const hash2 = computeContentHash({
      kind: 'image',
      name: 'test',
      tags: ['c', 'a', 'b'],
    })
    expect(hash1).toBe(hash2)
  })

  it('CH07: computeContentHash 不同名称产生不同哈希', () => {
    const hash1 = computeContentHash({ kind: 'image', name: 'a' })
    const hash2 = computeContentHash({ kind: 'image', name: 'b' })
    expect(hash1).not.toBe(hash2)
  })

  it('CH08: computeBinaryHash 返回带前缀的哈希', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const hash = await computeBinaryHash(data)
    expect(hash).toMatch(/^(sha256_|fnv1a_)/)
  })

  it('CH09: computeBinaryHash 相同数据产生相同哈希', async () => {
    const data1 = new Uint8Array([1, 2, 3])
    const data2 = new Uint8Array([1, 2, 3])
    expect(await computeBinaryHash(data1)).toBe(await computeBinaryHash(data2))
  })
})

describe('Content Hash — Dedup (CD)', () => {
  it('CD01: buildHashIndex 构建哈希索引', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1' },
      { id: 'a2', contentHash: 'h2' },
      { id: 'a3', contentHash: 'h1' },
    ]
    const index = buildHashIndex(assets)
    expect(index.get('h1')).toEqual(['a1', 'a3'])
    expect(index.get('h2')).toEqual(['a2'])
  })

  it('CD02: buildHashIndex 跳过无 contentHash 的资产', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1' },
      { id: 'a2' },
      { id: 'a3', contentHash: undefined },
    ]
    const index = buildHashIndex(assets)
    expect(index.size).toBe(1)
  })

  it('CD03: findDuplicates 返回重复组', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1' },
      { id: 'a2', contentHash: 'h2' },
      { id: 'a3', contentHash: 'h1' },
      { id: 'a4', contentHash: 'h1' },
      { id: 'a5', contentHash: 'h3' },
    ]
    const dups = findDuplicates(assets)
    expect(dups).toHaveLength(1)
    expect(dups[0].contentHash).toBe('h1')
    expect(dups[0].assetIds).toHaveLength(3)
  })

  it('CD04: findDuplicates 无重复返回空数组', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1' },
      { id: 'a2', contentHash: 'h2' },
    ]
    expect(findDuplicates(assets)).toEqual([])
  })

  it('CD05: findDuplicatesOf 查找指定资产的重复', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1' },
      { id: 'a2', contentHash: 'h1' },
      { id: 'a3', contentHash: 'h2' },
    ]
    expect(findDuplicatesOf(assets, 'a1')).toEqual(['a2'])
    expect(findDuplicatesOf(assets, 'a3')).toEqual([])
  })

  it('CD06: findDuplicatesOf 无 contentHash 返回空', () => {
    const assets = [{ id: 'a1' }, { id: 'a2' }]
    expect(findDuplicatesOf(assets, 'a1')).toEqual([])
  })
})

describe('Content Hash — Similarity (CS)', () => {
  it('CS01: computeSimilarity 完全相同资产得分 1', () => {
    const a = { id: 'a1', name: 'test', kind: 'image', category: 'media', tags: ['t1'] }
    const b = { id: 'a2', name: 'test', kind: 'image', category: 'media', tags: ['t1'] }
    const sim = computeSimilarity(a, b)
    expect(sim.score).toBe(1)
    expect(sim.reasons).toContain('名称相似')
    expect(sim.reasons).toContain('标签重叠')
    expect(sim.reasons).toContain('同种类')
  })

  it('CS02: computeSimilarity 完全不同资产得分 0', () => {
    const a = { id: 'a1', name: 'abc', kind: 'image', category: 'media', tags: ['x'] }
    const b = { id: 'a2', name: 'xyz', kind: 'sequence', category: 'scene', tags: ['y'] }
    const sim = computeSimilarity(a, b)
    expect(sim.score).toBe(0)
  })

  it('CS03: computeSimilarity 同大类不同种类得分 0.5 kindScore', () => {
    const a = { id: 'a1', name: 'abc', kind: 'image', category: 'media', tags: [] }
    const b = { id: 'a2', name: 'xyz', kind: 'audio', category: 'media', tags: [] }
    const sim = computeSimilarity(a, b)
    expect(sim.reasons).toContain('同大类')
    expect(sim.score).toBeGreaterThan(0)
  })

  it('CS04: findSimilarPairs 返回相似对(按分排序)', () => {
    const assets = [
      { id: 'a1', name: 'test', kind: 'image', category: 'media', tags: ['t'] },
      { id: 'a2', name: 'test', kind: 'image', category: 'media', tags: ['t'] },
      { id: 'a3', name: 'different', kind: 'audio', category: 'media', tags: [] },
    ]
    const pairs = findSimilarPairs(assets, 0.6)
    expect(pairs.length).toBeGreaterThan(0)
    expect(pairs[0].score).toBeGreaterThanOrEqual(pairs[pairs.length - 1].score)
  })

  it('CS05: findSimilarPairs 阈值过滤', () => {
    const assets = [
      { id: 'a1', name: 'abc', kind: 'image', category: 'media', tags: [] },
      { id: 'a2', name: 'xyz', kind: 'sequence', category: 'scene', tags: [] },
    ]
    const pairs = findSimilarPairs(assets, 0.9)
    expect(pairs).toEqual([])
  })

  it('CS06: findSimilarTo 查找指定资产的相似项', () => {
    const assets = [
      { id: 'a1', name: 'test', kind: 'image', category: 'media', tags: ['t'] },
      { id: 'a2', name: 'test', kind: 'image', category: 'media', tags: ['t'] },
      { id: 'a3', name: 'different', kind: 'audio', category: 'media', tags: [] },
    ]
    const similar = findSimilarTo(assets, 'a1', 0.6)
    expect(similar.some((s) => s.assetBId === 'a2')).toBe(true)
  })

  it('CS07: findSimilarTo 不存在的 ID 返回空', () => {
    const assets = [{ id: 'a1', name: 'x', kind: 'image', category: 'media', tags: [] }]
    expect(findSimilarTo(assets, 'nonexistent')).toEqual([])
  })
})

describe('Content Hash — Dedup Suggestions (CDS)', () => {
  it('CDS01: generateDedupSuggestions 保留最新创建的', () => {
    const assets = [
      { id: 'old', contentHash: 'h1', createdAt: 1000 },
      { id: 'mid', contentHash: 'h1', createdAt: 2000 },
      { id: 'new', contentHash: 'h1', createdAt: 3000 },
      { id: 'unique', contentHash: 'h2', createdAt: 4000 },
    ]
    const suggestions = generateDedupSuggestions(assets)
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].keepId).toBe('new')
    // 按 createdAt 降序排序后保留第一个,slice(1) 为剩余(中→旧)
    expect(suggestions[0].removeIds).toHaveLength(2)
    expect(suggestions[0].removeIds).toContain('old')
    expect(suggestions[0].removeIds).toContain('mid')
  })

  it('CDS02: generateDedupSuggestions 无重复返回空', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1', createdAt: 1000 },
      { id: 'a2', contentHash: 'h2', createdAt: 2000 },
    ]
    expect(generateDedupSuggestions(assets)).toEqual([])
  })

  it('CDS03: generateDedupSuggestions 多组重复', () => {
    const assets = [
      { id: 'a1', contentHash: 'h1', createdAt: 1000 },
      { id: 'a2', contentHash: 'h1', createdAt: 2000 },
      { id: 'b1', contentHash: 'h2', createdAt: 1000 },
      { id: 'b2', contentHash: 'h2', createdAt: 2000 },
    ]
    const suggestions = generateDedupSuggestions(assets)
    expect(suggestions).toHaveLength(2)
  })
})
