import { Opcode, type JsonLiteral } from '@/shared/types'
import type { RenderIR, Layer, Effect } from '@/compiler/ir/renderIR'

export type DemoScenario = 'gradient' | 'solid' | 'noise' | 'circle' | 'multi_layer' | 'blend_demo' | 'effect_demo'

export function createPhaseADemoIR(scenario: DemoScenario = 'gradient'): RenderIR {
  switch (scenario) {
    case 'multi_layer':
      return createMultiLayerIR()
    case 'blend_demo':
      return createBlendDemoIR()
    case 'effect_demo':
      return createEffectDemoIR()
    default:
      return createSingleLayerIR(scenario)
  }
}

export const demoScenarios: DemoScenario[] = ['gradient', 'solid', 'noise', 'circle', 'multi_layer', 'blend_demo', 'effect_demo']

// ============================================================================
// 单图层场景（向后兼容）
// ============================================================================

function createSingleLayerIR(scenario: DemoScenario): RenderIR {
  return {
    canvas: { width: 1024, height: 768 },
    layers: [createLayer(scenario)],
    regions: [],
    effects: [],
    compileHints: { preferredProfile: 'region' },
  }
}

function createLayer(scenario: DemoScenario): Layer {
  switch (scenario) {
    case 'solid':
      return {
        id: 'layer_solid',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [0.12, 0.56, 0.94, 1] as JsonLiteral },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }
    case 'noise':
      return {
        id: 'layer_noise',
        opcode: Opcode.NOISE,
        params: {
          scale: 18,
          amount: 0.92,
          colorA: [0.08, 0.11, 0.2, 1] as JsonLiteral,
          colorB: [0.82, 0.9, 1, 1] as JsonLiteral,
        },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }
    case 'circle':
      return {
        id: 'layer_circle',
        opcode: Opcode.CIRCLE_SHAPE,
        params: {
          center: [0.5, 0.52] as JsonLiteral,
          radius: 0.26,
          fill: [0.95, 0.73, 0.18, 1] as JsonLiteral,
          background: [0.06, 0.08, 0.1, 1] as JsonLiteral,
        },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }
    case 'gradient':
    default:
      return {
        id: 'layer_gradient',
        opcode: Opcode.LINEAR_GRADIENT,
        params: {
          from: [0, 0] as JsonLiteral,
          to: [1, 1] as JsonLiteral,
          colorA: [0.15, 0.35, 0.95, 1] as JsonLiteral,
          colorB: [0.92, 0.38, 0.66, 1] as JsonLiteral,
        },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      }
  }
}

// ============================================================================
// 多图层场景
// ============================================================================

function createMultiLayerIR(): RenderIR {
  const backgroundLayer: Layer = {
    id: 'layer_bg_gradient',
    opcode: Opcode.LINEAR_GRADIENT,
    params: {
      from: [0, 0] as JsonLiteral,
      to: [1, 1] as JsonLiteral,
      colorA: [0.05, 0.08, 0.15, 1] as JsonLiteral,
      colorB: [0.15, 0.1, 0.25, 1] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'normal',
  }

  const circleLayer: Layer = {
    id: 'layer_circle_overlay',
    opcode: Opcode.CIRCLE_SHAPE,
    params: {
      center: [0.5, 0.5] as JsonLiteral,
      radius: 0.22,
      fill: [0.95, 0.73, 0.18, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'normal',
  }

  const noiseLayer: Layer = {
    id: 'layer_noise_overlay',
    opcode: Opcode.NOISE,
    params: {
      scale: 32,
      amount: 0.3,
      colorA: [0.0, 0.0, 0.0, 0.0] as JsonLiteral,
      colorB: [1.0, 1.0, 1.0, 1.0] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'overlay',
  }

  return {
    canvas: { width: 1024, height: 768 },
    layers: [backgroundLayer, circleLayer, noiseLayer],
    regions: [],
    effects: [],
    compileHints: { preferredProfile: 'region' },
  }
}

// ============================================================================
// 混合演示场景
// ============================================================================

function createBlendDemoIR(): RenderIR {
  const baseLayer: Layer = {
    id: 'layer_blend_base',
    opcode: Opcode.SOLID_COLOR,
    params: { color: [0.15, 0.25, 0.45, 1] as JsonLiteral },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'normal',
  }

  const circleLayer1: Layer = {
    id: 'layer_blend_circle1',
    opcode: Opcode.CIRCLE_SHAPE,
    params: {
      center: [0.35, 0.5] as JsonLiteral,
      radius: 0.18,
      fill: [0.9, 0.2, 0.3, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'screen',
  }

  const circleLayer2: Layer = {
    id: 'layer_blend_circle2',
    opcode: Opcode.CIRCLE_SHAPE,
    params: {
      center: [0.65, 0.5] as JsonLiteral,
      radius: 0.18,
      fill: [0.2, 0.5, 0.9, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'screen',
  }

  const circleLayer3: Layer = {
    id: 'layer_blend_circle3',
    opcode: Opcode.CIRCLE_SHAPE,
    params: {
      center: [0.5, 0.65] as JsonLiteral,
      radius: 0.15,
      fill: [0.3, 0.9, 0.4, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'add',
  }

  return {
    canvas: { width: 1024, height: 768 },
    layers: [baseLayer, circleLayer1, circleLayer2, circleLayer3],
    regions: [],
    effects: [],
    compileHints: { preferredProfile: 'region' },
  }
}

// ============================================================================
// 效果演示场景
// ============================================================================

function createEffectDemoIR(): RenderIR {
  const gradientLayer: Layer = {
    id: 'layer_effect_bg',
    opcode: Opcode.LINEAR_GRADIENT,
    params: {
      from: [0, 0] as JsonLiteral,
      to: [1, 1] as JsonLiteral,
      colorA: [0.08, 0.12, 0.2, 1] as JsonLiteral,
      colorB: [0.2, 0.15, 0.35, 1] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'normal',
  }

  const circleLayer: Layer = {
    id: 'layer_effect_circle',
    opcode: Opcode.CIRCLE_SHAPE,
    params: {
      center: [0.5, 0.45] as JsonLiteral,
      radius: 0.2,
      fill: [0.95, 0.8, 0.3, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
    source: 'system_default',
    paramOwnership: {},
    visible: true,
    blendMode: 'normal',
  }

  const vignetteEffect: Effect = {
    id: 'effect_vignette',
    type: 'vignette',
    params: { strength: 0.6 },
    targetLayer: 'layer_effect_circle',
  }

  const bloomEffect: Effect = {
    id: 'effect_bloom',
    type: 'bloom',
    params: { threshold: 0.5, intensity: 0.4 },
    targetLayer: 'layer_effect_circle',
  }

  return {
    canvas: { width: 1024, height: 768 },
    layers: [gradientLayer, circleLayer],
    regions: [],
    effects: [vignetteEffect, bloomEffect],
    compileHints: { preferredProfile: 'region' },
  }
}
