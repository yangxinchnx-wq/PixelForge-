/**
 * PixelForge - PatchEngine 帧事务状态机实现（Phase B）
 *
 * 本文件实现 patch.ts 中定义的 PatchEngine 接口，提供 frame-scoped 的
 * patch 事务引擎：beginFrame → apply → endFrame / rollback。
 *
 * 设计原则（骨架 §4.2.5）：
 *   - frame-scoped：每个 frame 是一个独立事务单元
 *   - atomic 独占：AtomicTopologyPatch 必须是 frame 中唯一的 patch
 *   - batch 原子性：endFrame 时所有 queued patch 作为 batch 提交，全成功或全回滚
 *   - immutable：成功时返回新 ir，失败时保持原 ir 不变
 *   - 状态机：idle → queued → committed/rejected → idle（通过 beginFrame 重置）
 *
 * 状态转换图：
 *
 *   ┌──────────────────────────────────────────────┐
 *   │                                              │
 *   ▼                                              │
 *  idle ──beginFrame──▶ queued ──endFrame──▶ committed
 *   │                     │                   │
 *   │                     │                   │
 *   │                  rollback              rejected
 *   │                     │                   │
 *   │                  idle                   │
 *   │                                          │
 *   └──────────── beginFrame ──────────────────┘
 *                   (from committed/rejected)
 *
 * 与 patchEngine.ts 的关系：
 *   - patchEngine.ts 提供 stateless 的 applyPatch（单 patch / batch / atomic）
 *   - frameEngine.ts 提供 stateful 的 PatchEngine（frame-scoped 事务）
 *   - endFrame 内部构造 PatchBatch 调用 applyPatch 提交
 */

import type { RenderIR } from './renderIR'
import type {
  AnyPatch,
  PatchBatch,
  PatchEngine,
  PatchEngineState,
  PatchApplyResult,
  RenderIRPatch,
} from './patch'
import {
  assertPatchValid,
  getBatchTier,
  isAtomicTopologyPatch,
  isPatchBatch,
  PatchError,
} from './patch'
import { applyPatch } from './patchEngine'

// ============================================================================
// 实现
// ============================================================================

/**
 * 创建 PatchEngine 实例。
 *
 * @param initialIr 初始 RenderIR
 * @returns PatchEngine 实例（含 getIR 扩展方法）
 */
export function createPatchEngine(initialIr: RenderIR): PatchEngine & {
  /** 获取当前 IR（endFrame 成功后更新，失败后不变） */
  getIR(): RenderIR
} {
  let ir: RenderIR = initialIr
  let state: PatchEngineState = 'idle'
  let queue: AnyPatch[] = []

  return {
    beginFrame(): void {
      if (state === 'queued') {
        throw new PatchError('IR_PATCH_VIOLATION', [
          'beginFrame: cannot begin a new frame while another is in progress (state=queued), call endFrame or rollback first',
        ])
      }
      // idle / committed / rejected → queued
      queue = []
      state = 'queued'
    },

    apply(patch: AnyPatch): void {
      if (state !== 'queued') {
        throw new PatchError('IR_PATCH_VIOLATION', [
          `apply: cannot apply patch when state=${state}, call beginFrame first`,
        ])
      }

      // 结构合法性校验（不含 IR 上下文语义）
      assertPatchValid(patch)

      // 禁止嵌套 PatchBatch：frame engine 本身就是 batch 机制
      if (isPatchBatch(patch)) {
        throw new PatchError('IR_PATCH_BATCH_NESTED', [
          'apply: cannot queue PatchBatch in frame engine (frame engine IS the batch mechanism)',
        ])
      }

      // atomic 独占性检查
      if (isAtomicTopologyPatch(patch)) {
        if (queue.length > 0) {
          throw new PatchError('IR_PATCH_TRANSACTION_CONFLICT', [
            'apply: atomic patch must be the only patch in a frame (queue is non-empty)',
          ])
        }
      } else {
        // 如果队列中已有 atomic patch，不允许再添加
        if (queue.some((p) => isAtomicTopologyPatch(p))) {
          throw new PatchError('IR_PATCH_TRANSACTION_CONFLICT', [
            'apply: cannot queue patch alongside atomic patch (atomic must be exclusive)',
          ])
        }
      }

      queue.push(patch)
    },

    endFrame(): PatchApplyResult {
      if (state !== 'queued') {
        throw new PatchError('IR_PATCH_VIOLATION', [
          `endFrame: cannot end frame when state=${state}, call beginFrame first`,
        ])
      }

      // 空帧：无 patch 需要提交
      if (queue.length === 0) {
        state = 'committed'
        return {
          success: true,
          appliedCount: 0,
          violations: [],
        }
      }

      // 单 patch 提交（可能是 atomic 或普通 patch）
      if (queue.length === 1) {
        try {
          const outcome = applyPatch(ir, queue[0])
          ir = outcome.ir
          state = 'committed'
          queue = []
          return {
            success: true,
            appliedCount: outcome.appliedCount,
            violations: [],
          }
        } catch (err) {
          state = 'rejected'
          queue = []
          const error =
            err instanceof PatchError
              ? err
              : new PatchError('IR_PATCH_VIOLATION', [String(err)])
          return {
            success: false,
            appliedCount: 0,
            violations: error.violations,
            errorCode: error.code,
          }
        }
      }

      // 多 patch：构造 PatchBatch 提交
      // 此时队列中不可能有 atomic patch（apply 阶段已拦截）
      const patches = queue as RenderIRPatch[]
      const batch: PatchBatch = {
        patchId: `frame-batch-${Date.now()}`,
        tier: getBatchTier(patches),
        source: 'system_internal',
        batch: true,
        patches,
      }

      const outcome = applyPatch(ir, batch)

      if (outcome.errors && outcome.errors.length > 0) {
        // batch 失败：ir 保持不变（outcome.ir === 原 ir）
        state = 'rejected'
        queue = []
        const firstError = outcome.errors[0]
        return {
          success: false,
          appliedCount: 0,
          violations: firstError.violations,
          errorCode: firstError.code,
        }
      }

      // batch 成功
      ir = outcome.ir
      state = 'committed'
      queue = []
      return {
        success: true,
        appliedCount: outcome.appliedCount,
        violations: [],
      }
    },

    rollback(): void {
      if (state !== 'queued') {
        throw new PatchError('IR_PATCH_VIOLATION', [
          `rollback: cannot rollback when state=${state}, can only rollback from queued state`,
        ])
      }
      queue = []
      state = 'idle'
    },

    getState(): PatchEngineState {
      return state
    },

    getQueuedPatches(): readonly AnyPatch[] {
      return queue
    },

    getIR(): RenderIR {
      return ir
    },
  }
}
