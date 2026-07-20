/**
 * Prompt 模块类型定义(Step 22)。
 *
 * 本模块是「自然语言 → RenderIR Layer」的快速路径,与已有的 clarify + ruleParser
 * 路径并存:
 *
 *   路径 A(已有): prompt → clarify → ParsedIntent → ruleParser → RenderIR
 *   路径 B(本模块): prompt → ruleParse(关键词) → Layer[] → push to RenderIR
 *                                ↓(若未命中规则)
 *                            parseByLLM(LLMClient) → Layer[]
 *
 * 设计原则:
 * - 返回 Layer[](不是完整 RenderIR),由调用方决定如何插入 IR
 *   (默认追加到 runtime.currentIr.layers)
 * - LLMClient 是模型无关接口(可注入 OpenAI / Claude / 本地模型 / mock)
 * - confidence 用于 UI 反馈(低置信度时建议用户确认)
 * - source 标识来源('rule' | 'llm'),便于审计与回放
 */

import type { Layer } from '@/compiler/ir/renderIR'

/**
 * Prompt 请求。
 *
 * - text: 主 prompt 文本(可多行)
 * - style: 风格提示(可选,如 'cinematic' / 'anime' / 'oil-painting')
 * - referenceImages: 参考图 assetId 列表(可选,后续 LLM 多模态接入用)
 */
export interface PromptRequest {
  text: string
  style?: string
  referenceImages?: string[]
}

/**
 * 解析结果元数据(用于 UI 反馈与审计)。
 */
export interface ParseResultMetadata {
  /** 置信度 0-1,< 0.5 时建议用户确认 */
  confidence: number
  /** 来源:'rule' = 关键词快速路径,'llm' = LLM 生成 */
  source: 'rule' | 'llm'
  /** 解析耗时(ms) */
  durationMs?: number
  /** 警告信息(如部分关键词未识别) */
  warnings?: string[]
}

/**
 * Prompt 解析结果。
 *
 * - layers: 生成的 Layer 数组(已含稳定 ID / source / paramOwnership)
 * - metadata: 来源 / 置信度 / 警告
 *
 * 注意:
 * - layers 可能为空(规则未命中 + LLM 未配置),调用方需处理空数组
 * - layers 不含 Region,默认 region 由 runtime 端在插入时补充
 */
export interface ParseResult {
  layers: Layer[]
  metadata: ParseResultMetadata
}
