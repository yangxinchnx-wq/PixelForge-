import type { ParameterTrack } from './types'
import { toPatchValue } from './types'
import { evaluateTrack } from './evaluator'

import type { useRuntimeStore } from '@/stores/runtime'

/**
 * 时间轴播放器 —— 把"播放头位置"翻译成 ValuePatch 推给 runtime store。
 *
 * 完整链路(对应骨架 Phase B-E):
 *
 *   时间轴拖动 / 播放头推进
 *          ↓
 *   timeline.currentFrame = N
 *          ↓
 *   evaluateTrack(track, N)          ← 关键帧插值
 *          ↓
 *   player.applyFrameToRuntime()
 *          ↓
 *   runtime.applyValuePatch(layerId, paramKey, value)  ← 生成 ValuePatch
 *          ↓
 *   patchEngine.applyPatch(currentIr, patch)           ← IR 更新
 *          ↓
 *   renderCurrentIR()                                  ← RegionCompiler + GPU dispatch
 *          ↓
 *   canvas 刷新
 *
 * 注意:
 * - player 不持有状态,所有状态从 store 读取
 * - player 接受 runtime store 实例(避免在普通函数里调 useRuntimeStore)
 * - 每帧都会触发 GPU 重渲染,所以批量播放时要控制帧率(由调用方负责)
 */

type RuntimeStore = ReturnType<typeof useRuntimeStore>

/**
 * 把指定帧上的所有轨道求值结果应用到 runtime store。
 *
 * @param tracks  参数轨道列表
 * @param frame   当前帧号
 * @param runtime runtime store 实例
 * @param options skipHistory=true 时跳过 history 记录(默认 true,因为这是"求值预览"不是编辑)
 * @returns 应用了几个 patch(用于日志 / 性能统计)
 */
export function applyFrameToRuntime(
  tracks: ParameterTrack[],
  frame: number,
  runtime: RuntimeStore,
  options: { skipHistory?: boolean } = {},
): number {
  const { skipHistory = true } = options
  let applied = 0
  for (const track of tracks) {
    const value = evaluateTrack(track, frame)
    const patchValue = toPatchValue(track.parameter, value)
    const ok = runtime.applyValuePatch(
      track.layerId,
      track.parameter,
      patchValue,
      skipHistory ? { skipHistory: true } : undefined,
    )
    if (ok) applied++
  }
  return applied
}

/**
 * 创建一个 rAF 驱动的播放循环。
 *
 * - 每帧推进 currentFrame(按 fps 换算成实际推进步长)
 * - 推进后调用 applyFrameToRuntime 触发 GPU 重渲染
 * - 到达末尾自动停止(可配置 loop)
 *
 * 用法:
 *   const player = createPlayer(timelineStore, runtimeStore)
 *   player.play()    // 开始播放
 *   player.pause()   // 暂停
 *   player.dispose() // 卸载(组件销毁时调用)
 */
export interface TimelinePlayer {
  play: () => void
  pause: () => void
  toggle: () => void
  dispose: () => void
  isPlaying: () => boolean
}

export function createPlayer(
  timelineStore: ReturnType<typeof import('@/stores/timeline').useTimelineStore>,
  runtime: RuntimeStore,
  options: { loop?: boolean } = {},
): TimelinePlayer {
  const { loop = false } = options
  let rafId: number | null = null
  let lastTs = 0
  // 累积器:按 fps 推进帧号
  let frameAccumulator = 0

  const frameDuration = () => 1000 / timelineStore.fps

  function tick(ts: number) {
    if (!timelineStore.isPlaying) {
      rafId = null
      return
    }

    if (lastTs === 0) lastTs = ts
    const delta = ts - lastTs
    lastTs = ts

    frameAccumulator += delta
    const step = frameDuration()
    let stepped = false

    while (frameAccumulator >= step) {
      frameAccumulator -= step
      const next = timelineStore.currentFrame + 1

      if (next >= timelineStore.totalFrames) {
        if (loop) {
          timelineStore.seek(0)
        } else {
          timelineStore.seek(timelineStore.totalFrames)
          timelineStore.setPlaying(false)
          rafId = null
          return
        }
      } else {
        timelineStore.seek(next)
      }
      stepped = true
    }

    // 在这一帧上应用所有轨道 patch(只在本帧推进时触发,避免无谓重渲染)
    if (stepped) {
      applyFrameToRuntime(timelineStore.tracks, timelineStore.currentFrame, runtime)
    }

    rafId = requestAnimationFrame(tick)
  }

  function play() {
    if (timelineStore.isPlaying) return
    timelineStore.setPlaying(true)
    lastTs = 0
    frameAccumulator = 0
    rafId = requestAnimationFrame(tick)
  }

  function pause() {
    timelineStore.setPlaying(false)
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    lastTs = 0
  }

  function toggle() {
    if (timelineStore.isPlaying) pause()
    else play()
  }

  function dispose() {
    pause()
  }

  function isPlaying() {
    return timelineStore.isPlaying
  }

  return { play, pause, toggle, dispose, isPlaying }
}
