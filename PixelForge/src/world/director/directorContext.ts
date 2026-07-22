/**
 * Director Context Engine(Step 36.1)— 将当前 RenderIR 状态序列化为 LLM 上下文。
 *
 * 职责:
 * - 把当前 RenderIR(图层/区域/效果/时间轴)序列化为紧凑的文本摘要
 * - 让 AI Director "看见" 当前画面状态,从而做上下文感知的决策
 * - 支持 create 模式(描述现有画面)和 modify 模式(描述可修改的参数)
 *
 * 输出格式示例:
 *   当前画面状态:
 *   - 画布: 1920×1080
 *   - 图层数: 3
 *     [0] id=layer_a3f2 opcode=SOLID_COLOR color=[1,0,0,1] visible=true blendMode=normal
 *     [1] id=layer_b1c3 opcode=LINEAR_GRADIENT color=[0,0,1,1] color2=[1,1,0,1] visible=true
 *     [2] id=layer_c5d6 opcode=NOISE scale=0.5 intensity=0.8 visible=false
 *   - 效果数: 1
 *     [0] id=eff_01 type=vignette targetLayer=layer_a3f2 intensity=0.6
 *   - 时间轴: 未加载
 *
 * 不职责:
 * - 不做 LLM 调用(纯序列化)
 * - 不修改 RenderIR(只读)
 */
import type { RenderIR, Layer, Effect } from '@/compiler/ir/renderIR'
import type { TimelineContent } from '@/world/types'
import { Opcode } from '@/shared/types'

// ============================================================================
// 1. 上下文摘要接口
// ============================================================================

/**
 * Director 上下文摘要。
 *
 * 包含当前画面状态的文本描述,供 LLM 系统提示词使用。
 */
export interface DirectorContext {
  /** 完整的文本摘要(可直接拼入 system prompt) */
  summary: string
  /** 画布尺寸 */
  canvasSize: { width: number; height: number }
  /** 图层数量 */
  layerCount: number
  /** 效果数量 */
  effectCount: number
  /** 是否有活跃时间轴 */
  hasTimeline: boolean
  /** 可修改的参数清单(供 modify 模式参考) */
  modifiableParams: ModifiableParam[]
}

/**
 * 可修改的参数描述。
 */
export interface ModifiableParam {
  /** 目标实体类型 */
  targetEntity: 'layer' | 'effect'
  /** 目标实体 ID */
  targetId: string
  /** 参数键 */
  paramKey: string
  /** 当前值 */
  currentValue: unknown
  /** 参数描述(人类可读) */
  description: string
}

// ============================================================================
// 2. 参数描述映射
// ============================================================================

/** 图层 opcode 的中文描述 */
const OPCODE_DESCRIPTION: Record<string, string> = {
  SOLID_COLOR: '纯色填充',
  LINEAR_GRADIENT: '线性渐变',
  RADIAL_GRADIENT: '径向渐变',
  NOISE: '噪声纹理',
  CIRCLE_SHAPE: '圆形形状',
  IMAGE_TEXTURE: '图片纹理',
}

/** 图层参数的中文描述 */
const LAYER_PARAM_DESCRIPTION: Record<string, string> = {
  color: '主颜色 RGBA (0-1)',
  color2: '渐变终止色 RGBA (0-1)',
  angle: '渐变角度 (度)',
  scale: '缩放 (0-1)',
  intensity: '强度 (0-1)',
  radius: '半径 (0-1)',
  seed: '随机种子',
  position: '位置 [x, y] (0-1)',
}

/** 效果参数的中文描述 */
const EFFECT_PARAM_DESCRIPTION: Record<string, string> = {
  intensity: '强度 (0-1)',
  radius: '半径/模糊核大小',
  color: '颜色 RGBA (0-1)',
  threshold: '阈值 (0-1)',
  exposure: '曝光 (0-2)',
  saturation: '饱和度 (0-2)',
  contrast: '对比度 (0-2)',
  hueShift: '色相偏移 (0-360)',
}

// ============================================================================
// 3. 序列化函数
// ============================================================================

/**
 * 格式化参数值为紧凑字符串。
 */
function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatScalar(v)).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
    return `{${entries.map(([k, v]) => `${k}:${formatScalar(v)}`).join(',')}}`
  }
  return formatScalar(value)
}

function formatScalar(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return String(value)
}

/**
 * 序列化单个图层为文本行。
 */
function serializeLayer(layer: Layer, index: number): string {
  const opcodeName = Opcode[layer.opcode] ?? String(layer.opcode)
  const opcodeDesc = OPCODE_DESCRIPTION[opcodeName] ?? opcodeName
  const params = Object.entries(layer.params)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ')
  const blend = layer.blendMode ? ` blendMode=${layer.blendMode}` : ''
  const visible = layer.visible ? '' : ' visible=false'
  return `    [${index}] id=${layer.id} ${opcodeName}(${opcodeDesc}) ${params}${blend}${visible}`
}

/**
 * 序列化单个效果为文本行。
 */
function serializeEffect(effect: Effect, index: number): string {
  const params = Object.entries(effect.params)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' ')
  const target = effect.targetLayer
    ? ` targetLayer=${effect.targetLayer}`
    : effect.targetRegion
      ? ` targetRegion=${effect.targetRegion}`
      : ''
  return `    [${index}] id=${effect.id} type=${effect.type} ${params}${target}`
}

/**
 * 提取图层可修改参数列表。
 */
function extractLayerModifiableParams(layer: Layer): ModifiableParam[] {
  const result: ModifiableParam[] = []
  for (const [key, value] of Object.entries(layer.params)) {
    const description = LAYER_PARAM_DESCRIPTION[key] ?? `${key} 参数`
    result.push({
      targetEntity: 'layer',
      targetId: layer.id,
      paramKey: key,
      currentValue: value,
      description: `图层 ${layer.id} 的 ${description}`,
    })
  }
  return result
}

/**
 * 提取效果可修改参数列表。
 */
function extractEffectModifiableParams(effect: Effect): ModifiableParam[] {
  const result: ModifiableParam[] = []
  for (const [key, value] of Object.entries(effect.params)) {
    const description = EFFECT_PARAM_DESCRIPTION[key] ?? `${key} 参数`
    result.push({
      targetEntity: 'effect',
      targetId: effect.id,
      paramKey: key,
      currentValue: value,
      description: `效果 ${effect.id} (${effect.type}) 的 ${description}`,
    })
  }
  return result
}

/**
 * 序列化时间轴状态。
 */
function serializeTimeline(timeline: TimelineContent | null): string {
  if (!timeline) return '未加载'
  const trackCount = timeline.tracks.length
  const enabledTracks = timeline.tracks.filter((t) => t.enabled).length
  return `已加载(轨道数: ${trackCount}, 启用: ${enabledTracks}, 时长: ${timeline.duration.toFixed(1)}s, FPS: ${timeline.fps}, 循环: ${timeline.loop})`
}

// ============================================================================
// 4. 主入口 — buildDirectorContext
// ============================================================================

/**
 * 构建 Director 上下文摘要。
 *
 * @param ir 当前 RenderIR
 * @param timeline 当前时间轴(可选)
 * @returns DirectorContext 包含文本摘要和结构化数据
 */
export function buildDirectorContext(
  ir: RenderIR | null,
  timeline: TimelineContent | null = null,
): DirectorContext {
  if (!ir) {
    return {
      summary: '当前画面状态: 空白(未初始化)',
      canvasSize: { width: 0, height: 0 },
      layerCount: 0,
      effectCount: 0,
      hasTimeline: false,
      modifiableParams: [],
    }
  }

  const { width, height } = ir.canvas
  const visibleLayers = ir.layers.filter((l) => l.visible)
  const modifiableParams: ModifiableParam[] = []

  // 构建文本摘要
  const lines: string[] = []
  lines.push('当前画面状态:')
  lines.push(`- 画布: ${width}×${height}`)
  lines.push(`- 图层数: ${ir.layers.length}(可见: ${visibleLayers.length})`)

  if (ir.layers.length > 0) {
    ir.layers.forEach((layer, i) => {
      lines.push(serializeLayer(layer, i))
      modifiableParams.push(...extractLayerModifiableParams(layer))
    })
  }

  lines.push(`- 效果数: ${ir.effects.length}`)
  if (ir.effects.length > 0) {
    ir.effects.forEach((effect, i) => {
      lines.push(serializeEffect(effect, i))
      modifiableParams.push(...extractEffectModifiableParams(effect))
    })
  }

  lines.push(`- 时间轴: ${serializeTimeline(timeline)}`)

  return {
    summary: lines.join('\n'),
    canvasSize: { width, height },
    layerCount: ir.layers.length,
    effectCount: ir.effects.length,
    hasTimeline: timeline !== null,
    modifiableParams,
  }
}

// ============================================================================
// 5. 上下文摘要变体 — 用于不同模式
// ============================================================================

/**
 * 构建 create 模式上下文(描述现有画面,LLM 在此基础上新增内容)。
 */
export function buildCreateModeContext(
  ir: RenderIR | null,
  timeline: TimelineContent | null = null,
): string {
  const ctx = buildDirectorContext(ir, timeline)
  return `${ctx.summary}\n\n用户希望在此基础上创建新的视觉内容。请生成新的图层或效果。`
}

/**
 * 构建 modify 模式上下文(描述可修改的参数,LLM 做增量调整)。
 */
export function buildModifyModeContext(
  ir: RenderIR | null,
  timeline: TimelineContent | null = null,
): string {
  const ctx = buildDirectorContext(ir, timeline)
  const paramList = ctx.modifiableParams
    .map((p, i) => `  ${i + 1}. ${p.description} (当前值: ${formatValue(p.currentValue)})`)
    .join('\n')
  return `${ctx.summary}\n\n可修改的参数:\n${paramList}\n\n用户希望修改现有参数。请生成 DirectorPatch 调整这些参数。`
}
