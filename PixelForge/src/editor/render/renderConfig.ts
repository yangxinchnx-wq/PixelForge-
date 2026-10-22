/**
 * 渲染配置(Step 32)— 定义渲染导出的参数与预设。
 *
 * 渲染配置描述"如何导出"一个 Sequence:
 * - 输出分辨率(可等于或异于 Sequence 原生分辨率)
 * - 帧率(可下采样)
 * - 格式(图片序列 / 视频容器)
 * - 质量等级
 * - 帧范围(全片 / 自定义区间)
 *
 * 与 Sequence 的关系:
 * - RenderConfig.outputWidth/Height 可与 Sequence.width/height 不同(缩放渲染)
 * - RenderConfig.fps 可与 Sequence.fps 不同(时间重采样)
 * - 帧范围基于 Sequence.duration 计算
 */

import type { Sequence } from './timelineTypes'
import { seconds, type Time } from './timelineTypes'

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 输出格式 */
export type RenderFormat = 'png-sequence' | 'webm' | 'mp4'

/** 质量等级 */
export type RenderQuality = 'draft' | 'standard' | 'high'

/** 渲染状态 */
export type RenderStatus = 'idle' | 'queued' | 'rendering' | 'paused' | 'completed' | 'cancelled' | 'failed'

/**
 * 精确帧率(有理数形式,每秒 num/den 帧)。
 *
 * 用于 NTSC 系列帧率(24000/1001、30000/1001、60000/1001)与任意非整数帧率:
 * 浮点 fps 无法精确表示这些值(29.97 实际是 30000/1001 ≈ 29.97002997…),
 * 逐帧乘以浮点帧长会累积误差——1 小时 @ 29.97 实际应出 107893 帧,
 * 按 29.97 计算只有 107892 帧,并且每帧时间都在漂移。
 *
 * 有理数形式配合 bigint 微秒运算,可做到逐帧时间零累积误差。
 */
export interface FrameRate {
  /** 分子(每 den 秒的帧数) */
  num: number
  /** 分母(秒) */
  den: number
}

/** 常用精确帧率 */
export const FRAME_RATES = {
  film24: { num: 24, den: 1 },
  pal25: { num: 25, den: 1 },
  ntscFilm24: { num: 24000, den: 1001 },
  ntsc30: { num: 30000, den: 1001 },
  pal50: { num: 50, den: 1 },
  ntsc60: { num: 60000, den: 1001 },
  fps60: { num: 60, den: 1 },
} as const satisfies Record<string, FrameRate>

/**
 * 行业习惯的小数写法 → 精确有理数。
 *
 * 23.976 / 29.97 / 59.94 在业界一直被当作 NTSC 帧率的代称,
 * 它们本身不是精确值,映射到对应的 1001 分母有理数。
 */
const NTSC_DECIMAL_ALIASES: Readonly<Record<string, FrameRate>> = {
  '23.976': { num: 24000, den: 1001 },
  '29.97': { num: 30000, den: 1001 },
  '59.94': { num: 60000, den: 1001 },
}

/** 合法帧率范围(帧/秒) */
const MIN_FRAME_RATE = 1
const MAX_FRAME_RATE = 240

/**
 * 解析帧率字符串。
 *
 * 支持三种写法:
 * - 整数:`30`
 * - 有理数:`30000/1001`(推荐,无歧义)
 * - 标准 NTSC 小数别名:`29.97` → 30000/1001
 *
 * 其余小数(如 `29.5`)会被拒绝——无法确定它代表哪个精确帧率。
 *
 * @param input 帧率字符串
 * @returns 精确帧率,或错误信息
 */
export function parseFrameRate(input: string): { frameRate: FrameRate } | { error: string } {
  const text = input.trim()
  if (!text) return { error: '帧率不能为空' }

  const alias = NTSC_DECIMAL_ALIASES[text]
  if (alias) return { frameRate: { ...alias } }

  const ratio = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (ratio) {
    const num = Number(ratio[1])
    const den = Number(ratio[2])
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
      return { error: `帧率无效: ${input}` }
    }
    const value = num / den
    if (value < MIN_FRAME_RATE || value > MAX_FRAME_RATE) {
      return { error: `帧率超出范围(${MIN_FRAME_RATE}-${MAX_FRAME_RATE}): ${input}` }
    }
    return { frameRate: { num, den } }
  }

  if (/^\d+$/.test(text)) {
    const num = Number(text)
    if (num < MIN_FRAME_RATE || num > MAX_FRAME_RATE) {
      return { error: `帧率超出范围(${MIN_FRAME_RATE}-${MAX_FRAME_RATE}): ${input}` }
    }
    return { frameRate: { num, den: 1 } }
  }

  return {
    error: `无法解析帧率: ${input}。请使用整数(30)、有理数(30000/1001)或标准 NTSC 写法(29.97)`,
  }
}

/**
 * 从带装饰的标签中解析帧率(如界面上的 "30 fps"、"29.97 fps")。
 *
 * 先提取第一个数值(或有理数)记号,再交给 parseFrameRate 严格解析;
 * 解析失败时回退为 30fps,保证导出流程不会因展示格式变化而中断。
 *
 * @param label 形如 "30 fps" 的展示字符串
 */
export function parseFrameRateFromLabel(label: string): FrameRate {
  const token = label.match(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)/)?.[1]
  if (token) {
    const parsed = parseFrameRate(token.replace(/\s+/g, ''))
    if ('frameRate' in parsed) return parsed.frameRate
  }
  return { num: 30, den: 1 }
}

/** 把精确帧率转成浮点数值(仅用于显示、码率估算等非确定性计算) */
export function frameRateToNumber(rate: FrameRate): number {
  return rate.num / rate.den
}

/**
 * 取得配置生效的精确帧率。
 *
 * `exactFps` 优先;未设置时把 `fps` 归一化为有理数——整数直接使用,
 * 小数按 1e-6 精度转换为 `{ num: round(fps*1e6), den: 1e6 }`,
 * 保证后续 bigint 运算始终拿到整数分子/分母。
 */
export function resolveFrameRate(config: RenderConfig): FrameRate {
  if (config.exactFps) return config.exactFps
  if (Number.isInteger(config.fps)) return { num: config.fps, den: 1 }
  return { num: Math.round(config.fps * 1_000_000), den: 1_000_000 }
}

/**
 * 计算第 frameIndex 帧相对起始时间的偏移(微秒,四舍五入到 1μs)。
 *
 * 全程 bigint 运算,非整数帧率下也无浮点累积误差。
 */
function frameOffsetUs(frameIndex: number, rate: FrameRate): bigint {
  const num = BigInt(Math.trunc(frameIndex)) * BigInt(rate.den) * 1_000_000n
  const den = BigInt(rate.num)
  // 四舍五入:round(num/den) = floor((2*num + den) / (2*den))
  return (num * 2n + den) / (den * 2n)
}

/**
 * 渲染配置。
 */
export interface RenderConfig {
  /** 输出宽度(像素) */
  outputWidth: number
  /** 输出高度(像素) */
  outputHeight: number
  /** 输出帧率(整数或小数;精确帧率请同时设置 exactFps) */
  fps: number
  /**
   * 精确帧率(可选)。
   *
   * 设置后帧时间计算完全按有理数进行,`fps` 仅作为显示/兼容用途。
   * NTSC 帧率建议填 `{ num: 30000, den: 1001 }` 而不是 `fps: 29.97`。
   */
  exactFps?: FrameRate
  /** 输出格式 */
  format: RenderFormat
  /** 质量等级 */
  quality: RenderQuality
  /** 起始时间(微秒,默认 0) */
  startTime: Time
  /** 结束时间(微秒,默认 Sequence.duration) */
  endTime: Time
  /** 输出文件名前缀(不含扩展名) */
  outputName: string
  /** 是否包含 alpha 通道(透明背景) */
  alpha: boolean
  /** 视频比特率(kbps,仅 webm/mp4) */
  bitrateKbps: number
}

/**
 * 渲染任务(运行时状态)。
 */
export interface RenderJob {
  /** 任务唯一 ID */
  id: string
  /** 源 Sequence ID */
  sequenceId: string
  /** 渲染配置 */
  config: RenderConfig
  /** 当前状态 */
  status: RenderStatus
  /** 总帧数 */
  totalFrames: number
  /** 已完成帧数 */
  completedFrames: number
  /** 当前帧号(0-based) */
  currentFrame: number
  /** 创建时间戳 */
  createdAt: number
  /** 开始渲染时间戳 */
  startedAt: number | null
  /** 完成时间戳 */
  finishedAt: number | null
  /** 错误信息(failed 状态时) */
  error: string | null
  /** 输出文件路径列表(completed 后填充) */
  outputFiles: string[]
}

// ============================================================================
// 2. 预设
// ============================================================================

/**
 * 渲染预设 — 常用的输出配置组合。
 */
export interface RenderPreset {
  id: string
  name: string
  description: string
  config: Omit<RenderConfig, 'startTime' | 'endTime' | 'outputName'>
}

export const RENDER_PRESETS: RenderPreset[] = [
  {
    id: 'preset-1080p-png',
    name: '1080p PNG 序列',
    description: '1920×1080,30fps,PNG 图片序列,高质量',
    config: {
      outputWidth: 1920,
      outputHeight: 1080,
      fps: 30,
      format: 'png-sequence',
      quality: 'high',
      alpha: false,
      bitrateKbps: 0,
    },
  },
  {
    id: 'preset-1080p-webm',
    name: '1080p WebM 视频',
    description: '1920×1080,30fps,WebM 格式,标准质量',
    config: {
      outputWidth: 1920,
      outputHeight: 1080,
      fps: 30,
      format: 'webm',
      quality: 'standard',
      alpha: false,
      bitrateKbps: 8000,
    },
  },
  {
    id: 'preset-4k-png',
    name: '4K PNG 序列',
    description: '3840×2160,60fps,PNG 图片序列,高质量',
    config: {
      outputWidth: 3840,
      outputHeight: 2160,
      fps: 60,
      format: 'png-sequence',
      quality: 'high',
      alpha: false,
      bitrateKbps: 0,
    },
  },
  {
    id: 'preset-vertical-webm',
    name: '竖屏 WebM',
    description: '1080×1920,30fps,WebM 格式,标准质量',
    config: {
      outputWidth: 1080,
      outputHeight: 1920,
      fps: 30,
      format: 'webm',
      quality: 'standard',
      alpha: false,
      bitrateKbps: 6000,
    },
  },
  {
    id: 'preset-draft-png',
    name: '草稿预览',
    description: '960×540,15fps,PNG 序列,草稿质量',
    config: {
      outputWidth: 960,
      outputHeight: 540,
      fps: 15,
      format: 'png-sequence',
      quality: 'draft',
      alpha: false,
      bitrateKbps: 0,
    },
  },
  {
    id: 'preset-alpha-png',
    name: '透明背景 PNG',
    description: '1920×1080,30fps,PNG 序列,含 Alpha 通道',
    config: {
      outputWidth: 1920,
      outputHeight: 1080,
      fps: 30,
      format: 'png-sequence',
      quality: 'high',
      alpha: true,
      bitrateKbps: 0,
    },
  },
]

// ============================================================================
// 3. 工厂函数
// ============================================================================

/**
 * 从 Sequence 创建默认渲染配置(匹配 Sequence 原生参数)。
 *
 * @param seq 源 Sequence
 * @returns 默认 RenderConfig
 */
export function createRenderConfigFromSequence(seq: Sequence): RenderConfig {
  return {
    outputWidth: seq.width,
    outputHeight: seq.height,
    fps: seq.fps,
    format: 'png-sequence',
    quality: 'standard',
    startTime: seconds(0),
    endTime: seq.duration,
    outputName: seq.name || 'render',
    alpha: false,
    bitrateKbps: 0,
  }
}

/**
 * 从预设创建渲染配置(需要补充 Sequence 的时长信息)。
 *
 * @param preset 渲染预设
 * @param seq    源 Sequence(提供 startTime/endTime/outputName)
 * @returns 完整 RenderConfig
 */
export function createRenderConfigFromPreset(
  preset: RenderPreset,
  seq: Sequence,
): RenderConfig {
  return {
    ...preset.config,
    startTime: seconds(0),
    endTime: seq.duration,
    outputName: seq.name || 'render',
  }
}

// ============================================================================
// 4. 验证
// ============================================================================

/**
 * 验证渲染配置。
 *
 * @param config 待验证配置
 * @returns { valid, reason? }
 */
export function validateRenderConfig(config: RenderConfig): {
  valid: boolean
  reason?: string
} {
  if (config.outputWidth <= 0 || config.outputHeight <= 0) {
    return { valid: false, reason: `输出分辨率无效: ${config.outputWidth}×${config.outputHeight}` }
  }
  if (config.outputWidth > 7680 || config.outputHeight > 4320) {
    return { valid: false, reason: '分辨率超过 8K 上限' }
  }
  if (config.fps <= 0 || config.fps > MAX_FRAME_RATE) {
    return { valid: false, reason: `帧率无效: ${config.fps}` }
  }
  if (config.exactFps) {
    const { num, den } = config.exactFps
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num <= 0 || den <= 0) {
      return { valid: false, reason: `精确帧率无效: ${num}/${den}` }
    }
    const value = num / den
    if (value < MIN_FRAME_RATE || value > MAX_FRAME_RATE) {
      return { valid: false, reason: `精确帧率超出范围(${MIN_FRAME_RATE}-${MAX_FRAME_RATE}): ${num}/${den}` }
    }
  }
  if (config.startTime < 0n) {
    return { valid: false, reason: '起始时间不能为负' }
  }
  if (config.endTime <= config.startTime) {
    return { valid: false, reason: '结束时间必须大于起始时间' }
  }
  if (config.format === 'webm' || config.format === 'mp4') {
    if (config.bitrateKbps <= 0) {
      return { valid: false, reason: `视频比特率无效: ${config.bitrateKbps}kbps` }
    }
  }
  if (!config.outputName || config.outputName.trim().length === 0) {
    return { valid: false, reason: '输出文件名不能为空' }
  }
  return { valid: true }
}

// ============================================================================
// 5. 帧序列计算
// ============================================================================

/**
 * 计算渲染总帧数。
 *
 * 使用精确帧率做整数运算,非整数帧率下不会因浮点误差少算/多算一帧。
 *
 * @param config 渲染配置
 * @returns 总帧数
 */
export function computeTotalFrames(config: RenderConfig): number {
  const rate = resolveFrameRate(config)
  const durationUs = config.endTime - config.startTime
  const numerator = durationUs * BigInt(rate.num)
  const denominator = BigInt(rate.den) * 1_000_000n
  // 向上取整:ceil(n/d) = (n + d - 1) / d
  return Number((numerator + denominator - 1n) / denominator)
}

/**
 * 计算第 frameIndex 帧对应的时间(微秒)。
 *
 * 按精确帧率在 bigint 上直接求解,不做"浮点帧长 × 帧号"的累积乘法,
 * 因此 NTSC 帧率(30000/1001)下任意帧号都有精确到 1μs 的时间。
 *
 * @param config     渲染配置
 * @param frameIndex 帧索引(0-based)
 * @returns 帧时间(微秒)
 */
export function frameIndexToTime(config: RenderConfig, frameIndex: number): Time {
  return config.startTime + frameOffsetUs(frameIndex, resolveFrameRate(config))
}

/**
 * 生成完整的帧时间序列(用于逐帧渲染调度)。
 *
 * @param config 渲染配置
 * @returns 帧时间数组(Time[])
 */
export function generateFrameTimes(config: RenderConfig): Time[] {
  const total = computeTotalFrames(config)
  const times: Time[] = []
  for (let i = 0; i < total; i++) {
    times.push(frameIndexToTime(config, i))
  }
  return times
}
