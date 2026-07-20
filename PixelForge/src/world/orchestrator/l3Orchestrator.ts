/**
 * PixelForge - L3 主编排器（骨架 §7.2 Phase F）
 *
 * 职责：
 *   - 串联 Timeline / Revision / Director 三个 L3 子系统
 *   - 提供统一的 tick() 入口（每帧驱动 Timeline）
 *   - 协调三者执行顺序（Director → Revision → Timeline）
 *   - 提供 API 供上层 UI 调用
 *
 * 数据流（骨架 §7.2 Phase F）：
 *
 *   [L3 Director] → ValuePatch(source='l3_director')    ↘
 *   [L3 Revision] → ValuePatch(source='l3_revision')    → patchEngine → RenderIR → L1 → L0 → 画面
 *   [L3 Timeline] → ValuePatch(source='l3_timeline')    ↗
 *
 * 执行优先级（同一帧内）：
 *   1. Director（一次性应用，不每帧执行）
 *   2. Revision（一次性应用，不每帧执行）
 *   3. Timeline（每帧执行，由 tick 驱动）
 *
 * 注意：Director 和 Revision 是离散操作，Timeline 是连续操作。
 * Orchestrator 不在同一帧内混用三者，避免 patch 冲突。
 */

import type { TimelineContent, RevisionLayer, DirectorIntent } from '../types'
import type { TickResult, RevisionApplyResult, DirectorApplyResult, L3Config } from './types'
import type { TimelinePlayer } from './timelinePlayer'
import type { RevisionApplier } from './revisionApplier'
import type { DirectorApplier, DirectorApplyOptions } from './directorApplier'
import { createTimelinePlayer } from './timelinePlayer'
import { createRevisionApplier } from './revisionApplier'
import { createDirectorApplier } from './directorApplier'
import type { PatchEngineLike } from './types'

// ============================================================================
// L3Orchestrator 接口
// ============================================================================

/**
 * L3 主编排器接口。
 */
export interface L3Orchestrator {
  // —— Timeline 控制 ——
  /** 加载时间轴 */
  loadTimeline(timeline: TimelineContent): void
  /** 卸载时间轴 */
  unloadTimeline(): void
  /** 播放 */
  playTimeline(): void
  /** 暂停 */
  pauseTimeline(): void
  /** 停止 */
  stopTimeline(): void
  /** 跳转 */
  seekTimeline(time: number): void
  /** 是否正在播放 */
  isTimelinePlaying(): boolean
  /** 当前时间 */
  getCurrentTime(): number

  // —— Revision 控制 ——
  /** 检查 Revision 冲突 */
  checkRevisionConflicts(layer: RevisionLayer): import('./types').ConflictResolution
  /** 应用 Revision */
  applyRevision(layer: RevisionLayer, force?: boolean): RevisionApplyResult

  // —— Director 控制 ——
  /** 从 prompt 生成并应用 Director 决策 */
  applyDirectorFromPrompt(prompt: string, options?: DirectorApplyOptions): Promise<DirectorApplyResult>
  /** 从已有意图应用 Director 决策 */
  applyDirectorFromIntent(intent: DirectorIntent, options?: DirectorApplyOptions): Promise<DirectorApplyResult>

  // —— 统一入口 ——
  /**
   * 每帧驱动（由外部 rAF / scheduler 调用）。
   *
   * 只驱动 Timeline（连续操作）。
   * Director 和 Revision 是离散操作，需手动调用。
   *
   * @param deltaTime 时间增量（秒）
   * @returns 本帧执行结果
   */
  tick(deltaTime: number): TickResult

  // —— 子模块访问 ——
  /** 获取 TimelinePlayer */
  getTimelinePlayer(): TimelinePlayer
  /** 获取 RevisionApplier */
  getRevisionApplier(): RevisionApplier
  /** 获取 DirectorApplier */
  getDirectorApplier(): DirectorApplier
}

// ============================================================================
// 实现
// ============================================================================

/**
 * 默认配置。
 */
const DEFAULT_CONFIG: L3Config = {
  timelineSpeed: 1.0,
  timelineLoop: false,
  directorAutoApply: false,
}

/**
 * 创建 L3 主编排器。
 *
 * @param engine PatchEngine 实例
 * @param config 可选配置
 * @returns L3Orchestrator 实例
 */
export function createL3Orchestrator(
  engine: PatchEngineLike,
  config?: Partial<L3Config>,
): L3Orchestrator {
  const cfg: L3Config = { ...DEFAULT_CONFIG, ...config }

  // 创建子模块
  const timelinePlayer: TimelinePlayer = createTimelinePlayer(
    engine,
    cfg.timelineSpeed,
    cfg.timelineLoop,
  )
  const revisionApplier: RevisionApplier = createRevisionApplier(engine)
  const directorApplier: DirectorApplier = createDirectorApplier(engine)

  return {
    // —— Timeline 控制 ——
    loadTimeline(timeline: TimelineContent): void {
      timelinePlayer.load(timeline)
    },

    unloadTimeline(): void {
      timelinePlayer.unload()
    },

    playTimeline(): void {
      timelinePlayer.play()
    },

    pauseTimeline(): void {
      timelinePlayer.pause()
    },

    stopTimeline(): void {
      timelinePlayer.stop()
    },

    seekTimeline(time: number): void {
      timelinePlayer.seek(time)
    },

    isTimelinePlaying(): boolean {
      return timelinePlayer.isPlaying()
    },

    getCurrentTime(): number {
      return timelinePlayer.getCurrentTime()
    },

    // —— Revision 控制 ——
    checkRevisionConflicts(layer: RevisionLayer): import('./types').ConflictResolution {
      return revisionApplier.checkConflicts(layer)
    },

    applyRevision(layer: RevisionLayer, force: boolean = false): RevisionApplyResult {
      return revisionApplier.apply(layer, force)
    },

    // —— Director 控制 ——
    async applyDirectorFromPrompt(
      prompt: string,
      options?: DirectorApplyOptions,
    ): Promise<DirectorApplyResult> {
      return directorApplier.applyFromPrompt(prompt, options)
    },

    async applyDirectorFromIntent(
      intent: DirectorIntent,
      options?: DirectorApplyOptions,
    ): Promise<DirectorApplyResult> {
      return directorApplier.applyFromIntent(intent, options)
    },

    // —— 统一入口 ——
    tick(deltaTime: number): TickResult {
      // 只驱动 Timeline（连续操作）
      // Director 和 Revision 是离散操作，需手动调用
      return timelinePlayer.tick(deltaTime)
    },

    // —— 子模块访问 ——
    getTimelinePlayer(): TimelinePlayer {
      return timelinePlayer
    },

    getRevisionApplier(): RevisionApplier {
      return revisionApplier
    },

    getDirectorApplier(): DirectorApplier {
      return directorApplier
    },
  }
}
