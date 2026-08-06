/**
 * Material Render Bridge — 把 MaterialAsset 渲染为离屏 GPUTexture，
 * 供主渲染管线（RegionEvaluator）作为纹理源消费。
 *
 * 职责:
 * - 接收 MaterialAsset（含 MaterialGraph 或纯 PBR 参数）
 * - 有 MaterialGraph 时：编译 → MaterialRuntime → 离屏渲染 → GPUTexture
 * - 纯 PBR 参数时：用 Canvas 2D 生成缩略图 → 上传为 GPUTexture
 * - 缓存已渲染纹理（按 materialId + graphHash），避免重复编译
 * - 提供 getTexture(materialId) 查询接口
 * - 纹理生命周期管理（创建 / 复用 / 销毁）
 *
 * 集成点（在 runtime store 的 renderCurrentIR 中调用）:
 *   1. 扫描 currentIr.layers 中带 materialId 的图层
 *   2. 对每个 materialId 调用 bridge.renderMaterial(materialAsset, device, canvasSize)
 *   3. 得到 GPUTexture，在 regionCompiler 中作为 IMAGE_TEXTURE 层的纹理源
 *
 * 数据流:
 *   MaterialAsset → compileMaterialGraph → WGSL
 *     → MaterialRuntime.compilePipeline → GPURenderPipeline
 *     → 离屏 RenderPass → GPUTexture
 *     → regionEvaluator 消费
 */

import type { MaterialAsset } from './materialAsset'
import { DEFAULT_PBR_PARAMS } from './materialAsset'
import type { MaterialGraph } from './types'
import { compileMaterialGraph } from './compiler'
import { MaterialRuntime } from './runtime'
import { renderSphereToCanvas } from './materialPreview'

// ============================================================================
// 常量 fallback（非浏览器环境）
// ============================================================================

const TEXTURE_USAGE_RENDER_ATTACHMENT = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.RENDER_ATTACHMENT : 0x10
const TEXTURE_USAGE_TEXTURE_BINDING = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.TEXTURE_BINDING : 0x04
const TEXTURE_USAGE_COPY_SRC = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.COPY_SRC : 0x01
const TEXTURE_USAGE_COPY_DST = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.COPY_DST : 0x08

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 桥接渲染的纹理缓存条目 */
interface MaterialTextureEntry {
  /** GPU 纹理（离屏渲染目标） */
  texture: GPUTexture
  /** 纹理视图（避免重复创建） */
  view: GPUTextureView
  /** 采样器 */
  sampler: GPUSampler
  /** WGSL hash（用于判断是否需要重新编译） */
  graphHash: string
  /** 画布尺寸（尺寸变化时需要重建） */
  canvasSize: { width: number; height: number }
  /** 是否为程序化材质（有 MaterialGraph） */
  isProcedural: boolean
}

/** 桥接渲染结果 */
export interface MaterialBridgeResult {
  /** 渲染后的 GPU 纹理 */
  texture: GPUTexture
  /** 纹理视图 */
  view: GPUTextureView
  /** 采样器 */
  sampler: GPUSampler
  /** 是否命中缓存 */
  cached: boolean
  /** 来源 materialId */
  materialId: string
}

// ============================================================================
// 2. MaterialRenderBridge 类
// ============================================================================

export class MaterialRenderBridge {
  /** 纹理缓存：materialId → MaterialTextureEntry */
  private textureCache = new Map<string, MaterialTextureEntry>()
  /** MaterialRuntime 实例（延迟创建，复用） */
  private materialRuntime: MaterialRuntime | null = null
  /** 当前 GPU 设备 */
  private device: GPUDevice | null = null
  /** 当前输出格式 */
  private format: GPUTextureFormat = 'rgba8unorm'

  // —— 设备管理 ——

  /**
   * 设置 GPU 设备。
   * 设备变化时清空所有缓存（旧纹理在新设备上无效）。
   */
  setDevice(device: GPUDevice | null, format?: GPUTextureFormat): void {
    if (this.device !== device) {
      this.disposeAllTextures()
      this.materialRuntime = null
    }
    this.device = device
    if (format) this.format = format
  }

  // —— 核心渲染接口 ——

  /**
   * 渲染材质为离屏 GPUTexture。
   *
   * 流程:
   * 1. 查缓存（materialId + graphHash + canvasSize 都匹配 → 直接返回）
   * 2. 有 MaterialGraph → 编译 → MaterialRuntime → 离屏 RenderPass
   * 3. 纯 PBR → Canvas 2D 绘制 → 上传为 GPUTexture
   * 4. 写入缓存
   *
   * @param asset  材质资产
   * @param canvasSize 目标画布尺寸（决定离屏纹理尺寸）
   * @returns 渲染结果（纹理 + 视图 + 采样器）
   */
  async renderMaterial(
    asset: MaterialAsset,
    canvasSize: { width: number; height: number },
  ): Promise<MaterialBridgeResult | null> {
    if (!this.device) {
      console.warn('[MaterialRenderBridge] GPU 设备未初始化')
      return null
    }

    console.log('[MaterialRenderBridge] 渲染材质:', asset.id, asset.name, 'graph:', !!asset.graph)

    // —— 1. 查缓存 ——
    const hasGraph = !!asset.graph
    const graphHash = hasGraph
      ? compileMaterialGraph(asset.graph!).hash
      : `pbr_${asset.id}`

    const cached = this.textureCache.get(asset.id)
    if (cached) {
      if (
        cached.graphHash === graphHash &&
        cached.canvasSize.width === canvasSize.width &&
        cached.canvasSize.height === canvasSize.height
      ) {
        return {
          texture: cached.texture,
          view: cached.view,
          sampler: cached.sampler,
          cached: true,
          materialId: asset.id,
        }
      }
      // hash 或尺寸变化 → 销毁旧纹理
      this.destroyTexture(asset.id)
    }

    // —— 2. 渲染 ——
    if (hasGraph) {
      const result = await this.renderProceduralMaterial(
        asset.graph!,
        asset.id,
        graphHash,
        canvasSize,
      )
      if (result) return result
      // 程序化渲染失败 → 降级到 PBR
      console.warn('[MaterialRenderBridge] 程序化材质渲染失败，降级到 PBR 预览')
    }

    // —— 3. 纯 PBR 或降级 ——
    return this.renderPBRMaterial(asset, graphHash, canvasSize)
  }

  // —— 程序化材质渲染（MaterialGraph → WGSL → GPU） ——

  private async renderProceduralMaterial(
    graph: MaterialGraph,
    materialId: string,
    graphHash: string,
    canvasSize: { width: number; height: number },
  ): Promise<MaterialBridgeResult | null> {
    if (!this.device) return null

    try {
      // 1. 编译 MaterialGraph → WGSL
      const compileResult = compileMaterialGraph(graph)

      // 2. 创建 / 复用 MaterialRuntime
      if (!this.materialRuntime) {
        this.materialRuntime = new MaterialRuntime({
          device: this.device,
          format: this.format,
          enableCache: true,
          enableValidation: true,
        })
      }

      // 3. 编译 pipeline
      const pipelineResult = await this.materialRuntime.compilePipeline(compileResult)

      // 4. 创建离屏渲染目标纹理
      const texture = this.device.createTexture({
        label: `material_bridge_${materialId}`,
        size: {
          width: canvasSize.width,
          height: canvasSize.height,
          depthOrArrayLayers: 1,
        },
        format: this.format,
        usage:
          TEXTURE_USAGE_RENDER_ATTACHMENT |
          TEXTURE_USAGE_TEXTURE_BINDING |
          TEXTURE_USAGE_COPY_SRC,
      })

      const view = texture.createView()
      const sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
      })

      // 5. 离屏 RenderPass
      const encoder = this.device.createCommandEncoder({
        label: `material_bridge_encoder_${materialId}`,
      })
      const pass = encoder.beginRenderPass({
        label: `material_bridge_pass_${materialId}`,
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(pipelineResult.pipeline)
      pass.draw(3, 1, 0, 0) // 全屏三角形
      pass.end()
      this.device.queue.submit([encoder.finish()])

      // 6. 写入缓存
      this.textureCache.set(materialId, {
        texture,
        view,
        sampler,
        graphHash,
        canvasSize: { ...canvasSize },
        isProcedural: true,
      })

      return {
        texture,
        view,
        sampler,
        cached: false,
        materialId,
      }
    } catch (e) {
      console.error('[MaterialRenderBridge] 程序化材质渲染失败:', e)
      return null
    }
  }

  // —— 纯 PBR 材质渲染（Canvas 2D → GPUTexture） ——

  private renderPBRMaterial(
    asset: MaterialAsset,
    graphHash: string,
    canvasSize: { width: number; height: number },
  ): MaterialBridgeResult | null {
    if (!this.device) return null

    // 1. 在小尺寸离屏 canvas 上渲染 PBR 球体（逐像素光照）
    // 使用 256×256 的正方形画布，保证球体比例正确
    // 之后用 drawImage 缩放到目标画布尺寸，避免大画布逐像素渲染的性能问题
    const SPHERE_RENDER_SIZE = 256
    const sphereCanvas = document.createElement('canvas')
    sphereCanvas.width = SPHERE_RENDER_SIZE
    sphereCanvas.height = SPHERE_RENDER_SIZE
    const sphereCtx = sphereCanvas.getContext('2d')
    if (!sphereCtx) return null

    const pbr = { ...DEFAULT_PBR_PARAMS, ...asset.pbr }
    renderSphereToCanvas(sphereCtx, SPHERE_RENDER_SIZE, SPHERE_RENDER_SIZE, pbr, null)

    // 2. 缩放到目标画布尺寸
    const thumbCanvas = document.createElement('canvas')
    thumbCanvas.width = canvasSize.width
    thumbCanvas.height = canvasSize.height
    const ctx = thumbCanvas.getContext('2d')
    if (!ctx) return null

    // 用 background color 填充背景（与球体背景一致）
    ctx.fillStyle = '#0d0d12'
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height)
    // 绘制球体（保持比例居中）
    ctx.drawImage(sphereCanvas, 0, 0, canvasSize.width, canvasSize.height)

    // 创建 GPUTexture 并上传像素
    const texture = this.device.createTexture({
      label: `material_bridge_pbr_${asset.id}`,
      size: {
        width: canvasSize.width,
        height: canvasSize.height,
        depthOrArrayLayers: 1,
      },
      format: this.format,
      usage:
        TEXTURE_USAGE_RENDER_ATTACHMENT |
        TEXTURE_USAGE_TEXTURE_BINDING |
        TEXTURE_USAGE_COPY_DST,
    })

    const view = texture.createView()
    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    })

    // 上传像素到 GPU
    const imageData = ctx.getImageData(0, 0, canvasSize.width, canvasSize.height)
    this.device.queue.writeTexture(
      { texture },
      imageData.data,
      { bytesPerRow: canvasSize.width * 4, rowsPerImage: canvasSize.height },
      { width: canvasSize.width, height: canvasSize.height },
    )

    this.textureCache.set(asset.id, {
      texture,
      view,
      sampler,
      graphHash,
      canvasSize: { ...canvasSize },
      isProcedural: false,
    })

    return {
      texture,
      view,
      sampler,
      cached: false,
      materialId: asset.id,
    }
  }

  // —— 查询接口 ——

  /**
   * 查询已渲染的材质纹理（不触发渲染）。
   * 用于在渲染前检查纹理是否已就绪。
   */
  getCachedTexture(materialId: string): MaterialTextureEntry | undefined {
    return this.textureCache.get(materialId)
  }

  // —— 生命周期管理 ——

  /** 销毁指定材质的纹理 */
  destroyTexture(materialId: string): void {
    const entry = this.textureCache.get(materialId)
    if (entry) {
      entry.texture.destroy()
      this.textureCache.delete(materialId)
    }
  }

  /** 销毁所有缓存纹理（设备丢失 / 场景切换时调用） */
  disposeAllTextures(): void {
    for (const [, entry] of this.textureCache) {
      entry.texture.destroy()
    }
    this.textureCache.clear()
  }

  /** 销毁桥接器（组件卸载时调用） */
  dispose(): void {
    this.disposeAllTextures()
    this.materialRuntime?.dispose()
    this.materialRuntime = null
    this.device = null
  }
}

// ============================================================================
// 3. 全局单例
// ============================================================================

/** 全局 MaterialRenderBridge 单例 */
let globalBridge: MaterialRenderBridge | null = null

/** 获取全局桥接器单例 */
export function getMaterialRenderBridge(): MaterialRenderBridge {
  if (!globalBridge) {
    globalBridge = new MaterialRenderBridge()
  }
  return globalBridge
}

/** 销毁全局桥接器（应用卸载时调用） */
export function disposeMaterialRenderBridge(): void {
  globalBridge?.dispose()
  globalBridge = null
}
