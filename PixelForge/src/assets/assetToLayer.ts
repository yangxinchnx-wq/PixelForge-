import type { Layer } from '@/compiler/ir/renderIR'
import { Opcode } from '@/shared/types'
import type { JsonLiteral } from '@/shared/types'

import type { Asset } from './types'

/**
 * 把 Asset 转换为 RenderIR Layer。
 *
 * 数据流:
 *   Asset (资源库项)
 *     → assetToLayer(asset, options)
 *     → Layer { opcode: IMAGE_TEXTURE, source: 'user_prompt', sourceRef: asset.id, params: {...} }
 *     → runtime.currentIr.layers.push(layer) 或 applyPatch(add)
 *     → RegionCompiler 编译(后续支持 IMAGE_TEXTURE opcode)
 *     → GPU Texture (textureCache 上传)
 *     → Canvas 渲染
 *
 * 设计原则:
 * - Layer.sourceRef = asset.id(建立引用关系,便于 Asset 删除时清理 Layer)
 * - Layer.params 包含:textureId / opacity / position / scale
 * - 不直接修改 RenderIR,只返回 Layer 对象(由调用方决定如何插入)
 */

export interface AssetToLayerOptions {
  /** 透明度(0-1,默认 1) */
  opacity?: number
  /** 归一化 X 位置(0-1,默认 0.5 居中) */
  positionX?: number
  /** 归一化 Y 位置(0-1,默认 0.5 居中) */
  positionY?: number
  /** 缩放(0-1 相对画布,默认按图片宽高比适配) */
  scale?: number
  /** blend mode(默认 'normal') */
  blendMode?: Layer['blendMode']
}

/**
 * 把 Asset 转成 IMAGE_TEXTURE Layer。
 *
 * @param asset 资源库中的项
 * @param options 可选的位置 / 透明度 / 缩放
 * @returns 新的 Layer 对象(未插入 RenderIR)
 */
export function assetToLayer(asset: Asset, options: AssetToLayerOptions = {}): Layer {
  const {
    opacity = 1,
    positionX = 0.5,
    positionY = 0.5,
    scale = 1,
    blendMode = 'normal',
  } = options

  // 计算适配画布的归一化尺寸(保持图片宽高比)
  // 假设画布 1024x768,图片按短边适配
  const aspectRatio = asset.width / asset.height
  const canvasAspect = 1024 / 768
  let normalizedWidth: number
  let normalizedHeight: number
  if (aspectRatio > canvasAspect) {
    // 图片更宽,按画布宽度适配
    normalizedWidth = scale
    normalizedHeight = scale * (canvasAspect / aspectRatio)
  } else {
    // 图片更高,按画布高度适配
    normalizedHeight = scale
    normalizedWidth = scale * (aspectRatio / canvasAspect)
  }

  const params: Record<string, JsonLiteral> = {
    textureId: asset.id,
    textureUrl: asset.url,
    opacity,
    position: [positionX, positionY] as JsonLiteral,
    size: [normalizedWidth, normalizedHeight] as JsonLiteral,
    rotation: 0,
  }

  return {
    id: genLayerId(asset.id),
    opcode: Opcode.IMAGE_TEXTURE,
    params,
    source: 'user_prompt',
    sourceRef: asset.id,
    paramOwnership: {},
    visible: true,
    blendMode,
  }
}

/**
 * 检查一个 Layer 是否引用了某个 Asset(通过 sourceRef)。
 * 用于 Asset 删除时联动移除 Layer。
 */
export function layerReferencesAsset(layer: Layer, assetId: string): boolean {
  return layer.sourceRef === assetId
}

/** 生成 Layer ID(基于 assetId 派生,便于追溯) */
function genLayerId(assetId: string): string {
  return `layer_image_${assetId.slice(0, 8)}`
}
