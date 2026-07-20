import type { RegionEvaluator } from '@/compiler/region/evaluator'

import type { PresentPipelineResources } from './pipeline'
import type { RuntimeDeviceHandle } from './types'

export interface RenderVerificationSnapshot {
  descriptorData: number[]
  auxData: number[]
  regionData: number[]
  effectDescData: number[]
  effectParamData: number[]
  canvasWidth: number
  canvasHeight: number
  seed: number
  visibleLayerCount: number
  hasEffects: boolean
}

export function clearOutputTexture(
  device: RuntimeDeviceHandle,
  outputTexture: GPUTexture,
  clearColor: GPUColor = { r: 0.08, g: 0.1, b: 0.16, a: 1 },
): void {
  const encoder = device.createCommandEncoder({
    label: '清空输出纹理编码器',
  })

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: outputTexture.createView(),
        clearValue: clearColor,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })

  pass.end()
  device.queue.submit([encoder.finish()])
}

export function renderPresentPass(
  device: RuntimeDeviceHandle,
  canvasContext: GPUCanvasContext,
  resources: PresentPipelineResources,
): void {
  const encoder = device.createCommandEncoder({
    label: '呈现输出编码器',
  })

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })

  pass.setPipeline(resources.pipeline)
  pass.setBindGroup(0, resources.bindGroup)
  pass.draw(3)
  pass.end()

  device.queue.submit([encoder.finish()])
}

export function renderFrame(
  evaluator: RegionEvaluator,
  artifact: Parameters<RegionEvaluator['render']>[0],
  device: RuntimeDeviceHandle,
  canvasContext: GPUCanvasContext,
  present: PresentPipelineResources,
): void {
  evaluator.render(artifact)
  renderPresentPass(device, canvasContext, present)
}

export function createRenderVerificationSnapshot(input: {
  artifact: {
    descriptorData: Uint32Array
    auxData: Float32Array
    regionData?: Float32Array
    effectDescData?: Uint32Array
    effectParamData?: Float32Array
    visibleLayerCount?: number
    hasEffects?: boolean
  }
  compileContext: {
    canvasSize: {
      width: number
      height: number
    }
    seed: number
  }
}): RenderVerificationSnapshot {
  return {
    descriptorData: Array.from(input.artifact.descriptorData),
    auxData: Array.from(input.artifact.auxData),
    regionData: input.artifact.regionData ? Array.from(input.artifact.regionData) : [],
    effectDescData: input.artifact.effectDescData ? Array.from(input.artifact.effectDescData) : [],
    effectParamData: input.artifact.effectParamData ? Array.from(input.artifact.effectParamData) : [],
    canvasWidth: input.compileContext.canvasSize.width,
    canvasHeight: input.compileContext.canvasSize.height,
    seed: input.compileContext.seed,
    visibleLayerCount: input.artifact.visibleLayerCount ?? 1,
    hasEffects: input.artifact.hasEffects ?? false,
  }
}
