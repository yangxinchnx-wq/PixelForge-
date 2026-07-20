import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/runtime/device', () => ({
  initRuntime: vi.fn(),
}))

vi.mock('@/compiler/context', () => ({
  createCompileContext: vi.fn(() => ({
    capability: {
      webgpu: true,
      storageTexture: true,
      storageFormat: 'rgba8unorm',
      maxTextureDimension2D: 4096,
      maxStorageBufferBindingSize: 1024,
      maxComputeWorkgroupSizeX: 8,
      maxComputeWorkgroupSizeY: 8,
      maxComputeInvocationsPerWorkgroup: 64,
    },
    canvasSize: { width: 1024, height: 768 },
    seed: 1337,
  })),
}))

vi.mock('@/compiler/region/evaluator', () => ({
  createRegionEvaluator: vi.fn(() => ({
    render: vi.fn(),
  })),
}))

vi.mock('@/runtime/encoder', () => ({
  renderFrame: vi.fn(),
  renderPresentPass: vi.fn(),
  createRenderVerificationSnapshot: vi.fn(({ artifact, compileContext }) => ({
    descriptorData: Array.from(artifact.descriptorData),
    auxData: Array.from(artifact.auxData),
    regionData: Array.from(artifact.regionData ?? []),
    effectDescData: Array.from(artifact.effectDescData ?? []),
    effectParamData: Array.from(artifact.effectParamData ?? []),
    canvasWidth: compileContext.canvasSize.width,
    canvasHeight: compileContext.canvasSize.height,
    seed: compileContext.seed,
    visibleLayerCount: artifact.visibleLayerCount ?? 1,
    hasEffects: artifact.hasEffects ?? false,
  })),
}))

vi.mock('@/compiler/region/regionCompiler', () => ({
  compileRenderIRToRegionArtifact: vi.fn(() => ({
    schemaVersion: 'region-artifact-v2',
    descriptorData: new Uint32Array([1, 0]),
    auxData: new Float32Array([0, 1]),
    regionData: new Float32Array([0, 0, 1, 1]),
    effectDescData: new Uint32Array([0]),
    effectParamData: new Float32Array([0, 0, 0, 0]),
    layerId: 'layer_gradient',
    opcode: 'LINEAR_GRADIENT',
    layers: [],
    regions: [],
    effects: [],
    visibleLayerCount: 1,
    hasEffects: false,
  })),
}))

import { createRuntimeStore, 工件结构版本 } from './runtime'
import type { RuntimeFrameRecord } from '@/runtime/types'
import { createRegionEvaluator } from '@/compiler/region/evaluator'
import { InMemoryFrameRepository } from '@/services/frame/repository'
import { renderPresentPass } from '@/runtime/encoder'
import { clearCache } from '@/compiler/cache/compileCache'
import { destroyWorkerPool } from '@/workers/workerPool'

describe('运行时状态回放', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clearCache()
    destroyWorkerPool()
  })

  function buildRecord(frame: number): RuntimeFrameRecord {
    return {
      frame,
      timestampMs: 1000 + frame,
      durationMs: 2,
      status: 'ready',
      scenario: 'gradient',
      layerId: 'layer_gradient',
      opcode: 'LINEAR_GRADIENT',
      patchId: `patch-${frame}`,
      patchSummary: `补丁-${frame}`,
      canvasSize: { width: 1024, height: 768 },
      outputFormat: 'rgba8unorm',
      error: null,
      artifactSchemaVersion: 工件结构版本,
      compileContextSnapshot: {
        canvasSize: { width: 1024, height: 768 },
        seed: 1337,
      },
      renderIrSnapshot: {
        canvas: { width: 1024, height: 768 },
        layers: [],
        regions: [],
        effects: [],
        compileHints: { preferredProfile: 'region' },
      },
      artifact: {
        schemaVersion: 'region-artifact-v2',
        descriptorData: new Uint32Array([1, 0]),
        auxData: new Float32Array([0, 1]),
        regionData: new Float32Array([0, 0, 1, 1]),
        effectDescData: new Uint32Array([0]),
        effectParamData: new Float32Array([0, 0, 0, 0]),
        layerId: 'layer_gradient',
        opcode: 'LINEAR_GRADIENT',
        layers: [],
        regions: [],
        effects: [],
        visibleLayerCount: 1,
        hasEffects: false,
      },
      payload: {},
    }
  }

  function buildRuntime() {
    return {
      gpu: {
        adapter: { features: [], limits: {} as GPUSupportedLimits, requestDevice: vi.fn() },
        device: {} as any,
        context: {} as GPUCanvasContext,
        canvasFormat: 'bgra8unorm',
        canvasSize: { width: 1024, height: 768 },
      },
      capability: {
        webgpu: true,
        storageTexture: true,
        storageFormat: 'rgba8unorm',
        maxTextureDimension2D: 4096,
        maxStorageBufferBindingSize: 1024,
        maxComputeWorkgroupSizeX: 8,
        maxComputeWorkgroupSizeY: 8,
        maxComputeInvocationsPerWorkgroup: 64,
      },
      output: {
        texture: {} as GPUTexture,
        view: {} as GPUTextureView,
        size: { width: 1024, height: 768 },
        format: 'rgba8unorm',
      },
      present: {
        pipeline: {} as GPURenderPipeline,
        bindGroup: {} as GPUBindGroup,
        sampler: {} as GPUSampler,
        uniformBuffer: {} as GPUBuffer,
      },
    } as any
  }

  it('回放指定帧时应更新展示态并触发渲染', () => {
    const repository = new InMemoryFrameRepository([buildRecord(128)])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.selectFrame(128)
    store.replayFrame(128)

    expect(createRegionEvaluator).toHaveBeenCalled()
    expect(renderPresentPass).toHaveBeenCalled()
    expect(store.presentedFrame).toBe(128)
    expect(store.selectedFrame).toBe(128)
    expect(store.currentLayerId).toBe('layer_gradient')
    expect(store.currentOpcode).toBe('LINEAR_GRADIENT')
    expect(store.lastPatchId).toBe('patch-128')
    expect(store.replayStatus).toBe('success')
    expect(store.replayError).toBeNull()
  })

  it('缺少回放字段时应写入回放错误信息', () => {
    const badRecord = { ...buildRecord(129), artifact: undefined }
    const repository = new InMemoryFrameRepository([badRecord])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.selectFrame(129)
    store.replayFrame(129)

    expect(store.error).toBe('当前帧缺少回放所需数据')
    expect(store.replayStatus).toBe('error')
    expect(store.replayError).toBe('当前帧缺少回放所需数据')
  })

  it('工件版本不兼容时应阻止回放', () => {
    const badVersionRecord = { ...buildRecord(130), artifactSchemaVersion: 'old-artifact-v0' }
    const repository = new InMemoryFrameRepository([badVersionRecord])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.selectFrame(130)
    store.replayFrame(130)

    expect(createRegionEvaluator).not.toHaveBeenCalled()
    expect(renderPresentPass).not.toHaveBeenCalled()
    expect(store.replayStatus).toBe('error')
    expect(store.replayError).toBe('工件版本不兼容: old-artifact-v0')
  })

  it('选中历史帧后检查面板应读取该帧记录', () => {
    const repository = new InMemoryFrameRepository([buildRecord(131)])
    const useStore = createRuntimeStore(repository)
    const store = useStore()

    store.selectFrame(131)

    expect(store.selectedFrameRecord?.frame).toBe(131)
    expect(store.selectedFrameRecord?.patchSummary).toBe('补丁-131')
  })

  it('回放时应把目标工件传入渲染链路', () => {
    const record = buildRecord(132)
    const repository = new InMemoryFrameRepository([record])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.selectFrame(132)
    store.replayFrame(132)

    // 验证 evaluator.render 被调用并传入了工件
    const evaluatorResult = vi.mocked(createRegionEvaluator).mock.results[0]
    expect(evaluatorResult).toBeTruthy()
    // @ts-ignore - 访问 mock 对象的 render 方法
    expect(evaluatorResult?.value?.render).toHaveBeenCalledWith(record.artifact)
    expect(renderPresentPass).toHaveBeenCalled()
  })

  it('运行时为空时回放应返回结构化错误', () => {
    const record = buildRecord(140)
    const repository = new InMemoryFrameRepository([record])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    // runtime 保持为 null，不设置

    store.selectFrame(140)
    store.replayFrame(140)

    expect(store.replayStatus).toBe('error')
    expect(store.replayError).toBe('运行时不可用，无法执行回放')
    expect(store.replayErrorInfo).toMatchObject({
      code: 'replay/runtime-unavailable',
      message: '运行时不可用，无法执行回放',
    })
    expect(createRegionEvaluator).not.toHaveBeenCalled()
    expect(renderPresentPass).not.toHaveBeenCalled()
  })

  it('帧记录不存在时回放应返回结构化错误', () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.replayFrame(999)

    expect(store.replayStatus).toBe('error')
    expect(store.replayError).toBe('未找到指定帧记录')
    expect(store.replayErrorInfo).toMatchObject({
      code: 'replay/missing-data',
      message: '未找到指定帧记录',
    })
    expect(createRegionEvaluator).not.toHaveBeenCalled()
    expect(renderPresentPass).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 性能指标集成测试（阶段五 5.4）
// ============================================================================

describe('性能指标采集', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clearCache()
    destroyWorkerPool()
  })

  function buildRecord(frame: number): RuntimeFrameRecord {
    return {
      frame,
      timestampMs: 1000 + frame,
      durationMs: 2,
      status: 'ready',
      scenario: 'gradient',
      layerId: 'layer_gradient',
      opcode: 'LINEAR_GRADIENT',
      patchId: `patch-${frame}`,
      patchSummary: `补丁-${frame}`,
      canvasSize: { width: 1024, height: 768 },
      outputFormat: 'rgba8unorm',
      error: null,
      artifactSchemaVersion: 工件结构版本,
      compileContextSnapshot: {
        canvasSize: { width: 1024, height: 768 },
        seed: 1337,
      },
      renderIrSnapshot: {
        canvas: { width: 1024, height: 768 },
        layers: [],
        regions: [],
        effects: [],
        compileHints: { preferredProfile: 'region' },
      },
      artifact: {
        schemaVersion: 'region-artifact-v2',
        descriptorData: new Uint32Array([1, 0]),
        auxData: new Float32Array([0, 1]),
        regionData: new Float32Array([0, 0, 1, 1]),
        effectDescData: new Uint32Array([0]),
        effectParamData: new Float32Array([0, 0, 0, 0]),
        layerId: 'layer_gradient',
        opcode: 'LINEAR_GRADIENT',
        layers: [],
        regions: [],
        effects: [],
        visibleLayerCount: 1,
        hasEffects: false,
      },
      payload: {},
    }
  }

  function buildRuntime() {
    return {
      gpu: {
        adapter: { features: [], limits: {} as GPUSupportedLimits, requestDevice: vi.fn() },
        device: {} as any,
        context: {} as GPUCanvasContext,
        canvasFormat: 'bgra8unorm',
        canvasSize: { width: 1024, height: 768 },
      },
      capability: {
        webgpu: true,
        storageTexture: true,
        storageFormat: 'rgba8unorm',
        maxTextureDimension2D: 4096,
        maxStorageBufferBindingSize: 1024,
        maxComputeWorkgroupSizeX: 8,
        maxComputeWorkgroupSizeY: 8,
        maxComputeInvocationsPerWorkgroup: 64,
      },
      output: {
        texture: {} as GPUTexture,
        view: {} as GPUTextureView,
        size: { width: 1024, height: 768 },
        format: 'rgba8unorm',
      },
      present: {
        pipeline: {} as GPURenderPipeline,
        bindGroup: {} as GPUBindGroup,
        sampler: {} as GPUSampler,
        uniformBuffer: {} as GPUBuffer,
      },
    } as any
  }

  it('回放后应采集性能指标', () => {
    const repository = new InMemoryFrameRepository([buildRecord(200)])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.replayFrame(200)

    const metrics = store.performanceMetrics
    expect(metrics).toBeTruthy()
    expect(metrics.totalFrameMs).toBeGreaterThanOrEqual(0)
    expect(metrics.gpu.dispatchMs).toBeGreaterThanOrEqual(0)
    expect(metrics.gpu.presentMs).toBeGreaterThanOrEqual(0)
    expect(metrics.gpu.totalMs).toBeCloseTo(metrics.gpu.dispatchMs + metrics.gpu.presentMs, 5)
    // 内存指标：descriptorData 2 个 Uint32 = 8 bytes, auxData 2 个 Float32 = 8 bytes,
    // regionData 4 个 Float32 = 16 bytes, uniform 16 bytes, effectDesc 4 bytes, effectParam 16 bytes
    // texture 1024*768*4 = 3145728 bytes
    expect(metrics.memory.descriptorBufferBytes).toBe(8)
    expect(metrics.memory.textureMemoryBytes).toBe(3145728)
    expect(metrics.memory.totalMemoryBytes).toBe(8 + 8 + 16 + 16 + 4 + 16 + 3145728)
  })

  it('回放后帧记录应包含性能指标', () => {
    const repository = new InMemoryFrameRepository([buildRecord(201)])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.replayFrame(201)

    // 帧记录应在 replayFrame 时生成新的性能数据
    const metrics = store.performanceMetrics
    expect(metrics).toBeTruthy()
    expect(metrics.memory.textureMemoryBytes).toBe(1024 * 768 * 4)
  })

  it('运行时不可用时性能指标应保持初始值', () => {
    const repository = new InMemoryFrameRepository([buildRecord(202)])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    // runtime 保持为 null

    store.replayFrame(202)

    // 回放失败后性能指标应保持为初始零值
    expect(store.performanceMetrics.totalFrameMs).toBe(0)
    expect(store.performanceMetrics.memory.totalMemoryBytes).toBe(0)
  })

  it('渲染后应更新性能指标', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    const metrics = store.performanceMetrics
    expect(metrics).toBeTruthy()
    expect(metrics.totalFrameMs).toBeGreaterThanOrEqual(0)
    // 编译上下文、IR 构建、区域编译都应有耗时
    expect(metrics.cpu.compileContextMs).toBeGreaterThanOrEqual(0)
    expect(metrics.cpu.irBuildMs).toBeGreaterThanOrEqual(0)
    expect(metrics.cpu.compileMs).toBeGreaterThanOrEqual(0)
    // GPU 耗时应被采集
    expect(metrics.gpu.dispatchMs).toBeGreaterThanOrEqual(0)
    expect(metrics.gpu.presentMs).toBeGreaterThanOrEqual(0)
  })

  it('渲染后帧记录应包含性能指标', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    const latestFrame = store.latestFrame
    expect(latestFrame).toBeTruthy()
    expect(latestFrame?.performanceMetrics).toBeTruthy()
    expect(latestFrame?.performanceMetrics?.memory.textureMemoryBytes).toBe(1024 * 768 * 4)
    expect(latestFrame?.performanceMetrics?.memory.descriptorBufferBytes).toBe(8)
  })
})

// ============================================================================
// Phase C 集成测试（Worker Pool + Compile Cache + Partial Upload + Preview）
// ============================================================================

describe('Phase C: Worker Pool + Compile Cache + Partial Upload', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    clearCache()
    destroyWorkerPool()
  })

  function buildRuntime() {
    return {
      gpu: {
        adapter: { features: [], limits: {} as GPUSupportedLimits, requestDevice: vi.fn() },
        device: {} as any,
        context: {} as GPUCanvasContext,
        canvasFormat: 'bgra8unorm',
        canvasSize: { width: 1024, height: 768 },
      },
      capability: {
        webgpu: true,
        storageTexture: true,
        storageFormat: 'rgba8unorm',
        maxTextureDimension2D: 4096,
        maxStorageBufferBindingSize: 1024,
        maxComputeWorkgroupSizeX: 8,
        maxComputeWorkgroupSizeY: 8,
        maxComputeInvocationsPerWorkgroup: 64,
      },
      output: {
        texture: {} as GPUTexture,
        view: {} as GPUTextureView,
        size: { width: 1024, height: 768 },
        format: 'rgba8unorm',
      },
      present: {
        pipeline: {} as GPURenderPipeline,
        bindGroup: {} as GPUBindGroup,
        sampler: {} as GPUSampler,
        uniformBuffer: {} as GPUBuffer,
      },
    } as any
  }

  // ------------------------------------------------------------------
  // Compile Cache 集成
  // ------------------------------------------------------------------

  it('首次渲染应缓存未命中并触发编译', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    expect(store.lastCompileCacheHit).toBe(false)
    expect(store.compileCacheStats.artifactCacheSize).toBe(1)
  })

  it('相同 IR 第二次渲染应缓存命中并跳过编译', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    // 第一次渲染：缓存未命中
    await store.renderCurrentIR()
    expect(store.lastCompileCacheHit).toBe(false)

    // 第二次渲染：缓存命中
    await store.renderCurrentIR()
    expect(store.lastCompileCacheHit).toBe(true)
  })

  it('缓存命中时 compileCacheStats 应反映缓存条目数', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()
    await store.renderCurrentIR()

    // 同一 IR 只产生 1 个缓存条目
    expect(store.compileCacheStats.artifactCacheSize).toBe(1)
  })

  // ------------------------------------------------------------------
  // Worker Pool 降级
  // ------------------------------------------------------------------

  it('测试环境中 Worker Pool 应不可用并降级为主线程编译', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    // Node.js 环境中 Worker 不可用
    expect(store.workerPoolStats.isAvailable).toBe(false)
    expect(store.workerPoolStats.workerCount).toBe(0)
    // 渲染仍然成功（降级为主线程编译）
    expect(store.performanceMetrics).toBeTruthy()
    expect(store.performanceMetrics.totalFrameMs).toBeGreaterThanOrEqual(0)
  })

  it('帧记录应包含 workerPoolAvailable 信息', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    const latestFrame = store.latestFrame
    expect(latestFrame?.payload?.workerPoolAvailable).toBe(false)
    expect(latestFrame?.payload?.compileCacheHit).toBe(false)
  })

  // ------------------------------------------------------------------
  // Partial Upload diff
  // ------------------------------------------------------------------

  it('首次渲染 uploadDiffSummary 应为全量上传', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    expect(store.uploadDiffSummary).toContain('full upload')
    expect(store.lastUploadDiff).toBeTruthy()
    expect(store.lastUploadDiff?.fullUploadRequired).toBe(true)
  })

  it('相同 artifact 第二次渲染 uploadDiffSummary 应为无变化', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()
    await store.renderCurrentIR()

    // mock 返回相同的 artifact（相同 TypedArray 内容），diff 应为 no changes
    expect(store.uploadDiffSummary).toBe('no changes')
    expect(store.lastUploadDiff?.fullUploadRequired).toBe(false)
  })

  it('帧记录应包含 uploadDiffSummary 信息', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()

    const latestFrame = store.latestFrame
    expect(latestFrame?.payload?.uploadDiffSummary).toContain('full upload')
  })

  // ------------------------------------------------------------------
  // 渐进式渲染
  // ------------------------------------------------------------------

  it('renderProgressive 应按级别从低到高执行并最终达到全分辨率', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderProgressive()

    expect(store.isProgressiveRendering).toBe(false)
    expect(store.currentPreviewLevel).toBe(3) // DEFAULT_PREVIEW_END_LEVEL
  })

  it('renderProgressive skipIntermediate 应只处理起始和终止级别', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderProgressive({ skipIntermediate: true })

    expect(store.isProgressiveRendering).toBe(false)
    expect(store.currentPreviewLevel).toBe(3)
  })

  it('progressiveRenderPlan 应返回 4 个级别', () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    const plan = store.progressiveRenderPlan
    expect(plan).toHaveLength(4)
    expect(plan[0].level).toBe(0) // 1/8
    expect(plan[3].level).toBe(3) // 1/1
    // 每个级别应有 dispatch 和 pixelCount
    expect(plan[0].dispatch).toBeTruthy()
    expect(plan[0].pixelCount).toBeGreaterThan(0)
  })

  // ------------------------------------------------------------------
  // 竞态控制
  // ------------------------------------------------------------------

  it('快速连续渲染只有最后一次应生效', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    // 发起多次渲染（不 await）
    const p1 = store.renderCurrentIR()
    const p2 = store.renderCurrentIR()
    const p3 = store.renderCurrentIR()

    // 等待全部完成
    await Promise.all([p1, p2, p3])

    // isCompiling 应为 false
    expect(store.isCompiling).toBe(false)
  })

  // ------------------------------------------------------------------
  // destroyWorkerResources
  // ------------------------------------------------------------------

  it('destroyWorkerResources 应清理状态', async () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    await store.renderCurrentIR()
    expect(store.lastUploadDiff).toBeTruthy()

    store.destroyWorkerResources()

    expect(store.lastUploadDiff).toBeNull()
    expect(store.isCompiling).toBe(false)
    expect(store.isProgressiveRendering).toBe(false)
  })
})
