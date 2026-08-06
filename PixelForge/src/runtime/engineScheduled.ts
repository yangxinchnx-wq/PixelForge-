/**
 * engineScheduled(Step 31.5)— 基于 FrameScheduler 的 Engine 实现。
 *
 * 与 engine.ts(原始)的关系:
 * - engine.ts: 直接使用 startFrameLoop(纯 rAF),业务编排简单
 * - engineScheduled(本模块): 使用 FrameScheduler 提供的 phase 调度 + 时间预算 + 优先级队列
 *
 * 优势:
 * - 多 phase 时间预算,避免某 phase 拖累整体 FPS
 * - 后台任务队列(预渲染 / 缓存预热)
 * - GPU 资源生命周期管理(自动销毁 released 资源)
 * - 完整 metrics(每 phase 耗时 / over-budget / task 统计)
 *
 * 单帧执行链(与 engine.ts 对齐):
 *   Phase 1 (timeline):  step Timeline + applyFrameToRuntime(-> 触发 GPU 重渲染)
 *   Phase 2 (input):     InputDriver.update
 *   Phase 3 (gpu-render): GPU 资源 endFrame(销毁 released 资源)+ 可选 syncFrame
 *   Phase 4 (background): prune inactive signals + 后台任务队列
 *   Phase 5 (idle):      无操作(记录剩余时间)
 *
 * 用法:
 *   const engine = createScheduledEngine({
 *     timelineStore, runtimeStore, graphStore, materialStore,
 *     device: runtime.gpu.device,  // 可选,启用 GpuResourceManager
 *   })
 *   engine.start()
 *   engine.play()
 *
 *   // 后台任务(预渲染):
 *   engine.enqueueTask('low', (budget) => preRenderFrame(budget))
 */
import type { useRuntimeStore } from '@/stores/runtime'
import type { useGraphStore } from '@/graph/graphStore'
import type { useMaterialGraphStore } from '@/material/materialGraph'
import { inputRouter } from '@/input/inputRouter'
import type { RuntimeDeviceHandle } from './types'
import {
  FrameScheduler,
  DEFAULT_BUDGET_60FPS,
  type PhaseBudget,
  type TaskPriority,
  type SchedulerMetrics,
} from './frameScheduler'
import {
  GpuResourceManager,
  type GpuResourceMetrics,
  type GpuRenderContext,
} from './gpuResourceManager'

// ============================================================================
// 1. 类型
// ============================================================================

/** Timeline store 最小接口（替代已删除的 @/stores/timeline） */
interface TimelineStoreLike {
  fps: number
  currentFrame: number
  totalFrames: number
  isPlaying: boolean
  tracks: import('@/types').ParameterTrack[]
  seek: (frame: number) => void
  setPlaying: (playing: boolean) => void
}

/** InputDriver 最小接口（替代已删除的 @/animation/drivers/inputDriver） */
interface InputDriver {
  update: (
    graphStore: GraphStore,
    materialStore: MaterialStore,
    runtimeStore: RuntimeStore,
  ) => number
}

/** applyFrameToRuntime 函数签名（替代已删除的 @/editor/timeline/player） */
type ApplyFrameToRuntime = (
  tracks: import('@/types').ParameterTrack[],
  currentFrame: number,
  runtimeStore: RuntimeStore,
) => void

/** applyFrameToRuntime 实现 — 同 engine.ts 中的实现 */
const realApplyFrameToRuntime: ApplyFrameToRuntime = (tracks, currentFrame, runtimeStore) => {
  const currentTime = currentFrame / 60
  for (const track of tracks) {
    if (!track.keyframes || track.keyframes.length === 0) continue
    const keyframes = track.keyframes
    let value: number | null = null
    if (currentTime <= keyframes[0].time) {
      value = keyframes[0].value
    } else {
      const last = keyframes[keyframes.length - 1]
      if (currentTime >= last.time) {
        value = last.value
      } else {
        for (let i = 0; i < keyframes.length - 1; i++) {
          const k1 = keyframes[i]
          const k2 = keyframes[i + 1]
          if (currentTime >= k1.time && currentTime <= k2.time) {
            const interp = k2.interpolation ?? 'linear'
            if (interp === 'step' || interp === 'hold') {
              value = k1.value
            } else {
              const t = (currentTime - k1.time) / (k2.time - k1.time)
              value = k1.value + (k2.value - k1.value) * t
            }
            break
          }
        }
      }
    }
    if (value === null) continue
    runtimeStore.applyValuePatch(track.layerId, track.parameter, value, { skipHistory: true })
  }
}

type TimelineStore = TimelineStoreLike
type RuntimeStore = ReturnType<typeof useRuntimeStore>
type GraphStore = ReturnType<typeof useGraphStore>
type MaterialStore = ReturnType<typeof useMaterialGraphStore>

/**
 * Scheduled Engine 依赖。
 */
export interface ScheduledEngineDeps {
  timelineStore: TimelineStore
  runtimeStore: RuntimeStore
  graphStore: GraphStore
  materialStore: MaterialStore
  /** GPU device(可选,启用 GpuResourceManager 资源追踪) */
  device?: RuntimeDeviceHandle
  /** Timeline 播放是否循环(默认 false) */
  loop?: boolean
  /** 时间预算(默认 60FPS) */
  budget?: PhaseBudget
  /** 任务超时时间(默认 30s) */
  taskTimeoutMs?: number
  /**
   * 可选:自定义 applyFrameToRuntime 实现。
   * 缺省使用内部存根(原 @/editor/timeline/player 已删除)。
   * 测试可注入 spy 以验证 timeline 步进后的帧应用调用。
   */
  applyFrameToRuntime?: ApplyFrameToRuntime
}

/**
 * Scheduled Engine 指标(合并 FrameScheduler + GpuResourceManager)。
 */
export interface ScheduledEngineMetrics {
  /** FrameScheduler 指标 */
  scheduler: SchedulerMetrics
  /** GPU 资源指标(若启用) */
  gpu: GpuResourceMetrics | null
  /** 当前 InputRouter 中的信号数量 */
  activeSignals: number
  /** 已注册的 InputDriver 数量 */
  activeInputDrivers: number
  /** 上一帧 InputDriver 应用的 patch 数量 */
  patchesLastFrame: number
  /** 上一帧 Timeline 是否步进了 */
  timelineSteppedLastFrame: boolean
}

/**
 * Scheduled Engine 控制接口。
 */
export interface ScheduledEngine {
  // —— 主循环 ——
  /** 启动主循环 */
  start: () => void
  /** 停止主循环 */
  stop: () => void
  /** 主循环是否运行中 */
  isRunning: () => boolean
  /** 获取合并指标 */
  getMetrics: () => ScheduledEngineMetrics

  // —— 注册表 ——
  /** 注册 InputDriver */
  registerInputDriver: (driver: InputDriver) => void
  /** 注销 InputDriver */
  unregisterInputDriver: (driver: InputDriver) => void

  // —— 播放控制 ——
  /** 播放 Timeline */
  play: () => void
  /** 暂停 Timeline(循环继续运行以处理输入) */
  pause: () => void
  /** 切换播放/暂停 */
  toggle: () => void
  /** Timeline 是否在播放 */
  isPlaying: () => boolean

  // —— 后台任务 ——
  /** 入队后台任务(返回任务 id) */
  enqueueTask: (priority: TaskPriority, execute: (budgetMs: number) => boolean) => string
  /** 取消任务 */
  cancelTask: (taskId: string) => boolean
  /** 清空任务队列 */
  clearTasks: () => void
  /** 待执行任务数 */
  getPendingTaskCount: () => number

  // —— GPU 资源(若启用)——
  /** 获取 GpuResourceManager(若启用) */
  getGpuResourceManager: () => GpuResourceManager | null
  /** 注册 GPU 帧渲染回调(每帧 gpu-render phase 调用) */
  setGpuRenderCallback: (cb: (ctx: GpuRenderContext) => void) => void

  // —— 手动步进 / 卸载 ——
  /** 手动执行一帧(测试用,不依赖 rAF) */
  stepOnce: (dt: number, now: number) => void
  /** 卸载 */
  dispose: () => void
}

// ============================================================================
// 2. 常量
// ============================================================================

const PRUNE_INTERVAL_FRAMES = 60

// ============================================================================
// 3. createScheduledEngine
// ============================================================================

/**
 * 创建基于 FrameScheduler 的 Engine 实例。
 *
 * @param deps store 实例 + 可选 device + 可选 loop / budget
 */
export function createScheduledEngine(deps: ScheduledEngineDeps): ScheduledEngine {
  const { timelineStore, runtimeStore, graphStore, materialStore } = deps
  const loop = deps.loop ?? false
  const applyFrameToRuntime = deps.applyFrameToRuntime ?? realApplyFrameToRuntime

  const inputDrivers: InputDriver[] = []

  let patchesLastFrame = 0
  let timelineSteppedLastFrame = false

  // Timeline 帧步进累积器(与 engine.ts 一致)
  let frameAccumulator = 0
  const frameDuration = () => 1000 / timelineStore.fps

  // —— 创建 FrameScheduler ——
  const scheduler = new FrameScheduler({
    budget: deps.budget ?? DEFAULT_BUDGET_60FPS,
    taskTimeoutMs: deps.taskTimeoutMs,
  })

  // —— 创建 GpuResourceManager(可选)——
  const gpuManager = deps.device ? new GpuResourceManager(deps.device) : null
  let gpuRenderCallback: ((ctx: GpuRenderContext) => void) | null = null

  // --------------------------------------------------------------------------
  // 3.1 Phase 1: timeline — 步进 + applyFrameToRuntime
  // --------------------------------------------------------------------------

  scheduler.setPhaseCallback('timeline', (dt) => {
    if (!timelineStore.isPlaying) {
      timelineSteppedLastFrame = false
      return
    }
    const deltaMs = dt * 1000
    const stepped = stepTimelineByFps(deltaMs)
    if (stepped) {
      // applyFrameToRuntime 会调用 runtimeStore.applyValuePatch → 触发 GPU 重渲染
      applyFrameToRuntime(
        timelineStore.tracks,
        timelineStore.currentFrame,
        runtimeStore,
      )
    }
    timelineSteppedLastFrame = stepped
  })

  function stepTimelineByFps(deltaMs: number): boolean {
    frameAccumulator += deltaMs
    const step = frameDuration()
    let stepped = false
    while (frameAccumulator >= step) {
      frameAccumulator -= step
      const next = timelineStore.currentFrame + 1
      if (next >= timelineStore.totalFrames) {
        if (loop) {
          timelineStore.seek(0)
        } else {
          timelineStore.seek(timelineStore.totalFrames)
          timelineStore.setPlaying(false)
          return stepped
        }
      } else {
        timelineStore.seek(next)
      }
      stepped = true
    }
    return stepped
  }

  // --------------------------------------------------------------------------
  // 3.2 Phase 2: input — InputDriver
  // --------------------------------------------------------------------------

  let internalFrameCount = 0

  scheduler.setPhaseCallback('input', (_dt, _now) => {
    let patchesThisFrame = 0

    // InputDriver 更新
    for (const driver of inputDrivers) {
      try {
        patchesThisFrame += driver.update(graphStore, materialStore, runtimeStore)
      } catch (e) {
        console.error('[ScheduledEngine] InputDriver error:', e)
      }
    }

    patchesLastFrame = patchesThisFrame
  })

  // --------------------------------------------------------------------------
  // 3.3 Phase 3: gpu-render — GPU 资源 endFrame + 业务渲染回调
  // --------------------------------------------------------------------------

  scheduler.setPhaseCallback('gpu-render', (dt, now) => {
    if (gpuManager) {
      gpuManager.beginFrame()
    }
    if (gpuRenderCallback && gpuManager) {
      try {
        gpuRenderCallback({
          frameCount: internalFrameCount,
          dt,
          now,
          resources: gpuManager,
        })
      } catch (e) {
        console.error('[ScheduledEngine] gpuRenderCallback error:', e)
      }
    }
    if (gpuManager) {
      gpuManager.endFrame()
    }
  })

  // --------------------------------------------------------------------------
  // 3.4 Phase 4: background — prune inactive signals(每 60 帧)
  // --------------------------------------------------------------------------

  scheduler.setPhaseCallback('background', () => {
    if (internalFrameCount > 0 && internalFrameCount % PRUNE_INTERVAL_FRAMES === 0) {
      inputRouter.pruneInactive(true)
    }
    internalFrameCount++
  })

  // ============================================================================
  // 4. 返回 Engine 控制接口
  // ============================================================================

  return {
    start: scheduler.start.bind(scheduler),
    stop: scheduler.stop.bind(scheduler),
    isRunning: scheduler.isRunning.bind(scheduler),

    getMetrics: () => ({
      scheduler: scheduler.getMetrics(),
      gpu: gpuManager ? gpuManager.getMetrics() : null,
      activeSignals: inputRouter.size,
      activeInputDrivers: inputDrivers.length,
      patchesLastFrame,
      timelineSteppedLastFrame,
    }),

    registerInputDriver: (driver) => {
      if (!inputDrivers.includes(driver)) {
        inputDrivers.push(driver)
      }
    },
    unregisterInputDriver: (driver) => {
      const idx = inputDrivers.indexOf(driver)
      if (idx >= 0) inputDrivers.splice(idx, 1)
    },

    play: () => {
      timelineStore.setPlaying(true)
      if (!scheduler.isRunning()) scheduler.start()
    },
    pause: () => {
      timelineStore.setPlaying(false)
      // 不停止循环:输入系统仍可能需要处理
    },
    toggle: () => {
      if (timelineStore.isPlaying) {
        timelineStore.setPlaying(false)
      } else {
        timelineStore.setPlaying(true)
        if (!scheduler.isRunning()) scheduler.start()
      }
    },
    isPlaying: () => timelineStore.isPlaying,

    enqueueTask: (priority, execute) => scheduler.enqueueTask(priority, execute),
    cancelTask: (id) => scheduler.cancelTask(id),
    clearTasks: () => scheduler.clearTasks(),
    getPendingTaskCount: () => scheduler.getPendingTaskCount(),

    getGpuResourceManager: () => gpuManager,
    setGpuRenderCallback: (cb) => {
      gpuRenderCallback = cb
    },

    stepOnce: (dt, now) => {
      scheduler.stepOnce(dt, now)
    },

    dispose: () => {
      scheduler.stop()
      scheduler.clearTasks()
      if (gpuManager) {
        gpuManager.releaseAll()
      }
      inputDrivers.length = 0
      patchesLastFrame = 0
      timelineSteppedLastFrame = false
      frameAccumulator = 0
      internalFrameCount = 0
      gpuRenderCallback = null
    },
  }
}
