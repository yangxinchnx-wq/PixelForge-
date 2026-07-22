/**
 * Director Conversation + Timeline Generation(Step 36.3 + 36.4)
 *
 * Step 36.3: 多轮对话历史 + 迭代修改
 * - 维护对话上下文(用户消息 + Director 决策 + 已应用 patches)
 * - 支持迭代修改("再亮一点"、"把第二个图层改成蓝色")
 * - 对话历史注入 LLM,让 Director 记住之前的交互
 *
 * Step 36.4: Timeline 自动生成
 * - 从 LLM 输出中提取动画参数(animateFrom / animateTo / duration)
 * - 生成 TimelineTrack + TimelineKeyframe
 * - 集成到现有 Timeline 系统
 */

import type { RenderIR } from '@/compiler/ir/renderIR'
import type {
  TimelineContent,
  TimelineTrack,
  TimelineKeyframe,
  DirectorDecision,
  DirectorPatch,
} from '../types'
import type { LLMProviderConfig, LLMOutput } from '@/authoring/llm/types'
import type { PromptCache } from '@/authoring/llm/promptCache'
import { callLLM } from '@/authoring/llm/callLLM'
import { validateLLMOutput } from '@/authoring/schema/schemas'
import {
  parseEnhancedIntent,
  buildContextAwareSystemPrompt,
  toValuePatches,
  resetDirectorIdCounter,
} from './directorEnhanced'
import type { EnhancedIntent } from './directorEnhanced'

// ============================================================================
// 1. 对话历史数据结构
// ============================================================================

/** 对话消息角色 */
export type ConversationRole = 'user' | 'director'

/** 对话消息 */
export interface ConversationMessage {
  /** 消息 ID */
  id: string
  /** 角色 */
  role: ConversationRole
  /** 时间戳 */
  timestamp: number
  /** 用户消息原文或 Director 决策原因 */
  content: string
  /** 关联的 Director 决策(仅 role='director' 时) */
  decision?: DirectorDecision
  /** 关联的 EnhancedIntent(仅 role='user' 时) */
  intent?: EnhancedIntent
}

/** 对话会话 */
export interface ConversationSession {
  /** 会话 ID */
  id: string
  /** 消息历史 */
  messages: ConversationMessage[]
  /** 已应用的 patches 累积(用于 undo) */
  appliedPatches: DirectorPatch[]
  /** 创建时间 */
  createdAt: number
}

// ============================================================================
// 2. ID 生成
// ============================================================================

let convIdCounter = 0

function genId(prefix: string): string {
  convIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${convIdCounter.toString(36)}`
}

export function resetConversationIdCounter(): void {
  convIdCounter = 0
}

// ============================================================================
// 3. 会话管理
// ============================================================================

/**
 * 创建新的对话会话。
 */
export function createConversation(): ConversationSession {
  return {
    id: genId('conv'),
    messages: [],
    appliedPatches: [],
    createdAt: Date.now(),
  }
}

/**
 * 添加用户消息到会话。
 */
export function addUserMessage(
  session: ConversationSession,
  intent: EnhancedIntent,
): ConversationSession {
  const msg: ConversationMessage = {
    id: genId('msg'),
    role: 'user',
    timestamp: Date.now(),
    content: intent.prompt,
    intent,
  }
  return {
    ...session,
    messages: [...session.messages, msg],
  }
}

/**
 * 添加 Director 决策消息到会话。
 */
export function addDirectorMessage(
  session: ConversationSession,
  decision: DirectorDecision,
): ConversationSession {
  const msg: ConversationMessage = {
    id: genId('msg'),
    role: 'director',
    timestamp: Date.now(),
    content: decision.reasoning,
    decision,
  }
  const appliedPatches = decision.patches.length > 0
    ? [...session.appliedPatches, ...decision.patches]
    : session.appliedPatches

  return {
    ...session,
    messages: [...session.messages, msg],
    appliedPatches,
  }
}

/**
 * 清空对话历史(保留会话 ID)。
 */
export function clearConversation(session: ConversationSession): ConversationSession {
  return {
    ...session,
    messages: [],
    appliedPatches: [],
  }
}

// ============================================================================
// 4. 对话历史序列化(注入 LLM)
// ============================================================================

/**
 * 将对话历史序列化为文本,供 LLM 系统提示词使用。
 *
 * 格式:
 *   --- 对话历史 ---
 *   [用户] 创建一个星空背景
 *   [Director] 生成 3 个图层: 背景层、星空层、粒子层
 *   [用户] 再亮一点
 *   [Director] 调整星空层 intensity 0.5→0.8
 *   --- 对话历史结束 ---
 */
export function serializeConversation(session: ConversationSession): string {
  if (session.messages.length === 0) return ''

  const lines: string[] = ['--- 对话历史 ---']
  for (const msg of session.messages) {
    const role = msg.role === 'user' ? '用户' : 'Director'
    lines.push(`[${role}] ${msg.content}`)
  }
  lines.push('--- 对话历史结束 ---')
  return lines.join('\n')
}

/**
 * 构建包含对话历史的系统提示词。
 */
export function buildConversationSystemPrompt(
  session: ConversationSession,
  mode: EnhancedIntent['mode'],
  ir: RenderIR | null,
  timeline: TimelineContent | null = null,
): string {
  const basePrompt = buildContextAwareSystemPrompt(mode, ir, timeline)
  const history = serializeConversation(session)

  if (history) {
    return `${basePrompt}\n\n${history}\n\n请参考之前的对话历史,理解用户的迭代修改意图。`
  }
  return basePrompt
}

// ============================================================================
// 5. 对话式决策(Step 36.3 核心)
// ============================================================================

/**
 * 对话式决策:基于对话历史 + 当前状态做决策。
 *
 * 与 decideWithContext 的区别:
 * - 注入对话历史到系统提示词
 * - 自动更新会话状态
 * - 支持"再亮一点"等迭代修改
 *
 * @param session 对话会话
 * @param prompt 用户 prompt
 * @param ir 当前 RenderIR
 * @param timeline 当前时间轴
 * @param options LLM 配置
 * @returns 更新后的会话(含新消息)
 */
export async function converse(
  session: ConversationSession,
  prompt: string,
  ir: RenderIR | null = null,
  timeline: TimelineContent | null = null,
  options?: {
    providerConfig?: LLMProviderConfig | null
    cache?: PromptCache | null
    model?: string
    disableCache?: boolean
  },
): Promise<ConversationSession> {
  // 1. 解析意图
  const intent = parseEnhancedIntent(prompt, ir)

  // 2. 添加用户消息
  let updatedSession = addUserMessage(session, intent)

  // 3. 构建包含对话历史的系统提示词
  const systemPrompt = buildConversationSystemPrompt(
    updatedSession,
    intent.mode,
    ir,
    timeline,
  )

  // 4. 调用 LLM
  let decision: DirectorDecision
  try {
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
      decision = {
        intentId: intent.id,
        patches: [],
        reasoning: `LLM 返回内容不是合法 JSON(模式: ${intent.mode})`,
      }
    } else {
      validateLLMOutput(response.parsed)
      const llmOutput = response.parsed as LLMOutput
      const patches = convertLLMOutputWithHistory(llmOutput, intent, ir, updatedSession)
      decision = {
        intentId: intent.id,
        patches,
        reasoning: `Director(${intent.mode} 模式)生成 ${patches.length} 个修改`,
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    decision = {
      intentId: intent.id,
      patches: [],
      reasoning: `Director 决策失败: ${reason}`,
    }
  }

  // 5. 添加 Director 消息
  updatedSession = addDirectorMessage(updatedSession, decision)

  return updatedSession
}

/**
 * 带对话历史的 LLM 输出转换。
 *
 * 在 modify 模式下,如果用户说"再亮一点",LLM 可能只输出增量修改。
 * 此函数确保 patches 正确映射到已有图层。
 */
function convertLLMOutputWithHistory(
  output: LLMOutput,
  intent: EnhancedIntent,
  ir: RenderIR | null,
  session: ConversationSession,
): DirectorPatch[] {
  const patches: DirectorPatch[] = []

  for (const element of output.elements) {
    let targetId = `layer_${element.layer}`

    // 优先使用用户引用的图层
    if (intent.referencedLayerIds.length > 0) {
      const refIdx = Math.min(element.layer, intent.referencedLayerIds.length - 1)
      targetId = intent.referencedLayerIds[Math.max(0, refIdx)]
    }
    // 其次使用 IR 中的实际图层
    else if (ir && element.layer < ir.layers.length) {
      targetId = ir.layers[element.layer].id
    }
    // 最后:检查对话历史中 Director 之前创建的图层
    else {
      const directorMsgs = session.messages.filter((m) => m.role === 'director' && m.decision)
      for (const msg of directorMsgs) {
        const found = msg.decision!.patches.find((p) => p.targetId === targetId)
        if (found) break
      }
    }

    if (element.color) {
      const [r, g, b] = element.color
      patches.push({
        targetEntity: 'layer',
        targetId,
        paramKey: 'color',
        value: [r / 255, g / 255, b / 255, 1.0],
      })
    }

    if (element.params) {
      for (const [key, value] of Object.entries(element.params)) {
        if (['animateFrom', 'animateTo', 'duration'].includes(key)) continue
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
// 6. Timeline 自动生成(Step 36.4)
// ============================================================================

/** 动画参数提取结果 */
export interface AnimationParams {
  /** 起始值 */
  from: number | number[]
  /** 终止值 */
  to: number | number[]
  /** 持续时间(秒) */
  duration: number
  /** 目标参数键 */
  paramKey: string
  /** 目标图层 ID */
  targetId: string
}

/**
 * 从 LLM 输出中提取动画参数。
 *
 * LLM 在 animate 模式下会在 params 中输出:
 *   { animateFrom: [r,g,b], animateTo: [r,g,b], duration: 2.0 }
 *
 * 此函数提取这些参数,用于生成 Timeline 关键帧。
 */
export function extractAnimationParams(
  output: LLMOutput,
  ir: RenderIR | null,
): AnimationParams[] {
  const results: AnimationParams[] = []

  for (const element of output.elements) {
    if (!element.params) continue

    const { animateFrom, animateTo, duration } = element.params
    if (animateFrom === undefined || animateTo === undefined) continue

    let targetId = `layer_${element.layer}`
    if (ir && element.layer < ir.layers.length) {
      targetId = ir.layers[element.layer].id
    }

    // 确定 paramKey:如果有 color,用 color;否则用第一个非动画字段
    let paramKey = 'color'
    if (element.color) {
      paramKey = 'color'
    } else {
      const nonAnimKeys = Object.keys(element.params).filter(
        (k) => !['animateFrom', 'animateTo', 'duration'].includes(k),
      )
      if (nonAnimKeys.length > 0) paramKey = nonAnimKeys[0]
    }

    results.push({
      from: animateFrom as number | number[],
      to: animateTo as number | number[],
      duration: typeof duration === 'number' ? duration : 2.0,
      paramKey,
      targetId,
    })
  }

  return results
}

/**
 * 从动画参数生成 TimelineTrack。
 *
 * 生成 2 个关键帧:
 *   - t=0: from 值
 *   - t=duration: to 值
 * 插值模式: linear
 */
export function createTrackFromAnimation(
  anim: AnimationParams,
  trackIndex: number,
): TimelineTrack {
  const keyframes: TimelineKeyframe[] = [
    {
      id: genId('kf'),
      time: 0,
      value: anim.from as never,
      interpolation: 'linear',
    },
    {
      id: genId('kf'),
      time: anim.duration,
      value: anim.to as never,
      interpolation: 'linear',
    },
  ]

  return {
    id: genId(`track_${trackIndex}`),
    name: `${anim.paramKey} 动画`,
    targetEntity: 'layer',
    targetId: anim.targetId,
    paramKey: anim.paramKey,
    keyframes,
    enabled: true,
  }
}

/**
 * 从多个动画参数生成完整 TimelineContent。
 */
export function createTimelineFromAnimations(
  animations: AnimationParams[],
  fps = 60,
  loop = true,
): TimelineContent {
  const tracks = animations.map((anim, i) => createTrackFromAnimation(anim, i))
  const duration = Math.max(...animations.map((a) => a.duration), 0)

  return {
    id: genId('tl'),
    tracks,
    duration,
    loop,
    fps,
  }
}

/**
 * 从 LLM 输出生成 Timeline(一步到位)。
 */
export function generateTimelineFromLLM(
  output: LLMOutput,
  ir: RenderIR | null,
  fps = 60,
): TimelineContent | null {
  const animations = extractAnimationParams(output, ir)
  if (animations.length === 0) return null
  return createTimelineFromAnimations(animations, fps)
}

// ============================================================================
// 7. 导出
// ============================================================================

export { resetDirectorIdCounter, toValuePatches }
