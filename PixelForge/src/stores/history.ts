import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { ValuePatch } from '@/compiler/ir/patch'
import type { StructuralPatch } from '@/compiler/ir/patch'

/**
 * 编辑历史 store —— 实现 Undo / Redo(Command Pattern + Patch History Stack)。
 *
 * 设计原则:
 * - 只记录"编辑操作"(Inspector 改参数 / ParameterTrack 拖关键帧)
 * - 不记录"浏览操作"(seek / step / play / jump)
 *   由调用方通过 options.skipHistory 控制
 * - undo/redo 自身调用 applyValuePatch 时传 skipHistory: true(避免无限循环)
 * - 合并窗口:同 targetId.paramKey 的连续 patch 在 500ms 内合并为一条
 *   (避免拖动 slider 产生海量历史)
 *
 * 数据流:
 *   用户编辑 → applyValuePatch(skipHistory: false)
 *           → 读取 oldValue + 应用 patch + 调用 history.pushEntry
 *           → undoStack.push(entry)
 *
 *   Ctrl+Z  → history.undo(runtime)
 *           → applyValuePatch(targetId, paramKey, oldValue, skipHistory: true)
 *           → undoStack.pop, redoStack.push
 *
 *   Ctrl+Y  → history.redo(runtime)
 *           → applyValuePatch(targetId, paramKey, newValue, skipHistory: true)
 *           → redoStack.pop, undoStack.push
 *
 * 对应骨架 Phase F:Revision Layer(轻量版,完整 Revision Layer 后置)。
 */

/**
 * runtime store 的最小接口约束(避免与 useRuntimeStore 形成循环类型依赖)。
 * 只要传入的对象具备 applyValuePatch / applyStructuralPatch 方法即可。
 */
export interface RuntimeLike {
  applyValuePatch: (
    targetId: string,
    paramKey: string,
    value: ValuePatch['value'],
    options?: { skipHistory?: boolean },
  ) => boolean
  applyStructuralPatch: (
    targetId: string,
    field: StructuralPatch['field'],
    value: StructuralPatch['value'],
    options?: { skipHistory?: boolean },
  ) => boolean
}

export interface HistoryEntry {
  /** patchId(与 runtime.lastPatchId 对应) */
  id: string
  /** 可读描述,如 "layer_blend_circle1.radius -> 0.5" */
  description: string
  /** 创建时间戳 */
  timestamp: number
  /** 目标 layer id */
  targetId: string
  /** 目标参数 key（value patch 为 params key，structural patch 为 field 名） */
  paramKey: string
  /** 应用前的值(undo 时用) — 用 unknown 避免 JsonLiteral 递归类型深度问题 */
  oldValue: unknown
  /** 应用后的值(redo 时用) */
  newValue: unknown
  /** 最后一次合并更新时间(用于合并窗口判断) */
  lastTouched: number
  /** patch tier：'value' 为参数修改，'structural' 为结构修改(visible/blendMode)。默认 'value'。 */
  tier?: 'value' | 'structural'
}

/** 默认历史栈最大长度 */
const DEFAULT_MAX_SIZE = 100
/** 同一 targetId.paramKey 的合并时间窗口(ms) */
const DEFAULT_MERGE_WINDOW_MS = 500

export const useHistoryStore = defineStore('history', () => {
  const undoStack = ref<HistoryEntry[]>([])
  const redoStack = ref<HistoryEntry[]>([])
  const maxSize = ref(DEFAULT_MAX_SIZE)
  const mergeWindowMs = ref(DEFAULT_MERGE_WINDOW_MS)

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const undoCount = computed(() => undoStack.value.length)
  const redoCount = computed(() => redoStack.value.length)
  const lastEntry = computed<HistoryEntry | null>(() => {
    const stack = undoStack.value
    return stack.length > 0 ? stack[stack.length - 1] : null
  })
  const nextRedoEntry = computed<HistoryEntry | null>(() => {
    const stack = redoStack.value
    return stack.length > 0 ? stack[stack.length - 1] : null
  })

  /**
   * 推入历史栈,带合并窗口:
   * 如果栈顶 entry 与新 entry 是同一 targetId.paramKey 且在 mergeWindowMs 内,
   * 只更新 newValue / description / lastTouched,不新增条目。
   *
   * 推入新条目时清空 redoStack(用户开始新分支,旧 redo 被丢弃)。
   */
  function pushEntry(entry: Omit<HistoryEntry, 'timestamp' | 'lastTouched'>): void {
    const now = Date.now()
    const last = undoStack.value[undoStack.value.length - 1]

    if (
      last &&
      last.targetId === entry.targetId &&
      last.paramKey === entry.paramKey &&
      now - last.lastTouched < mergeWindowMs.value
    ) {
      // 合并:只更新 newValue 与描述,保留首次 oldValue
      last.newValue = entry.newValue
      last.description = entry.description
      last.lastTouched = now
      return
    }

    undoStack.value.push({
      ...entry,
      timestamp: now,
      lastTouched: now,
    })

    // 新分支:丢弃 redo 栈
    redoStack.value = []

    // 限制最大长度(丢弃最老的)
    while (undoStack.value.length > maxSize.value) {
      undoStack.value.shift()
    }
  }

  /**
   * Undo:把栈顶 entry 反向应用(用 oldValue 覆盖)。
   * 需要 runtime store 实例来调用 applyValuePatch / applyStructuralPatch。
   *
   * @returns 是否成功 undo
   */
  function undo(runtime: RuntimeLike): boolean {
    const entry = undoStack.value.pop()
    if (!entry) return false

    const ok = entry.tier === 'structural'
      ? runtime.applyStructuralPatch(
          entry.targetId,
          entry.paramKey as StructuralPatch['field'],
          entry.oldValue as StructuralPatch['value'],
          { skipHistory: true },
        )
      : runtime.applyValuePatch(
          entry.targetId,
          entry.paramKey,
          entry.oldValue as ValuePatch['value'],
          { skipHistory: true },
        )
    if (ok) {
      redoStack.value.push(entry)
    } else {
      // 失败:回滚 undo stack
      undoStack.value.push(entry)
    }
    return ok
  }

  /**
   * Redo:把 redo 栈顶 entry 正向应用(用 newValue 覆盖)。
   *
   * @returns 是否成功 redo
   */
  function redo(runtime: RuntimeLike): boolean {
    const entry = redoStack.value.pop()
    if (!entry) return false

    const ok = entry.tier === 'structural'
      ? runtime.applyStructuralPatch(
          entry.targetId,
          entry.paramKey as StructuralPatch['field'],
          entry.newValue as StructuralPatch['value'],
          { skipHistory: true },
        )
      : runtime.applyValuePatch(
          entry.targetId,
          entry.paramKey,
          entry.newValue as ValuePatch['value'],
          { skipHistory: true },
        )
    if (ok) {
      undoStack.value.push(entry)
    } else {
      redoStack.value.push(entry)
    }
    return ok
  }

  /** 清空整个历史(切换场景 / 重置时调用) */
  function clear(): void {
    undoStack.value = []
    redoStack.value = []
  }

  /** 调整合并窗口(测试用) */
  function setMergeWindow(ms: number): void {
    mergeWindowMs.value = ms
  }

  /** 调整最大长度(测试用) */
  function setMaxSize(size: number): void {
    maxSize.value = size
  }

  return {
    undoStack,
    redoStack,
    maxSize,
    mergeWindowMs,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    lastEntry,
    nextRedoEntry,
    pushEntry,
    undo,
    redo,
    clear,
    setMergeWindow,
    setMaxSize,
  }
})
