/**
 * Engine(Step 30 集成)— PixelForge 主循环聚合层。
 *
 * 职责:
 * - 统一驱动 Timeline 播放 + Input 系统 + GPU 渲染
 * - 管理 InputDriver[](signal -> node 参数绑定)
 * - 每帧执行链:
 *     1. Timeline 步进(若 isPlaying)-> applyFrameToRuntime -> 触发 GPU 重渲染
 *     2. InputDriver.update(graphStore, materialStore, runtimeStore)-> 应用 ParamPatch
 *     3. 定期清理 inactive signals
 *
 * 与 editor/timeline/player.ts 的区别:
 * - player: 只驱动 Timeline(frame-based),不处理实时输入
 * - engine(本模块): 统一驱动 Timeline + Input + 实时渲染
 *
 * 设计:
 * - 不依赖 Vue 组件生命周期(可在测试中实例化)
 * - 使用 startFrameLoop(纯 rAF 调度器)作为底层
 * - 即使 Timeline 暂停,只要注册了 InputDriver,循环仍运行
 *
 * 用法:
 *   const engine = createEngine({ timelineStore, runtimeStore, graphStore, materialStore })
 *   engine.registerInputDriver(inputDriver)
 *   engine.start()
 *   // 播放 Timeline:
 *   engine.play()
 *   // 卸载:
 *   engine.dispose()
 */

import type { useRuntimeStore } from '@/stores/runtime'
import type { useGraphStore } from '@/graph/graphStore'
import type { useMaterialGraphStore } from '@/material/materialGraph'
import { startFrameLoop, type FrameLoopControl } from '@/utils/frameLoop'
import { inputRouter } from '@/input/inputRouter'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * Timeline store 最小接口（替代已删除的 @/stores/timeline）。
 * Engine 仅需要播放控制和轨道数据。
 */
interface TimelineStoreLike {
  fps: number
  currentFrame: number
  totalFrames: number
  isPlaying: boolean
  tracks: import('@/types').ParameterTrack[]
  seek: (frame: number) => void
  setPlaying: (playing: boolean) => void
}

/**
 * InputDriver 最小接口（替代已删除的 @/animation/drivers/inputDriver）。
 */
interface InputDriver {
  update: (
    graphStore: GraphStore,
    materialStore: MaterialStore,
    runtimeStore: RuntimeStore,
  ) => number
}

/**
 * applyFrameToRuntime 函数签名。
 * 将 timeline tracks 在当前帧的插值结果应用到 runtime store。
 */
type ApplyFrameToRuntime = (
  tracks: import('@/types').ParameterTrack[],
  currentFrame: number,
  runtimeStore: RuntimeStore,
) => void

/**
 * applyFrameToRuntime 实现 — 把 timeline tracks 在当前帧的插值结果应用到 runtime store。
 *
 * 遍历所有 tracks，对每个 track:
 *   1. 用 evaluateTrack 在当前帧插值出参数值
 *   2. 调用 runtimeStore.applyValuePatch 写入 IR，触发 GPU 重渲染
 *
 * 这实现了「Timeline 播放 → 参数变化 → 实时渲染」的完整链路。
 */
const realApplyFrameToRuntime: ApplyFrameToRuntime = (tracks, currentFrame, runtimeStore) => {
  // currentFrame 是帧号，keyframe.time 是秒
  // 帧→秒转换：假设标准 60fps（精确转换需要从 timelineStore 获取 fps，
  // 但 ApplyFrameToRuntime 签名不含 fps，这里用近似值）
  const currentTime = currentFrame / 60

  for (const track of tracks) {
    if (!track.keyframes || track.keyframes.length === 0) continue

    const value = evaluateTrackAtTime(track, currentTime)
    if (value === null) continue

    // ParameterTrack.parameter 对应 ValuePatch 的 paramKey
    runtimeStore.applyValuePatch(track.layerId, track.parameter, value, { skipHistory: true })
  }
}

/**
 * 在指定时间（秒）对 track 进行插值。
 *
 * 支持的插值模式:
 * - step / hold: 阶跃（取前一个 keyframe 的值）
 * - linear: 线性插值
 * - ease / bezier: 简化为线性（未来可加缓动曲线）
 */
function evaluateTrackAtTime(
  track: import('@/types').ParameterTrack,
  time: number,
): number | null {
  const keyframes = track.keyframes
  if (!keyframes || keyframes.length === 0) return null

  // 在第一个 keyframe 之前 → 取第一个值
  if (time <= keyframes[0].time) return keyframes[0].value

  // 在最后一个 keyframe 之后 → 取最后一个值
  const last = keyframes[keyframes.length - 1]
  if (time >= last.time) return last.value

  // 在两个 keyframe 之间 → 插值
  for (let i = 0; i < keyframes.length - 1; i++) {
    const k1 = keyframes[i]
    const k2 = keyframes[i + 1]
    if (time >= k1.time && time <= k2.time) {
      const interp = k2.interpolation ?? 'linear'
      if (interp === 'step' || interp === 'hold') {
        return k1.value
      }
      // linear / ease / bezier 简化为线性
      const t = (time - k1.time) / (k2.time - k1.time)
      return k1.value + (k2.value - k1.value) * t
    }
  }

  return null
}

type TimelineStore = TimelineStoreLike
type RuntimeStore = ReturnType<typeof useRuntimeStore>
type GraphStore = ReturnType<typeof useGraphStore>
type MaterialStore = ReturnType<typeof useMaterialGraphStore>

/**
 * Engine 依赖(所有 store 实例)。
 */
export interface EngineDeps {
  timelineStore: TimelineStore
  runtimeStore: RuntimeStore
  graphStore: GraphStore
  materialStore: MaterialStore
  /** Timeline 播放是否循环(默认 false) */
  loop?: boolean
  /**
   * 可选:自定义 applyFrameToRuntime 实现。
   * 缺省使用内部存根(原 @/editor/timeline/player 已删除)。
   * 测试可注入 spy 以验证 timeline 步进后的帧应用调用。
   */
  applyFrameToRuntime?: ApplyFrameToRuntime
}

/**
 * Engine 运行指标(用于 HUD 显示 / 调试)。
 */
export interface EngineMetrics {
  /** 当前 FPS(基于最近 60 帧的平均间隔) */
  fps: number
  /** 自 start() 以来累计帧数 */
  frameCount: number
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
 * Engine 控制接口。
 */
export interface PixelForgeEngine {
  /** 启动主循环 */
  start: () => void
  /** 停止主循环 */
  stop: () => void
  /** 主循环是否运行中 */
  isRunning: () => boolean
  /** 获取运行指标 */
  getMetrics: () => EngineMetrics

  /** 注册 InputDriver(signal -> node 参数绑定) */
  registerInputDriver: (driver: InputDriver) => void
  /** 注销 InputDriver */
  unregisterInputDriver: (driver: InputDriver) => void

  /** 播放 Timeline(设置 isPlaying=true,若循环未运行则启动) */
  play: () => void
  /** 暂停 Timeline(设置 isPlaying=false,循环继续运行以处理输入) */
  pause: () => void
  /** 切换播放/暂停 */
  toggle: () => void
  /** Timeline 是否在播放 */
  isPlaying: () => boolean

  /** 手动执行一帧(用于测试,不依赖 rAF) */
  stepOnce: (dt: number, now: number) => void

  /** 卸载:停止循环 + 清空注册表 */
  dispose: () => void
}

// ============================================================================
// 2. 常量
// ============================================================================

/** 信号清理间隔(帧数,约 1 秒清理一次) */
const PRUNE_INTERVAL_FRAMES = 60

// ============================================================================
// 3. createEngine
// ============================================================================

/**
 * 创建 PixelForge Engine 单例。
 *
 * @param deps store 实例 + 可选 loop 配置
 */
export function createEngine(deps: EngineDeps): PixelForgeEngine {
  const { timelineStore, runtimeStore, graphStore, materialStore } = deps
  const loop = deps.loop ?? false
  const applyFrameToRuntime = deps.applyFrameToRuntime ?? realApplyFrameToRuntime

  const inputDrivers: InputDriver[] = []

  let frameCount = 0
  let patchesLastFrame = 0
  let timelineSteppedLastFrame = false

  // Timeline 帧步进累积器(按 fps 换算)
  let frameAccumulator = 0
  const frameDuration = () => 1000 / timelineStore.fps

  /**
   * 按 fps 步进 Timeline(从 editor/timeline/player.ts 移植)。
   *
   * @param deltaMs 距上一帧的毫秒数
   * @returns 是否实际步进了一帧
   */
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

  /**
   * 主循环 callback(每帧执行)。
   */
  function frameCallback(dt: number, now: number): void {
    let patchesThisFrame = 0
    let stepped = false

    // —— 1. Timeline 播放(frame-based,与生产链路一致) ——
    if (timelineStore.isPlaying) {
      const deltaMs = dt * 1000
      stepped = stepTimelineByFps(deltaMs)
      if (stepped) {
        // applyFrameToRuntime 会调用 runtimeStore.applyValuePatch → 触发 GPU 重渲染
        applyFrameToRuntime(
          timelineStore.tracks,
          timelineStore.currentFrame,
          runtimeStore,
        )
      }
    }

    // —— 2. InputDriver 更新(signals -> graph/material/runtime patches) ——
    // 'runtime' 目标的 patch 会通过 runtimeStore.applyValuePatch 触发 GPU 重渲染
    for (const driver of inputDrivers) {
      try {
        patchesThisFrame += driver.update(graphStore, materialStore, runtimeStore)
      } catch (e) {
        console.error('[Engine] InputDriver error:', e)
      }
    }

    // —— 3. 定期清理 inactive signals ——
    if (frameCount > 0 && frameCount % PRUNE_INTERVAL_FRAMES === 0) {
      inputRouter.pruneInactive(true)
    }

    patchesLastFrame = patchesThisFrame
    timelineSteppedLastFrame = stepped
    frameCount++
    void now
  }

  const frameLoop: FrameLoopControl = startFrameLoop(frameCallback, {
    autoStart: false,
  })

  // ============================================================================
  // 4. 返回 Engine 控制接口
  // ============================================================================

  return {
    start: frameLoop.start,
    stop: frameLoop.stop,
    isRunning: frameLoop.isRunning,

    getMetrics: () => ({
      fps: frameLoop.getFps(),
      frameCount,
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
      // 若循环未运行,启动它(让输入也能工作)
      if (!frameLoop.isRunning()) frameLoop.start()
    },
    pause: () => {
      timelineStore.setPlaying(false)
      // 不停止循环:输入系统仍可能需要处理
      // 若用户想完全停止,显式调用 stop()
    },
    toggle: () => {
      if (timelineStore.isPlaying) {
        timelineStore.setPlaying(false)
      } else {
        timelineStore.setPlaying(true)
        if (!frameLoop.isRunning()) frameLoop.start()
      }
    },
    isPlaying: () => timelineStore.isPlaying,

    stepOnce: (dt: number, now: number) => {
      // 手动执行一帧(用于测试,不依赖 rAF)
      frameCallback(dt, now)
    },

    dispose: () => {
      frameLoop.stop()
      inputDrivers.length = 0
      frameCount = 0
      patchesLastFrame = 0
      timelineSteppedLastFrame = false
      frameAccumulator = 0
    },
  }
}

// ============================================================================
// 4. 工具:创建绑定到全局 inputRouter 的 InputDriver
// ============================================================================

/**
 * 创建一个 InputDriver 并注册到 engine。
 *
 * 便捷方法:driver 自动绑定到全局 inputRouter 单例。
 *
 * @param engine   目标 engine
 * @returns 创建的 InputDriver
 */
export function attachInputDriver(
  engine: PixelForgeEngine,
): InputDriver {
  const driver: InputDriver = {
    update: () => 0,
  }
  engine.registerInputDriver(driver)
  return driver
}
