/**
 * AI Director 单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  parseIntent,
  decide,
  toValuePatches,
  resetDirectorIdCounter,
} from './director'
import type { DirectorPatch } from '../types'

// Mock callLLM
vi.mock('@/authoring/llm/callLLM', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from '@/authoring/llm/callLLM'
const mockedCallLLM = vi.mocked(callLLM)

describe('director', () => {
  beforeEach(() => {
    resetDirectorIdCounter()
    mockedCallLLM.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('parseIntent', () => {
    it('应解析 mood 意图', () => {
      const intent = parseIntent('营造孤独的氛围')
      expect(intent.type).toBe('mood')
      expect(intent.prompt).toBe('营造孤独的氛围')
      expect(intent.confidence).toBe(0.5)
    })

    it('应解析 pacing 意图', () => {
      const intent = parseIntent('加快节奏')
      expect(intent.type).toBe('pacing')
    })

    it('应解析 color_shift 意图', () => {
      const intent = parseIntent('调整色调为冷色')
      expect(intent.type).toBe('color_shift')
    })

    it('应解析 animation 意图', () => {
      const intent = parseIntent('添加动画效果')
      expect(intent.type).toBe('animation')
    })

    it('未匹配的意图应为 general', () => {
      const intent = parseIntent('画一个星空')
      expect(intent.type).toBe('general')
    })
  })

  describe('decide', () => {
    it('LLM 成功时应返回决策', async () => {
      mockedCallLLM.mockResolvedValueOnce({
        content: '{}',
        parsed: {
          scene: '星空',
          elements: [
            { type: 'background', color: [10, 20, 60], layer: 0, description: '夜空' },
            { type: 'starfield', color: [255, 255, 200], layer: 1, description: '星星' },
          ],
        },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: 'test',
        latencyMs: 100,
        cached: false,
      })

      const intent = parseIntent('星空夜景')
      const decision = await decide(intent, { providerConfig: null, disableCache: true })

      expect(decision.intentId).toBe(intent.id)
      expect(decision.patches.length).toBeGreaterThan(0)
      expect(decision.patches[0].targetEntity).toBe('layer')
    })

    it('LLM 返回非 JSON 应返回空决策', async () => {
      mockedCallLLM.mockResolvedValueOnce({
        content: 'not json',
        parsed: null,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: 'test',
        latencyMs: 100,
        cached: false,
      })

      const intent = parseIntent('test')
      const decision = await decide(intent, { providerConfig: null, disableCache: true })

      expect(decision.patches).toHaveLength(0)
      expect(decision.reasoning).toContain('不是合法 JSON')
    })

    it('LLM 调用失败应返回空决策', async () => {
      mockedCallLLM.mockRejectedValueOnce(new Error('network error'))

      const intent = parseIntent('test')
      const decision = await decide(intent, { providerConfig: null, disableCache: true })

      expect(decision.patches).toHaveLength(0)
      expect(decision.reasoning).toContain('决策失败')
    })
  })

  describe('toValuePatches', () => {
    it('应将 DirectorPatch 转换为 ValuePatch', () => {
      const patches: DirectorPatch[] = [
        { targetEntity: 'layer', targetId: 'L1', paramKey: 'color', value: [1, 0, 0, 1] },
        { targetEntity: 'layer', targetId: 'L2', paramKey: 'radius', value: 0.5 },
      ]

      const valuePatches = toValuePatches(patches, 'intent_123')
      expect(valuePatches).toHaveLength(2)
      expect(valuePatches[0].source).toBe('l3_director')
      expect(valuePatches[0].tier).toBe('value')
      expect(valuePatches[0].targetId).toBe('L1')
      expect(valuePatches[0].paramKey).toBe('color')
      expect(valuePatches[0].patchId).toContain('director_intent_123_0')
    })

    it('空列表应返回空数组', () => {
      const valuePatches = toValuePatches([], 'intent_123')
      expect(valuePatches).toHaveLength(0)
    })
  })
})
