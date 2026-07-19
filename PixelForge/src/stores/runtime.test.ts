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
    time: 0,
  })),
}))

vi.mock('@/compiler/region/evaluator', () => ({
  createRegionEvaluator: vi.fn(() => ({
    render: vi.fn(),
  })),
}))

vi.mock('@/runtime/encoder', () => ({
  renderFrame: vi.fn(),
  createRenderVerificationSnapshot: vi.fn(({ artifact, compileContext }) => ({
    descriptorData: Array.from(artifact.descriptorData),
    auxData: Array.from(artifact.auxData),
    regionData: Array.from(artifact.regionData ?? []),
    effectDescData: Array.from(artifact.effectDescData ?? []),
    effectParamData: Array.from(artifact.effectParamData ?? []),
    canvasWidth: compileContext.canvasSize.width,
    canvasHeight: compileContext.canvasSize.height,
    seed: compileContext.seed,
    time: compileContext.time,
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
import { renderFrame } from '@/runtime/encoder'

describe('运行时状态回放', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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
        time: 0,
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
    expect(renderFrame).toHaveBeenCalled()
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
    expect(renderFrame).not.toHaveBeenCalled()
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

    const renderArgs = vi.mocked(renderFrame).mock.calls[0]
    expect(renderArgs).toBeTruthy()
    expect(renderArgs?.[1]).toBe(record.artifact)
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
    expect(store.replayErrorInfo).toEqual({
      code: 'replay/runtime-unavailable',
      message: '运行时不可用，无法执行回放',
    })
    expect(createRegionEvaluator).not.toHaveBeenCalled()
    expect(renderFrame).not.toHaveBeenCalled()
  })

  it('帧记录不存在时回放应返回结构化错误', () => {
    const repository = new InMemoryFrameRepository([])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.replayFrame(999)

    expect(store.replayStatus).toBe('error')
    expect(store.replayError).toBe('未找到指定帧记录')
    expect(store.replayErrorInfo).toEqual({
      code: 'replay/missing-data',
      message: '未找到指定帧记录',
    })
    expect(createRegionEvaluator).not.toHaveBeenCalled()
    expect(renderFrame).not.toHaveBeenCalled()
  })
})
