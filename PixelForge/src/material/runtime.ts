/**
 * Material Runtime(Step 28.13)— WebGPU Pipeline 动态创建。
 *
 * 职责:
 * - 接收 CompileResult(wgsl + bindings)
 * - 编译前做 WGSL 语法预校验（拦截明显语法错误）
 * - 创建 GPUShaderModule
 * - 创建 GPURenderPipeline(完整渲染管线)
 * - 通过 ShaderCache 避免重复编译
 * - 监听 GPU device.lost 事件，设备丢失时自动清空缓存
 * - 提供 createBindGroup 把用户上传的纹理绑定到 pipeline
 *
 * 数据流(spec §13):
 *   compileMaterialGraph(graph) → CompileResult
 *     ↓
 *   validateWGSL(wgsl)  ← 新增：语法预校验
 *     ↓ (通过)
 *   materialRuntime.compilePipeline(result)
 *     ↓ (检查 shaderCache + 检查 device 是否 lost)
 *   GPUShaderModule + GPURenderPipeline
 *     ↓
 *   renderPass 使用 pipeline
 *     ↓
 *   Canvas
 *
 * 与 runtime/device.ts 的关系:
 * - runtime/device.ts:     初始化 WebGPU(创建 device / context / canvas)
 * - material/runtime.ts:   在已初始化的 device 上编译 material shader
 * - 后者依赖前者的 device,不重复初始化
 */

import type { CompileResult, MaterialBinding } from './types'
import { shaderCache } from './shaderCache'
import { validateWGSL } from './wgslValidator'

/**
 * Material Runtime 编译结果。
 *
 * - module:    GPUShaderModule(由 device.createShaderModule 创建)
 * - pipeline:  GPURenderPipeline(由 device.createRenderPipeline 创建)
 * - cached:    是否来自缓存(true=命中,false=新编译)
 * - hash:      WGSL hash(供调试)
 */
export interface MaterialPipelineResult {
  module: GPUShaderModule
  pipeline: GPURenderPipeline
  cached: boolean
  hash: string
}

/**
 * Material Runtime 选项。
 */
export interface MaterialRuntimeOptions {
  /** WebGPU 设备(必须已初始化) */
  device: GPUDevice
  /** 输出格式(由 navigator.gpu.getPreferredCanvasFormat() 取) */
  format?: GPUTextureFormat
  /** 是否启用 shader cache(默认 true) */
  enableCache?: boolean
  /** 是否启用 WGSL 语法预校验(默认 true) */
  enableValidation?: boolean
}

/**
 * Material Runtime。
 *
 * 用法:
 *   const runtime = new MaterialRuntime({ device, format })
 *   const result = await runtime.compilePipeline(compileResult)
 *   // 使用 result.pipeline 渲染
 */
export class MaterialRuntime {
  private device: GPUDevice
  private format: GPUTextureFormat
  private enableCache: boolean
  private enableValidation: boolean
  /** GPU 设备是否已丢失 */
  private deviceLost = false
  /** device.lost 的 Promise（用于监听设备丢失） */
  private deviceLostPromise: Promise<GPUDeviceLostInfo> | null = null

  constructor(options: MaterialRuntimeOptions) {
    this.device = options.device
    this.format = options.format ?? navigator.gpu.getPreferredCanvasFormat()
    this.enableCache = options.enableCache ?? true
    this.enableValidation = options.enableValidation ?? true

    // 监听设备丢失（RuntimeDeviceHandle 没有 .lost 属性时跳过）
    const lostPromise = (this.device as { lost?: Promise<GPUDeviceLostInfo> }).lost
    if (lostPromise) {
      this.deviceLostPromise = lostPromise.then((info: GPUDeviceLostInfo) => {
        this.deviceLost = true
        // 设备丢失时清空所有缓存的 GPU 资源（它们已失效）
        shaderCache.clear()
        console.error(`[MaterialRuntime] GPU 设备丢失: ${info.reason} — ${info.message}`)
      }) as Promise<GPUDeviceLostInfo>
      // 防止 unhandled rejection
      this.deviceLostPromise!.catch(() => {})
    }
  }

  /** 设备是否已丢失 */
  get isDeviceLost(): boolean {
    return this.deviceLost
  }

  /**
   * 编译 Material Graph 的 WGSL 为 GPU Pipeline。
   *
   * 流程:
   *   0. 检查 GPU 设备是否丢失
   *   0.5 WGSL 语法预校验（拦截明显语法错误）
   *   1. 检查 shaderCache(hash 命中 → 直接返回)
   *   2. 创建 GPUShaderModule
   *   3. 创建 GPURenderPipeline
   *   4. 写入 shaderCache
   *
   * @param result CompileResult(由 compiler.compileMaterialGraph 生成)
   * @returns MaterialPipelineResult
   * @throws 如果设备已丢失 / WGSL 校验失败 / GPU 编译失败
   */
  async compilePipeline(result: CompileResult): Promise<MaterialPipelineResult> {
    // —— 0. 检查设备状态 ——
    if (this.deviceLost) {
      throw new Error('GPU 设备已丢失，无法编译 pipeline。请重新初始化 WebGPU 设备。')
    }

    // —— 0.5 WGSL 语法预校验 ——
    if (this.enableValidation) {
      const validation = validateWGSL(result.wgsl, result.entryPoint)
      if (!validation.valid) {
        const errorMessages = validation.errors.map(
          (e) => `  [${e.rule}] 行 ${e.line}:${e.column} — ${e.message}` +
            (e.snippet ? `\n    ${e.snippet}` : ''),
        )
        throw new Error(
          `WGSL 语法校验失败 (${validation.errors.length} 个错误):\n${errorMessages.join('\n')}`,
        )
      }
    }

    // —— 1. 检查缓存 ——
    if (this.enableCache) {
      const cached = shaderCache.get(result.hash)
      if (cached?.module && cached.pipeline) {
        // 缓存命中，但设备可能已丢失——再次检查
        if (this.deviceLost) {
          shaderCache.clear()
          throw new Error('GPU 设备已丢失，缓存的 pipeline 已失效。')
        }
        shaderCache.recordHit()
        return {
          module: cached.module,
          pipeline: cached.pipeline,
          cached: true,
          hash: result.hash,
        }
      }
      shaderCache.recordMiss()
    }

    // —— 2. 创建 GPUShaderModule ——
    const fullWgsl = withVertexShader(result.wgsl)
    const module = this.device.createShaderModule({
      label: `material_${result.hash}`,
      code: fullWgsl,
    })

    // —— 3. 创建 GPURenderPipeline ——
    const pipeline = this.device.createRenderPipeline({
      label: `material_pipeline_${result.hash}`,
      layout: 'auto',  // 由 binding 声明自动推导
      vertex: {
        module,
        entryPoint: 'vs_main',
        buffers: [],
      },
      fragment: {
        module,
        entryPoint: result.entryPoint,
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'one',
                dstFactor: 'zero',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'zero',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    })

    // —— 4. 写入缓存 ——
    if (this.enableCache) {
      shaderCache.setWithResult(result, module, pipeline)
    }

    return {
      module,
      pipeline,
      cached: false,
      hash: result.hash,
    }
  }

  /**
   * 创建 BindGroup(把用户上传的纹理资源绑定到 pipeline)。
   *
   * @param pipeline   已编译的 pipeline
   * @param bindings   CompileResult.bindings(描述需要哪些资源)
   * @param resources  资源映射:sourceNodeId → { texture, sampler }
   * @returns GPUBindGroup
   */
  createBindGroup(
    pipeline: GPURenderPipeline,
    bindings: MaterialBinding[],
    resources: Map<string, { texture: GPUTextureView; sampler: GPUSampler }>,
  ): GPUBindGroup {
    const entries: GPUBindGroupEntry[] = []
    for (const binding of bindings) {
      const res = resources.get(binding.sourceNodeId)
      if (!res) {
        throw new Error(`缺少节点 ${binding.sourceNodeId} 的纹理资源`)
      }
      if (binding.kind === 'texture') {
        entries.push({
          binding: binding.binding,
          resource: res.texture,
        })
      } else if (binding.kind === 'sampler') {
        entries.push({
          binding: binding.binding,
          resource: res.sampler,
        })
      }
    }
    // 取 pipeline 的 group 0 layout(由 'auto' layout 自动生成)
    const bindGroupLayout = pipeline.getBindGroupLayout(0)
    return this.device.createBindGroup({
      label: 'material_bind_group',
      layout: bindGroupLayout,
      entries,
    })
  }

  /**
   * 渲染单帧(简化版,实际项目由 encoder.ts 处理)。
   *
   * @param pipeline     已编译的 pipeline
   * @param bindGroup    已创建的 bind group(若有纹理)
   * @param outputView   输出纹理 view(canvas context 的 current view)
   */
  render(
    pipeline: GPURenderPipeline,
    outputView: GPUTextureView,
    bindGroup?: GPUBindGroup,
  ): void {
    const encoder = this.device.createCommandEncoder({
      label: 'material_render_encoder',
    })

    const pass = encoder.beginRenderPass({
      label: 'material_render_pass',
      colorAttachments: [
        {
          view: outputView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    pass.setPipeline(pipeline)
    if (bindGroup) {
      pass.setBindGroup(0, bindGroup)
    }
    // 绘制 fullscreen quad(3 个顶点,用 @builtin(vertex_index) 生成)
    pass.draw(3, 1, 0, 0)
    pass.end()

    this.device.queue.submit([encoder.finish()])
  }

  /**
   * 释放资源(切换场景时调用)。
   *
   * 注意:GPUShaderModule / GPURenderPipeline 没有显式 destroy,
   * 由 GC 处理;这里只清空 cache。
   */
  dispose(): void {
    shaderCache.clear()
    this.deviceLostPromise = null
  }
}

/**
 * 全屏三角形的 vertex shader(用 @builtin(vertex_index) 生成)。
 *
 * WGSL 代码:
 *   @vertex fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
 *     var pos = array<vec2<f32>, 3>(
 *       vec2<f32>(-1.0, -3.0),
 *       vec2<f32>( 3.0,  1.0),
 *       vec2<f32>(-1.0,  1.0),
 *     );
 *     var out: VertexOutput;
 *     out.position = vec4<f32>(pos[idx], 0.0, 1.0);
 *     out.uv = pos[idx] * 0.5 + 0.5;
 *     return out;
 *   }
 *
 * 注:这个 vertex shader 应该被合并到 compiler 生成的 WGSL 中,
 *     或作为 prepend 字符串附加到 result.wgsl 前。
 */
export const FULLSCREEN_VERTEX_SHADER = `
@vertex fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>( 3.0,  1.0),
    vec2<f32>(-1.0,  1.0),
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[idx], 0.0, 1.0);
  out.uv = pos[idx] * 0.5 + 0.5;
  return out;
}
`

/**
 * 把 fullscreen vertex shader 附加到 material WGSL 前。
 *
 * 由 compilePipeline 调用,使生成的 WGSL 包含完整的 vs_main + fs_main。
 */
export function withVertexShader(wgsl: string): string {
  return `${FULLSCREEN_VERTEX_SHADER}\n${wgsl}`
}
