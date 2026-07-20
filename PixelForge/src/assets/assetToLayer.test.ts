/**
 * Asset → Layer 转换器测试
 *
 * 测试覆盖:
 *   C1  assetToLayer 生成 IMAGE_TEXTURE opcode 的 Layer
 *   C2  assetToLayer 默认参数(opacity=1, position 居中, rotation=0)
 *   C3  assetToLayer 自定义参数生效(opacity/position/scale/blendMode)
 *   C4  assetToLayer 设置 sourceRef = asset.id(用于反向查找)
 *   C5  assetToLayer 设置 source = 'user_prompt'
 *   C6  assetToLayer 派生稳定 layer ID(包含 assetId 前缀)
 *   C7  assetToLayer params 包含 textureId / textureUrl(供 GPU 上传)
 *   C8  assetToLayer 适配画布尺寸(保持图片宽高比)
 *   C9  assetToLayer 默认 visible=true / blendMode='normal'
 *   C10 assetToLayer 多次调用生成独立 Layer(不共享引用)
 *   C11 layerReferencesAsset 通过 sourceRef 匹配
 *   C12 layerReferencesAsset 不匹配时返回 false
 *   C13 layerReferencesAsset 处理 sourceRef 为 undefined
 */

import { describe, expect, it } from 'vitest'

import { assetToLayer, layerReferencesAsset } from './assetToLayer'
import type { AssetToLayerOptions } from './assetToLayer'
import { Opcode } from '@/shared/types'

import type { Asset } from './types'

// ============================================================================
// fixture
// ============================================================================

function createAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'asset-001-uuid',
    name: 'test.png',
    type: 'image',
    url: 'blob:http://localhost/test',
    width: 512,
    height: 512,
    size: 1024 * 100,
    createdAt: 1700000000000,
    mimeType: 'image/png',
    ...overrides,
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('assetToLayer', () => {
  describe('基本属性', () => {
    it('C1 生成 IMAGE_TEXTURE opcode 的 Layer', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.opcode).toBe(Opcode.IMAGE_TEXTURE)
    })

    it('C2a 默认 opacity = 1', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.params.opacity).toBe(1)
    })

    it('C2b 默认 position 居中 (0.5, 0.5)', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.params.position).toEqual([0.5, 0.5])
    })

    it('C2c 默认 rotation = 0', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.params.rotation).toBe(0)
    })

    it('C3a 自定义 opacity 生效', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset, { opacity: 0.5 })

      expect(layer.params.opacity).toBe(0.5)
    })

    it('C3b 自定义 position 生效', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset, { positionX: 0.25, positionY: 0.75 })

      expect(layer.params.position).toEqual([0.25, 0.75])
    })

    it('C3c 自定义 blendMode 生效', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset, { blendMode: 'multiply' })

      expect(layer.blendMode).toBe('multiply')
    })
  })

  describe('引用关系', () => {
    it('C4 设置 sourceRef = asset.id', () => {
      const asset = createAsset({ id: 'asset-xyz' })
      const layer = assetToLayer(asset)

      expect(layer.sourceRef).toBe('asset-xyz')
    })

    it('C5 设置 source = "user_prompt"', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.source).toBe('user_prompt')
    })

    it('C6 派生 layer ID 包含 assetId 前缀(便于追溯)', () => {
      // genLayerId 取 assetId 前 8 字符
      const asset = createAsset({ id: 'asset-ab-12345' })
      const layer = assetToLayer(asset)

      expect(layer.id).toMatch(/^layer_image_/)
      expect(layer.id).toContain('asset-ab')
    })

    it('C7 params 包含 textureId / textureUrl', () => {
      const asset = createAsset({ id: 'tex-001', url: 'blob:http://test/u' })
      const layer = assetToLayer(asset)

      expect(layer.params.textureId).toBe('tex-001')
      expect(layer.params.textureUrl).toBe('blob:http://test/u')
    })
  })

  describe('尺寸适配', () => {
    it('C8a 方形图片适配 4:3 画布(scale=1,按高度适配)', () => {
      // asset 512x512(方形),canvas 1024x768(4:3)
      // 方形比 4:3 更高,按 canvas 高度适配
      // normalizedHeight = 1, normalizedWidth = 1 * (1 / (4/3)) = 0.75
      const asset = createAsset({ width: 512, height: 512 })
      const layer = assetToLayer(asset, { scale: 1 })

      const size = layer.params.size as [number, number]
      expect(size[1]).toBe(1)               // 高度填满
      expect(size[0]).toBeCloseTo(0.75, 5)  // 宽度 = 1 * (768/1024)
    })

    it('C8b 横向图片(2:1)适配 4:3 画布(按宽度适配)', () => {
      // asset 1024x512(2:1),canvas 1024x768(4:3)
      // aspectRatio = 2,canvasAspect = 4/3 ≈ 1.333
      // aspectRatio > canvasAspect → 按宽度适配
      // normalizedWidth = 1, normalizedHeight = 1 * (4/3 / 2) = 2/3 ≈ 0.667
      const asset = createAsset({ width: 1024, height: 512 })
      const layer = assetToLayer(asset, { scale: 1 })

      const size = layer.params.size as [number, number]
      expect(size[0]).toBe(1)                    // 宽度填满
      expect(size[1]).toBeCloseTo(2 / 3, 5)      // 高度按比例
    })

    it('C8c scale=0.5 缩小一半', () => {
      // 方形图片,scale=0.5
      // normalizedHeight = 0.5, normalizedWidth = 0.5 * 0.75 = 0.375
      const asset = createAsset({ width: 512, height: 512 })
      const layer = assetToLayer(asset, { scale: 0.5 })

      const size = layer.params.size as [number, number]
      expect(size[1]).toBe(0.5)
      expect(size[0]).toBeCloseTo(0.375, 5)
    })
  })

  describe('默认状态', () => {
    it('C9a 默认 visible = true', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.visible).toBe(true)
    })

    it('C9b 默认 blendMode = "normal"', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.blendMode).toBe('normal')
    })

    it('C9c 默认 paramOwnership 为空对象', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.paramOwnership).toEqual({})
    })
  })

  describe('独立性', () => {
    it('C10a 多次调用生成独立 Layer(不同 ID)', () => {
      const asset = createAsset({ id: 'asset-same' })
      const layer1 = assetToLayer(asset)
      const layer2 = assetToLayer(asset)

      // 同一 asset 派生的 ID 相同(稳定 ID 设计)
      // 但 params 对象不共享引用
      expect(layer1).not.toBe(layer2)
      expect(layer1.params).not.toBe(layer2.params)
    })

    it('C10b 修改一个 Layer 的 params 不影响另一个', () => {
      const asset = createAsset()
      const layer1 = assetToLayer(asset)
      const layer2 = assetToLayer(asset)

      ;(layer1.params.opacity as number) = 0.1
      expect(layer2.params.opacity).toBe(1)
    })

    it('C10c 不同 asset 生成不同 layer ID', () => {
      const asset1 = createAsset({ id: 'asset-aaa-111' })
      const asset2 = createAsset({ id: 'asset-bbb-222' })
      const layer1 = assetToLayer(asset1)
      const layer2 = assetToLayer(asset2)

      expect(layer1.id).not.toBe(layer2.id)
    })
  })

  describe('options 默认值合并', () => {
    it('空 options 使用全部默认值', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset, {} as AssetToLayerOptions)

      expect(layer.params.opacity).toBe(1)
      expect(layer.params.position).toEqual([0.5, 0.5])
      expect(layer.params.rotation).toBe(0)
      expect(layer.blendMode).toBe('normal')
    })

    it('undefined options 也使用全部默认值', () => {
      const asset = createAsset()
      const layer = assetToLayer(asset)

      expect(layer.params.opacity).toBe(1)
      expect(layer.params.position).toEqual([0.5, 0.5])
    })
  })
})

describe('layerReferencesAsset', () => {
  it('C11 sourceRef 匹配 assetId 时返回 true', () => {
    const asset = createAsset({ id: 'asset-match' })
    const layer = assetToLayer(asset)

    expect(layerReferencesAsset(layer, 'asset-match')).toBe(true)
  })

  it('C12 sourceRef 不匹配 assetId 时返回 false', () => {
    const asset = createAsset({ id: 'asset-one' })
    const layer = assetToLayer(asset)

    expect(layerReferencesAsset(layer, 'asset-other')).toBe(false)
  })

  it('C13a sourceRef 为 undefined 时返回 false', () => {
    const layer = {
      id: 'layer-x',
      opcode: Opcode.SOLID_COLOR,
      params: {},
      source: 'system_default' as const,
      paramOwnership: {},
      visible: true,
      // sourceRef 显式省略
    }

    expect(layerReferencesAsset(layer, 'any-asset')).toBe(false)
  })

  it('C13b sourceRef 为空字符串时返回 false(除非 assetId 也是空)', () => {
    const layer = {
      id: 'layer-x',
      opcode: Opcode.SOLID_COLOR,
      params: {},
      source: 'system_default' as const,
      sourceRef: '',
      paramOwnership: {},
      visible: true,
    }

    expect(layerReferencesAsset(layer, '')).toBe(true)
    expect(layerReferencesAsset(layer, 'x')).toBe(false)
  })
})
