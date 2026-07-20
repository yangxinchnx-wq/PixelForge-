/**
 * PixelForge - Revision Layer 应用器（骨架 §4.1.5 / §7.2 Phase F）
 *
 * 职责：
 *   - 检测 Revision Layer 与现有 paramOwnership 的冲突
 *   - 与 l2_user 冲突时返回 needs_confirmation（用户否决权）
 *   - 无冲突时通过 PatchEngine 应用 ValuePatch
 *   - 应用后更新 paramOwnership（标记为 l3_revision）
 *
 * 冲突处理原则（骨架 §4.1.5）：
 *   - l3_revision 优先级最高，但可被 l2_user 否决
 *   - 与 l2_user 冲突时触发 needs_confirmation
 *   - 其他 L3 owner（l3_timeline / l3_director）被 l3_revision 直接覆盖
 */

import type { RevisionLayer } from '../types'
import { toValuePatches, detectConflicts, applyOwnership } from '../revision/revisionLayer'
import type { ConflictResult } from '../revision/revisionLayer'
import type { PatchEngineLike, RevisionApplyResult, ConflictResolution } from './types'
import { extractOwnershipMap } from './types'
import type { MetadataPatch } from '@/compiler/ir/patch'

// ============================================================================
// RevisionApplier 接口
// ============================================================================

/**
 * Revision Layer 应用器接口。
 */
export interface RevisionApplier {
  /**
   * 检查 Revision Layer 是否有冲突（不实际应用）。
   *
   * @param layer Revision Layer
   * @returns 冲突检测结果
   */
  checkConflicts(layer: RevisionLayer): ConflictResolution

  /**
   * 应用 Revision Layer。
   *
   * 如果与 l2_user 冲突且 force=false，返回 needs_confirmation。
   * 如果 force=true，强制应用（忽略 l2_user 否决权）。
   *
   * @param layer Revision Layer
   * @param force 是否强制应用（覆盖 l2_user）
   * @returns 应用结果
   */
  apply(layer: RevisionLayer, force?: boolean): RevisionApplyResult
}

// ============================================================================
// 实现
// ============================================================================

/**
 * 创建 Revision Layer 应用器。
 *
 * @param engine PatchEngine 实例
 */
export function createRevisionApplier(engine: PatchEngineLike): RevisionApplier {
  return {
    checkConflicts(layer: RevisionLayer): ConflictResolution {
      const ir = engine.getIR()
      const ownershipMap = extractOwnershipMap(ir)
      const result: ConflictResult = detectConflicts(layer, ownershipMap)

      return {
        needsConfirmation: result.hasConflict,
        conflicts: result.conflicts.map((c) => ({
          targetId: c.targetId,
          paramKey: c.paramKey,
          currentOwner: c.currentOwner,
          message: `参数 '${c.paramKey}' 当前由用户设置（l2_user），Revision 试图覆盖`,
        })),
      }
    },

    apply(layer: RevisionLayer, force: boolean = false): RevisionApplyResult {
      // 1. 检测冲突
      const conflictResolution = this.checkConflicts(layer)

      // 2. 有冲突且未强制 → 返回 needs_confirmation
      if (conflictResolution.needsConfirmation && !force) {
        return {
          success: false,
          appliedCount: 0,
          needsConfirmation: true,
          conflicts: conflictResolution.conflicts,
          error: '存在与 l2_user 的冲突，需要用户确认',
        }
      }

      // 3. 生成 ValuePatch
      const patches = toValuePatches(layer)
      if (patches.length === 0) {
        return {
          success: true,
          appliedCount: 0,
          needsConfirmation: false,
          conflicts: [],
        }
      }

      // 4. 通过 PatchEngine 提交 ValuePatch + MetadataPatch（更新 paramOwnership）
      try {
        const ir = engine.getIR()
        const ownershipMap = extractOwnershipMap(ir)
        const updatedOwnership = applyOwnership(layer, ownershipMap)

        engine.beginFrame()

        // 提交 ValuePatch
        for (const patch of patches) {
          engine.apply(patch)
        }

        // 提交 MetadataPatch 更新 paramOwnership
        // 注意：只有 layer 有 paramOwnership 字段，effect 没有
        for (const entry of layer.entries) {
          if (entry.targetEntity !== 'layer') continue

          // 只更新被覆盖的参数的 owner
          const layerOwnership = updatedOwnership.get(entry.targetId)
          if (!layerOwnership) continue

          const newOwner = layerOwnership[entry.paramKey]
          if (!newOwner) continue

          const metadataPatch: MetadataPatch = {
            patchId: `revision_owner_${entry.id}`,
            tier: 'metadata',
            source: 'l3_revision',
            targetEntity: 'layer',
            targetId: entry.targetId,
            field: 'paramOwnership',
            value: layerOwnership,
          }
          engine.apply(metadataPatch)
        }

        const result = engine.endFrame()

        if (!result.success) {
          return {
            success: false,
            appliedCount: 0,
            needsConfirmation: false,
            conflicts: [],
            error: result.violations.join('; '),
          }
        }

        return {
          success: true,
          appliedCount: result.appliedCount,
          needsConfirmation: false,
          conflicts: [],
        }
      } catch (err) {
        if (engine.getState() === 'queued') {
          engine.rollback()
        }
        return {
          success: false,
          appliedCount: 0,
          needsConfirmation: false,
          conflicts: [],
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  }
}
