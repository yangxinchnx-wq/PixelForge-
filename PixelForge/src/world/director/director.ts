/**
 * PixelForge - AI Director（骨架 §6 / §12.3 Phase F+）
 *
 * AI Director 解析用户高层意图，生成参数决策和 Timeline。
 *
 * 接口契约（骨架 §12.3）：
 *   - IAIDirector.create()：生成模式入口，输入 User Prompt + Persona，输出 TimelineContent
 *   - IAIDirector.revise()：修改模式入口，输入 RevisionIntent，输出 Revision Request
 *
 * 数据流（骨架 §7.2 Phase F）：
 *   User Prompt → Director.parseIntent() → DirectorIntent
 *   DirectorIntent → Director.decide() → DirectorDecision
 *   DirectorDecision.patches → ValuePatch[] (source='l3_director') → patchEngine → RenderIR
 *   DirectorDecision.timeline → Timeline → evaluateTimeline → ValuePatch[]
 *
 * AI Director 驱动的参数 owner = 'l3_director'（骨架 §4.1.5）。
 */

import type { ValuePatch } from '@/compiler/ir/patch'
import type {
  DirectorIntent,
  DirectorDecision,
  DirectorPatch,
} from '../types'
import type { LLMProviderConfig } from '@/authoring/llm/types'
import { callLLM } from '@/authoring/llm/callLLM'
import type { PromptCache } from '@/authoring/llm/promptCache'
import { validateLLMOutput } from '@/authoring/schema/schemas'
import type { LLMOutput } from '@/authoring/llm/types'

// ============================================================================
// ID 生成
// ============================================================================

let directorIdCounter = 0

function genId(prefix: string): string {
  directorIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${directorIdCounter.toString(36)}`
}

// ============================================================================
// 系统提示词
// ============================================================================

const DIRECTOR_SYSTEM_PROMPT = `You are an AI Director for a procedural rendering engine called PixelForge.

Your task: Given a user's creative intent, generate parameter decisions and optionally a timeline.

Output format (strict JSON, matching LLMOutput schema):
{
  "scene": "<short scene description>",
  "style": "<optional style>",
  "elements": [
    {
      "type": "<element type>",
      "description": "<description>",
      "color": [r, g, b],
      "layer": <non-negative integer>,
      "params": { <optional parameters> }
    }
  ],
  "dominantColors": [[r, g, b], ...]
}

Rules:
1. Interpret the user's intent as visual scene parameters.
2. Map intent to element types: background, gradient, circle, noise, starfield, texture.
3. Colors are [r, g, b] with values 0-255.
4. Layer 0 = bottom, higher = on top.
5. Output ONLY the JSON object.`

// ============================================================================
// parseIntent — 解析用户意图
// ============================================================================

/**
 * 解析用户高层意图，生成 DirectorIntent。
 *
 * 此函数不调用 LLM，仅做本地意图分类。
 * 真正的语义理解在 decide() 中通过 LLM 完成。
 *
 * @param prompt 用户 prompt
 * @returns DirectorIntent
 */
export function parseIntent(prompt: string): DirectorIntent {
  const lower = prompt.toLowerCase()

  // 意图分类
  let type = 'general'
  if (lower.includes('mood') || lower.includes('氛围') || lower.includes('情绪')) {
    type = 'mood'
  } else if (lower.includes('pacing') || lower.includes('节奏') || lower.includes('速度')) {
    type = 'pacing'
  } else if (lower.includes('tone') || lower.includes('色调') || lower.includes('调色')) {
    type = 'color_shift'
  } else if (lower.includes('animat') || lower.includes('动画') || lower.includes('运动')) {
    type = 'animation'
  }

  return {
    id: genId('intent'),
    prompt,
    type,
    params: {},
    confidence: 0.5, // 本地解析置信度较低
  }
}

// ============================================================================
// decide — AI Director 决策
// ============================================================================

/**
 * AI Director 决策接口。
 *
 * 调用 LLM 生成参数决策，失败时返回空决策。
 *
 * @param intent DirectorIntent
 * @param options 可选配置
 * @returns DirectorDecision
 */
export async function decide(
  intent: DirectorIntent,
  options?: {
    providerConfig?: LLMProviderConfig | null
    cache?: PromptCache | null
    model?: string
    disableCache?: boolean
  },
): Promise<DirectorDecision> {
  try {
    const response = await callLLM(
      {
        prompt: intent.prompt,
        systemPrompt: DIRECTOR_SYSTEM_PROMPT,
        temperature: 0.4,
        maxTokens: 4096,
        model: options?.model,
      },
      options?.providerConfig ?? undefined,
      options?.disableCache ? null : (options?.cache ?? undefined),
    )

    if (!response.parsed) {
      return emptyDecision(intent.id, 'LLM 返回内容不是合法 JSON')
    }

    // schema 校验
    validateLLMOutput(response.parsed)
    const llmOutput = response.parsed as LLMOutput

    // 转换 LLM 输出为 DirectorPatch 列表
    const patches = convertLLMOutputToDirectorPatches(llmOutput)

    return {
      intentId: intent.id,
      patches,
      reasoning: `LLM 生成 ${patches.length} 个参数修改`,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return emptyDecision(intent.id, `AI Director 决策失败: ${reason}`)
  }
}

// ============================================================================
// LLM 输出转换
// ============================================================================

/**
 * 将 LLMOutput 转换为 DirectorPatch 列表。
 *
 * 复用 llmParser 的映射逻辑，但生成 DirectorPatch 而非 ParsedLayerIntent。
 */
function convertLLMOutputToDirectorPatches(
  output: LLMOutput,
): DirectorPatch[] {
  const patches: DirectorPatch[] = []

  for (const element of output.elements) {
    // 颜色 patch
    if (element.color) {
      const [r, g, b] = element.color
      patches.push({
        targetEntity: 'layer',
        targetId: `layer_${element.layer}`,
        paramKey: 'color',
        value: [r / 255, g / 255, b / 255, 1.0],
      })
    }

    // 额外参数 patch
    if (element.params) {
      for (const [key, value] of Object.entries(element.params)) {
        patches.push({
          targetEntity: 'layer',
          targetId: `layer_${element.layer}`,
          paramKey: key,
          value,
        })
      }
    }
  }

  return patches
}

// ============================================================================
// DirectorPatch → ValuePatch 转换
// ============================================================================

/**
 * 将 DirectorPatch 列表转换为 ValuePatch 列表。
 *
 * source 固定为 'l3_director'。
 *
 * @param patches DirectorPatch 列表
 * @param intentId 关联的意图 ID（用于 patchId 生成）
 * @returns ValuePatch 列表
 */
export function toValuePatches(
  patches: DirectorPatch[],
  intentId: string,
): ValuePatch[] {
  return patches.map((p, i) => ({
    patchId: `director_${intentId}_${i}`,
    tier: 'value' as const,
    source: 'l3_director' as const,
    targetEntity: p.targetEntity,
    targetId: p.targetId,
    paramKey: p.paramKey,
    value: p.value,
  }))
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建空决策（LLM 失败时使用）。
 */
function emptyDecision(intentId: string, reasoning: string): DirectorDecision {
  return {
    intentId,
    patches: [],
    reasoning,
  }
}

/**
 * 重置 ID 生成器（用于测试隔离）。
 */
export function resetDirectorIdCounter(): void {
  directorIdCounter = 0
}
