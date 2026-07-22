/**
 * Reference Graph Store(Step 35.2)— 引用图 Pinia Store。
 *
 * 响应式触发:每次修改 graph 后用 `graph.value = { ...graph.value, adjacency: new Map(...), reverseIndex: new Map(...) }` 替换。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  type Reference,
  type ReferenceGraph,
  type ReferenceType,
  addReference,
  clearReferenceGraph,
  createReference,
  createReferenceGraph,
  getAllReferences,
  getInDegree,
  getOutDegree,
  getReferenceById,
  getReferenceCount,
  getReferences,
  getReferencesByType,
  getReferencers,
  hasReference,
  isAssetInGraph,
  removeAllReferencesForAsset,
  removeReference,
} from './referenceGraph'

export const useReferenceGraphStore = defineStore('pf-reference-graph', () => {
  const graph = ref<ReferenceGraph>(createReferenceGraph())

  /** 所有引用列表 */
  const all = computed<Reference[]>(() => getAllReferences(graph.value))

  /** 引用总数 */
  const count = computed<number>(() => getReferenceCount(graph.value))

  /** 是否为空 */
  const isEmpty = computed<boolean>(() => count.value === 0)

  /** 添加引用 */
  function add(
    sourceId: string,
    targetId: string,
    type: ReferenceType = 'uses',
    note?: string,
  ): Reference {
    const ref = createReference(sourceId, targetId, type, note)
    graph.value = addReference(graph.value, ref)
    return ref
  }

  /** 移除引用(按 ID) */
  function remove(referenceId: string): void {
    graph.value = removeReference(graph.value, referenceId)
  }

  /** 移除资产的所有引用 */
  function removeAllForAsset(assetId: string): void {
    graph.value = removeAllReferencesForAsset(graph.value, assetId)
  }

  /** 清空 */
  function clear(): void {
    graph.value = clearReferenceGraph(graph.value)
  }

  /** 重置 */
  function reset(): void {
    graph.value = createReferenceGraph()
  }

  // —— 查询 ——

  function refsOf(sourceId: string): Reference[] {
    return getReferences(graph.value, sourceId)
  }

  function refBy(targetId: string): Reference[] {
    return getReferencers(graph.value, targetId)
  }

  function has(sourceId: string, targetId: string, type?: ReferenceType): boolean {
    return hasReference(graph.value, sourceId, targetId, type)
  }

  function getById(referenceId: string): Reference | undefined {
    return getReferenceById(graph.value, referenceId)
  }

  function listByType(type: ReferenceType): Reference[] {
    return getReferencesByType(graph.value, type)
  }

  function outDegree(sourceId: string): number {
    return getOutDegree(graph.value, sourceId)
  }

  function inDegree(targetId: string): number {
    return getInDegree(graph.value, targetId)
  }

  function isInGraph(assetId: string): boolean {
    return isAssetInGraph(graph.value, assetId)
  }

  return {
    graph,
    all,
    count,
    isEmpty,
    add,
    remove,
    removeAllForAsset,
    clear,
    reset,
    refsOf,
    refBy,
    has,
    getById,
    listByType,
    outDegree,
    inDegree,
    isInGraph,
  }
})
