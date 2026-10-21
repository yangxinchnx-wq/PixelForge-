/**
 * 混音计算(Step 41.1)— 可听轨判定、增益求解、立体声求和。
 *
 * 职责:
 * - 判定哪些轨道在当前 mute/solo 状态下可听
 * - 把每轨的 dB 增益与声像求解为左右声道线性增益
 * - 提供多轨立体声求和
 *
 * 全部为纯函数,零 Web Audio / DOM 依赖。
 *
 * 数据流:
 *   AudioTrack[]
 *     ↓ resolveAudibleTracks(mute/solo 优先级)
 *   可听轨道子集
 *     ↓ computeTrackGains(dB → 线性 + 声像分配)
 *   TrackGain[](left / right)
 *     ↓ runtime.audioGraph
 *   Web Audio 节点图
 */

import type { AudioTrack, MasterBus, TrackGain } from './types'
import { clampGainDb, clampPan, dbToLinear, panToGainPair } from './units'

// ============================================================================
// 1. mute / solo 优先级
// ============================================================================

/**
 * 判定单轨在给定 solo 上下文下是否可听。
 *
 * 规则:
 * - 只要存在任意 solo 轨道,则只有 solo 轨道可听
 * - 在 solo 轨道内部,仍尊重 muted(即 solo + mute 同时为真时不可听)
 * - 没有 solo 轨道时,未被 mute 的轨道可听
 *
 * @param track 目标轨道
 * @param anySoloed 当前是否存在任意 solo 轨道
 */
export function isTrackAudible(track: AudioTrack, anySoloed: boolean): boolean {
  if (track.muted) return false
  if (anySoloed) return track.soloed
  return true
}

/**
 * 筛选出当前可听的轨道集合(保持原顺序)。
 */
export function resolveAudibleTracks(tracks: AudioTrack[]): AudioTrack[] {
  const anySoloed = tracks.some((t) => t.soloed)
  return tracks.filter((t) => isTrackAudible(t, anySoloed))
}

// ============================================================================
// 2. 增益求解
// ============================================================================

/**
 * 计算单轨的左右声道线性增益(不含主输出总线)。
 *
 * @param track 音轨
 * @returns 左右声道线性增益
 */
export function computeTrackGain(track: AudioTrack): { left: number; right: number } {
  const linearGain = dbToLinear(clampGainDb(track.gainDb))
  const pan = panToGainPair(clampPan(track.pan))
  return {
    left: linearGain * pan.left,
    right: linearGain * pan.right,
  }
}

/**
 * 计算主输出总线的左右声道线性增益。
 */
export function computeMasterGain(master: MasterBus): { left: number; right: number } {
  const linearGain = dbToLinear(clampGainDb(master.gainDb))
  const pan = panToGainPair(clampPan(master.pan))
  return {
    left: linearGain * pan.left,
    right: linearGain * pan.right,
  }
}

/**
 * 计算全部可听轨道的左右声道线性增益,并叠加主输出总线增益。
 *
 * 不可听的轨道不会出现在结果中。
 *
 * @param tracks 全部音轨
 * @param master 主输出总线
 * @returns 每条可听轨道的最终增益
 */
export function computeTrackGains(tracks: AudioTrack[], master: MasterBus): TrackGain[] {
  const masterGain = computeMasterGain(master)
  return resolveAudibleTracks(tracks).map((track) => {
    const trackGain = computeTrackGain(track)
    return {
      trackId: track.id,
      left: trackGain.left * masterGain.left,
      right: trackGain.right * masterGain.right,
    }
  })
}

// ============================================================================
// 3. 求和
// ============================================================================

/**
 * 把多条轨道的左右声道样本按增益加权求和为立体声输出。
 *
 * @param contributions 每条轨道的左右声道原始样本(未加增益)
 * @param gains 与 contributions 一一对应的增益(由 computeTrackGains 得出)
 * @returns 混合后的左右声道样本
 */
export function sumStereo(
  contributions: Array<{ left: number; right: number }>,
  gains: Array<{ left: number; right: number }>,
): { left: number; right: number } {
  let left = 0
  let right = 0
  const n = Math.min(contributions.length, gains.length)
  for (let i = 0; i < n; i++) {
    left += contributions[i].left * gains[i].left
    right += contributions[i].right * gains[i].right
  }
  return { left, right }
}

/** 软限幅拐点:低于该比例的电平完全不处理,保留原始动态 */
export const LIMITER_KNEE_RATIO = 0.7

/**
 * 对左右声道样本施加限幅器,防止削波。
 *
 * 采用分段软限幅:
 * - 拐点以下(默认 0.7 × 天花板):原样返回,不引入任何音色改变
 * - 拐点以上:超出部分按 tanh 压缩,输出渐近于天花板**但永不超出**
 *
 * 这样既避免了硬截断产生的刺耳失真,又保证了限幅器的核心承诺——
 * 输出不会超过天花板(旧实现允许超出 50%,仍会削波,已修正)。
 *
 * @param sample 输入样本(线性)
 * @param ceilingLinear 天花板线性值(通常接近 1)
 * @returns 限幅后的样本,绝对值恒 ≤ ceilingLinear
 */
export function applyLimiter(sample: number, ceilingLinear: number): number {
  if (Number.isNaN(sample)) return 0
  const c = Math.abs(ceilingLinear)
  if (c <= 0) return 0

  const abs = Math.abs(sample)
  const knee = c * LIMITER_KNEE_RATIO

  // 拐点以下:线性区,原样通过
  if (abs <= knee) return sample

  // 拐点以上:超出部分 tanh 压缩,渐近于 c
  const headroom = c - knee
  const compressed = knee + headroom * Math.tanh((abs - knee) / headroom)
  return Math.sign(sample) * Math.min(compressed, c)
}

/**
 * 硬限幅(直接截断),供对比与测试使用。
 */
export function applyHardClip(sample: number, ceilingLinear: number): number {
  if (Number.isNaN(sample)) return 0
  const c = Math.abs(ceilingLinear)
  return Math.min(c, Math.max(-c, sample))
}
