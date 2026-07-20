/**
 * LLM 输出 JSON Schema(Step 22)。
 *
 * 用于校验 LLM 返回的 JSON 是否符合 PixelForge 期望的结构。
 *
 * 设计原则:
 * - 不依赖外部 ajv / json-schema 库,内联最小校验器(项目零额外依赖)
 * - Schema 既作为文档(描述 LLM 应输出什么),也作为运行时校验器
 * - 校验失败时抛出 ParseError(与已有 authoring/types 的错误类型一致)
 *
 * 期望 LLM 输出格式:
 * {
 *   "layers": [
 *     {
 *       "opcode": "SOLID_COLOR" | "LINEAR_GRADIENT" | "NOISE" | "CIRCLE_SHAPE" | "IMAGE_TEXTURE",
 *       "params": { ... },
 *       "blendMode"?: "normal" | "multiply" | "screen" | "overlay" | "add" | "subtract",
 *       "label"?: string
 *     }
 *   ]
 * }
 *
 * 注意:
 * - LLM 输出的 layer 不需要 id(由本模块生成稳定 ID)
 * - opcode 用字符串名(不是数值),更符合 LLM 输出习惯
 * - 校验通过后由 llmParser 转换为完整 Layer
 */

import { Opcode } from '@/shared/types'
import type { BlendMode, JsonLiteral } from '@/shared/types'
import { ParseError } from '@/authoring/types'

/** Schema 标识(用于日志和审计) */
export const PROMPT_LLM_SCHEMA_ID = 'pixelforge.prompt.llmOutput.v1' as const

/** LLM 输出中允许的 opcode 字符串名 → 数值枚举 */
const OPCODE_NAME_TO_VALUE: Record<string, number> = {
  SOLID_COLOR: Opcode.SOLID_COLOR,
  LINEAR_GRADIENT: Opcode.LINEAR_GRADIENT,
  NOISE: Opcode.NOISE,
  CIRCLE_SHAPE: Opcode.CIRCLE_SHAPE,
  IMAGE_TEXTURE: Opcode.IMAGE_TEXTURE,
}

/** LLM 输出中允许的 blendMode 字符串 */
const VALID_BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'add',
  'subtract',
]

/**
 * LLM 输出的单图层结构(opcode 用字符串名)。
 */
export interface LlmLayerOutput {
  opcode: string
  params: Record<string, JsonLiteral>
  blendMode?: BlendMode
  label?: string
}

/**
 * LLM 输出的完整结构。
 */
export interface LlmOutput {
  layers: LlmLayerOutput[]
}

/**
 * 校验 LLM 返回的 JSON 是否符合 prompt.llmOutput.v1 schema。
 *
 * 校验项:
 * - 顶层是对象,含 layers 数组
 * - layers 非空,长度 <= MAX_LAYERS(64)
 * - 每个 layer 含 opcode(字符串名)和 params(对象)
 * - opcode 必须在白名单内
 * - blendMode(若提供)必须在白名单内
 *
 * @throws {ParseError} 校验失败
 */
export function validateLlmOutput(raw: unknown): asserts raw is LlmOutput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ParseError('SCHEMA_VIOLATION', 'LLM 输出不是对象')
  }

  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.layers)) {
    throw new ParseError('SCHEMA_VIOLATION', 'LLM 输出缺少 layers 数组')
  }

  if (obj.layers.length === 0) {
    throw new ParseError('SCHEMA_VIOLATION', 'LLM 输出 layers 为空')
  }

  if (obj.layers.length > 64) {
    throw new ParseError(
      'SCHEMA_VIOLATION',
      `LLM 输出 layers 数量 ${obj.layers.length} 超过上限 64`,
    )
  }

  for (let i = 0; i < obj.layers.length; i += 1) {
    const layer = obj.layers[i]
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
      throw new ParseError('SCHEMA_VIOLATION', `layers[${i}] 不是对象`)
    }

    const l = layer as Record<string, unknown>

    // opcode 必须是字符串且在白名单
    if (typeof l.opcode !== 'string') {
      throw new ParseError('SCHEMA_VIOLATION', `layers[${i}].opcode 不是字符串`)
    }
    if (!(l.opcode in OPCODE_NAME_TO_VALUE)) {
      throw new ParseError(
        'SCHEMA_VIOLATION',
        `layers[${i}].opcode "${l.opcode}" 不在白名单(允许: ${Object.keys(OPCODE_NAME_TO_VALUE).join(', ')})`,
      )
    }

    // params 必须是对象
    if (!l.params || typeof l.params !== 'object' || Array.isArray(l.params)) {
      throw new ParseError('SCHEMA_VIOLATION', `layers[${i}].params 不是对象`)
    }

    // blendMode(若提供)必须在白名单
    if (l.blendMode !== undefined) {
      if (typeof l.blendMode !== 'string' || !VALID_BLEND_MODES.includes(l.blendMode as BlendMode)) {
        throw new ParseError(
          'SCHEMA_VIOLATION',
          `layers[${i}].blendMode "${l.blendMode}" 不在白名单`,
        )
      }
    }

    // label(若提供)必须是字符串
    if (l.label !== undefined && typeof l.label !== 'string') {
      throw new ParseError('SCHEMA_VIOLATION', `layers[${i}].label 不是字符串`)
    }
  }
}

/**
 * 把 LLM 输出的 opcode 字符串名转换为 Opcode 数值。
 *
 * @throws {ParseError} opcode 名无效(理论上 validateLlmOutput 已校验,这里做防御性检查)
 */
export function opcodeNameToValue(name: string): number {
  const value = OPCODE_NAME_TO_VALUE[name]
  if (value === undefined) {
    throw new ParseError('SCHEMA_VIOLATION', `未知 opcode 名: ${name}`)
  }
  return value
}

/**
 * Schema 文档对象(供 UI 展示 / LLM prompt 注入)。
 * 不参与运行时校验,只是元信息。
 */
export const PROMPT_LLM_SCHEMA_DOC = {
  $id: PROMPT_LLM_SCHEMA_ID,
  type: 'object',
  required: ['layers'],
  properties: {
    layers: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        required: ['opcode', 'params'],
        properties: {
          opcode: {
            type: 'string',
            enum: Object.keys(OPCODE_NAME_TO_VALUE),
          },
          params: {
            type: 'object',
          },
          blendMode: {
            type: 'string',
            enum: VALID_BLEND_MODES,
          },
          label: {
            type: 'string',
          },
        },
      },
    },
  },
} as const
