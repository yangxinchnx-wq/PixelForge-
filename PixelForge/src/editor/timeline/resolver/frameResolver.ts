/**
 * FrameResolver(Step 31.1)— 帧渲染队列构建器。
 *
 * 职责:
 * 把 TimelineResolver 的结果转换为 GPU 渲染队列。
 *
 * 数据流:
 *   TimelineResolveResult(活跃 Clip)
 *     ↓
 *   RenderQueueItem[](每个活跃 Clip 一个)
 *     ↓
 *   GPU Renderer(按 z-order 合成)
 *
 * 渲染顺序(从底到顶):
 *   1. 底层 VIDEO Clip(track index 小的在下)
 *   2. 上层 VIDEO Clip(track index 大的在上)
 *   3. TEXT Clip(字幕)
 *   4. EFFECT Clip(整轨特效,作用于下方所有层)
 */

import type { Time } from '../core/time'
import type { Clip } from '../core/clip'
import type { ClipTransform } from '../core/clip'
import { mapToSource } from '../core/clip'
import type { TimelineResolveResult } from './timelineResolver'

// ============================================================================
// 1. 渲染队列项
// ============================================================================

/**
 * RenderQueueItem — 单个待渲染的片段。
 *
 * @property clip       原 Clip 引用
 * @property sourceTime 该帧对应的 Asset 源时间(微秒)
 * @property transform  画面变换(位置/缩放/旋转/不透明度)
 * @property zOrder     渲染层级(0 = 最底,越大越上)
 * @property trackId    所属轨道 ID
 * @property trackType  所属轨道类型
 */
export interface RenderQueueItem {
  clip: Clip
  sourceTime: Time
  transform: ClipTransform
  zOrder: number
  trackId: string
  trackType: string
}

/**
 * RenderQueue — 完整的渲染队列。
 *
 * @property time   当前时间点
 * @property items  渲染项列表(按 zOrder 升序:底 → 顶)
 */
export interface RenderQueue {
  time: Time
  items: RenderQueueItem[]
}

// ============================================================================
// 2. 构建渲染队列
// ============================================================================

/**
 * 把 TimelineResolveResult 转换为 RenderQueue。
 *
 * zOrder 分配规则:
 * - VIDEO 轨道:按轨道 index 从小到大(底→顶),每个轨道内 Clip 按 start 排序
 * - TEXT 轨道:在所有 VIDEO 之上
 * - EFFECT 轨道:不直接渲染,但标记 zOrder = -1(由特效系统处理)
 *
 * @param resolveResult TimelineResolver 的输出
 * @returns 渲染队列(已按 zOrder 排序)
 */
export function buildRenderQueue(
  resolveResult: TimelineResolveResult,
): RenderQueue {
  const items: RenderQueueItem[] = []
  let zOrder = 0

  // 1. VIDEO 轨道(按轨道顺序从底到顶)
  for (const trackResult of resolveResult.tracks) {
    if (trackResult.track.type !== 'video') continue
    if (!trackResult.track.visible) continue

    for (const clip of trackResult.activeClips) {
      if (!clip.enabled) continue
      const sourceTime = mapToSource(clip, resolveResult.time)
      if (sourceTime === null) continue

      items.push({
        clip,
        sourceTime,
        transform: clip.transform,
        zOrder,
        trackId: trackResult.track.id,
        trackType: trackResult.track.type,
      })
      zOrder++
    }
  }

  // 2. TEXT 轨道(在 VIDEO 之上)
  for (const trackResult of resolveResult.tracks) {
    if (trackResult.track.type !== 'text') continue
    if (!trackResult.track.visible) continue

    for (const clip of trackResult.activeClips) {
      if (!clip.enabled) continue
      const sourceTime = mapToSource(clip, resolveResult.time)
      if (sourceTime === null) continue

      items.push({
        clip,
        sourceTime,
        transform: clip.transform,
        zOrder,
        trackId: trackResult.track.id,
        trackType: trackResult.track.type,
      })
      zOrder++
    }
  }

  return {
    time: resolveResult.time,
    items,
  }
}

/**
 * 构建音频混合队列(用于音频渲染器)。
 *
 * @param resolveResult TimelineResolver 的输出
 * @returns 音频 Clip 列表 + 源时间 + 音量
 */
export interface AudioQueueItem {
  clip: Clip
  sourceTime: Time
  volume: number
  trackId: string
}

export function buildAudioQueue(
  resolveResult: TimelineResolveResult,
): AudioQueueItem[] {
  const items: AudioQueueItem[] = []

  for (const trackResult of resolveResult.tracks) {
    if (trackResult.track.type !== 'audio') continue
    if (!trackResult.track.visible || trackResult.track.muted) continue

    for (const clip of trackResult.activeClips) {
      if (!clip.enabled) continue
      const sourceTime = mapToSource(clip, resolveResult.time)
      if (sourceTime === null) continue

      items.push({
        clip,
        sourceTime,
        volume: clip.volume * trackResult.track.volume,
        trackId: trackResult.track.id,
      })
    }
  }

  return items
}
