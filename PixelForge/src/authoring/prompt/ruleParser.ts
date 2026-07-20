/**
 * 关键词快速路径 Parser(Step 22)。
 *
 * 与已有的 clarify + ruleParser(IR)路径不同,这里:
 * - 输入:自由文本 prompt(不要求"纯色：红色"格式)
 * - 输出:Layer[](不是完整 RenderIR)
 * - 策略:关键词命中即生成对应 layer,可叠加多个
 *
 * 支持的关键词(Phase B 占位,后续可扩展):
 *   - "星空" / "星"      → NOISE layer(蓝色调,密集)
 *   - "漩涡" / "银河"    → NOISE layer(紫色调,中等密度)+ 旋转参数
 *   - "渐变" / "gradient" → LINEAR_GRADIENT layer
 *   - "圆形" / "球"      → CIRCLE_SHAPE layer
 *   - "纯色" / "背景"    → SOLID_COLOR layer
 *   - 颜色关键词(红/蓝/绿/黄/紫...)→ 影响上述 layer 的 color 参数
 *
 * 未命中任何关键词时返回空数组(由调用方决定是否走 LLM 路径)。
 */

import type { Layer } from '@/compiler/ir/renderIR'
import type { JsonLiteral } from '@/shared/types'
import { Opcode } from '@/shared/types'
import { stableLayerId } from '@/shared/ids'
import { COLOR_PRESETS } from '@/shared/constants'

import type { LlmLayerOutput } from './schema'

/**
 * 关键词解析结果。
 * - layers: 生成的 Layer 数组(已含稳定 ID)
 * - warnings: 未识别的关键词(可选,用于 UI 反馈)
 */
export interface RuleParseResult {
  layers: Layer[]
  warnings: string[]
}

/**
 * 从文本中提取颜色。
 * 支持:红/蓝/绿/黄/紫/橙(中文)+ red/blue/...(英文)+ #hex + [r,g,b,a] 数组。
 * @returns [r, g, b, a] 或 null
 */
function extractColor(text: string): [number, number, number, number] | null {
  // 1. 颜色名(中文/英文)
  for (const [name, rgba] of Object.entries(COLOR_PRESETS)) {
    if (text.includes(name)) return rgba
  }

  // 2. 十六进制 #rrggbb
  const hexMatch = text.match(/#([0-9a-fA-F]{6})\b/)
  if (hexMatch) {
    const hex = hexMatch[1]
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      1,
    ]
  }

  // 3. [r, g, b, a] 数组
  const arrMatch = text.match(/\[\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,]+([0-9.]+))?\s*\]/)
  if (arrMatch) {
    const [, r, g, b, a] = arrMatch
    return [
      Number(r),
      Number(g),
      Number(b),
      a !== undefined ? Number(a) : 1,
    ]
  }

  return null
}

/** 构造 Layer 的工厂(填充稳定 ID / source / paramOwnership) */
function makeLayer(
  opcode: Opcode,
  params: Record<string, JsonLiteral>,
  label: string,
  index: number,
): Layer {
  const contentKey = `${index}_${opcode}_${label}_${JSON.stringify(params)}`
  const id = stableLayerId('rule_prompt', contentKey)
  const paramOwnership: Record<string, 'l2_parser'> = {}
  for (const key of Object.keys(params)) {
    paramOwnership[key] = 'l2_parser'
  }
  return {
    id,
    opcode,
    params,
    source: 'rule_parser',
    paramOwnership,
    visible: true,
    blendMode: 'normal',
  }
}

/**
 * 关键词快速解析。
 *
 * @param prompt 用户输入文本
 * @returns layers + warnings(未识别的关键词提示)
 */
export function ruleParse(prompt: string): RuleParseResult {
  const text = prompt.toLowerCase()
  const layers: Layer[] = []
  const warnings: string[] = []

  // 提取颜色(供后续 layer 复用)
  const color = extractColor(prompt)

  let index = 0

  // —— 星空 / 星 ——
  if (text.includes('星空') || text.includes('星星') || text.includes('star')) {
    layers.push(
      makeLayer(
        Opcode.NOISE,
        {
          scale: 32,
          amount: 0.85,
          colorA: color ?? [0.08, 0.11, 0.25, 1],
          colorB: [1, 1, 1, 1],  // 白色亮点
        },
        '星空',
        index++,
      ),
    )
  }

  // —— 漩涡 / 银河 ——
  if (text.includes('漩涡') || text.includes('银河') || text.includes('galaxy') || text.includes('spiral')) {
    layers.push(
      makeLayer(
        Opcode.NOISE,
        {
          scale: 18,
          amount: 0.6,
          colorA: color ?? [0.3, 0.1, 0.5, 1],  // 紫色
          colorB: [0.95, 0.85, 0.3, 1],  // 金色高光
        },
        '漩涡',
        index++,
      ),
    )
  }

  // —— 渐变 ——
  if (text.includes('渐变') || text.includes('gradient')) {
    layers.push(
      makeLayer(
        Opcode.LINEAR_GRADIENT,
        {
          from: [0, 0],
          to: [1, 1],
          colorA: color ?? [0.1, 0.2, 0.9, 1],
          colorB: [0.85, 0.35, 0.6, 1],
        },
        '渐变',
        index++,
      ),
    )
  }

  // —— 圆形 / 球 ——
  if (text.includes('圆形') || text.includes('球') || text.includes('circle') || text.includes('sphere')) {
    layers.push(
      makeLayer(
        Opcode.CIRCLE_SHAPE,
        {
          center: [0.5, 0.5],
          radius: 0.25,
          color: color ?? [0.95, 0.85, 0.15, 1],
        },
        '圆形',
        index++,
      ),
    )
  }

  // —— 纯色 / 背景 ——
  if (text.includes('纯色') || text.includes('背景') || text.includes('solid') || text.includes('background')) {
    layers.push(
      makeLayer(
        Opcode.SOLID_COLOR,
        {
          color: color ?? [0.15, 0.35, 0.95, 1],
        },
        '纯色背景',
        index++,
      ),
    )
  }

  // —— 未命中任何关键词 ——
  if (layers.length === 0) {
    warnings.push('未识别到任何关键词(支持:星空/漩涡/渐变/圆形/纯色)')
  }

  // —— 颜色未识别但 prompt 提到了颜色字 ——
  if (!color && (text.includes('色') || text.includes('color'))) {
    warnings.push('提到颜色但未识别到具体色值(支持:红/蓝/绿/黄/紫/#hex/[r,g,b,a])')
  }

  return { layers, warnings }
}

/**
 * 把 LLM 输出的单图层转换为完整 Layer(供 llmParser 使用)。
 *
 * 与 makeLayer 类似,但 source = 'llm_parser',ID 也基于 'llm_prompt' 前缀。
 */
export function llmOutputToLayer(output: LlmLayerOutput, index: number): Layer {
  // 引入 opcodeNameToValue 会形成循环依赖,这里通过函数参数注入更干净
  // 但为了简单起见,直接内联转换表
  const opcodeMap: Record<string, Opcode> = {
    SOLID_COLOR: Opcode.SOLID_COLOR,
    LINEAR_GRADIENT: Opcode.LINEAR_GRADIENT,
    NOISE: Opcode.NOISE,
    CIRCLE_SHAPE: Opcode.CIRCLE_SHAPE,
    IMAGE_TEXTURE: Opcode.IMAGE_TEXTURE,
  }
  const opcode = opcodeMap[output.opcode]
  if (opcode === undefined) {
    throw new Error(`未知 opcode 名: ${output.opcode}`)
  }

  const label = output.label ?? `LLM 图层 ${index}`
  const contentKey = `${index}_${opcode}_${label}_${JSON.stringify(output.params)}`
  const id = stableLayerId('llm_prompt', contentKey)
  const paramOwnership: Record<string, 'l2_parser'> = {}
  for (const key of Object.keys(output.params)) {
    paramOwnership[key] = 'l2_parser'
  }

  return {
    id,
    opcode,
    params: output.params,
    source: 'llm_parser',
    paramOwnership,
    visible: true,
    blendMode: output.blendMode ?? 'normal',
  }
}
