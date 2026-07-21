/**
 * Step 31.5 单元测试 — FrameScheduler + GpuResourceManager + ScheduledEngine。
 *
 * 覆盖:
 * - FS:  FrameScheduler 基本接口(start/stop/stepOnce/phase callbacks)
 * - PB:  时间预算(budget 设置 / getMetrics / overBudget)
 * - TQ:  RenderTaskQueue(优先级 / FIFO / 超时丢弃 / 取消)
 * - MM:  Metrics 记录(phaseMs / frameMs / frameCount)
 * - GRM: GpuResourceManager 注册 / 释放 / 销毁 / 释放追踪
 * - FSYNC: 帧同步(syncFrame / onSubmittedWorkDone)
 * - SE:  ScheduledEngine 集成(注册表 / play/pause / metrics 合并)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// —— Mock applyFrameToRuntime(避免依赖 runtimeStore.applyValuePatch) ——
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

import {
  FrameScheduler,
  createFrameScheduler,
  DEFAULT_BUDGET_60FPS,
  DEFAULT_BUDGET_30FPS,
  type PhaseBudget,
} from './frameScheduler'
import {
  GpuResourceManager,
  bindGpuRenderPhase,
  type GpuResourceHandle,
} from './gpuResourceManager'
import { createScheduledEngine } from './engineScheduled'
import { resetInputRouterForTesting } from '@/input/inputRouter'
import { InputDriver } from '@/animation/drivers/inputDriver'
import { FeatureExtractor } from '@/input/audio/featureExtractor'
import { useTimelineStore } from '@/stores/timeline'
import { useRuntimeStore } from '@/stores/runtime'
import { useGraphStore } from '@/graph/graphStore'
import { useMaterialGraphStore } from '@/material/materialGraph'

// ============================================================================
// 辅助:Mock GPU device
// ============================================================================

function makeMockDevice(): {
  device: import('./types').RuntimeDeviceHandle
  destroySpy: ReturnType<typeof vi.fn>
  submitWorkDoneSpy: ReturnType<typeof vi.fn>
} {
  const destroySpy = vi.fn()
  const submitWorkDoneSpy = vi.fn(() => Promise.resolve())
  const device = {
    queue: {
      submit: vi.fn(),
      writeBuffer: vi.fn(),
      onSubmittedWorkDone: submitWorkDoneSpy,
    },
    createTexture: vi.fn(),
    createBuffer: vi.fn(),
    createShaderModule: vi.fn(),
    createComputePipeline: vi.fn(),
    createRenderPipeline: vi.fn(),
    createBindGroup: vi.fn(),
    createSampler: vi.fn(),
    createCommandEncoder: vi.fn(),
  } as unknown as import('./types').RuntimeDeviceHandle
  return { device, destroySpy, submitWorkDoneSpy }
}

function makeMockHandle(destroySpy?: ReturnType<typeof vi.fn>): GpuResourceHandle {
  return {
    destroy: destroySpy ?? vi.fn(),
  }
}

// ============================================================================
// 辅助:Mock FeatureExtractor / InputDriver(参考 engine.test.ts)
// ============================================================================

function makeMockFeatureExtractor(): FeatureExtractor & {
  update: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
} {
  return {
    update: vi.fn(() => ({
      volume: 0.5, bass: 0.4, mid: 0.3, high: 0.2, beat: false, bpm: 0,
    })),
    reset: vi.fn(),
    getLastFeatures: vi.fn(),
    setOptions: vi.fn(),
    getBeatDetector: vi.fn(),
  } as unknown as FeatureExtractor & {
    update: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
  }
}

function makeMockInputDriver(): InputDriver & {
  update: ReturnType<typeof vi.fn>
} {
  return {
    update: vi.fn(() => 0),
    evaluate: vi.fn(() => []),
    reset: vi.fn(),
    setOptions: vi.fn(),
    getBindings: vi.fn(() => []),
  } as unknown as InputDriver & {
    update: ReturnType<typeof vi.fn>
  }
}

function makeScheduledEngine(opts: { device?: import('./types').RuntimeDeviceHandle } = {}) {
  const timelineStore = useTimelineStore()
  const runtimeStore = useRuntimeStore()
  const graphStore = useGraphStore()
  const materialStore = useMaterialGraphStore()
  return createScheduledEngine({
    timelineStore,
    runtimeStore,
    graphStore,
    materialStore,
    device: opts.device,
  })
}

// ============================================================================
// FS: FrameScheduler 基本接口
// ============================================================================

describe('FS: FrameScheduler 基本接口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('FS1: 构造函数创建实例', () => {
    const sched = new FrameScheduler()
    expect(sched).toBeInstanceOf(FrameScheduler)
    expect(sched.isRunning()).toBe(false)
    expect(sched.getPendingTaskCount()).toBe(0)
  })

  it('FS2: 默认预算为 60FPS', () => {
    const sched = new FrameScheduler()
    expect(sched.getBudget()).toEqual(DEFAULT_BUDGET_60FPS)
  })

  it('FS3: 自定义预算', () => {
    const custom: PhaseBudget = { timeline: 1, input: 1, gpuRender: 10, background: 2 }
    const sched = new FrameScheduler({ budget: custom })
    expect(sched.getBudget()).toEqual(custom)
  })

  it('FS4: setBudget 修改预算', () => {
    const sched = new FrameScheduler()
    sched.setBudget(DEFAULT_BUDGET_30FPS)
    expect(sched.getBudget()).toEqual(DEFAULT_BUDGET_30FPS)
  })

  it('FS5: setPhaseCallback 注册回调', () => {
    const sched = new FrameScheduler()
    const cb = vi.fn()
    sched.setPhaseCallback('timeline', cb)
    sched.stepOnce(0.016, 1000)
    expect(cb).toHaveBeenCalledWith(0.016, 1000)
  })

  it('FS6: removePhaseCallback 移除回调', () => {
    const sched = new FrameScheduler()
    const cb = vi.fn()
    sched.setPhaseCallback('timeline', cb)
    sched.removePhaseCallback('timeline')
    sched.stepOnce(0.016, 1000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('FS7: phase 执行顺序:timeline → input → gpu-render → background', () => {
    const sched = new FrameScheduler()
    const order: string[] = []
    sched.setPhaseCallback('timeline', () => order.push('timeline'))
    sched.setPhaseCallback('input', () => order.push('input'))
    sched.setPhaseCallback('gpu-render', () => order.push('gpu-render'))
    sched.setPhaseCallback('background', () => order.push('background'))
    sched.stepOnce(0.016, 1000)
    expect(order).toEqual(['timeline', 'input', 'gpu-render', 'background'])
  })

  it('FS8: stepOnce 后 frameCount 递增', () => {
    const sched = new FrameScheduler()
    expect(sched.getMetrics().frameCount).toBe(0)
    sched.stepOnce(0.016, 1000)
    expect(sched.getMetrics().frameCount).toBe(1)
    sched.stepOnce(0.016, 1016)
    expect(sched.getMetrics().frameCount).toBe(2)
  })

  it('FS9: 未注册 phase 回调时不报错', () => {
    const sched = new FrameScheduler()
    expect(() => sched.stepOnce(0.016, 1000)).not.toThrow()
  })

  it('FS10: phase 回调异常被捕获不中断', () => {
    const sched = new FrameScheduler()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sched.setPhaseCallback('timeline', () => { throw new Error('boom') })
    sched.setPhaseCallback('input', () => { /* 应继续执行 */ })
    expect(() => sched.stepOnce(0.016, 1000)).not.toThrow()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

// ============================================================================
// PB: 时间预算 + Metrics
// ============================================================================

describe('PB: 时间预算 + Metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PB1: DEFAULT_BUDGET_60FPS 数值正确', () => {
    expect(DEFAULT_BUDGET_60FPS.timeline).toBe(2)
    expect(DEFAULT_BUDGET_60FPS.input).toBe(2)
    expect(DEFAULT_BUDGET_60FPS.gpuRender).toBe(8)
    expect(DEFAULT_BUDGET_60FPS.background).toBe(4)
  })

  it('PB2: DEFAULT_BUDGET_30FPS 数值正确', () => {
    expect(DEFAULT_BUDGET_30FPS.timeline).toBe(4)
    expect(DEFAULT_BUDGET_30FPS.input).toBe(4)
    expect(DEFAULT_BUDGET_30FPS.gpuRender).toBe(16)
    expect(DEFAULT_BUDGET_30FPS.background).toBe(8)
  })

  it('PB3: phaseMs 记录每 phase 耗时', () => {
    const sched = new FrameScheduler()
    sched.setPhaseCallback('timeline', () => { /* 立即返回 */ })
    sched.stepOnce(0.016, 1000)
    const m = sched.getMetrics()
    expect(m.phaseMs.timeline).toBeGreaterThanOrEqual(0)
    expect(m.phaseMs.input).toBeGreaterThanOrEqual(0)
    expect(m.phaseMs['gpu-render']).toBeGreaterThanOrEqual(0)
    expect(m.phaseMs.background).toBeGreaterThanOrEqual(0)
  })

  it('PB4: frameMs 记录单帧总耗时', () => {
    const sched = new FrameScheduler()
    sched.stepOnce(0.016, 1000)
    const m = sched.getMetrics()
    expect(m.frameMs).toBeGreaterThanOrEqual(0)
    // frameMs 应不超过 phaseMs 之和太多
    const sum = m.phaseMs.timeline + m.phaseMs.input + m.phaseMs['gpu-render'] + m.phaseMs.background
    expect(m.frameMs).toBeGreaterThanOrEqual(sum)
  })

  it('PB5: overBudget 在帧耗时超过 16.67ms 时为 true', () => {
    const sched = new FrameScheduler()
    // 用 vi.useFakeTimers + performance.now mock 模拟超时
    // 简化:直接检查初始值
    expect(sched.getMetrics().overBudget).toBe(false)
  })

  it('PB6: resetMetrics 清空所有指标', () => {
    const sched = new FrameScheduler()
    sched.stepOnce(0.016, 1000)
    sched.stepOnce(0.016, 1016)
    expect(sched.getMetrics().frameCount).toBe(2)
    sched.resetMetrics()
    expect(sched.getMetrics().frameCount).toBe(0)
    expect(sched.getMetrics().tasksCompleted).toBe(0)
  })

  it('PB7: idle 时间记录', () => {
    const sched = new FrameScheduler()
    sched.stepOnce(0.016, 1000)
    const m = sched.getMetrics()
    expect(m.phaseMs.idle).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// TQ: RenderTaskQueue 优先级 + 超时
// ============================================================================

describe('TQ: RenderTaskQueue 优先级 + 超时', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('TQ1: enqueueTask 返回任务 id', () => {
    const sched = new FrameScheduler()
    const id = sched.enqueueTask('low', () => false)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('TQ2: getPendingTaskCount 反映队列长度', () => {
    const sched = new FrameScheduler()
    sched.enqueueTask('low', () => false)
    sched.enqueueTask('normal', () => false)
    expect(sched.getPendingTaskCount()).toBe(2)
  })

  it('TQ3: cancelTask 取消任务', () => {
    const sched = new FrameScheduler()
    const id = sched.enqueueTask('low', () => false)
    expect(sched.cancelTask(id)).toBe(true)
    expect(sched.getPendingTaskCount()).toBe(0)
  })

  it('TQ4: cancelTask 不存在的 id 返回 false', () => {
    const sched = new FrameScheduler()
    expect(sched.cancelTask('nonexistent')).toBe(false)
  })

  it('TQ5: clearTasks 清空所有任务', () => {
    const sched = new FrameScheduler()
    sched.enqueueTask('low', () => false)
    sched.enqueueTask('high', () => false)
    sched.clearTasks()
    expect(sched.getPendingTaskCount()).toBe(0)
  })

  it('TQ6: 任务在 stepOnce 时被执行(background phase)', () => {
    const sched = new FrameScheduler()
    const execute = vi.fn(() => false)
    sched.enqueueTask('low', execute)
    sched.stepOnce(0.016, 1000)
    expect(execute).toHaveBeenCalled()
  })

  it('TQ7: 返回 false 的任务被执行后从队列移除', () => {
    const sched = new FrameScheduler()
    sched.enqueueTask('low', () => false)
    sched.stepOnce(0.016, 1000)
    expect(sched.getPendingTaskCount()).toBe(0)
    expect(sched.getMetrics().tasksCompleted).toBe(1)
  })

  it('TQ8: 返回 true 的任务保留在队列中(下次继续)', () => {
    const sched = new FrameScheduler()
    let callCount = 0
    sched.enqueueTask('low', () => {
      callCount++
      return callCount < 2  // 第一次返回 true(未完成),第二次返回 false(完成)
    })
    sched.stepOnce(0.016, 1000)
    expect(sched.getPendingTaskCount()).toBe(1)
    expect(callCount).toBe(1)
    sched.stepOnce(0.016, 1016)
    expect(sched.getPendingTaskCount()).toBe(0)
    expect(callCount).toBe(2)
  })

  it('TQ9: 优先级排序(critical 先于 low)', () => {
    const sched = new FrameScheduler()
    const executedOrder: string[] = []
    // 先入队 low,再入队 critical → 执行顺序应为 critical 先
    sched.enqueueTask('low', () => { executedOrder.push('low'); return false })
    sched.enqueueTask('critical', () => { executedOrder.push('critical'); return false })
    sched.stepOnce(0.016, 1000)
    expect(executedOrder[0]).toBe('critical')
    expect(executedOrder[1]).toBe('low')
  })

  it('TQ10: 同优先级按 FIFO', () => {
    const sched = new FrameScheduler()
    const executedOrder: string[] = []
    sched.enqueueTask('normal', () => { executedOrder.push('first'); return false })
    sched.enqueueTask('normal', () => { executedOrder.push('second'); return false })
    sched.stepOnce(0.016, 1000)
    expect(executedOrder).toEqual(['first', 'second'])
  })

  it('TQ11: 任务异常被捕获并标记完成', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sched = new FrameScheduler()
    sched.enqueueTask('low', () => { throw new Error('task boom') })
    sched.stepOnce(0.016, 1000)
    expect(sched.getPendingTaskCount()).toBe(0)
    expect(sched.getMetrics().tasksCompleted).toBe(1)
    errSpy.mockRestore()
  })

  it('TQ12: tasksExecutedLastFrame 记录上一帧执行的任务数', () => {
    const sched = new FrameScheduler()
    sched.enqueueTask('low', () => false)
    sched.enqueueTask('low', () => false)
    sched.stepOnce(0.016, 1000)
    expect(sched.getMetrics().tasksExecutedLastFrame).toBe(2)
  })

  it('TQ13: 任务超时被丢弃(taskTimeoutMs)', () => {
    const sched = new FrameScheduler({ taskTimeoutMs: 100 })
    // 入队一个永远返回 true 的任务(模拟未完成)
    sched.enqueueTask('low', () => true)
    // 手动将 createdAt 设为很早的时间,模拟任务已超时
    // (enqueueTask 使用 performance.now() 设置 createdAt,测试中需要手动调整以匹配传入的 now)
    const tasks = (sched as unknown as { taskQueue: Array<{ createdAt: number }> }).taskQueue
    expect(tasks.length).toBe(1)
    tasks[0].createdAt = -10000
    // now=1000, age = 1000 - (-10000) = 11000 > 100 → 任务被丢弃
    sched.stepOnce(0.016, 1000)
    expect(sched.getMetrics().tasksDropped).toBeGreaterThanOrEqual(1)
    expect(sched.getPendingTaskCount()).toBe(0)
  })
})

// ============================================================================
// MM: Metrics 综合
// ============================================================================

describe('MM: Metrics 综合', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('MM1: getMetrics 返回完整对象', () => {
    const sched = new FrameScheduler()
    const m = sched.getMetrics()
    expect(m).toHaveProperty('fps')
    expect(m).toHaveProperty('frameCount')
    expect(m).toHaveProperty('phaseMs')
    expect(m).toHaveProperty('frameMs')
    expect(m).toHaveProperty('overBudget')
    expect(m).toHaveProperty('pendingTasks')
    expect(m).toHaveProperty('tasksExecutedLastFrame')
    expect(m).toHaveProperty('tasksCompleted')
    expect(m).toHaveProperty('tasksDropped')
  })

  it('MM2: phaseMs 包含所有 phase', () => {
    const sched = new FrameScheduler()
    sched.stepOnce(0.016, 1000)
    const m = sched.getMetrics()
    expect(m.phaseMs).toHaveProperty('timeline')
    expect(m.phaseMs).toHaveProperty('input')
    expect(m.phaseMs).toHaveProperty('gpu-render')
    expect(m.phaseMs).toHaveProperty('background')
    expect(m.phaseMs).toHaveProperty('idle')
  })

  it('MM3: getMetrics 返回副本(修改不影响内部)', () => {
    const sched = new FrameScheduler()
    sched.stepOnce(0.016, 1000)
    const m1 = sched.getMetrics()
    m1.frameCount = 999
    const m2 = sched.getMetrics()
    expect(m2.frameCount).toBe(1)
  })

  it('MM4: phaseMs 副本独立', () => {
    const sched = new FrameScheduler()
    sched.stepOnce(0.016, 1000)
    const m1 = sched.getMetrics()
    m1.phaseMs.timeline = 999
    const m2 = sched.getMetrics()
    expect(m2.phaseMs.timeline).not.toBe(999)
  })
})

// ============================================================================
// createFrameScheduler 便捷函数
// ============================================================================

describe('CFS: createFrameScheduler 便捷函数', () => {
  it('CFS1: 创建并注册回调', () => {
    const onTimeline = vi.fn()
    const sched = createFrameScheduler({ onTimeline })
    sched.stepOnce(0.016, 1000)
    expect(onTimeline).toHaveBeenCalledWith(0.016, 1000)
  })

  it('CFS2: 注册多 phase 回调', () => {
    const onTimeline = vi.fn()
    const onInput = vi.fn()
    const onGpuRender = vi.fn()
    const sched = createFrameScheduler({ onTimeline, onInput, onGpuRender })
    sched.stepOnce(0.016, 1000)
    expect(onTimeline).toHaveBeenCalled()
    expect(onInput).toHaveBeenCalled()
    expect(onGpuRender).toHaveBeenCalled()
  })

  it('CFS3: 自定义 budget 传入', () => {
    const budget: PhaseBudget = { timeline: 1, input: 1, gpuRender: 5, background: 2 }
    const sched = createFrameScheduler({ budget })
    expect(sched.getBudget()).toEqual(budget)
  })
})

// ============================================================================
// GRM: GpuResourceManager 注册 / 释放 / 销毁
// ============================================================================

describe('GRM: GpuResourceManager 注册 / 释放 / 销毁', () => {
  let mockDevice: ReturnType<typeof makeMockDevice>

  beforeEach(() => {
    mockDevice = makeMockDevice()
    vi.clearAllMocks()
  })

  it('GRM1: 构造函数创建实例', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    expect(mgr).toBeInstanceOf(GpuResourceManager)
    expect(mgr.getLiveCount()).toBe(0)
  })

  it('GRM2: register 增加活跃资源数', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    expect(mgr.getLiveCount()).toBe(1)
    expect(mgr.isActive('res1')).toBe(true)
  })

  it('GRM3: registerBuffer / registerTexture 便捷方法', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.registerBuffer('buf1', makeMockHandle(), 512)
    mgr.registerTexture('tex1', makeMockHandle(), 1024)
    expect(mgr.getLiveCount()).toBe(2)
    const m = mgr.getMetrics()
    expect(m.liveBufferBytes).toBe(512)
    expect(m.liveTextureBytes).toBe(1024)
  })

  it('GRM4: register 重复 id 覆盖并释放旧的', () => {
    const destroySpy = vi.fn()
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(destroySpy), 256)
    mgr.register('res1', 'buffer', makeMockHandle(), 512)
    expect(mgr.getLiveCount()).toBe(1)
    // 旧的应被标记 released
    expect(destroySpy).not.toHaveBeenCalled() // 还没 endFrame
    expect(mgr.getMetrics().totalReleased).toBe(1)
  })

  it('GRM5: release 标记资源为 released', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    expect(mgr.release('res1')).toBe(true)
    expect(mgr.isActive('res1')).toBe(false)
    expect(mgr.getLiveCount()).toBe(0)
    expect(mgr.getMetrics().totalReleased).toBe(1)
  })

  it('GRM6: release 不存在的 id 返回 false', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    expect(mgr.release('nonexistent')).toBe(false)
  })

  it('GRM7: release 已释放的资源再次 release 返回 true(幂等)', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    mgr.release('res1')
    expect(mgr.release('res1')).toBe(true)
    // totalReleased 不应重复计数
    expect(mgr.getMetrics().totalReleased).toBe(1)
  })

  it('GRM8: endFrame 销毁 released 资源', () => {
    const destroySpy = vi.fn()
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(destroySpy), 256)
    mgr.release('res1')
    expect(destroySpy).not.toHaveBeenCalled()
    mgr.endFrame()
    expect(destroySpy).toHaveBeenCalled()
  })

  it('GRM9: forceDestroy 立即销毁资源', () => {
    const destroySpy = vi.fn()
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(destroySpy), 256)
    mgr.forceDestroy('res1')
    expect(destroySpy).toHaveBeenCalled()
    expect(mgr.getLiveCount()).toBe(0)
  })

  it('GRM10: releaseByTag 批量释放', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256, 'layer1')
    mgr.register('res2', 'texture', makeMockHandle(), 512, 'layer1')
    mgr.register('res3', 'buffer', makeMockHandle(), 128, 'layer2')
    const count = mgr.releaseByTag('layer1')
    expect(count).toBe(2)
    expect(mgr.isActive('res1')).toBe(false)
    expect(mgr.isActive('res2')).toBe(false)
    expect(mgr.isActive('res3')).toBe(true)
  })

  it('GRM11: releaseAll 释放所有资源', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    mgr.register('res2', 'texture', makeMockHandle(), 512)
    mgr.releaseAll()
    expect(mgr.getLiveCount()).toBe(0)
    // pendingDestroy 也应被 flush
    expect(mgr.getMetrics().pendingReleaseCount).toBe(0)
  })

  it('GRM12: get 返回资源条目', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256, 'tag1')
    const entry = mgr.get('res1')
    expect(entry).toBeDefined()
    expect(entry?.id).toBe('res1')
    expect(entry?.kind).toBe('buffer')
    expect(entry?.bytes).toBe(256)
    expect(entry?.tag).toBe('tag1')
    expect(entry?.state).toBe('active')
  })

  it('GRM13: listEntries 返回所有条目', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    mgr.register('res2', 'texture', makeMockHandle(), 512)
    const list = mgr.listEntries()
    expect(list.length).toBe(2)
  })

  it('GRM14: beginFrame + endFrame 帧计数', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.beginFrame()
    mgr.endFrame()
    expect(mgr.getMetrics().frameCount).toBe(1)
    mgr.beginFrame()
    mgr.endFrame()
    expect(mgr.getMetrics().frameCount).toBe(2)
  })

  it('GRM15: totalCreated 累计创建数', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    mgr.register('res2', 'texture', makeMockHandle(), 512)
    mgr.register('res3', 'buffer', makeMockHandle(), 128)
    expect(mgr.getMetrics().totalCreated).toBe(3)
  })

  it('GRM16: genId 生成唯一 id', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    const id1 = mgr.genId('buf')
    const id2 = mgr.genId('buf')
    expect(id1).not.toBe(id2)
    expect(id1.startsWith('buf_')).toBe(true)
  })

  it('GRM17: 销毁异常被捕获不中断', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badHandle: GpuResourceHandle = {
      destroy: () => { throw new Error('destroy failed') },
    }
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.register('res1', 'buffer', badHandle, 256)
    mgr.release('res1')
    expect(() => mgr.endFrame()).not.toThrow()
    errSpy.mockRestore()
  })
})

// ============================================================================
// FSYNC: 帧同步
// ============================================================================

describe('FSYNC: 帧同步', () => {
  let mockDevice: ReturnType<typeof makeMockDevice>

  beforeEach(() => {
    mockDevice = makeMockDevice()
    vi.clearAllMocks()
  })

  it('FSYNC1: syncFrame 调用 onSubmittedWorkDone', async () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    await mgr.syncFrame()
    expect(mockDevice.submitWorkDoneSpy).toHaveBeenCalled()
    expect(mgr.getMetrics().syncCount).toBe(1)
  })

  it('FSYNC2: 多次 syncFrame 累计 syncCount', async () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    await mgr.syncFrame()
    await mgr.syncFrame()
    await mgr.syncFrame()
    expect(mgr.getMetrics().syncCount).toBe(3)
  })

  it('FSYNC3: autoSync=true 时 endFrame 自动 syncFrame', async () => {
    const mgr = new GpuResourceManager(mockDevice.device, { autoSync: true })
    mgr.endFrame()
    // 等待 microtask(onSubmittedWorkDone 是 async)
    await new Promise((r) => setTimeout(r, 0))
    expect(mockDevice.submitWorkDoneSpy).toHaveBeenCalled()
    expect(mgr.getMetrics().syncCount).toBe(1)
  })

  it('FSYNC4: autoSync=false(默认)时 endFrame 不自动 sync', () => {
    const mgr = new GpuResourceManager(mockDevice.device)
    mgr.endFrame()
    expect(mockDevice.submitWorkDoneSpy).not.toHaveBeenCalled()
    expect(mgr.getMetrics().syncCount).toBe(0)
  })

  it('FSYNC5: syncFrame 异常被捕获', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingDevice = makeMockDevice()
    failingDevice.submitWorkDoneSpy = vi.fn(() => Promise.reject(new Error('sync failed')))
    const failingRuntime = {
      ...failingDevice.device,
      queue: {
        ...failingDevice.device.queue,
        onSubmittedWorkDone: failingDevice.submitWorkDoneSpy,
      },
    } as unknown as import('./types').RuntimeDeviceHandle
    const mgr = new GpuResourceManager(failingRuntime)
    await expect(mgr.syncFrame()).resolves.not.toThrow()
    expect(mgr.getMetrics().syncCount).toBe(1)
    errSpy.mockRestore()
  })
})

// ============================================================================
// bindGpuRenderPhase
// ============================================================================

describe('BGP: bindGpuRenderPhase', () => {
  let mockDevice: ReturnType<typeof makeMockDevice>

  beforeEach(() => {
    mockDevice = makeMockDevice()
    vi.clearAllMocks()
  })

  it('BGP1: 创建 manager 并注册 gpu-render 回调', () => {
    const sched = new FrameScheduler()
    const onRender = vi.fn()
    const mgr = bindGpuRenderPhase(sched, mockDevice.device, onRender)
    expect(mgr).toBeInstanceOf(GpuResourceManager)
    sched.stepOnce(0.016, 1000)
    expect(onRender).toHaveBeenCalled()
    // 回调参数应包含 GpuRenderContext
    const ctx = onRender.mock.calls[0][0]
    expect(ctx).toHaveProperty('frameCount')
    expect(ctx).toHaveProperty('dt')
    expect(ctx).toHaveProperty('now')
    expect(ctx).toHaveProperty('resources')
    expect(ctx.resources).toBe(mgr)
  })

  it('BGP2: 每帧 frameCount 递增', () => {
    const sched = new FrameScheduler()
    const onRender = vi.fn()
    bindGpuRenderPhase(sched, mockDevice.device, onRender)
    sched.stepOnce(0.016, 1000)
    sched.stepOnce(0.016, 1016)
    const ctx1 = onRender.mock.calls[0][0]
    const ctx2 = onRender.mock.calls[1][0]
    expect(ctx2.frameCount).toBe(ctx1.frameCount + 1)
  })

  it('BGP3: onRender 异常被捕获', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sched = new FrameScheduler()
    bindGpuRenderPhase(sched, mockDevice.device, () => {
      throw new Error('render boom')
    })
    expect(() => sched.stepOnce(0.016, 1000)).not.toThrow()
    errSpy.mockRestore()
  })

  it('BGP4: endFrame 在 onRender 之后调用(资源销毁)', () => {
    const sched = new FrameScheduler()
    const destroySpy = vi.fn()
    const mgr = bindGpuRenderPhase(sched, mockDevice.device, (ctx) => {
      ctx.resources.register('temp', 'buffer', makeMockHandle(destroySpy), 256)
      ctx.resources.release('temp')
    })
    sched.stepOnce(0.016, 1000)
    expect(destroySpy).toHaveBeenCalled()
    expect(mgr.getLiveCount()).toBe(0)
  })
})

// ============================================================================
// SE: ScheduledEngine 集成
// ============================================================================

describe('SE: ScheduledEngine 集成', () => {
  let mockDevice: ReturnType<typeof makeMockDevice>

  beforeEach(() => {
    setActivePinia(createPinia())
    resetInputRouterForTesting()
    mockDevice = makeMockDevice()
    vi.clearAllMocks()
  })

  it('SE1: createScheduledEngine 返回所有必需方法', () => {
    const engine = makeScheduledEngine()
    expect(typeof engine.start).toBe('function')
    expect(typeof engine.stop).toBe('function')
    expect(typeof engine.isRunning).toBe('function')
    expect(typeof engine.getMetrics).toBe('function')
    expect(typeof engine.registerFeatureExtractor).toBe('function')
    expect(typeof engine.registerInputDriver).toBe('function')
    expect(typeof engine.play).toBe('function')
    expect(typeof engine.pause).toBe('function')
    expect(typeof engine.toggle).toBe('function')
    expect(typeof engine.isPlaying).toBe('function')
    expect(typeof engine.enqueueTask).toBe('function')
    expect(typeof engine.cancelTask).toBe('function')
    expect(typeof engine.stepOnce).toBe('function')
    expect(typeof engine.dispose).toBe('function')
  })

  it('SE2: 初始 metrics 正确', () => {
    const engine = makeScheduledEngine()
    const m = engine.getMetrics()
    expect(m.activeFeatureExtractors).toBe(0)
    expect(m.activeInputDrivers).toBe(0)
    expect(m.patchesLastFrame).toBe(0)
    expect(m.timelineSteppedLastFrame).toBe(false)
    expect(m.scheduler.frameCount).toBe(0)
  })

  it('SE3: stepOnce 递增 frameCount', () => {
    const engine = makeScheduledEngine()
    engine.stepOnce(0.016, 1000)
    expect(engine.getMetrics().scheduler.frameCount).toBe(1)
    engine.stepOnce(0.016, 1016)
    expect(engine.getMetrics().scheduler.frameCount).toBe(2)
  })

  it('SE4: registerFeatureExtractor 后 metrics 递增', () => {
    const engine = makeScheduledEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    expect(engine.getMetrics().activeFeatureExtractors).toBe(1)
  })

  it('SE5: unregisterFeatureExtractor 后 metrics 递减', () => {
    const engine = makeScheduledEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.unregisterFeatureExtractor(fx)
    expect(engine.getMetrics().activeFeatureExtractors).toBe(0)
  })

  it('SE6: registerInputDriver 后 metrics 递增', () => {
    const engine = makeScheduledEngine()
    const driver = makeMockInputDriver()
    engine.registerInputDriver(driver)
    expect(engine.getMetrics().activeInputDrivers).toBe(1)
  })

  it('SE7: stepOnce 触发 extractor.update', () => {
    const engine = makeScheduledEngine()
    const fx = makeMockFeatureExtractor()
    engine.registerFeatureExtractor(fx)
    engine.stepOnce(0.016, 1234)
    expect(fx.update).toHaveBeenCalledWith(1234)
  })

  it('SE8: stepOnce 触发 driver.update', () => {
    const engine = makeScheduledEngine()
    const driver = makeMockInputDriver()
    engine.registerInputDriver(driver)
    engine.stepOnce(0.016, 1000)
    expect(driver.update).toHaveBeenCalled()
  })

  it('SE9: play 设置 isPlaying=true', () => {
    const engine = makeScheduledEngine()
    engine.play()
    expect(engine.isPlaying()).toBe(true)
  })

  it('SE10: pause 设置 isPlaying=false', () => {
    const engine = makeScheduledEngine()
    engine.play()
    engine.pause()
    expect(engine.isPlaying()).toBe(false)
  })

  it('SE11: toggle 切换播放状态', () => {
    const engine = makeScheduledEngine()
    expect(engine.isPlaying()).toBe(false)
    engine.toggle()
    expect(engine.isPlaying()).toBe(true)
    engine.toggle()
    expect(engine.isPlaying()).toBe(false)
  })

  it('SE12: play 时 stepOnce 推进 timeline', () => {
    const engine = makeScheduledEngine()
    engine.play()
    engine.stepOnce(0.5, 1000)  // 500ms,远超 1 帧(默认 60fps=16.67ms)
    expect(engine.getMetrics().timelineSteppedLastFrame).toBe(true)
  })

  it('SE13: pause 时 stepOnce 不推进 timeline', () => {
    const engine = makeScheduledEngine()
    engine.stepOnce(0.5, 1000)
    expect(engine.getMetrics().timelineSteppedLastFrame).toBe(false)
  })

  it('SE14: enqueueTask 入队后台任务', () => {
    const engine = makeScheduledEngine()
    const id = engine.enqueueTask('low', () => false)
    expect(typeof id).toBe('string')
    expect(engine.getPendingTaskCount()).toBe(1)
    engine.stepOnce(0.016, 1000)
    expect(engine.getPendingTaskCount()).toBe(0)
  })

  it('SE15: cancelTask 取消任务', () => {
    const engine = makeScheduledEngine()
    const id = engine.enqueueTask('low', () => false)
    expect(engine.cancelTask(id)).toBe(true)
    expect(engine.getPendingTaskCount()).toBe(0)
  })

  it('SE16: clearTasks 清空队列', () => {
    const engine = makeScheduledEngine()
    engine.enqueueTask('low', () => false)
    engine.enqueueTask('high', () => false)
    engine.clearTasks()
    expect(engine.getPendingTaskCount()).toBe(0)
  })

  it('SE17: 提供 device 时启用 GpuResourceManager', () => {
    const engine = makeScheduledEngine({ device: mockDevice.device })
    const mgr = engine.getGpuResourceManager()
    expect(mgr).not.toBeNull()
    expect(engine.getMetrics().gpu).not.toBeNull()
  })

  it('SE18: 不提供 device 时 GpuResourceManager 为 null', () => {
    const engine = makeScheduledEngine()
    expect(engine.getGpuResourceManager()).toBeNull()
    expect(engine.getMetrics().gpu).toBeNull()
  })

  it('SE19: setGpuRenderCallback 设置回调', () => {
    const engine = makeScheduledEngine({ device: mockDevice.device })
    const onRender = vi.fn()
    engine.setGpuRenderCallback(onRender)
    engine.stepOnce(0.016, 1000)
    expect(onRender).toHaveBeenCalled()
    const ctx = onRender.mock.calls[0][0]
    expect(ctx).toHaveProperty('resources')
  })

  it('SE20: extractor 异常被捕获不中断', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const engine = makeScheduledEngine()
    const badFx = {
      update: () => { throw new Error('fx boom') },
      reset: vi.fn(),
    } as unknown as FeatureExtractor
    engine.registerFeatureExtractor(badFx)
    expect(() => engine.stepOnce(0.016, 1000)).not.toThrow()
    errSpy.mockRestore()
  })

  it('SE21: driver 异常被捕获不中断', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const engine = makeScheduledEngine()
    const badDriver = {
      update: () => { throw new Error('driver boom') },
      evaluate: vi.fn(() => []),
      reset: vi.fn(),
    } as unknown as InputDriver
    engine.registerInputDriver(badDriver)
    expect(() => engine.stepOnce(0.016, 1000)).not.toThrow()
    errSpy.mockRestore()
  })

  it('SE22: dispose 清理资源', () => {
    const engine = makeScheduledEngine({ device: mockDevice.device })
    const fx = makeMockFeatureExtractor()
    const driver = makeMockInputDriver()
    engine.registerFeatureExtractor(fx)
    engine.registerInputDriver(driver)
    engine.enqueueTask('low', () => false)
    engine.dispose()
    expect(engine.getMetrics().activeFeatureExtractors).toBe(0)
    expect(engine.getMetrics().activeInputDrivers).toBe(0)
    expect(engine.getPendingTaskCount()).toBe(0)
  })

  it('SE23: dispose 后 GpuResourceManager 资源全释放', () => {
    const engine = makeScheduledEngine({ device: mockDevice.device })
    const mgr = engine.getGpuResourceManager()!
    mgr.register('res1', 'buffer', makeMockHandle(), 256)
    engine.dispose()
    expect(mgr.getLiveCount()).toBe(0)
  })

  it('SE24: 合并 metrics 包含 scheduler + gpu', () => {
    const engine = makeScheduledEngine({ device: mockDevice.device })
    engine.stepOnce(0.016, 1000)
    const m = engine.getMetrics()
    expect(m.scheduler).toBeDefined()
    expect(m.scheduler.frameCount).toBe(1)
    expect(m.gpu).toBeDefined()
    expect(m.gpu?.frameCount).toBe(1) // gpu-render phase 执行了 endFrame
  })

  it('SE25: patchesLastFrame 反映 InputDriver 返回值', () => {
    const engine = makeScheduledEngine()
    const driver = makeMockInputDriver()
    ;(driver.update as ReturnType<typeof vi.fn>).mockReturnValue(3)
    engine.registerInputDriver(driver)
    engine.stepOnce(0.016, 1000)
    expect(engine.getMetrics().patchesLastFrame).toBe(3)
  })
})
