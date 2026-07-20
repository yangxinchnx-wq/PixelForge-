/**
 * PixelForge - Director 决策应用器（骨架 §12.3 / §7.2 Phase F）
 *
 * 职责：
 *   - 调用 AI Director 解析意图 + 生成决策
 *   - 将决策转换为 ValuePatch 并通过 PatchEngine 应用
 *   - 应用后更新 paramOwnership（标记为 l3_director）
 *
 * 数据流（骨架 §7.2 Phase F）：
 *   User Prompt → parseIntent() → decide() → DirectorPatch[]
 *   → toValuePatches() → patchEngine → RenderIR
 *
 * 接口契约（骨架 §12.3）：
 *   - IAIDirector.create()：生成模式入口，输入 User Prompt，输出 TimelineContent + 参数修改
 *   - IAIDirector.revise()：修改模式入口，输入 RevisionIntent，输出 Revision Request
 */

import type { DirectorIntent, DirectorDecision } from '../types'
import { parseIntent, decide, toValuePatches } from '../director/director'
import type { PatchEngineLike, DirectorApplyResult } from './types'
import type { MetadataPatch } from '@/compiler/ir/patch'
import type { ParameterOwner, ParamOwnership } from '@/shared/types'
import type { LLMProviderConfig } from '@/authoring/llm/types'
import type { PromptCache } from '@/authoring/llm/promptCache'

// ============================================================================
// DirectorApplier 接口
// ============================================================================

/**
 * Director 决策应用器接口。
 */
export interface DirectorApplier {
  /**
   * 从用户 prompt 生成并应用 Director 决策。
   *
   * @param prompt 用户 prompt
   * @param options 可选配置
   * @returns 应用结果（含决策原因）
   */
  applyFromPrompt(
    prompt: string,
    options?: DirectorApplyOptions,
  ): Promise<DirectorApplyResult>

  /**
   * 从已有意图应用 Director 决策。
   *
   * @param intent DirectorIntent
   * @param options 可选配置
   * @returns 应用结果
   */
  applyFromIntent(
    intent: DirectorIntent,
    options?: DirectorApplyOptions,
  ): Promise<DirectorApplyResult>
}

/**
 * Director 应用选项。
 */
export interface DirectorApplyOptions {
  /** LLM 服务商配置（null = 禁用 LLM，使用空决策） */
  providerConfig?: LLMProviderConfig | null
  /** Prompt 缓存 */
  cache?: PromptCache | null
  /** 模型名称 */
  model?: string
  /** 是否禁用缓存 */
  disableCache?: boolean
  /** 是否只预览不应用（返回决策但不提交 patch） */
  preview?: boolean
}

// ============================================================================
// 实现
// ============================================================================

/**
 * 创建 Director 决策应用器。
 *
 * @param engine PatchEngine 实例
 */
export function createDirectorApplier(engine: PatchEngineLike): DirectorApplier {
  return {
    async applyFromPrompt(
      prompt: string,
      options?: DirectorApplyOptions,
    ): Promise<DirectorApplyResult> {
      const intent = parseIntent(prompt)
      return this.applyFromIntent(intent, options)
    },

    async applyFromIntent(
      intent: DirectorIntent,
      options?: DirectorApplyOptions,
    ): Promise<DirectorApplyResult> {
      // 1. 调用 Director 决策
      const decision: DirectorDecision = await decide(intent, {
        providerConfig: options?.providerConfig,
        cache: options?.cache,
        model: options?.model,
        disableCache: options?.disableCache,
      })

      // 2. 无 patch：返回成功但空
      if (decision.patches.length === 0) {
        return {
          success: true,
          appliedCount: 0,
          reasoning: decision.reasoning,
        }
      }

      // 3. 预览模式：不应用，只返回信息
      if (options?.preview) {
        return {
          success: true,
          appliedCount: 0,
          reasoning: `预览模式：将应用 ${decision.patches.length} 个修改。${decision.reasoning}`,
        }
      }

      // 4. 转换为 ValuePatch
      const valuePatches = toValuePatches(decision.patches, intent.id)

      // 5. 通过 PatchEngine 提交 ValuePatch + MetadataPatch（更新 paramOwnership）
      try {
        engine.beginFrame()

        // 提交 ValuePatch
        for (const patch of valuePatches) {
          engine.apply(patch)
        }

        // 提交 MetadataPatch 更新 paramOwnership
        // 将被 Director 修改的参数 owner 标记为 'l3_director'
        const ownershipUpdates = new Map<string, ParamOwnership>()

        for (const dp of decision.patches) {
          // 只有 layer 有 paramOwnership 字段，effect 没有
          if (dp.targetEntity !== 'layer') continue

          let ownership = ownershipUpdates.get(dp.targetId)
          if (!ownership) {
            ownership = {}
            ownershipUpdates.set(dp.targetId, ownership)
          }
          ownership[dp.paramKey] = 'l3_director' as ParameterOwner
        }

        for (const [targetId, ownership] of ownershipUpdates) {
          const metadataPatch: MetadataPatch = {
            patchId: `director_owner_${intent.id}_${targetId}`,
            tier: 'metadata',
            source: 'l3_director',
            targetEntity: 'layer',
            targetId,
            field: 'paramOwnership',
            value: ownership,
          }
          engine.apply(metadataPatch)
        }

        const result = engine.endFrame()

        if (!result.success) {
          return {
            success: false,
            appliedCount: 0,
            reasoning: decision.reasoning,
            error: result.violations.join('; '),
          }
        }

        return {
          success: true,
          appliedCount: result.appliedCount,
          reasoning: decision.reasoning,
        }
      } catch (err) {
        if (engine.getState() === 'queued') {
          engine.rollback()
        }
        return {
          success: false,
          appliedCount: 0,
          reasoning: decision.reasoning,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  }
}
