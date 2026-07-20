/**
 * Engine(Step 30 集成)— PixelForge 主循环聚合层。
 *
 * 职责:
 * - 统一驱动 Timeline 播放 + Input 系统 + GPU 渲染
 * - 管理 FeatureExtractor[](audio / camera 特征提取)
 * - 管理 InputDriver[](signal → node 参数绑定)
 * - 每帧执行链:
 *     1. Timeline 步进(若 isPlaying)→ applyFrameToRuntime → 触发 GPU 重渲染
 *     2. FeatureExtractor.update(now)→ 写入 InputRouter signals
 *     3. InputDriver.update(graphStore, materialStore, runtimeStore)→ 应用 ParamPatch
 *     4. 定期清理 inactive signals
 *
 * 与 editor/timeline/player.ts 的区别:
 * - player: 只驱动 Timeline(frame-based),不处理实时输入
 * - engine(本模块): 统一驱动 Timeline + Input + 实时渲染
 *
 * 设计:
 * - 不依赖 Vue 组件生命周期(可在测试中实例化)
 * - 使用 startFrameLoop(纯 rAF 调度器)作为底层
 * - 即使 Timeline 暂停,只要注册了 FeatureExtractor/InputDriver,循环仍运行
 *
 * 用法:
 *   const engine = createEngine({ timelineStore, runtimeStore, graphStore, materialStore })
 *   engine.registerFeatureExtractor(audioExtractor)
 *   engine.registerInputDriver(inputDriver)
 *   engine.start()
 *   // 播放 Timeline:
 *   engine.play()
 *   // 卸载:
 *   engine.dispose()
 */

import type { useTimelineStore } from '@/stores/timeline'
import type { useRuntimeStore } from '@/stores/runtime'
import type { useGraphStore } from '@/graph/graphStore'
import type { useMaterialGraphStore } from '@/material/materialGraph'
import { startFrameLoop, type FrameLoopControl } from '@/animation/scheduler'
import { applyFrameToRuntime } from '@/editor/timeline/player'
import { FeatureExtractor } from '@/input/audio/featureExtractor'
import { InputDriver } from '@/animation/drivers/inputDriver'
import { inputRouter } from '@/input/inputRouter'

// ============================================================================
// 1. 类型
// ============================================================================

type TimelineStore = ReturnType<typeof useTimelineStore>
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
  /** 已注册的 FeatureExtractor 数量 */
  activeFeatureExtractors: number
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

  /** 注册 FeatureExtractor(音频 / 摄像头特征提取器) */
  registerFeatureExtractor: (extractor: FeatureExtractor) => void
  /** 注销 FeatureExtractor */
  unregisterFeatureExtractor: (extractor: FeatureExtractor) => void
  /** 注册 InputDriver(signal → node 参数绑定) */
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

  const featureExtractors: FeatureExtractor[] = []
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

    // —— 2. FeatureExtractor 更新(audio/camera → InputRouter signals) ——
    // 即使 Timeline 暂停,只要注册了 extractor 就继续运行
    for (const fx of featureExtractors) {
      try {
        fx.update(now)
      } catch (e) {
        console.error('[Engine] FeatureExtractor error:', e)
      }
    }

    // —— 3. InputDriver 更新(signals → graph/material/runtime patches) ——
    // 'runtime' 目标的 patch 会通过 runtimeStore.applyValuePatch 触发 GPU 重渲染
    for (const driver of inputDrivers) {
      try {
        patchesThisFrame += driver.update(graphStore, materialStore, runtimeStore)
      } catch (e) {
        console.error('[Engine] InputDriver error:', e)
      }
    }

    // —— 4. 定期清理 inactive signals ——
    if (frameCount > 0 && frameCount % PRUNE_INTERVAL_FRAMES === 0) {
      inputRouter.pruneInactive(true)
    }

    patchesLastFrame = patchesThisFrame
    timelineSteppedLastFrame = stepped
    frameCount++
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
      activeFeatureExtractors: featureExtractors.length,
      activeInputDrivers: inputDrivers.length,
      patchesLastFrame,
      timelineSteppedLastFrame,
    }),

    registerFeatureExtractor: (extractor) => {
      if (!featureExtractors.includes(extractor)) {
        featureExtractors.push(extractor)
      }
    },
    unregisterFeatureExtractor: (extractor) => {
      const idx = featureExtractors.indexOf(extractor)
      if (idx >= 0) featureExtractors.splice(idx, 1)
    },

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
      featureExtractors.length = 0
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
 * @param options  createInputDriver 的参数(可选)
 * @returns 创建的 InputDriver
 */
export function attachInputDriver(
  engine: PixelForgeEngine,
): InputDriver {
  const driver = new InputDriver(inputRouter)
  engine.registerInputDriver(driver)
  return driver
}
