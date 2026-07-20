/**
 * PixelForge - Revision Layer（骨架 §6 / §4.1.5 Phase F）
 *
 * Revision Layer 是参数覆盖层，以最高优先级（l3_revision）覆盖参数值。
 *
 * 冲突处理原则（骨架 §4.1.5）：
 *   - l3_revision 优先级最高，但可被 l2_user 否决
 *   - 与 l2_user 冲突时触发 needs_confirmation
 *   - 其他 L3 owner（l3_timeline / l3_director）被 l3_revision 覆盖
 *
 * 数据流（骨架 §7.2 Phase F）：
 *   RevisionLayer → toValuePatches() → ValuePatch[] (source='l3_revision') → patchEngine → RenderIR
 */

import type { JsonLiteral, ParamOwnership, ParameterOwner } from '@/shared/types'
import type { ValuePatch } from '@/compiler/ir/patch'
import type { RevisionLayer, RevisionEntry } from '../types'
import { compareOwnerPriority } from '../types'

// ============================================================================
// ID 生成
// ============================================================================

let revIdCounter = 0

function genId(prefix: string): string {
  revIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${revIdCounter.toString(36)}`
}

// ============================================================================
// Revision Layer 创建
// ============================================================================

/**
 * 创建空 Revision Layer。
 */
export function createRevisionLayer(): RevisionLayer {
  return {
    id: genId('revision'),
    entries: [],
    enabled: true,
    version: 1,
  }
}

// ============================================================================
// Revision Entry 创建
// ============================================================================

/**
 * 创建 Revision Entry。
 */
export function createEntry(
  targetEntity: 'layer' | 'effect',
  targetId: string,
  paramKey: string,
  value: JsonLiteral,
  reason: string,
): RevisionEntry {
  return {
    id: genId('rev_entry'),
    targetEntity,
    targetId,
    paramKey,
    value,
    reason,
    createdAt: Date.now(),
  }
}

// ============================================================================
// Entry 管理（immutable）
// ============================================================================

/**
 * 添加覆盖条目到 Revision Layer。
 *
 * 如果已存在相同 targetId + paramKey 的条目，替换其值。
 */
export function addEntry(
  layer: RevisionLayer,
  entry: RevisionEntry,
): RevisionLayer {
  // 检查是否已有相同 target 的条目
  const existingIdx = layer.entries.findIndex(
    (e) =>
      e.targetId === entry.targetId &&
      e.paramKey === entry.paramKey &&
      e.targetEntity === entry.targetEntity,
  )

  let entries: RevisionEntry[]
  if (existingIdx >= 0) {
    // 替换已有条目
    entries = layer.entries.slice()
    entries[existingIdx] = entry
  } else {
    entries = [...layer.entries, entry]
  }

  return {
    ...layer,
    entries,
    version: layer.version + 1,
  }
}

/**
 * 从 Revision Layer 移除条目。
 */
export function removeEntry(
  layer: RevisionLayer,
  entryId: string,
): RevisionLayer {
  return {
    ...layer,
    entries: layer.entries.filter((e) => e.id !== entryId),
    version: layer.version + 1,
  }
}

/**
 * 更新条目。
 */
export function updateEntry(
  layer: RevisionLayer,
  entryId: string,
  updates: Partial<Omit<RevisionEntry, 'id'>>,
): RevisionLayer {
  return {
    ...layer,
    entries: layer.entries.map((e) =>
      e.id === entryId ? { ...e, ...updates } : e,
    ),
    version: layer.version + 1,
  }
}

// ============================================================================
// 转换为 ValuePatch
// ============================================================================

/**
 * 将 Revision Layer 转换为 ValuePatch 列表。
 *
 * 每个 entry 生成一个 ValuePatch（source = 'l3_revision'）。
 *
 * @param layer Revision Layer
 * @returns ValuePatch 列表
 */
export function toValuePatches(layer: RevisionLayer): ValuePatch[] {
  if (!layer.enabled) return []

  return layer.entries.map((entry) => ({
    patchId: `revision_${entry.id}`,
    tier: 'value' as const,
    source: 'l3_revision' as const,
    targetEntity: entry.targetEntity,
    targetId: entry.targetId,
    paramKey: entry.paramKey,
    value: entry.value,
  }))
}

// ============================================================================
// 冲突检测
// ============================================================================

/**
 * 冲突检测结果。
 */
export interface ConflictResult {
  /** 是否有冲突 */
  hasConflict: boolean
  /** 冲突的参数路径列表 */
  conflicts: ConflictInfo[]
}

/**
 * 单个冲突信息。
 */
export interface ConflictInfo {
  /** 目标实体 ID */
  targetId: string
  /** 参数路径 */
  paramKey: string
  /** 当前 owner */
  currentOwner: ParameterOwner
  /** Revision 试图覆盖的 owner */
  revisionOwner: 'l3_revision'
  /** 是否需要用户确认 */
  needsConfirmation: boolean
}

/**
 * 检测 Revision Layer 与现有 paramOwnership 的冲突。
 *
 * 冲突规则（骨架 §4.1.5）：
 *   - l3_revision vs l2_user → needs_confirmation（用户否决权）
 *   - l3_revision vs 其他 → 直接覆盖（无需确认）
 *
 * @param layer Revision Layer
 * @param ownershipMap 目标实体的 paramOwnership 映射
 * @returns 冲突检测结果
 */
export function detectConflicts(
  layer: RevisionLayer,
  ownershipMap: Map<string, ParamOwnership>,
): ConflictResult {
  const conflicts: ConflictInfo[] = []

  for (const entry of layer.entries) {
    const ownership = ownershipMap.get(entry.targetId)
    if (!ownership) continue

    const currentOwner = ownership[entry.paramKey]
    if (!currentOwner) continue

    // l3_revision vs l2_user → 需要用户确认
    if (currentOwner === 'l2_user') {
      conflicts.push({
        targetId: entry.targetId,
        paramKey: entry.paramKey,
        currentOwner,
        revisionOwner: 'l3_revision',
        needsConfirmation: true,
      })
    }
    // l3_revision vs l3_revision → 已是同 owner，不算冲突
    // l3_revision vs 其他 → 直接覆盖，不是冲突
  }

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  }
}

// ============================================================================
// 应用 Revision Layer 到 paramOwnership
// ============================================================================

/**
 * 将 Revision Layer 的 owner 标记应用到 paramOwnership。
 *
 * 被 Revision 覆盖的参数 owner 标记为 'l3_revision'。
 * 除非原 owner 是 'l2_user'（用户否决权）。
 *
 * @param layer Revision Layer
 * @param ownershipMap 目标实体的 paramOwnership 映射
 * @returns 更新后的 paramOwnership 映射
 */
export function applyOwnership(
  layer: RevisionLayer,
  ownershipMap: Map<string, ParamOwnership>,
): Map<string, ParamOwnership> {
  const result = new Map(ownershipMap)

  for (const entry of layer.entries) {
    const ownership = result.get(entry.targetId)
    if (!ownership) continue

    const currentOwner = ownership[entry.paramKey]
    if (!currentOwner) continue

    // l2_user 不可被覆盖
    if (currentOwner === 'l2_user') continue

    // l3_revision 优先级最高（除 l2_user 外）
    if (compareOwnerPriority('l3_revision', currentOwner) > 0) {
      const newOwnership = { ...ownership, [entry.paramKey]: 'l3_revision' as ParameterOwner }
      result.set(entry.targetId, newOwnership)
    }
  }

  return result
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 重置 ID 生成器（用于测试隔离）。
 */
export function resetRevisionIdCounter(): void {
  revIdCounter = 0
}
