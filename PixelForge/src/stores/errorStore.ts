/**
 * Error Store(Step 40.4)— 全局错误状态管理 + 通知队列。
 *
 * 职责:
 * - 维护错误队列(支持多条同时存在,最多 50 条,LRU 淘汰)
 * - 提供错误等级分类通知(error / warning / info 三级 toast)
 * - 自动从未知错误归一化为结构化错误(复用 classifyError)
 * - 提供 dismiss / clear / retry 操作
 * - 支持错误计数统计(按 severity 分组)
 *
 * 设计原则:
 * - 不替换 runtime store 的 error/runtimeError 字段(向后兼容)
 * - 作为全局错误通知中心,所有 UI 错误提示统一走此 store
 * - 错误条目带唯一 id,支持单条 dismiss
 * - fatal 级别错误会阻塞 UI(需用户确认才能 dismiss)
 *
 * 数据流:
 *   try/catch → errorStore.push(error) → classifyError → 队列 + 通知
 *   ErrorBoundary → errorStore.push(error) → 队列 + 通知
 *   UI 组件 → errorStore.dismiss(id) → 从队列移除
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { classifyError } from '@/shared/errors'
import type { RuntimeErrorInfo } from '@/runtime/types'

// ============================================================================
// 类型定义
// ============================================================================

/** 错误通知级别(比 ErrorSeverity 更简化,用于 UI 展示) */
export type NotificationLevel = 'error' | 'warning' | 'info'

/** 错误条目(队列中的单元) */
export interface ErrorEntry {
  /** 唯一 ID */
  id: string
  /** 错误码(来自 classifyError 归一化) */
  code: string
  /** 错误消息(用户可见) */
  message: string
  /** 通知级别(error / warning / info) */
  level: NotificationLevel
  /** 来源模块 */
  source: string
  /** 是否可恢复 */
  recoverable: boolean
  /** 时间戳(ms) */
  timestamp: number
  /** 是否已读(用户查看过) */
  acknowledged: boolean
  /** 原始错误对象(用于调试,不展示给用户) */
  original?: unknown
  /** 用户操作提示(可选,如"请检查 WebGPU 是否启用") */
  userHint?: string
}

/** 队列最大长度 */
export const MAX_ERROR_QUEUE_SIZE = 50

// ============================================================================
// 辅助函数
// ============================================================================

/** 生成错误条目 ID */
function genErrorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 把 ErrorSeverity 映射为 NotificationLevel。
 *
 * - fatal / error → error
 * - warning → warning
 * - info → info
 */
function severityToLevel(severity: string): NotificationLevel {
  if (severity === 'fatal' || severity === 'error') return 'error'
  if (severity === 'warning') return 'warning'
  return 'info'
}

/**
 * 从任意 caught 值创建 ErrorEntry。
 *
 * 内部使用 classifyError 归一化,提取 code / severity / source / recoverable。
 */
function createEntryFromCaught(
  caught: unknown,
  userHint?: string,
): ErrorEntry {
  const classified = classifyError(caught)
  const level = severityToLevel(classified.severity)
  return {
    id: genErrorId(),
    code: classified.code,
    message: classified.message,
    level,
    source: classified.source,
    recoverable: classified.recoverable,
    timestamp: Date.now(),
    acknowledged: false,
    original: caught,
    userHint,
  }
}

// ============================================================================
// Pinia Store
// ============================================================================

export const useErrorStore = defineStore('error-notifications', () => {
  /** 错误队列(最新在末尾) */
  const queue = ref<ErrorEntry[]>([])

  /** 当前高亮的错误(用于 toast 展示,null 表示无) */
  const activeError = ref<ErrorEntry | null>(null)

  // —— 计算属性 ——

  /** 队列长度 */
  const count = computed(() => queue.value.length)
  /** 是否为空 */
  const isEmpty = computed(() => queue.value.length === 0)
  /** error 级别数量 */
  const errorCount = computed(() => queue.value.filter((e) => e.level === 'error').length)
  /** warning 级别数量 */
  const warningCount = computed(() => queue.value.filter((e) => e.level === 'warning').length)
  /** info 级别数量 */
  const infoCount = computed(() => queue.value.filter((e) => e.level === 'info').length)
  /** 未确认错误数量 */
  const unacknowledgedCount = computed(() => queue.value.filter((e) => !e.acknowledged).length)
  /** 最近一条错误 */
  const latest = computed(() => queue.value[queue.value.length - 1] ?? null)

  // —— Actions ——

  /**
   * 推送错误到队列(核心入口)。
   *
   * @param caught    catch 块中的任意值
   * @param userHint  可选的用户提示文案
   * @returns 创建的 ErrorEntry id(用于 dismiss)
   */
  function push(caught: unknown, userHint?: string): string {
    const entry = createEntryFromCaught(caught, userHint)
    queue.value.push(entry)
    // LRU 淘汰:超过上限移除最早的
    if (queue.value.length > MAX_ERROR_QUEUE_SIZE) {
      queue.value.shift()
    }
    // 设置为当前高亮错误(最新错误优先展示)
    activeError.value = entry
    return entry.id
  }

  /**
   * 推送已结构化的 RuntimeErrorInfo(跳过 classifyError,直接使用)。
   */
  function pushStructured(error: RuntimeErrorInfo, userHint?: string): string {
    const entry: ErrorEntry = {
      id: genErrorId(),
      code: error.code,
      message: error.message,
      level: severityToLevel(error.severity),
      source: error.source,
      recoverable: error.recoverable,
      timestamp: Date.now(),
      acknowledged: false,
      original: error,
      userHint,
    }
    queue.value.push(entry)
    if (queue.value.length > MAX_ERROR_QUEUE_SIZE) {
      queue.value.shift()
    }
    activeError.value = entry
    return entry.id
  }

  /**
   * 推送简单文本消息(无需 classifyError,直接构造)。
   *
   * 用于已知错误场景,如校验失败提示。
   */
  function pushMessage(
    message: string,
    level: NotificationLevel = 'error',
    userHint?: string,
  ): string {
    const entry: ErrorEntry = {
      id: genErrorId(),
      code: 'ui/user-message',
      message,
      level,
      source: 'unknown',
      recoverable: level !== 'error',
      timestamp: Date.now(),
      acknowledged: false,
      userHint,
    }
    queue.value.push(entry)
    if (queue.value.length > MAX_ERROR_QUEUE_SIZE) {
      queue.value.shift()
    }
    activeError.value = entry
    return entry.id
  }

  /**
   * 确认错误(标记为已读)。
   */
  function acknowledge(id: string): void {
    const entry = queue.value.find((e) => e.id === id)
    if (entry) {
      entry.acknowledged = true
      // 如果是当前高亮错误,清除高亮
      if (activeError.value?.id === id) {
        activeError.value = null
      }
    }
  }

  /**
   * 移除单条错误(dismiss)。
   */
  function dismiss(id: string): void {
    const idx = queue.value.findIndex((e) => e.id === id)
    if (idx >= 0) {
      queue.value.splice(idx, 1)
      if (activeError.value?.id === id) {
        activeError.value = queue.value[queue.value.length - 1] ?? null
      }
    }
  }

  /**
   * 清除当前高亮错误(不删除队列,只是不展示 toast)。
   */
  function dismissActive(): void {
    activeError.value = null
  }

  /**
   * 清空所有错误。
   */
  function clear(): void {
    queue.value = []
    activeError.value = null
  }

  /**
   * 清空已确认的错误。
   */
  function clearAcknowledged(): void {
    queue.value = queue.value.filter((e) => !e.acknowledged)
  }

  /**
   * 按 level 过滤错误。
   */
  function filterByLevel(level: NotificationLevel): ErrorEntry[] {
    return queue.value.filter((e) => e.level === level)
  }

  /**
   * 按 source 过滤错误。
   */
  function filterBySource(source: string): ErrorEntry[] {
    return queue.value.filter((e) => e.source === source)
  }

  return {
    // state
    queue,
    activeError,
    // computed
    count,
    isEmpty,
    errorCount,
    warningCount,
    infoCount,
    unacknowledgedCount,
    latest,
    // actions
    push,
    pushStructured,
    pushMessage,
    acknowledge,
    dismiss,
    dismissActive,
    clear,
    clearAcknowledged,
    filterByLevel,
    filterBySource,
  }
})
