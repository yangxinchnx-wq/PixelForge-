/**
 * Input Router(Step 30.4)— 实时输入信号路由中心。
 *
 * 职责:
 * - 管理所有输入信号(audio / midi / camera / sensor / ai)
 * - 提供 setSignal / getSignal / getAllSignals API
 * - 自动标记超时信号为 inactive
 * - 支持订阅(signal 变化时通知订阅者)
 *
 * 设计:
 * - 与具体输入源解耦(audio / midi / camera 模块只负责写入信号)
 * - 不直接驱动动画(由 inputDriver 消费信号)
 * - 单例模式(inputRouter),全局唯一
 *
 * 数据流:
 *   AudioAnalyzer / MidiInput / CameraInput
 *     ↓ setSignal(id, value)
 *   InputRouter.signals(Map)
 *     ↓ getSignal(id)
 *   InputDriver / AnimationBinding
 *     ↓
 *   GraphNode / MaterialNode
 */

import type { InputSourceKind, Signal } from './types'
import { SIGNAL_TIMEOUT_MS } from './types'

// ============================================================================
// 1. 订阅者类型
// ============================================================================

/**
 * 信号订阅者(当信号值变化时被调用)。
 *
 * @param signal 最新信号值
 */
export type SignalSubscriber = (signal: Signal) => void

// ============================================================================
// 2. InputRouter 类
// ============================================================================

/**
 * 输入路由器。
 *
 * 用法:
 *   import { inputRouter } from '@/input/inputRouter'
 *   inputRouter.setSignal('audio.bass', 0.8, 'AUDIO')
 *   const bass = inputRouter.getSignal('audio.bass')
 */
export class InputRouter {
  /** 信号表(id → Signal) */
  private signals = new Map<string, Signal>()
  /** 订阅者表(id → 订阅者列表) */
  private subscribers = new Map<string, SignalSubscriber[]>()
  /** 全局订阅者(任何信号变化都通知) */
  private globalSubscribers: SignalSubscriber[] = []

  // —— 写入 ——

  /**
   * 设置信号值。
   *
   * @param id      信号 id(如 'audio.bass')
   * @param value   信号值(通常 0-1)
   * @param source  来源类型
   * @param now     当前时间戳(可选,默认 performance.now())
   */
  setSignal(
    id: string,
    value: number,
    source: InputSourceKind,
    now: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ): void {
    const existing = this.signals.get(id)
    const signal: Signal = {
      id,
      value,
      timestamp: now,
      source,
      active: true,
    }
    this.signals.set(id, signal)

    // 仅在值变化时通知订阅者(避免无谓的通知)
    const changed = !existing || existing.value !== value
    if (changed) {
      this.notifySubscribers(signal)
    }
  }

  /**
   * 批量设置多个信号(同源,同时间戳)。
   *
   * 用于音频等每帧批量更新的场景。
   */
  setSignals(
    entries: Array<{ id: string; value: number }>,
    source: InputSourceKind,
    now?: number,
  ): void {
    const ts = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now())
    for (const { id, value } of entries) {
      this.setSignal(id, value, source, ts)
    }
  }

  // —— 读取 ——

  /**
   * 获取信号(返回副本)。
   *
   * @returns 信号,或 undefined(不存在)
   */
  getSignal(id: string): Signal | undefined {
    const s = this.signals.get(id)
    if (!s) return undefined
    // 检查超时
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - s.timestamp > SIGNAL_TIMEOUT_MS) {
      // 标记为 inactive(但不删除,以便查询历史)
      if (s.active) {
        s.active = false
      }
    }
    return { ...s }
  }

  /**
   * 获取信号值(不存在或 inactive 时返回 fallback)。
   */
  getSignalValue(id: string, fallback: number = 0): number {
    const s = this.getSignal(id)
    if (!s || !s.active) return fallback
    return s.value
  }

  /** 获取所有信号(副本) */
  getAllSignals(): Signal[] {
    return Array.from(this.signals.values()).map((s) => ({ ...s }))
  }

  /** 获取指定来源的所有信号 */
  getSignalsBySource(source: InputSourceKind): Signal[] {
    return this.getAllSignals().filter((s) => s.source === source)
  }

  /** 信号是否存在且活跃 */
  hasActiveSignal(id: string): boolean {
    const s = this.signals.get(id)
    if (!s) return false
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    return now - s.timestamp <= SIGNAL_TIMEOUT_MS
  }

  // —— 订阅 ——

  /**
   * 订阅特定信号的变化。
   *
   * @returns 取消订阅函数
   */
  subscribe(id: string, subscriber: SignalSubscriber): () => void {
    let list = this.subscribers.get(id)
    if (!list) {
      list = []
      this.subscribers.set(id, list)
    }
    list.push(subscriber)
    return () => {
      const arr = this.subscribers.get(id)
      if (!arr) return
      const idx = arr.indexOf(subscriber)
      if (idx >= 0) arr.splice(idx, 1)
      if (arr.length === 0) this.subscribers.delete(id)
    }
  }

  /**
   * 订阅所有信号的变化。
   *
   * @returns 取消订阅函数
   */
  subscribeAll(subscriber: SignalSubscriber): () => void {
    this.globalSubscribers.push(subscriber)
    return () => {
      const idx = this.globalSubscribers.indexOf(subscriber)
      if (idx >= 0) this.globalSubscribers.splice(idx, 1)
    }
  }

  /** 通知订阅者 */
  private notifySubscribers(signal: Signal): void {
    // 特定信号订阅者
    const list = this.subscribers.get(signal.id)
    if (list) {
      for (const fn of list) {
        try {
          fn(signal)
        } catch (e) {
          console.error(`[InputRouter] subscriber error for "${signal.id}":`, e)
        }
      }
    }
    // 全局订阅者
    for (const fn of this.globalSubscribers) {
      try {
        fn(signal)
      } catch (e) {
        console.error('[InputRouter] global subscriber error:', e)
      }
    }
  }

  // —— 维护 ——

  /** 清除所有信号 */
  clear(): void {
    this.signals.clear()
    this.subscribers.clear()
    this.globalSubscribers.length = 0
  }

  /** 删除指定信号 */
  removeSignal(id: string): boolean {
    return this.signals.delete(id)
  }

  /** 清除超时信号(标记为 inactive 或删除) */
  pruneInactive(removeInsteadOfMark: boolean = false): number {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    let count = 0
    for (const [id, s] of this.signals) {
      if (now - s.timestamp > SIGNAL_TIMEOUT_MS) {
        if (removeInsteadOfMark) {
          this.signals.delete(id)
        } else {
          s.active = false
        }
        count++
      }
    }
    return count
  }

  /** 当前信号数量 */
  get size(): number {
    return this.signals.size
  }
}

// ============================================================================
// 3. 单例
// ============================================================================

/**
 * 全局 InputRouter 单例。
 *
 * 所有输入源(audio / midi / camera)写入同一个实例,
 * 所有消费者(inputDriver / binding)读取同一个实例。
 */
export const inputRouter = new InputRouter()

/**
 * 重置单例(用于测试)。
 *
 * 注意:生产代码不应调用此函数。
 */
export function resetInputRouterForTesting(): void {
  inputRouter.clear()
}
