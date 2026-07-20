/**
 * PixelForge - RequirementClarifier（骨架 §5.1）
 *
 * Phase B 硬编码 parser，不依赖 LLM。
 *
 * 接口：
 *   clarify(prompt: string, context?: ClarifyContext): Promise<ClarifyResult>
 *
 * 三种结果：
 *   - auto_resolved：意图明确，可直接生成 RenderIR
 *   - needs_confirmation：意图部分明确，需用户确认
 *   - rejected：意图不合法或冲突，拒绝执行
 *
 * Phase B 支持的 prompt 形式（骨架 §5.2）：
 *   - "纯色背景：红色"
 *   - "渐变：从红到蓝，垂直方向"
 *   - "圆形：中心(0.5,0.5)，半径 0.3，红色"
 *   - "噪声：缩放 24，强度 0.8"
 *   - 多行/分号分隔 = 多图层叠加
 */

import type { Opcode, JsonLiteral } from '@/shared/types'
import {
  COLOR_PRESETS,
  DIRECTION_KEYWORDS,
  BLEND_MODE_KEYWORDS,
} from '@/shared/constants'
import type {
  ParsedIntent,
  ParsedLayerIntent,
  ParsedEffectIntent,
  ClarifyContext,
  ClarifyResult,
} from '@/authoring/types'

// ============================================================================
// 1. prompt 规范化
// ============================================================================

/**
 * 规范化 prompt：去除首尾空白、合并连续空格/制表符（但保留换行符作为段分隔符）。
 */
function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/[^\S\n]+/g, ' ')
}

/**
 * 将 prompt 分割为多个段（每段描述一个图层）。
 *
 * 分割规则：
 *   - 换行符
 *   - 分号 ；或 ;
 *   - 独立的 "+" 号（前后有空白）
 *
 * 空段自动跳过。
 */
function splitSegments(prompt: string): string[] {
  return prompt
    .split(/[\n;；]|\s*\+\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// ============================================================================
// 2. 颜色解析
// ============================================================================

/**
 * 从文本中解析颜色。
 *
 * 支持格式：
 *   - 颜色名（中文/英文）：红、red、深蓝
 *   - RGBA 数组：[0.9, 0.1, 0.1, 1]
 *   - 十六进制：#ff0000 或 ff0000
 *
 * @returns [r, g, b, a] 或 null（无法解析）
 */
function parseColor(text: string): [number, number, number, number] | null {
  const trimmed = text.trim()

  // 尝试颜色名
  const preset = COLOR_PRESETS[trimmed]
  if (preset) return preset

  // 尝试颜色名（带"色"后缀）
  const withSuffix = COLOR_PRESETS[trimmed + '色']
  if (withSuffix) return withSuffix

  // 尝试 RGBA 数组 [r, g, b, a]
  const arrayMatch = trimmed.match(/^\[?\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\]?$/)
  if (arrayMatch) {
    const r = parseFloat(arrayMatch[1])
    const g = parseFloat(arrayMatch[2])
    const b = parseFloat(arrayMatch[3])
    const a = arrayMatch[4] !== undefined ? parseFloat(arrayMatch[4]) : 1
    if ([r, g, b, a].every((v) => Number.isFinite(v))) {
      return [r, g, b, a]
    }
  }

  // 尝试十六进制 #rrggbb
  const hexMatch = trimmed.match(/^#?([0-9a-f]{6})$/i)
  if (hexMatch) {
    const hex = hexMatch[1]
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255
    return [r, g, b, 1]
  }

  return null
}

// ============================================================================
// 3. 数值解析
// ============================================================================

/**
 * 从文本中提取第一个有效数值。
 */
function parseNumber(text: string): number | null {
  const match = text.match(/-?\d*\.?\d+/)
  if (match) {
    const n = parseFloat(match[0])
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * 从文本中提取坐标对 (x, y)。
 * 支持 "(0.5, 0.3)" / "0.5, 0.3" / "中心(0.5,0.3)" 等。
 */
function parseVec2(text: string): [number, number] | null {
  const match = text.match(/\(?\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)?/)
  if (match) {
    const x = parseFloat(match[1])
    const y = parseFloat(match[2])
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y]
    }
  }
  return null
}

// ============================================================================
// 4. 各 opcode 的 prompt 解析
// ============================================================================

/**
 * 解析"纯色"图层。
 *
 * 支持形式：
 *   - "纯色：红色"
 *   - "纯色背景：蓝色"
 *   - "solid: red"
 *   - "背景：黑色"
 */
function parseSolidColor(segment: string): ParsedLayerIntent | null {
  // 匹配纯色关键词
  const isSolidColor = /^(纯色|纯色背景|背景|solid|background)\s*[:：]\s*(.+)$/i.test(segment)
  if (!isSolidColor) return null

  // 提取颜色部分
  const colorPart = segment.replace(/^(纯色|纯色背景|背景|solid|background)\s*[:：]\s*/i, '')
  const color = parseColor(colorPart)
  if (!color) return null

  return {
    opcode: 0 satisfies Opcode, // Opcode.SOLID_COLOR = 0
    params: { color: color as unknown as JsonLiteral },
    blendMode: 'normal',
    label: '纯色图层',
  }
}

/**
 * 解析"渐变"图层。
 *
 * 支持形式：
 *   - "渐变：从红到蓝，垂直方向"
 *   - "渐变：从红到蓝"
 *   - "gradient: from red to blue, vertical"
 */
function parseGradient(segment: string): ParsedLayerIntent | null {
  const isGradient = /^(渐变|gradient)\s*[:：]\s*(.+)$/i.test(segment)
  if (!isGradient) return null

  const content = segment.replace(/^(渐变|gradient)\s*[:：]\s*/i, '')

  // 提取"从X到Y"模式
  const fromToMatch = content.match(/从\s*(\S+?)\s*到\s*(\S+?)(?:[，,]|$)/)
  let colorA: [number, number, number, number] | null = null
  let colorB: [number, number, number, number] | null = null

  if (fromToMatch) {
    colorA = parseColor(fromToMatch[1])
    colorB = parseColor(fromToMatch[2])
  } else {
    // 尝试 "red to blue" 英文模式
    const enMatch = content.match(/(\S+?)\s+to\s+(\S+?)(?:[，,]|$)/i)
    if (enMatch) {
      colorA = parseColor(enMatch[1])
      colorB = parseColor(enMatch[2])
    }
  }

  // 默认颜色
  if (!colorA) colorA = [0.15, 0.35, 0.95, 1]
  if (!colorB) colorB = [0.92, 0.38, 0.66, 1]

  // 提取方向
  let from: [number, number] = [0, 0]
  let to: [number, number] = [1, 1]
  for (const [keyword, coords] of Object.entries(DIRECTION_KEYWORDS)) {
    if (content.includes(keyword)) {
      from = [coords[0], coords[1]]
      to = [coords[2], coords[3]]
      break
    }
  }

  return {
    opcode: 1 satisfies Opcode, // Opcode.LINEAR_GRADIENT = 1
    params: {
      from: from as unknown as JsonLiteral,
      to: to as unknown as JsonLiteral,
      colorA: colorA as unknown as JsonLiteral,
      colorB: colorB as unknown as JsonLiteral,
    },
    blendMode: 'normal',
    label: '渐变图层',
  }
}

/**
 * 解析"圆形"图层。
 *
 * 支持形式：
 *   - "圆形：中心(0.5,0.5)，半径0.3，红色"
 *   - "circle: center(0.5,0.5), radius 0.3, red"
 */
function parseCircle(segment: string): ParsedLayerIntent | null {
  const isCircle = /^(圆形|圆|circle)\s*[:：]\s*(.+)$/i.test(segment)
  if (!isCircle) return null

  const content = segment.replace(/^(圆形|圆|circle)\s*[:：]\s*/i, '')

  // 提取中心坐标
  const center = parseVec2(content) ?? [0.5, 0.5]

  // 提取半径
  const radiusMatch = content.match(/半径\s*(\d*\.?\d+)|radius\s*(\d*\.?\d+)/i)
  const radius = radiusMatch
    ? parseFloat(radiusMatch[1] || radiusMatch[2])
    : 0.25

  // 提取填充颜色（在最后一个颜色词处）
  const colorPart = content.replace(/中心\s*\(.*?\)|半径\s*\d*\.?\d+|radius\s*\d*\.?\d+|circle|圆形|圆/gi, '').trim()
    .replace(/^[，,]+/, '').trim()
  const fill = parseColor(colorPart) ?? [0.95, 0.73, 0.18, 1]
  const background: [number, number, number, number] = [0, 0, 0, 0]

  return {
    opcode: 4 satisfies Opcode, // Opcode.CIRCLE_SHAPE = 4
    params: {
      center: center as unknown as JsonLiteral,
      radius: radius as unknown as JsonLiteral,
      fill: fill as unknown as JsonLiteral,
      background: background as unknown as JsonLiteral,
    },
    blendMode: 'normal',
    label: '圆形图层',
  }
}

/**
 * 解析"噪声"图层。
 *
 * 支持形式：
 *   - "噪声：缩放24，强度0.8"
 *   - "noise: scale 24, amount 0.8"
 */
function parseNoise(segment: string): ParsedLayerIntent | null {
  const isNoise = /^(噪声|噪音|noise)\s*[:：]\s*(.+)$/i.test(segment)
  if (!isNoise) return null

  const content = segment.replace(/^(噪声|噪音|noise)\s*[:：]\s*/i, '')

  const scaleMatch = content.match(/缩放\s*(\d*\.?\d+)|scale\s*(\d*\.?\d+)/i)
  const scale = scaleMatch ? parseFloat(scaleMatch[1] || scaleMatch[2]) : 24

  const amountMatch = content.match(/强度\s*(\d*\.?\d+)|amount\s*(\d*\.?\d+)/i)
  const amount = amountMatch ? parseFloat(amountMatch[1] || amountMatch[2]) : 1

  return {
    opcode: 2 satisfies Opcode, // Opcode.NOISE = 2
    params: {
      scale: scale as unknown as JsonLiteral,
      amount: amount as unknown as JsonLiteral,
      colorA: [0.08, 0.11, 0.2, 1] as unknown as JsonLiteral,
      colorB: [0.74, 0.85, 0.98, 1] as unknown as JsonLiteral,
    },
    blendMode: 'normal',
    label: '噪声图层',
  }
}

// ============================================================================
// 5. 混合模式解析
// ============================================================================

/**
 * 从文本中提取混合模式。
 * 如果找到匹配的关键词，返回对应的 BlendMode；否则返回 null。
 */
function parseBlendMode(text: string): string | null {
  for (const [keyword, mode] of Object.entries(BLEND_MODE_KEYWORDS)) {
    if (text.includes(keyword)) {
      return mode
    }
  }
  return null
}

// ============================================================================
// 6. 效果解析
// ============================================================================

/**
 * 尝试解析效果描述。
 *
 * 支持形式：
 *   - "效果：模糊，半径0.005"
 *   - "effect: blur, radius 0.005"
 *   - "模糊：半径0.005"
 *   - "晕影：强度0.5"
 */
function parseEffect(segment: string): ParsedEffectIntent | null {
  const effectMatch = segment.match(/^(?:效果|effect)\s*[:：]\s*(.+)$/i)
  const directMatch = segment.match(/^(模糊|blur|泛光|bloom|晕影|vignette|色彩偏移|color_shift|遮罩|mask)\s*[:：]\s*(.+)$/i)

  let effectType = ''
  let content = ''

  if (effectMatch) {
    content = effectMatch[1]
    // 提取效果类型名
    const typeMatch = content.match(/^(模糊|blur|泛光|bloom|晕影|vignette|色彩偏移|color_shift|遮罩|mask)/i)
    if (typeMatch) {
      effectType = normalizeEffectType(typeMatch[1])
      content = content.substring(typeMatch[1].length).replace(/^[，,]\s*/, '')
    }
  } else if (directMatch) {
    effectType = normalizeEffectType(directMatch[1])
    content = directMatch[2]
  } else {
    return null
  }

  if (!effectType) return null

  // 中文参数名 → 英文参数名映射
  const PARAM_NAME_MAP: Record<string, string> = {
    '半径': 'radius',
    '强度': 'strength',
    '阈值': 'threshold',
    '缩放': 'scale',
    '中心X': 'centerX',
    '中心Y': 'centerY',
    '偏移': 'shift',
    '量': 'amount',
  }

  // 解析效果参数
  const params: Record<string, JsonLiteral> = {}
  const parts = content.split(/[，,]/).map((s) => s.trim()).filter((s) => s.length > 0)
  for (const part of parts) {
    // 尝试 "key: value" 或 "key：value" 格式
    const kvMatch = part.match(/^(.+?)\s*[:：]\s*(.+)$/)
    if (kvMatch) {
      const rawKey = kvMatch[1].trim()
      const key = PARAM_NAME_MAP[rawKey] ?? rawKey
      const val = parseNumber(kvMatch[2].trim())
      if (val !== null) params[key] = val as JsonLiteral
      continue
    }
    // 尝试 "中文关键词 + 数字" 格式（如 "半径0.005" / "强度0.5"）
    const knMatch = part.match(/^([\u4e00-\u9fa5a-zA-Z_]+)\s*(\d*\.?\d+)$/)
    if (knMatch) {
      const rawKey = knMatch[1].trim()
      const key = PARAM_NAME_MAP[rawKey] ?? rawKey
      const val = parseFloat(knMatch[2])
      if (Number.isFinite(val)) params[key] = val as JsonLiteral
    }
  }

  return {
    type: effectType,
    params,
  }
}

function normalizeEffectType(name: string): string {
  const lower = name.trim().toLowerCase()
  const map: Record<string, string> = {
    '模糊': 'blur', 'blur': 'blur',
    '泛光': 'bloom', 'bloom': 'bloom',
    '晕影': 'vignette', 'vignette': 'vignette',
    '色彩偏移': 'color_shift', 'color_shift': 'color_shift',
    '遮罩': 'mask', 'mask': 'mask',
  }
  return map[lower] ?? ''
}

// ============================================================================
// 7. 单段解析
// ============================================================================

/**
 * 尝试解析单个段为图层或效果。
 *
 * @returns ParsedLayerIntent | ParsedEffectIntent | null
 */
function parseSegment(segment: string): ParsedLayerIntent | ParsedEffectIntent | null {
  // 先尝试效果
  const effect = parseEffect(segment)
  if (effect) return effect

  // 尝试各 opcode
  const solid = parseSolidColor(segment)
  if (solid) return solid

  const gradient = parseGradient(segment)
  if (gradient) return gradient

  const circle = parseCircle(segment)
  if (circle) return circle

  const noise = parseNoise(segment)
  if (noise) return noise

  return null
}

// ============================================================================
// 8. 主接口 — clarify
// ============================================================================

/**
 * RequirementClarifier 主接口（骨架 §5.1）。
 *
 * @param prompt - 用户输入的文本 prompt
 * @param context - 可选的澄清上下文
 * @returns ClarifyResult（三态）
 */
export async function clarify(
  prompt: string,
  _context?: ClarifyContext,
): Promise<ClarifyResult> {
  // 空输入
  if (!prompt || prompt.trim().length === 0) {
    return { status: 'rejected', reason: 'prompt 为空' }
  }

  const normalized = normalizePrompt(prompt)
  const segments = splitSegments(normalized)

  if (segments.length === 0) {
    return { status: 'rejected', reason: '无法从 prompt 中提取有效内容' }
  }

  // 逐段解析
  const layers: ParsedLayerIntent[] = []
  const effects: ParsedEffectIntent[] = []
  const unknownSegments: string[] = []
  const warnings: string[] = []

  for (const segment of segments) {
    const parsed = parseSegment(segment)
    if (!parsed) {
      unknownSegments.push(segment)
      continue
    }
    if ('opcode' in parsed) {
      // 检查是否有混合模式关键词在段中
      const blendMode = parseBlendMode(segment)
      if (blendMode) {
        parsed.blendMode = blendMode as ParsedLayerIntent['blendMode']
      }
      layers.push(parsed)
    } else {
      effects.push(parsed)
    }
  }

  // 没有任何图层
  if (layers.length === 0) {
    return {
      status: 'rejected',
      reason: `无法从 prompt 中解析出任何图层。未识别的段：${unknownSegments.join('; ')}`,
    }
  }

  // 有未识别段但至少有 1 个图层 → needs_confirmation
  if (unknownSegments.length > 0) {
    const intent: ParsedIntent = {
      layers,
      effects: effects.length > 0 ? effects : undefined,
      rawPrompt: prompt,
    }
    return {
      status: 'needs_confirmation',
      intent,
      questions: [
        `以下内容无法识别，将被忽略：${unknownSegments.join('; ')}`,
        `已解析 ${layers.length} 个图层${effects.length > 0 ? `和 ${effects.length} 个效果` : ''}，是否继续？`,
      ],
    }
  }

  // 全部解析成功 → auto_resolved
  if (layers.length > 4) {
    warnings.push(`图层数量较多（${layers.length}），可能影响渲染性能`)
  }

  const intent: ParsedIntent = {
    layers,
    effects: effects.length > 0 ? effects : undefined,
    rawPrompt: prompt,
  }

  return {
    status: 'auto_resolved',
    intent,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}
