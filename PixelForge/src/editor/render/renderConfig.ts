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

import type { Sequence } from '../timeline/core/sequence'
import { seconds, type Time } from '../timeline/core/time'

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
 * 渲染配置。
 */
export interface RenderConfig {
  /** 输出宽度(像素) */
  outputWidth: number
  /** 输出高度(像素) */
  outputHeight: number
  /** 输出帧率 */
  fps: number
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
  if (config.fps <= 0 || config.fps > 240) {
    return { valid: false, reason: `帧率无效: ${config.fps}` }
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
 * @param config 渲染配置
 * @returns 总帧数
 */
export function computeTotalFrames(config: RenderConfig): number {
  const durationSec = Number(config.endTime - config.startTime) / 1_000_000
  return Math.ceil(durationSec * config.fps)
}

/**
 * 计算第 frameIndex 帧对应的时间(微秒)。
 *
 * @param config     渲染配置
 * @param frameIndex 帧索引(0-based)
 * @returns 帧时间(微秒)
 */
export function frameIndexToTime(config: RenderConfig, frameIndex: number): Time {
  const frameDurationUs = 1_000_000 / config.fps
  return config.startTime + BigInt(Math.round(frameIndex * frameDurationUs))
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
