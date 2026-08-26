/**
 * Material Validator — 材质端到端验证工具。
 *
 * 职责:
 * - 将编译好的 material pipeline 渲染到一个小纹理上
 * - 回读像素数据并做基本属性检查
 * - 检测全黑 / 全透明 / NaN / Infinity 等异常输出
 * - 提供统计信息（平均亮度、颜色分布、方差等）
 *
 * 用法:
 *   const result = await runtime.compilePipeline(compileResult)
 *   const validation = await validateMaterialOutput(runtime.device, result.pipeline, {
 *     width: 64, height: 64, format: 'rgba8unorm'
 *   })
 *   if (!validation.valid) {
 *     console.error('材质输出异常:', validation.issues)
 *   }
 *
 * 局限性:
 * - 只检查像素级的基本属性，不验证"视觉效果是否正确"
 * - 采样小尺寸纹理（如 64×64），不会覆盖所有像素情况
 * - 依赖 GPU 设备可用
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface MaterialOutputValidationOptions {
  /** 采样纹理宽度（默认 64，越大越精确但越慢） */
  width?: number
  /** 采样纹理高度（默认 64） */
  height?: number
  /** 纹理格式（默认 rgba8unorm） */
  format?: GPUTextureFormat
}

export interface PixelStats {
  /** 平均 R 值 (0-255) */
  avgR: number
  /** 平均 G 值 (0-255) */
  avgG: number
  /** 平均 B 值 (0-255) */
  avgB: number
  /** 平均 A 值 (0-255) */
  avgA: number
  /** 平均亮度 (0-255, 加权平均) */
  avgLuminance: number
  /** 颜色方差（衡量画面变化程度） */
  variance: number
  /** 非零像素比例 (0-1) */
  nonZeroRatio: number
  /** 透明像素比例 (alpha < 128) (0-1) */
  transparentRatio: number
}

export interface MaterialOutputValidationResult {
  /** 是否通过验证（无严重问题） */
  valid: boolean
  /** 发现的问题列表 */
  issues: MaterialOutputIssue[]
  /** 像素统计信息 */
  stats: PixelStats
  /** 采样尺寸 */
  sampleSize: { width: number; height: number }
}

export interface MaterialOutputIssue {
  severity: 'error' | 'warning'
  category: string
  message: string
}

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证材质 pipeline 的渲染输出。
 *
 * 流程:
 *   1. 创建小尺寸渲染目标纹理
 *   2. 用 pipeline 渲染一个全屏三角形
 *   3. 将结果复制到缓冲区并回读
 *   4. 分析像素数据
 *
 * @param device    GPU 设备
 * @param pipeline  已编译的 GPURenderPipeline
 * @param bindGroup 可选的 bind group（含纹理资源）
 * @param options   验证选项
 * @returns 验证结果
 */
export async function validateMaterialOutput(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup | null,
  options: MaterialOutputValidationOptions = {},
): Promise<MaterialOutputValidationResult> {
  const width = options.width ?? 64
  const height = options.height ?? 64
  const format = options.format ?? 'rgba8unorm'

  // —— 1. 创建渲染目标纹理 ——
  const texture = device.createTexture({
    label: 'material_validation_texture',
    size: { width, height, depthOrArrayLayers: 1 },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })

  // —— 2. 创建回读缓冲区 ——
  // rgba8unorm: 4 bytes per pixel
  const bytesPerPixel = 4
  // 需要按 256 字节对齐 rows，pitch = ceil(width * 4 / 256) * 256
  const bytesPerRow = Math.ceil((width * bytesPerPixel) / 256) * 256
  const paddedBufferSize = bytesPerRow * height

  const readbackBuffer = device.createBuffer({
    label: 'material_validation_readback',
    size: paddedBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  // —— 3. 渲染 ——
  const encoder = device.createCommandEncoder({
    label: 'material_validation_encoder',
  })

  const pass = encoder.beginRenderPass({
    label: 'material_validation_pass',
    colorAttachments: [
      {
        view: texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })

  pass.setPipeline(pipeline)
  if (bindGroup) {
    pass.setBindGroup(0, bindGroup)
  }
  pass.draw(3, 1, 0, 0)
  pass.end()

  // —— 4. 复制纹理到缓冲区 ——
  encoder.copyTextureToBuffer(
    {
      texture,
      mipLevel: 0,
      origin: { x: 0, y: 0, z: 0 },
    },
    {
      buffer: readbackBuffer,
      bytesPerRow,
      rowsPerImage: height,
    },
    { width, height, depthOrArrayLayers: 1 },
  )

  device.queue.submit([encoder.finish()])

  // —— 5. 回读像素 ——
  await readbackBuffer.mapAsync(GPUBufferUsage.MAP_READ)
  const arrayBuffer = readbackBuffer.getMappedRange()
  const pixelData = new Uint8Array(arrayBuffer.slice(0))

  // 释放资源
  readbackBuffer.unmap()
  readbackBuffer.destroy()
  texture.destroy()

  // —— 6. 分析像素 ——
  const stats = analyzePixels(pixelData, width, height, bytesPerRow)
  const issues = detectIssues(stats)

  return {
    valid: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
    stats,
    sampleSize: { width, height },
  }
}

// ============================================================================
// 像素分析
// ============================================================================

export function analyzePixels(
  data: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
): PixelStats {
  let totalR = 0
  let totalG = 0
  let totalB = 0
  let totalA = 0
  let nonZeroCount = 0
  let transparentCount = 0
  let sumLuminance = 0
  let sumLuminanceSq = 0
  const totalPixels = width * height

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * bytesPerRow + x * 4
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      const a = data[offset + 3]

      totalR += r
      totalG += g
      totalB += b
      totalA += a

      // 亮度（Rec. 601 加权）
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      sumLuminance += lum
      sumLuminanceSq += lum * lum

      if (r > 0 || g > 0 || b > 0 || a > 0) {
        nonZeroCount++
      }
      if (a < 128) {
        transparentCount++
      }
    }
  }

  const avgLuminance = sumLuminance / totalPixels
  const variance = sumLuminanceSq / totalPixels - avgLuminance * avgLuminance

  return {
    avgR: Math.round(totalR / totalPixels),
    avgG: Math.round(totalG / totalPixels),
    avgB: Math.round(totalB / totalPixels),
    avgA: Math.round(totalA / totalPixels),
    avgLuminance: Math.round(avgLuminance),
    variance: Math.round(variance),
    nonZeroRatio: nonZeroCount / totalPixels,
    transparentRatio: transparentCount / totalPixels,
  }
}

// ============================================================================
// 问题检测
// ============================================================================

export function detectIssues(stats: PixelStats): MaterialOutputIssue[] {
  const issues: MaterialOutputIssue[] = []

  // —— 全黑输出 ——
  if (stats.avgR === 0 && stats.avgG === 0 && stats.avgB === 0 && stats.nonZeroRatio < 0.01) {
    issues.push({
      severity: 'error',
      category: 'all_black',
      message: '渲染输出全黑（所有 RGB 通道为零）。可能原因: shader 未正确输出颜色 / OUTPUT 节点未连接 / 节点参数异常',
    })
  }

  // —— 全透明 ——
  if (stats.transparentRatio > 0.99) {
    issues.push({
      severity: 'error',
      category: 'all_transparent',
      message: '渲染输出几乎全透明（alpha < 128 的像素 > 99%）。可能原因: shader 输出的 alpha 值为 0',
    })
  }

  // —— 极低亮度 ——
  if (stats.avgLuminance > 0 && stats.avgLuminance < 5) {
    issues.push({
      severity: 'warning',
      category: 'too_dark',
      message: `渲染输出极暗（平均亮度 ${stats.avgLuminance}/255）。画面可能几乎不可见`,
    })
  }

  // —— 极高亮度（可能过曝） ——
  if (stats.avgLuminance > 250) {
    issues.push({
      severity: 'warning',
      category: 'too_bright',
      message: `渲染输出极亮（平均亮度 ${stats.avgLuminance}/255）。可能过曝`,
    })
  }

  // —— 零方差（纯色画面） ——
  if (stats.variance === 0 && stats.nonZeroRatio > 0.01) {
    issues.push({
      severity: 'warning',
      category: 'no_variation',
      message: '渲染输出为纯色（方差为 0）。画面没有任何变化，可能节点连接不正确',
    })
  }

  // —— 极低方差（几乎纯色） ——
  if (stats.variance > 0 && stats.variance < 2) {
    issues.push({
      severity: 'warning',
      category: 'low_variation',
      message: `渲染输出变化极少（方差 ${stats.variance}）。画面几乎为纯色`,
    })
  }

  return issues
}

// ============================================================================
// 便捷函数：从 CompileResult 直接验证
// ============================================================================

/**
 * 从 CompileResult 完整验证：编译 → 渲染 → 检查。
 *
 * @param device    GPU 设备
 * @param result    CompileResult（由 compiler.compileMaterialGraph 生成）
 * @param format    输出纹理格式
 * @param resources 可选的纹理资源（TEXTURE 节点需要）
 * @param options   验证选项
 */
export async function validateCompileResult(
  device: GPUDevice,
  result: { wgsl: string; hash: string; entryPoint: string; bindings: Array<{ kind: string; binding: number; sourceNodeId: string }> },
  format: GPUTextureFormat,
  resources: Map<string, { texture: GPUTextureView; sampler: GPUSampler }> | null,
  options?: MaterialOutputValidationOptions,
): Promise<MaterialOutputValidationResult> {
  // 导入 runtime 相关（延迟导入避免循环依赖）
  const { withVertexShader } = await import('./runtime')
  const { validateWGSL } = await import('./wgslValidator')

  // 1. WGSL 语法校验
  const validation = validateWGSL(result.wgsl, result.entryPoint)
  if (!validation.valid) {
    return {
      valid: false,
      issues: [{
        severity: 'error',
        category: 'wgsl_syntax',
        message: `WGSL 语法校验失败: ${validation.errors.map((e) => e.message).join('; ')}`,
      }],
      stats: {
        avgR: 0, avgG: 0, avgB: 0, avgA: 0,
        avgLuminance: 0, variance: 0,
        nonZeroRatio: 0, transparentRatio: 1,
      },
      sampleSize: { width: 0, height: 0 },
    }
  }

  // 2. 创建 pipeline
  const fullWgsl = withVertexShader(result.wgsl)
  const module = device.createShaderModule({
    label: `validation_${result.hash}`,
    code: fullWgsl,
  })
  const pipeline = device.createRenderPipeline({
    label: `validation_pipeline_${result.hash}`,
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main', buffers: [] },
    fragment: {
      module,
      entryPoint: result.entryPoint,
      targets: [{ format, blend: undefined }],
    },
    primitive: { topology: 'triangle-list' },
  })

  // 3. 创建 bind group（若有纹理资源）
  let bindGroup: GPUBindGroup | null = null
  if (resources && result.bindings.length > 0) {
    const entries: GPUBindGroupEntry[] = []
    for (const binding of result.bindings) {
      const res = resources.get(binding.sourceNodeId)
      if (!res) continue
      if (binding.kind === 'texture') {
        entries.push({ binding: binding.binding, resource: res.texture })
      } else if (binding.kind === 'sampler') {
        entries.push({ binding: binding.binding, resource: res.sampler })
      }
    }
    if (entries.length > 0) {
      const layout = pipeline.getBindGroupLayout(0)
      bindGroup = device.createBindGroup({
        label: 'validation_bind_group',
        layout,
        entries,
      })
    }
  }

  // 4. 渲染并验证
  return validateMaterialOutput(device, pipeline, bindGroup, options)
}
