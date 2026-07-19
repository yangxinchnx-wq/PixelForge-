import presentShaderSource from '@/shaders/present.wgsl?raw'

import type { RuntimeDeviceHandle, RuntimeGpuContext, RuntimeTextureBundle } from './types'

export interface PresentPipelineResources {
  pipeline: GPURenderPipeline
  bindGroup: GPUBindGroup
  sampler: GPUSampler
  uniformBuffer: GPUBuffer
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

  const uniformBuffer = gpu.device.createBuffer({
    label: 'pixel-forge-present-uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const bindGroup = gpu.device.createBindGroup({
    label: 'pixel-forge-present-bind-group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: uniformBuffer },
      },
      {
        binding: 1,
        resource: output.view,
      },
      {
        binding: 2,
        resource: sampler,
      },
    ],
  })

  writePresentUniforms(gpu.device, gpu.canvasSize, uniformBuffer)

  return {
    pipeline,
    bindGroup,
    sampler,
    uniformBuffer,
  }
}

export function writePresentUniforms(
  device: RuntimeDeviceHandle,
  canvasSize: RuntimeGpuContext['canvasSize'],
  uniformBuffer: GPUBuffer,
): void {
  const data = new Float32Array([
    canvasSize.width,
    canvasSize.height,
    0,
    0,
  ])
  device.queue.writeBuffer(uniformBuffer, 0, data)
}
