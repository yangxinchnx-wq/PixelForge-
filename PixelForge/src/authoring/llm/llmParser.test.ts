/**
 * llmParser 单元测试
 *
 * 测试内容：
 *   - convertLLMOutputToIntent：LLMOutput → ParsedIntent 转换
 *   - llmParse：完整流程（mock callLLM）
 *   - 失败回退到规则 parser
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Opcode } from '@/shared/types'
import {
  llmParse,
  convertLLMOutputToIntent,
} from './llmParser'
import type { LLMOutput, LLMProviderConfig, LLMResponse } from './types'

// ============================================================================
// Mock callLLM
// ============================================================================

vi.mock('./callLLM', () => ({
  callLLM: vi.fn(),
}))

import { callLLM } from './callLLM'
const mockedCallLLM = vi.mocked(callLLM)

// ============================================================================
// 测试用 LLMOutput
// ============================================================================

function makeLLMResponse(output: LLMOutput): LLMResponse {
  return {
    content: JSON.stringify(output),
    parsed: output,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'test-model',
    latencyMs: 100,
    cached: false,
  }
}

const testConfig: LLMProviderConfig = {
  provider: 'openai',
  apiKey: 'test-key',
  defaultModel: 'gpt-4o-mini',
}

// ============================================================================
// 测试
// ============================================================================

describe('convertLLMOutputToIntent', () => {
  it('应将 background 元素转换为 SOLID_COLOR 图层', () => {
    const output: LLMOutput = {
      scene: '红色背景',
      elements: [{
        type: 'background',
        description: '红色背景',
        color: [255, 0, 0],
        layer: 0,
      }],
    }

    const intent = convertLLMOutputToIntent(output, '红色背景')

    expect(intent.layers).toHaveLength(1)
    expect(intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
    expect(intent.layers[0].params.color).toEqual([1, 0, 0, 1])
    expect(intent.layers[0].label).toBe('红色背景')
    expect(intent.rawPrompt).toBe('红色背景')
  })

  it('应将 gradient 元素转换为 LINEAR_GRADIENT 图层', () => {
    const output: LLMOutput = {
      scene: '渐变',
      elements: [{
        type: 'gradient',
        description: '红蓝渐变',
        color: [255, 0, 0],
        layer: 0,
        params: { color2: [0, 0, 255], direction: 'horizontal' },
      }],
    }

    const intent = convertLLMOutputToIntent(output)

    expect(intent.layers[0].opcode).toBe(Opcode.LINEAR_GRADIENT)
    expect(intent.layers[0].params.color1).toEqual([1, 0, 0, 1])
    expect(intent.layers[0].params.color2).toEqual([0, 0, 255])
    expect(intent.layers[0].params.direction).toBe('horizontal')
  })

  it('应将 circle 元素转换为 CIRCLE_SHAPE 图层', () => {
    const output: LLMOutput = {
      scene: '圆形',
      elements: [{
        type: 'circle',
        description: '红色圆',
        color: [255, 0, 0],
        layer: 1,
        params: { cx: 0.3, cy: 0.4, radius: 0.2 },
      }],
    }

    const intent = convertLLMOutputToIntent(output)

    expect(intent.layers[0].opcode).toBe(Opcode.CIRCLE_SHAPE)
    expect(intent.layers[0].params.cx).toBe(0.3)
    expect(intent.layers[0].params.cy).toBe(0.4)
    expect(intent.layers[0].params.radius).toBe(0.2)
    expect(intent.layers[0].params.color).toEqual([1, 0, 0, 1])
  })

  it('应将 noise 元素转换为 NOISE 图层', () => {
    const output: LLMOutput = {
      scene: '噪声',
      elements: [{
        type: 'noise',
        description: '噪声纹理',
        color: [128, 128, 128],
        layer: 0,
        params: { scale: 32, intensity: 0.5 },
      }],
    }

    const intent = convertLLMOutputToIntent(output)

    expect(intent.layers[0].opcode).toBe(Opcode.NOISE)
    expect(intent.layers[0].params.scale).toBe(32)
    expect(intent.layers[0].params.intensity).toBe(0.5)
  })

  it('应将 starfield 元素转换为 NOISE 图层（带默认参数）', () => {
    const output: LLMOutput = {
      scene: '星空',
      elements: [{
        type: 'starfield',
        description: '星空',
        color: [255, 255, 200],
        layer: 1,
      }],
    }

    const intent = convertLLMOutputToIntent(output)

    expect(intent.layers[0].opcode).toBe(Opcode.NOISE)
    expect(intent.layers[0].params.scale).toBe(4)
    expect(intent.layers[0].params.intensity).toBe(0.8)
  })

  it('应按 layer 排序（底层在前）', () => {
    const output: LLMOutput = {
      scene: '多层',
      elements: [
        { type: 'circle', description: '上层', color: [255, 0, 0], layer: 2 },
        { type: 'background', description: '底层', color: [0, 0, 0], layer: 0 },
        { type: 'noise', description: '中层', color: [128, 128, 128], layer: 1 },
      ],
    }

    const intent = convertLLMOutputToIntent(output)

    expect(intent.layers).toHaveLength(3)
    expect(intent.layers[0].label).toBe('底层')
    expect(intent.layers[1].label).toBe('中层')
    expect(intent.layers[2].label).toBe('上层')
  })

  it('应正确映射 blend 模式', () => {
    const output: LLMOutput = {
      scene: '混合',
      elements: [{
        type: 'circle',
        description: '叠加圆',
        color: [255, 0, 0],
        layer: 1,
        blend: 'screen',
      }],
    }

    const intent = convertLLMOutputToIntent(output)
    expect(intent.layers[0].blendMode).toBe('screen')
  })

  it('未知元素类型应默认为 SOLID_COLOR', () => {
    const output: LLMOutput = {
      scene: '未知',
      elements: [{
        type: 'unknown_type',
        description: '未知',
        color: [100, 100, 100],
        layer: 0,
      }],
    }

    const intent = convertLLMOutputToIntent(output)
    expect(intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
  })

  it('颜色应从 0-255 归一化到 0-1', () => {
    const output: LLMOutput = {
      scene: '颜色',
      elements: [{
        type: 'background',
        description: '深蓝',
        color: [10, 20, 60],
        layer: 0,
      }],
    }

    const intent = convertLLMOutputToIntent(output)
    const color = intent.layers[0].params.color as number[]
    expect(color[0]).toBeCloseTo(10 / 255, 5)
    expect(color[1]).toBeCloseTo(20 / 255, 5)
    expect(color[2]).toBeCloseTo(60 / 255, 5)
    expect(color[3]).toBe(1)
  })

  it('无颜色元素应不设置 color 参数', () => {
    const output: LLMOutput = {
      scene: '无色',
      elements: [{
        type: 'noise',
        description: '无色噪声',
        layer: 0,
      }],
    }

    const intent = convertLLMOutputToIntent(output)
    expect(intent.layers[0].params.color).toBeUndefined()
  })
})

describe('llmParse', () => {
  beforeEach(() => {
    mockedCallLLM.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('LLM 成功时应返回 usedLLM=true', async () => {
    const llmOutput: LLMOutput = {
      scene: '星空夜景',
      elements: [
        { type: 'background', description: '深蓝夜空', color: [10, 20, 60], layer: 0 },
        { type: 'starfield', description: '星星', color: [255, 255, 200], layer: 1 },
      ],
      style: '写实',
      dominantColors: [[10, 20, 60], [255, 255, 200]],
    }

    mockedCallLLM.mockResolvedValueOnce(makeLLMResponse(llmOutput))

    const result = await llmParse('星空夜景', {
      providerConfig: testConfig,
      disableCache: true,
    })

    expect(result.usedLLM).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.intent.layers).toHaveLength(2)
    expect(result.intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
    expect(result.intent.layers[1].opcode).toBe(Opcode.NOISE)
    expect(result.llmOutput).toBeDefined()
    expect(result.llmOutput!.scene).toBe('星空夜景')
  })

  it('LLM 返回非法 JSON 时应回退到规则 parser', async () => {
    mockedCallLLM.mockResolvedValueOnce({
      content: 'not json',
      parsed: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'test',
      latencyMs: 100,
      cached: false,
    })

    const result = await llmParse('纯色背景：红色', {
      providerConfig: testConfig,
      disableCache: true,
    })

    expect(result.usedLLM).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('回退到规则 parser')
    expect(result.intent.layers.length).toBeGreaterThan(0)
  })

  it('LLM schema 校验失败时应回退到规则 parser', async () => {
    // 缺少 elements 字段
    mockedCallLLM.mockResolvedValueOnce(makeLLMResponse({
      scene: 'test',
      elements: [],
    } as unknown as LLMOutput))

    const result = await llmParse('纯色背景：红色', {
      providerConfig: testConfig,
      disableCache: true,
    })

    expect(result.usedLLM).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('callLLM 抛出错误时应回退到规则 parser', async () => {
    const { LLMError } = await import('./types')
    mockedCallLLM.mockRejectedValueOnce(new LLMError('llm_timeout', '请求超时'))

    const result = await llmParse('纯色背景：蓝色', {
      providerConfig: testConfig,
      disableCache: true,
    })

    expect(result.usedLLM).toBe(false)
    expect(result.warnings[0]).toContain('回退到规则 parser')
    expect(result.warnings[0]).toContain('llm_timeout')
  })

  it('disableFallback=true 时 LLM 失败应直接抛出', async () => {
    const { LLMError } = await import('./types')
    mockedCallLLM.mockRejectedValueOnce(new LLMError('llm_timeout', '请求超时'))

    await expect(llmParse('test', {
      providerConfig: testConfig,
      disableCache: true,
      disableFallback: true,
    })).rejects.toThrow(LLMError)
  })

  it('规则 parser 也失败时应抛出 ParseError', async () => {
    mockedCallLLM.mockResolvedValueOnce({
      content: 'not json',
      parsed: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'test',
      latencyMs: 100,
      cached: false,
    })

    // 用一个无法被规则 parser 解析的 prompt
    await expect(llmParse('!!!???', {
      providerConfig: testConfig,
      disableCache: true,
    })).rejects.toThrow()
  })

  it('应传递 temperature 和 maxTokens 到 callLLM', async () => {
    const llmOutput: LLMOutput = {
      scene: 'test',
      elements: [{ type: 'background', description: 'bg', color: [0, 0, 0], layer: 0 }],
    }
    mockedCallLLM.mockResolvedValueOnce(makeLLMResponse(llmOutput))

    await llmParse('test', {
      providerConfig: testConfig,
      disableCache: true,
      temperature: 0.7,
      maxTokens: 2048,
    })

    expect(mockedCallLLM).toHaveBeenCalledTimes(1)
    const callArg = mockedCallLLM.mock.calls[0][0]
    expect(callArg.temperature).toBe(0.7)
    expect(callArg.maxTokens).toBe(2048)
  })
})
