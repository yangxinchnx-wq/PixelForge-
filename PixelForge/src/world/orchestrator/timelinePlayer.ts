/**
 * PixelForge - Timeline 播放驱动器（骨架 §7.2 Phase F）
 *
 * 职责：
 *   - 维护播放状态（currentTime / isPlaying / speed / loop）
 *   - tick(deltaTime) 推进时间，每帧求值 Timeline → 生成 ValuePatch[]
 *   - 通过 PatchEngine 提交 patches
 *   - 处理循环（到达末尾时重置或停止）
 *
 * 数据流（骨架 §7.2 Phase F）：
 *   Timeline(time) → evaluateTimeline() → ValuePatch[] → patchEngine.beginFrame/apply/endFrame → RenderIR
 */

import type { TimelineContent } from '../types'
import type { TimelineEvaluationResult } from '../types'
import { evaluateTimeline } from '../timeline/evaluator'
import type { PatchEngineLike, TickResult } from './types'

// ============================================================================
// TimelinePlayer 接口
// ============================================================================

/**
 * Timeline 播放驱动器接口。
 */
export interface TimelinePlayer {
  /** 加载时间轴 */
  load(timeline: TimelineContent): void
  /** 卸载时间轴 */
  unload(): void
  /** 播放 */
  play(): void
  /** 暂停 */
  pause(): void
  /** 停止（重置 currentTime 到 0） */
  stop(): void
  /** 跳转到指定时间 */
  seek(time: number): void
  /**
   * 推进一帧。
   *
   * @param deltaTime 时间增量（秒）
   * @returns 本帧执行结果
   */
  tick(deltaTime: number): TickResult
  /** 是否正在播放 */
  isPlaying(): boolean
  /** 当前时间（秒） */
  getCurrentTime(): number
  /** 总时长（秒） */
  getDuration(): number
  /** 当前加载的时间轴 */
  getTimeline(): TimelineContent | null
}

// ============================================================================
// 实现
// ============================================================================

/**
 * 创建 Timeline 播放驱动器。
 *
 * @param engine PatchEngine 实例
 * @param initialSpeed 初始播放速度（默认 1.0）
 * @param initialLoop 初始循环模式（默认 false）
 */
export function createTimelinePlayer(
  engine: PatchEngineLike,
  initialSpeed: number = 1.0,
  initialLoop: boolean = false,
): TimelinePlayer {
  let timeline: TimelineContent | null = null
  let currentTime: number = 0
  let playing: boolean = false
  let speed: number = initialSpeed
  let loop: boolean = initialLoop

  return {
    load(tl: TimelineContent): void {
      timeline = tl
      currentTime = 0
      playing = false
      // loop 由 player 自身配置控制，不从 timeline 继承
      // （timeline.loop 是时间轴的设计属性，player.loop 是播放控制）
    },

    unload(): void {
      timeline = null
      currentTime = 0
      playing = false
    },

    play(): void {
      if (timeline) playing = true
    },

    pause(): void {
      playing = false
    },

    stop(): void {
      playing = false
      currentTime = 0
    },

    seek(time: number): void {
      if (timeline) {
        const duration = timeline.duration
        currentTime = Math.max(0, Math.min(time, duration))
      }
    },

    tick(deltaTime: number): TickResult {
      // 无时间轴或未播放：空帧
      if (!timeline || !playing) {
        return {
          currentTime,
          hasPatches: false,
          appliedCount: 0,
          success: true,
        }
      }

      // 推进时间
      currentTime += deltaTime * speed

      // 处理循环 / 到达末尾
      const duration = timeline.duration
      if (currentTime >= duration) {
        if (loop) {
          currentTime = currentTime % duration
        } else {
          currentTime = duration
          playing = false
        }
      }

      // 求值时间轴
      const evalResult: TimelineEvaluationResult = evaluateTimeline(timeline, currentTime)

      // 无 patch：空帧
      if (evalResult.patches.length === 0) {
        return {
          currentTime,
          hasPatches: false,
          appliedCount: 0,
          success: true,
          skippedTracks: evalResult.skippedTracks,
        }
      }

      // 通过 PatchEngine 提交
      try {
        engine.beginFrame()
        for (const patch of evalResult.patches) {
          engine.apply(patch)
        }
        const result = engine.endFrame()

        return {
          currentTime,
          hasPatches: true,
          appliedCount: result.appliedCount,
          success: result.success,
          error: result.success ? undefined : result.violations.join('; '),
          skippedTracks: evalResult.skippedTracks,
        }
      } catch (err) {
        // 确保回滚
        if (engine.getState() === 'queued') {
          engine.rollback()
        }
        return {
          currentTime,
          hasPatches: true,
          appliedCount: 0,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          skippedTracks: evalResult.skippedTracks,
        }
      }
    },

    isPlaying(): boolean {
      return playing
    },

    getCurrentTime(): number {
      return currentTime
    },

    getDuration(): number {
      return timeline?.duration ?? 0
    },

    getTimeline(): TimelineContent | null {
      return timeline
    },
  }
}
