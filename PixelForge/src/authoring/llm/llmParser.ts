/**
 * PixelForge - LLM Parser（骨架 §5.3 / §7.2 Phase E）
 *
 * Phase E：LLM 替代 ruleParser，从自然语言 prompt 生成 ParsedIntent。
 *
 * 接口：
 *   llmParse(prompt: string, options?: LLMParseOptions): Promise<ParsedIntent>
 *
 * 数据流（骨架 §7.2 Phase E）：
 *   text prompt → llmParser(callLLM + schema 校验) → ParsedIntent → ruleParser → RenderIR
 *
 * 失败回退策略：
 *   LLM 调用失败或 schema 校验失败 → 回退到 RequirementClarifier（Phase B 规则 parser）
 *   回退时附带 warning，调用方可决定是否提示用户。
 *
 * 安全约束：
 *   - LLM 输出永远不直接进入渲染层（必须经过 ParsedIntent → ruleParser → RenderIR）
 *   - LLM 输出必须通过 validateLLMOutput schema 校验
 *   - 转换为 ParsedIntent 后，仍需通过 validateParsedIntent 校验
 */

import { Opcode } from '@/shared/types'
import type { JsonLiteral, BlendMode } from '@/shared/types'
import type { ParsedIntent, ParsedLayerIntent } from '@/authoring/types'
import { ParseError } from '@/authoring/types'
import type { LLMOutput, SemanticElement, LLMProviderConfig, LLMRequest } from './types'
import { LLMError } from './types'
import { callLLM } from './callLLM'
import { validateLLMOutput } from '@/authoring/schema/schemas'
import { PromptCache } from './promptCache'
import { clarify } from '@/authoring/clarify/requirementClarifier'
import type { ClarifyContext } from '@/authoring/types'

// ============================================================================
// LLMParseOptions — 解析选项
// ============================================================================

/**
 * LLM Parser 选项。
 */
export interface LLMParseOptions {
  /** LLM 服务商配置（可选，默认从环境变量读取） */
  providerConfig?: LLMProviderConfig | null
  /** Prompt cache（可选，默认使用全局缓存） */
  cache?: PromptCache | null
  /** 模型名称（可选，覆盖配置中的默认模型） */
  model?: string
  /** 采样温度（默认 0.3） */
  temperature?: number
  /** 最大 token 数（默认 4096） */
  maxTokens?: number
  /** 澄清上下文（用于约束画布尺寸等） */
  clarifyContext?: ClarifyContext
  /** 是否禁用 LLM 回退（默认 false，即 LLM 失败时回退到规则 parser） */
  disableFallback?: boolean
  /** 是否禁用 prompt cache（默认 false） */
  disableCache?: boolean
}

// ============================================================================
// LLMParseResult — 解析结果
// ============================================================================

/**
 * LLM Parser 返回结果。
 */
export interface LLMParseResult {
  /** 解析后的 ParsedIntent */
  intent: ParsedIntent
  /** 是否使用了 LLM（false = 回退到规则 parser） */
  usedLLM: boolean
  /** 警告信息（如回退原因） */
  warnings: string[]
  /** LLM 原始输出（如果使用了 LLM） */
  llmOutput?: LLMOutput
}

// ============================================================================
// 系统提示词
// ============================================================================

/**
 * LLM 系统提示词。
 *
 * 指导 LLM 将自然语言描述转换为结构化 LLMOutput JSON。
 */
const SYSTEM_PROMPT = `You are a visual scene analyzer for a procedural rendering engine called PixelForge.

Your task: Given a natural language description of a visual scene, output a structured JSON object describing the scene as layers of semantic elements.

Output format (strict JSON):
{
  "scene": "<short scene description>",
  "style": "<optional style: realistic / abstract / watercolor / minimalist / etc.>",
  "elements": [
    {
      "type": "<element type: background | gradient | circle | noise | starfield | texture>",
      "description": "<natural language description of this element>",
      "color": [r, g, b],
      "layer": <non-negative integer, 0 = bottom>,
      "blend": "<optional: normal | multiply | screen | overlay | add | subtract>",
      "params": { <optional additional parameters> }
    }
  ],
  "dominantColors": [[r, g, b], ...]
}

Rules:
1. "color" is [r, g, b] with values 0-255.
2. "layer" determines draw order: 0 = bottom, higher = on top.
3. Element types map to render operations:
   - "background" or "solid": solid color fill
   - "gradient": linear gradient (include "params": {"direction": "vertical"|"horizontal"|"diagonal", "color2": [r,g,b]})
   - "circle": circle shape (include "params": {"cx": 0.5, "cy": 0.5, "radius": 0.3})
   - "noise": procedural noise (include "params": {"scale": 24, "intensity": 0.8})
   - "starfield": star field (include "params": {"density": 0.5, "size": 2})
   - "texture": image texture (include "params": {"url": "..."})
4. Keep elements between 1 and 16.
5. Output ONLY the JSON object, no markdown, no explanation.`

// ============================================================================
// llmParse — 主接口
// ============================================================================

/**
 * LLM Parser 主接口。
 *
 * 完整流程：
 *   1. 构造 LLM 请求（system prompt + user prompt）
 *   2. 调用 callLLM
 *   3. 校验 LLM 输出（validateLLMOutput）
 *   4. 转换 LLMOutput → ParsedIntent
 *   5. 校验 ParsedIntent（validateParsedIntent）
 *   6. 失败时回退到 RequirementClarifier（规则 parser）
 *
 * @param prompt 用户输入的自然语言 prompt
 * @param options 解析选项
 * @returns LLMParseResult，包含 ParsedIntent 和元信息
 */
export async function llmParse(
  prompt: string,
  options?: LLMParseOptions,
): Promise<LLMParseResult> {
  const warnings: string[] = []

  // Step 1: 尝试 LLM 解析
  try {
    const request: LLMRequest = {
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      temperature: options?.temperature ?? 0.3,
      maxTokens: options?.maxTokens ?? 4096,
      model: options?.model,
    }

    const cache = options?.disableCache ? null : (options?.cache ?? undefined)
    const response = await callLLM(
      request,
      options?.providerConfig ?? undefined,
      cache ?? undefined,
    )

    if (!response.parsed) {
      throw new LLMError('llm_parse_error', 'LLM 返回内容不是合法 JSON')
    }

    // Step 2: schema 校验
    validateLLMOutput(response.parsed)
    const llmOutput = response.parsed as LLMOutput

    // Step 3: 转换为 ParsedIntent
    const intent = convertLLMOutputToIntent(llmOutput, prompt)

    // Step 4: ParsedIntent 校验
    validateParsedIntentSafe(intent)

    return {
      intent,
      usedLLM: true,
      warnings,
      llmOutput,
    }
  } catch (err) {
    // Step 5: 失败回退
    if (options?.disableFallback) {
      throw err
    }

    const reason = err instanceof LLMError
      ? `LLM 错误 (${err.code}): ${err.message}`
      : `LLM 解析失败: ${err instanceof Error ? err.message : String(err)}`

    warnings.push(`回退到规则 parser: ${reason}`)

    // 回退到 RequirementClarifier
    const fallbackIntent = await fallbackToRuleParser(prompt, options?.clarifyContext, warnings)

    return {
      intent: fallbackIntent,
      usedLLM: false,
      warnings,
    }
  }
}

// ============================================================================
// convertLLMOutputToIntent — LLMOutput → ParsedIntent
// ============================================================================

/**
 * 将 LLMOutput 转换为 ParsedIntent。
 *
 * 映射规则：
 *   - SemanticElement.type → Opcode
 *   - SemanticElement.color [r,g,b] (0-255) → params.color [r,g,b,a] (0-1)
 *   - SemanticElement.params → 合并到 ParsedLayerIntent.params
 *   - SemanticElement.blend → ParsedLayerIntent.blendMode
 *   - 按 layer 排序（底层在前）
 */
export function convertLLMOutputToIntent(
  output: LLMOutput,
  rawPrompt?: string,
): ParsedIntent {
  // 按 layer 排序（底层在前）
  const sortedElements = [...output.elements].sort((a, b) => a.layer - b.layer)

  const layers: ParsedLayerIntent[] = sortedElements.map((el) => {
    return convertElementToLayer(el)
  })

  const intent: ParsedIntent = {
    layers,
    rawPrompt,
  }

  return intent
}

/**
 * 将单个 SemanticElement 转换为 ParsedLayerIntent。
 */
function convertElementToLayer(el: SemanticElement): ParsedLayerIntent {
  const opcode = mapElementTypeToOpcode(el.type)
  const params = buildLayerParams(el, opcode)
  const blendMode = mapBlendMode(el.blend)

  const layer: ParsedLayerIntent = {
    opcode,
    params,
    blendMode,
    label: el.description,
  }

  return layer
}

/**
 * 将元素类型字符串映射到 Opcode。
 *
 * 映射表：
 *   background / solid / 纯色 → SOLID_COLOR
 *   gradient / 渐变 → LINEAR_GRADIENT
 *   noise / 噪声 → NOISE
 *   starfield / 星空 → NOISE（特殊参数）
 *   circle / 圆形 → CIRCLE_SHAPE
 *   texture / image / 图片 → IMAGE_TEXTURE
 */
function mapElementTypeToOpcode(type: string): Opcode {
  const lower = type.toLowerCase()

  if (lower === 'background' || lower === 'solid' || lower === '纯色' || lower === '背景') {
    return Opcode.SOLID_COLOR
  }
  if (lower === 'gradient' || lower === '渐变') {
    return Opcode.LINEAR_GRADIENT
  }
  if (lower === 'noise' || lower === '噪声' || lower === 'starfield' || lower === '星空') {
    return Opcode.NOISE
  }
  if (lower === 'circle' || lower === '圆形' || lower === 'ellipse' || lower === '椭圆') {
    return Opcode.CIRCLE_SHAPE
  }
  if (lower === 'texture' || lower === 'image' || lower === '图片' || lower === '纹理') {
    return Opcode.IMAGE_TEXTURE
  }

  // 默认：作为纯色背景
  return Opcode.SOLID_COLOR
}

/**
 * 根据元素类型构建图层参数。
 *
 * 颜色统一转换为归一化 [r, g, b, a] (0-1)。
 */
function buildLayerParams(el: SemanticElement, opcode: Opcode): Record<string, JsonLiteral> {
  const params: Record<string, JsonLiteral> = {}

  // 合并 LLM 提供的额外参数
  if (el.params) {
    for (const [key, value] of Object.entries(el.params)) {
      params[key] = value
    }
  }

  // 颜色转换
  if (el.color) {
    const [r, g, b] = el.color
    const normalizedColor: [number, number, number, number] = [
      r / 255,
      g / 255,
      b / 255,
      1.0,
    ]

    switch (opcode) {
      case Opcode.SOLID_COLOR:
        params.color = normalizedColor
        break
      case Opcode.LINEAR_GRADIENT:
        // color 作为渐变起始色，color2（如有）作为终止色
        params.color1 = normalizedColor
        if (!params.color2) {
          params.color2 = [0, 0, 0, 1] // 默认终止色为黑
        }
        if (!params.direction) {
          params.direction = 'vertical'
        }
        break
      case Opcode.NOISE:
        params.color = normalizedColor
        if (el.type.toLowerCase() === 'starfield' || el.type.toLowerCase() === '星空') {
          if (!params.scale) params.scale = 4
          if (!params.intensity) params.intensity = 0.8
        }
        break
      case Opcode.CIRCLE_SHAPE:
        params.color = normalizedColor
        if (!params.cx) params.cx = 0.5
        if (!params.cy) params.cy = 0.5
        if (!params.radius) params.radius = 0.3
        break
      case Opcode.IMAGE_TEXTURE:
        params.tintColor = normalizedColor
        break
    }
  }

  return params
}

/**
 * 将 LLM 返回的 blend 字符串映射到 BlendMode。
 */
function mapBlendMode(blend?: string): BlendMode {
  if (!blend) return 'normal'
  const lower = blend.toLowerCase()
  switch (lower) {
    case 'normal': return 'normal'
    case 'multiply': return 'multiply'
    case 'screen': return 'screen'
    case 'overlay': return 'overlay'
    case 'add': return 'add'
    case 'subtract': return 'subtract'
    default: return 'normal'
  }
}

// ============================================================================
// fallbackToRuleParser — 回退到规则 parser
// ============================================================================

/**
 * 回退到 RequirementClarifier（Phase B 规则 parser）。
 *
 * 如果规则 parser 也失败，抛出 ParseError。
 */
async function fallbackToRuleParser(
  prompt: string,
  context: ClarifyContext | undefined,
  warnings: string[],
): Promise<ParsedIntent> {
  try {
    const result = await clarify(prompt, context)

    if (result.status === 'auto_resolved') {
      return result.intent
    }

    if (result.status === 'needs_confirmation') {
      warnings.push('规则 parser 需要用户确认，使用最佳猜测')
      return result.intent
    }

    // rejected
    throw new ParseError('PARSE_ERROR', `规则 parser 拒绝: ${result.reason}`)
  } catch (err) {
    if (err instanceof ParseError) throw err
    throw new ParseError(
      'PARSE_ERROR',
      `规则 parser 也失败: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ============================================================================
// validateParsedIntentSafe — 安全校验（不抛异常，返回 void）
// ============================================================================

import { validateParsedIntent } from '@/authoring/schema/schemas'

/**
 * 安全校验 ParsedIntent。
 *
 * 如果校验失败，抛出 Error（会被外层 catch 捕获并触发回退）。
 */
function validateParsedIntentSafe(intent: ParsedIntent): void {
  validateParsedIntent(intent)
}
