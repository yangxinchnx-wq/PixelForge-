/**
 * PixelForge - JSON Schema 定义（骨架 §5.5 / §8.1）
 *
 * 所有跨层输出的 JSON schema 集中定义。
 * 所有跨层数据传递必须通过 schema 校验。
 * 失败时抛出 validation error。
 *
 * Phase B 实现的 schema：
 *   - parsedIntentSchema：ParsedIntent 校验
 *   - renderIRSchema：RenderIR 基础校验（静态边界已由 validateStaticBoundary 保证）
 *
 * Phase D-E 预留：
 *   - colorBlockTreeSchema
 *   - llmOutputSchema
 *   - patchSchema（已由 patch.ts 的 validatePatch 保证）
 *   - compileResultSchema
 */

import { Opcode } from '@/shared/types'
import type { ParsedIntent } from '@/authoring/types'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { validateStaticBoundary } from '@/compiler/ir/renderIR'
import { ParseError } from '@/authoring/types'

// ============================================================================
// 1. ParsedIntent 校验
// ============================================================================

/**
 * 校验 ParsedIntent 是否合法。
 *
 * 校验规则：
 *   - layers 数组非空
 *   - 每个 layer 的 opcode 是有效值
 *   - 每个 layer 的 params 是合法 JSON 对象
 *   - 图层数量不超过 64
 *
 * @throws {ParseError} 校验失败时抛出
 */
export function validateParsedIntent(intent: ParsedIntent): void {
  if (!intent || typeof intent !== 'object') {
    throw new ParseError('VALIDATION_ERROR', 'ParsedIntent 不是对象')
  }

  if (!Array.isArray(intent.layers) || intent.layers.length === 0) {
    throw new ParseError('VALIDATION_ERROR', 'ParsedIntent.layers 为空或非数组')
  }

  if (intent.layers.length > 64) {
    throw new ParseError('VALIDATION_ERROR', `图层数量 ${intent.layers.length} 超过上限 64`)
  }

  const validOpcodes = new Set<number>(Object.values(Opcode).filter((v) => typeof v === 'number'))

  for (let i = 0; i < intent.layers.length; i++) {
    const layer = intent.layers[i]

    if (!layer || typeof layer !== 'object') {
      throw new ParseError('VALIDATION_ERROR', `layer[${i}] 不是对象`)
    }

    if (!validOpcodes.has(layer.opcode)) {
      throw new ParseError('VALIDATION_ERROR', `layer[${i}].opcode 无效: ${layer.opcode}`)
    }

    if (!layer.params || typeof layer.params !== 'object' || Array.isArray(layer.params)) {
      throw new ParseError('VALIDATION_ERROR', `layer[${i}].params 不是对象`)
    }

    // BLEND 不允许作为图层 opcode
    if (layer.opcode === Opcode.BLEND) {
      throw new ParseError('VALIDATION_ERROR', `layer[${i}].opcode 是 BLEND，已废弃为图层 opcode`)
    }
  }

  // 校验画布尺寸（如果指定）
  if (intent.canvas) {
    const { width, height } = intent.canvas
    if (!Number.isFinite(width) || width <= 0 || width > 8192) {
      throw new ParseError('VALIDATION_ERROR', `canvas.width 无效: ${width}`)
    }
    if (!Number.isFinite(height) || height <= 0 || height > 8192) {
      throw new ParseError('VALIDATION_ERROR', `canvas.height 无效: ${height}`)
    }
  }
}

// ============================================================================
// 2. RenderIR 校验
// ============================================================================

/**
 * 校验 RenderIR 是否合法。
 *
 * 校验规则：
 *   - 基础结构检查
 *   - 静态边界校验（调用 validateStaticBoundary）
 *   - 图层数量检查
 *
 * @throws {Error} 校验失败时抛出
 */
export function validateRenderIR(ir: RenderIR): void {
  if (!ir || typeof ir !== 'object') {
    throw new Error('RenderIR 不是对象')
  }

  if (!Array.isArray(ir.layers) || ir.layers.length === 0) {
    throw new Error('RenderIR.layers 为空或非数组')
  }

  if (ir.layers.length > 64) {
    throw new Error(`图层数量 ${ir.layers.length} 超过上限 64`)
  }

  if (!ir.canvas || !Number.isFinite(ir.canvas.width) || !Number.isFinite(ir.canvas.height)) {
    throw new Error('RenderIR.canvas 无效')
  }

  // 静态边界校验
  const violations = validateStaticBoundary(ir)
  if (violations.length > 0) {
    throw new Error(`RenderIR 静态边界违规: ${violations.join(', ')}`)
  }
}

// ============================================================================
// 3. Schema 标识（用于跨层校验注册）
// ============================================================================

/**
 * Schema 标识常量。
 * 用于跨层校验时标识使用的 schema 类型。
 */
export const SCHEMA_IDS = {
  PARSED_INTENT: 'pixelforge.parsedIntent.v1',
  RENDER_IR: 'pixelforge.renderIR.v1',
  PATCH: 'pixelforge.patch.v1',
  COMPILE_RESULT: 'pixelforge.compileResult.v1',
  LLM_OUTPUT: 'pixelforge.llmOutput.v1',
} as const

// ============================================================================
// 4. LLM 输出校验（骨架 §5.5 Phase E）
// ============================================================================

import type { LLMOutput, SemanticElement } from '@/authoring/llm/types'

/**
 * 校验 LLM 输出是否合法（骨架 §5.5 / 技术路线 §22.3）。
 *
 * 校验规则：
 *   - scene 是非空字符串
 *   - elements 是非空数组
 *   - 每个 element 的 type 是非空字符串
 *   - 每个 element 的 layer 是非负整数
 *   - dominantColors（如有）是 [r,g,b] 数组，值 0-255
 *
 * @throws {Error} 校验失败时抛出
 */
export function validateLLMOutput(output: unknown): asserts output is LLMOutput {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('LLM 输出不是对象')
  }

  const obj = output as Record<string, unknown>

  if (typeof obj.scene !== 'string' || obj.scene.length === 0) {
    throw new Error('LLM 输出 scene 不是非空字符串')
  }

  if (!Array.isArray(obj.elements) || obj.elements.length === 0) {
    throw new Error('LLM 输出 elements 为空或非数组')
  }

  if (obj.elements.length > 64) {
    throw new Error(`LLM 输出 elements 数量 ${obj.elements.length} 超过上限 64`)
  }

  for (let i = 0; i < obj.elements.length; i++) {
    const el = obj.elements[i]
    validateSemanticElement(el, i)
  }

  if (obj.dominantColors !== undefined) {
    if (!Array.isArray(obj.dominantColors)) {
      throw new Error('LLM 输出 dominantColors 不是数组')
    }
    for (let i = 0; i < obj.dominantColors.length; i++) {
      validateColorTuple(obj.dominantColors[i], `dominantColors[${i}]`)
    }
  }
}

/**
 * 校验单个 SemanticElement。
 */
function validateSemanticElement(el: unknown, index: number): asserts el is SemanticElement {
  if (!el || typeof el !== 'object') {
    throw new Error(`elements[${index}] 不是对象`)
  }

  const obj = el as Record<string, unknown>

  if (typeof obj.type !== 'string' || obj.type.length === 0) {
    throw new Error(`elements[${index}].type 不是非空字符串`)
  }

  if (typeof obj.layer !== 'number' || !Number.isInteger(obj.layer) || obj.layer < 0) {
    throw new Error(`elements[${index}].layer 不是非负整数`)
  }

  if (obj.color !== undefined) {
    validateColorTuple(obj.color, `elements[${index}].color`)
  }

  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new Error(`elements[${index}].description 不是字符串`)
  }
}

/**
 * 校验 [r, g, b] 颜色元组。
 */
function validateColorTuple(color: unknown, path: string): void {
  if (!Array.isArray(color) || color.length !== 3) {
    throw new Error(`${path} 不是 [r, g, b] 三元组`)
  }
  for (let i = 0; i < 3; i++) {
    if (typeof color[i] !== 'number' || color[i] < 0 || color[i] > 255) {
      throw new Error(`${path}[${i}] 不是 0-255 范围的数字`)
    }
  }
}
