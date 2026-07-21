/**
 * selectionStore(Step 31.4)— Clip 多选状态管理。
 *
 * 职责:
 * - 维护当前选中的 Clip ID 集合(Set<string>)
 * - 提供单选 / Ctrl 切换选 / Shift 范围选 / 全选 / 反选 / 框选 API
 * - 维护"主选中" clip(primary,用于 Inspector 显示 + 拖拽基准)
 * - 维护框选矩形(用于 UI 高亮)
 *
 * 不职责:
 * - 不维护 Clip 数据本身(由 timelineStore 管理)
 * - 不直接修改 Clip(只管理 selection 状态)
 *
 * 选择模式:
 * - 'replace': 替换当前选择(默认点击行为)
 * - 'toggle':  Ctrl+点击,切换选中状态
 * - 'add':     Shift+点击,追加到当前选择
 * - 'range':   Shift+点击同一轨道,选区间内所有 clip
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type SelectionMode = 'replace' | 'toggle' | 'add' | 'range'

export interface ClipSelection {
  /** 选中的 Clip ID 集合(无序) */
  ids: Set<string>
  /** 主选中 Clip ID(最后一次点击的,用于 Inspector 显示 + 拖拽基准) */
  primaryId: string | null
  /** 框选矩形(内容坐标,像素;null 表示未在框选) */
  marqueeRect: { x: number; y: number; width: number; height: number } | null
}

export interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

export const useClipSelectionStore = defineStore('pf-clip-selection', () => {
  // ============================================================================
  // 1. State
  // ============================================================================

  const ids = ref<Set<string>>(new Set())
  const primaryId = ref<string | null>(null)
  const marqueeRect = ref<MarqueeRect | null>(null)
  /** 最后一次单击的 Clip(用于 Shift range 选择基准) */
  const lastClickedId = ref<string | null>(null)

  // ============================================================================
  // 2. Getters
  // ============================================================================

  const count = computed(() => ids.value.size)
  const hasSelection = computed(() => ids.value.size > 0)
  const isMulti = computed(() => ids.value.size > 1)
  const selectedIds = computed<string[]>(() => Array.from(ids.value))

  function isSelected(clipId: string): boolean {
    return ids.value.has(clipId)
  }

  // ============================================================================
  // 3. Actions — 单个 clip 选择
  // ============================================================================

  /**
   * 选择一个 Clip。
   *
   * @param clipId  Clip ID
   * @param mode    选择模式(默认 'replace')
   */
  function select(clipId: string, mode: SelectionMode = 'replace'): void {
    const next = new Set(ids.value)

    if (mode === 'replace') {
      next.clear()
      next.add(clipId)
      primaryId.value = clipId
    } else if (mode === 'toggle') {
      if (next.has(clipId)) {
        next.delete(clipId)
        // 主选中被取消,选最后一个 remaining
        if (primaryId.value === clipId) {
          primaryId.value = next.size > 0 ? Array.from(next)[next.size - 1] : null
        }
      } else {
        next.add(clipId)
        primaryId.value = clipId
      }
    } else if (mode === 'add') {
      next.add(clipId)
      primaryId.value = clipId
    } else if (mode === 'range') {
      // range 模式:不清空,追加(实际范围选择由 selectRange 处理)
      next.add(clipId)
      primaryId.value = clipId
    }

    ids.value = next
    lastClickedId.value = clipId
  }

  /**
   * 范围选择(Shift+点击):选择 fromId 到 toId 之间所有 clip(基于 clipId 列表顺序)。
   *
   * @param orderedIds 当前时间轴上有序的 Clip ID 列表(按 timelineStart 排序)
   * @param fromId     范围起点 Clip ID
   * @param toId       范围终点 Clip ID
   * @param additive   是否追加到当前选择(false=替换)
   */
  function selectRange(
    orderedIds: string[],
    fromId: string,
    toId: string,
    additive = false,
  ): void {
    const fromIdx = orderedIds.indexOf(fromId)
    const toIdx = orderedIds.indexOf(toId)
    if (fromIdx < 0 || toIdx < 0) return

    const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
    const rangeIds = orderedIds.slice(start, end + 1)

    const next = additive ? new Set(ids.value) : new Set<string>()
    for (const id of rangeIds) next.add(id)
    ids.value = next
    primaryId.value = toId
    lastClickedId.value = toId
  }

  // ============================================================================
  // 4. Actions — 批量选择
  // ============================================================================

  /** 全选 */
  function selectAll(clipIds: string[]): void {
    ids.value = new Set(clipIds)
    primaryId.value = clipIds.length > 0 ? clipIds[clipIds.length - 1] : null
    lastClickedId.value = primaryId.value
  }

  /** 反选 */
  function invertSelection(allClipIds: string[]): void {
    const next = new Set<string>()
    for (const id of allClipIds) {
      if (!ids.value.has(id)) next.add(id)
    }
    ids.value = next
    primaryId.value = next.size > 0 ? Array.from(next)[next.size - 1] : null
  }

  /** 清空选择 */
  function clear(): void {
    ids.value = new Set()
    primaryId.value = null
    lastClickedId.value = null
    marqueeRect.value = null
  }

  /** 从选择中移除一个 clip */
  function removeFromSelection(clipId: string): void {
    const next = new Set(ids.value)
    next.delete(clipId)
    ids.value = next
    if (primaryId.value === clipId) {
      primaryId.value = next.size > 0 ? Array.from(next)[next.size - 1] : null
    }
    if (lastClickedId.value === clipId) {
      lastClickedId.value = null
    }
  }

  /** 手动设置选择(用于粘贴后高亮新 clip 等) */
  function setSelection(clipIds: string[], primary?: string): void {
    ids.value = new Set(clipIds)
    primaryId.value = primary ?? (clipIds.length > 0 ? clipIds[clipIds.length - 1] : null)
    lastClickedId.value = primaryId.value
  }

  // ============================================================================
  // 5. Actions — 框选(marquee)
  // ============================================================================

  /** 开始框选 */
  function beginMarquee(x: number, y: number): void {
    marqueeRect.value = { x, y, width: 0, height: 0 }
  }

  /** 更新框选矩形 */
  function updateMarquee(x: number, y: number): void {
    if (!marqueeRect.value) return
    const rect = marqueeRect.value
    const newX = Math.min(rect.x, x)
    const newY = Math.min(rect.y, y)
    const newW = Math.abs(x - rect.x)
    const newH = Math.abs(y - rect.y)
    marqueeRect.value = { x: newX, y: newY, width: newW, height: newH }
  }

  /**
   * 结束框选:把与矩形相交的 clip 加入选择。
   *
   * @param hitClipIds 与矩形相交的 Clip ID 列表(由调用方通过碰撞检测得出)
   * @param additive   是否追加到当前选择
   */
  function endMarquee(hitClipIds: string[], additive = false): void {
    const next = additive ? new Set(ids.value) : new Set<string>()
    for (const id of hitClipIds) next.add(id)
    ids.value = next
    primaryId.value = next.size > 0 ? Array.from(next)[next.size - 1] : null
    marqueeRect.value = null
  }

  /** 取消框选(不应用选择结果) */
  function cancelMarquee(): void {
    marqueeRect.value = null
  }

  return {
    // state
    ids,
    primaryId,
    marqueeRect,
    lastClickedId,
    // getters
    count,
    hasSelection,
    isMulti,
    selectedIds,
    // actions
    isSelected,
    select,
    selectRange,
    selectAll,
    invertSelection,
    clear,
    removeFromSelection,
    setSelection,
    beginMarquee,
    updateMarquee,
    endMarquee,
    cancelMarquee,
  }
})
