import regionShaderSource from '@/shaders/region_eval.wgsl?raw'
import effectShaderSource from '@/shaders/effect_post.wgsl?raw'

import type { CompileContext } from '@/compiler/context'
import type { RuntimeDeviceHandle, RuntimeTextureBundle } from '@/runtime/types'
import { prepareEffectUavSplit, recordUavCopy, GpuUavSplitBackend } from '@/runtime/uav'

import type { RegionCompileArtifact } from './regionCompiler'

/**
 * GPUBufferUsage 在非浏览器环境中可能未定义，使用数值 fallback。
 * 数值取自 WebGPU 规范。
 */
const BUFFER_USAGE_STORAGE = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.STORAGE : 0x0080
const BUFFER_USAGE_UNIFORM = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.UNIFORM : 0x0040
const BUFFER_USAGE_COPY_DST = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.COPY_DST : 0x0008
const TEXTURE_USAGE_TEXTURE_BINDING = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.TEXTURE_BINDING : 0x0004
const TEXTURE_USAGE_COPY_DST = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.COPY_DST : 0x0008

export interface RegionEvaluator {
  render: (artifact: RegionCompileArtifact, materialTextures?: MaterialTextureBinding[]) => void
}

/** 材质纹理绑定（从 MaterialRenderBridge 传递给 evaluator） */
export interface MaterialTextureBinding {
  /** binding 索引位（0-3 对应 matTex0-matTex3） */
  slot: number
  /** GPU 纹理视图 */
  view: GPUTextureView
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

  // 材质占位纹理（1×1 黑色，当无材质层时填充 binding 5-8）
  const dummyTextures: GPUTexture[] = []
  const dummyViews: GPUTextureView[] = []
  for (let i = 0; i < 4; i++) {
    const tex = device.createTexture({
      label: `material_dummy_${i}`,
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_COPY_DST,
    })
    dummyTextures.push(tex)
    dummyViews.push(tex.createView())
  }
  // 写入黑色像素到占位纹理
  const blackPixel = new Uint8Array([0, 0, 0, 255])
  for (const tex of dummyTextures) {
    device.queue.writeTexture(
      { texture: tex },
      blackPixel,
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1 },
    )
  }

  // 效果后处理管线（延迟创建，仅在需要时使用）
  let effectPipeline: GPUComputePipeline | null = null
  // UAV Split 产物：只读副本纹理及其绑定槽（未拆分时为 null / -1）
  let effectReadOnlyCopy: GPUTexture | null = null
  let effectReadOnlyBinding = -1

  function ensureEffectPipeline() {
    if (effectPipeline) return

    // UAV Split：将 effect_post 的 read_write 存储纹理拆分为「只写原纹理 +
    // 只读副本」。仅当存在非 r32 系列的 read_write 存储纹理时才拆分。
    const backend = new GpuUavSplitBackend(device)
    const split = prepareEffectUavSplit(effectShaderSource, output, backend)

    let effectShaderModule: GPUShaderModule
    if (split) {
      effectShaderModule = device.createShaderModule({
        label: '效果后处理着色器(UAV Split)',
        code: split.effectShaderCode,
      })
      effectReadOnlyCopy = split.readOnlyCopy
      effectReadOnlyBinding = split.readOnlyBinding
    } else {
      effectShaderModule = device.createShaderModule({
        label: '效果后处理着色器',
        code: effectShaderSource,
      })
      effectReadOnlyCopy = null
      effectReadOnlyBinding = -1
    }

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
    render(artifact, materialTextures) {
      // ---- 创建本帧数据缓冲区（按 artifact 实际大小分配）----
      const descriptorBuffer = device.createBuffer({
        label: '图层描述符缓冲区',
        size: Math.max(artifact.descriptorData.byteLength, 16),
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      })

      const auxBuffer = device.createBuffer({
        label: '图层辅助参数缓冲区',
        size: Math.max(artifact.auxData.byteLength, 16),
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      })

      const regionBuffer = device.createBuffer({
        label: '区域边界缓冲区',
        size: Math.max(artifact.regionData.byteLength, 16),
        usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      })

      // ---- 构建 bind group entries（含材质纹理 binding 5-8） ----
      const bindGroupEntries: GPUBindGroupEntry[] = [
        { binding: 0, resource: { buffer: uniformsBuffer } },
        { binding: 1, resource: output.view },
        { binding: 2, resource: { buffer: auxBuffer } },
        { binding: 3, resource: { buffer: descriptorBuffer } },
        { binding: 4, resource: { buffer: regionBuffer } },
      ]

      // binding 5-8: 材质纹理（优先用真实材质纹理，缺省用占位纹理）
      const materialViewMap = new Map<number, GPUTextureView>()
      if (materialTextures) {
        for (const mt of materialTextures) {
          materialViewMap.set(Math.min(mt.slot, 3), mt.view)
        }
      }
      for (let i = 0; i < 4; i++) {
        const view = materialViewMap.get(i) ?? dummyViews[i]
        bindGroupEntries.push({ binding: 5 + i, resource: view })
      }

      const layerBindGroup = device.createBindGroup({
        label: '区域求值绑定组',
        layout: layerPipeline.getBindGroupLayout(0),
        entries: bindGroupEntries,
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

          const effectBindGroupEntries: GPUBindGroupEntry[] = [
            { binding: 0, resource: { buffer: uniformsBuffer } },
            { binding: 1, resource: output.view },
            { binding: 2, resource: { buffer: effectParamBuffer } },
            { binding: 3, resource: { buffer: effectDescBuffer } },
            { binding: 4, resource: { buffer: regionBuffer } },
          ]
          // UAV Split：将只读副本绑定到其专用槽位，供着色器读取「拆分前」的像素。
          if (effectReadOnlyCopy && effectReadOnlyBinding >= 0) {
            effectBindGroupEntries.push({
              binding: effectReadOnlyBinding,
              resource: effectReadOnlyCopy.createView(),
            })
          }

          const effectBindGroup = device.createBindGroup({
            label: '效果后处理绑定组',
            layout: effectPipeline.getBindGroupLayout(0),
            entries: effectBindGroupEntries,
          })

          device.queue.writeBuffer(effectDescBuffer, 0, artifact.effectDescData, 0, artifact.effectDescData.length)
          device.queue.writeBuffer(effectParamBuffer, 0, artifact.effectParamData, 0, artifact.effectParamData.length)

          const effectEncoder = device.createCommandEncoder({ label: '效果后处理编码器' })
          // 逐帧将当前输出纹理（图层求值结果）复制到只读副本，供效果 pass 读取。
          // 必须在效果 pass 之前录制，确保读取到本帧最新的图层内容。
          if (effectReadOnlyCopy) {
            recordUavCopy(effectEncoder, output.texture, effectReadOnlyCopy)
          }
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
