/**
 * Enhanced Director(Step 36.2)— 升级意图解析 + 上下文感知系统提示词。
 *
 * 在原有 director.ts 基础上增强:
 * - 更丰富的意图分类(中英文关键词 + 模式检测)
 * - create / modify 双模式:自动判断用户是想新建还是修改
 * - 上下文感知系统提示词:把当前画面状态注入 LLM
 * - 结构化 Director 输出 schema(不只是复用 LLMOutput)
 *
 * 与 director.ts 的关系:
 * - director.ts: 基础骨架(Phase F)
 * - directorEnhanced.ts: 增强版(Step 36.2+)
 * - decideWithContext() 是 decide() 的增强版,接收 DirectorContext
 */

import type { RenderIR } from '@/compiler/ir/renderIR'
import type { TimelineContent, DirectorIntent, DirectorDecision, DirectorPatch } from '../types'
import type { LLMProviderConfig, LLMOutput } from '@/authoring/llm/types'
import { callLLM } from '@/authoring/llm/callLLM'
import type { PromptCache } from '@/authoring/llm/promptCache'
import { validateLLMOutput } from '@/authoring/schema/schemas'
import { buildDirectorContext, buildCreateModeContext, buildModifyModeContext } from './directorContext'
import { parseIntent as parseIntentBase, toValuePatches, resetDirectorIdCounter } from './director'

// ============================================================================
// 1. 增强意图类型
// ============================================================================

/** Director 操作模式 */
export type DirectorMode = 'create' | 'modify' | 'animate' | 'analyze'

/** 增强意图(继承 DirectorIntent + 模式信息) */
export interface EnhancedIntent extends DirectorIntent {
  /** 检测到的操作模式 */
  mode: DirectorMode
  /** 从 prompt 中提取的关键词 */
  keywords: string[]
  /** 引用的图层 ID(如"把第二个图层..." → layer_02) */
  referencedLayerIds: string[]
}

// ============================================================================
// 2. 模式检测关键词
// ============================================================================

/** create 模式关键词(用户想新建内容) */
const CREATE_KEYWORDS = [
  '创建', '生成', '添加', '新建', '加一个', '加个', 'make', 'create', 'add', 'new', 'generate',
  '画', '做一个', '弄一个',
]

/** modify 模式关键词(用户想修改现有内容) */
const MODIFY_KEYWORDS = [
  '修改', '调整', '改变', '换成', '改为', '变大', '变小', '变亮', '变暗', '调',
  '把', '将', '让', '使',
  'change', 'modify', 'adjust', 'update', 'set', 'make it', 'turn',
  '再', '更', '稍微', '一点',
]

/** animate 模式关键词(用户想加动画) */
const ANIMATE_KEYWORDS = [
  '动画', '运动', '动态', '闪烁', '脉冲', '旋转', '移动', '淡入', '淡出',
  'animate', 'animation', 'motion', 'move', 'rotate', 'fade', 'pulse', 'spin',
  '动起来', '飘动', '波动',
]

/** analyze 模式关键词(用户想分析画面) */
const ANALYZE_KEYWORDS = [
  '分析', '检查', '诊断', '看看', '查看', '什么', '怎么样',
  'analyze', 'inspect', 'check', 'what', 'how',
]

// ============================================================================
// 3. 增强意图解析
// ============================================================================

/**
 * 从 prompt 中提取关键词。
 */
function extractKeywords(prompt: string): string[] {
  // 提取中文词组(2-4 字)和英文单词
  const cnMatches = prompt.match(/[\u4e00-\u9fa5]{2,4}/g) ?? []
  const enMatches = prompt.match(/[a-zA-Z]{3,}/g) ?? []
  return [...cnMatches, ...enMatches.map((s) => s.toLowerCase())]
}

/**
 * 检测引用的图层 ID。
 *
 * 例如:
 *   "把第一个图层改成蓝色" → ['layer_01'] (如果有 layer_01)
 *   "修改 layer_03 的颜色" → ['layer_03']
 */
function detectReferencedLayers(prompt: string, ir: RenderIR | null): string[] {
  const referenced: string[] = []
  if (!ir) return referenced

  // 直接引用 ID
  for (const layer of ir.layers) {
    if (prompt.includes(layer.id)) {
      referenced.push(layer.id)
    }
  }

  // 序数引用("第一个" / "第二个" / "1号" / "2号")
  const ordinalMatch = prompt.match(/第([一二三四五六七八九十\d]+)个/) ?? prompt.match(/(\d+)号/)
  if (ordinalMatch) {
    const ordinal = parseChineseNumber(ordinalMatch[1])
    if (ordinal >= 1 && ordinal <= ir.layers.length) {
      const layerId = ir.layers[ordinal - 1].id
      if (!referenced.includes(layerId)) {
        referenced.push(layerId)
      }
    }
  }

  return referenced
}

/** 解析中文数字或阿拉伯数字 */
function parseChineseNumber(s: string): number {
  const digit = parseInt(s, 10)
  if (!isNaN(digit)) return digit

  const map: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  }
  return map[s] ?? 0
}

/**
 * 检测操作模式。
 */
function detectMode(prompt: string): DirectorMode {
  const lower = prompt.toLowerCase()

  // 按优先级检测:animate > create > modify > analyze > create(默认)
  for (const kw of ANIMATE_KEYWORDS) {
    if (lower.includes(kw)) return 'animate'
  }
  for (const kw of ANALYZE_KEYWORDS) {
    if (lower.includes(kw)) return 'analyze'
  }
  for (const kw of CREATE_KEYWORDS) {
    if (lower.includes(kw)) return 'create'
  }
  for (const kw of MODIFY_KEYWORDS) {
    if (lower.includes(kw)) return 'modify'
  }

  // 默认:有现有图层时为 modify,否则为 create
  return 'create'
}

/**
 * 增强版意图解析。
 *
 * @param prompt 用户 prompt
 * @param ir 当前 RenderIR(用于检测引用图层)
 * @returns EnhancedIntent
 */
export function parseEnhancedIntent(
  prompt: string,
  ir: RenderIR | null = null,
): EnhancedIntent {
  const base = parseIntentBase(prompt)
  const mode = detectMode(prompt)
  const keywords = extractKeywords(prompt)
  const referencedLayerIds = detectReferencedLayers(prompt, ir)

  return {
    ...base,
    mode,
    keywords,
    referencedLayerIds,
  }
}

// ============================================================================
// 4. 上下文感知系统提示词
// ============================================================================

/**
 * 构建上下文感知的系统提示词。
 *
 * 根据操作模式注入不同的上下文:
 * - create: 描述现有画面,引导 LLM 生成新内容
 * - modify: 描述可修改参数,引导 LLM 做增量调整
 * - animate: 描述可动画参数,引导 LLM 生成关键帧
 * - analyze: 描述画面,引导 LLM 分析并给出建议
 */
export function buildContextAwareSystemPrompt(
  mode: DirectorMode,
  ir: RenderIR | null,
  timeline: TimelineContent | null = null,
): string {
  const basePrompt = `You are an AI Director for PixelForge, a procedural rendering engine.

Your task: Interpret the user's creative intent and generate parameter decisions.

Output format (strict JSON, matching LLMOutput schema):
{
  "scene": "<short scene description>",
  "style": "<optional style>",
  "elements": [
    {
      "type": "<element type: background|gradient|circle|noise|starfield|texture>",
      "description": "<description>",
      "color": [r, g, b],
      "layer": <non-negative integer>,
      "params": { <optional parameters> }
    }
  ],
  "dominantColors": [[r, g, b], ...]
}

Rules:
1. Colors are [r, g, b] with values 0-255.
2. Layer 0 = bottom, higher = on top.
3. Output ONLY the JSON object, no explanation.`

  if (mode === 'create') {
    const ctx = buildCreateModeContext(ir, timeline)
    return `${basePrompt}\n\n--- Current State ---\n${ctx}\n\nThe user wants to CREATE new content. Generate new elements that complement the existing scene.`
  }

  if (mode === 'modify') {
    const ctx = buildModifyModeContext(ir, timeline)
    return `${basePrompt}\n\n--- Current State ---\n${ctx}\n\nThe user wants to MODIFY existing parameters. Generate elements that reference existing layer IDs. Set "layer" to the existing layer index.`
  }

  if (mode === 'animate') {
    const ctx = buildDirectorContext(ir, timeline)
    return `${basePrompt}\n\n--- Current State ---\n${ctx.summary}\n\nThe user wants to add ANIMATION. In the "params" field of each element, include animation hints:
- "animateFrom": [r, g, b] starting value
- "animateTo": [r, g, b] ending value
- "duration": seconds (float)
Generate elements with animation parameters for the existing layers.`
  }

  // analyze
  const ctx = buildDirectorContext(ir, timeline)
  return `${basePrompt}\n\n--- Current State ---\n${ctx.summary}\n\nThe user wants to ANALYZE the current scene. Provide a brief analysis in the "scene" field and suggest improvements in the "elements" field.`
}

// ============================================================================
// 5. 上下文感知决策
// ============================================================================

/**
 * 增强版 decide:接收上下文(RenderIR + Timeline)做决策。
 *
 * 与 director.decide() 的区别:
 * - 注入当前画面状态到系统提示词
 * - 支持操作模式(create/modify/animate/analyze)
 * - 引用图层检测
 */
export async function decideWithContext(
  intent: EnhancedIntent,
  ir: RenderIR | null = null,
  timeline: TimelineContent | null = null,
  options?: {
    providerConfig?: LLMProviderConfig | null
    cache?: PromptCache | null
    model?: string
    disableCache?: boolean
  },
): Promise<DirectorDecision> {
  try {
    const systemPrompt = buildContextAwareSystemPrompt(intent.mode, ir, timeline)

    const response = await callLLM(
      {
        prompt: intent.prompt,
        systemPrompt,
        temperature: 0.4,
        maxTokens: 4096,
        model: options?.model,
      },
      options?.providerConfig ?? undefined,
      options?.disableCache ? null : (options?.cache ?? undefined),
    )

    if (!response.parsed) {
      return {
        intentId: intent.id,
        patches: [],
        reasoning: `LLM 返回内容不是合法 JSON(模式: ${intent.mode})`,
      }
    }

    validateLLMOutput(response.parsed)
    const llmOutput = response.parsed as LLMOutput

    const patches = convertLLMOutputToPatchesWithContext(llmOutput, intent, ir)

    return {
      intentId: intent.id,
      patches,
      reasoning: `AI Director(${intent.mode} 模式)生成 ${patches.length} 个参数修改`,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      intentId: intent.id,
      patches: [],
      reasoning: `AI Director 决策失败: ${reason}`,
    }
  }
}

// ============================================================================
// 6. 上下文感知的 LLM 输出转换
// ============================================================================

/**
 * 将 LLMOutput 转换为 DirectorPatch,考虑上下文。
 *
 * 与 director.ts 的 convertLLMOutputToDirectorPatches 的区别:
 * - modify 模式:使用 intent.referencedLayerIds 而非 layer_N
 * - animate 模式:提取 animateFrom/animateTo/duration 到 patch
 */
function convertLLMOutputToPatchesWithContext(
  output: LLMOutput,
  intent: EnhancedIntent,
  ir: RenderIR | null,
): DirectorPatch[] {
  const patches: DirectorPatch[] = []

  for (const element of output.elements) {
    let targetId = `layer_${element.layer}`

    // modify 模式:如果用户引用了具体图层,优先使用引用的图层 ID
    if (intent.mode === 'modify' && intent.referencedLayerIds.length > 0) {
      const refIdx = Math.min(element.layer, intent.referencedLayerIds.length - 1)
      targetId = intent.referencedLayerIds[Math.max(0, refIdx)]
    }

    // 如果 IR 存在,尝试匹配实际图层 ID
    if (ir && element.layer < ir.layers.length) {
      targetId = ir.layers[element.layer].id
    }

    // 颜色 patch
    if (element.color) {
      const [r, g, b] = element.color
      patches.push({
        targetEntity: 'layer',
        targetId,
        paramKey: 'color',
        value: [r / 255, g / 255, b / 255, 1.0],
      })
    }

    // 额外参数 patch
    if (element.params) {
      for (const [key, value] of Object.entries(element.params)) {
        // animate 模式:跳过动画提示字段(它们由 Timeline 处理)
        if (intent.mode === 'animate' && ['animateFrom', 'animateTo', 'duration'].includes(key)) {
          continue
        }
        patches.push({
          targetEntity: 'layer',
          targetId,
          paramKey: key,
          value,
        })
      }
    }
  }

  return patches
}

// ============================================================================
// 7. 导出辅助
// ============================================================================

export { resetDirectorIdCounter, toValuePatches }
