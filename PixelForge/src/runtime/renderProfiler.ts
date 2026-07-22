/**
 * PixelForge - 渲染性能 Profiler(Step 39.1)
 *
 * 职责:
 * - 统一三套性能指标(PerformanceMetrics / SchedulerMetrics / GpuResourceMetrics)为单一帧采样
 * - 滚动窗口统计(平均/P50/P95/P99/最大/最小)
 * - 性能等级判定(good/ok/warn/bad,基于帧时间预算)
 * - 帧采样环形缓冲区(避免无限增长)
 *
 * 设计原则:
 * - 纯函数 + 纯数据结构,不依赖 Pinia/Vue/WebGPU 运行时(便于测试)
 * - UI 层(Vue 组件)从 profilerStore 订阅数据,本模块只管采集和统计
 * - 60FPS 预算 16.67ms,30FPS 预算 33.33ms
 */
import type { PerformanceMetrics } from '@/runtime/profiler'

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 性能等级 */
export type PerformanceLevel = 'good' | 'ok' | 'warn' | 'bad'

/** 单帧采样(三套指标的统一快照) */
export interface FrameSample {
  /** 帧序号(从 0 开始) */
  frameIndex: number
  /** 时间戳(performance.now(),毫秒) */
  timestamp: number
  /** 总帧时间(墙钟,毫秒) */
  frameMs: number
  /** FPS(由 frameMs 计算) */
  fps: number
  /** CPU 渲染时间(compile + patch,毫秒) */
  cpuMs: number
  /** GPU 渲染时间(dispatch + present,毫秒) */
  gpuMs: number
  /** GPU 总时间(含 bufferWrite + dispatch + effect + present) */
  gpuTotalMs: number
  /** 总内存(字节) */
  memoryBytes: number
  /** 缓冲区内存(字节) */
  bufferBytes: number
  /** 纹理内存(字节) */
  textureBytes: number
  /** 活跃 GPU 资源数(若可用) */
  gpuResourceCount: number | null
  /** 是否超预算(60FPS) */
  overBudget: boolean
  /** 性能等级 */
  level: PerformanceLevel
}

/** 滚动窗口统计 */
export interface FrameStats {
  /** 窗口内帧数 */
  count: number
  /** 平均帧时间 */
  avgFrameMs: number
  /** P50 帧时间(中位数) */
  p50FrameMs: number
  /** P95 帧时间 */
  p95FrameMs: number
  /** P99 帧时间 */
  p99FrameMs: number
  /** 最小帧时间 */
  minFrameMs: number
  /** 最大帧时间 */
  maxFrameMs: number
  /** 平均 FPS */
  avgFps: number
  /** 平均 GPU 时间 */
  avgGpuMs: number
  /** 平均 CPU 时间 */
  avgCpuMs: number
  /** 平均内存(MB) */
  avgMemoryMb: number
  /** 超预算帧数 */
  overBudgetCount: number
  /** 超预算帧占比(0-1) */
  overBudgetRatio: number
  /** 整体性能等级(按 P95 判定) */
  overallLevel: PerformanceLevel
}

// ============================================================================
// 2. 常量
// ============================================================================

/** 60FPS 帧预算(毫秒) */
export const BUDGET_60FPS_MS = 16.67

/** 30FPS 帧预算(毫秒) */
export const BUDGET_30FPS_MS = 33.33

/** 默认环形缓冲区大小(最多保留多少帧采样) */
export const DEFAULT_BUFFER_SIZE = 240 // 约 4 秒 @60FPS

/** 性能等级阈值(基于帧时间) */
export const LEVEL_THRESHOLDS = {
  good: 16.67,  // ≤ 16.67ms = 60FPS+ = good
  ok: 25,       // ≤ 25ms ≈ 40FPS = ok
  warn: 33.33,  // ≤ 33.33ms = 30FPS = warn
  // > 33.33ms = bad
} as const

// ============================================================================
// 3. 性能等级判定
// ============================================================================

/**
 * 根据帧时间判定性能等级。
 *
 * @param frameMs 帧时间(毫秒)
 * @returns 性能等级
 */
export function judgeLevel(frameMs: number): PerformanceLevel {
  if (frameMs <= LEVEL_THRESHOLDS.good) return 'good'
  if (frameMs <= LEVEL_THRESHOLDS.ok) return 'ok'
  if (frameMs <= LEVEL_THRESHOLDS.warn) return 'warn'
  return 'bad'
}

/** 性能等级中文标签 */
export const LEVEL_LABELS: Record<PerformanceLevel, string> = {
  good: '优秀',
  ok: '良好',
  warn: '警告',
  bad: '糟糕',
}

/** 性能等级颜色(用于 UI) */
export const LEVEL_COLORS: Record<PerformanceLevel, string> = {
  good: '#4ade80',  // green
  ok: '#facc15',    // yellow
  warn: '#fb923c',  // orange
  bad: '#ef4444',   // red
}

// ============================================================================
// 4. 帧采样构造
// ============================================================================

/**
 * 从 PerformanceMetrics 构造一帧采样。
 *
 * @param metrics 渲染管线指标
 * @param frameIndex 帧序号
 * @param timestamp 时间戳(默认 performance.now())
 * @param gpuResourceCount GPU 资源数(可选,来自 GpuResourceManager)
 * @returns 帧采样
 */
export function createFrameSample(
  metrics: PerformanceMetrics,
  frameIndex: number,
  timestamp: number = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  gpuResourceCount: number | null = null,
): FrameSample {
  const frameMs = metrics.totalFrameMs
  const cpuMs = metrics.cpu.compileMs + metrics.cpu.irBuildMs + metrics.cpu.patchMs
  const gpuMs = metrics.gpu.dispatchMs + metrics.gpu.presentMs
  const gpuTotalMs = metrics.gpu.totalMs
  const fps = frameMs > 0 ? 1000 / frameMs : 0
  const overBudget = frameMs > BUDGET_60FPS_MS

  return {
    frameIndex,
    timestamp,
    frameMs,
    fps,
    cpuMs,
    gpuMs,
    gpuTotalMs,
    memoryBytes: metrics.memory.totalMemoryBytes,
    bufferBytes: metrics.memory.totalBufferBytes,
    textureBytes: metrics.memory.textureMemoryBytes,
    gpuResourceCount,
    overBudget,
    level: judgeLevel(frameMs),
  }
}

// ============================================================================
// 5. 环形缓冲区(FrameSampleRingBuffer)
// ============================================================================

/**
 * 帧采样环形缓冲区。
 *
 * 固定容量,新帧覆盖最旧帧。提供全量快照和窗口统计。
 */
export class FrameSampleRingBuffer {
  private buffer: FrameSample[] = []
  private capacity: number
  private nextFrameIndex: number = 0

  constructor(capacity: number = DEFAULT_BUFFER_SIZE) {
    this.capacity = Math.max(1, capacity)
  }

  /** 推入一帧采样(基于 PerformanceMetrics) */
  push(metrics: PerformanceMetrics, gpuResourceCount: number | null = null): FrameSample {
    const sample = createFrameSample(metrics, this.nextFrameIndex++, undefined, gpuResourceCount)
    if (this.buffer.length < this.capacity) {
      this.buffer.push(sample)
    } else {
      this.buffer.shift()
      this.buffer.push(sample)
    }
    return sample
  }

  /** 直接推入已构造的帧采样(用于测试) */
  pushSample(sample: FrameSample): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(sample)
    } else {
      this.buffer.shift()
      this.buffer.push(sample)
    }
  }

  /** 获取所有帧采样(副本) */
  getAll(): FrameSample[] {
    return [...this.buffer]
  }

  /** 获取最近 N 帧采样 */
  getRecent(n: number): FrameSample[] {
    return this.buffer.slice(-n)
  }

  /** 获取最新一帧 */
  getLatest(): FrameSample | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null
  }

  /** 当前帧数 */
  size(): number {
    return this.buffer.length
  }

  /** 清空 */
  clear(): void {
    this.buffer = []
    this.nextFrameIndex = 0
  }

  /** 获取容量 */
  getCapacity(): number {
    return this.capacity
  }
}

// ============================================================================
// 6. 统计计算(纯函数)
// ============================================================================

/**
 * 计算数组的百分位数。
 *
 * @param sorted 排序后的数组(升序)
 * @param p 百分位(0-100)
 * @returns 百分位值
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  // 线性插值
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

/**
 * 计算帧采样的统计信息。
 *
 * @param samples 帧采样列表(无需排序)
 * @returns 统计信息(空列表返回零值统计)
 */
export function computeStats(samples: FrameSample[]): FrameStats {
  if (samples.length === 0) {
    return {
      count: 0,
      avgFrameMs: 0,
      p50FrameMs: 0,
      p95FrameMs: 0,
      p99FrameMs: 0,
      minFrameMs: 0,
      maxFrameMs: 0,
      avgFps: 0,
      avgGpuMs: 0,
      avgCpuMs: 0,
      avgMemoryMb: 0,
      overBudgetCount: 0,
      overBudgetRatio: 0,
      overallLevel: 'bad',
    }
  }

  const frameMsArr = samples.map((s) => s.frameMs).sort((a, b) => a - b)
  const gpuMsArr = samples.map((s) => s.gpuTotalMs)
  const cpuMsArr = samples.map((s) => s.cpuMs)
  const fpsArr = samples.map((s) => s.fps)
  const memArr = samples.map((s) => s.memoryBytes)
  const overBudgetCount = samples.filter((s) => s.overBudget).length

  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0)

  const p95 = percentile(frameMsArr, 95)
  return {
    count: samples.length,
    avgFrameMs: sum(frameMsArr) / frameMsArr.length,
    p50FrameMs: percentile(frameMsArr, 50),
    p95FrameMs: p95,
    p99FrameMs: percentile(frameMsArr, 99),
    minFrameMs: frameMsArr[0],
    maxFrameMs: frameMsArr[frameMsArr.length - 1],
    avgFps: sum(fpsArr) / fpsArr.length,
    avgGpuMs: sum(gpuMsArr) / gpuMsArr.length,
    avgCpuMs: sum(cpuMsArr) / cpuMsArr.length,
    avgMemoryMb: sum(memArr) / memArr.length / (1024 * 1024),
    overBudgetCount,
    overBudgetRatio: overBudgetCount / samples.length,
    overallLevel: judgeLevel(p95),
  }
}

// ============================================================================
// 7. 格式化辅助
// ============================================================================

/** 格式化毫秒(保留 1 位小数) */
export function formatMs(ms: number): string {
  return `${ms.toFixed(1)} ms`
}

/** 格式化字节为 MB */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化 FPS(整数) */
export function formatFps(fps: number): string {
  return `${Math.round(fps)} FPS`
}
