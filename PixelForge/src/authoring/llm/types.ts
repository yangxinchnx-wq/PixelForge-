/**
 * PixelForge - LLM 接入类型定义（骨架 §5.3 / 技术路线 §21.5 / §22.3）
 *
 * 本文件定义 LLM 接入层的核心类型：
 *   - LLMRequest：callLLM 请求参数
 *   - LLMResponse：callLLM 返回结果
 *   - LLMError：LLM 调用错误
 *   - SemanticElement：LLM 输出的语义元素（§22.3）
 *   - LLMOutput：LLM 返回的完整输出结构（§22.3）
 *
 * 数据流（骨架 §7.2 Phase E）：
 *   text prompt → RequirementClarifier → llmParser(callLLM) → ParsedIntent → ruleParser → RenderIR
 *
 * LLM 永远不直接进入渲染层（必须经过 ParsedIntent → ruleParser → RenderIR）。
 */

import type { JsonLiteral } from '@/shared/types'

// ============================================================================
// 1. LLMRequest — callLLM 请求参数
// ============================================================================

/**
 * LLM API 调用请求参数。
 *
 * - prompt：用户输入的 prompt 文本
 * - schema：期望的 JSON 输出 schema（用于 response_format）
 * - temperature：采样温度（默认 0.3，低温度 = 更确定性）
 * - maxTokens：最大输出 token 数
 * - model：模型名称（如 'gpt-4' / 'claude-3-sonnet'）
 * - systemPrompt：系统 prompt（可选）
 */
export interface LLMRequest {
  /** 用户 prompt */
  prompt: string
  /** 期望的 JSON 输出 schema（用于引导 LLM 输出结构化 JSON） */
  schema?: JsonLiteral
  /** 采样温度（0-2，默认 0.3） */
  temperature?: number
  /** 最大输出 token 数（默认 4096） */
  maxTokens?: number
  /** 模型名称 */
  model?: string
  /** 系统 prompt（可选） */
  systemPrompt?: string
  /** 请求超时（ms，默认 30000） */
  timeoutMs?: number
  /** 最大重试次数（默认 2） */
  maxRetries?: number
}

// ============================================================================
// 2. LLMResponse — callLLM 返回结果
// ============================================================================

/**
 * LLM API 调用返回结果。
 *
 * - content：LLM 生成的文本内容（可能是 JSON 字符串或纯文本）
 * - parsed：如果 content 是合法 JSON 且通过 schema 校验，则为解析后的对象
 * - usage：token 使用统计
 * - model：实际使用的模型名称
 * - latencyMs：请求耗时（ms）
 * - cached：是否来自 prompt cache
 */
export interface LLMResponse {
  /** LLM 生成的文本内容 */
  content: string
  /** 解析后的 JSON 对象（如果 content 是合法 JSON） */
  parsed: unknown | null
  /** token 使用统计 */
  usage: LLMUsage
  /** 实际使用的模型名称 */
  model: string
  /** 请求耗时（ms） */
  latencyMs: number
  /** 是否来自 prompt cache */
  cached: boolean
}

/**
 * Token 使用统计。
 */
export interface LLMUsage {
  /** 输入 token 数 */
  promptTokens: number
  /** 输出 token 数 */
  completionTokens: number
  /** 总 token 数 */
  totalTokens: number
}

// ============================================================================
// 3. LLMError — LLM 调用错误
// ============================================================================

/**
 * LLM 错误码（骨架 §5.3 / §8.5）。
 */
export type LLMErrorCode =
  | 'llm_contract'        // schema 校验失败
  | 'llm_timeout'         // 请求超时
  | 'llm_rate_limit'      // 速率限制
  | 'llm_auth_error'      // 认证失败
  | 'llm_network_error'   // 网络错误
  | 'llm_parse_error'     // 响应解析失败
  | 'llm_unknown'         // 未知错误

/**
 * LLM 调用错误。
 *
 * 骨架 §5.3：失败时返回 llm_contract error。
 * Phase E 扩展为多种错误码，调用方可根据错误码决定是否重试或回退。
 */
export class LLMError extends Error {
  code: LLMErrorCode
  /** HTTP 状态码（如果有） */
  statusCode?: number
  /** 是否可重试 */
  retryable: boolean
  /** 原始响应（用于调试） */
  rawResponse?: string

  constructor(
    code: LLMErrorCode,
    message: string,
    options?: {
      statusCode?: number
      retryable?: boolean
      rawResponse?: string
    },
  ) {
    super(message)
    this.name = 'LLMError'
    this.code = code
    this.statusCode = options?.statusCode
    this.retryable = options?.retryable ?? false
    this.rawResponse = options?.rawResponse
  }
}

// ============================================================================
// 4. SemanticElement — LLM 输出的语义元素（技术路线 §22.3）
// ============================================================================

/**
 * LLM 输出的语义元素类型（技术路线 §21.5 / §22.3）。
 *
 * LLM 输出的"语义描述"，由 llmParser 转换为 ParsedLayerIntent。
 */
export interface SemanticElement {
  /** 元素类型（如 'background' / 'starfield' / 'circle' / 'gradient'） */
  type: string
  /** 自然语言描述（可选） */
  description?: string
  /** 代表色 [r, g, b]（0-255） */
  color?: [number, number, number]
  /** 图层层级（0 = 最底层） */
  layer: number
  /** 混合模式（可选） */
  blend?: string
  /** 额外参数（可选） */
  params?: Record<string, JsonLiteral>
}

// ============================================================================
// 5. LLMOutput — LLM 返回的完整输出结构（技术路线 §22.3）
// ============================================================================

/**
 * LLM 返回的完整输出结构（技术路线 §21.5 / §22.3）。
 *
 * 包含场景描述、风格、语义元素列表和主色调。
 * llmParser 将此结构转换为 ParsedIntent。
 */
export interface LLMOutput {
  /** 场景描述（如"星空夜景"） */
  scene: string
  /** 风格描述（如"写实" / "抽象" / "水彩"） */
  style?: string
  /** 语义元素列表 */
  elements: SemanticElement[]
  /** 主色调列表 */
  dominantColors?: [number, number, number][]
}

// ============================================================================
// 6. LLMProviderConfig — LLM 服务商配置
// ============================================================================

/**
 * LLM 服务商配置。
 *
 * Phase E 支持两种服务商：OpenAI 和 Anthropic（Claude）。
 */
export interface LLMProviderConfig {
  /** 服务商类型 */
  provider: 'openai' | 'anthropic'
  /** API 密钥 */
  apiKey: string
  /** API 基础 URL（可选，默认为官方 URL） */
  baseUrl?: string
  /** 默认模型名称 */
  defaultModel: string
  /** 默认组织 ID（OpenAI 可选） */
  organizationId?: string
}

/**
 * 默认 LLM 配置（从环境变量读取）。
 *
 * 在浏览器环境中 process 不可用，此时返回 null。
 */
export function getDefaultProviderConfig(): LLMProviderConfig | null {
  // 安全读取环境变量（兼容 Node.js 和浏览器）
  const globalObj = globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
  const env = globalObj.process?.env ?? {}

  // 优先读取 OpenAI
  const openaiKey = env.OPENAI_API_KEY
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      defaultModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
      baseUrl: env.OPENAI_BASE_URL,
      organizationId: env.OPENAI_ORG_ID,
    }
  }

  // 其次读取 Anthropic
  const anthropicKey = env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      defaultModel: env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20241022',
      baseUrl: env.ANTHROPIC_BASE_URL,
    }
  }

  return null
}
