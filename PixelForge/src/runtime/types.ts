import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { JsonLiteral } from '@/shared/types'
import type { RenderIR } from '@/compiler/ir/renderIR'

export interface RuntimeCanvasSize {
  width: number
  height: number
}

export interface RuntimeInitOptions {
  canvas: HTMLCanvasElement
  size?: Partial<RuntimeCanvasSize>
}

export interface RuntimeGpuAdapterInfo {
  features: Iterable<string>
  limits: GPUSupportedLimits
  requestDevice: GPUAdapter['requestDevice']
}

export interface RuntimeDeviceQueueHandle {
  submit: GPUQueue['submit']
  writeBuffer: GPUQueue['writeBuffer']
}

export interface RuntimeDeviceHandle {
  queue: RuntimeDeviceQueueHandle
  createTexture: GPUDevice['createTexture']
  createBuffer: GPUDevice['createBuffer']
  createShaderModule: GPUDevice['createShaderModule']
  createComputePipeline: GPUDevice['createComputePipeline']
  createRenderPipeline: GPUDevice['createRenderPipeline']
  createBindGroup: GPUDevice['createBindGroup']
  createSampler: GPUDevice['createSampler']
  createCommandEncoder: GPUDevice['createCommandEncoder']
}

export interface RuntimeGpuContext {
  adapter: RuntimeGpuAdapterInfo
  device: RuntimeDeviceHandle
  context: GPUCanvasContext
  canvasFormat: GPUTextureFormat
  canvasSize: RuntimeCanvasSize
}

export interface CapabilityProfile {
  webgpu: true
  storageTexture: true
  storageFormat: GPUTextureFormat
  maxTextureDimension2D: number
  maxStorageBufferBindingSize: number
  maxComputeWorkgroupSizeX: number
  maxComputeWorkgroupSizeY: number
  maxComputeInvocationsPerWorkgroup: number
}

export interface RuntimeTextureBundle {
  texture: GPUTexture
  view: GPUTextureView
  size: RuntimeCanvasSize
  format: GPUTextureFormat
}

export interface PresentPipelineResources {
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  sampler: GPUSampler
  uniformBuffer: GPUBuffer
}

export interface CompileContextSnapshot {
  canvasSize: RuntimeCanvasSize
  seed: number
  time: number
}

export type RuntimeErrorCode =
  | 'runtime/webgpu-unavailable'
  | 'runtime/adapter-unavailable'
  | 'runtime/context-unavailable'
  | 'runtime/device-request-failed'
  | 'runtime/output-texture-creation-failed'
  | 'runtime/present-pipeline-creation-failed'
  | 'runtime/unknown'

export type ReplayErrorCode =
  | 'replay/missing-data'
  | 'replay/incompatible-artifact-version'
  | 'replay/signature-mismatch'
  | 'replay/runtime-unavailable'

export interface RuntimeErrorInfo extends Error {
  code: RuntimeErrorCode
}

export interface ReplayErrorInfo {
  code: ReplayErrorCode
  message: string
}

export interface RuntimeFrameRecord {
  frame: number
  timestampMs: number
  durationMs: number
  status: 'idle' | 'initializing' | 'ready' | 'error'
  scenario: string
  layerId: string | null
  opcode: string | null
  patchId: string | null
  patchSummary: string | null
  canvasSize: RuntimeCanvasSize | null
  outputFormat: string | null
  error: string | null
  artifact?: RegionCompileArtifact
  renderIrSnapshot?: RenderIR
  compileContextSnapshot?: CompileContextSnapshot
  artifactSchemaVersion?: string
  payload?: {
    compileHints?: Record<string, JsonLiteral>
    capabilitySummary?: Record<string, string>
    [key: string]: unknown
  }
}

export interface RuntimeInitResult {
  gpu: RuntimeGpuContext
  capability: CapabilityProfile
  output: RuntimeTextureBundle
  present: PresentPipelineResources
}
