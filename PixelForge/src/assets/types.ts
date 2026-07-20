/**
 * Asset 资源类型定义。
 *
 * Asset 是用户拖入 PixelForge 的外部资源(图片 / 纹理),作为 Layer 的输入源。
 *
 * 数据流:
 *   用户拖入图片
 *     → assetLoader.loadImage(file) → Asset
 *     → assetStore.add(asset)
 *     → assetToLayer(asset) → RenderIR Layer
 *     → runtime.applyPatch / push layer
 *     → GPU Texture (textureCache 上传)
 *     → Canvas 渲染
 *
 * 设计原则:
 * - Asset 与 Layer 解耦:Asset 是"资源库"中的项,Layer 是 RenderIR 的渲染节点
 * - 一个 Asset 可被多个 Layer 引用(通过 sourceRef)
 * - Asset.url 是 blob URL(运行时有效,不持久化);持久化时只存 name + size + dimensions
 */

/** 资源类型 */
export type AssetType = 'image' | 'texture'

/** 单个资源项 */
export interface Asset {
  /** 唯一 ID(UUIDv4) */
  id: string
  /** 显示名(默认用文件名,可重命名) */
  name: string
  /** 资源类型 */
  type: AssetType
  /** blob URL(运行时有效,刷新页面后失效) */
  url: string
  /** 原始宽度(px) */
  width: number
  /** 原始高度(px) */
  height: number
  /** 文件大小(字节) */
  size: number
  /** 创建时间戳 */
  createdAt: number
  /** 缩略图 dataURL(用于持久化展示,可选) */
  thumbnail?: string
  /** MIME 类型(如 'image/png') */
  mimeType: string
}

/** 资源导入选项 */
export interface LoadImageOptions {
  /** 是否生成缩略图(默认 true) */
  generateThumbnail?: boolean
  /** 缩略图最大宽度(默认 160px) */
  thumbnailMaxWidth?: number
}
