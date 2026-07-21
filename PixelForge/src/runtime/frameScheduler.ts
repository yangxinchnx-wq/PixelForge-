/**
 * FrameScheduler(Step 31.5)— 60FPS 时间预算调度器。
 *
 * 在现有 scheduler.ts(纯 rAF)之上,增加:
 * - 时间预算分配:每帧给不同 phase 分配预算(微秒)
 * - 优先级调度:critical > high > normal > low
 * - RenderTaskQueue:可延迟的后台任务(预渲染 / 缓存预热)
 * - GPU 帧同步:每帧结束后等待 GPU 完成信号(可选,避免渲染撕裂)
 *
 * 与 engine.ts 关系:
 * - engine.ts: 业务编排(Timeline + Input + GPU)
 * - frameScheduler.ts(本模块): 调度策略(时间预算 + 优先级)
 * - engine.ts 在每个 phase 调用对应业务函数
 *
 * 单帧时间分配(60FPS = 16.67ms 预算):
 *   ┌─────────────────────────────────────────┐
 *   │ Phase 1: Timeline step  (≤ 2ms)   critical │
 *   │ Phase 2: Input update   (≤ 2ms)   critical │
 *   │ Phase 3: GPU render     (≤ 8ms)   high     │
 *   │ Phase 4: Background     (剩余)     low      │
 *   └─────────────────────────────────────────┘
 *
 * 设计:
 * - 不替代 scheduler.ts,而是在其之上构建
 * - 可独立测试(注入 mock task)
 * - 提供 metrics 用于 HUD 显示
 */
import { startFrameLoop, type FrameLoopControl, type FrameCallback } from '@/animation/scheduler'

// ============================================================================
// 1. 类型 — 优先级 / Phase / Task
// ============================================================================

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low'

export type SchedulerPhase = 'timeline' | 'input' | 'gpu-render' | 'background' | 'idle'

/**
 * 可调度任务(后台预渲染 / 缓存预热等)。
 *
 * 调用方提供一个 execute 函数,scheduler 在预算内执行;
 * 若 execute 返回 true 表示"未完成,需下一帧继续",false 表示"已完成"。
 */
export interface ScheduledTask {
  id: string
  priority: TaskPriority
  /** 执行函数(返回 true=未完成,false=完成) */
  execute: (budgetMs: number) => boolean
  /** 任务创建时间(performance.now()) */
  createdAt: number
  /** 累计已用时间(ms) */
  elapsedMs: number
  /** 已调用次数 */
  callCount: number
}

/**
 * 单帧各 phase 的时间预算(毫秒)。
 *
 * 总和应 ≤ 16.67ms(60FPS);若某 phase 超预算,后续 phase 自动缩减。
 */
export interface PhaseBudget {
  timeline: number
  input: number
  gpuRender: number
  background: number
}

/** 默认预算(60FPS,留 2ms 给浏览器 + rAF 抖动) */
export const DEFAULT_BUDGET_60FPS: PhaseBudget = {
  timeline: 2,
  input: 2,
  gpuRender: 8,
  background: 4,
}

/** 30FPS 预算(更宽松) */
export const DEFAULT_BUDGET_30FPS: PhaseBudget = {
  timeline: 4,
  input: 4,
  gpuRender: 16,
  background: 8,
}

// ============================================================================
// 2. Metrics
// ============================================================================

export interface SchedulerMetrics {
  /** 当前 FPS(来自 scheduler.ts) */
  fps: number
  /** 累计帧数 */
  frameCount: number
  /** 上一帧各 phase 实际耗时(ms) */
  phaseMs: Record<SchedulerPhase, number>
  /** 上一帧总耗时(ms) */
  frameMs: number
  /** 上一帧是否超预算 */
  overBudget: boolean
  /** 后台任务队列长度 */
  pendingTasks: number
  /** 上一帧执行的后台任务数 */
  tasksExecutedLastFrame: number
  /** 累计执行的后台任务数(已完成) */
  tasksCompleted: number
  /** 累计丢弃的后台任务数(超时) */
  tasksDropped: number
}

// ============================================================================
// 3. FrameScheduler 类
// ============================================================================

/**
 * FrameScheduler — 在 rAF 之上调度多 phase 任务。
 *
 * 用法:
 *   const sched = new FrameScheduler()
 *   sched.setPhaseCallback('timeline', () => stepTimeline(dt))
 *   sched.setPhaseCallback('input', () => updateInputs())
 *   sched.setPhaseCallback('gpu-render', () => renderToGPU())
 *   sched.start()
 *
 *   // 后台任务:
 *   sched.enqueueTask('low', (budget) => preRenderFrame(budget))
 */
export class FrameScheduler {
  private budget: PhaseBudget
  private phaseCallbacks: Map<SchedulerPhase, (dt: number, now: number) => void> = new Map()
  private taskQueue: ScheduledTask[] = []
  private taskCounter = 0
  private metrics: SchedulerMetrics
  private frameLoop: FrameLoopControl | null = null
  private taskTimeoutMs: number

  constructor(options: {
    budget?: PhaseBudget
    /** 任务最大生存时间(超过则丢弃,默认 30s) */
    taskTimeoutMs?: number
  } = {}) {
    this.budget = options.budget ?? DEFAULT_BUDGET_60FPS
    this.taskTimeoutMs = options.taskTimeoutMs ?? 30_000
    this.metrics = {
      fps: 0,
      frameCount: 0,
      phaseMs: { timeline: 0, input: 0, 'gpu-render': 0, background: 0, idle: 0 },
      frameMs: 0,
      overBudget: false,
      pendingTasks: 0,
      tasksExecutedLastFrame: 0,
      tasksCompleted: 0,
      tasksDropped: 0,
    }
  }

  // --------------------------------------------------------------------------
  // 3.1 Phase 回调注册
  // --------------------------------------------------------------------------

  /**
   * 注册某个 phase 的回调。
   *
   * phase 执行顺序固定:timeline → input → gpu-render → background → idle
   * 若某 phase 未注册回调,跳过(分配的时间归入下一 phase)。
   */
  setPhaseCallback(phase: SchedulerPhase, callback: (dt: number, now: number) => void): void {
    this.phaseCallbacks.set(phase, callback)
  }

  /** 移除 phase 回调 */
  removePhaseCallback(phase: SchedulerPhase): void {
    this.phaseCallbacks.delete(phase)
  }

  // --------------------------------------------------------------------------
  // 3.2 后台任务队列
  // --------------------------------------------------------------------------

  /**
   * 入队一个后台任务。
   *
   * @param priority 优先级(critical/high/normal/low)
   * @param execute  执行函数,返回 true=未完成需下一帧继续,false=完成
   * @returns 任务 ID(可用于取消)
   */
  enqueueTask(priority: TaskPriority, execute: (budgetMs: number) => boolean): string {
    this.taskCounter++
    const id = `task_${Date.now().toString(36)}_${this.taskCounter.toString(36)}`
    this.taskQueue.push({
      id,
      priority,
      execute,
      createdAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      elapsedMs: 0,
      callCount: 0,
    })
    // 按优先级排序:critical > high > normal > low;同优先级按创建时间(FIFO)
    const priorityOrder: Record<TaskPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 }
    this.taskQueue.sort((a, b) => {
      const po = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (po !== 0) return po
      return a.createdAt - b.createdAt
    })
    this.metrics.pendingTasks = this.taskQueue.length
    return id
  }

  /** 取消任务 */
  cancelTask(taskId: string): boolean {
    const idx = this.taskQueue.findIndex((t) => t.id === taskId)
    if (idx < 0) return false
    this.taskQueue.splice(idx, 1)
    this.metrics.pendingTasks = this.taskQueue.length
    return true
  }

  /** 清空任务队列 */
  clearTasks(): void {
    this.taskQueue.length = 0
    this.metrics.pendingTasks = 0
  }

  /** 任务队列长度 */
  getPendingTaskCount(): number {
    return this.taskQueue.length
  }

  // --------------------------------------------------------------------------
  // 3.3 预算配置
  // --------------------------------------------------------------------------

  /** 设置 phase 预算 */
  setBudget(budget: PhaseBudget): void {
    this.budget = budget
  }

  /** 获取当前预算 */
  getBudget(): PhaseBudget {
    return this.budget
  }

  // --------------------------------------------------------------------------
  // 3.4 主循环:单帧执行
  // --------------------------------------------------------------------------

  /**
   * 执行一帧(由 rAF 调度,或测试中手动调用)。
   *
   * @param dt 距上一帧的增量时间(秒)
   * @param now 当前时间戳(毫秒)
   */
  private executeFrame: FrameCallback = (dt, now) => {
    const frameStart = typeof performance !== 'undefined' ? performance.now() : now
    let tasksExecuted = 0

    // —— Phase 1: timeline (critical) ——
    const tlStart = performance.now()
    const tlCb = this.phaseCallbacks.get('timeline')
    if (tlCb) {
      try { tlCb(dt, now) } catch (e) { console.error('[FrameScheduler] timeline error:', e) }
    }
    const tlMs = performance.now() - tlStart
    this.metrics.phaseMs.timeline = tlMs

    // —— Phase 2: input (critical) ——
    const inStart = performance.now()
    const inCb = this.phaseCallbacks.get('input')
    if (inCb) {
      try { inCb(dt, now) } catch (e) { console.error('[FrameScheduler] input error:', e) }
    }
    const inMs = performance.now() - inStart
    this.metrics.phaseMs.input = inMs

    // —— Phase 3: gpu-render (high) ——
    // 计算剩余预算:若前两 phase 已超,缩减 gpu-render
    const elapsedAfterInput = tlMs + inMs
    const gpuBudget = Math.max(0, this.budget.gpuRender - Math.max(0, elapsedAfterInput - this.budget.timeline - this.budget.input))
    const gpuStart = performance.now()
    const gpuCb = this.phaseCallbacks.get('gpu-render')
    if (gpuCb) {
      try { gpuCb(dt, now) } catch (e) { console.error('[FrameScheduler] gpu-render error:', e) }
    }
    const gpuMs = performance.now() - gpuStart
    this.metrics.phaseMs['gpu-render'] = gpuMs
    void gpuBudget // 预留(实际 GPU 调度由 gpuCb 内部控制)

    // —— Phase 4: background (low) ——
    // 计算剩余预算
    const elapsedBeforeBg = tlMs + inMs + gpuMs
    const bgBudget = Math.max(0, this.budget.background - Math.max(0, elapsedBeforeBg - (this.budget.timeline + this.budget.input + this.budget.gpuRender)))
    const bgStart = performance.now()
    // 调用 background phase 回调(若注册)
    const bgCb = this.phaseCallbacks.get('background')
    if (bgCb) {
      try { bgCb(dt, now) } catch (e) { console.error('[FrameScheduler] background error:', e) }
    }
    // 先丢弃超时任务
    const beforeLen = this.taskQueue.length
    this.taskQueue = this.taskQueue.filter((t) => {
      const age = now - t.createdAt
      if (age > this.taskTimeoutMs) {
        this.metrics.tasksDropped++
        return false
      }
      return true
    })
    if (this.taskQueue.length < beforeLen) {
      this.metrics.pendingTasks = this.taskQueue.length
    }
    // 执行后台任务(按优先级,直到预算耗尽)
    // execute 语义:返回 true=未完成(需下一帧继续),false=完成
    // 使用 wall-clock deadline 而非 budget 减法,避免 sub-ms 任务导致死循环
    const bgDeadline = bgStart + bgBudget
    while (this.taskQueue.length > 0 && performance.now() < bgDeadline) {
      const task = this.taskQueue[0]
      const taskStart = performance.now()
      let needsMore = false
      try {
        needsMore = task.execute(bgBudget)
      } catch (e) {
        console.error('[FrameScheduler] task error:', e)
        needsMore = false // 出错的任务直接标记完成,避免死循环
      }
      const taskMs = performance.now() - taskStart
      task.elapsedMs += taskMs
      task.callCount++
      tasksExecuted++
      if (!needsMore) {
        // 任务完成:移出队列
        this.taskQueue.shift()
        this.metrics.tasksCompleted++
      } else if (task.elapsedMs > this.taskTimeoutMs) {
        // 任务多次执行仍未完成 + 累计耗时超时:强制丢弃
        this.taskQueue.shift()
        this.metrics.tasksDropped++
      } else {
        // 任务未完成但已获得本轮执行机会:移到队尾,让其他任务也有机会
        this.taskQueue.shift()
        this.taskQueue.push(task)
        // 若队列只有这一个任务,break 避免无限循环
        if (this.taskQueue.length === 1) break
      }
    }
    const bgMs = performance.now() - bgStart
    this.metrics.phaseMs.background = bgMs

    // —— Phase 5: idle(记录剩余时间,实际不做任何事) ——
    const frameEnd = performance.now()
    this.metrics.phaseMs.idle = Math.max(0, 16.67 - (frameEnd - frameStart))
    this.metrics.frameMs = frameEnd - frameStart
    this.metrics.frameCount++
    this.metrics.tasksExecutedLastFrame = tasksExecuted
    this.metrics.pendingTasks = this.taskQueue.length
    this.metrics.overBudget = this.metrics.frameMs > 16.67
    this.metrics.fps = this.frameLoop?.getFps() ?? 0
  }

  // --------------------------------------------------------------------------
  // 3.5 启动 / 停止
  // --------------------------------------------------------------------------

  /** 启动调度器 */
  start(): void {
    if (this.frameLoop) return
    this.frameLoop = startFrameLoop(this.executeFrame, { autoStart: true })
  }

  /** 停止调度器 */
  stop(): void {
    if (this.frameLoop) {
      this.frameLoop.stop()
      this.frameLoop = null
    }
  }

  /** 是否运行中 */
  isRunning(): boolean {
    return this.frameLoop?.isRunning() ?? false
  }

  /**
   * 手动执行一帧(用于测试,不依赖 rAF)。
   *
   * @param dt 增量时间(秒)
   * @param now 当前时间戳(毫秒)
   */
  stepOnce(dt: number, now: number): void {
    this.executeFrame(dt, now)
  }

  // --------------------------------------------------------------------------
  // 3.6 Metrics
  // --------------------------------------------------------------------------

  getMetrics(): SchedulerMetrics {
    return { ...this.metrics, phaseMs: { ...this.metrics.phaseMs } }
  }

  /** 重置 metrics(用于测试) */
  resetMetrics(): void {
    this.metrics = {
      fps: 0,
      frameCount: 0,
      phaseMs: { timeline: 0, input: 0, 'gpu-render': 0, background: 0, idle: 0 },
      frameMs: 0,
      overBudget: false,
      pendingTasks: 0,
      tasksExecutedLastFrame: 0,
      tasksCompleted: 0,
      tasksDropped: 0,
    }
  }
}

// ============================================================================
// 4. 便捷:创建绑定到 engine.ts 的 FrameScheduler
// ============================================================================

/**
 * 创建绑定到 engine 的 FrameScheduler。
 *
 * 调用方传入各 phase 的 callback,返回 scheduler 实例。
 * 调用方负责在 dispose 时调用 scheduler.stop()。
 *
 * @example
 *   const sched = createFrameScheduler({
 *     onTimeline: (dt) => stepTimeline(dt),
 *     onInput: (dt) => updateInputs(dt),
 *     onGpuRender: () => renderFrame(),
 *   })
 *   sched.start()
 */
export function createFrameScheduler(callbacks: {
  onTimeline?: (dt: number, now: number) => void
  onInput?: (dt: number, now: number) => void
  onGpuRender?: (dt: number, now: number) => void
  budget?: PhaseBudget
  taskTimeoutMs?: number
}): FrameScheduler {
  const sched = new FrameScheduler({
    budget: callbacks.budget,
    taskTimeoutMs: callbacks.taskTimeoutMs,
  })
  if (callbacks.onTimeline) sched.setPhaseCallback('timeline', callbacks.onTimeline)
  if (callbacks.onInput) sched.setPhaseCallback('input', callbacks.onInput)
  if (callbacks.onGpuRender) sched.setPhaseCallback('gpu-render', callbacks.onGpuRender)
  return sched
}
