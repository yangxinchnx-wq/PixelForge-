/**
 * PixelForge - 规则 Parser（骨架 §5.2，Phase B）
 *
 * Phase B 硬编码 parser，不依赖 LLM。
 *
 * 接口：
 *   parse(intent: ParsedIntent): RenderIR
 *
 * 职责：
 *   - 将 ParsedIntent 转换为完整 RenderIR
 *   - 生成稳定 ID（使用 stableLayerId / stableRegionId / stableEffectId）
 *   - 填充 source = 'rule_parser'（骨架 §4.1.4）
 *   - 填充 paramOwnership = 'l2_parser'（骨架 §4.1.5）
 *   - 创建默认区域（全画布覆盖）
 *   - 设置默认 canvas 和 compileHints
 *
 * 数据流（骨架 §7.2 Phase B）：
 *   text prompt → RequirementClarifier → ParsedIntent → ruleParser → RenderIR → L1 → L0 → 画面
 */

import type {
  RenderIR,
  Layer,
  Region,
  Effect,
} from '@/compiler/ir/renderIR'
import { stableLayerId, stableRegionId, stableEffectId } from '@/shared/ids'
import { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT } from '@/shared/constants'
import type {
  ParsedIntent,
  ParsedLayerIntent,
  ParsedEffectIntent,
} from '@/authoring/types'
import { ParseError } from '@/authoring/types'

// ============================================================================
// 1. 图层转换
// ============================================================================

/**
 * 将单个 ParsedLayerIntent 转换为完整 Layer。
 *
 * - 生成稳定 ID（基于 source + opcode + params 内容）
 * - 填充 source = 'rule_parser'
 * - 填充 paramOwnership（所有参数 owner = 'l2_parser'）
 * - 默认 visible = true
 */
function parseLayer(intent: ParsedLayerIntent, index: number): Layer {
  // 生成稳定 ID：source + index + opcode + params 摘要
  const contentKey = `${index}_${intent.opcode}_${JSON.stringify(intent.params)}`
  const id = stableLayerId('rule_parser', contentKey)

  // 构造 paramOwnership：所有参数 owner = 'l2_parser'
  const paramOwnership: Record<string, 'l2_parser'> = {}
  for (const key of Object.keys(intent.params)) {
    paramOwnership[key] = 'l2_parser'
  }

  return {
    id,
    opcode: intent.opcode,
    params: intent.params,
    source: 'rule_parser',
    paramOwnership,
    visible: true,
    blendMode: intent.blendMode ?? 'normal',
  }
}

// ============================================================================
// 2. 效果转换
// ============================================================================

/**
 * 将单个 ParsedEffectIntent 转换为完整 Effect。
 */
function parseEffect(intent: ParsedEffectIntent, index: number): Effect {
  const contentKey = `${index}_${intent.type}_${JSON.stringify(intent.params)}`
  const id = stableEffectId('rule_parser', contentKey)

  return {
    id,
    type: intent.type,
    params: intent.params,
    targetLayer: intent.targetLayer,
    targetRegion: intent.targetRegion,
  }
}

// ============================================================================
// 3. 默认区域生成
// ============================================================================

/**
 * 为所有图层创建一个覆盖全画布的默认区域。
 *
 * 规则：
 *   - 区域 bounds = { x: 0, y: 0, width: 1, height: 1 }（归一化全画布）
 *   - layerRefs 包含所有图层 ID
 *   - source = 'rule_parser'
 */
function createDefaultRegion(layerIds: string[]): Region {
  return {
    id: stableRegionId('rule_parser', 'default_full_canvas'),
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    layerRefs: [...layerIds],
    source: 'rule_parser',
  }
}

// ============================================================================
// 4. 主接口 — parse
// ============================================================================

/**
 * 规则 Parser 主接口（骨架 §5.2）。
 *
 * @param intent - 来自 RequirementClarifier 的 ParsedIntent
 * @returns 完整的 RenderIR
 * @throws {ParseError} 当 intent 无效时抛出
 */
export function parse(intent: ParsedIntent): RenderIR {
  // 校验 intent
  if (!intent.layers || intent.layers.length === 0) {
    throw new ParseError('PARSE_ERROR', 'ParsedIntent 不含任何图层')
  }

  // 检查最大图层数
  if (intent.layers.length > 64) {
    throw new ParseError('PARSE_ERROR', `图层数量 ${intent.layers.length} 超过上限 64`)
  }

  // 转换图层
  const layers: Layer[] = intent.layers.map((li, i) => parseLayer(li, i))

  // 转换效果
  const effects: Effect[] = (intent.effects ?? []).map((ei, i) => parseEffect(ei, i))

  // 创建默认区域（全画布覆盖）
  const regions: Region[] = [createDefaultRegion(layers.map((l) => l.id))]

  // 构造 RenderIR
  const ir: RenderIR = {
    canvas: intent.canvas ?? { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT },
    layers,
    regions,
    effects,
    compileHints: { preferredProfile: 'region' },
  }

  return ir
}
