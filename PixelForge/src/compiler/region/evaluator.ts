import regionShaderSource from '@/shaders/region_eval.wgsl?raw'
import effectShaderSource from '@/shaders/effect_post.wgsl?raw'

import type { CompileContext } from '@/compiler/context'
import type { RuntimeDeviceHandle, RuntimeTextureBundle } from '@/runtime/types'

import type { RegionCompileArtifact } from './regionCompiler'

export interface RegionEvaluator {
  render: (artifact: RegionCompileArtifact) => void
}

export function createRegionEvaluator(
  device: RuntimeDeviceHandle,
  context: CompileContext,
  output: RuntimeTextureBundle,
): RegionEvaluator {
  // 图层求值管线
  const layerShaderModule = device.createShaderModule({
    label: '区域求值着色器',
    code: regionShaderSource,
  })

  const layerPipeline = device.createComputePipeline({
    label: '区域求值管线',
    layout: 'auto',
    compute: {
      module: layerShaderModule,
      entryPoint: 'main',
    },
  })

  // 图层缓冲区（动态大小，最小 64 字节）
  const descriptorBuffer = device.createBuffer({
    label: '图层描述符缓冲区',
    size: 256,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const auxBuffer = device.createBuffer({
    label: '图层辅助参数缓冲区',
    size: 1024,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const regionBuffer = device.createBuffer({
    label: '区域边界缓冲区',
    size: 256,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  const uniformsBuffer = device.createBuffer({
    label: '区域统一参数缓冲区',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const layerBindGroup = device.createBindGroup({
    label: '区域求值绑定组',
    layout: layerPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformsBuffer } },
      { binding: 1, resource: output.view },
      { binding: 2, resource: { buffer: auxBuffer } },
      { binding: 3, resource: { buffer: descriptorBuffer } },
      { binding: 4, resource: { buffer: regionBuffer } },
    ],
  })

  // 效果后处理管线（延迟创建，仅在需要时使用）
  let effectShaderModule: GPUShaderModule | null = null
  let effectPipeline: GPUComputePipeline | null = null
  let effectDescBuffer: GPUBuffer | null = null
  let effectParamBuffer: GPUBuffer | null = null
  let effectBindGroup: GPUBindGroup | null = null

  function ensureEffectPipeline() {
    if (effectPipeline) return

    effectShaderModule = device.createShaderModule({
      label: '效果后处理着色器',
      code: effectShaderSource,
    })

    effectPipeline = device.createComputePipeline({
      label: '效果后处理管线',
      layout: 'auto',
      compute: {
        module: effectShaderModule,
        entryPoint: 'main',
      },
    })

    effectDescBuffer = device.createBuffer({
      label: '效果描述符缓冲区',
      size: 256,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    effectParamBuffer = device.createBuffer({
      label: '效果参数缓冲区',
      size: 256,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    effectBindGroup = device.createBindGroup({
      label: '效果后处理绑定组',
      layout: effectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformsBuffer } },
        { binding: 1, resource: output.view },
        { binding: 2, resource: { buffer: effectParamBuffer } },
        { binding: 3, resource: { buffer: effectDescBuffer } },
      ],
    })
  }

  return {
    render(artifact) {
      // 写入图层描述符
      device.queue.writeBuffer(descriptorBuffer, 0, artifact.descriptorData, 0, artifact.descriptorData.length)

      // 写入图层辅助参数
      device.queue.writeBuffer(auxBuffer, 0, artifact.auxData, 0, artifact.auxData.length)

      // 写入区域边界数据
      device.queue.writeBuffer(regionBuffer, 0, artifact.regionData, 0, artifact.regionData.length)

      // 写入 uniforms（含 layerCount，对齐看色器 Uniforms 结构）
      writeUniforms(device, context, uniformsBuffer, artifact.visibleLayerCount)

      // 图层求值 pass
      const encoder = device.createCommandEncoder({ label: '区域求值编码器' })
      const pass = encoder.beginComputePass({ label: '区域求值过程' })
      pass.setPipeline(layerPipeline)
      pass.setBindGroup(0, layerBindGroup)
      pass.dispatchWorkgroups(
        Math.ceil(context.canvasSize.width / 16),
        Math.ceil(context.canvasSize.height / 16),
      )
      pass.end()
      device.queue.submit([encoder.finish()])

      // 效果后处理 pass（仅当有效果时）
      if (artifact.hasEffects && artifact.effects.length > 0) {
        ensureEffectPipeline()

        if (effectDescBuffer && effectParamBuffer && effectBindGroup && effectPipeline) {
          device.queue.writeBuffer(effectDescBuffer, 0, artifact.effectDescData, 0, artifact.effectDescData.length)
          device.queue.writeBuffer(effectParamBuffer, 0, artifact.effectParamData, 0, artifact.effectParamData.length)

          const effectEncoder = device.createCommandEncoder({ label: '效果后处理编码器' })
          const effectPass = effectEncoder.beginComputePass({ label: '效果后处理过程' })
          effectPass.setPipeline(effectPipeline)
          effectPass.setBindGroup(0, effectBindGroup)
          effectPass.dispatchWorkgroups(
            Math.ceil(context.canvasSize.width / 16),
            Math.ceil(context.canvasSize.height / 16),
          )
          effectPass.end()
          device.queue.submit([effectEncoder.finish()])
        }
      }
    },
  }
}

function writeUniforms(
  device: RuntimeDeviceHandle,
  context: CompileContext,
  uniformsBuffer: GPUBuffer,
  layerCount: number,
): void {
  // Uniforms 结构对齐 region_eval.wgsl：resolution(vec2f) + seed(u32) + layerCount(u32)
  // 注意：骨架 §4.7 已删除 CompileContext.time，WGSL uniform 中也不再包含 time
  const data = new Float32Array([
    context.canvasSize.width,
    context.canvasSize.height,
    context.seed,
    layerCount,
  ])

  device.queue.writeBuffer(uniformsBuffer, 0, data)
}
