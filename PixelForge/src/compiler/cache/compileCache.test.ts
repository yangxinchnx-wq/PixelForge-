import { describe, expect, it } from 'vitest'

import type { PatchScope } from '@/compiler/ir/patch'

import {
  cacheSize,
  clearCache,
  getCache,
  invalidate,
  invalidateByLayerId,
  invalidateByScopes,
  setCache,
} from './compileCache'

describe('compileCache', () => {
  it('基础读写', () => {
    clearCache()
    setCache('a', 1)
    expect(getCache('a')).toBe(1)
    expect(getCache('missing')).toBeUndefined()
  })

  it('精确 invalidate 单个 key', () => {
    clearCache()
    setCache('a', 1)
    setCache('b', 2)
    expect(invalidate('a')).toBe(true)
    expect(invalidate('a')).toBe(false) // 已删
    expect(getCache('a')).toBeUndefined()
    expect(getCache('b')).toBe(2)
  })

  it('按 layerId 失效(entry.layerId 严格匹配)', () => {
    clearCache()
    setCache('k1', 1, 'dynamic', 'layer_a')
    setCache('k2', 2, 'dynamic', 'layer_b')
    setCache('k3', 3, 'dynamic', 'layer_a')
    const removed = invalidateByLayerId('layer_a')
    expect(removed).toBe(2)
    expect(getCache('k1')).toBeUndefined()
    expect(getCache('k3')).toBeUndefined()
    expect(getCache('k2')).toBe(2)
  })

  it('按 layerId 失效(key 字符串包含 layerId)', () => {
    clearCache()
    setCache('layer_x.radius', 0.5) // 无 layerId 字段,靠 key 命名约定
    setCache('layer_y.color', 0.8)
    const removed = invalidateByLayerId('layer_x')
    expect(removed).toBe(1)
    expect(getCache('layer_x.radius')).toBeUndefined()
    expect(getCache('layer_y.color')).toBe(0.8)
  })

  it('topology scope 级联失效 dynamic + structural', () => {
    clearCache()
    setCache('d1', 1, 'dynamic')
    setCache('s1', 2, 'structural')
    setCache('t1', 3, 'topology')
    setCache('m1', 4, 'metadata')

    const scopes: PatchScope[] = ['topology']
    const removed = invalidateByScopes(scopes)
    // topology 级联:dynamic + structural + topology 全清
    expect(removed).toBe(3)
    expect(getCache('d1')).toBeUndefined()
    expect(getCache('s1')).toBeUndefined()
    expect(getCache('t1')).toBeUndefined()
    expect(getCache('m1')).toBe(4) // metadata 不受影响
  })

  it('structural scope 级联失效 dynamic', () => {
    clearCache()
    setCache('d1', 1, 'dynamic')
    setCache('s1', 2, 'structural')
    setCache('t1', 3, 'topology')
    setCache('m1', 4, 'metadata')

    const removed = invalidateByScopes(['structural'])
    // structural 级联:dynamic + structural
    expect(removed).toBe(2)
    expect(getCache('d1')).toBeUndefined()
    expect(getCache('s1')).toBeUndefined()
    expect(getCache('t1')).toBe(3)
    expect(getCache('m1')).toBe(4)
  })

  it('dynamic scope 精确匹配,不级联', () => {
    clearCache()
    setCache('d1', 1, 'dynamic')
    setCache('s1', 2, 'structural')

    const removed = invalidateByScopes(['dynamic'])
    expect(removed).toBe(1)
    expect(getCache('d1')).toBeUndefined()
    expect(getCache('s1')).toBe(2)
  })

  it('空 scopes 不失效任何条目', () => {
    clearCache()
    setCache('d1', 1, 'dynamic')
    expect(invalidateByScopes([])).toBe(0)
    expect(getCache('d1')).toBe(1)
  })

  it('cacheSize / clearCache', () => {
    clearCache()
    expect(cacheSize()).toBe(0)
    setCache('a', 1)
    setCache('b', 2)
    expect(cacheSize()).toBe(2)
    clearCache()
    expect(cacheSize()).toBe(0)
  })
})
