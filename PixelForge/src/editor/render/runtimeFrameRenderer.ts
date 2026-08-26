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
}

export interface RuntimeRenderAdapter {
  frameRenderer: FrameRenderer
  frameExporter: FrameExporter
  restore: () => Promise<void>
  getAppliedPatchCount: () => number
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
  let appliedPatchCount = 0
  let lastTimelineTime = -1

  const frameRenderer: FrameRenderer = async (frameIndex: number, time: Time) => {
    const seconds = toSeconds(time)
    runtime.setRenderTime(seconds)

    const timeline = options.timeline ?? null
    if (timeline && Math.abs(seconds - lastTimelineTime) > Number.EPSILON) {
      const evaluation = evaluateTimeline(timeline, seconds)
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
  }
}
