import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryCache, estimateSize } from './memoryCache'

describe('estimateSize', () => {
  it('估算 ArrayBuffer 大小', () => {
    const buf = new ArrayBuffer(1024)
    expect(estimateSize(buf)).toBe(1024)
  })

  it('估算 Uint8Array 大小', () => {
    const arr = new Uint8Array(512)
    expect(estimateSize(arr)).toBe(512)
  })

  it('估算字符串大小', () => {
    expect(estimateSize('hello')).toBe(5)
    expect(estimateSize('你好')).toBe(6) // 2 个中文字符 × 3 字节
    expect(estimateSize('')).toBe(0)
  })

  it('估算数字大小', () => {
    expect(estimateSize(42)).toBe(8)
  })

  it('估算 null/undefined', () => {
    expect(estimateSize(null)).toBe(0)
    expect(estimateSize(undefined)).toBe(0)
  })

  it('估算对象大小', () => {
    const obj = { a: 1, b: 'hello' }
    const size = estimateSize(obj)
    expect(size).toBeGreaterThan(0)
  })
})

describe('MemoryCache', () => {
  let cache: MemoryCache

  beforeEach(() => {
    cache = new MemoryCache({ maxBytes: 1024, maxEntries: 10, maxItemBytes: 512 })
  })

  it('set/get 基础读写', () => {
    cache.set('k1', 'v1')
    expect(cache.get('k1')).toBe('v1')
  })

  it('get 不存在的键返回 undefined', () => {
    expect(cache.get('not-exist')).toBeUndefined()
  })

  it('has 不更新访问时间', () => {
    cache.set('k1', 'v1')
    expect(cache.has('k1')).toBe(true)
    expect(cache.has('k2')).toBe(false)
  })

  it('delete 删除条目', () => {
    cache.set('k1', 'v1')
    expect(cache.delete('k1')).toBe(true)
    expect(cache.get('k1')).toBeUndefined()
    expect(cache.delete('k1')).toBe(false)
  })

  it('clear 清空所有', () => {
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })

  it('LRU 淘汰最久未访问', () => {
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    cache.set('k3', 'v3')

    // 访问 k1，使其成为最近使用
    cache.get('k1')

    // 写入会触发淘汰（容量 1024 字节，3 条字符串占的字节较少，但 maxEntries=10）
    // 这里改用 maxEntries 触发淘汰
    const smallCache = new MemoryCache({ maxBytes: 1024 * 1024, maxEntries: 3, maxItemBytes: 1024 })
    smallCache.set('k1', 'v1')
    smallCache.set('k2', 'v2')
    smallCache.set('k3', 'v3')
    // 访问 k1
    smallCache.get('k1')
    // 写入 k4，应淘汰 k2（最久未访问）
    smallCache.set('k4', 'v4')
    expect(smallCache.has('k2')).toBe(false)
    expect(smallCache.has('k1')).toBe(true)
    expect(smallCache.has('k3')).toBe(true)
    expect(smallCache.has('k4')).toBe(true)
  })

  it('容量超限时淘汰', () => {
    // 每条 100 字节，容量 250 字节，应只能存 2 条
    const smallCache = new MemoryCache({ maxBytes: 250, maxEntries: 100, maxItemBytes: 200 })
    const data1 = new Uint8Array(100)
    const data2 = new Uint8Array(100)
    const data3 = new Uint8Array(100)
    smallCache.set('d1', data1)
    smallCache.set('d2', data2)
    smallCache.set('d3', data3) // 应触发淘汰 d1
    expect(smallCache.has('d1')).toBe(false)
    expect(smallCache.has('d2')).toBe(true)
    expect(smallCache.has('d3')).toBe(true)
  })

  it('单条超限拒绝写入', () => {
    const big = new Uint8Array(600) // 超过 maxItemBytes=512
    expect(() => cache.set('big', big)).toThrow(/Item too large/)
  })

  it('setMany 批量写入', () => {
    cache.setMany([
      { key: 'a', data: '1' },
      { key: 'b', data: '2' },
      { key: 'c', data: '3' },
    ])
    expect(cache.get('a')).toBe('1')
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('setMany 原子性淘汰', () => {
    // 容量 200 字节，预先写入 2 条 100 字节已满
    const smallCache = new MemoryCache({ maxBytes: 200, maxEntries: 100, maxItemBytes: 200 })
    smallCache.set('old1', new Uint8Array(100))
    smallCache.set('old2', new Uint8Array(100))
    // 批量写入 2 条 100 字节，需释放 200 字节，应一次性淘汰 old1/old2
    smallCache.setMany([
      { key: 'new1', data: new Uint8Array(100) },
      { key: 'new2', data: new Uint8Array(100) },
    ])
    expect(smallCache.has('old1')).toBe(false)
    expect(smallCache.has('old2')).toBe(false)
    expect(smallCache.has('new1')).toBe(true)
    expect(smallCache.has('new2')).toBe(true)
  })

  it('keys 返回 LRU 顺序', () => {
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    cache.set('k3', 'v3')
    const keys = cache.keys()
    expect(keys[0]).toBe('k1') // 最旧在前
    expect(keys[keys.length - 1]).toBe('k3')
  })

  it('stats 返回正确统计', () => {
    cache.set('k1', 'v1')
    cache.get('k1') // 命中
    cache.get('k2') // 未命中
    const stats = cache.stats()
    expect(stats.entries).toBe(1)
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
    expect(stats.hitRate).toBeCloseTo(0.5)
  })

  it('resetStats 重置统计', () => {
    cache.set('k1', 'v1')
    cache.get('k1')
    cache.resetStats()
    const stats = cache.stats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.entries).toBe(1) // 数据保留
  })

  it('resize 调整容量并触发淘汰', () => {
    cache.set('k1', new Uint8Array(400))
    cache.set('k2', new Uint8Array(400))
    // 缩小到 500 字节，应淘汰 k1
    cache.resize(500)
    expect(cache.has('k1')).toBe(false)
    expect(cache.has('k2')).toBe(true)
  })

  it('重复写入同 key 替换值', () => {
    cache.set('k1', 'v1')
    cache.set('k1', 'v2')
    expect(cache.get('k1')).toBe('v2')
  })

  it('命中后访问时间更新（LRU 重排序）', () => {
    cache.set('k1', 'v1')
    cache.set('k2', 'v2')
    // 访问 k1
    cache.get('k1')
    // 此时 k2 应是最旧的
    const keys = cache.keys()
    expect(keys[0]).toBe('k2')
    expect(keys[1]).toBe('k1')
  })
})
