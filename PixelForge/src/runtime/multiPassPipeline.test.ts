/**
 * Multi-Pass Pipeline Tests(Step 39.3)
 *
 * 测试策略:
 * - renderTarget:创建/销毁/复用/格式化/字节估算
 * - postProcessChain:addPass/insertPass/removePass/enable/ping-pong 调度/短路优化/统计
 * - multiPassPipeline:scene→chain→present 编排/跳过后处理/统计/RT 复用
 *
 * 设计:纯元数据测试(不依赖真实 GPU,createGpuTexture 不传)
 */
import { describe, it, expect, vi } from 'vitest'
import {
  createRenderTarget,
  destroyRenderTarget,
  releaseRenderTarget,
  acquireRenderTarget,
  normalizeDescriptor,
  isCompatibleDescriptor,
  estimateRenderTargetBytes,
  DEFAULT_RT_FORMAT,
  DEFAULT_RT_USAGE,
} from './renderTarget'
import {
  PostProcessChain,
  makePass,
  type PostProcessPassExecutor,
} from './postProcessChain'
import { MultiPassPipeline, type ScenePassExecutor } from './multiPassPipeline'

// ============================================================================
// 辅助:Mock GPUTexture
// ============================================================================

interface MockTexture {
  destroyed: boolean
  destroy: () => void
  createView: () => { label: string }
}

function createMockTexture(): MockTexture & GPUTexture {
  const mock = {
    destroyed: false,
    destroy: () => { mock.destroyed = true },
    createView: () => ({ label: 'mock_view' }),
  }
  return mock as unknown as MockTexture & GPUTexture
}

// ============================================================================
// 1. RenderTarget 工具函数
// ============================================================================

describe('RenderTarget / utilities', () => {
  it('U01: normalizeDescriptor 填充默认值', () => {
    const desc = normalizeDescriptor({ width: 1920, height: 1080 })
    expect(desc.width).toBe(1920)
    expect(desc.height).toBe(1080)
    expect(desc.format).toBe(DEFAULT_RT_FORMAT)
    expect(desc.usage).toBe(DEFAULT_RT_USAGE)
    expect(desc.label).toMatch(/^rt_/)
  })

  it('U02: normalizeDescriptor 保留传入值', () => {
    const desc = normalizeDescriptor({
      width: 800,
      height: 600,
      format: 'bgra8unorm',
      usage: 32,
      label: 'custom_rt',
    })
    expect(desc.format).toBe('bgra8unorm')
    expect(desc.usage).toBe(32)
    expect(desc.label).toBe('custom_rt')
  })

  it('U03: isCompatibleDescriptor 完全相同返回 true', () => {
    const a = normalizeDescriptor({ width: 1920, height: 1080 })
    const b = normalizeDescriptor({ width: 1920, height: 1080 })
    expect(isCompatibleDescriptor(a, b)).toBe(true)
  })

  it('U04: isCompatibleDescriptor 尺寸不同返回 false', () => {
    const a = normalizeDescriptor({ width: 1920, height: 1080 })
    const b = normalizeDescriptor({ width: 1280, height: 720 })
    expect(isCompatibleDescriptor(a, b)).toBe(false)
  })

  it('U05: isCompatibleDescriptor format 不同返回 false', () => {
    const a = normalizeDescriptor({ width: 1920, height: 1080 })
    const b = normalizeDescriptor({ width: 1920, height: 1080, format: 'bgra8unorm' })
    expect(isCompatibleDescriptor(a, b)).toBe(false)
  })

  it('U06: isCompatibleDescriptor usage 不同返回 false', () => {
    const a = normalizeDescriptor({ width: 1920, height: 1080 })
    const b = normalizeDescriptor({ width: 1920, height: 1080, usage: 32 })
    expect(isCompatibleDescriptor(a, b)).toBe(false)
  })

  it('U07: estimateRenderTargetBytes 按 rgba8unorm 计算(4 bytes/pixel)', () => {
    const rt = createRenderTarget('rt1', { width: 1920, height: 1080 })
    expect(estimateRenderTargetBytes(rt)).toBe(1920 * 1080 * 4)
  })

  it('U08: DEFAULT_RT_FORMAT 是 rgba8unorm', () => {
    expect(DEFAULT_RT_FORMAT).toBe('rgba8unorm')
  })

  it('U09: DEFAULT_RT_USAGE 含 STORAGE | TEXTURE_BINDING | COPY_DST', () => {
    // COPY_DST=8 | TEXTURE_BINDING=16 | STORAGE_BINDING=128
    expect(DEFAULT_RT_USAGE & 8).toBe(8)
    expect(DEFAULT_RT_USAGE & 16).toBe(16)
    expect(DEFAULT_RT_USAGE & 128).toBe(128)
  })
})

// ============================================================================
// 2. RenderTarget 生命周期
// ============================================================================

describe('RenderTarget / lifecycle', () => {
  it('L01: createRenderTarget 默认无 GPU texture', () => {
    const rt = createRenderTarget('rt1', { width: 1920, height: 1080 })
    expect(rt.id).toBe('rt1')
    expect(rt.inUse).toBe(true)
    expect(rt.texture).toBeUndefined()
    expect(rt.view).toBeUndefined()
    expect(rt.descriptor.width).toBe(1920)
  })

  it('L02: createRenderTarget 带 createGpuTexture 回调', () => {
    const createFn = vi.fn(() => createMockTexture())
    const rt = createRenderTarget('rt1', { width: 100, height: 100 }, { createGpuTexture: createFn })
    expect(createFn).toHaveBeenCalledTimes(1)
    expect(rt.texture).toBeDefined()
    expect(rt.view).toBeDefined() // createView 被调用
  })

  it('L03: releaseRenderTarget 标记 inUse=false', () => {
    const rt = createRenderTarget('rt1', { width: 100, height: 100 })
    releaseRenderTarget(rt)
    expect(rt.inUse).toBe(false)
  })

  it('L04: acquireRenderTarget 标记 inUse=true', () => {
    const rt = createRenderTarget('rt1', { width: 100, height: 100 })
    releaseRenderTarget(rt)
    acquireRenderTarget(rt)
    expect(rt.inUse).toBe(true)
  })

  it('L05: destroyRenderTarget 清空 texture 和 view', () => {
    const createFn = vi.fn(() => createMockTexture())
    const destroyFn = vi.fn()
    const rt = createRenderTarget('rt1', { width: 100, height: 100 }, {
      createGpuTexture: createFn,
      destroyGpuTexture: destroyFn,
    })
    destroyRenderTarget(rt, { destroyGpuTexture: destroyFn })
    expect(rt.texture).toBeUndefined()
    expect(rt.view).toBeUndefined()
    expect(rt.inUse).toBe(false)
    expect(destroyFn).toHaveBeenCalledTimes(1)
  })

  it('L06: destroyRenderTarget 无 GPU texture 时静默通过', () => {
    const rt = createRenderTarget('rt1', { width: 100, height: 100 })
    expect(() => destroyRenderTarget(rt)).not.toThrow()
    expect(rt.texture).toBeUndefined()
  })

  it('L07: destroyRenderTarget 默认调用 texture.destroy()', () => {
    const mockTexture = createMockTexture()
    const rt = createRenderTarget('rt1', { width: 100, height: 100 }, {
      createGpuTexture: () => mockTexture as unknown as GPUTexture,
    })
    destroyRenderTarget(rt) // 不传 destroyGpuTexture
    expect(mockTexture.destroyed).toBe(true)
  })
})

// ============================================================================
// 3. PostProcessChain — Pass 管理
// ============================================================================

describe('PostProcessChain / pass management', () => {
  it('PM01: addPass 添加到链尾', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1'))
    chain.addPass(makePass('bloom', 'bloom_v1'))
    expect(chain.getPasses()).toHaveLength(2)
    expect(chain.getPasses()[0].name).toBe('blur')
    expect(chain.getPasses()[1].name).toBe('bloom')
  })

  it('PM02: insertPass 在指定位置插入', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1'))
    chain.addPass(makePass('bloom', 'bloom_v1'))
    chain.insertPass(1, makePass('vignette', 'vignette_v1'))
    const passes = chain.getPasses()
    expect(passes).toHaveLength(3)
    expect(passes[1].name).toBe('vignette')
    expect(passes[0].name).toBe('blur')
    expect(passes[2].name).toBe('bloom')
  })

  it('PM03: removePass 按 ID 移除', () => {
    const chain = new PostProcessChain()
    const p1 = makePass('blur', 'blur_v1', {}, { id: 'p1' })
    const p2 = makePass('bloom', 'bloom_v1', {}, { id: 'p2' })
    chain.addPass(p1)
    chain.addPass(p2)
    expect(chain.removePass('p1')).toBe(true)
    expect(chain.getPasses()).toHaveLength(1)
    expect(chain.getPasses()[0].id).toBe('p2')
  })

  it('PM04: removePass 不存在返回 false', () => {
    const chain = new PostProcessChain()
    expect(chain.removePass('nonexistent')).toBe(false)
  })

  it('PM05: getPass 按 ID 查找', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', {}, { id: 'p1' }))
    const pass = chain.getPass('p1')
    expect(pass).toBeDefined()
    expect(pass!.name).toBe('blur')
  })

  it('PM06: setPassEnabled 切换启用状态', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', {}, { id: 'p1' }))
    expect(chain.setPassEnabled('p1', false)).toBe(true)
    expect(chain.getPass('p1')!.enabled).toBe(false)
    expect(chain.getEnabledPassCount()).toBe(0)
  })

  it('PM07: updatePassParams 合并参数', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', { radius: 5 }, { id: 'p1' }))
    chain.updatePassParams('p1', { strength: 0.8 })
    const pass = chain.getPass('p1')!
    expect(pass.params).toEqual({ radius: 5, strength: 0.8 })
  })

  it('PM08: clear 清空所有 pass', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1'))
    chain.addPass(makePass('bloom', 'bloom_v1'))
    chain.clear()
    expect(chain.getPasses()).toHaveLength(0)
  })

  it('PM09: makePass 默认 kind=compute', () => {
    const pass = makePass('blur', 'blur_v1')
    expect(pass.kind).toBe('compute')
  })

  it('PM10: makePass 自定义 kind 和 enabled', () => {
    const pass = makePass('fxaa', 'fxaa_v1', {}, { kind: 'render', enabled: false })
    expect(pass.kind).toBe('render')
    expect(pass.enabled).toBe(false)
  })
})

// ============================================================================
// 4. PostProcessChain — 执行调度
// ============================================================================

describe('PostProcessChain / execution', () => {
  /** 创建测试用 RT */
  function makeRT(id: string, w = 100, h = 100): ReturnType<typeof createRenderTarget> {
    return createRenderTarget(id, { width: w, height: h })
  }

  it('EX01: 空 chain 短路,executor 不被调用', () => {
    const chain = new PostProcessChain()
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn(() => 0)
    const result = chain.execute(input, output, executor)
    expect(executor).not.toHaveBeenCalled()
    expect(result.executedPassCount).toBe(0)
    expect(result.totalMs).toBe(0)
    expect(result.shortCircuited).toBe(true)
  })

  it('EX02: 单 pass 短路,input → output 直连', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', { radius: 5 }, { id: 'p1' }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn(() => 2.5)
    const result = chain.execute(input, output, executor)
    expect(executor).toHaveBeenCalledTimes(1)
    // 验证 input 和 output 直接传入(无中间 RT)
    expect(executor).toHaveBeenCalledWith(input, output, expect.any(Object))
    expect(result.executedPassCount).toBe(1)
    expect(result.totalMs).toBe(2.5)
    expect(result.shortCircuited).toBe(true)
  })

  it('EX03: 两 pass ping-pong:input → rtA → output', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', {}, { id: 'p1' }))
    chain.addPass(makePass('bloom', 'bloom_v1', {}, { id: 'p2' }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)
    const result = chain.execute(input, output, executor)
    expect(executor).toHaveBeenCalledTimes(2)
    // Pass 1: input → rtA(中间 RT,非 output)
    const call1 = executor.mock.calls[0]
    expect(call1[0]).toBe(input) // input
    expect(call1[1]).not.toBe(output) // 中间 RT
    expect(call1[1]).not.toBe(input)
    // Pass 2: rtA → output
    const call2 = executor.mock.calls[1]
    expect(call2[0]).toBe(call1[1]) // 上次的 output 作为这次的 input
    expect(call2[1]).toBe(output)
    expect(result.executedPassCount).toBe(2)
    expect(result.totalMs).toBe(2.0)
    expect(result.shortCircuited).toBe(false)
  })

  it('EX04: 三 pass ping-pong:input → rtA → rtB → output', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn<PostProcessPassExecutor>(() => 0.5)
    const result = chain.execute(input, output, executor)
    expect(executor).toHaveBeenCalledTimes(3)
    // Pass 1: input → rtA
    const rtA = executor.mock.calls[0][1]
    expect(executor.mock.calls[0][0]).toBe(input)
    // Pass 2: rtA → rtB
    const rtB = executor.mock.calls[1][1]
    expect(executor.mock.calls[1][0]).toBe(rtA)
    expect(rtB).not.toBe(rtA)
    // Pass 3: rtB → output
    expect(executor.mock.calls[2][0]).toBe(rtB)
    expect(executor.mock.calls[2][1]).toBe(output)
    expect(result.executedPassCount).toBe(3)
    expect(result.totalMs).toBe(1.5)
  })

  it('EX05: 四 pass ping-pong:input → rtA → rtB → rtA → output', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    chain.addPass(makePass('p4', 's4', {}, { id: 'p4' }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)
    chain.execute(input, output, executor)
    // Pass 1: input → rtA
    const rtA = executor.mock.calls[0][1]
    // Pass 2: rtA → rtB
    const rtB = executor.mock.calls[1][1]
    // Pass 3: rtB → rtA(复用)
    expect(executor.mock.calls[2][0]).toBe(rtB)
    expect(executor.mock.calls[2][1]).toBe(rtA)
    // Pass 4: rtA → output
    expect(executor.mock.calls[3][0]).toBe(rtA)
    expect(executor.mock.calls[3][1]).toBe(output)
  })

  it('EX06: disabled pass 被跳过', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2', enabled: false }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)
    const result = chain.execute(input, output, executor)
    expect(executor).toHaveBeenCalledTimes(2) // p2 被跳过
    expect(result.executedPassCount).toBe(2)
    expect(result.passTimings).toHaveLength(3)
    // p2 应标记为 skipped
    const p2Timing = result.passTimings.find((t) => t.passId === 'p2')
    expect(p2Timing!.skipped).toBe(true)
  })

  it('EX07: 所有 pass disabled → 短路', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1', enabled: false }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor = vi.fn(() => 0)
    const result = chain.execute(input, output, executor)
    expect(executor).not.toHaveBeenCalled()
    expect(result.executedPassCount).toBe(0)
    expect(result.shortCircuited).toBe(true)
  })

  it('EX08: passTimings 记录每个 pass 的耗时', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    const input = makeRT('input')
    const output = makeRT('output')
    const executor: PostProcessPassExecutor = (_i, _o, pass) => {
      return pass.id === 'p1' ? 1.5 : 2.5
    }
    const result = chain.execute(input, output, executor)
    expect(result.passTimings).toHaveLength(2)
    expect(result.passTimings[0]).toEqual({ passId: 'p1', passName: 'p1', ms: 1.5, skipped: false })
    expect(result.passTimings[1]).toEqual({ passId: 'p2', passName: 'p2', ms: 2.5, skipped: false })
  })

  it('EX09: executor 接收 pass 的 params', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', { radius: 7, strength: 0.9 }, { id: 'p1' }))
    const input = makeRT('input')
    const output = makeRT('output')
    let receivedParams: Record<string, unknown> | undefined
    const executor: PostProcessPassExecutor = (_i, _o, pass) => {
      receivedParams = pass.params
      return 1.0
    }
    chain.execute(input, output, executor)
    expect(receivedParams).toEqual({ radius: 7, strength: 0.9 })
  })
})

// ============================================================================
// 5. PostProcessChain — 中间 RT 复用
// ============================================================================

describe('PostProcessChain / intermediate RT reuse', () => {
  it('RT01: 多次 execute 复用同一对 ping-pong RT(同尺寸)', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    const input = createRenderTarget('input', { width: 100, height: 100 })
    const output = createRenderTarget('output', { width: 100, height: 100 })
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)

    // 第一次 execute
    chain.execute(input, output, executor)
    const firstRT = executor.mock.calls[0][1] // 第一次的中间 RT

    // 第二次 execute(同尺寸,应复用)
    chain.execute(input, output, executor)
    const secondRT = executor.mock.calls[3][1] // 第二次的中间 RT
    expect(secondRT.id).toBe(firstRT.id)
  })

  it('RT02: 尺寸变化时重建 ping-pong', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)

    // 第一次 100x100
    const input1 = createRenderTarget('input', { width: 100, height: 100 })
    const output1 = createRenderTarget('output', { width: 100, height: 100 })
    chain.execute(input1, output1, executor)
    const firstRT = executor.mock.calls[0][1]
    expect(firstRT.descriptor.width).toBe(100)

    // 第二次 200x200(应重建)
    const input2 = createRenderTarget('input', { width: 200, height: 200 })
    const output2 = createRenderTarget('output', { width: 200, height: 200 })
    chain.execute(input2, output2, executor)
    const secondRT = executor.mock.calls[3][1]
    expect(secondRT.descriptor.width).toBe(200)
    expect(secondRT.id).not.toBe(firstRT.id)
  })

  it('RT03: dispose 销毁中间 RT', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    const input = createRenderTarget('input', { width: 100, height: 100 })
    const output = createRenderTarget('output', { width: 100, height: 100 })
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)
    chain.execute(input, output, executor)

    const statsBefore = chain.getStats()
    expect(statsBefore.intermediateRTCount).toBe(2)

    chain.dispose()
    const statsAfter = chain.getStats()
    expect(statsAfter.intermediateRTCount).toBe(0)
    expect(statsAfter.intermediateRTBytes).toBe(0)
  })
})

// ============================================================================
// 6. PostProcessChain — 统计
// ============================================================================

describe('PostProcessChain / stats', () => {
  it('ST01: 初始统计全部为 0', () => {
    const chain = new PostProcessChain()
    const stats = chain.getStats()
    expect(stats.totalPasses).toBe(0)
    expect(stats.enabledPasses).toBe(0)
    expect(stats.intermediateRTCount).toBe(0)
    expect(stats.totalExecutions).toBe(0)
    expect(stats.totalPassExecutions).toBe(0)
    expect(stats.totalShortCircuits).toBe(0)
  })

  it('ST02: totalExecutions 累加', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    const input = createRenderTarget('in', { width: 100, height: 100 })
    const output = createRenderTarget('out', { width: 100, height: 100 })
    const executor = vi.fn<PostProcessPassExecutor>(() => 1.0)
    chain.execute(input, output, executor)
    chain.execute(input, output, executor)
    expect(chain.getStats().totalExecutions).toBe(2)
    expect(chain.getStats().totalPassExecutions).toBe(2)
  })

  it('ST03: shortCircuit 累加(空 chain)', () => {
    const chain = new PostProcessChain()
    const input = createRenderTarget('in', { width: 100, height: 100 })
    const output = createRenderTarget('out', { width: 100, height: 100 })
    chain.execute(input, output, vi.fn(() => 0))
    expect(chain.getStats().totalShortCircuits).toBe(1)
  })

  it('ST04: shortCircuit 累加(单 pass)', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    const input = createRenderTarget('in', { width: 100, height: 100 })
    const output = createRenderTarget('out', { width: 100, height: 100 })
    chain.execute(input, output, vi.fn(() => 1.0))
    expect(chain.getStats().totalShortCircuits).toBe(1)
  })

  it('ST05: 多 pass 不计入 shortCircuit', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    const input = createRenderTarget('in', { width: 100, height: 100 })
    const output = createRenderTarget('out', { width: 100, height: 100 })
    chain.execute(input, output, vi.fn(() => 1.0))
    expect(chain.getStats().totalShortCircuits).toBe(0)
    expect(chain.getStats().totalPassExecutions).toBe(2)
  })

  it('ST06: intermediateRTBytes 按 4 bytes/pixel 计算', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))
    const input = createRenderTarget('in', { width: 100, height: 100 })
    const output = createRenderTarget('out', { width: 100, height: 100 })
    chain.execute(input, output, vi.fn(() => 1.0))
    // 2 个中间 RT,每个 100*100*4 = 40000 bytes
    expect(chain.getStats().intermediateRTBytes).toBe(2 * 100 * 100 * 4)
  })
})

// ============================================================================
// 7. MultiPassPipeline — 编排
// ============================================================================

describe('MultiPassPipeline / orchestration', () => {
  it('PP01: 完整执行 scene → chain → present', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', {}, { id: 'p1' }))
    chain.addPass(makePass('bloom', 'bloom_v1', {}, { id: 'p2' }))

    const pipeline = new MultiPassPipeline()
    pipeline.setPostProcessChain(chain)

    const sceneExecutor = vi.fn(() => 5.0)
    const passExecutor = vi.fn(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    const result = pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor,
      passExecutor,
      presentExecutor,
    })

    expect(sceneExecutor).toHaveBeenCalledTimes(1)
    expect(passExecutor).toHaveBeenCalledTimes(2) // 2 个 pass
    expect(presentExecutor).toHaveBeenCalledTimes(1)
    expect(result.sceneMs).toBe(5.0)
    expect(result.postProcessResult!.executedPassCount).toBe(2)
    expect(result.presentMs).toBe(0.5)
    expect(result.totalMs).toBe(5.0 + 2.0 + 0.5)
    expect(result.postProcessSkipped).toBe(false)
    expect(result.phases).toHaveLength(3)
    expect(result.phases[0].phase).toBe('scene')
    expect(result.phases[1].phase).toBe('post-process')
    expect(result.phases[2].phase).toBe('present')
  })

  it('PP02: 无 chain 时跳过后处理(scene → present 直连)', () => {
    const pipeline = new MultiPassPipeline()
    // 不设置 chain

    const sceneExecutor = vi.fn(() => 3.0)
    const presentExecutor = vi.fn(() => 0.5)

    const result = pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor,
      presentExecutor,
    })

    expect(result.postProcessSkipped).toBe(true)
    expect(result.postProcessResult).toBeNull()
    expect(result.totalMs).toBe(3.0 + 0.5)
    expect(result.phases).toHaveLength(3)
    expect(result.phases[1].skipped).toBe(true)
  })

  it('PP03: enablePostProcess=false 跳过后处理', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', {}, { id: 'p1' }))
    const pipeline = new MultiPassPipeline()
    pipeline.setPostProcessChain(chain)
    pipeline.setEnablePostProcess(false)

    const sceneExecutor = vi.fn(() => 3.0)
    const passExecutor = vi.fn(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    const result = pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor,
      passExecutor,
      presentExecutor,
    })

    expect(passExecutor).not.toHaveBeenCalled()
    expect(result.postProcessSkipped).toBe(true)
  })

  it('PP04: chain 无启用 pass 时跳过后处理', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('blur', 'blur_v1', {}, { id: 'p1', enabled: false }))
    const pipeline = new MultiPassPipeline()
    pipeline.setPostProcessChain(chain)

    const sceneExecutor = vi.fn(() => 3.0)
    const passExecutor = vi.fn(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    const result = pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor,
      passExecutor,
      presentExecutor,
    })

    expect(passExecutor).not.toHaveBeenCalled()
    expect(result.postProcessSkipped).toBe(true)
  })

  it('PP05: frameIndex 自动递增', () => {
    const pipeline = new MultiPassPipeline()
    const sceneExecutor = vi.fn(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    const r1 = pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })
    const r2 = pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })
    const r3 = pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })

    expect(r1.frameIndex).toBe(0)
    expect(r2.frameIndex).toBe(1)
    expect(r3.frameIndex).toBe(2)
  })

  it('PP06: frameIndex 可手动指定', () => {
    const pipeline = new MultiPassPipeline()
    const sceneExecutor = vi.fn(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    const result = pipeline.execute({
      frameIndex: 42,
      canvasSize: { width: 100, height: 100 },
      sceneExecutor,
      presentExecutor,
    })

    expect(result.frameIndex).toBe(42)
  })
})

// ============================================================================
// 8. MultiPassPipeline — RT 复用
// ============================================================================

describe('MultiPassPipeline / RT reuse', () => {
  it('RT01: 多帧 execute 复用同一 input/output RT(同尺寸)', () => {
    const pipeline = new MultiPassPipeline()
    const sceneExecutor = vi.fn<ScenePassExecutor>(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })
    const firstInputId = sceneExecutor.mock.calls[0][0].id

    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })
    const secondInputId = sceneExecutor.mock.calls[1][0].id

    expect(secondInputId).toBe(firstInputId)
  })

  it('RT02: 尺寸变化时重建 RT', () => {
    const pipeline = new MultiPassPipeline()
    const sceneExecutor = vi.fn<ScenePassExecutor>(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })
    const firstRT = sceneExecutor.mock.calls[0][0]
    const firstSize = firstRT.descriptor.width

    pipeline.execute({ canvasSize: { width: 200, height: 200 }, sceneExecutor, presentExecutor })
    const secondRT = sceneExecutor.mock.calls[1][0]
    const secondSize = secondRT.descriptor.width

    expect(firstSize).toBe(100)
    expect(secondSize).toBe(200)
    // 尺寸变化时 RT 对象重建(引用不同,但 id 固定为 'pipeline_input')
    expect(secondRT).not.toBe(firstRT)
  })

  it('RT03: dispose 销毁 RT', () => {
    const pipeline = new MultiPassPipeline()
    const sceneExecutor = vi.fn(() => 1.0)
    const presentExecutor = vi.fn(() => 0.5)

    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor, presentExecutor })
    pipeline.dispose()
    // 再次 execute 应该创建新 RT(不报错)
    const result = pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor,
      presentExecutor,
    })
    expect(result.totalMs).toBe(1.5)
  })
})

// ============================================================================
// 9. MultiPassPipeline — 统计
// ============================================================================

describe('MultiPassPipeline / stats', () => {
  it('ST01: 初始统计全部为 0', () => {
    const pipeline = new MultiPassPipeline()
    const stats = pipeline.getStats()
    expect(stats.totalFrames).toBe(0)
    expect(stats.totalPostProcessSkipped).toBe(0)
    expect(stats.totalSceneMs).toBe(0)
    expect(stats.totalPostProcessMs).toBe(0)
    expect(stats.totalPresentMs).toBe(0)
    expect(stats.totalMs).toBe(0)
    expect(stats.avgFrameMs).toBe(0)
    expect(stats.postProcessSkipRate).toBe(0)
  })

  it('ST02: 累计统计正确(含后处理)', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    const pipeline = new MultiPassPipeline()
    pipeline.setPostProcessChain(chain)

    pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor: () => 5.0,
      passExecutor: () => 1.0,
      presentExecutor: () => 0.5,
    })

    const stats = pipeline.getStats()
    expect(stats.totalFrames).toBe(1)
    expect(stats.totalPostProcessSkipped).toBe(0)
    expect(stats.totalSceneMs).toBe(5.0)
    expect(stats.totalPostProcessMs).toBe(2.0)
    expect(stats.totalPresentMs).toBe(0.5)
    expect(stats.totalMs).toBe(7.5)
    expect(stats.avgFrameMs).toBe(7.5)
    expect(stats.postProcessSkipRate).toBe(0)
  })

  it('ST03: 累计统计正确(跳过后处理)', () => {
    const pipeline = new MultiPassPipeline()
    // 不设 chain,跳过后处理

    pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor: () => 3.0,
      presentExecutor: () => 0.5,
    })

    const stats = pipeline.getStats()
    expect(stats.totalPostProcessSkipped).toBe(1)
    expect(stats.totalPostProcessMs).toBe(0)
    expect(stats.postProcessSkipRate).toBe(1)
  })

  it('ST04: 多帧 avgFrameMs 正确', () => {
    const pipeline = new MultiPassPipeline()
    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor: () => 4.0, presentExecutor: () => 1.0 })
    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor: () => 6.0, presentExecutor: () => 2.0 })
    pipeline.execute({ canvasSize: { width: 100, height: 100 }, sceneExecutor: () => 5.0, presentExecutor: () => 1.5 })

    const stats = pipeline.getStats()
    // 总耗时:(4+1)+(6+2)+(5+1.5) = 5+8+6.5 = 19.5
    expect(stats.totalMs).toBe(19.5)
    expect(stats.avgFrameMs).toBeCloseTo(6.5)
  })

  it('ST05: resetStats 清零但保留 chain', () => {
    const chain = new PostProcessChain()
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    const pipeline = new MultiPassPipeline()
    pipeline.setPostProcessChain(chain)

    pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor: () => 1.0,
      passExecutor: () => 1.0,
      presentExecutor: () => 0.5,
    })
    expect(pipeline.getStats().totalFrames).toBe(1)

    pipeline.resetStats()
    expect(pipeline.getStats().totalFrames).toBe(0)
    expect(pipeline.getPostProcessChain()).toBe(chain) // chain 保留
  })
})

// ============================================================================
// 10. GPU 注入
// ============================================================================

describe('MultiPassPipeline / GPU injection', () => {
  it('G01: createGpuTexture 在 RT 创建时被调用', () => {
    const createFn = vi.fn(() => createMockTexture())
    const pipeline = new MultiPassPipeline({ createGpuTexture: createFn })

    pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor: () => 1.0,
      presentExecutor: () => 0.5,
    })

    // input RT 创建 + output RT 创建 = 至少 2 次调用
    expect(createFn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('G02: destroyGpuTexture 在 dispose 时被调用', () => {
    const createFn = vi.fn(() => createMockTexture())
    const destroyFn = vi.fn()
    const pipeline = new MultiPassPipeline({
      createGpuTexture: createFn,
      destroyGpuTexture: destroyFn,
    })

    pipeline.execute({
      canvasSize: { width: 100, height: 100 },
      sceneExecutor: () => 1.0,
      presentExecutor: () => 0.5,
    })
    pipeline.dispose()

    expect(destroyFn.mock.calls.length).toBeGreaterThanOrEqual(2) // input + output
  })

  it('G03: PostProcessChain 的中间 RT 也使用注入的 createGpuTexture', () => {
    const createFn = vi.fn(() => createMockTexture())
    const chain = new PostProcessChain({ createGpuTexture: createFn })
    chain.addPass(makePass('p1', 's1', {}, { id: 'p1' }))
    chain.addPass(makePass('p2', 's2', {}, { id: 'p2' }))
    chain.addPass(makePass('p3', 's3', {}, { id: 'p3' }))

    const input = createRenderTarget('in', { width: 100, height: 100 })
    const output = createRenderTarget('out', { width: 100, height: 100 })
    chain.execute(input, output, vi.fn(() => 1.0))

    // 2 个中间 RT
    expect(createFn.mock.calls.length).toBe(2)
  })
})
