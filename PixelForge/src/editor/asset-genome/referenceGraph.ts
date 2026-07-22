/**
 * Reference Graph(Step 35.2)— 资产依赖关系 DAG。
 *
 * 职责:
 * - 维护资产间的引用关系(source → target 的有向边)
 * - 提供 addReference / removeReference / hasReference 纯函数
 * - 提供 getReferences(出边) / getReferencers(入边) 查询
 * - 支持多种引用类型(uses / extends / embeds)
 *
 * 不职责:
 * - 影响分析 / 循环检测(Step 35.3)
 * - 内容哈希去重(Step 35.4)
 *
 * 数据结构:
 * - adjacency: Map<sourceId, Set<Reference>>  — 出边邻接表
 * - reverseIndex: Map<targetId, Set<Reference>> — 入边反向索引
 *
 * 图语义:
 * - source "uses" target 表示 source 依赖 target
 * - 删除 target 时,所有指向 target 的引用需处理(由 Step 35.3 影响分析负责)
 */
import { uniqueId } from '@/shared/ids'

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 引用类型 */
export type ReferenceType = 'uses' | 'extends' | 'embeds'

/** 引用关系(有向边) */
export interface Reference {
  /** 唯一 ID */
  id: string
  /** 源资产 ID(引用方) */
  sourceId: string
  /** 目标资产 ID(被引用方) */
  targetId: string
  /** 引用类型 */
  type: ReferenceType
  /** 创建时间戳 */
  createdAt: number
  /** 备注(可选) */
  note?: string
}

/** 引用图(邻接表 + 反向索引) */
export interface ReferenceGraph {
  /** 出边邻接表: sourceId → Set<Reference> */
  adjacency: Map<string, Set<Reference>>
  /** 入边反向索引: targetId → Set<Reference> */
  reverseIndex: Map<string, Set<Reference>>
}

// ============================================================================
// 2. 常量映射
// ============================================================================

/** ReferenceType → 中文显示名 */
export const REFERENCE_TYPE_DISPLAY_NAME: Record<ReferenceType, string> = {
  uses: '使用',
  extends: '继承',
  embeds: '嵌入',
}

/** 所有引用类型列表 */
export const ALL_REFERENCE_TYPES: ReferenceType[] = ['uses', 'extends', 'embeds']

// ============================================================================
// 3. 工厂函数
// ============================================================================

/** 创建空引用图 */
export function createReferenceGraph(): ReferenceGraph {
  return {
    adjacency: new Map(),
    reverseIndex: new Map(),
  }
}

/**
 * 创建引用关系。
 *
 * @param sourceId 源资产 ID
 * @param targetId 目标资产 ID
 * @param type 引用类型(默认 'uses')
 * @param note 备注(可选)
 */
export function createReference(
  sourceId: string,
  targetId: string,
  type: ReferenceType = 'uses',
  note?: string,
): Reference {
  if (sourceId === targetId) {
    throw new Error(`自引用不允许: ${sourceId}`)
  }
  return {
    id: uniqueId('ref'),
    sourceId,
    targetId,
    type,
    createdAt: Date.now(),
    note,
  }
}

// ============================================================================
// 4. CRUD 纯函数
// ============================================================================

/**
 * 添加引用(若同 source-target-type 已存在则忽略)。
 *
 * @param graph 原引用图
 * @param reference 引用关系
 * @returns 新引用图(不可变)
 */
export function addReference(graph: ReferenceGraph, reference: Reference): ReferenceGraph {
  // 检查重复(同 source + target + type)
  const existing = graph.adjacency.get(reference.sourceId)
  if (existing) {
    for (const ref of existing) {
      if (ref.targetId === reference.targetId && ref.type === reference.type) {
        return graph // 已存在,返回原图
      }
    }
  }

  const nextAdjacency = new Map(graph.adjacency)
  const nextReverse = new Map(graph.reverseIndex)

  // 出边
  const adjSet = new Set(nextAdjacency.get(reference.sourceId) ?? [])
  adjSet.add(reference)
  nextAdjacency.set(reference.sourceId, adjSet)

  // 入边
  const revSet = new Set(nextReverse.get(reference.targetId) ?? [])
  revSet.add(reference)
  nextReverse.set(reference.targetId, revSet)

  return { adjacency: nextAdjacency, reverseIndex: nextReverse }
}

/**
 * 移除引用(按 reference ID)。
 */
export function removeReference(graph: ReferenceGraph, referenceId: string): ReferenceGraph {
  // 先找到这条引用
  let found: Reference | null = null
  for (const refs of graph.adjacency.values()) {
    for (const ref of refs) {
      if (ref.id === referenceId) {
        found = ref
        break
      }
    }
    if (found) break
  }
  if (!found) return graph

  const nextAdjacency = new Map(graph.adjacency)
  const nextReverse = new Map(graph.reverseIndex)

  // 出边
  const adjSet = new Set(nextAdjacency.get(found.sourceId) ?? [])
  for (const ref of adjSet) {
    if (ref.id === referenceId) adjSet.delete(ref)
  }
  if (adjSet.size === 0) nextAdjacency.delete(found.sourceId)
  else nextAdjacency.set(found.sourceId, adjSet)

  // 入边
  const revSet = new Set(nextReverse.get(found.targetId) ?? [])
  for (const ref of revSet) {
    if (ref.id === referenceId) revSet.delete(ref)
  }
  if (revSet.size === 0) nextReverse.delete(found.targetId)
  else nextReverse.set(found.targetId, revSet)

  return { adjacency: nextAdjacency, reverseIndex: nextReverse }
}

/**
 * 移除资产的所有引用(出边 + 入边)— 用于资产注销时清理。
 *
 * @param graph 原引用图
 * @param assetId 资产 ID
 * @returns 新引用图
 */
export function removeAllReferencesForAsset(
  graph: ReferenceGraph,
  assetId: string,
): ReferenceGraph {
  let next = graph
  // 移除出边
  const outRefs = graph.adjacency.get(assetId) ?? new Set<Reference>()
  for (const ref of outRefs) {
    next = removeReference(next, ref.id)
  }
  // 移除入边
  const inRefs = graph.reverseIndex.get(assetId) ?? new Set<Reference>()
  for (const ref of inRefs) {
    next = removeReference(next, ref.id)
  }
  return next
}

/**
 * 清空引用图。
 */
export function clearReferenceGraph(graph: ReferenceGraph): ReferenceGraph {
  if (graph.adjacency.size === 0 && graph.reverseIndex.size === 0) return graph
  return createReferenceGraph()
}

// ============================================================================
// 5. 查询纯函数
// ============================================================================

/**
 * 获取资产的所有出边引用(它引用了谁)。
 */
export function getReferences(graph: ReferenceGraph, sourceId: string): Reference[] {
  const refs = graph.adjacency.get(sourceId)
  return refs ? Array.from(refs) : []
}

/**
 * 获取资产的所有入边引用(谁引用了它)。
 */
export function getReferencers(graph: ReferenceGraph, targetId: string): Reference[] {
  const refs = graph.reverseIndex.get(targetId)
  return refs ? Array.from(refs) : []
}

/**
 * 检查引用关系是否存在(source → target)。
 */
export function hasReference(
  graph: ReferenceGraph,
  sourceId: string,
  targetId: string,
  type?: ReferenceType,
): boolean {
  const refs = graph.adjacency.get(sourceId)
  if (!refs) return false
  for (const ref of refs) {
    if (ref.targetId === targetId) {
      if (type === undefined || ref.type === type) return true
    }
  }
  return false
}

/**
 * 按 ID 查找引用。
 */
export function getReferenceById(graph: ReferenceGraph, referenceId: string): Reference | undefined {
  for (const refs of graph.adjacency.values()) {
    for (const ref of refs) {
      if (ref.id === referenceId) return ref
    }
  }
  return undefined
}

/**
 * 获取所有引用列表。
 */
export function getAllReferences(graph: ReferenceGraph): Reference[] {
  const result: Reference[] = []
  for (const refs of graph.adjacency.values()) {
    result.push(...refs)
  }
  return result
}

/**
 * 获取引用总数。
 */
export function getReferenceCount(graph: ReferenceGraph): number {
  let count = 0
  for (const refs of graph.adjacency.values()) {
    count += refs.size
  }
  return count
}

/**
 * 按引用类型筛选。
 */
export function getReferencesByType(graph: ReferenceGraph, type: ReferenceType): Reference[] {
  const result: Reference[] = []
  for (const refs of graph.adjacency.values()) {
    for (const ref of refs) {
      if (ref.type === type) result.push(ref)
    }
  }
  return result
}

/**
 * 获取资产的出边引用数(被该资产引用的数量)。
 */
export function getOutDegree(graph: ReferenceGraph, sourceId: string): number {
  return graph.adjacency.get(sourceId)?.size ?? 0
}

/**
 * 获取资产的入边引用数(引用该资产的数量)。
 */
export function getInDegree(graph: ReferenceGraph, targetId: string): number {
  return graph.reverseIndex.get(targetId)?.size ?? 0
}

/**
 * 检查资产是否在引用图中存在(有出边或入边)。
 */
export function isAssetInGraph(graph: ReferenceGraph, assetId: string): boolean {
  return graph.adjacency.has(assetId) || graph.reverseIndex.has(assetId)
}
