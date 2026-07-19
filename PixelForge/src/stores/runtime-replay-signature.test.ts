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
import { InMemoryFrameRepository } from '@/services/frame/repository'

describe('回放渲染签名一致性', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
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
      payload: {
        renderVerificationSnapshot: {
          descriptorData: [1, 0],
          auxData: [0, 1],
          regionData: [0, 0, 1, 1],
          effectDescData: [0],
          effectParamData: [0, 0, 0, 0],
          canvasWidth: 1024,
          canvasHeight: 768,
          seed: 1337,
          time: 0,
          visibleLayerCount: 1,
          hasEffects: false,
          valid: true,
          message: '历史帧回放签名一致',
        },
      },
    }
  }

  it('回放时应保持渲染签名一致', () => {
    const record = buildRecord(150)
    const repository = new InMemoryFrameRepository([record])
    const useStore = createRuntimeStore(repository)
    const store = useStore()
    ;(store as any).runtime = buildRuntime()

    store.selectFrame(150)
    store.replayFrame(150)

    const replayedRecord = store.selectedFrameRecord
    expect(replayedRecord?.payload?.renderVerificationSnapshot).toEqual({
      descriptorData: [1, 0],
      auxData: [0, 1],
      regionData: [0, 0, 1, 1],
      effectDescData: [0],
      effectParamData: [0, 0, 0, 0],
      canvasWidth: 1024,
      canvasHeight: 768,
      seed: 1337,
      time: 0,
      visibleLayerCount: 1,
      hasEffects: false,
      valid: true,
      message: '历史帧回放签名一致',
    })
  })
})
