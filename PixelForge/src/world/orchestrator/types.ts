/**
 * PixelForge - L3 集成层共享类型
 *
 * 定义 L3 Orchestrator 各子模块之间的共享类型。
 */

import type { RenderIR } from '@/compiler/ir/renderIR'
import type { PatchApplyResult } from '@/compiler/ir/patch'
import type { ParamOwnership } from '@/shared/types'

// ============================================================================
// 1. PatchEngineLike — PatchEngine 的最小接口
// ============================================================================

/**
 * PatchEngine 的最小接口约束。
 *
 * L3 集成层通过此接口与底层 patchEngine 交互，
 * 不直接依赖具体实现，便于测试 mock。
 */
export interface PatchEngineLike {
  beginFrame(): void
  apply(patch: import('@/compiler/ir/patch').AnyPatch): void
  endFrame(): PatchApplyResult
  rollback(): void
  getState(): import('@/compiler/ir/patch').PatchEngineState
  getQueuedPatches(): readonly import('@/compiler/ir/patch').AnyPatch[]
  getIR(): RenderIR
}

// ============================================================================
// 2. TickResult — 每帧执行结果
// ============================================================================

/**
 * Orchestrator 单帧 tick 的执行结果。
 */
export interface TickResult {
  /** 当前时间（秒） */
  currentTime: number
  /** 本帧是否产生了 patch */
  hasPatches: boolean
  /** 本帧应用的 patch 数量 */
  appliedCount: number
  /** 本帧应用是否成功 */
  success: boolean
  /** 失败时的错误信息 */
  error?: string
  /** 本帧跳过的轨道（仅 Timeline） */
  skippedTracks?: string[]
}

// ============================================================================
// 3. ConflictResolution — 冲突处理结果
// ============================================================================

/**
 * Revision 冲突处理结果。
 */
export interface ConflictResolution {
  /** 是否需要用户确认 */
  needsConfirmation: boolean
  /** 冲突详情 */
  conflicts: Array<{
    targetId: string
    paramKey: string
    currentOwner: string
    message: string
  }>
  /** 用户确认回调（needsConfirmation=true 时由调用方提供） */
  confirm?: (accepted: boolean) => void
}

// ============================================================================
// 4. RevisionApplyResult — Revision Layer 应用结果
// ============================================================================

/**
 * Revision Layer 应用结果。
 */
export interface RevisionApplyResult {
  /** 是否成功应用 */
  success: boolean
  /** 应用的 patch 数量 */
  appliedCount: number
  /** 是否需要用户确认（与 l2_user 冲突） */
  needsConfirmation: boolean
  /** 冲突详情 */
  conflicts: ConflictResolution['conflicts']
  /** 错误信息 */
  error?: string
}

// ============================================================================
// 5. DirectorApplyResult — Director 决策应用结果
// ============================================================================

/**
 * Director 决策应用结果。
 */
export interface DirectorApplyResult {
  /** 是否成功应用 */
  success: boolean
  /** 应用的 patch 数量 */
  appliedCount: number
  /** Director 生成的决策原因 */
  reasoning: string
  /** 错误信息 */
  error?: string
}

// ============================================================================
// 6. OwnershipExtractor — 从 RenderIR 提取 paramOwnership
// ============================================================================

/**
 * 从 RenderIR 提取所有 layer 的 paramOwnership 映射。
 *
 * @param ir 当前 RenderIR
 * @returns Map<layerId, ParamOwnership>
 */
export function extractOwnershipMap(ir: RenderIR): Map<string, ParamOwnership> {
  const map = new Map<string, ParamOwnership>()
  for (const layer of ir.layers) {
    map.set(layer.id, layer.paramOwnership)
  }
  return map
}

// ============================================================================
// 7. L3Config — Orchestrator 配置
// ============================================================================

/**
 * L3 Orchestrator 配置。
 */
export interface L3Config {
  /** Timeline 播放速度（默认 1.0） */
  timelineSpeed: number
  /** 是否自动循环（默认 false） */
  timelineLoop: boolean
  /** Director 是否自动应用（默认 false，需手动调用） */
  directorAutoApply: boolean
}
