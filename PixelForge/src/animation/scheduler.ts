/**
 * Scheduler(Step 29.8)— 60FPS 帧调度器。
 *
 * 职责:
 * - startFrameLoop:   启动 requestAnimationFrame 循环,每帧调用 callback(dt)
 * - stopFrameLoop:    停止循环
 * - FrameLoopControl: 控制句柄(start / stop / isRunning)
 *
 * 与 editor/timeline/player.ts 的区别:
 * - editor/player: 把 rAF 循环和 store 状态耦合在一起
 * - scheduler(本模块): 纯 rAF 循环,不依赖任何 store,由 player 组合使用
 *
 * 用法:
 *   const loop = startFrameLoop((dt, now) => {
 *     player.update(dt)
 *   })
 *   // 需要停止时:
 *   loop.stop()
 */

// ============================================================================
// 1. 帧循环控制接口
// ============================================================================

/**
 * 帧循环控制句柄。
 *
 * - stop:     停止循环(cancelAnimationFrame)
 * - isRunning: 是否正在运行
 * - getFps:   获取实际 FPS(基于最近帧间隔)
 */
export interface FrameLoopControl {
  stop: () => void
  start: () => void
  isRunning: () => boolean
  getFps: () => number
}

/**
 * 帧回调签名。
 *
 * @param dt  距上一帧的增量时间(秒)
 * @param now 当前时间戳(毫秒,来自 performance.now())
 */
export type FrameCallback = (dt: number, now: number) => void

// ============================================================================
// 2. 启动帧循环
// ============================================================================

/**
 * 启动 requestAnimationFrame 帧循环。
 *
 * 特性:
 * - 每帧调用 callback(dt, now)
 * - dt 单位为秒(由毫秒转换)
 * - 自动跳过异常间隔(如标签页切换后的大 dt,钳制到 0.1 秒)
 * - 实时计算 FPS(基于最近 60 帧的平均间隔)
 *
 * @param callback 每帧回调
 * @param options  可选配置(autoStart=false 时不立即启动)
 * @returns FrameLoopControl
 */
export function startFrameLoop(
  callback: FrameCallback,
  options: { autoStart?: boolean } = {},
): FrameLoopControl {
  const { autoStart = true } = options
  let rafId: number | null = null
  let lastTs = 0

  // FPS 计算(滑动窗口)
  const frameTimes: number[] = []
  const MAX_FRAME_SAMPLES = 60
  let currentFps = 0

  function frame(now: number) {
    if (lastTs === 0) {
      lastTs = now
      rafId = requestAnimationFrame(frame)
      return
    }

    let delta = now - lastTs  // 毫秒
    lastTs = now

    // 钳制:标签页切换后 delta 可能很大(几秒),限制到 100ms 避免动画跳跃
    if (delta > 100) delta = 100
    if (delta < 0) delta = 0

    const dt = delta / 1000  // 转秒

    // 更新 FPS 滑动窗口
    frameTimes.push(delta)
    if (frameTimes.length > MAX_FRAME_SAMPLES) {
      frameTimes.shift()
    }
    const avgDelta = frameTimes.reduce((s, d) => s + d, 0) / frameTimes.length
    currentFps = avgDelta > 0 ? 1000 / avgDelta : 0

    // 调用回调(捕获错误避免中断循环)
    try {
      callback(dt, now)
    } catch (e) {
      // 错误打印到控制台,但不中断循环
      console.error('[FrameLoop] callback error:', e)
    }

    rafId = requestAnimationFrame(frame)
  }

  function start() {
    if (rafId !== null) return
    lastTs = 0
    frameTimes.length = 0
    rafId = requestAnimationFrame(frame)
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    lastTs = 0
  }

  function isRunning() {
    return rafId !== null
  }

  function getFps() {
    return currentFps
  }

  if (autoStart) start()

  return { stop, start, isRunning, getFps }
}

// ============================================================================
// 3. 便捷:固定步长帧循环
// ============================================================================

/**
 * 固定步长帧循环(用于物理模拟等需要固定 dt 的场景)。
 *
 * - 每帧累积时间,按 fixedDt 步长分步调用 callback
 * - 剩余时间累积到下一帧(避免抖动)
 *
 * @param callback 每步回调(参数:步序号)
 * @param fixedDt  固定步长(秒,默认 1/60)
 * @param maxSteps 单帧最大步数(防止死循环,默认 5)
 */
export function startFixedTimestepLoop(
  callback: (dt: number) => void,
  fixedDt: number = 1 / 60,
  maxSteps: number = 5,
): FrameLoopControl {
  let accumulator = 0
  return startFrameLoop((dt) => {
    accumulator += dt
    let steps = 0
    while (accumulator >= fixedDt && steps < maxSteps) {
      callback(fixedDt)
      accumulator -= fixedDt
      steps++
    }
    // 若超过 maxSteps,丢弃剩余(避免追赶导致卡顿)
    if (steps >= maxSteps) accumulator = 0
  })
}
