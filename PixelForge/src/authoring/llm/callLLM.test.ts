/**
 * callLLM 单元测试
 *
 * 使用 vi.fn() mock 全局 fetch，测试 callLLM 的核心行为：
 *   - OpenAI / Anthropic 请求构造
 *   - 响应解析
 *   - 错误分类（auth/rate_limit/timeout/network）
 *   - 重试逻辑
 *   - prompt cache 集成
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { callLLM } from './callLLM'
import { PromptCache } from './promptCache'
import { LLMError } from './types'
import type { LLMProviderConfig } from './types'

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ============================================================================
// 测试用配置
// ============================================================================

const openaiConfig: LLMProviderConfig = {
  provider: 'openai',
  apiKey: 'test-openai-key',
  defaultModel: 'gpt-4o-mini',
}

const anthropicConfig: LLMProviderConfig = {
  provider: 'anthropic',
  apiKey: 'test-anthropic-key',
  defaultModel: 'claude-3-5-sonnet-20241022',
}

// ============================================================================
// 辅助函数
// ============================================================================

function makeOpenAIResponse(content: string, model = 'gpt-4o-mini'): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    model,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeAnthropicResponse(content: string, model = 'claude-3-5-sonnet-20241022'): Response {
  return new Response(JSON.stringify({
    content: [{ text: content }],
    usage: { input_tokens: 10, output_tokens: 20 },
    model,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// 测试
// ============================================================================

describe('callLLM', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // OpenAI
  // --------------------------------------------------------------------------

  describe('OpenAI 调用', () => {
    it('应正确构造 OpenAI 请求并解析响应', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse('{"scene":"test"}'))

      const response = await callLLM(
        { prompt: '画一个红色背景' },
        openaiConfig,
        null, // 禁用缓存
      )

      expect(response.content).toBe('{"scene":"test"}')
      expect(response.parsed).toEqual({ scene: 'test' })
      expect(response.usage.promptTokens).toBe(10)
      expect(response.usage.completionTokens).toBe(20)
      expect(response.usage.totalTokens).toBe(30)
      expect(response.model).toBe('gpt-4o-mini')
      expect(response.cached).toBe(false)
      expect(response.latencyMs).toBeGreaterThanOrEqual(0)

      // 验证请求构造
      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions')
      const opts = callArgs[1]
      expect(opts.method).toBe('POST')
      expect(opts.headers['Authorization']).toBe('Bearer test-openai-key')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('gpt-4o-mini')
      expect(body.messages[0].role).toBe('user')
      expect(body.messages[0].content).toBe('画一个红色背景')
    })

    it('应正确发送 system prompt', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse('{}'))

      await callLLM(
        { prompt: 'test', systemPrompt: 'You are an assistant.' },
        openaiConfig,
        null,
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.messages).toHaveLength(2)
      expect(body.messages[0].role).toBe('system')
      expect(body.messages[0].content).toBe('You are an assistant.')
      expect(body.messages[1].role).toBe('user')
    })

    it('有 schema 时应设置 response_format', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse('{}'))

      await callLLM(
        { prompt: 'test', schema: { type: 'object' } },
        openaiConfig,
        null,
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.response_format).toEqual({ type: 'json_object' })
    })

    it('应正确传递 temperature 和 max_tokens', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse('{}'))

      await callLLM(
        { prompt: 'test', temperature: 0.7, maxTokens: 2048 },
        openaiConfig,
        null,
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.temperature).toBe(0.7)
      expect(body.max_tokens).toBe(2048)
    })

    it('应支持自定义 baseUrl', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse('{}'))

      await callLLM(
        { prompt: 'test' },
        { ...openaiConfig, baseUrl: 'https://custom.api.com' },
        null,
      )

      expect(mockFetch.mock.calls[0][0]).toBe('https://custom.api.com/v1/chat/completions')
    })
  })

  // --------------------------------------------------------------------------
  // Anthropic
  // --------------------------------------------------------------------------

  describe('Anthropic 调用', () => {
    it('应正确构造 Anthropic 请求并解析响应', async () => {
      mockFetch.mockResolvedValueOnce(makeAnthropicResponse('{"scene":"test"}'))

      const response = await callLLM(
        { prompt: '画一个星空' },
        anthropicConfig,
        null,
      )

      expect(response.content).toBe('{"scene":"test"}')
      expect(response.parsed).toEqual({ scene: 'test' })
      expect(response.usage.promptTokens).toBe(10)
      expect(response.usage.completionTokens).toBe(20)
      expect(response.usage.totalTokens).toBe(30)

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[0]).toBe('https://api.anthropic.com/v1/messages')
      const opts = callArgs[1]
      expect(opts.headers['x-api-key']).toBe('test-anthropic-key')
      expect(opts.headers['anthropic-version']).toBe('2023-06-01')
      const body = JSON.parse(opts.body)
      expect(body.model).toBe('claude-3-5-sonnet-20241022')
      expect(body.messages[0].role).toBe('user')
    })

    it('应正确发送 system prompt', async () => {
      mockFetch.mockResolvedValueOnce(makeAnthropicResponse('{}'))

      await callLLM(
        { prompt: 'test', systemPrompt: 'You are an assistant.' },
        anthropicConfig,
        null,
      )

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.system).toBe('You are an assistant.')
    })
  })

  // --------------------------------------------------------------------------
  // 错误处理
  // --------------------------------------------------------------------------

  describe('错误处理', () => {
    it('401 应抛出 llm_auth_error（不可重试）', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401, 'Invalid API key'))

      await expect(callLLM(
        { prompt: 'test', maxRetries: 0 },
        openaiConfig,
        null,
      )).rejects.toThrow(LLMError)

      try {
        await callLLM({ prompt: 'test', maxRetries: 0 }, openaiConfig, null)
      } catch (e) {
        expect(e instanceof LLMError).toBe(true)
        expect((e as LLMError).code).toBe('llm_auth_error')
        expect((e as LLMError).retryable).toBe(false)
        expect((e as LLMError).statusCode).toBe(401)
      }
    })

    it('429 应抛出 llm_rate_limit（可重试）', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(429, 'Rate limited'))

      await expect(callLLM(
        { prompt: 'test', maxRetries: 0 },
        openaiConfig,
        null,
      )).rejects.toThrow(LLMError)
    })

    it('500 应抛出 llm_network_error（可重试）', async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal server error'))

      await expect(callLLM(
        { prompt: 'test', maxRetries: 0 },
        openaiConfig,
        null,
      )).rejects.toThrow(LLMError)
    })

    it('空内容应抛出 llm_parse_error', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse(''))

      await expect(callLLM(
        { prompt: 'test', maxRetries: 0 },
        openaiConfig,
        null,
      )).rejects.toThrow(LLMError)
    })

    it('未配置服务商应抛出 llm_auth_error', async () => {
      await expect(callLLM(
        { prompt: 'test' },
        null,
        null,
      )).rejects.toThrow(LLMError)
    })
  })

  // --------------------------------------------------------------------------
  // 重试逻辑
  // --------------------------------------------------------------------------

  describe('重试逻辑', () => {
    it('可重试错误应在失败后重试', async () => {
      // 第一次 500，第二次成功
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(500, 'Server error'))
        .mockResolvedValueOnce(makeOpenAIResponse('{"ok":true}'))

      const response = await callLLM(
        { prompt: 'test', maxRetries: 1 },
        openaiConfig,
        null,
      )

      expect(response.content).toBe('{"ok":true}')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('不可重试错误不应重试', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(401, 'Auth error'))

      await expect(callLLM(
        { prompt: 'test', maxRetries: 3 },
        openaiConfig,
        null,
      )).rejects.toThrow(LLMError)

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('超过最大重试次数后应抛出最后一个错误', async () => {
      mockFetch.mockResolvedValue(makeErrorResponse(500, 'Server error'))

      await expect(callLLM(
        { prompt: 'test', maxRetries: 2 },
        openaiConfig,
        null,
      )).rejects.toThrow(LLMError)

      // 1 次初始 + 2 次重试 = 3 次
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  // --------------------------------------------------------------------------
  // Prompt Cache 集成
  // --------------------------------------------------------------------------

  describe('Prompt Cache 集成', () => {
    it('相同请求第二次应命中缓存', async () => {
      mockFetch.mockResolvedValue(makeOpenAIResponse('{"scene":"cached"}'))

      const cache = new PromptCache({ maxEntries: 10, ttlMs: 0 })

      // 第一次调用：miss → 调用 API
      const response1 = await callLLM(
        { prompt: 'same prompt', model: 'gpt-4o-mini' },
        openaiConfig,
        cache,
      )
      expect(response1.cached).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // 第二次调用：命中缓存 → 不调用 API
      const response2 = await callLLM(
        { prompt: 'same prompt', model: 'gpt-4o-mini' },
        openaiConfig,
        cache,
      )
      expect(response2.cached).toBe(true)
      expect(response2.content).toBe('{"scene":"cached"}')
      expect(mockFetch).toHaveBeenCalledTimes(1) // 仍然只调用了 1 次
    })

    it('不同请求不应命中缓存', async () => {
      mockFetch
        .mockResolvedValueOnce(makeOpenAIResponse('response1'))
        .mockResolvedValueOnce(makeOpenAIResponse('response2'))

      const cache = new PromptCache()

      const r1 = await callLLM({ prompt: 'prompt A' }, openaiConfig, cache)
      const r2 = await callLLM({ prompt: 'prompt B' }, openaiConfig, cache)

      expect(r1.content).toBe('response1')
      expect(r1.cached).toBe(false)
      expect(r2.content).toBe('response2')
      expect(r2.cached).toBe(false)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // --------------------------------------------------------------------------
  // JSON 解析
  // --------------------------------------------------------------------------

  describe('JSON 解析', () => {
    it('非 JSON 内容应 parsed = null', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse('This is plain text.'))

      const response = await callLLM(
        { prompt: 'test' },
        openaiConfig,
        null,
      )

      expect(response.content).toBe('This is plain text.')
      expect(response.parsed).toBeNull()
    })

    it('合法 JSON 内容应 parsed = 解析后的对象', async () => {
      const json = '{"scene":"星空","elements":[{"type":"background","layer":0}]}'
      mockFetch.mockResolvedValueOnce(makeOpenAIResponse(json))

      const response = await callLLM(
        { prompt: 'test' },
        openaiConfig,
        null,
      )

      expect(response.parsed).toEqual({
        scene: '星空',
        elements: [{ type: 'background', layer: 0 }],
      })
    })
  })
})
