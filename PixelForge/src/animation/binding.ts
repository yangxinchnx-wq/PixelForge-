/**
 * Binding(Step 29.10)— 动画绑定与应用。
 *
 * 职责:
 * - createBinding:    创建绑定(trackId → nodeId + property)
 * - applyAnimations:  把 ParamPatch[] 应用到 graphStore / materialGraphStore
 * - applyToGraph:     应用单个 patch 到 graphStore
 * - applyToMaterial:  应用单个 patch 到 materialGraphStore
 *
 * 数据流(每帧):
 *   evaluator.evaluateAllTracks(tracks, time)
 *     ↓ ParamPatch[]
 *   binding.applyAnimations(patches, graphStore, materialStore)
 *     ↓ store.updateNodeParams(nodeId, { [property]: value })
 *   GraphNode / MaterialNode 更新
 *     ↓ compiler / runtime
 *   GPU
 */

import type { ParamPatch } from './types'
import { toParamValue } from './types'
import type { JsonLiteral } from '@/shared/types'

// ============================================================================
// 1. Store 类型(避免循环依赖,用结构化类型)
// ============================================================================

/**
 * Store 接口(最小化,只要求有 updateNodeParams)。
 *
 * 用结构化类型避免直接 import graphStore / materialGraphStore(循环依赖)。
 *
 * 注意:params 类型为 Record<string, JsonLiteral>(与 graphStore / materialGraphStore 一致)。
 * 接受 Record<string, unknown> 的实现也兼容(逆变)。
 */
export interface ParamUpdatableStore {
  updateNodeParams: (nodeId: string, params: Record<string, JsonLiteral>) => void
}

/**
 * Runtime Store 接口(用于 'runtime' 目标类型的 patch)。
 *
 * - applyValuePatch: 把值直接应用到 RenderIR 的 layer/effect 参数,触发 GPU 重渲染
 *
 * 与 runtimeStore 兼容(结构化类型),避免直接 import stores/runtime(循环依赖)。
 */
export interface RuntimePatchableStore {
  applyValuePatch: (
    targetId: string,
    paramKey: string,
    value: JsonLiteral,
    options?: { skipHistory?: boolean },
  ) => boolean
}

// ============================================================================
// 2. 创建绑定
// ============================================================================

/**
 * 创建动画绑定。
 *
 * @param trackId    轨道 id
 * @param targetKind 目标类型(graph / material)
 * @param nodeId     节点 id
 * @param property   参数 key
 */
export function createBinding(
  trackId: string,
  targetKind: ParamPatch['targetKind'],
  nodeId: string,
  property: string,
) {
  return { trackId, targetKind, nodeId, property }
}

// ============================================================================
// 3. 应用动画
// ============================================================================

/**
 * 把 ParamPatch[] 应用到 stores。
 *
 * - graph 类型的 patch    → graphStore.updateNodeParams(不触发渲染)
 * - material 类型的 patch → materialStore.updateNodeParams(不触发渲染)
 * - runtime 类型的 patch  → runtimeStore.applyValuePatch(立即触发 GPU 重渲染)
 *
 * 值转换:
 * - evaluator 输出 number
 * - toParamValue 按 property 语义转成 JsonLiteral
 *   - 标量:直接 number
 *   - 数组(color):[v, v, v, 1]
 *   - 二维(center):[v, v]
 *
 * @param patches       ParamPatch[](由 evaluator.evaluateAllTracks 生成)
 * @param graphStore    RenderGraph store(实现 ParamUpdatableStore)
 * @param materialStore MaterialGraph store(实现 ParamUpdatableStore)
 * @param runtimeStore  可选 Runtime store(实现 RuntimePatchableStore,用于 'runtime' 目标)
 * @returns 应用了多少个 patch
 */
export function applyAnimations(
  patches: ParamPatch[],
  graphStore: ParamUpdatableStore | null,
  materialStore: ParamUpdatableStore | null,
  runtimeStore: RuntimePatchableStore | null = null,
): number {
  let applied = 0
  for (const patch of patches) {
    const value = toParamValue(patch.property, patch.value)
    if (patch.targetKind === 'graph' && graphStore) {
      graphStore.updateNodeParams(patch.nodeId, { [patch.property]: value })
      applied++
    } else if (patch.targetKind === 'material' && materialStore) {
      materialStore.updateNodeParams(patch.nodeId, { [patch.property]: value })
      applied++
    } else if (patch.targetKind === 'runtime' && runtimeStore) {
      // runtime 目标:把值直接应用到 RenderIR 的 layer/effect 参数
      // nodeId = layerId / effectId,property = paramKey
      // skipHistory = true 因为这是实时输入(每帧都更新,不应记入历史)
      runtimeStore.applyValuePatch(patch.nodeId, patch.property, value, { skipHistory: true })
      applied++
    }
  }
  return applied
}

/**
 * 应用单个 patch 到指定 store。
 */
export function applyPatch(
  patch: ParamPatch,
  store: ParamUpdatableStore,
): boolean {
  const value = toParamValue(patch.property, patch.value)
  store.updateNodeParams(patch.nodeId, { [patch.property]: value })
  return true
}

/**
 * 按 nodeId 分组 patches(便于批量更新同一节点的多个参数)。
 *
 * @returns Map<nodeId, ParamPatch[]>
 */
export function groupPatchesByNode(
  patches: ParamPatch[],
): Map<string, ParamPatch[]> {
  const grouped = new Map<string, ParamPatch[]>()
  for (const patch of patches) {
    const key = `${patch.targetKind}:${patch.nodeId}`
    const list = grouped.get(key)
    if (list) {
      list.push(patch)
    } else {
      grouped.set(key, [patch])
    }
  }
  return grouped
}

/**
 * 把同一节点的多个 patches 合并为单个 updateNodeParams 调用。
 *
 * 注意:'runtime' 目标不支持合并(每个 applyValuePatch 都是独立调用,因为会触发渲染)。
 *
 * @returns 应用次数(每个节点算 1 次;runtime 目标按 patch 次数算)
 */
export function applyAnimationsGrouped(
  patches: ParamPatch[],
  graphStore: ParamUpdatableStore | null,
  materialStore: ParamUpdatableStore | null,
  runtimeStore: RuntimePatchableStore | null = null,
): number {
  const grouped = groupPatchesByNode(patches)
  let applied = 0

  for (const [key, nodePatches] of grouped) {
    const [targetKind, nodeId] = key.split(':') as [ParamPatch['targetKind'], string]

    if (targetKind === 'runtime') {
      // runtime 目标:逐个应用(每个 patch 都触发一次 applyValuePatch)
      if (!runtimeStore) continue
      for (const p of nodePatches) {
        const value = toParamValue(p.property, p.value)
        runtimeStore.applyValuePatch(nodeId, p.property, value, { skipHistory: true })
        applied++
      }
      continue
    }

    const store = targetKind === 'graph' ? graphStore : materialStore
    if (!store) continue

    const params: Record<string, JsonLiteral> = {}
    for (const p of nodePatches) {
      params[p.property] = toParamValue(p.property, p.value)
    }
    store.updateNodeParams(nodeId, params)
    applied++
  }

  return applied
}
