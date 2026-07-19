import { describe, expect, it, vi, beforeEach } from 'vitest'

const requestAdapter = vi.fn()
const getPreferredCanvasFormat = vi.fn(() => 'bgra8unorm')

vi.mock('./capability', () => ({
  detectCapability: vi.fn(async () => ({
    webgpu: true,
    storageTexture: true,
    storageFormat: 'rgba8unorm',
    maxTextureDimension2D: 4096,
    maxStorageBufferBindingSize: 1024,
    maxComputeWorkgroupSizeX: 8,
    maxComputeWorkgroupSizeY: 8,
    maxComputeInvocationsPerWorkgroup: 64,
  })),
}))

vi.mock('./encoder', () => ({
  clearOutputTexture: vi.fn(),
  renderPresentPass: vi.fn(),
}))

vi.mock('./output', () => ({
  createOutputTexture: vi.fn(() => ({
    texture: {} as GPUTexture,
    view: {} as GPUTextureView,
    size: { width: 1024, height: 768 },
    format: 'rgba8unorm',
  })),
}))

vi.mock('./pipeline', () => ({
  createPresentPipeline: vi.fn(() => ({
    pipeline: {} as GPURenderPipeline,
    bindGroup: {} as GPUBindGroup,
    sampler: {} as GPUSampler,
    uniformBuffer: {} as GPUBuffer,
  })),
}))

import { initRuntime } from './device'
import { createOutputTexture } from './output'
import { createPresentPipeline } from './pipeline'

describe('运行时初始化', () => {
  const originalNavigator = globalThis.navigator

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function setupValidNavigator() {
    const requestDevice = vi.fn(async () => ({
      queue: {
        submit: vi.fn(),
        writeBuffer: vi.fn(),
      },
      createTexture: vi.fn(),
      createBuffer: vi.fn(),
      createShaderModule: vi.fn(),
      createComputePipeline: vi.fn(),
      createRenderPipeline: vi.fn(),
      createBindGroup: vi.fn(),
      createSampler: vi.fn(),
      createCommandEncoder: vi.fn(),
    }))

    requestAdapter.mockResolvedValueOnce({
      requestDevice,
      features: [],
      limits: {},
    })

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat,
        },
      },
      configurable: true,
    })

    return { requestDevice }
  }

  function createValidCanvas() {
    const configure = vi.fn()
    return {
      clientWidth: 1024,
      clientHeight: 768,
      getContext: vi.fn(() => ({ configure })),
    } as unknown as HTMLCanvasElement
  }

  it('当前环境不支持 WebGPU 时应返回结构化错误', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    })

    await expect(initRuntime({ canvas: {} as HTMLCanvasElement })).rejects.toMatchObject({
      code: 'runtime/webgpu-unavailable',
      message: '当前环境不支持 WebGPU',
    })
  })

  it('无法获取适配器时应返回结构化错误', async () => {
    requestAdapter.mockResolvedValueOnce(null)
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat,
        },
      },
      configurable: true,
    })

    await expect(initRuntime({ canvas: {} as HTMLCanvasElement })).rejects.toMatchObject({
      code: 'runtime/adapter-unavailable',
      message: '无法获取 WebGPU 适配器',
    })
  })

  it('无法创建画布上下文时应返回结构化错误', async () => {
    const requestDevice = vi.fn(async () => ({
      queue: {
        submit: vi.fn(),
        writeBuffer: vi.fn(),
      },
      createTexture: vi.fn(),
      createBuffer: vi.fn(),
      createShaderModule: vi.fn(),
      createComputePipeline: vi.fn(),
      createRenderPipeline: vi.fn(),
      createBindGroup: vi.fn(),
      createSampler: vi.fn(),
      createCommandEncoder: vi.fn(),
    }))

    requestAdapter.mockResolvedValueOnce({
      requestDevice,
      features: [],
      limits: {},
    })

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat,
        },
      },
      configurable: true,
    })

    const canvas = {
      clientWidth: 1024,
      clientHeight: 768,
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement

    await expect(initRuntime({ canvas })).rejects.toMatchObject({
      code: 'runtime/context-unavailable',
      message: '无法创建 WebGPU 画布上下文',
    })
  })

  it('无法创建设备时应返回结构化错误', async () => {
    const requestDevice = vi.fn(async () => {
      throw new Error('device failed')
    })

    requestAdapter.mockResolvedValueOnce({
      requestDevice,
      features: [],
      limits: {},
    })

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat,
        },
      },
      configurable: true,
    })

    const canvas = {
      clientWidth: 1024,
      clientHeight: 768,
      getContext: vi.fn(() => ({ configure: vi.fn() })),
    } as unknown as HTMLCanvasElement

    await expect(initRuntime({ canvas })).rejects.toMatchObject({
      code: 'runtime/device-request-failed',
      message: '无法创建 WebGPU 设备',
    })
  })

  it('画布宽高异常时应回退到最小合法尺寸', async () => {
    const requestDevice = vi.fn(async () => ({
      queue: {
        submit: vi.fn(),
        writeBuffer: vi.fn(),
      },
      createTexture: vi.fn(),
      createBuffer: vi.fn(),
      createShaderModule: vi.fn(),
      createComputePipeline: vi.fn(),
      createRenderPipeline: vi.fn(),
      createBindGroup: vi.fn(),
      createSampler: vi.fn(),
      createCommandEncoder: vi.fn(),
    }))

    requestAdapter.mockResolvedValueOnce({
      requestDevice,
      features: [],
      limits: {},
    })

    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: {
          requestAdapter,
          getPreferredCanvasFormat,
        },
      },
      configurable: true,
    })

    const configure = vi.fn()
    const canvas = {
      clientWidth: 0,
      clientHeight: -10,
      getContext: vi.fn(() => ({ configure })),
    } as unknown as HTMLCanvasElement

    const runtime = await initRuntime({ canvas })
    expect(runtime.gpu.canvasSize.width).toBe(1)
    expect(runtime.gpu.canvasSize.height).toBe(1)
  })

  it('输出纹理创建失败时应返回结构化错误', async () => {
    setupValidNavigator()
    vi.mocked(createOutputTexture).mockImplementationOnce(() => {
      throw new Error('GPU texture creation failed')
    })

    await expect(initRuntime({ canvas: createValidCanvas() })).rejects.toMatchObject({
      code: 'runtime/output-texture-creation-failed',
      message: '无法创建输出纹理',
    })
  })

  it('呈现管线创建失败时应返回结构化错误', async () => {
    setupValidNavigator()
    vi.mocked(createPresentPipeline).mockImplementationOnce(() => {
      throw new Error('GPU pipeline creation failed')
    })

    await expect(initRuntime({ canvas: createValidCanvas() })).rejects.toMatchObject({
      code: 'runtime/present-pipeline-creation-failed',
      message: '无法创建呈现管线',
    })
  })

  it('显式传入 NaN 尺寸时应回退到最小合法尺寸', async () => {
    setupValidNavigator()

    const canvas = createValidCanvas()
    const runtime = await initRuntime({ canvas, size: { width: NaN, height: NaN } })
    expect(runtime.gpu.canvasSize.width).toBe(1)
    expect(runtime.gpu.canvasSize.height).toBe(1)
  })

  it('显式传入 Infinity 尺寸时应回退到最小合法尺寸', async () => {
    setupValidNavigator()

    const canvas = createValidCanvas()
    const runtime = await initRuntime({ canvas, size: { width: Infinity, height: -Infinity } })
    expect(runtime.gpu.canvasSize.width).toBe(1)
    expect(runtime.gpu.canvasSize.height).toBe(1)
  })

  it('画布 clientWidth 为 NaN 时应回退到最小合法尺寸', async () => {
    setupValidNavigator()

    const configure = vi.fn()
    const canvas = {
      clientWidth: NaN,
      clientHeight: NaN,
      getContext: vi.fn(() => ({ configure })),
    } as unknown as HTMLCanvasElement

    const runtime = await initRuntime({ canvas })
    expect(runtime.gpu.canvasSize.width).toBe(1)
    expect(runtime.gpu.canvasSize.height).toBe(1)
  })

  it('显式尺寸应优先于画布 clientWidth 使用', async () => {
    setupValidNavigator()

    const canvas = createValidCanvas()
    const runtime = await initRuntime({ canvas, size: { width: 512, height: 256 } })
    expect(runtime.gpu.canvasSize.width).toBe(512)
    expect(runtime.gpu.canvasSize.height).toBe(256)
  })

  it('正常尺寸应正确传入并保留', async () => {
    setupValidNavigator()

    const canvas = createValidCanvas()
    const runtime = await initRuntime({ canvas })
    expect(runtime.gpu.canvasSize.width).toBe(1024)
    expect(runtime.gpu.canvasSize.height).toBe(768)
  })

  it('恢复原始 navigator', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
    })

    expect(globalThis.navigator).toBe(originalNavigator)
  })
})
