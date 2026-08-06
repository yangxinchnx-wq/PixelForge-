/**
 * Engine(Step 30 集成)单元测试。
 *
 * 覆盖:
 * - E:   createEngine 基本接口(start/stop/isRunning/getMetrics)
 * - ID:  InputDriver 注册 / 注销 / 调用
 * - TL:  Timeline 播放步进
 * - PP:  play / pause / toggle
 * - SO:  stepOnce 手动帧执行
 * - DISP: dispose 清理
 * - ERR: 错误隔离(driver 异常不中断循环)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// —— Mock @/editor/timeline/player（已删除模块，用 mock 替代）——
vi.mock('@/editor/timeline/player', () => ({
  applyFrameToRuntime: vi.fn(() => 0),
}))

// —— Mock @/animation/scheduler -> @/utils/frameLoop（已迁移）——
vi.mock('@/utils/frameLoop', () => ({
  startFrameLoop: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: vi.fn(() => false),
    getFps: vi.fn(() => 60),
  })),
}))

// —— Mock @/animation/drivers/inputDriver（已删除模块）——
vi.mock('@/animation/drivers/inputDriver', () => {
  class MockInputDriver {
    update = vi.fn(() => 0)
    constructor() {}
  }
  return { InputDriver: MockInputDriver }
})

// —— Mock @/stores/timeline（已删除模块）——
vi.mock('@/stores/timeline', () => ({
  useTimelineStore: () => ({
    fps: 30,
    currentFrame: 0,
    totalFrames: 300,
    isPlaying: false,
    tracks: [] as import('@/types').ParameterTrack[],
    seek: vi.fn(),
    setPlaying: vi.fn(),
  }),
}))

import { createEngine } from './engine'
import { inputRouter, resetInputRouterForTesting } from '@/input/inputRouter'
import { useRuntimeStore } from '@/stores/runtime'
import { useGraphStore } from '@/graph/graphStore'
import { useMaterialGraphStore } from '@/material/materialGraph'

// —— 本地 stub（替代已删除的 @/animation/drivers/inputDriver）——
interface FakeBinding {
  signalId: string
  targetKind: 'graph' | 'material' | 'runtime'
  nodeId: string
  property: string
  mapping: { inMin: number; inMax: number; outMin: number; outMax: number }
  enabled: boolean
}

class InputDriver {
  private bindings: FakeBinding[] = []
  size = 0
  getBindings = vi.fn((): unknown[] => [])
  removeBinding = vi.fn()
  setBindingEnabled = vi.fn()
  setBindingMapping = vi.fn()
  evaluate = vi.fn((): unknown[] => [])

  constructor(private router?: { hasActiveSignal: (id: string) => boolean; getSignalValue: (id: string, fallback?: number) => number }) {}

  addBinding(options: {
    signalId: string
    targetKind: FakeBinding['targetKind']
    nodeId: string
    property: string
    mapping?: Partial<FakeBinding['mapping']>
    enabled?: boolean
  }): string {
    const id = `binding-${this.bindings.length + 1}`
    this.bindings.push({
      signalId: options.signalId,
      targetKind: options.targetKind,
      nodeId: options.nodeId,
      property: options.property,
      mapping: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, ...options.mapping },
      enabled: options.enabled ?? true,
    })
    this.size = this.bindings.length
    return id
  }

  update(graphStore: unknown, materialStore: unknown, runtimeStore: unknown): number {
    let applied = 0
    for (const b of this.bindings) {
      if (!b.enabled) continue
      if (!this.router?.hasActiveSignal(b.signalId)) continue
      const sig = this.router.getSignalValue(b.signalId, 0)
      const t = (sig - b.mapping.inMin) / (b.mapping.inMax - b.mapping.inMin)
      const value = b.mapping.outMin + t * (b.mapping.outMax - b.mapping.outMin)
      if (b.targetKind === 'runtime' && runtimeStore) {
        ;(runtimeStore as { applyValuePatch: (id: string, key: string, v: number, opts: { skipHistory: boolean }) => boolean })
          .applyValuePatch(b.nodeId, b.property, value, { skipHistory: true })
        applied++
      } else if (b.targetKind === 'graph' && graphStore) {
        ;(graphStore as { updateNodeParams: (id: string, params: Record<string, number>) => void })
          .updateNodeParams(b.nodeId, { [b.property]: value })
        applied++
      } else if (b.targetKind === 'material' && materialStore) {
        ;(materialStore as { updateNodeParams: (id: string, params: Record<string, number>) => void })
          .updateNodeParams(b.nodeId, { [b.property]: value })
        applied++
      }
    }
    return applied
  }
}

// —— 本地 fake(替代已删除的 @/stores/timeline 单例 Pinia store)——
interface FakeTimelineStore {
  fps: number
  currentFrame: number
  totalFrames: number
  isPlaying: boolean
  tracks: import('@/types').ParameterTrack[]
  seek: (frame: number) => void
  setPlaying: (playing: boolean) => void
}

function createFakeTimelineStore(): FakeTimelineStore {
  return {
    fps: 60,
    currentFrame: 0,
    totalFrames: 300,
    isPlaying: false,
    tracks: [],
    seek(frame: number) {
      this.currentFrame = frame
    },
    setPlaying(playing: boolean) {
      this.isPlaying = playing
    },
  }
}

let fakeTimelineStore: FakeTimelineStore = createFakeTimelineStore()

function useTimelineStore(): FakeTimelineStore {
  return fakeTimelineStore
}

// —— 本地 spy（替代已删除的 @/editor/timeline/player,经 EngineDeps 注入）——
const applyFrameToRuntime = vi.fn(() => 0)

// 每个测试前重建 timeline 单例
beforeEach(() => {
  fakeTimelineStore = createFakeTimelineStore()
})

// ============================================================================
// 辅助:创建 engine 实例(每个 test 独立)
// ============================================================================

function makeEngine() {
  const timelineStore = useTimelineStore()
  const runtimeStore = useRuntimeStore()
  const graphStore = useGraphStore()
  const materialStore = useMaterialGraphStore()
  return createEngine({ timelineStore, runtimeStore, graphStore, materialStore, applyFrameToRuntime })
}

// ============================================================================
// E: createEngine 基本接口
// ============================================================================

describe('E: createEngine 基本接口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('E1: createEngine 返回控制接口', () => {
    const engine = makeEngine()
    expect(engine).toBeDefined()
    expect(typeof engine.start).toBe('function')
    expect(typeof engine.stop).toBe('function')
    expect(typeof engine.isRunning).toBe('function')
    expect(typeof engine.getMetrics).toBe('function')
  })

  it('E2: 初始 metrics', () => {
    const engine = makeEngine()
    const m = engine.getMetrics()
    expect(m.frameCount).toBe(0)
    expect(m.patchesLastFrame).toBe(0)
    expect(m.activeInputDrivers).toBe(0)
    expect(m.timelineSteppedLastFrame).toBe(false)
  })
})

// ============================================================================
// ID: InputDriver 注册 / 注销 / 调用
// ============================================================================

describe('ID: InputDriver', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    vi.clearAllMocks()
  })

  it('ID1: registerInputDriver 增加 activeInputDrivers', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(1)
  })

  it('ID2: unregisterInputDriver 减少 activeInputDrivers', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    engine.unregisterInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(0)
  })

  it('ID3: 重复注册同一 driver 不增加计数', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    engine.registerInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(1)
  })

  it('ID4: stepOnce 调用 driver.update,patchesLastFrame 更新', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)

    // 手动设置一个信号 + 绑定到 runtime 目标
    inputRouter.setSignal('mouse.x', 0.5, 'SENSOR')
    driver.addBinding({
      signalId: 'mouse.x',
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
      signalId: 'mouse.x',
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
    // 60 fps -> 1 step = 1000/60 ~ 16.67ms;给 20ms 足够步进一帧
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
    engine.stepOnce(0.016, 1000)
    expect(engine.getMetrics().frameCount).toBe(1)
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

  it('SO1: InputRouter -> InputDriver -> patches 链路', () => {
    const engine = makeEngine()

    // 1. 设置信号
    inputRouter.setSignal('mouse.x', 0.5, 'SENSOR')

    // 2. 注册 InputDriver,绑定 mouse.x -> layer_0.scale(runtime 目标)
    const driver = new InputDriver(inputRouter)
    driver.addBinding({
      signalId: 'mouse.x',
      targetKind: 'runtime',
      nodeId: 'layer_0',
      property: 'scale',
      mapping: { outMin: 0.5, outMax: 3.0 },
    })
    engine.registerInputDriver(driver)

    // 3. 执行一帧:driver 读信号 -> 生成 patch
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
    inputRouter.setSignal('mouse.x', 0.5, 'SENSOR')
    driver.addBinding({
      signalId: 'mouse.x',
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

  it('DISP1: dispose 清空 inputDrivers', () => {
    const engine = makeEngine()
    const driver = new InputDriver(inputRouter)
    engine.registerInputDriver(driver)
    engine.dispose()
    expect(engine.getMetrics().activeInputDrivers).toBe(0)
  })

  it('DISP2: dispose 重置 frameCount', () => {
    const engine = makeEngine()
    engine.stepOnce(0.016, 1000)
    engine.stepOnce(0.016, 1016)
    engine.dispose()
    expect(engine.getMetrics().frameCount).toBe(0)
  })

  it('DISP3: dispose 后 stepOnce 仍可工作(不报错)', () => {
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

  it('ERR1: InputDriver 抛异常不影响后续执行', () => {
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
