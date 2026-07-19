import { detectCapability } from './capability'
import { clearOutputTexture, renderPresentPass } from './encoder'
import { createOutputTexture } from './output'
import { createPresentPipeline } from './pipeline'
import type {
  RuntimeCanvasSize,
  RuntimeDeviceHandle,
  RuntimeErrorInfo,
  RuntimeGpuAdapterInfo,
  RuntimeGpuContext,
  RuntimeInitOptions,
  RuntimeInitResult,
  RuntimeTextureBundle,
  PresentPipelineResources,
} from './types'

const DEFAULT_CANVAS_SIZE: RuntimeCanvasSize = {
  width: 1024,
  height: 768,
}

export async function initRuntime(options: RuntimeInitOptions): Promise<RuntimeInitResult> {
  if (!navigator.gpu) {
    throw createRuntimeError('runtime/webgpu-unavailable', '当前环境不支持 WebGPU')
  }

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    throw createRuntimeError('runtime/adapter-unavailable', '无法获取 WebGPU 适配器')
  }

  const capability = await detectCapability(adapter)

  let nativeDevice: GPUDevice
  try {
    nativeDevice = await adapter.requestDevice()
  } catch {
    throw createRuntimeError('runtime/device-request-failed', '无法创建 WebGPU 设备')
  }

  const context = options.canvas.getContext('webgpu') as GPUCanvasContext | null
  if (!context) {
    throw createRuntimeError('runtime/context-unavailable', '无法创建 WebGPU 画布上下文')
  }

  const canvasSize = resolveCanvasSize(options)
  syncCanvasSize(options.canvas, canvasSize)

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
  context.configure({
    device: nativeDevice,
    format: canvasFormat,
    alphaMode: 'premultiplied',
  })

  const runtimeAdapter: RuntimeGpuAdapterInfo = {
    features: adapter.features,
    limits: adapter.limits,
    requestDevice: adapter.requestDevice.bind(adapter),
  }

  const runtimeDevice: RuntimeDeviceHandle = {
    queue: {
      submit: nativeDevice.queue.submit.bind(nativeDevice.queue),
      writeBuffer: nativeDevice.queue.writeBuffer.bind(nativeDevice.queue),
    },
    createTexture: nativeDevice.createTexture.bind(nativeDevice),
    createBuffer: nativeDevice.createBuffer.bind(nativeDevice),
    createShaderModule: nativeDevice.createShaderModule.bind(nativeDevice),
    createComputePipeline: nativeDevice.createComputePipeline.bind(nativeDevice),
    createRenderPipeline: nativeDevice.createRenderPipeline.bind(nativeDevice),
    createBindGroup: nativeDevice.createBindGroup.bind(nativeDevice),
    createSampler: nativeDevice.createSampler.bind(nativeDevice),
    createCommandEncoder: nativeDevice.createCommandEncoder.bind(nativeDevice),
  }

  const gpu: RuntimeGpuContext = {
    adapter: runtimeAdapter,
    device: runtimeDevice,
    context,
    canvasFormat,
    canvasSize,
  }

  let output: RuntimeTextureBundle
  try {
    output = createOutputTexture(runtimeDevice, canvasSize, capability.storageFormat)
  } catch {
    throw createRuntimeError('runtime/output-texture-creation-failed', '无法创建输出纹理')
  }

  let present: PresentPipelineResources
  try {
    present = createPresentPipeline(gpu, output)
  } catch {
    throw createRuntimeError('runtime/present-pipeline-creation-failed', '无法创建呈现管线')
  }

  clearOutputTexture(runtimeDevice, output.texture)
  renderPresentPass(runtimeDevice, context, present)

  return {
    gpu,
    capability,
    output,
    present,
  }
}

function resolveCanvasSize(options: RuntimeInitOptions): RuntimeCanvasSize {
  return {
    width: resolveDimension(options.size?.width ?? options.canvas.clientWidth ?? DEFAULT_CANVAS_SIZE.width),
    height: resolveDimension(options.size?.height ?? options.canvas.clientHeight ?? DEFAULT_CANVAS_SIZE.height),
  }
}

function resolveDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.max(1, Math.round(value))
}

function syncCanvasSize(canvas: HTMLCanvasElement, size: RuntimeCanvasSize): void {
  canvas.width = size.width
  canvas.height = size.height
}

function createRuntimeError(code: RuntimeErrorInfo['code'], message: string): RuntimeErrorInfo {
  const error = new Error(message) as RuntimeErrorInfo
  error.code = code
  return error
}
