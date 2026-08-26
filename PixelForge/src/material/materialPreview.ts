/**
 * Material Preview — 材质预览缩略图渲染器。
 *
 * 职责:
 * - 对有 MaterialGraph 的材质：通过 WebGPU 离屏渲染程序化纹理，再映射到 PBR 球体上生成缩略图
 * - 对纯 PBR 参数材质：通过 Canvas 2D 逐像素渲染 PBR 预览球
 * - 输出 Data URI（base64 PNG），可直接用于 <img src>
 *
 * 渲染流程（程序化材质）:
 *   MaterialGraph → compileMaterialGraph → WGSL
 *     → MaterialRuntime.compilePipeline → GPURenderPipeline
 *     → 离屏渲染到小纹理 → copyTextureToBuffer → 回读像素
 *     → Canvas 2D 逐像素 PBR 球体渲染（程序化纹理作为基础色）
 *     → toDataURL → Data URI
 *
 * 渲染流程（PBR 材质）:
 *   PBR 参数 → Canvas 2D 逐像素 PBR 球体渲染
 *     → toDataURL → Data URI
 *
 * PBR 球体渲染器（renderSphereToCanvas）:
 *   逐像素模拟球体在三点光照下的外观:
 *   - Lambert 漫反射
 *   - Blinn-Phong 镜面反射
 *   - Schlick 菲涅尔边缘高光
 *   - 金属度/粗糙度调制
 *   - 环境光遮蔽（球体边缘变暗）
 *   - 自发光叠加
 *   - 可选程序化纹理作为球体表面基础色（球面 UV 映射）
 *
 * 性能考虑:
 * - 缩略图尺寸固定 128×80（16:10 比例，够辨识即可）
 * - WebGPU 渲染只做一次，结果缓存到 MaterialAsset.thumbnail
 * - GPU 不可用时降级到 Canvas 2D PBR 球体预览
 * - 逐像素渲染 128×80 = 10,240 像素，性能开销可忽略
 */

import type { MaterialAsset, PBRMaterialParams } from './materialAsset'
import { DEFAULT_PBR_PARAMS } from './materialAsset'
import type { MaterialGraph } from './types'
import { compileMaterialGraph } from './compiler'
import { MaterialRuntime } from './runtime'

// ============================================================================
// 1. 常量
// ============================================================================

/** 缩略图宽度 */
const THUMB_WIDTH = 128
/** 缩略图高度 */
const THUMB_HEIGHT = 80
/** 缩略图格式 */
const THUMB_FORMAT: GPUTextureFormat = 'rgba8unorm'

/** 1x1 透明 PNG 占位图（Canvas 2D 不可用时的 fallback） */
const FALLBACK_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAfnkC8wAAAABJRU5ErkJggg=='

// ============================================================================
// 2. 向量数学辅助
// ============================================================================

/** 归一化三维向量 */
function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.sqrt(x * x + y * y + z * z)
  if (len < 1e-8) return [0, 0, 1]
  return [x / len, y / len, z / len]
}

/** 点积 */
function dot3(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  return ax * bx + ay * by + az * bz
}

// ============================================================================
// 3. PBR 球体渲染器（核心）
// ============================================================================

/**
 * 在 Canvas 2D 上逐像素渲染 PBR 材质球。
 *
 * 这是材质预览的核心函数，所有缩略图（程序化材质和 PBR 材质）都通过它生成。
 *
 * 光照模型:
 * - 三点光照（Key + Fill + Rim）
 * - Lambert 漫反射：N·L
 * - Blinn-Phong 镜面反射：N·H^shininess
 * - Schlick 菲涅尔：(1 - N·V)^5
 * - 金属度调制：金属的镜面色=基础色，非金属的镜面色=白色
 * - 粗糙度调制：影响 shininess 和高光强度
 * - 环境光遮蔽：球体边缘（N·Z 趋近 0）变暗
 *
 * 纹理映射:
 * - 如果提供了 textureImageData，使用球面 UV 映射从纹理采样基础色
 * - 球面 UV: u = 0.5 + atan2(nz, nx) / (2π), v = 0.5 - asin(ny) / π
 * - 否则使用 PBR 的 baseColorFactor 作为统一基础色
 *
 * @param ctx Canvas 2D 上下文
 * @param width 画布宽度
 * @param height 画布高度
 * @param pbr PBR 参数
 * @param textureImageData 可选的程序化纹理（从 GPU 回读的像素），用作球体表面基础色
 */
export function renderSphereToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pbr: PBRMaterialParams,
  textureImageData?: ImageData | null,
): void {
  const params = { ...DEFAULT_PBR_PARAMS, ...pbr }
  const [bcR, bcG, bcB, bcA] = params.baseColorFactor
  const metallic = params.metallicFactor
  const roughness = params.roughnessFactor
  const [emR, emG, emB] = params.emissiveFactor

  // —— 球体几何参数 ——
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.42

  // —— 纹理采样辅助 ——
  const texWidth = textureImageData?.width ?? 0
  const texHeight = textureImageData?.height ?? 0
  const texData = textureImageData?.data ?? null
  const hasTexture = !!texData && texWidth > 0 && texHeight > 0

  /**
   * 从程序化纹理中采样基础色。
   * 使用球面 UV 映射，Wrap 模式为 repeat。
   */
  function sampleTexture(u: number, v: number): [number, number, number] {
    if (!hasTexture) return [bcR, bcG, bcB]
    // Wrap UV
    u = u - Math.floor(u)
    v = v - Math.floor(v)
    const tx = Math.min(texWidth - 1, Math.max(0, Math.floor(u * texWidth)))
    const ty = Math.min(texHeight - 1, Math.max(0, Math.floor(v * texHeight)))
    const idx = (ty * texWidth + tx) * 4
    return [
      texData![idx] / 255,
      texData![idx + 1] / 255,
      texData![idx + 2] / 255,
    ]
  }

  // —— 三点光照参数 ——
  // Key light（主光源）：左上方，暖白色
  const keyDir = normalize3(-0.5, -0.6, 0.7)
  const keyColor = [1.0, 0.98, 0.95]
  const keyIntensity = 1.0

  // Fill light（补光）：右下方，冷色调
  const fillDir = normalize3(0.4, 0.3, 0.5)
  const fillColor = [0.45, 0.55, 0.75]
  const fillIntensity = 0.3

  // Rim light（轮廓光）：后方偏上，蓝色调
  const rimDir = normalize3(0.0, -0.2, -0.8)
  const rimColor = [0.7, 0.85, 1.0]
  const rimIntensity = 0.35

  // 视线方向（相机看向球体正面）
  const viewDir: [number, number, number] = [0, 0, 1]

  // —— 预计算光照常量 ——
  // roughness → shininess 映射
  // roughness 0 → shininess 128（锐利高光）
  // roughness 1 → shininess 4（漫散高光）
  const shininess = Math.pow(2, 7 * (1 - roughness) + 2)

  // Half vector for key light (Blinn-Phong)
  const halfX = keyDir[0] + viewDir[0]
  const halfY = keyDir[1] + viewDir[1]
  const halfZ = keyDir[2] + viewDir[2]
  const halfLen = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ)
  const hX = halfX / halfLen
  const hY = halfY / halfLen
  const hZ = halfZ / halfLen

  // 环境光（低强度暖色）
  const ambientR = 0.06
  const ambientG = 0.06
  const ambientB = 0.08

  // —— 是否需要棋盘格背景（透明材质） ——
  const hasTransparency = params.alphaMode !== 'OPAQUE' || bcA < 1.0

  // —— 逐像素渲染 ——
  const imageData = ctx.createImageData(width, height)
  const data = imageData.data

  // 背景渐变色
  const bgTopR = 0x1a, bgTopG = 0x1a, bgTopB = 0x24
  const bgBotR = 0x0d, bgBotG = 0x0d, bgBotB = 0x12

  for (let py = 0; py < height; py++) {
    // 背景渐变插值
    const bgT = py / height
    const bgR = Math.round(bgTopR * (1 - bgT) + bgBotR * bgT)
    const bgG = Math.round(bgTopG * (1 - bgT) + bgBotG * bgT)
    const bgB = Math.round(bgTopB * (1 - bgT) + bgBotB * bgT)

    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4

      // 转换到球体归一化坐标
      const nx = (px - cx) / radius
      const ny = (py - cy) / radius
      const r2 = nx * nx + ny * ny

      if (r2 > 1.0) {
        // —— 球体外部：背景 ——
        if (hasTransparency) {
          // 棋盘格背景
          const checkerSize = 8
          const isLight = ((Math.floor(px / checkerSize)) + (Math.floor(py / checkerSize))) % 2 === 0
          data[idx] = isLight ? 0x44 : 0x22
          data[idx + 1] = isLight ? 0x44 : 0x22
          data[idx + 2] = isLight ? 0x44 : 0x22
        } else {
          data[idx] = bgR
          data[idx + 1] = bgG
          data[idx + 2] = bgB
        }
        data[idx + 3] = 255
        continue
      }

      // —— 球体内部：PBR 光照计算 ——
      // 球体法线（z 分量由球面方程推导）
      const nz = Math.sqrt(1.0 - r2)
      // Canvas y 轴向下，法线 y 分量取反
      const normalX = nx
      const normalY = -ny
      const normalZ = nz

      // 球面 UV 映射
      const u = 0.5 + Math.atan2(normalZ, normalX) / (2 * Math.PI)
      const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, normalY))) / Math.PI

      // 采样基础色（从程序化纹理或 PBR 参数）
      const [baseR, baseG, baseB] = sampleTexture(u, v)

      // —— Lambert 漫反射 ——
      const keyDiff = Math.max(0, dot3(normalX, normalY, normalZ, keyDir[0], keyDir[1], keyDir[2]))
      const fillDiff = Math.max(0, dot3(normalX, normalY, normalZ, fillDir[0], fillDir[1], fillDir[2]))
      const rimDiff = Math.max(0, dot3(normalX, normalY, normalZ, rimDir[0], rimDir[1], rimDir[2]))

      // —— Blinn-Phong 镜面反射（仅 Key light） ——
      const specAngle = Math.max(0, dot3(normalX, normalY, normalZ, hX, hY, hZ))
      const specular = Math.pow(specAngle, shininess)

      // —— Schlick 菲涅尔 ——
      const NdotV = Math.max(0, normalZ) // view = [0,0,1]
      const fresnel = Math.pow(1 - NdotV, 5)

      // —— 金属度调制 ——
      // 金属: 镜面反射色 = 基础色, 漫反射大幅降低
      // 非金属: 镜面反射色 = 白色, 漫反射 = 基础色
      const specColorR = baseR * metallic + (1 - metallic) * 1.0
      const specColorG = baseG * metallic + (1 - metallic) * 1.0
      const specColorB = baseB * metallic + (1 - metallic) * 1.0

      const diffModR = baseR * (1 - metallic * 0.85)
      const diffModG = baseG * (1 - metallic * 0.85)
      const diffModB = baseB * (1 - metallic * 0.85)

      // —— 环境光遮蔽（球体边缘变暗） ——
      const ao = Math.pow(normalZ, 0.5)

      // —— 组合光照 ——
      // 环境光
      let r = ambientR * baseR
      let g = ambientG * baseG
      let b = ambientB * baseB

      // 漫反射（Key + Fill + Rim）
      r += diffModR * (keyDiff * keyIntensity * keyColor[0] +
                       fillDiff * fillIntensity * fillColor[0] +
                       rimDiff * rimIntensity * rimColor[0])
      g += diffModG * (keyDiff * keyIntensity * keyColor[1] +
                       fillDiff * fillIntensity * fillColor[1] +
                       rimDiff * rimIntensity * rimColor[1])
      b += diffModB * (keyDiff * keyIntensity * keyColor[2] +
                       fillDiff * fillIntensity * fillColor[2] +
                       rimDiff * rimIntensity * rimColor[2])

      // 镜面反射（Blinn-Phong, 受粗糙度调制）
      const specMod = (1 - roughness * 0.5) * keyIntensity
      r += specColorR * specular * specMod
      g += specColorG * specular * specMod
      b += specColorB * specular * specMod

      // 菲涅尔边缘高光（金属更明显）
      const fresnelMod = (metallic * 0.6 + 0.1) * (1 - roughness * 0.3)
      r += fresnel * specColorR * fresnelMod
      g += fresnel * specColorG * fresnelMod
      b += fresnel * specColorB * fresnelMod

      // 环境光遮蔽
      r *= ao
      g *= ao
      b *= ao

      // 自发光
      r += emR
      g += emG
      b += emB

      // —— 伽马校正（近似 sRGB） ——
      r = Math.pow(Math.min(1, r), 1 / 2.2)
      g = Math.pow(Math.min(1, g), 1 / 2.2)
      b = Math.pow(Math.min(1, b), 1 / 2.2)

      // —— 写入像素 ——
      data[idx] = Math.min(255, Math.round(r * 255))
      data[idx + 1] = Math.min(255, Math.round(g * 255))
      data[idx + 2] = Math.min(255, Math.round(b * 255))
      data[idx + 3] = Math.round(bcA * 255)
    }
  }

  // 一次性写入所有像素
  ctx.putImageData(imageData, 0, 0)
}

// ============================================================================
// 4. WebGPU 离屏渲染（程序化材质纹理）
// ============================================================================

/**
 * 用 WebGPU 离屏渲染 MaterialGraph，获取程序化纹理像素。
 *
 * 流程:
 * 1. 编译 MaterialGraph → WGSL
 * 2. MaterialRuntime 编译 pipeline
 * 3. 离屏渲染到小纹理（全屏三角形）
 * 4. copyTextureToBuffer → 回读像素
 * 5. 将像素映射到 PBR 球体上（通过 renderSphereToCanvas）
 * 6. 转为 Data URI
 *
 * @param graph  MaterialGraph
 * @param device GPU 设备
 * @returns Data URI 字符串，失败返回 null
 */
export async function renderGraphThumbnail(
  graph: MaterialGraph,
  device: GPUDevice,
): Promise<string | null> {
  // 程序化纹理渲染尺寸（比缩略图稍大，保证球体上纹理清晰）
  const texWidth = THUMB_WIDTH
  const texHeight = THUMB_HEIGHT

  try {
    // 1. 编译 MaterialGraph → WGSL
    const compileResult = compileMaterialGraph(graph)

    // 2. 创建 MaterialRuntime 并编译 pipeline
    const runtime = new MaterialRuntime({
      device,
      format: THUMB_FORMAT,
      enableCache: false,
      enableValidation: true,
    })
    const pipelineResult = await runtime.compilePipeline(compileResult)

    // 3. 创建离屏渲染目标纹理
    const texture = device.createTexture({
      label: 'material_preview_texture',
      size: { width: texWidth, height: texHeight, depthOrArrayLayers: 1 },
      format: THUMB_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })

    // 4. 创建回读缓冲区
    const bytesPerPixel = 4
    const bytesPerRow = Math.ceil((texWidth * bytesPerPixel) / 256) * 256
    const paddedBufferSize = bytesPerRow * texHeight
    const readbackBuffer = device.createBuffer({
      label: 'material_preview_readback',
      size: paddedBufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // 5. 渲染程序化纹理（全屏三角形）
    const encoder = device.createCommandEncoder({ label: 'material_preview_encoder' })
    const pass = encoder.beginRenderPass({
      label: 'material_preview_pass',
      colorAttachments: [
        {
          view: texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipelineResult.pipeline)
    pass.draw(3, 1, 0, 0)
    pass.end()

    // 6. 复制纹理到缓冲区
    encoder.copyTextureToBuffer(
      { texture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      { buffer: readbackBuffer, bytesPerRow, rowsPerImage: texHeight },
      { width: texWidth, height: texHeight, depthOrArrayLayers: 1 },
    )

    device.queue.submit([encoder.finish()])

    // 7. 回读像素
    await readbackBuffer.mapAsync(GPUBufferUsage.MAP_READ)
    const arrayBuffer = readbackBuffer.getMappedRange()
    const pixelData = new Uint8ClampedArray(arrayBuffer.slice(0))

    // 8. 释放 GPU 资源
    readbackBuffer.unmap()
    readbackBuffer.destroy()
    texture.destroy()
    runtime.dispose()

    // 9. 去除 bytesPerRow 对齐填充，构建 ImageData
    const tightData = new Uint8ClampedArray(texWidth * texHeight * 4)
    for (let y = 0; y < texHeight; y++) {
      const srcOffset = y * bytesPerRow
      const dstOffset = y * texWidth * 4
      for (let x = 0; x < texWidth * 4; x++) {
        tightData[dstOffset + x] = pixelData[srcOffset + x]
      }
    }
    const textureImageData = new ImageData(tightData, texWidth, texHeight)

    // 10. 将程序化纹理映射到 PBR 球体上，生成缩略图
    const canvas = document.createElement('canvas')
    canvas.width = THUMB_WIDTH
    canvas.height = THUMB_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return FALLBACK_DATA_URI

    // 从 graph 中提取 PBR 参数（如果有 COLOR 节点，使用其颜色作为 PBR baseColor）
    const pbr = extractPBRFromGraph(graph)
    renderSphereToCanvas(ctx, THUMB_WIDTH, THUMB_HEIGHT, pbr, textureImageData)

    return canvas.toDataURL('image/png')
  } catch (e) {
    console.error('[materialPreview] WebGPU 渲染失败:', e)
    return null
  }
}

// ============================================================================
// 5. Canvas 2D 渲染（PBR 材质 / 降级路径）
// ============================================================================

/**
 * 用 Canvas 2D 逐像素渲染 PBR 材质预览球。
 *
 * 使用 renderSphereToCanvas 进行高质量逐像素 PBR 光照渲染。
 *
 * @param pbr PBR 参数
 * @returns Data URI 字符串
 */
export function renderPBRThumbnail(pbr: PBRMaterialParams): string {
  const width = THUMB_WIDTH
  const height = THUMB_HEIGHT

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return FALLBACK_DATA_URI

  try {
    renderSphereToCanvas(ctx, width, height, pbr, null)
    return canvas.toDataURL('image/png')
  } catch {
    return FALLBACK_DATA_URI
  }
}

// ============================================================================
// 6. 辅助函数
// ============================================================================

/**
 * 从 MaterialGraph 中提取 PBR 参数。
 *
 * 程序化材质没有显式的 PBR 参数，但从 COLOR 节点的颜色可以推导出合理的默认值:
 * - baseColor: 取第二个 COLOR 节点（通常是亮色）或第一个 COLOR 节点的颜色
 * - metallic: 默认 0（非金属）
 * - roughness: 默认 0.5（中等粗糙度）
 *
 * @param graph MaterialGraph
 * @returns 推导的 PBR 参数
 */
function extractPBRFromGraph(graph: MaterialGraph): PBRMaterialParams {
  const colorNodes = graph.nodes.filter((n) => n.templateKey === 'color')

  // 优先取第二个 COLOR 节点（通常是亮色/高光色），否则取第一个
  const colorNode = colorNodes[1] ?? colorNodes[0]
  const baseR = colorNode ? Number(colorNode.params.r ?? 0.5) : 0.5
  const baseG = colorNode ? Number(colorNode.params.g ?? 0.5) : 0.5
  const baseB = colorNode ? Number(colorNode.params.b ?? 0.5) : 0.5

  return {
    ...DEFAULT_PBR_PARAMS,
    baseColorFactor: [baseR, baseG, baseB, 1.0],
    metallicFactor: 0.0,
    roughnessFactor: 0.5,
  }
}

// ============================================================================
// 7. 统一入口
// ============================================================================

/**
 * 渲染材质缩略图。
 *
 * - 有 MaterialGraph 的材质：优先使用 WebGPU 离屏渲染程序化纹理 → PBR 球体
 * - 纯 PBR 材质 / WebGPU 不可用：使用 Canvas 2D 逐像素渲染 PBR 球体
 *
 * @param asset  材质资产
 * @param device 可选的 GPU 设备（用于 WebGPU 渲染）
 * @returns Data URI 字符串
 */
export async function renderMaterialThumbnail(
  asset: MaterialAsset,
  device?: GPUDevice,
): Promise<string> {
  // 1. 有 MaterialGraph 且 GPU 可用 → WebGPU 渲染程序化纹理 → PBR 球体
  if (asset.graph && device && !device.lost) {
    const gpuThumb = await renderGraphThumbnail(asset.graph, device)
    if (gpuThumb) return gpuThumb
    // WebGPU 渲染失败，降级到 Canvas 2D
  }

  // 2. 纯 PBR 或 WebGPU 不可用 → Canvas 2D PBR 球体
  return renderPBRThumbnail(asset.pbr ?? DEFAULT_PBR_PARAMS)
}

/**
 * 同步版本的缩略图预览（不依赖 WebGPU，始终可用）。
 *
 * 策略:
 * - 有 MaterialGraph 的程序化材质：从 COLOR 节点提取主色调，用 Canvas 2D 渲染 PBR 球体
 * - 纯 PBR 材质：用 renderPBRThumbnail 逐像素渲染 PBR 球体
 * - 都没有：用默认深色背景
 */
export function renderMaterialThumbnailSync(asset: MaterialAsset): string {
  // 程序化材质：从 graph 的 COLOR 节点提取主色调，渲染 PBR 球体
  if (asset.graph) {
    return renderGraphColorSync(asset.graph)
  }
  // PBR 材质
  return renderPBRThumbnail(asset.pbr ?? DEFAULT_PBR_PARAMS)
}

/**
 * 从 MaterialGraph 生成同步缩略图（PBR 球体）。
 *
 * Canvas 2D 无法真正渲染 MaterialGraph（噪声、Voronoi 等需要 GPU），
 * 所以这里从 COLOR 节点提取主色，用 PBR 球体渲染器生成预览。
 * 真实缩略图由 WebGPU renderGraphThumbnail 异步生成后替换。
 */
function renderGraphColorSync(graph: MaterialGraph): string {
  const canvas = document.createElement('canvas')
  canvas.width = THUMB_WIDTH
  canvas.height = THUMB_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) return FALLBACK_DATA_URI

  try {
    const pbr = extractPBRFromGraph(graph)
    renderSphereToCanvas(ctx, THUMB_WIDTH, THUMB_HEIGHT, pbr, null)
    return canvas.toDataURL('image/png')
  } catch {
    return FALLBACK_DATA_URI
  }
}
