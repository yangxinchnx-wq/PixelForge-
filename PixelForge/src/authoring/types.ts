/**
 * PixelForge - L2 Semantic Authoring 类型定义（骨架 §5）
 *
 * 本文件定义 L2 层的核心类型：
 *   - ParsedIntent：RequirementClarifier 输出 / ruleParser 输入
 *   - ClarifyResult：RequirementClarifier 三态结果
 *   - ClarifyContext：澄清上下文
 *
 * 数据流（骨架 §7.2 Phase B）：
 *   text prompt → RequirementClarifier → ParsedIntent → ruleParser → RenderIR
 *
 * ParsedIntent 是自然语言到 RenderIR 之间的中间表示：
 *   - 不含稳定 ID（由 ruleParser 生成）
 *   - 不含 source / paramOwnership（由 ruleParser 填充）
 *   - 不含 Region（由 ruleParser 创建默认区域）
 *   - 仅描述"要画什么"，不描述"怎么编译"
 */

import type {
  Opcode,
  BlendMode,
  JsonLiteral,
  EffectType,
} from '@/shared/types'

// ============================================================================
// 1. ParsedLayerIntent — 解析后的图层意图
// ============================================================================

/**
 * 解析后的单个图层意图。
 *
 * ruleParser 会根据此信息创建完整的 Layer（含 id、source、paramOwnership 等）。
 */
export interface ParsedLayerIntent {
  /** 图层 opcode（与 Opcode 枚举值对应） */
  opcode: Opcode
  /** 图层参数（JsonLiteral 格式，与 Layer.params 一致） */
  params: Record<string, JsonLiteral>
  /** 混合模式（默认 'normal'） */
  blendMode?: BlendMode
  /** 可选标签（用于调试和日志） */
  label?: string
}

// ============================================================================
// 2. ParsedEffectIntent — 解析后的效果意图
// ============================================================================

/**
 * 解析后的单个效果意图。
 * Phase B 不强制要求，但支持简单效果。
 */
export interface ParsedEffectIntent {
  /** 效果类型（如 'blur' / 'bloom' / 'vignette'） */
  type: EffectType
  /** 效果参数 */
  params: Record<string, JsonLiteral>
  /** 目标图层（可选，默认全局） */
  targetLayer?: string
  /** 目标区域（可选） */
  targetRegion?: string
}

// ============================================================================
// 3. ParsedIntent — 完整解析意图
// ============================================================================

/**
 * RequirementClarifier 的输出 / ruleParser 的输入。
 *
 * 表示从自然语言 prompt 中提取的结构化渲染意图。
 * ruleParser 负责将其转换为完整的 RenderIR。
 */
export interface ParsedIntent {
  /** 画布尺寸（可选，ruleParser 使用默认值） */
  canvas?: { width: number; height: number }
  /** 图层列表（至少 1 个） */
  layers: ParsedLayerIntent[]
  /** 效果列表（可选） */
  effects?: ParsedEffectIntent[]
  /** 原始 prompt（用于日志和调试） */
  rawPrompt?: string
}

// ============================================================================
// 4. ClarifyContext — 澄清上下文
// ============================================================================

/**
 * RequirementClarifier 的可选上下文。
 */
export interface ClarifyContext {
  /** 硬件能力（影响可用 opcode 和最大尺寸） */
  capabilityProfileId?: string
  /** 画布尺寸约束（可选） */
  maxCanvasSize?: { width: number; height: number }
}

// ============================================================================
// 5. ClarifyResult — 澄清三态结果（骨架 §5.1）
// ============================================================================

/**
 * RequirementClarifier 的返回类型。
 *
 * 三种状态（骨架 §5.1）：
 *   - auto_resolved：意图明确，可直接生成 RenderIR
 *   - needs_confirmation：意图部分明确，但需要用户确认
 *   - rejected：意图不合法或存在冲突，拒绝执行
 *
 * 必须拒绝的场景（骨架 §5.1）：
 *   - 输出尺寸与性能预算冲突
 *   - 风格与参考图冲突
 *   - 描述存在互斥语义
 *   - 编辑目标不唯一
 *   - 用户请求会触发高代价全局重编译
 */
export type ClarifyResult =
  | { status: 'auto_resolved'; intent: ParsedIntent; warnings?: string[] }
  | { status: 'needs_confirmation'; intent: ParsedIntent; questions: string[] }
  | { status: 'rejected'; reason: string }

// ============================================================================
// 6. ParseError — 解析错误
// ============================================================================

/**
 * 解析错误类型。
 * 用于 ruleParser 在 ParsedIntent → RenderIR 转换过程中抛出的错误。
 */
export class ParseError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ParseError'
    this.code = code
  }
}
