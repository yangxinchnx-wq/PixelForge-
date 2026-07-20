import { DEFAULT_AUTOSAVE_INTERVAL_MS } from './types'

/**
 * 自动保存管理器 —— 周期性触发保存回调。
 *
 * 设计原则:
 * - 仅在 dirty 时触发实际保存(避免无谓 IO)
 * - 支持手动 flush(组件卸载时立即保存最后一次)
 * - 支持暂停 / 恢复(例如批量播放时暂停以避免性能开销)
 * - 不持有 store 引用,通过回调让调用方决定如何保存
 *
 * 用法:
 *   const autosave = createAutosaver(() => projectStore.autosave(runtime, timeline, history))
 *   autosave.start()
 *   // 编辑时调用 projectStore.markDirty()
 *   autosave.flush()  // 卸载前立即保存
 *   autosave.stop()
 */

export interface Autosaver {
  /** 启动周期性自动保存(若已启动则 no-op) */
  start: () => void
  /** 停止自动保存 */
  stop: () => void
  /** 暂停(不卸载定时器,但跳过保存,用于播放等场景) */
  pause: () => void
  /** 恢复自动保存 */
  resume: () => void
  /** 立即触发一次保存(不影响周期) */
  flush: () => void
  /** 是否正在运行 */
  isRunning: () => boolean
  /** 是否被暂停 */
  isPaused: () => boolean
}

export function createAutosaver(
  saveCallback: () => void | Promise<void>,
  options: { intervalMs?: number } = {},
): Autosaver {
  const intervalMs = options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS
  let timerId: ReturnType<typeof setInterval> | null = null
  let paused = false

  function tick() {
    if (paused) return
    try {
      void saveCallback()
    } catch (e) {
      console.warn('[autosave] 自动保存失败:', e)
    }
  }

  function start() {
    if (timerId !== null) return
    timerId = setInterval(tick, intervalMs)
  }

  function stop() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  function pause() {
    paused = true
  }

  function resume() {
    paused = false
  }

  function flush() {
    if (paused) return
    try {
      void saveCallback()
    } catch (e) {
      console.warn('[autosave] flush 失败:', e)
    }
  }

  function isRunning() {
    return timerId !== null
  }

  function isPaused() {
    return paused
  }

  return { start, stop, pause, resume, flush, isRunning, isPaused }
}
