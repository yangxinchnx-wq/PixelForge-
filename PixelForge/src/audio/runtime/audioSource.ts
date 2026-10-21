/**
 * 音频源管理(Step 41.3)— 解码 + 播放调度 + 裁剪窗口计算。
 *
 * 职责:
 * - 把 ArrayBuffer 解码为 AudioBuffer
 * - 按轨道的入点 / 出点计算裁剪窗口
 * - 在指定上下文时间调度播放,并持有句柄以便提前停止
 *
 * 设计原则:
 * - 纯计算部分(`computePlaybackWindow`)与 Web Audio 调用分离,便于单测
 * - 解码失败返回 null,不抛异常(外部文件可能损坏)
 *
 * 时间单位约定:
 * - 轨道字段用微秒 bigint(与 timelineStore 一致)
 * - Web Audio 用秒(number),本模块负责换算
 *
 * 数据流:
 *   ArrayBuffer
 *     ↓ decodeAudioFile
 *   AudioBuffer
 *     ↓ scheduleTrack(按 inPoint / outPoint 裁剪)
 *   AudioBufferSourceNode → 轨道节点链
 */

import type { AudioTrack } from '../core/types'
import type { TrackNodeChain } from './audioGraph'
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
} from './types'

// ============================================================================
// 1. 时间换算
// ============================================================================

/** 每秒对应的微秒数 */
export const US_PER_SECOND = 1_000_000

/**
 * 微秒转秒。
 */
export function usToSeconds(us: bigint): number {
  return Number(us) / US_PER_SECOND
}

/**
 * 秒转微秒(取整,与 bigint 约定保持一致)。
 */
export function secondsToUs(seconds: number): bigint {
  if (!Number.isFinite(seconds)) return 0n
  return BigInt(Math.round(seconds * US_PER_SECOND))
}

// ============================================================================
// 2. 裁剪窗口
// ============================================================================

/** 播放窗口(秒) */
export interface PlaybackWindow {
  /** 缓冲区内的起始偏移(秒) */
  offset: number
  /** 播放时长(秒) */
  duration: number
}

/**
 * 计算轨道在音频缓冲区上的裁剪窗口。
 *
 * 规则:
 * - 入点小于 0 时按 0 处理
 * - 出点小于等于入点、或未设置(0)时,播放到缓冲区末尾
 * - 窗口会被限制在缓冲区时长内,避免越界
 *
 * @param track 音轨
 * @param bufferDuration 音频文件总时长(秒)
 */
export function computePlaybackWindow(
  track: Pick<AudioTrack, 'inPointUs' | 'outPointUs'>,
  bufferDuration: number,
): PlaybackWindow {
  if (!Number.isFinite(bufferDuration) || bufferDuration <= 0) {
    return { offset: 0, duration: 0 }
  }

  const offset = Math.min(
    Math.max(0, usToSeconds(track.inPointUs)),
    bufferDuration,
  )

  const outSeconds = usToSeconds(track.outPointUs)
  const rawEnd = outSeconds > offset ? outSeconds : bufferDuration
  const end = Math.min(rawEnd, bufferDuration)

  return { offset, duration: Math.max(0, end - offset) }
}

// ============================================================================
// 3. 解码
// ============================================================================

/**
 * 解码音频数据。
 *
 * @returns 解码结果;失败或数据非法时返回 null
 */
export async function decodeAudioFile(
  ctx: AudioContextLike,
  data: ArrayBuffer,
): Promise<AudioBufferLike | null> {
  if (!data || data.byteLength === 0) return null
  try {
    return await ctx.decodeAudioData(data)
  } catch {
    return null
  }
}

/**
 * 读取缓冲区的单声道混降数据(用于波形绘制与离线分析)。
 *
 * 多声道取各声道平均,长度取第一个声道。
 */
export function toMono(buffer: AudioBufferLike): Float32Array {
  const channels = Math.max(1, buffer.numberOfChannels)
  if (buffer.length === 0) return new Float32Array(0)

  const out = new Float32Array(buffer.length)
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < buffer.length; i++) {
      out[i] += data[i]
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] /= channels
  }
  return out
}

// ============================================================================
// 4. 调度
// ============================================================================

/** 已调度的播放句柄 */
export interface ScheduledSource {
  trackId: string
  source: AudioBufferSourceNodeLike
  /** 调度的上下文起始时间(秒) */
  startTime: number
  /** 缓冲区偏移(秒) */
  offset: number
  /** 播放时长(秒) */
  duration: number
  /** 预计结束的上下文时间(秒) */
  endTime: number
}

/**
 * 在指定时间调度一条轨道的播放。
 *
 * @param ctx 音频上下文
 * @param chain 轨道节点链(由 createTrackNodes 构建)
 * @param buffer 解码后的音频数据
 * @param track 音轨
 * @param when 上下文起始时间(秒),通常取 ctx.currentTime + 预卷
 * @returns 播放句柄;窗口无效时返回 null
 */
export function scheduleTrack(
  ctx: AudioContextLike,
  chain: TrackNodeChain,
  buffer: AudioBufferLike,
  track: AudioTrack,
  when: number,
): ScheduledSource | null {
  const window = computePlaybackWindow(track, buffer.duration)
  if (window.duration <= 0) return null

  const source = ctx.createBufferSource()
  source.buffer = buffer

  try {
    source.connect(chain.input)
    source.start(when, window.offset, window.duration)
  } catch {
    return null
  }

  return {
    trackId: track.id,
    source,
    startTime: when,
    offset: window.offset,
    duration: window.duration,
    endTime: when + window.duration,
  }
}

/**
 * 停止一个已调度的播放。
 *
 * 已停止或已结束的源会抛异常,这里统一吞掉——停止是幂等操作。
 */
export function stopSource(handle: ScheduledSource): void {
  try {
    handle.source.stop()
  } catch {
    // 已停止,忽略
  }
  try {
    handle.source.disconnect()
  } catch {
    // 已断开,忽略
  }
}

/**
 * 判断某个播放句柄在给定上下文时间是否已经结束。
 */
export function isSourceFinished(handle: ScheduledSource, currentTime: number): boolean {
  return currentTime >= handle.endTime
}
