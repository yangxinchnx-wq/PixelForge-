import type { Asset } from './types'

/**
 * GPU 纹理缓存 —— 把 Asset 上传为 GPUTexture 并缓存。
 *
 * 设计原则:
 * - 同一 assetId 只上传一次,后续命中缓存直接返回
 * - Asset 被移除时自动销毁对应纹理
 * - 当 device 绑定后, register 会通过 createTexture + copyExternalImageToTexture 上传到 GPU
 * - 无 device 时仅记录元数据(测试环境降级)
 *
 * GPU 上传流程:
 *   register(asset)
 *     → 命中缓存? 返回缓存条目
 *     → device 可用?
 *         → createImageBitmap(asset.url)  把 blob URL 加载为 ImageBitmap
 *         → device.createTexture({ size, format, usage: TEXTURE_BINDING | COPY_DST })
 *         → device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, size)
 *         → cache.set(assetId, { texture, ... })
 *       : 仅记录元数据(无 GPU 纹理)
 */

/** 纹理缓存条目 */
export interface TextureCacheEntry {
  assetId: string
  /** GPU 纹理对象(device 可用时通过 createTexture 上传;否则 null) */
  texture: GPUTexture | null
  /** 纹理宽度 */
  width: number
  /** 纹理高度 */
  height: number
  /** 创建时间戳 */
  createdAt: number
}

/** 纹理使用标志(非浏览器环境 fallback) */
const TEXTURE_USAGE_BINDING = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.TEXTURE_BINDING : 0x0004
const TEXTURE_USAGE_COPY_DST = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.COPY_DST : 0x0008
const TEXTURE_USAGE_RENDER = typeof GPUTextureUsage !== 'undefined' ? GPUTextureUsage.RENDER_ATTACHMENT : 0x0010

/**
 * 纹理缓存管理器(单例,在模块内维护)。
 *
 * 用 Map 而非 Pinia store,因为:
 * - GPUTexture 不可序列化,不适合进 store state
 * - 缓存生命周期与 device 绑定,与 UI 状态分离
 */
export class TextureCache {
  private cache = new Map<string, TextureCacheEntry>()
  private device: GPUDevice | null = null

  /** 绑定 GPU device(在 runtime 初始化后调用) */
  bindDevice(device: GPUDevice): void {
    this.device = device
  }

  /**
   * 注册(或复用)一个 asset 对应的纹理。
   *
   * 当 device 已绑定时:
   * 1. 通过 createImageBitmap 把 asset.url (blob URL) 加载为 ImageBitmap
   * 2. 调用 device.createTexture 创建 GPUTexture
   * 3. 调用 device.queue.copyExternalImageToTexture 把 ImageBitmap 上传到纹理
   * 4. 缓存并返回条目
   *
   * 当 device 未绑定时(测试环境):
   * - 仅记录元数据, texture 字段为 null
   *
   * @param asset 要上传的资产
   * @returns 缓存条目(含 GPUTexture 或 null)
   */
  async register(asset: Asset): Promise<TextureCacheEntry | null> {
    // 命中缓存
    const cached = this.cache.get(asset.id)
    if (cached) return cached

    // 无 device: 占位实现,仅记录元数据
    if (!this.device) {
      const entry: TextureCacheEntry = {
        assetId: asset.id,
        texture: null,
        width: asset.width,
        height: asset.height,
        createdAt: Date.now(),
      }
      this.cache.set(asset.id, entry)
      return entry
    }

    // 有 device: 真实 GPU 上传
    try {
      const device = this.device

      // 1. 加载 ImageBitmap
      const response = await fetch(asset.url)
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)

      // 使用 bitmap 的实际尺寸(可能与 asset 元数据不同)
      const width = bitmap.width
      const height = bitmap.height

      // 2. 创建 GPUTexture
      const texture = device.createTexture({
        label: `asset-texture:${asset.name}:${asset.id}`,
        size: { width, height },
        format: 'rgba8unorm',
        usage: TEXTURE_USAGE_BINDING | TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_RENDER,
      })

      // 3. 上传 ImageBitmap 到 GPUTexture
      device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture },
        { width, height },
      )

      // 4. 关闭 ImageBitmap(已上传到 GPU,不再需要 CPU 端引用)
      bitmap.close()

      const entry: TextureCacheEntry = {
        assetId: asset.id,
        texture,
        width,
        height,
        createdAt: Date.now(),
      }
      this.cache.set(asset.id, entry)
      return entry
    } catch (e) {
      console.warn(`[textureCache] 上传纹理失败 (asset: ${asset.id}):`, e)
      // 降级: 返回无 GPU 纹理的条目
      const entry: TextureCacheEntry = {
        assetId: asset.id,
        texture: null,
        width: asset.width,
        height: asset.height,
        createdAt: Date.now(),
      }
      this.cache.set(asset.id, entry)
      return entry
    }
  }

  /** 获取缓存的纹理条目(不触发上传) */
  get(assetId: string): TextureCacheEntry | null {
    return this.cache.get(assetId) ?? null
  }

  /** 是否已缓存 */
  has(assetId: string): boolean {
    return this.cache.has(assetId)
  }

  /** 销毁单个纹理(Asset 被移除时调用) */
  dispose(assetId: string): void {
    const entry = this.cache.get(assetId)
    if (entry?.texture) {
      try {
        entry.texture.destroy()
      } catch (e) {
        console.warn('[textureCache] 销毁纹理失败:', e)
      }
    }
    this.cache.delete(assetId)
  }

  /** 销毁所有缓存(切换项目 / device 丢失时调用) */
  disposeAll(): void {
    for (const [, entry] of this.cache) {
      if (entry.texture) {
        try {
          entry.texture.destroy()
        } catch {
          // 忽略销毁错误
        }
      }
    }
    this.cache.clear()
  }

  /** 当前缓存数量 */
  get size(): number {
    return this.cache.size
  }

  /** 当前绑定的 device(供外部检查是否就绪) */
  get boundDevice(): GPUDevice | null {
    return this.device
  }
}

/** 全局单例(整个应用共享一个纹理缓存) */
export const textureCache = new TextureCache()
