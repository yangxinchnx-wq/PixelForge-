/**
 * Prompt Parser 统一入口(Step 22)。
 *
 * 策略:
 *   1. 先走 ruleParse(关键词快速路径),若命中 → 返回 rule 结果
 *   2. 若未命中且配置了 LLMClient → 走 parseByLLM
 *   3. 若两者都失败 → 返回空 layers(调用方决定如何提示用户)
 *
 * 与已有 clarify 路径的关系:
 * - clarify 路径(prompt → ParsedIntent → RenderIR)更适合"结构化 prompt"
 *   (如 "纯色:红色\n渐变:从红到蓝")
 * - promptParser 路径更适合"自由文本 prompt"
 *   (如 "做一个星空漩涡的宇宙场景")
 * - 两条路径并存,UI 可同时提供两个入口
 *
 * 数据流:
 *   parsePrompt(text, options)
 *     → ruleParse(text)              [快速路径]
 *       ├─ layers.length > 0 → 返回 rule 结果(confidence=0.8)
 *       └─ layers.length = 0 →
 *           ├─ options.llmClient 存在 → parseByLLM(client, text)
 *           │   ├─ 成功 → 返回 llm 结果
 *           │   └─ 失败 → 返回空 layers + warning
 *           └─ 无 llmClient → 返回空 layers + warning
 */

import type { LLMClient } from './llmParser'
import { parseByLLM } from './llmParser'
import type { LlmParseOptions } from './llmParser'
import { ruleParse } from './ruleParser'

import type { ParseResult, PromptRequest } from './types'

/** Rule 路径默认置信度(命中关键词即认为较可靠) */
const RULE_CONFIDENCE = 0.8

/** promptParser 选项 */
export interface PromptParserOptions {
  /** LLM 客户端(可选,未提供则只走 rule 路径) */
  llmClient?: LLMClient
  /** LLM 解析选项(风格 / 置信度) */
  llmOptions?: LlmParseOptions
  /**
   * 是否强制走 LLM(跳过 rule 快速路径)。
   * 默认 false:先试 rule,未命中再走 LLM。
   */
  forceLlm?: boolean
}

/**
 * 统一解析入口。
 *
 * @param request PromptRequest(text 必填,style / referenceImages 可选)
 * @param options 解析选项(llmClient / forceLlm 等)
 * @returns ParseResult(layers + metadata),永不抛错(失败时 layers=[],warnings 含原因)
 */
export async function parsePrompt(
  request: PromptRequest | string,
  options: PromptParserOptions = {},
): Promise<ParseResult> {
  const start = performance.now()

  // 兼容直接传字符串的调用方式
  const req: PromptRequest = typeof request === 'string'
    ? { text: request }
    : request

  const text = req.text
  if (!text || text.trim().length === 0) {
    return {
      layers: [],
      metadata: {
        confidence: 0,
        source: 'rule',
        durationMs: 0,
        warnings: ['prompt 为空'],
      },
    }
  }

  // —— 1. 快速路径:rule 关键词解析 ——
  if (!options.forceLlm) {
    const ruleResult = ruleParse(text)
    if (ruleResult.layers.length > 0) {
      const durationMs = performance.now() - start
      return {
        layers: ruleResult.layers,
        metadata: {
          confidence: RULE_CONFIDENCE,
          source: 'rule',
          durationMs,
          warnings: ruleResult.warnings.length > 0 ? ruleResult.warnings : undefined,
        },
      }
    }
  }

  // —— 2. LLM 路径 ——
  if (!options.llmClient) {
    const durationMs = performance.now() - start
    return {
      layers: [],
      metadata: {
        confidence: 0,
        source: 'rule',
        durationMs,
        warnings: ['rule 路径未命中,且未配置 LLMClient'],
      },
    }
  }

  try {
    const llmStyle = options.llmOptions?.style ?? req.style
    const llmResult = await parseByLLM(
      options.llmClient,
      text,
      { ...options.llmOptions, style: llmStyle },
    )
    const durationMs = performance.now() - start
    return {
      layers: llmResult.layers,
      metadata: {
        confidence: llmResult.confidence,
        source: 'llm',
        durationMs,
      },
    }
  } catch (e) {
    const durationMs = performance.now() - start
    return {
      layers: [],
      metadata: {
        confidence: 0,
        source: 'llm',
        durationMs,
        warnings: [`LLM 解析失败: ${(e as Error).message}`],
      },
    }
  }
}
