/**
 * 渲染 Store(Step 32)— 管理渲染任务状态的 Pinia Store。
 *
 * 职责:
 * - 持有当前渲染任务状态(RenderJob)
 * - 提供 startRender / cancelRender / pauseRender / resumeRender actions
 * - 暴露进度 computed(百分比 / 已完成帧 / 总帧数)
 * - 渲染完成后保留结果(outputFiles)
 *
 * 与 RenderPipeline 的关系:
 * - Store 创建 RenderPipeline 实例并持有引用
 * - Pipeline 的 onProgress 回调更新 Store 状态
 * - Store 的 cancel/pause/resume 转发给 Pipeline
 *
 * 用法:
 *   const store = useRenderStore()
 *   store.startRender(sequenceId, config, frameRenderer, frameExporter)
 *   store.progress // 0-100
 *   store.cancelRender()
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

import type { RenderConfig, RenderJob } from './renderConfig'
import {
  createRenderConfigFromSequence,
  validateRenderConfig,
} from './renderConfig'
import {
  RenderPipeline,
  type FrameRenderer,
  type FrameExporter,
} from './renderPipeline'
import type { Sequence } from '../timeline/core/sequence'

// ============================================================================
// Store 定义
// ============================================================================

export const useRenderStore = defineStore('render', () => {
  // —— 状态 ——
  const currentJob = ref<RenderJob | null>(null)
  let pipeline: RenderPipeline | null = null

  // —— 计算属性 ——

  /** 是否有渲染任务 */
  const hasJob = computed(() => currentJob.value !== null)

  /** 当前状态 */
  const status = computed(() => currentJob.value?.status ?? 'idle')

  /** 是否正在渲染 */
  const isRendering = computed(() => currentJob.value?.status === 'rendering')

  /** 是否已暂停 */
  const isPaused = computed(() => currentJob.value?.status === 'paused')

  /** 是否已完成 */
  const isCompleted = computed(() => currentJob.value?.status === 'completed')

  /** 是否已取消 */
  const isCancelled = computed(() => currentJob.value?.status === 'cancelled')

  /** 是否已失败 */
  const isFailed = computed(() => currentJob.value?.status === 'failed')

  /** 是否可暂停(正在渲染中) */
  const canPause = computed(() => currentJob.value?.status === 'rendering')

  /** 是否可恢复(已暂停) */
  const canResume = computed(() => currentJob.value?.status === 'paused')

  /** 是否可取消(渲染中或暂停中) */
  const canCancel = computed(
    () => currentJob.value?.status === 'rendering' || currentJob.value?.status === 'paused',
  )

  /** 进度百分比(0-100) */
  const progress = computed(() => {
    const job = currentJob.value
    if (!job || job.totalFrames === 0) return 0
    return Math.round((job.completedFrames / job.totalFrames) * 100)
  })

  /** 已完成帧数 */
  const completedFrames = computed(() => currentJob.value?.completedFrames ?? 0)

  /** 总帧数 */
  const totalFrames = computed(() => currentJob.value?.totalFrames ?? 0)

  /** 当前帧号 */
  const currentFrame = computed(() => currentJob.value?.currentFrame ?? 0)

  /** 输出文件列表 */
  const outputFiles = computed(() => currentJob.value?.outputFiles ?? [])

  /** 错误信息 */
  const error = computed(() => currentJob.value?.error ?? null)

  // —— Actions ——

  /**
   * 从 Sequence 创建默认渲染配置。
   *
   * @param seq 源 Sequence
   * @returns 默认 RenderConfig
   */
  function createDefaultConfig(seq: Sequence): RenderConfig {
    return createRenderConfigFromSequence(seq)
  }

  /**
   * 启动渲染任务。
   *
   * @param sequenceId    源 Sequence ID
   * @param config        渲染配置
   * @param frameRenderer 帧渲染器
   * @param frameExporter 帧导出器(可选)
   * @returns 是否成功启动
   */
  function startRender(
    sequenceId: string,
    config: RenderConfig,
    frameRenderer: FrameRenderer,
    frameExporter?: FrameExporter,
  ): boolean {
    // 校验配置
    const validation = validateRenderConfig(config)
    if (!validation.valid) return false

    // 不允许同时启动多个任务
    if (pipeline && pipeline.isRendering) return false

    // 创建 Pipeline
    pipeline = new RenderPipeline(sequenceId, config, frameRenderer, frameExporter)

    // 绑定回调 → 更新 Store 状态
    pipeline.onProgress = (job) => {
      currentJob.value = { ...job }
    }
    pipeline.onComplete = (job) => {
      currentJob.value = { ...job }
    }
    pipeline.onError = (job, _err) => {
      currentJob.value = { ...job }
    }
    pipeline.onCancel = (job) => {
      currentJob.value = { ...job }
    }

    // 初始化 job 状态
    currentJob.value = { ...pipeline.job }

    // 异步启动(不阻塞)
    pipeline.start().catch(() => {
      // 错误已通过 onError 回调处理
    })

    // start() 同步部分已设置 status='rendering',同步到 store
    currentJob.value = { ...pipeline.job }

    return true
  }

  /** 暂停渲染 */
  function pauseRender(): void {
    pipeline?.pause()
    if (pipeline) currentJob.value = { ...pipeline.job }
  }

  /** 恢复渲染 */
  function resumeRender(): void {
    pipeline?.resume()
    if (pipeline) currentJob.value = { ...pipeline.job }
  }

  /** 取消渲染 */
  function cancelRender(): void {
    pipeline?.cancel()
    if (pipeline) currentJob.value = { ...pipeline.job }
  }

  /** 清除已完成/已取消/已失败的任务(重置为 idle) */
  function clearJob(): void {
    if (pipeline && (pipeline.isRendering || pipeline.isPaused)) return
    currentJob.value = null
    pipeline = null
  }

  return {
    // 状态
    currentJob,
    // 计算属性
    hasJob,
    status,
    isRendering,
    isPaused,
    isCompleted,
    isCancelled,
    isFailed,
    canPause,
    canResume,
    canCancel,
    progress,
    completedFrames,
    totalFrames,
    currentFrame,
    outputFiles,
    error,
    // Actions
    createDefaultConfig,
    startRender,
    pauseRender,
    resumeRender,
    cancelRender,
    clearJob,
  }
})
