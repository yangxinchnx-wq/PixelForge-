/**
 * PixelForge - 性能指标采集模块
 *
 * 阶段五 5.4 新增：GPU profiler 实现与性能指标采集制度化。
 *
 * 本模块提供：
 * - CPU 侧耗时采集（编译上下文 / IR 构建 / 区域编译 / 补丁应用）
 * - GPU 侧耗时采集（缓冲区写入 / 计算调度 / 效果后处理 / 呈现 Pass）
 * - 内存指标采集（描述符 / 辅助参数 / 区域 / Uniform / 效果缓冲区 + 纹理）
 * - 帧总耗时汇总
 *
 * 设计原则：
 * - 非侵入式：profiler 是可选的，不启用时零开销
 * - 可组合：通过 startCpu/endCpu 模式测量任意命名区段
 * - 可测试：纯逻辑，不依赖真实 GPU 环境
 * - 帧级隔离：每次渲染创建新的 profiler 实例
 */

import type { RuntimeCanvasSize } from './types'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'

// ============================================================================
// 指标类型定义
// ============================================================================

/**
 * CPU 侧耗时指标。
 *
 * 所有时间以毫秒为单位，使用 performance.now() 测量。
 */
export interface CpuTimingMetrics {
  /** 编译上下文创建时间 (ms) */
  compileContextMs: number
  /** RenderIR 构建/克隆时间 (ms) */
  irBuildMs: number
  /** 区域编译时间 (ms) — descriptor encode + aux/region/effect 数据拼接 */
  compileMs: number
  /** 补丁应用时间 (ms) — 仅在 applyDemoPatch 路径中有值 */
  patchMs: number
}

/**
 * GPU 侧耗时指标。
 *
 * 测量的是 CPU 侧编码 + 提交命令的墙钟时间。
 * 由于 WebGPU 命令提交是异步执行的，这些时间是「提交耗时」的上界估计，
 * 而非 GPU 硬件执行时间。要获取精确 GPU 时间需要 timestamp-query 扩展。
 */
export interface GpuTimingMetrics {
  /** 缓冲区写入时间 (ms) — writeBuffer 调用（描述符/辅助/区域/Uniform） */
  bufferWriteMs: number
  /** 计算 Pass 编码与提交时间 (ms) — 区域求值 dispatch */
  dispatchMs: number
  /** 效果 Pass 编码与提交时间 (ms) — 效果后处理 dispatch */
  effectMs: number
  /** 呈现 Pass 编码与提交时间 (ms) — renderPresentPass */
  presentMs: number
  /** GPU 总耗时 (ms) — bufferWrite + dispatch + effect + present */
  totalMs: number
}

/**
 * 内存指标。
 *
 * 记录当前帧使用的 GPU 内存大小（按实际数据量，非缓冲区分配大小）。
 */
export interface MemoryMetrics {
  /** 描述符缓冲区实际数据大小 (bytes) */
  descriptorBufferBytes: number
  /** 辅助参数缓冲区实际数据大小 (bytes) */
  auxBufferBytes: number
  /** 区域边界缓冲区实际数据大小 (bytes) */
  regionBufferBytes: number
  /** Uniform 缓冲区大小 (bytes) — 固定 16 字节 */
  uniformBufferBytes: number
  /** 效果描述符缓冲区实际数据大小 (bytes) */
  effectDescBufferBytes: number
  /** 效果参数缓冲区实际数据大小 (bytes) */
  effectParamBufferBytes: number
  /** 输出纹理内存大小 (bytes) — width * height * 4 (RGBA8) */
  textureMemoryBytes: number
  /** 缓冲区总内存 (bytes) — 上述所有缓冲区之和 */
  totalBufferBytes: number
  /** GPU 总内存 (bytes) — 缓冲区 + 纹理 */
  totalMemoryBytes: number
}

/**
 * 单帧完整性能指标。
 */
export interface PerformanceMetrics {
  /** CPU 侧耗时 */
  cpu: CpuTimingMetrics
  /** GPU 侧耗时 */
  gpu: GpuTimingMetrics
  /** 内存指标 */
  memory: MemoryMetrics
  /** 帧总耗时 (ms) — 从渲染开始到结束的墙钟时间 */
  totalFrameMs: number
}

// ============================================================================
// 零值常量（用于初始化和测试）
// ============================================================================

const ZERO_CPU: CpuTimingMetrics = {
  compileContextMs: 0,
  irBuildMs: 0,
  compileMs: 0,
  patchMs: 0,
}

const ZERO_GPU: GpuTimingMetrics = {
  bufferWriteMs: 0,
  dispatchMs: 0,
  effectMs: 0,
  presentMs: 0,
  totalMs: 0,
}

const ZERO_MEMORY: MemoryMetrics = {
  descriptorBufferBytes: 0,
  auxBufferBytes: 0,
  regionBufferBytes: 0,
  uniformBufferBytes: 0,
  effectDescBufferBytes: 0,
  effectParamBufferBytes: 0,
  textureMemoryBytes: 0,
  totalBufferBytes: 0,
  totalMemoryBytes: 0,
}

/**
 * 零值性能指标。用于无渲染或错误场景。
 */
export const ZERO_METRICS: PerformanceMetrics = {
  cpu: { ...ZERO_CPU },
  gpu: { ...ZERO_GPU },
  memory: { ...ZERO_MEMORY },
  totalFrameMs: 0,
}

// ============================================================================
// Profiler 工厂
// ============================================================================

/**
 * 创建一个帧级性能采集器。
 *
 * 使用方式：
 * ```ts
 * const profiler = createProfiler()
 * profiler.startCpu('compile')
 * // ... 执行编译 ...
 * profiler.endCpu('compile')
 * profiler.addGpuTiming('dispatchMs', 0.5)
 * profiler.setMemory(calculateMemoryMetrics(artifact, canvasSize))
 * const metrics = profiler.finalize()
 * ```
 *
 * @returns Profiler 实例
 */
export function createProfiler() {
  const cpuTimings: CpuTimingMetrics = { ...ZERO_CPU }
  const cpuStarts: Partial<Record<keyof CpuTimingMetrics, number>> = {}
  const gpuTimings: GpuTimingMetrics = { ...ZERO_GPU }
  let memoryMetrics: MemoryMetrics = { ...ZERO_MEMORY }
  const frameStart = now()

  return {
    /**
     * 开始测量 CPU 侧某个区段。
     * @param label - 要测量的指标名（对应 CpuTimingMetrics 的 key）
     */
    startCpu(label: keyof CpuTimingMetrics) {
      cpuStarts[label] = now()
    },

    /**
     * 结束测量 CPU 侧某个区段，累加到对应指标。
     * 如果 startCpu 未调用过，则不做任何操作。
     * @param label - 要结束的指标名
     */
    endCpu(label: keyof CpuTimingMetrics) {
      const start = cpuStarts[label]
      if (start === undefined) return
      cpuTimings[label] += now() - start
      delete cpuStarts[label]
    },

    /**
     * 直接设置 CPU 侧某个耗时指标（累加）。
     * 用于在外部已测量好耗时的场景下直接注入。
     * @param key - CpuTimingMetrics 的 key
     * @param ms - 耗时（毫秒）
     */
    addCpuTiming(key: keyof CpuTimingMetrics, ms: number) {
      cpuTimings[key] += ms
    },

    /**
     * 直接设置 GPU 侧某个耗时指标（累加）。
     * @param key - GpuTimingMetrics 的 key
     * @param ms - 耗时（毫秒）
     */
    addGpuTiming(key: Exclude<keyof GpuTimingMetrics, 'totalMs'>, ms: number) {
      gpuTimings[key] += ms
    },

    /**
     * 设置内存指标（覆盖）。
     * @param metrics - 内存指标
     */
    setMemory(metrics: MemoryMetrics) {
      memoryMetrics = metrics
    },

    /**
     * 最终化并返回性能指标。
     * 计算 GPU 总耗时和帧总耗时。
     */
    finalize(): PerformanceMetrics {
      const totalGpu =
        gpuTimings.bufferWriteMs +
        gpuTimings.dispatchMs +
        gpuTimings.effectMs +
        gpuTimings.presentMs

      return {
        cpu: { ...cpuTimings },
        gpu: {
          ...gpuTimings,
          totalMs: totalGpu,
        },
        memory: { ...memoryMetrics },
        totalFrameMs: now() - frameStart,
      }
    },
  }
}

/**
 * Profiler 实例类型（用于类型标注）。
 */
export type Profiler = ReturnType<typeof createProfiler>

// ============================================================================
// 内存指标计算
// ============================================================================

/**
 * 根据工件数据和画布尺寸计算内存指标。
 *
 * @param artifact - 区域编译工件
 * @param canvasSize - 画布尺寸
 * @returns 内存指标
 */
export function calculateMemoryMetrics(
  artifact: RegionCompileArtifact,
  canvasSize: RuntimeCanvasSize,
): MemoryMetrics {
  const descriptorBufferBytes = artifact.descriptorData.byteLength
  const auxBufferBytes = artifact.auxData.byteLength
  const regionBufferBytes = artifact.regionData.byteLength
  const uniformBufferBytes = 16 // 固定：resolution(vec2f) + seed(u32) + layerCount(u32)
  const effectDescBufferBytes = artifact.effectDescData.byteLength
  const effectParamBufferBytes = artifact.effectParamData.byteLength

  // RGBA8 = 4 bytes per pixel
  const textureMemoryBytes = canvasSize.width * canvasSize.height * 4

  const totalBufferBytes =
    descriptorBufferBytes +
    auxBufferBytes +
    regionBufferBytes +
    uniformBufferBytes +
    effectDescBufferBytes +
    effectParamBufferBytes

  const totalMemoryBytes = totalBufferBytes + textureMemoryBytes

  return {
    descriptorBufferBytes,
    auxBufferBytes,
    regionBufferBytes,
    uniformBufferBytes,
    effectDescBufferBytes,
    effectParamBufferBytes,
    textureMemoryBytes,
    totalBufferBytes,
    totalMemoryBytes,
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取当前高精度时间戳。
 *
 * 在浏览器环境中使用 performance.now()，
 * 在不支持 performance 的环境中降级为 Date.now()。
 */
function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * 格式化字节数为人类可读字符串。
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串（如 "1.2 KB"）
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * 格式化毫秒数为人类可读字符串。
 *
 * @param ms - 毫秒数
 * @returns 格式化后的字符串（如 "1.23 ms" 或 "45.6 μs"）
 */
export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} μs`
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  return `${(ms / 1000).toFixed(3)} s`
}
