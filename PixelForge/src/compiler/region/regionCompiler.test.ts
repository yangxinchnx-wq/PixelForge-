import { describe, expect, it } from 'vitest'

import { Opcode } from '@/shared/types'

import type { RenderIR, Layer, Region, Effect } from '@/compiler/ir/renderIR'
import { compileRenderIRToRegionArtifact, ARTIFACT_SCHEMA_VERSION_V2 } from './regionCompiler'

describe('区域工件编译器 V2', () => {
  function createBaseIR(layer: Layer): RenderIR {
    return {
      canvas: { width: 1024, height: 768 },
      layers: [layer],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }
  }

  function createGradientLayer(): Layer {
    return {
      id: 'layer_gradient',
      opcode: Opcode.LINEAR_GRADIENT,
      params: {
        from: [0, 0],
        to: [1, 1],
        colorA: [0.1, 0.2, 0.3, 1],
        colorB: [0.9, 0.8, 0.7, 1],
      },
      source: 'system_default',
      paramOwnership: {},
      visible: true,
      blendMode: 'normal',
    }
  }

  function expectFloatArrayClose(actual: Float32Array, expected: number[]) {
    expect(actual.length).toBeGreaterThanOrEqual(expected.length)
    Array.from(actual).slice(0, expected.length).forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index]!, 5)
    })
  }

  it('工件版本应为 v2', () => {
    const ir = createBaseIR(createGradientLayer())
    const artifact = compileRenderIRToRegionArtifact(ir)
    expect(artifact.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION_V2)
  })

  it('应编译线性渐变图层为正确工件', () => {
    const ir = createBaseIR(createGradientLayer())
    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.layerId).toBe('layer_gradient')
    expect(artifact.opcode).toBe('LINEAR_GRADIENT')
    expect(artifact.layers).toHaveLength(1)
    expect(artifact.layers[0].opcode).toBe('LINEAR_GRADIENT')
    expect(artifact.visibleLayerCount).toBe(1)

    // descriptorData 长度 = 2 * layerCount（无 layerCount 前缀，对齐骨架 §4.5）
    expect(artifact.descriptorData.length).toBe(2) // 1 layer * 2

    // 第一层的 auxData 应为渐变参数
    expectFloatArrayClose(artifact.layers[0].auxData, [
      0, 0, 1, 1,
      0.1, 0.2, 0.3, 1,
      0.9, 0.8, 0.7, 1,
    ])
  })

  it('应在参数缺失时回退到默认值', () => {
    const layer: Layer = {
      id: 'layer_noise',
      opcode: Opcode.NOISE,
      params: { scale: 'bad' as any },
      source: 'system_default',
      paramOwnership: {},
      visible: true,
      blendMode: 'normal',
    }
    const ir = createBaseIR(layer)
    const artifact = compileRenderIRToRegionArtifact(ir)

    expectFloatArrayClose(artifact.layers[0].auxData, [
      24, 1, 0, 0,
      0.08, 0.11, 0.2, 1,
      0.74, 0.85, 0.98, 1,
    ])
  })

  it('应跳过不可见图层', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [
        {
          id: 'hidden',
          opcode: Opcode.SOLID_COLOR,
          params: { color: [1, 0, 0, 1] },
          source: 'system_default',
          paramOwnership: {},
          visible: false,
          blendMode: 'normal',
        },
        {
          id: 'visible',
          opcode: Opcode.SOLID_COLOR,
          params: { color: [0, 1, 0, 1] },
          source: 'system_default',
          paramOwnership: {},
          visible: true,
          blendMode: 'normal',
        },
      ],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.visibleLayerCount).toBe(1)
    expect(artifact.layers[0].layerId).toBe('visible')
    expect(artifact.layerId).toBe('visible')
  })

  it('没有可见图层时应抛错', () => {
    const ir = createBaseIR({
      id: 'hidden-only',
      opcode: Opcode.SOLID_COLOR,
      params: { color: [1, 0, 0, 1] },
      source: 'system_default',
      paramOwnership: {},
      visible: false,
      blendMode: 'normal',
    })

    expect(() => compileRenderIRToRegionArtifact(ir)).toThrow('does not contain any visible layer')
  })

  it('BLEND 作为图层 opcode 应抛错', () => {
    const ir = createBaseIR({
      id: 'blend-layer',
      opcode: Opcode.BLEND,
      params: {},
      source: 'system_default',
      paramOwnership: {},
      visible: true,
      blendMode: 'normal',
    })

    expect(() => compileRenderIRToRegionArtifact(ir)).toThrow('BLEND opcode is no longer a layer opcode')
  })
})

describe('多图层编译', () => {
  function createVisibleLayer(id: string): Layer {
    return {
      id,
      opcode: Opcode.SOLID_COLOR,
      params: { color: [0.5, 0.5, 0.5, 1] },
      source: 'system_default',
      paramOwnership: {},
      visible: true,
      blendMode: 'normal',
    }
  }

  it('应编译多个可见图层', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [
        createVisibleLayer('layer_a'),
        createVisibleLayer('layer_b'),
        createVisibleLayer('layer_c'),
      ],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.visibleLayerCount).toBe(3)
    expect(artifact.layers).toHaveLength(3)
    expect(artifact.layers.map((l) => l.layerId)).toEqual(['layer_a', 'layer_b', 'layer_c'])
    expect(artifact.layers.map((l) => l.order)).toEqual([0, 1, 2])
  })

  it('应保留图层排序（底到顶）', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [
        { ...createVisibleLayer('bottom'), blendMode: 'normal' },
        { ...createVisibleLayer('middle'), blendMode: 'screen' },
        { ...createVisibleLayer('top'), blendMode: 'add' },
      ],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.layers[0].layerId).toBe('bottom')
    expect(artifact.layers[0].blendMode).toBe('normal')
    expect(artifact.layers[1].layerId).toBe('middle')
    expect(artifact.layers[1].blendMode).toBe('screen')
    expect(artifact.layers[2].layerId).toBe('top')
    expect(artifact.layers[2].blendMode).toBe('add')
  })

  it('混合模式应正确映射到 ID', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [
        { ...createVisibleLayer('normal_layer'), blendMode: 'normal' },
        { ...createVisibleLayer('multiply_layer'), blendMode: 'multiply' },
        { ...createVisibleLayer('screen_layer'), blendMode: 'screen' },
        { ...createVisibleLayer('overlay_layer'), blendMode: 'overlay' },
        { ...createVisibleLayer('add_layer'), blendMode: 'add' },
        { ...createVisibleLayer('subtract_layer'), blendMode: 'subtract' },
      ],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.layers[0].blendModeId).toBe(0)
    expect(artifact.layers[1].blendModeId).toBe(1)
    expect(artifact.layers[2].blendModeId).toBe(2)
    expect(artifact.layers[3].blendModeId).toBe(3)
    expect(artifact.layers[4].blendModeId).toBe(4)
    expect(artifact.layers[5].blendModeId).toBe(5)
  })

  it('拼接的 auxData 应包含所有图层参数', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [
        {
          id: 'layer_a',
          opcode: Opcode.SOLID_COLOR,
          params: { color: [0.1, 0.2, 0.3, 1] },
          source: 'system_default',
          paramOwnership: {},
          visible: true,
          blendMode: 'normal',
        },
        {
          id: 'layer_b',
          opcode: Opcode.SOLID_COLOR,
          params: { color: [0.4, 0.5, 0.6, 1] },
          source: 'system_default',
          paramOwnership: {},
          visible: true,
          blendMode: 'normal',
        },
      ],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    // 每层 solid color aux = 8 floats
    expect(artifact.auxData.length).toBeGreaterThanOrEqual(16)
    expect(artifact.auxData[0]).toBeCloseTo(0.1, 5)
    expect(artifact.auxData[8]).toBeCloseTo(0.4, 5)
  })
})

describe('区域编译', () => {
  it('应编译区域边界数据', () => {
    const region: Region = {
      id: 'region_top_left',
      bounds: { x: 0, y: 0, width: 0.5, height: 0.5 },
      layerRefs: ['layer_a'],
      source: 'system_default',
    }

    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [{
        id: 'layer_a',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }],
      regions: [region],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.regions).toHaveLength(1)
    expect(artifact.regions[0].regionId).toBe('region_top_left')
    expect(artifact.regionData[0]).toBe(0)      // x
    expect(artifact.regionData[1]).toBe(0)      // y
    expect(artifact.regionData[2]).toBe(0.5)    // width
    expect(artifact.regionData[3]).toBe(0.5)    // height
  })

  it('图层关联区域应正确设置 regionIndex', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [{
        id: 'layer_a',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }],
      regions: [{
        id: 'region_1',
        bounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        layerRefs: ['layer_a'],
        source: 'system_default',
      }],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.layers[0].regionIndex).toBe(0)
  })

  it('未关联区域的图层 regionIndex 应为 0xFFFF', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [{
        id: 'layer_a',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.layers[0].regionIndex).toBe(0xFFFF)
  })
})

describe('效果编译', () => {
  it('应编译效果参数', () => {
    const effect: Effect = {
      id: 'effect_blur',
      type: 'blur',
      params: { radius: 0.01 },
      targetLayer: 'layer_a',
    }

    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [{
        id: 'layer_a',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }],
      regions: [],
      effects: [effect],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.effects).toHaveLength(1)
    expect(artifact.effects[0].typeId).toBe(0) // blur = 0
    expect(artifact.hasEffects).toBe(true)
    expect(artifact.effectParamData[0]).toBeCloseTo(0.01, 5)
  })

  it('应编译多种效果类型', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [{
        id: 'layer_a',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }],
      regions: [],
      effects: [
        { id: 'e1', type: 'blur', params: { radius: 0.005 }, targetLayer: 'layer_a' },
        { id: 'e2', type: 'bloom', params: { threshold: 0.6, intensity: 0.5 }, targetLayer: 'layer_a' },
        { id: 'e3', type: 'vignette', params: { strength: 0.5 }, targetLayer: 'layer_a' },
        { id: 'e4', type: 'color_shift', params: { shift: 0.1 }, targetLayer: 'layer_a' },
        { id: 'e5', type: 'mask', params: { centerX: 0.5, centerY: 0.5, radius: 0.3 }, targetLayer: 'layer_a' },
      ],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.effects).toHaveLength(5)
    expect(artifact.effects.map((e) => e.typeId)).toEqual([0, 1, 3, 2, 4])
    expect(artifact.effectDescData[0]).toBe(5) // effectCount
  })

  it('无效果时 hasEffects 应为 false', () => {
    const ir: RenderIR = {
      canvas: { width: 1024, height: 768 },
      layers: [{
        id: 'layer_a',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    }

    const artifact = compileRenderIRToRegionArtifact(ir)

    expect(artifact.hasEffects).toBe(false)
    expect(artifact.effectDescData[0]).toBe(0)
  })
})
