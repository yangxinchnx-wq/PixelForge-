import presentShaderSource from '@/shaders/present.wgsl?raw'

import type { RuntimeGpuContext, RuntimeTextureBundle } from './types'

export interface PresentPipelineResources {
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  sampler: GPUSampler
}

export function createPresentPipeline(
  gpu: RuntimeGpuContext,
  output: RuntimeTextureBundle,
): PresentPipelineResources {
  const shaderModule = gpu.device.createShaderModule({
    label: 'pixel-forge-present-shader',
    code: presentShaderSource,
  })

  const pipeline = gpu.device.createRenderPipeline({
    label: 'pixel-forge-present-pipeline',
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format: gpu.canvasFormat }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  })

  const sampler = gpu.device.createSampler({
    label: 'pixel-forge-present-sampler',
    magFilter: 'nearest',
    minFilter: 'nearest',
  })

  const bindGroup = gpu.device.createBindGroup({
    label: 'pixel-forge-present-bind-group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: output.view,
      },
      {
        binding: 1,
        resource: sampler,
      },
    ],
  })

  return {
    pipeline,
    bindGroup,
    sampler,
  }
}
