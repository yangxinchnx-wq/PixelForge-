import regionShaderSource from '@/shaders/region_eval.wgsl?raw'
import effectShaderSource from '@/shaders/effect_post.wgsl?raw'

import type { CompileContext } from '@/compiler/context'
import type { RuntimeDeviceHandle, RuntimeTextureBundle } from '@/runtime/types'

import type { RegionCompileArtifact } from './regionCompiler'

/**
 * GPUBufferUsage 在非浏览器环境中可能未定义，使用数值 fallback。
 * 数值取自 WebGPU 规范。
 */
const BUFFER_USAGE_STORAGE = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.STORAGE : 0x0080
const BUFFER_USAGE_UNIFORM = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.UNIFORM : 0x0040
const BUFFER_USAGE_COPY_DST = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.COPY_DST : 0x0008

export interface RegionEvaluator {
  render: (artifact: RegionCompileArtifact) => void
}

export function createRegionEvaluator(
  device: RuntimeDeviceHandle,
  context: CompileContext,
  output: RuntimeTextureBundle,
): RegionEvaluator {
  // 图层求值管线（创建一次，可复用）
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

  // Uniforms 缓冲区（固定 16 字节，可复用）
  const uniformsBuffer = device.createBuffer({
    label: '区域统一参数缓冲区',
    size: 16,
    usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST,
  })

  // 效果后处理管线（延迟创建，仅在需要时使用）
  let effectPipeline: GPUComputePipeline | null = null

  function ensureEffectPipeline() {
    if (effectPipeline) return

    const effectShaderModule = device.createShaderModule({
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
  }

  return {
    render(artifact) {
      // ---- 创建本帧数据缓冲区（按 artifact 实际大小分配）----
      const descriptorBuffer = device.createBuffer({
        label: '图层描述符缓冲区',
        size: Math.max(artifact.descriptorData.byteLength, 4),
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      })

      const auxBuffer = device.createBuffer({
        label: '图层辅助参数缓冲区',
        size: Math.max(artifact.auxData.byteLength, 4),
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      })

      const regionBuffer = device.createBuffer({
        label: '区域边界缓冲区',
        size: Math.max(artifact.regionData.byteLength, 4),
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      })

      // ---- 图层求值绑定组 ----
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

      // ---- 写入数据 ----
      device.queue.writeBuffer(descriptorBuffer, 0, artifact.descriptorData, 0, artifact.descriptorData.length)
      device.queue.writeBuffer(auxBuffer, 0, artifact.auxData, 0, artifact.auxData.length)
      device.queue.writeBuffer(regionBuffer, 0, artifact.regionData, 0, artifact.regionData.length)
      writeUniforms(device, context, uniformsBuffer, artifact.visibleLayerCount)

      // ---- 图层求值 pass ----
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

      // ---- 效果后处理 pass ----
      if (artifact.hasEffects && artifact.effects.length > 0) {
        ensureEffectPipeline()

        if (effectPipeline) {
          const effectDescBuffer = device.createBuffer({
            label: '效果描述符缓冲区',
            size: Math.max(artifact.effectDescData.byteLength, 4),
            usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
          })

          const effectParamBuffer = device.createBuffer({
            label: '效果参数缓冲区',
            size: Math.max(artifact.effectParamData.byteLength, 4),
            usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
          })

          const effectBindGroup = device.createBindGroup({
            label: '效果后处理绑定组',
            layout: effectPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: uniformsBuffer } },
              { binding: 1, resource: output.view },
              { binding: 2, resource: { buffer: effectParamBuffer } },
              { binding: 3, resource: { buffer: effectDescBuffer } },
              { binding: 4, resource: { buffer: regionBuffer } },
            ],
          })

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

          effectDescBuffer.destroy()
          effectParamBuffer.destroy()
        }
      }

      // ---- 清理本帧数据缓冲区 ----
      descriptorBuffer.destroy()
      auxBuffer.destroy()
      regionBuffer.destroy()
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
  const data = new Float32Array([
    context.canvasSize.width,
    context.canvasSize.height,
    context.seed,
    layerCount,
  ])

  device.queue.writeBuffer(uniformsBuffer, 0, data)
}
