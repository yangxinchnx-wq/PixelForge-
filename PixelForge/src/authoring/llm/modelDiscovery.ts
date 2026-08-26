/**
 * PixelForge — 模型发现服务
 *
 * 从各 provider 的 API 拉取可用模型列表，合并静态元数据库，
 * 返回包含上下文窗口、思考能力、限流等信息的完整模型元数据。
 *
 * 核心设计：
 *   1. 并发控制（Semaphore）— 同一 provider 最多同时 1 个请求，避免 429
 *   2. 请求缓存 — 5 分钟 TTL，避免重复请求
 *   3. 指数退避重试 — 遇 429/5xx 自动重试，最多 3 次
 *   4. 超时保护 — 单请求 15s 超时
 */

import { lookupModelMetadata, getKnownModels, inferCapabilities, type ModelMetadata } from './modelRegistry'

// ============================================================================
// 类型定义
// ============================================================================

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'custom'

/**
 * 拉取模型列表所需的配置。
 */
export interface FetchModelsConfig {
  provider: ModelProvider
  apiKey: string
  baseUrl: string
}

/**
 * 拉取结果中的单条模型信息。
 * 合并了 API 返回数据和静态元数据库。
 */
export interface DiscoveredModel extends ModelMetadata {
  /** 是否来自 API（true）还是静态回退（false） */
  fromApi: boolean
}

// ============================================================================
// 并发控制（Semaphore）
// ============================================================================

/**
 * 简易信号量 — 限制同一 provider 的并发请求数。
 * 避免短时间内发多个请求导致 429 Too Many Requests。
 */
class Semaphore {
  private current = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return
    }
    await new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
    this.current++
  }

  release(): void {
    this.current--
    const next = this.queue.shift()
    if (next) {
      next()
    }
  }
}

/** 每个 provider 一个信号量，限制并发为 1 */
const semaphores = new Map<string, Semaphore>()

function getSemaphore(provider: string): Semaphore {
  if (!semaphores.has(provider)) {
    semaphores.set(provider, new Semaphore(1))
  }
  return semaphores.get(provider)!
}

// ============================================================================
// 请求缓存
// ============================================================================

interface CacheEntry {
  models: DiscoveredModel[]
  timestamp: number
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 分钟
const modelCache = new Map<string, CacheEntry>()

/**
 * 生成缓存 key。
 */
function cacheKey(config: FetchModelsConfig): string {
  return `${config.provider}:${config.baseUrl}:${config.apiKey.slice(0, 8)}`
}

/**
 * 检查缓存是否有效。
 */
function getCached(key: string): DiscoveredModel[] | null {
  const entry = modelCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    modelCache.delete(key)
    return null
  }
  return entry.models
}

/**
 * 写入缓存。
 */
function setCached(key: string, models: DiscoveredModel[]): void {
  modelCache.set(key, { models, timestamp: Date.now() })
}

/**
 * 清除指定 provider 的缓存。
 */
export function clearModelCache(provider?: string): void {
  if (!provider) {
    modelCache.clear()
    return
  }
  for (const key of modelCache.keys()) {
    if (key.startsWith(`${provider}:`)) {
      modelCache.delete(key)
    }
  }
}

// ============================================================================
// HTTP 请求工具
// ============================================================================

const REQUEST_TIMEOUT_MS = 10_000
const MAX_RETRIES = 2

/**
 * 带超时的 fetch。
 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}

/**
 * 指数退避延迟。
 */
function backoffDelay(attempt: number): number {
  // 基础 1s，指数增长，上限 10s
  const base = 1000 * Math.pow(2, attempt)
  return Math.min(base, 10_000)
}

// ============================================================================
// Provider API 调用
// ============================================================================

/**
 * 从 OpenAI 兼容 API 拉取模型列表。
 * GET {baseUrl}/models  （baseUrl 已含 /v1）
 * 若 baseUrl 不含 /v1 则自动追加。
 */
async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  // baseUrl 已含 /v1 时直接追加 /models；否则补 /v1/models
  const url = base.endsWith('/v1')
    ? `${base}/models`
    : `${base}/v1/models`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
  }

  const resp = await fetchWithTimeout(url, { method: 'GET', headers }, REQUEST_TIMEOUT_MS)
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new ModelFetchError(resp.status, `OpenAI 模型列表请求失败: ${resp.status}`, body)
  }

  const data = await resp.json() as { data?: Array<{ id: string }> }
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean)
  return ids
}

/**
 * 从 Anthropic API 拉取模型列表。
 * GET {baseUrl}/models  （baseUrl 已含 /v1）
 * 若 baseUrl 不含 /v1 则自动追加。
 */
async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  const url = base.endsWith('/v1')
    ? `${base}/models`
    : `${base}/v1/models`
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  const resp = await fetchWithTimeout(url, { method: 'GET', headers }, REQUEST_TIMEOUT_MS)
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new ModelFetchError(resp.status, `Anthropic 模型列表请求失败: ${resp.status}`, body)
  }

  const data = await resp.json() as { data?: Array<{ id: string }> }
  const ids = (data.data ?? []).map((m) => m.id).filter(Boolean)
  return ids
}

/**
 * 从 Google API 拉取模型列表。
 * GET {baseUrl}/models?key={apiKey}  （baseUrl 已含 /v1）
 * 若 baseUrl 不含 /v1 则自动追加。
 */
async function fetchGoogleModels(baseUrl: string, apiKey: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '')
  const path = base.endsWith('/v1')
    ? `${base}/models`
    : `${base}/v1/models`
  const url = `${path}?key=${encodeURIComponent(apiKey)}`
  const headers: Record<string, string> = {}

  const resp = await fetchWithTimeout(url, { method: 'GET', headers }, REQUEST_TIMEOUT_MS)
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new ModelFetchError(resp.status, `Google 模型列表请求失败: ${resp.status}`, body)
  }

  const data = await resp.json() as { models?: Array<{ name: string }> }
  // Google 返回 "models/gemini-1.5-pro"，需截取后缀
  const ids = (data.models ?? [])
    .map((m) => m.name.replace(/^models\//, ''))
    .filter(Boolean)
  return ids
}

// ============================================================================
// 错误类型
// ============================================================================

export class ModelFetchError extends Error {
  statusCode: number
  responseBody: string

  constructor(statusCode: number, message: string, responseBody: string = '') {
    super(message)
    this.name = 'ModelFetchError'
    this.statusCode = statusCode
    this.responseBody = responseBody
  }

  /** 是否为限流错误（429） */
  get isRateLimited(): boolean {
    return this.statusCode === 429
  }
}

// ============================================================================
// 主接口
// ============================================================================

/**
 * 拉取指定 provider 的可用模型列表。
 *
 * 流程：
 *   1. 检查缓存 → 命中直接返回
 *   2. 获取信号量（限制同 provider 并发为 1）
 *   3. 请求 API（带指数退避重试，遇 429/5xx 自动重试）
 *   4. 合并静态元数据库
 *   5. 写入缓存并返回
 *
 * @param config provider 配置
 * @returns 模型列表（含元数据），按 displayName 排序
 * @throws {ModelFetchError} 拉取失败
 */
export async function fetchModels(config: FetchModelsConfig): Promise<DiscoveredModel[]> {
  // 参数校验
  if (!config.apiKey) {
    throw new ModelFetchError(0, '未配置 API Key')
  }
  if (!config.baseUrl) {
    throw new ModelFetchError(0, '未配置 Base URL')
  }

  const key = cacheKey(config)

  // Step 1: 检查缓存
  const cached = getCached(key)
  if (cached) {
    return cached
  }

  // Step 2: 获取信号量
  const sem = getSemaphore(config.provider)
  await sem.acquire()

  try {
    // Step 3: 请求 API（带重试）
    let lastError: ModelFetchError | null = null
    let apiModelIds: string[] = []

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        apiModelIds = await fetchModelsFromProvider(config)
        break
      } catch (err) {
        if (err instanceof ModelFetchError) {
          lastError = err

          // 不可重试的错误（非 429/5xx）直接抛出
          const isRetryable = err.isRateLimited || (err.statusCode >= 500 && err.statusCode < 600)
          if (!isRetryable) {
            throw err
          }

          // 最后一次尝试不再等待
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, backoffDelay(attempt)))
          }
        } else {
          // 网络错误 / CORS 错误 / AbortError — 不重试，直接抛出
          // 这类错误重试也不会成功，且会导致 UI 长时间空转
          const errMsg = err instanceof Error ? err.message : String(err)
          const isAbort = err instanceof DOMException && err.name === 'AbortError'
          throw new ModelFetchError(
            0,
            isAbort
              ? '请求超时（10 秒），请检查网络连接或 Base URL 是否正确'
              : `网络请求失败：${errMsg}（可能是 CORS 跨域限制或 Base URL 错误）`,
          )
        }
      }
    }

    if (lastError && apiModelIds.length === 0) {
      throw lastError
    }

    // Step 4: 合并静态元数据
    const models = mergeWithRegistry(config.provider, apiModelIds)

    // Step 5: 写入缓存
    setCached(key, models)

    return models
  } finally {
    sem.release()
  }
}

/**
 * 分发到具体 provider 的 fetch 函数。
 */
async function fetchModelsFromProvider(config: FetchModelsConfig): Promise<string[]> {
  switch (config.provider) {
    case 'openai':
    case 'custom':
      return fetchOpenAIModels(config.baseUrl, config.apiKey)
    case 'anthropic':
      return fetchAnthropicModels(config.baseUrl, config.apiKey)
    case 'google':
      return fetchGoogleModels(config.baseUrl, config.apiKey)
    default:
      throw new ModelFetchError(0, `不支持的 provider: ${config.provider}`)
  }
}

/**
 * 将 API 返回的模型 ID 列表与静态元数据库合并。
 *
 * - API 返回的模型：查 registry 补充元数据，未命中时使用默认值
 * - Registry 中有但 API 未返回的模型：附加到列表末尾（标记 fromApi=false）
 */
function mergeWithRegistry(provider: string, apiModelIds: string[]): DiscoveredModel[] {
  const knownModels = getKnownModels(provider)
  const apiIdSet = new Set(apiModelIds)
  const result: DiscoveredModel[] = []

  // API 返回的模型 → 合并 registry 元数据
  for (const id of apiModelIds) {
    const meta = lookupModelMetadata(provider, id)
    if (meta) {
      result.push({ ...meta, fromApi: true })
    } else {
      // API 返回但 registry 中无元数据 → 使用合理默认值 + 启发式推断能力
      const caps = inferCapabilities(id)
      result.push({
        id,
        displayName: id,
        contextWindow: 0,       // 未知
        maxOutputTokens: 0,     // 未知
        supportsThinking: false,
        supportsVision: false,
        supportsFunctionCalling: false,
        supportsImageGeneration: caps.supportsImageGeneration,
        supportsVideoGeneration: caps.supportsVideoGeneration,
        supportsAudioGeneration: caps.supportsAudioGeneration,
        fromApi: true,
      })
    }
  }

  // Registry 中有但 API 未返回的模型 → 附加（可能 API Key 无权访问）
  for (const meta of knownModels) {
    if (!apiIdSet.has(meta.id)) {
      result.push({ ...meta, fromApi: false })
    }
  }

  // 按展示名排序
  result.sort((a, b) => a.displayName.localeCompare(b.displayName))

  return result
}

/**
 * 查询单个模型的元数据（不请求 API，仅查静态数据库）。
 * 用于用户手动输入 modelId 时自动填充元数据。
 */
export function lookupModel(provider: ModelProvider, modelId: string): ModelMetadata | undefined {
  if (!modelId) return undefined
  return lookupModelMetadata(provider, modelId)
}
