/**
 * 效果链 Pinia Store(Step 34)— 管理所有 Clip 的效果链状态。
 *
 * 职责:
 * - 维护 clipId → EffectChain 的映射
 * - 提供 actions: 添加/删除/移动/启用/禁用/更新效果
 * - 提供 computed: 当前选中 Clip 的效果链
 * - 与 timelineStore 的 selectionStore 联动
 *
 * 数据流:
 *   selectionStore.selectedClipId → currentChain(computed)
 *     → UI 渲染
 *     → 用户操作 → actions → 更新 chains Map
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import {
  type VideoEffect,
  type VideoEffectType,
  type VideoEffectParams,
  type EffectChain,
  type EffectPreset,
  createEffect,
  createEffectChain,
  appendEffect,
  insertEffect as insertEffectFn,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  updateEffectParams,
  renameEffect,
  setEffectCollapsed,
  findEffect,
  getEnabledEffects,
  getEffectCount,
  getEnabledCount,
  groupByCategory,
  applyPreset,
  BUILTIN_PRESETS,
  findPresetById,
} from './effectChain'

// ============================================================================
// Store 定义
// ============================================================================

export const useEffectChainStore = defineStore('effectChain', () => {
  // —— State ——

  /** clipId → EffectChain 映射 */
  const chains = ref<Map<string, EffectChain>>(new Map())

  /** 当前选中的 Clip ID(由 selectionStore 同步) */
  const currentClipId = ref<string | null>(null)

  // —— Getters / Computed ——

  /** 当前 Clip 的效果链 */
  const currentChain = computed<EffectChain | null>(() => {
    if (!currentClipId.value) return null
    return chains.value.get(currentClipId.value) ?? null
  })

  /** 当前效果列表 */
  const currentEffects = computed<VideoEffect[]>(() => {
    return currentChain.value?.effects ?? []
  })

  /** 当前启用的效果列表 */
  const currentEnabledEffects = computed<VideoEffect[]>(() => {
    if (!currentChain.value) return []
    return getEnabledEffects(currentChain.value)
  })

  /** 当前效果数量 */
  const currentEffectCount = computed<number>(() => {
    if (!currentChain.value) return 0
    return getEffectCount(currentChain.value)
  })

  /** 当前启用效果数量 */
  const currentEnabledCount = computed<number>(() => {
    if (!currentChain.value) return 0
    return getEnabledCount(currentChain.value)
  })

  /** 当前效果按大类分组 */
  const currentGrouped = computed<Record<string, VideoEffect[]>>(() => {
    if (!currentChain.value) return {}
    return groupByCategory(currentChain.value) as Record<string, VideoEffect[]>
  })

  /** 内置预设列表 */
  const presets = computed<EffectPreset[]>(() => BUILTIN_PRESETS)

  // —— Actions ——

  /** 设置当前 Clip ID */
  function setCurrentClip(clipId: string | null): void {
    currentClipId.value = clipId
  }

  /** 确保 Clip 有对应的效果链(没有则创建) */
  function ensureChain(clipId: string): EffectChain {
    let chain = chains.value.get(clipId)
    if (!chain) {
      chain = createEffectChain(clipId)
      chains.value.set(clipId, chain)
      // 触发响应式(替换 Map)
      chains.value = new Map(chains.value)
    }
    return chain
  }

  /** 获取指定 Clip 的效果链 */
  function getChain(clipId: string): EffectChain | null {
    return chains.value.get(clipId) ?? null
  }

  /** 添加效果到当前 Clip 的链尾 */
  function addEffect(type: VideoEffectType): VideoEffect | null {
    if (!currentClipId.value) return null
    const clipId = currentClipId.value
    const chain = ensureChain(clipId)
    const effect = createEffect(type)
    const updated = appendEffect(chain, effect)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
    return effect
  }

  /** 在指定位置插入效果 */
  function insertEffectAt(type: VideoEffectType, index: number): VideoEffect | null {
    if (!currentClipId.value) return null
    const clipId = currentClipId.value
    const chain = ensureChain(clipId)
    const effect = createEffect(type)
    const updated = insertEffectFn(chain, index, effect)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
    return effect
  }

  /** 删除效果 */
  function deleteEffect(effectId: string): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const updated = removeEffect(chain, effectId)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 移动效果 */
  function moveEffectOrder(effectId: string, direction: 'up' | 'down'): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const updated = moveEffect(chain, effectId, direction)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 启用/禁用效果 */
  function toggleEffect(effectId: string): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const effect = findEffect(chain, effectId)
    if (!effect) return
    const updated = setEffectEnabled(chain, effectId, !effect.enabled)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 设置效果启用状态 */
  function setEffectEnabledState(effectId: string, enabled: boolean): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const updated = setEffectEnabled(chain, effectId, enabled)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 更新效果参数 */
  function setEffectParams(
    effectId: string,
    params: Partial<VideoEffectParams>,
  ): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const updated = updateEffectParams(chain, effectId, params)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 重命名效果 */
  function setEffectName(effectId: string, name: string): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const updated = renameEffect(chain, effectId, name)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 切换折叠状态 */
  function toggleCollapsed(effectId: string): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    const chain = chains.value.get(clipId)
    if (!chain) return
    const effect = findEffect(chain, effectId)
    if (!effect) return
    const updated = setEffectCollapsed(chain, effectId, !effect.collapsed)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 应用预设到当前 Clip */
  function applyPresetToCurrent(presetId: string): void {
    if (!currentClipId.value) return
    const preset = findPresetById(presetId)
    if (!preset) return
    const clipId = currentClipId.value
    const chain = ensureChain(clipId)
    const updated = applyPreset(chain, preset)
    chains.value.set(clipId, updated)
    chains.value = new Map(chains.value)
  }

  /** 清空当前 Clip 的所有效果 */
  function clearAllEffects(): void {
    if (!currentClipId.value) return
    const clipId = currentClipId.value
    chains.value.set(clipId, createEffectChain(clipId))
    chains.value = new Map(chains.value)
  }

  /** 删除指定 Clip 的效果链(Clip 被删除时调用) */
  function removeChain(clipId: string): void {
    chains.value.delete(clipId)
    chains.value = new Map(chains.value)
    if (currentClipId.value === clipId) {
      currentClipId.value = null
    }
  }

  /** 重置整个 Store */
  function reset(): void {
    chains.value = new Map()
    currentClipId.value = null
  }

  return {
    // State
    chains,
    currentClipId,
    // Computed
    currentChain,
    currentEffects,
    currentEnabledEffects,
    currentEffectCount,
    currentEnabledCount,
    currentGrouped,
    presets,
    // Actions
    setCurrentClip,
    ensureChain,
    getChain,
    addEffect,
    insertEffectAt,
    deleteEffect,
    moveEffectOrder,
    toggleEffect,
    setEffectEnabledState,
    setEffectParams,
    setEffectName,
    toggleCollapsed,
    applyPresetToCurrent,
    clearAllEffects,
    removeChain,
    reset,
  }
})
