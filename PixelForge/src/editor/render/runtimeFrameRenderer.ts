/**
 * Runtime -> RenderPipeline adapter.
 *
 * This is the production bridge between the real WebGPU Runtime and the
 * renderer/export state machine. Every frame follows the same order:
 *   set time -> evaluate unified Timeline -> apply l3_timeline patches
 *   -> render RenderIR -> wait for GPU -> capture Canvas bytes.
 */
import type { ValuePatch } from '@/compiler/ir/patch'
import type { useRuntimeStore } from '@/stores/runtime'
import type { TimelineContent } from '@/world/types'
import { evaluateTimeline } from '@/world/timeline/evaluator'
import { toSeconds, type Time } from './timelineTypes'
import type { FrameExporter, FrameRenderer, RenderedFrame } from './renderPipeline'
import type { RenderConfig } from './renderConfig'

export interface RuntimeFrameRendererOptions {
  timeline?: TimelineContent | null
  restoreAfterRender?: boolean
  /**
   * 导出模式(默认 true):每帧都完整求值时间轴,不启用"时间未变则跳过"的优化。
   *
   * 导出要求同一帧在任何执行顺序下结果一致;跳过优化会让第 0 帧的结果
   * 依赖上一次渲染遗留的状态(路径依赖)。预览场景可设为 false 以省算力。
   */
  deterministicTimeline?: boolean
  /**
   * 首帧预热渲染次数(默认 1)。
   *
   * 在捕获第 0 帧前先渲染若干次并丢弃结果,让着色器编译、管线创建、
   * 纹理上传等一次性初始化在真实捕获前完成——否则首帧可能拿到
   * 未就绪的管线输出,与预览画面不一致。设为 0 可关闭。
   */
  warmupPasses?: number
}

export interface RuntimeRenderAdapter {
  frameRenderer: FrameRenderer
  frameExporter: FrameExporter
  restore: () => Promise<void>
  getAppliedPatchCount: () => number
  /** 时间轴求值次数(导出确定性诊断:应等于渲染帧数) */
  getTimelineEvaluationCount: () => number
  /** 首帧预热渲染次数 */
  getWarmupRenderCount: () => number
}

type RuntimeStore = ReturnType<typeof useRuntimeStore>

function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  return fetch(dataUrl)
    .then((response) => response.arrayBuffer())
    .then((buffer) => new Uint8Array(buffer))
}

function isRenderablePatch(patch: ValuePatch, runtime: RuntimeStore): boolean {
  if (patch.targetEntity === 'layer') {
    return runtime.currentIr.layers.some((layer) => layer.id === patch.targetId)
  }
  return runtime.currentIr.effects.some((effect) => effect.id === patch.targetId)
}

function createFramePath(frame: RenderedFrame, config: RenderConfig): string {
  const extension = config.format === 'png-sequence' ? 'png' : config.format
  return `${config.outputName}_${String(frame.frameIndex).padStart(6, '0')}.${extension}`
}

/** Create a real FrameRenderer backed by Runtime.captureCanvas(). */
export function createRuntimeFrameRenderer(
  runtime: RuntimeStore,
  options: RuntimeFrameRendererOptions = {},
): RuntimeRenderAdapter {
  const originalIr = JSON.parse(JSON.stringify(runtime.currentIr)) as typeof runtime.currentIr
  const originalTime = runtime.currentRenderTime
  const deterministicTimeline = options.deterministicTimeline ?? true
  const warmupPasses = Math.max(0, Math.trunc(options.warmupPasses ?? 1))
  let appliedPatchCount = 0
  let timelineEvaluationCount = 0
  let warmupRenderCount = 0
  let lastTimelineTime = Number.NaN

  const frameRenderer: FrameRenderer = async (frameIndex: number, time: Time) => {
    const seconds = toSeconds(time)
    // 新任务从第 0 帧开始时清空求值记忆,保证与上一次渲染无关
    if (frameIndex === 0) lastTimelineTime = Number.NaN

    runtime.setRenderTime(seconds)

    const timeline = options.timeline ?? null
    // 导出模式每帧必求值;预览模式在时间未变化(1ns 容差)时跳过
    const timeChanged = Number.isNaN(lastTimelineTime)
      || Math.abs(seconds - lastTimelineTime) > 1e-9
    if (timeline && (deterministicTimeline || timeChanged)) {
      const evaluation = evaluateTimeline(timeline, seconds)
      timelineEvaluationCount++
      const validPatches = evaluation.patches.filter((patch) => isRenderablePatch(patch, runtime))
      if (validPatches.length > 0) {
        const result = runtime.applyValuePatches(validPatches, {
          source: 'l3_timeline',
          skipHistory: true,
          render: false,
        })
        if (!result.success) {
          throw new Error(result.error ?? 'Timeline patch 应用失败')
        }
        appliedPatchCount += result.appliedCount
      }
      lastTimelineTime = seconds
    }

    // 首帧预热:丢弃式渲染,完成一次性 GPU 初始化后再捕获
    if (frameIndex === 0 && warmupPasses > 0) {
      for (let pass = 0; pass < warmupPasses; pass++) {
        await runtime.renderCurrentIR()
        warmupRenderCount++
      }
    }

    await runtime.renderCurrentIR()
    const dataUrl = await runtime.captureCanvas()
    if (!dataUrl) {
      throw new Error('Runtime 未返回 Canvas 帧：请确认 WebGPU 已初始化且画布可用')
    }

    return {
      frameIndex,
      time,
      data: await dataUrlToBytes(dataUrl),
    }
  }

  const frameExporter: FrameExporter = async (frame, config) => createFramePath(frame, config)

  const restore = async () => {
    if (!options.restoreAfterRender) return
    await runtime.setRenderIR(originalIr)
    runtime.setRenderTime(originalTime)
  }

  return {
    frameRenderer,
    frameExporter,
    restore,
    getAppliedPatchCount: () => appliedPatchCount,
    getTimelineEvaluationCount: () => timelineEvaluationCount,
    getWarmupRenderCount: () => warmupRenderCount,
  }
}
