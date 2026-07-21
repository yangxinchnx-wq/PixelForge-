/**
 * 渲染管线(Step 32)— 逐帧渲染调度 + 进度跟踪 + 状态机。
 *
 * 职责:
 * - 根据 RenderConfig 生成帧时间序列
 * - 逐帧调度渲染回调(由调用方实现 WebGPU/Canvas 渲染)
 * - 跟踪进度(已完成帧 / 总帧数 / 百分比)
 * - 管理状态机:idle → rendering → (paused) → completed / cancelled / failed
 *
 * 与实际渲染解耦:
 * - RenderPipeline 不知道"如何渲染一帧"
 * - 调用方通过 frameRenderer 回调实现实际渲染
 * - 渲染回调返回帧数据(PNG blob / 像素数组),由 RenderExporter 处理
 *
 * 用法:
 *   const pipeline = new RenderPipeline(config, async (frameIndex, time) => {
 *     // 实际渲染一帧(WebGPU / Canvas)
 *     return { frameIndex, time, data: new Uint8Array(0) }
 *   })
 *   pipeline.onProgress = (job) => console.log(`${job.completedFrames}/${job.totalFrames}`)
 *   pipeline.onComplete = (job) => console.log('完成', job.outputFiles)
 *   await pipeline.start()
 */

import type { RenderConfig, RenderJob, RenderStatus } from './renderConfig'
import {
  computeTotalFrames,
  frameIndexToTime,
  validateRenderConfig,
} from './renderConfig'
import type { Time } from '../timeline/core/time'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * 帧渲染结果。
 */
export interface RenderedFrame {
  /** 帧索引(0-based) */
  frameIndex: number
  /** 帧时间(微秒) */
  time: Time
  /** 帧数据(PNG blob / 像素数组等,由 frameRenderer 产生) */
  data: Uint8Array
}

/**
 * 帧渲染器 — 由调用方实现,负责渲染单帧并返回帧数据。
 *
 * @param frameIndex 帧索引
 * @param time       帧时间(微秒)
 * @returns 渲染结果(含帧数据)
 */
export type FrameRenderer = (frameIndex: number, time: Time) => Promise<RenderedFrame>

/**
 * 帧导出器 — 由调用方实现,负责将帧数据写入文件/内存。
 *
 * @param frame 渲染结果
 * @returns 输出文件路径
 */
export type FrameExporter = (frame: RenderedFrame, config: RenderConfig) => Promise<string>

// ============================================================================
// 2. RenderPipeline 类
// ============================================================================

let renderJobCounter = 0

function genRenderJobId(): string {
  renderJobCounter++
  return `render_${Date.now().toString(36)}_${renderJobCounter}`
}

/**
 * RenderPipeline — 渲染管线核心。
 *
 * 状态流转:
 *   idle → rendering → completed
 *   rendering → paused → rendering
 *   rendering → cancelled
 *   rendering → failed
 */
export class RenderPipeline {
  readonly job: RenderJob
  private frameRenderer: FrameRenderer
  private frameExporter: FrameExporter | null
  private abortFlag = false
  private pauseFlag = false
  private pauseResolver: (() => void) | null = null

  /** 进度回调(每帧完成后触发) */
  onProgress: ((job: RenderJob) => void) | null = null
  /** 完成回调 */
  onComplete: ((job: RenderJob) => void) | null = null
  /** 失败回调 */
  onError: ((job: RenderJob, error: Error) => void) | null = null
  /** 取消回调 */
  onCancel: ((job: RenderJob) => void) | null = null

  constructor(
    sequenceId: string,
    config: RenderConfig,
    frameRenderer: FrameRenderer,
    frameExporter?: FrameExporter,
  ) {
    const validation = validateRenderConfig(config)
    if (!validation.valid) {
      throw new Error(`RenderPipeline: 配置无效 — ${validation.reason}`)
    }

    this.frameRenderer = frameRenderer
    this.frameExporter = frameExporter ?? null

    this.job = {
      id: genRenderJobId(),
      sequenceId,
      config,
      status: 'idle',
      totalFrames: computeTotalFrames(config),
      completedFrames: 0,
      currentFrame: 0,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      outputFiles: [],
    }
  }

  /** 渲染进度百分比(0-100) */
  get progress(): number {
    if (this.job.totalFrames === 0) return 0
    return Math.round((this.job.completedFrames / this.job.totalFrames) * 100)
  }

  /** 是否正在渲染 */
  get isRendering(): boolean {
    return this.job.status === 'rendering'
  }

  /** 是否已暂停 */
  get isPaused(): boolean {
    return this.job.status === 'paused'
  }

  /** 是否已完成 */
  get isCompleted(): boolean {
    return this.job.status === 'completed'
  }

  /** 是否已取消 */
  get isCancelled(): boolean {
    return this.job.status === 'cancelled'
  }

  /**
   * 启动渲染。
   *
   * @returns 渲染任务(完成后 status='completed')
   */
  async start(): Promise<RenderJob> {
    if (this.job.status === 'rendering') {
      throw new Error('RenderPipeline.start: 已在渲染中')
    }

    this.abortFlag = false
    this.pauseFlag = false
    this.setStatus('rendering')
    this.job.startedAt = Date.now()
    this.job.completedFrames = 0
    this.job.currentFrame = 0
    this.job.outputFiles = []

    try {
      for (let i = 0; i < this.job.totalFrames; i++) {
        // 检查取消
        if (this.abortFlag) {
          this.setStatus('cancelled')
          this.job.finishedAt = Date.now()
          this.onCancel?.(this.job)
          return this.job
        }

        // 检查暂停(pause() 已设置 status='paused')
        if (this.pauseFlag) {
          await new Promise<void>((resolve) => {
            this.pauseResolver = resolve
          })
          // 恢复后重新检查取消
          if (this.abortFlag) {
            this.setStatus('cancelled')
            this.job.finishedAt = Date.now()
            this.onCancel?.(this.job)
            return this.job
          }
          // resume() 已设置 status='rendering'
        }

        this.job.currentFrame = i
        const time = frameIndexToTime(this.job.config, i)

        // 渲染帧
        const rendered = await this.frameRenderer(i, time)

        // 导出帧
        if (this.frameExporter) {
          const outputPath = await this.frameExporter(rendered, this.job.config)
          this.job.outputFiles.push(outputPath)
        }

        this.job.completedFrames = i + 1
        this.onProgress?.(this.job)
      }

      // 全部帧完成
      this.setStatus('completed')
      this.job.finishedAt = Date.now()
      this.onComplete?.(this.job)
      return this.job
    } catch (err) {
      this.job.error = err instanceof Error ? err.message : String(err)
      this.setStatus('failed')
      this.job.finishedAt = Date.now()
      this.onError?.(this.job, err instanceof Error ? err : new Error(String(err)))
      return this.job
    }
  }

  /** 暂停渲染 */
  pause(): void {
    if (this.job.status !== 'rendering') return
    this.pauseFlag = true
    this.setStatus('paused') // 立即设置状态(不等循环检测)
  }

  /** 恢复渲染 */
  resume(): void {
    if (this.job.status !== 'paused') return
    this.pauseFlag = false
    this.setStatus('rendering')
    if (this.pauseResolver) {
      this.pauseResolver()
      this.pauseResolver = null
    }
  }

  /** 取消渲染 */
  cancel(): void {
    if (this.job.status === 'completed' || this.job.status === 'cancelled') return
    this.abortFlag = true
    this.setStatus('cancelled') // 立即设置状态
    // 如果在暂停中,先恢复以让循环检测到取消
    if (this.pauseFlag) {
      this.pauseFlag = false
      if (this.pauseResolver) {
        this.pauseResolver()
        this.pauseResolver = null
      }
    }
  }

  private setStatus(status: RenderStatus): void {
    this.job.status = status
  }
}

// ============================================================================
// 3. 辅助:模拟帧渲染器(用于测试)
// ============================================================================

/**
 * 创建一个模拟帧渲染器(生成空帧数据,用于测试)。
 *
 * @param frameSize 每帧数据大小(字节,默认 0)
 */
export function createMockFrameRenderer(frameSize = 0): FrameRenderer {
  return async (frameIndex: number, time: Time): Promise<RenderedFrame> => {
    return {
      frameIndex,
      time,
      data: new Uint8Array(frameSize),
    }
  }
}

/**
 * 创建一个模拟帧导出器(返回虚拟文件路径,用于测试)。
 */
export function createMockFrameExporter(): FrameExporter {
  return async (frame: RenderedFrame, config: RenderConfig): Promise<string> => {
    const ext = config.format === 'png-sequence' ? 'png' : config.format
    const frameStr = String(frame.frameIndex).padStart(6, '0')
    return `${config.outputName}_${frameStr}.${ext}`
  }
}
