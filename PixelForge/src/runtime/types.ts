import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { JsonLiteral } from '@/shared/types'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { PerformanceMetrics } from './profiler'

// 阶段五 5.4：性能指标类型重导出（统一从 profiler 模块引用）
export type {
  PerformanceMetrics,
  CpuTimingMetrics,
  GpuTimingMetrics,
  MemoryMetrics,
} from './profiler'

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
  /** 等待所有已提交的 GPU 命令完成（用于像素回读前的同步） */
  onSubmittedWorkDone: GPUQueue['onSubmittedWorkDone']
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
}

export type RuntimeErrorCode =
  // 初始化错误
  | 'runtime/webgpu-unavailable'
  | 'runtime/adapter-unavailable'
  | 'runtime/context-unavailable'
  | 'runtime/device-request-failed'
  | 'runtime/output-texture-creation-failed'
  | 'runtime/present-pipeline-creation-failed'
  // GPU 运行时错误
  | 'runtime/shader-compilation-failed'
  | 'runtime/pipeline-creation-failed'
  | 'runtime/buffer-creation-failed'
  | 'runtime/texture-creation-failed'
  | 'runtime/dispatch-failed'
  | 'runtime/gpu-device-lost'
  // 编译错误
  | 'runtime/compile-error'
  // 导出错误
  | 'runtime/export-failed'
  // 持久化错误
  | 'runtime/persistence-failed'
  // 未知
  | 'runtime/unknown'

export type ReplayErrorCode =
  | 'replay/missing-data'
  | 'replay/incompatible-artifact-version'
  | 'replay/signature-mismatch'
  | 'replay/runtime-unavailable'

/**
 * 错误严重等级。
 * - fatal: 运行时不可恢复，需重新初始化
 * - error: 当前操作失败，但运行时仍可用
 * - warning: 非致命问题，不影响主流程
 * - info: 信息性提示
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning' | 'info'

/**
 * 错误来源模块标识。
 */
export type ErrorSource =
  | 'device-init'
  | 'compile'
  | 'render'
  | 'replay'
  | 'export'
  | 'persistence'
  | 'patch'
  | 'unknown'

export interface RuntimeErrorInfo extends Error {
  code: RuntimeErrorCode
  /** 错误严重等级 */
  severity: ErrorSeverity
  /** 错误来源模块 */
  source: ErrorSource
  /** 是否可恢复（用户可重试） */
  recoverable: boolean
  /** 错误发生时间戳（performance.now()） */
  timestamp: number
}

export interface ReplayErrorInfo {
  code: ReplayErrorCode
  message: string
  /** 错误严重等级 */
  severity: ErrorSeverity
  /** 错误来源模块 */
  source: ErrorSource
  /** 是否可恢复 */
  recoverable: boolean
  /** 错误发生时间戳 */
  timestamp: number
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
  /** 像素级签名（阶段五新增）：采样像素的 hash，用于回放像素级一致性验证 */
  pixelSignature?: string
  /** 性能指标（阶段五 5.4 新增）：CPU/GPU/内存指标 */
  performanceMetrics?: PerformanceMetrics
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
