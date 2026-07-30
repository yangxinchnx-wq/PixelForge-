/**
 * PromptCache 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { PromptCache, computeCacheKey, resetDefaultPromptCache, getDefaultPromptCache } from './promptCache'
import type { LLMRequest, LLMResponse } from './types'

function makeMockResponse(content: string): LLMResponse {
  return {
    content,
    parsed: null,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'test-model',
    latencyMs: 100,
    cached: false,
  }
}

describe('computeCacheKey', () => {
  it('相同请求应生成相同 key', () => {
    const req: LLMRequest = { prompt: 'hello', model: 'gpt-4', temperature: 0.3 }
    const key1 = computeCacheKey(req)
    const key2 = computeCacheKey(req)
    expect(key1).toBe(key2)
  })

  it('不同 prompt 应生成不同 key', () => {
    const req1: LLMRequest = { prompt: 'hello', model: 'gpt-4' }
    const req2: LLMRequest = { prompt: 'world', model: 'gpt-4' }
    expect(computeCacheKey(req1)).not.toBe(computeCacheKey(req2))
  })

  it('不同 model 应生成不同 key', () => {
    const req1: LLMRequest = { prompt: 'hello', model: 'gpt-4' }
    const req2: LLMRequest = { prompt: 'hello', model: 'claude-3' }
    expect(computeCacheKey(req1)).not.toBe(computeCacheKey(req2))
  })

  it('不同 temperature 应生成不同 key', () => {
    const req1: LLMRequest = { prompt: 'hello', temperature: 0.3 }
    const req2: LLMRequest = { prompt: 'hello', temperature: 0.7 }
    expect(computeCacheKey(req1)).not.toBe(computeCacheKey(req2))
  })

  it('不同 systemPrompt 应生成不同 key', () => {
    const req1: LLMRequest = { prompt: 'hello', systemPrompt: 'system1' }
    const req2: LLMRequest = { prompt: 'hello', systemPrompt: 'system2' }
    expect(computeCacheKey(req1)).not.toBe(computeCacheKey(req2))
  })

  it('不同 schema 应生成不同 key', () => {
    const req1: LLMRequest = { prompt: 'hello', schema: { type: 'object' } }
    const req2: LLMRequest = { prompt: 'hello', schema: { type: 'array' } }
    expect(computeCacheKey(req1)).not.toBe(computeCacheKey(req2))
  })

  it('key 应是 16 位十六进制字符串', () => {
    const key = computeCacheKey({ prompt: 'test' })
    expect(key).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('PromptCache', () => {
  let cache: PromptCache

  beforeEach(() => {
    cache = new PromptCache({ maxEntries: 3, ttlMs: 0 })
  })

  describe('基本操作', () => {
    it('set + get 应返回缓存内容', () => {
      const resp = makeMockResponse('hello')
      cache.set('key1', resp)
      const result = cache.get('key1')
      expect(result).not.toBeNull()
      expect(result!.content).toBe('hello')
      expect(result!.cached).toBe(true)
    })

    it('未命中的 key 应返回 null', () => {
      expect(cache.get('nonexistent')).toBeNull()
    })

    it('delete 应删除条目', () => {
      cache.set('key1', makeMockResponse('hello'))
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeNull()
    })

    it('delete 不存在的 key 应返回 false', () => {
      expect(cache.delete('nonexistent')).toBe(false)
    })

    it('clear 应清空所有条目', () => {
      cache.set('key1', makeMockResponse('a'))
      cache.set('key2', makeMockResponse('b'))
      cache.clear()
      expect(cache.size).toBe(0)
    })

    it('has 应正确判断是否存在', () => {
      cache.set('key1', makeMockResponse('a'))
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('key2')).toBe(false)
    })

    it('size 应返回当前条目数', () => {
      cache.set('key1', makeMockResponse('a'))
      cache.set('key2', makeMockResponse('b'))
      expect(cache.size).toBe(2)
    })
  })

  describe('LRU 淘汰', () => {
    it('超过 maxEntries 时应淘汰最久未访问的条目', () => {
      cache.set('key1', makeMockResponse('a'))
      cache.set('key2', makeMockResponse('b'))
      cache.set('key3', makeMockResponse('c'))

      // 访问 key1，使其成为最近使用
      cache.get('key1')

      // 添加 key4，应该淘汰 key2（最久未使用）
      cache.set('key4', makeMockResponse('d'))

      expect(cache.has('key1')).toBe(true)   // 最近使用，保留
      expect(cache.has('key2')).toBe(false)  // 最久未使用，淘汰
      expect(cache.has('key3')).toBe(true)
      expect(cache.has('key4')).toBe(true)
    })

    it('重复 set 同一 key 不应增加条目数', () => {
      cache.set('key1', makeMockResponse('a'))
      cache.set('key1', makeMockResponse('b'))
      expect(cache.size).toBe(1)
      expect(cache.get('key1')!.content).toBe('b')
    })
  })

  describe('TTL 过期', () => {
    it('超过 TTL 的条目应过期', () => {
      const ttlCache = new PromptCache({ maxEntries: 10, ttlMs: 50 })
      ttlCache.set('key1', makeMockResponse('a'))

      // 立即访问应命中
      expect(ttlCache.get('key1')).not.toBeNull()

      // 等待 TTL 过期
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(ttlCache.get('key1')).toBeNull()
          resolve()
        }, 60)
      })
    })

    it('TTL = 0 表示永不过期', () => {
      const ttlCache = new PromptCache({ maxEntries: 10, ttlMs: 0 })
      ttlCache.set('key1', makeMockResponse('a'))
      expect(ttlCache.has('key1')).toBe(true)
    })
  })

  describe('keys 方法', () => {
    it('应返回所有缓存 key', () => {
      cache.set('key1', makeMockResponse('a'))
      cache.set('key2', makeMockResponse('b'))
      const keys = cache.keys()
      expect(keys).toHaveLength(2)
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
    })
  })

  describe('缓存内容隔离', () => {
    it('get 返回的 response 应是副本，修改不影响缓存', () => {
      cache.set('key1', makeMockResponse('original'))
      const result = cache.get('key1')!
      result.content = 'modified'

      const result2 = cache.get('key1')!
      expect(result2.content).toBe('original')
    })
  })
})

describe('getDefaultPromptCache', () => {
  beforeEach(() => {
    resetDefaultPromptCache()
  })

  it('应返回单例实例', () => {
    const cache1 = getDefaultPromptCache()
    const cache2 = getDefaultPromptCache()
    expect(cache1).toBe(cache2)
  })

  it('reset 后应返回新实例', () => {
    const cache1 = getDefaultPromptCache()
    resetDefaultPromptCache()
    const cache2 = getDefaultPromptCache()
    expect(cache1).not.toBe(cache2)
  })
})
