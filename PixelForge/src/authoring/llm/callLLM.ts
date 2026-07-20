/**
 * PixelForge - callLLM LLM API 调用封装（骨架 §5.3 / 技术路线 §22.2 P1）
 *
 * 接口（骨架 §5.3）：
 *   callLLM(request: LLMRequest): Promise<LLMResponse>
 *
 * 行为：
 *   1. 查询 prompt cache，命中则直接返回
 *   2. 调用 LLM API（OpenAI / Anthropic）
 *   3. 校验响应是否为合法 JSON
 *   4. 失败时抛出 LLMError（含错误码，调用方决定重试或回退）
 *   5. 内置重试机制（可配置 maxRetries，默认 2）
 *   6. 成功后写入 prompt cache
 *
 * Phase E 数据流（骨架 §7.2）：
 *   text prompt → RequirementClarifier → llmParser(callLLM) → ParsedIntent → ruleParser → RenderIR
 *
 * 安全约束：
 *   - LLM 输出永远不直接进入渲染层（必须经过 ParsedIntent → ruleParser → RenderIR）
 *   - schema 校验由 llmParser 负责调用（callLLM 仅做 JSON 解析）
 */

import type { LLMRequest, LLMResponse, LLMUsage, LLMProviderConfig } from './types'
import { LLMError } from './types'
import { getDefaultProviderConfig } from './types'
import { PromptCache, getDefaultPromptCache, computeCacheKey } from './promptCache'

// ============================================================================
// 默认配置
// ============================================================================

/** 默认温度 */
const DEFAULT_TEMPERATURE = 0.3

/** 默认最大 token */
const DEFAULT_MAX_TOKENS = 4096

/** 默认超时（ms） */
const DEFAULT_TIMEOUT_MS = 30000

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 2

/** 可重试的 HTTP 状态码 */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

// ============================================================================
// callLLM — 主接口
// ============================================================================

/**
 * 调用 LLM API。
 *
 * 完整流程：
 *   1. 计算 cache key，查询 prompt cache
 *   2. 命中 → 返回 cached response
 *   3. 未命中 → 调用 LLM API（带重试）
 *   4. 解析响应为 JSON（如果可能）
 *   5. 写入 cache
 *   6. 返回 LLMResponse
 *
 * @param request LLM 请求参数
 * @param config 可选的服务商配置（默认从环境变量读取）
 * @param cache 可选的缓存实例（默认使用全局缓存）
 * @throws {LLMError} 调用失败时抛出
 */
export async function callLLM(
  request: LLMRequest,
  config?: LLMProviderConfig | null,
  cache?: PromptCache | null,
): Promise<LLMResponse> {
  const providerConfig = config ?? getDefaultProviderConfig()
  if (!providerConfig) {
    throw new LLMError('llm_auth_error', '未配置 LLM 服务商，请设置 OPENAI_API_KEY 或 ANTHROPIC_API_KEY 环境变量')
  }

  // undefined → 使用全局默认缓存；null → 禁用缓存
  const promptCache = cache === undefined ? getDefaultPromptCache() : cache

  // Step 1: 查询缓存
  if (promptCache) {
    const cacheKey = computeCacheKey(request)
    const cached = promptCache.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  // Step 2: 调用 LLM API（带重试）
  const maxRetries = request.maxRetries ?? DEFAULT_MAX_RETRIES
  let lastError: LLMError | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await callProvider(request, providerConfig)

      // Step 3: 写入缓存
      if (promptCache) {
        const cacheKey = computeCacheKey(request)
        promptCache.set(cacheKey, response)
      }

      return response
    } catch (err) {
      lastError = err instanceof LLMError ? err : new LLMError('llm_unknown', String(err))

      // 不可重试的错误直接抛出
      if (!lastError.retryable) {
        throw lastError
      }

      // 最后一次尝试不再等待
      if (attempt < maxRetries) {
        await sleep(getRetryDelay(attempt, lastError.statusCode))
      }
    }
  }

  // 所有重试都失败
  throw lastError ?? new LLMError('llm_unknown', '未知错误')
}

// ============================================================================
// callProvider — 分发到具体服务商
// ============================================================================

/**
 * 根据服务商类型调用对应的 API。
 */
async function callProvider(
  request: LLMRequest,
  config: LLMProviderConfig,
): Promise<LLMResponse> {
  const start = now()

  switch (config.provider) {
    case 'openai':
      return callOpenAI(request, config, start)
    case 'anthropic':
      return callAnthropic(request, config, start)
    default:
      throw new LLMError('llm_unknown', `不支持的服务商: ${config.provider}`)
  }
}

// ============================================================================
// callOpenAI — OpenAI API 调用
// ============================================================================

/**
 * 调用 OpenAI Chat Completions API。
 *
 * POST {baseUrl}/v1/chat/completions
 * {
 *   "model": "gpt-4o-mini",
 *   "messages": [...],
 *   "temperature": 0.3,
 *   "response_format": { "type": "json_object" },
 *   "max_tokens": 4096
 * }
 */
async function callOpenAI(
  request: LLMRequest,
  config: LLMProviderConfig,
  startTime: number,
): Promise<LLMResponse> {
  const model = request.model ?? config.defaultModel
  const baseUrl = config.baseUrl ?? 'https://api.openai.com'
  const url = `${baseUrl}/v1/chat/completions`
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 构造请求体
  const messages: Array<{ role: string; content: string }> = []
  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt })
  }
  messages.push({ role: 'user', content: request.prompt })

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  }

  // 如果有 schema，使用 JSON 模式
  if (request.schema) {
    body.response_format = { type: 'json_object' }
  }

  // 构造 headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  }
  if (config.organizationId) {
    headers['OpenAI-Organization'] = config.organizationId
  }

  // 发送请求
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs)

  // 处理响应
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    throw createErrorFromStatus(resp.status, errBody, 'openai')
  }

  const data = await resp.json() as OpenAIResponse
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content) {
    throw new LLMError('llm_parse_error', 'OpenAI 返回空内容', { rawResponse: JSON.stringify(data) })
  }

  // 尝试解析 JSON
  const parsed = tryParseJSON(content)

  const usage: LLMUsage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  }

  return {
    content,
    parsed,
    usage,
    model: data.model ?? model,
    latencyMs: now() - startTime,
    cached: false,
  }
}

// ============================================================================
// callAnthropic — Anthropic API 调用
// ============================================================================

/**
 * 调用 Anthropic Messages API。
 *
 * POST {baseUrl}/v1/messages
 * {
 *   "model": "claude-3-5-sonnet-20241022",
 *   "messages": [...],
 *   "system": "...",
 *   "temperature": 0.3,
 *   "max_tokens": 4096
 * }
 */
async function callAnthropic(
  request: LLMRequest,
  config: LLMProviderConfig,
  startTime: number,
): Promise<LLMResponse> {
  const model = request.model ?? config.defaultModel
  const baseUrl = config.baseUrl ?? 'https://api.anthropic.com'
  const url = `${baseUrl}/v1/messages`
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // 构造请求体
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: request.prompt }],
    temperature: request.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  }

  if (request.systemPrompt) {
    body.system = request.systemPrompt
  }

  // 构造 headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': config.apiKey,
    'anthropic-version': '2023-06-01',
  }

  // 发送请求
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs)

  // 处理响应
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    throw createErrorFromStatus(resp.status, errBody, 'anthropic')
  }

  const data = await resp.json() as AnthropicResponse
  const content = data.content?.[0]?.text ?? ''
  if (!content) {
    throw new LLMError('llm_parse_error', 'Anthropic 返回空内容', { rawResponse: JSON.stringify(data) })
  }

  // 尝试解析 JSON
  const parsed = tryParseJSON(content)

  const usage: LLMUsage = {
    promptTokens: data.usage?.input_tokens ?? 0,
    completionTokens: data.usage?.output_tokens ?? 0,
    totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  }

  return {
    content,
    parsed,
    usage,
    model: data.model ?? model,
    latencyMs: now() - startTime,
    cached: false,
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 尝试解析 JSON，失败时返回 null。
 */
function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * 带超时的 fetch。
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const resp = await fetch(url, { ...options, signal: controller.signal })
    return resp
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new LLMError('llm_timeout', `请求超时 (${timeoutMs}ms)`, { retryable: true })
    }
    throw new LLMError('llm_network_error', `网络错误: ${String(err)}`, { retryable: true })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 根据 HTTP 状态码创建 LLMError。
 */
function createErrorFromStatus(
  status: number,
  body: string,
  provider: string,
): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError('llm_auth_error', `${provider} 认证失败 (${status})`, {
      statusCode: status,
      retryable: false,
      rawResponse: body,
    })
  }
  if (status === 429) {
    return new LLMError('llm_rate_limit', `${provider} 速率限制 (429)`, {
      statusCode: status,
      retryable: true,
      rawResponse: body,
    })
  }
  if (RETRYABLE_STATUS_CODES.has(status)) {
    return new LLMError('llm_network_error', `${provider} 服务端错误 (${status})`, {
      statusCode: status,
      retryable: true,
      rawResponse: body,
    })
  }
  return new LLMError('llm_unknown', `${provider} 未知错误 (${status})`, {
    statusCode: status,
    retryable: false,
    rawResponse: body,
  })
}

/**
 * 计算重试延迟（指数退避）。
 *
 * attempt 0 → 1000ms
 * attempt 1 → 2000ms
 * attempt 2 → 4000ms
 * ...
 */
function getRetryDelay(attempt: number, statusCode?: number): number {
  // 429 速率限制：等待更长时间
  if (statusCode === 429) {
    return Math.min(30000, 5000 * Math.pow(2, attempt))
  }
  return Math.min(10000, 1000 * Math.pow(2, attempt))
}

/**
 * sleep 辅助函数。
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 获取当前时间戳（优先使用 performance.now）。
 */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

// ============================================================================
// API 响应类型（内部使用）
// ============================================================================

interface OpenAIResponse {
  choices?: Array<{
    message?: { content?: string }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  model?: string
}

interface AnthropicResponse {
  content?: Array<{ text?: string }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  model?: string
}
