/**
 * LLM Parser(Step 22)— 模型无关的 LLM 调用与结果转换。
 *
 * 设计原则:
 * - LLMClient 是注入接口(可换 OpenAI / Claude / 本地 / mock)
 * - 不依赖任何具体 SDK,纯 TypeScript 接口
 * - LLM 返回的 JSON 必须经 schema 校验后才转换为 Layer[]
 * - 失败时抛 ParseError(与 authoring/types 一致)
 *
 * 数据流:
 *   prompt
 *     → 构造 LLM 系统提示词(注入 schema 文档)
 *     → client.complete(fullPrompt) → 原始字符串
 *     → 提取 JSON(容忍 ```json fenced code block)
 *     → validateLlmOutput(raw) → LlmOutput
 *     → llmOutputToLayer(...) per layer → Layer[]
 *     → 返回 { layers, metadata }
 */

import type { Layer } from '@/compiler/ir/renderIR'
import { ParseError } from '@/authoring/types'

import { llmOutputToLayer } from './ruleParser'
import {
  PROMPT_LLM_SCHEMA_DOC,
  validateLlmOutput,
} from './schema'
import type { LlmOutput } from './schema'

/**
 * 模型无关的 LLM 客户端接口。
 *
 * 实现示例:
 * - OpenAI: fetch('https://api.openai.com/v1/chat/completions', {...})
 * - Claude: fetch('https://api.anthropic.com/v1/messages', {...})
 * - 本地: 调用 window.__llmBridge.complete(prompt)
 * - Mock: 直接返回固定 JSON 字符串(用于测试)
 */
export interface LLMClient {
  /** 输入完整 prompt(含系统提示),返回 LLM 原始字符串输出 */
  complete(prompt: string): Promise<string>
}

/**
 * LLM 解析选项。
 */
export interface LlmParseOptions {
  /** 风格提示(可选,注入到系统提示词) */
  style?: string
  /** 置信度(默认 0.7,LLM 路径低于 rule 路径的 0.8) */
  confidence?: number
}

/** 默认置信度(LLM 路径) */
const DEFAULT_LLM_CONFIDENCE = 0.7

/**
 * 构造发送给 LLM 的完整 prompt(系统提示 + schema + 用户输入)。
 *
 * @param userPrompt 用户原始 prompt
 * @param options 风格等可选项
 */
export function buildLlmPrompt(userPrompt: string, options: LlmParseOptions = {}): string {
  const schemaJson = JSON.stringify(PROMPT_LLM_SCHEMA_DOC, null, 2)
  const styleLine = options.style ? `\n风格要求: ${options.style}\n` : ''

  return [
    '你是 PixelForge RenderIR 生成器。',
    '根据用户描述生成 Layer 数组,只输出 JSON,不要任何解释文字。',
    '',
    '输出必须符合以下 JSON Schema:',
    '```json',
    schemaJson,
    '```',
    '',
    '允许的 opcode 字符串:SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE / IMAGE_TEXTURE',
    'blendMode 可选:normal / multiply / screen / overlay / add / subtract',
    'params 字段根据 opcode 自由填充(如 SOLID_COLOR 用 color: [r,g,b,a])。',
    styleLine,
    '用户需求:',
    userPrompt,
  ].filter((line) => line.length > 0).join('\n')
}

/**
 * 从 LLM 原始字符串输出中提取 JSON。
 *
 * 支持:
 * - 纯 JSON 字符串
 * - ```json ... ``` 围栏代码块
 * - ``` ... ``` 普通代码块
 * - 含前后多余文本时,提取第一个 { 到最后一个 } 之间的内容
 *
 * @throws {ParseError} 无法提取 JSON
 */
export function extractJsonFromLlmResponse(raw: string): string {
  const trimmed = raw.trim()

  // 1. ```json ... ``` 或 ``` ... ``` 围栏
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }

  // 2. 纯 JSON(以 { 开头,以 } 结尾)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  // 3. 含前后多余文本,提取第一个 { 到最后一个 }
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  throw new ParseError(
    'LLM_RESPONSE_INVALID',
    `无法从 LLM 输出中提取 JSON(前 80 字符: ${trimmed.slice(0, 80)})`,
  )
}

/**
 * 解析 LLM 响应字符串为 LlmOutput(经过 schema 校验)。
 *
 * @throws {ParseError} JSON 解析失败 / schema 校验失败
 */
export function parseLlmResponse(raw: string): LlmOutput {
  const jsonStr = extractJsonFromLlmResponse(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch (e) {
    throw new ParseError(
      'LLM_RESPONSE_INVALID',
      `LLM 输出不是合法 JSON: ${(e as Error).message}`,
    )
  }
  validateLlmOutput(parsed)
  return parsed
}

/**
 * 把 LlmOutput 转换为 Layer[](已含稳定 ID)。
 */
export function llmOutputToLayers(output: LlmOutput): Layer[] {
  return output.layers.map((l, i) => llmOutputToLayer(l, i))
}

/**
 * 通过 LLM 解析 prompt 为 Layer[]。
 *
 * @param client LLM 客户端(注入)
 * @param userPrompt 用户原始 prompt
 * @param options 风格 / 置信度
 * @throws {ParseError} LLM 调用失败 / 响应解析失败 / schema 校验失败
 */
export async function parseByLLM(
  client: LLMClient,
  userPrompt: string,
  options: LlmParseOptions = {},
): Promise<{ layers: Layer[]; confidence: number }> {
  const fullPrompt = buildLlmPrompt(userPrompt, options)
  const raw = await client.complete(fullPrompt)
  const output = parseLlmResponse(raw)
  const layers = llmOutputToLayers(output)

  return {
    layers,
    confidence: options.confidence ?? DEFAULT_LLM_CONFIDENCE,
  }
}
