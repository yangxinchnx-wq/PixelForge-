/**
 * Engine(Step 30 集成)单元测试。
 *
 * 覆盖:
 * - E:   createEngine 基本接口(start/stop/isRunning/getMetrics)
 * - FX:  FeatureExtractor 注册 / 注销 / 调用
 * - ID:  InputDriver 注册 / 注销 / 调用
 * - TL:  Timeline 播放步进
 * - PP:  play / pause / toggle
 * - SO:  stepOnce 手动帧执行
 * - DISP: dispose 清理
 * - ERR: 错误隔离(extractor/driver 异常不中断循环)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// —— Mock applyFrameToRuntime(spy on real implementation) ——
vi.mock('@/editor/timeline/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/editor/timeline/player')>()
  return {
    ...actual,
    applyFrameToRuntime: vi.fn(() => 0),
  }
})

// —— Mock startFrameLoop(避免 rAF,测试用 stepOnce 手动驱动) ——
vi.mock('@/animation/scheduler', () => ({
  startFrameLoop: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn(() => false),
    getFps: vi.fn(() => 60),
  })),
}))

import { createEngine } from './engine'
import { inputRouter, resetInputRouterForTesting } from '@/input/inputRouter'
import { InputDriver } from '@/animation/drivers/inputDriver'
import { FeatureExtractor } from '@/input/audio/featureExtractor'
import { useTimelineStore } from '@/stores/timeline'
import { useRuntimeStore } from '@/stores/runtime'
import { useGraphStore } from '@/graph/graphStore'
import { useMaterialGraphStore } from '@/material/materialGraph'
import { applyFrameToRuntime } from '@/editor/timeline/player'

// ============================================================================
// 辅助:Mock FeatureExtractor(避免依赖 AudioAnalyzer / 浏览器 API)
// ============================================================================

/**
 * 创建一个 mock FeatureExtractor,只暴露 update() 和 reset() 方法。
 *
 * 用 `as unknown as FeatureExtractor` 绕过类型检查(engine 只调 update)。
 */
function makeMockFeatureExtractor(): FeatureExtractor & {
  update: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
} {
  return {
    update: vi.fn(() => ({
      volume: 0.5,
      bass: 0.4,
      mid: 0.3,
      high: 0.2,
      beat: false,
      bpm: 0,
    })),
    reset: vi.fn(),
    getLastFeatures: vi.fn(() => ({
      volume: 0.5,
      bass: 0.4,
      mid: 0.3,
      high: 0.2,
      beat: false,
      bpm: 0,
    })),
    setOptions: vi.fn(),
    getBeatDetector: vi.fn(),
  } as unknown as FeatureExtractor & {
    update: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
  }
}

// ============================================================================
// 辅助:创建 engine 实例(每个 test 独立)
// ============================================================================

function makeEngine() {
  const timelineStore = useTimelineStore()
  const runtimeStore = useRuntimeStore()
  const graphStore = useGraphStore()
  const materialStore = useMaterialGraphStore()
  return createEngine({ timelineStore, runtimeStore, graphStore, materialStore })
}

// ============================================================================
// E: createEngine 基本接口
// ============================================================================

describe('E: Engine 基本接口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('E1: createEngine 返回所有必需方法', () => {
    const engine = makeEngine()
    expect(typeof engine.start).toBe('function')
    expect(typeof engine.stop).toBe('function')
    expect(typeof engine.isRunning).toBe('function')
    expect(typeof engine.getMetrics).toBe('function')
    expect(typeof engine.registerFeatureExtractor).toBe('function')
    expect(typeof engine.unregisterFeatureExtractor).toBe('function')
    expect(typeof engine.registerInputDriver).toBe('function')
    expect(typeof engine.unregisterInputDriver).toBe('function')
    expect(typeof engine.play).toBe('function')
    expect(typeof engine.pause).toBe('function')
    expect(typeof engine.toggle).toBe('function')
    expect(typeof engine.isPlaying).toBe('function')
    expect(typeof engine.stepOnce).toBe('function')
    expect(typeof engine.dispose).toBe('function')
  })

  it('E2: getMetrics 初始状态正确', () => {
    const engine = makeEngine()
    const m = engine.getMetrics()
    expect(m.frameCount).toBe(0)
    expect(m.activeSignals).toBe(0)
    expect(m.activeFeatureExtractors).toBe(0)
    expect(m.activeInputDrivers).toBe(0)
    expect(m.patchesLastFrame).toBe(0)
    expect(m.timelineSteppedLastFrame).toBe(false)
  })

  it('E3: isRunning 初始为 false', () => {
    const engine = makeEngine()
    expect(engine.isRunning()).toBe(false)
  })

  it('E4: isPlaying 初始为 false', () => {
    const engine = makeEngine()
    expect(engine.isPlaying()).toBe(false)
  })

  it('E5: stepOnce 执行后 frameCount 递增', () => {
    const engine = makeEngine()
    engine.stepOnce(0.016, 1000)
    expect(engine.getMetrics().frameCount).toBe(1)
    engine.stepOnce(0.016, 1016)
    expect(engine.getMetrics().frameCount).toBe(2)
  })
})

// ============================================================================
// FX: FeatureExtractor 注册与调用
// ============================================================================

describe('FX: FeatureExtractor 注册', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('FX1: registerFeatureExtractor 后 metrics 递增', () => {
    const engine = makeEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    expect(engine.getMetrics().activeFeatureExtractors).toBe(1)
  })

  it('FX2: 重复注册同一实例不累加', () => {
    const engine = makeEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.registerFeatureExtractor(fx)
    expect(engine.getMetrics().activeFeatureExtractors).toBe(1)
  })

  it('FX3: unregisterFeatureExtractor 后 metrics 递减', () => {
    const engine = makeEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.unregisterFeatureExtractor(fx)
    expect(engine.getMetrics().activeFeatureExtractors).toBe(0)
  })

  it('FX4: stepOnce 触发 extractor.update 调用', () => {
    const engine = makeEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.stepOnce(0.016, 1000)
    expect(fx.update).toHaveBeenCalledWith(1000)
  })

  it('FX5: 多个 extractor 都被调用', () => {
    const engine = makeEngine()
    const fx1 = makeMockFeatureExtractor()
    const fx2 = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx1)
    engine.registerFeatureExtractor(fx2)
    engine.stepOnce(0.016, 1000)
    expect(fx1.update).toHaveBeenCalledTimes(1)
    expect(fx2.update).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// ID: InputDriver 注册与调用
// ============================================================================

describe('ID: InputDriver 注册', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('ID1: registerInputDriver 后 metrics 递增', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(1)
  })

  it('ID2: 重复注册同一实例不累加', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    engine.registerInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(1)
  })

  it('ID3: unregisterInputDriver 后 metrics 递减', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    engine.unregisterInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(0)
  })

  it('ID4: stepOnce 触发 driver.update(runtime patches 被应用)', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)

    // 手动设置一个信号 + 绑定到 runtime 目标
    inputRouter.setSignal('audio.bass', 0.8, 'AUDIO')
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'runtime',
      nodeId: 'layer_0',
      property: 'scale',
      mapping: { outMin: 0.5, outMax: 3.0 },
    })

    engine.registerInputDriver(driver)
    engine.stepOnce(0.016, 1000)

    // patchesLastFrame 应该是 1(一个 runtime patch 被应用)
    expect(engine.getMetrics().patchesLastFrame).toBe(1)
  })

  it('ID5: 无信号时 patchesLastFrame 为 0', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'runtime',
      nodeId: 'layer_0',
      property: 'scale',
    })
    engine.registerInputDriver(driver)
    engine.stepOnce(0.016, 1000)
    expect(engine.getMetrics().patchesLastFrame).toBe(0)
  })
})

// ============================================================================
// TL: Timeline 播放步进
// ============================================================================

describe('TL: Timeline 播放步进', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('TL1: isPlaying=false 时 stepOnce 不步进 timeline', () => {
    const engine = makeEngine()
    const timelineStore = useTimelineStore()
    const startFrame = timelineStore.currentFrame
    engine.stepOnce(0.016, 1000)
    expect(timelineStore.currentFrame).toBe(startFrame)
    expect(engine.getMetrics().timelineSteppedLastFrame).toBe(false)
  })

  it('TL2: isPlaying=true 时 stepOnce 步进 timeline', () => {
    const engine = makeEngine()
    const timelineStore = useTimelineStore()
    timelineStore.setPlaying(true)
    const startFrame = timelineStore.currentFrame
    // 60 fps → 1 step = 1000/60 ≈ 16.67ms;给 20ms 足够步进一帧
    engine.stepOnce(0.020, 1000)
    expect(timelineStore.currentFrame).toBe(startFrame + 1)
    expect(engine.getMetrics().timelineSteppedLastFrame).toBe(true)
  })

  it('TL3: timeline 步进后调用 applyFrameToRuntime', () => {
    const engine = makeEngine()
    const timelineStore = useTimelineStore()
    timelineStore.setPlaying(true)
    engine.stepOnce(0.020, 1000)
    expect(applyFrameToRuntime).toHaveBeenCalled()
  })

  it('TL4: timeline 未步进时不调用 applyFrameToRuntime', () => {
    const engine = makeEngine()
    engine.stepOnce(0.016, 1000)
    expect(applyFrameToRuntime).not.toHaveBeenCalled()
  })

  it('TL5: 到达末尾自动停止播放(非循环模式)', () => {
    const engine = makeEngine()
    const timelineStore = useTimelineStore()
    timelineStore.setPlaying(true)
    timelineStore.seek(timelineStore.totalFrames)
    // 下一帧应该让 timeline 停止
    engine.stepOnce(0.020, 1000)
    expect(timelineStore.isPlaying).toBe(false)
  })
})

// ============================================================================
// PP: play / pause / toggle
// ============================================================================

describe('PP: play / pause / toggle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('PP1: play 设置 isPlaying=true', () => {
    const engine = makeEngine()
    engine.play()
    expect(engine.isPlaying()).toBe(true)
  })

  it('PP2: pause 设置 isPlaying=false', () => {
    const engine = makeEngine()
    engine.play()
    engine.pause()
    expect(engine.isPlaying()).toBe(false)
  })

  it('PP3: toggle 切换播放状态', () => {
    const engine = makeEngine()
    expect(engine.isPlaying()).toBe(false)
    engine.toggle()
    expect(engine.isPlaying()).toBe(true)
    engine.toggle()
    expect(engine.isPlaying()).toBe(false)
  })

  it('PP4: pause 不停止循环(让输入继续处理)', () => {
    const engine = makeEngine()
    engine.play()
    engine.pause()
    // 循环是否运行由 startFrameLoop mock 控制,这里只验证 isPlaying=false
    // 但 engine 仍应能处理 stepOnce(用于测试)
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.stepOnce(0.016, 1000)
    expect(fx.update).toHaveBeenCalled()
  })
})

// ============================================================================
// SO: stepOnce 链路完整性
// ============================================================================

describe('SO: stepOnce 完整链路', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('SO1: FeatureExtractor → InputRouter → InputDriver → patches 链路', () => {
    const engine = makeEngine()

    // 1. 注入一个会写入信号的 mock FeatureExtractor
    const fx = makeMockFeatureExtractor()
    // 让 update 同时写信号到 inputRouter(模拟真实 FeatureExtractor 行为)
    fx.update.mockImplementation(() => {
      inputRouter.setSignal('audio.bass', 0.8, 'AUDIO')
      return { volume: 0.5, bass: 0.8, mid: 0.3, high: 0.2, beat: false, bpm: 0 }
    })
    engine.registerFeatureExtractor(fx)

    // 2. 注册 InputDriver,绑定 audio.bass → layer_0.scale(runtime 目标)
    const driver = new InputDriver(inputRouter)
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'runtime',
      nodeId: 'layer_0',
      property: 'scale',
      mapping: { outMin: 0.5, outMax: 3.0 },
    })
    engine.registerInputDriver(driver)

    // 3. 执行一帧:fx 写信号 → driver 读信号 → 生成 patch
    engine.stepOnce(0.016, 1000)

    // 4. 验证 patchesLastFrame = 1
    expect(engine.getMetrics().patchesLastFrame).toBe(1)
    expect(engine.getMetrics().activeSignals).toBeGreaterThan(0)
  })

  it('SO2: 累计多帧 frameCount 递增', () => {
    const engine = makeEngine()
    engine.stepOnce(0.016, 1000)
    engine.stepOnce(0.016, 1016)
    engine.stepOnce(0.016, 1032)
    expect(engine.getMetrics().frameCount).toBe(3)
  })

  it('SO3: patchesLastFrame 每帧重置', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    inputRouter.setSignal('audio.bass', 0.8, 'AUDIO')
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'runtime',
      nodeId: 'layer_0',
      property: 'scale',
    })
    engine.registerInputDriver(driver)

    // 第一帧有 patch
    engine.stepOnce(0.016, 1000)
    expect(engine.getMetrics().patchesLastFrame).toBe(1)

    // 移除信号后,第二帧应该没有 patch
    resetInputRouterForTesting()
    engine.stepOnce(0.016, 1016)
    expect(engine.getMetrics().patchesLastFrame).toBe(0)
  })
})

// ============================================================================
// DISP: dispose 清理
// ============================================================================

describe('DISP: dispose 清理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('DISP1: dispose 清空 featureExtractors', () => {
    const engine = makeEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.dispose()
    expect(engine.getMetrics().activeFeatureExtractors).toBe(0)
  })

  it('DISP2: dispose 清空 inputDrivers', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    engine.dispose()
    expect(engine.getMetrics().activeInputDrivers).toBe(0)
  })

  it('DISP3: dispose 重置 frameCount', () => {
    const engine = makeEngine()
    engine.stepOnce(0.016, 1000)
    engine.stepOnce(0.016, 1016)
    engine.dispose()
    expect(engine.getMetrics().frameCount).toBe(0)
  })

  it('DISP4: dispose 后 stepOnce 仍可工作(不报错)', () => {
    const engine = makeEngine()
    engine.dispose()
    expect(() => engine.stepOnce(0.016, 1000)).not.toThrow()
    expect(engine.getMetrics().frameCount).toBe(1)
  })
})

// ============================================================================
// ERR: 错误隔离
// ============================================================================

describe('ERR: 错误隔离', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('ERR1: FeatureExtractor 抛异常不影响后续执行', () => {
    const engine = makeEngine()
    const badFx = makeMockFeatureExtractor()
    badFx.update.mockImplementation(() => {
      throw new Error('extractor boom')
    })
    const goodFx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(badFx)
    engine.registerFeatureExtractor(goodFx)

    // 静音 console.error 避免污染测试输出
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    engine.stepOnce(0.016, 1000)

    // badFx 抛异常,但 goodFx 仍被调用
    expect(badFx.update).toHaveBeenCalledTimes(1)
    expect(goodFx.update).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('ERR2: InputDriver 抛异常不影响后续执行', () => {
    const engine = makeEngine()
    const badDriver = {
      update: () => {
        throw new Error('driver boom')
      },
      size: 0,
    } as unknown as InputDriver
    const goodDriver = new InputDriver(inputRouter)

    engine.registerInputDriver(badDriver)
    engine.registerInputDriver(goodDriver)

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // 不应抛异常
    expect(() => engine.stepOnce(0.016, 1000)).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
