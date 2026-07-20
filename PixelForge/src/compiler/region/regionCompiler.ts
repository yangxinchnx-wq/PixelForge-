import { Opcode, type BlendMode, type BoundingBox, type EffectType, type JsonLiteral } from '@/shared/types'
import type { Layer, RenderIR } from '@/compiler/ir/renderIR'
import { createRuntimeError } from '@/shared/errors'

// ============================================================================
// V2 工件结构
// ============================================================================

export const ARTIFACT_SCHEMA_VERSION_V2 = 'region-artifact-v2'

export type BlendModeId = 0 | 1 | 2 | 3 | 4 | 5

const BLEND_MODE_IDS: Record<BlendMode, BlendModeId> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  add: 4,
  subtract: 5,
}

export interface LayerCompileEntry {
  layerId: string
  opcode: keyof typeof Opcode
  opcodeId: number
  blendMode: BlendMode
  blendModeId: BlendModeId
  visible: boolean
  order: number
  regionIndex: number  // 0xFFFF = 无区域
  descriptorEntry: [number, number]  // [packedDesc, packedMeta]
  auxData: Float32Array
  auxOffset: number  // 在拼接 aux 缓冲区中的起始 vec4f 索引
}

export interface RegionCompileEntry {
  regionId: string
  bounds: BoundingBox
  layerRefs: string[]
  bufferIndex: number  // 在 regionBuffer 中的索引
}

export type EffectTypeId = 0 | 1 | 2 | 3 | 4

const EFFECT_TYPE_IDS: Record<string, EffectTypeId> = {
  blur: 0,
  bloom: 1,
  color_shift: 2,
  vignette: 3,
  mask: 4,
}

export interface EffectCompileEntry {
  effectId: string
  type: EffectType
  typeId: EffectTypeId
  targetLayer: string | null
  targetRegion: string | null
  paramData: Float32Array
  paramIndex: number  // 在 effectBuffer 中的起始 vec4f 索引
  descriptorEntry: [number, number]
}

export interface RegionCompileArtifact {
  schemaVersion: string
  // 拼接后的缓冲区数据（直接传给 GPU）
  descriptorData: Uint32Array
  auxData: Float32Array
  regionData: Float32Array
  effectDescData: Uint32Array
  effectParamData: Float32Array
  // v1 兼容字段（指向第一个图层）
  layerId: string
  opcode: keyof typeof Opcode
  // v2 结构化字段
  layers: LayerCompileEntry[]
  regions: RegionCompileEntry[]
  effects: EffectCompileEntry[]
  visibleLayerCount: number
  hasEffects: boolean
}

// ============================================================================
// 编译主函数
// ============================================================================

export function compileRenderIRToRegionArtifact(ir: RenderIR): RegionCompileArtifact {
  const visibleLayers = ir.layers.filter((l) => l.visible !== false)

  if (visibleLayers.length === 0) {
    throw createRuntimeError('runtime/compile-error', 'RenderIR does not contain any visible layer for rendering')
  }

  // 编译每个图层
  const layerEntries: LayerCompileEntry[] = []
  let auxOffset = 0

  for (let i = 0; i < visibleLayers.length; i++) {
    const layer = visibleLayers[i]
    const opcodeName = readOpcodeName(layer)
    const opcodeId = OPCODE_IDS[opcodeName]

    // BLEND 作为图层 opcode 不再支持（BLEND 通过 blendMode 实现）
    if (opcodeName === 'BLEND') {
      throw createRuntimeError('runtime/compile-error', `BLEND opcode is no longer a layer opcode; use blendMode on layers instead`)
    }

    const auxData = createAuxData(layer, opcodeName)
    const blendMode = layer.blendMode ?? 'normal'
    const blendModeId = BLEND_MODE_IDS[blendMode] ?? 0

    // 查找图层关联的区域
    let regionIndex = 0xFFFF
    for (let r = 0; r < ir.regions.length; r++) {
      if (ir.regions[r].layerRefs.includes(layer.id)) {
        regionIndex = r
        break
      }
    }

    const packedDesc = (opcodeId << 24) | (blendModeId << 16) | (auxOffset & 0xFFFF)
    const packedMeta = (regionIndex & 0xFFFF) | (0 << 16)

    layerEntries.push({
      layerId: layer.id,
      opcode: opcodeName,
      opcodeId,
      blendMode,
      blendModeId,
      visible: true,
      order: i,
      regionIndex,
      descriptorEntry: [packedDesc, packedMeta],
      auxData,
      auxOffset,
    })

    auxOffset += Math.ceil(auxData.length / 4)
  }

  // 编译区域
  const regionEntries: RegionCompileEntry[] = ir.regions.map((region, index) => ({
    regionId: region.id,
    bounds: region.bounds,
    layerRefs: [...region.layerRefs],
    bufferIndex: index,
  }))

  // 编译效果
  const effectEntries: EffectCompileEntry[] = []
  let effectParamOffset = 0

  for (const effect of ir.effects) {
    const typeId = EFFECT_TYPE_IDS[effect.type.toLowerCase()] ?? 0
    const paramData = createEffectParamData(effect)
    const targetLayer = effect.targetLayer ?? null
    const targetRegion = effect.targetRegion ?? null

    // 查找 targetRegion 在 ir.regions 中的索引（0xFFFF = 无区域限制）
    let targetRegionIndex = 0xFFFF
    if (targetRegion) {
      const idx = ir.regions.findIndex((r) => r.id === targetRegion)
      if (idx >= 0) {
        targetRegionIndex = idx
      }
    }

    const packedDesc = (typeId << 24) | (0 << 16) | (effectParamOffset & 0xFFFF)
    const packedMeta = targetRegionIndex & 0xFFFF

    effectEntries.push({
      effectId: effect.id,
      type: effect.type,
      typeId,
      targetLayer,
      targetRegion,
      paramData,
      paramIndex: effectParamOffset,
      descriptorEntry: [packedDesc, packedMeta],
    })

    effectParamOffset += Math.ceil(paramData.length / 4)
  }

  // 拼接描述符缓冲区: [layer0Desc, layer0Meta, layer1Desc, ...]（无 layerCount 前缀）
  // 对齐骨架 §4.5 迁移路径：descriptorBuffer 长度 = 2 * layerCount
  // layerCount 通过 Uniforms 传入（不在 descriptorBuffer 中）
  const descriptorData = new Uint32Array(layerEntries.length * 2)
  for (let i = 0; i < layerEntries.length; i++) {
    descriptorData[i * 2] = layerEntries[i].descriptorEntry[0]
    descriptorData[i * 2 + 1] = layerEntries[i].descriptorEntry[1]
  }

  // 拼接 aux 缓冲区
  const totalAuxFloats = layerEntries.reduce((sum, l) => sum + l.auxData.length, 0)
  const auxData = new Float32Array(Math.max(totalAuxFloats, 4))
  let auxWriteOffset = 0
  for (const entry of layerEntries) {
    auxData.set(entry.auxData, auxWriteOffset)
    auxWriteOffset += entry.auxData.length
  }

  // 拼接区域缓冲区: 每个 region 一个 vec4f
  const regionData = new Float32Array(Math.max(regionEntries.length * 4, 4))
  for (let i = 0; i < regionEntries.length; i++) {
    const b = regionEntries[i].bounds
    regionData[i * 4] = b.x
    regionData[i * 4 + 1] = b.y
    regionData[i * 4 + 2] = b.width
    regionData[i * 4 + 3] = b.height
  }

  // 拼接效果描述符和参数
  const effectDescData = new Uint32Array(Math.max(1 + effectEntries.length * 2, 1))
  effectDescData[0] = effectEntries.length
  for (let i = 0; i < effectEntries.length; i++) {
    effectDescData[1 + i * 2] = effectEntries[i].descriptorEntry[0]
    effectDescData[2 + i * 2] = effectEntries[i].descriptorEntry[1]
  }

  const totalEffectFloats = effectEntries.reduce((sum, e) => sum + e.paramData.length, 0)
  const effectParamData = new Float32Array(Math.max(totalEffectFloats, 4))
  let effectWriteOffset = 0
  for (const entry of effectEntries) {
    effectParamData.set(entry.paramData, effectWriteOffset)
    effectWriteOffset += entry.paramData.length
  }

  // v1 兼容字段
  const firstLayer = layerEntries[0]

  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION_V2,
    descriptorData,
    auxData,
    regionData,
    effectDescData,
    effectParamData,
    layerId: firstLayer.layerId,
    opcode: firstLayer.opcode,
    layers: layerEntries,
    regions: regionEntries,
    effects: effectEntries,
    visibleLayerCount: layerEntries.length,
    hasEffects: effectEntries.length > 0,
  }
}

// ============================================================================
// Opcode 映射
// ============================================================================

const OPCODE_IDS: Record<keyof typeof Opcode, number> = {
  SOLID_COLOR: Opcode.SOLID_COLOR,
  LINEAR_GRADIENT: Opcode.LINEAR_GRADIENT,
  NOISE: Opcode.NOISE,
  BLEND: Opcode.BLEND,
  CIRCLE_SHAPE: Opcode.CIRCLE_SHAPE,
  IMAGE_TEXTURE: Opcode.IMAGE_TEXTURE,
}

function readOpcodeName(layer: Layer): keyof typeof Opcode {
  const entry = Object.entries(Opcode).find(([, value]) => value === layer.opcode)
  if (!entry) {
    throw createRuntimeError('runtime/compile-error', `Unknown opcode value: ${layer.opcode}`)
  }
  return entry[0] as keyof typeof Opcode
}

// ============================================================================
// 图层参数编译
// ============================================================================

function createAuxData(layer: Layer, opcode: keyof typeof Opcode): Float32Array {
  switch (opcode) {
    case 'SOLID_COLOR':
      return createSolidColorAuxData(layer)
    case 'LINEAR_GRADIENT':
      return createLinearGradientAuxData(layer)
    case 'NOISE':
      return createNoiseAuxData(layer)
    case 'CIRCLE_SHAPE':
      return createCircleShapeAuxData(layer)
    default:
      throw createRuntimeError('runtime/compile-error', `Unsupported opcode: ${opcode}`)
  }
}

function createSolidColorAuxData(layer: Layer): Float32Array {
  const color = readColorVector(layer.params.color, [0.18, 0.55, 0.92, 1])
  return new Float32Array([color[0], color[1], color[2], color[3], 0, 0, 0, 0])
}

function createLinearGradientAuxData(layer: Layer): Float32Array {
  const from = readVec2(layer.params.from, [0, 0])
  const to = readVec2(layer.params.to, [1, 1])
  const colorA = readColorVector(layer.params.colorA, [0.1, 0.2, 0.9, 1])
  const colorB = readColorVector(layer.params.colorB, [0.85, 0.35, 0.6, 1])

  return new Float32Array([
    from[0], from[1], to[0], to[1],
    colorA[0], colorA[1], colorA[2], colorA[3],
    colorB[0], colorB[1], colorB[2], colorB[3],
  ])
}

function createNoiseAuxData(layer: Layer): Float32Array {
  const scale = readNumber(layer.params.scale, 24)
  const amount = readNumber(layer.params.amount, 1)
  const colorA = readColorVector(layer.params.colorA, [0.08, 0.11, 0.2, 1])
  const colorB = readColorVector(layer.params.colorB, [0.74, 0.85, 0.98, 1])

  return new Float32Array([
    scale, amount, 0, 0,
    colorA[0], colorA[1], colorA[2], colorA[3],
    colorB[0], colorB[1], colorB[2], colorB[3],
  ])
}

function createCircleShapeAuxData(layer: Layer): Float32Array {
  const center = readVec2(layer.params.center, [0.5, 0.5])
  const radius = readNumber(layer.params.radius, 0.25)
  const fill = readColorVector(layer.params.fill, [0.96, 0.72, 0.18, 1])
  const background = readColorVector(layer.params.background, [0.08, 0.09, 0.12, 1])

  return new Float32Array([
    center[0], center[1], radius, 0,
    fill[0], fill[1], fill[2], fill[3],
    background[0], background[1], background[2], background[3],
  ])
}

// ============================================================================
// 效果参数编译
// ============================================================================

function createEffectParamData(effect: { type: string; params: Record<string, JsonLiteral> }): Float32Array {
  const type = effect.type.toLowerCase()
  switch (type) {
    case 'blur': {
      const radius = readNumber(effect.params.radius, 0.005)
      return new Float32Array([radius, 0, 0, 0])
    }
    case 'bloom': {
      const threshold = readNumber(effect.params.threshold, 0.6)
      const intensity = readNumber(effect.params.intensity, 0.5)
      return new Float32Array([threshold, intensity, 0, 0])
    }
    case 'color_shift': {
      const shift = readNumber(effect.params.shift, 0.1)
      return new Float32Array([shift, 0, 0, 0])
    }
    case 'vignette': {
      const strength = readNumber(effect.params.strength, 0.5)
      return new Float32Array([strength, 0, 0, 0])
    }
    case 'mask': {
      const centerX = readNumber(effect.params.centerX, 0.5)
      const centerY = readNumber(effect.params.centerY, 0.5)
      const radius = readNumber(effect.params.radius, 0.3)
      return new Float32Array([centerX, centerY, radius, 0])
    }
    default: {
      // 未知效果类型：存储参数为 0
      return new Float32Array([0, 0, 0, 0])
    }
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

function readVec2(value: JsonLiteral | undefined, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    return fallback
  }
  return [readNumber(value[0], fallback[0]), readNumber(value[1], fallback[1])]
}

function readColorVector(value: JsonLiteral | undefined, fallback: [number, number, number, number]): [number, number, number, number] {
  if (!Array.isArray(value) || value.length < 4) {
    return fallback
  }
  return [
    readNumber(value[0], fallback[0]),
    readNumber(value[1], fallback[1]),
    readNumber(value[2], fallback[2]),
    readNumber(value[3], fallback[3]),
  ]
}

function readNumber(value: JsonLiteral | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
