/**
 * PatchEngine 最小行为测试（freeze-1）
 *
 * 8 条核心 case，覆盖：
 *   A1  value patch 成功 + immutable
 *   A3  metadata patch 成功
 *   A5  atomic topology patch 成功
 *   B1  target not found throw
 *   B2  duplicate id throw
 *   B5  strict path 中间对象不存在 throw
 *   C1  batch 全成功
 *   C2  batch 失败回滚（同一引用）
 */

import { describe, it, expect } from 'vitest'

import { Opcode } from '../../../shared/types'

import { applyPatch } from '../patchEngine'
import { PatchError } from '../patch'

import type {
  AtomicLayerTopologyPatch,
  MetadataPatch,
  PatchBatch,
  StructuralPatch,
  ValuePatch,
} from '../patch'

import type { RenderIR } from '../renderIR'

// ============================================================================
// fixture
// ============================================================================

const baseIR: RenderIR = {
  canvas: { width: 1920, height: 1080 },
  layers: [
    {
      patchId: undefined as never,
      id: 'layer_1',
      opcode: Opcode.SOLID_COLOR,
      params: { color: [1, 0, 0, 1] },
      source: 'system_default',
      sourceRef: undefined,
      paramOwnership: {},
      visible: true,
    } as RenderIR['layers'][number],
  ],
  regions: [
    {
      id: 'region_1',
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      layerRefs: ['layer_1'],
      source: 'system_default',
    },
  ],
  effects: [],
  compileHints: { preferredProfile: 'region' },
}

const baseIR2: RenderIR = {
  ...baseIR,
  worldMetadata: { sceneGraphId: 'sg_root' },
}

const base = {
  source: 'user_patch' as const,
}

const validValuePatch = (overrides: Record<string, any> = {}): ValuePatch => ({
  patchId: 'patch_value_1',
  tier: 'value',
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  paramKey: 'color',
  value: [0, 1, 0, 1],
  ...overrides,
})

const validStructuralPatch = (
  overrides: Record<string, any> = {},
): StructuralPatch => ({
  patchId: 'patch_struct_1',
  tier: 'structural',
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  field: 'visible',
  value: false,
  ...overrides,
})

const validMetadataPatch = (
  overrides: Record<string, any> = {},
): MetadataPatch => ({
  patchId: 'patch_meta_1',
  tier: 'metadata',
  source: base.source,
  targetEntity: 'canvas',
  targetId: undefined,
  field: 'worldMetadata',
  value: { sceneGraphId: 'sg_new' },
  ...overrides,
})

const validAtomicLayerPatch = (
  overrides: Record<string, any> = {},
): AtomicLayerTopologyPatch => ({
  patchId: 'patch_atomic_layer_1',
  tier: 'topology',
  atomic: true,
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  newOpcode: Opcode.NOISE,
  newParams: { scale: 10 },
  ...overrides,
})

const validBatch = (
  patches: PatchBatch['patches'],
  tier?: PatchBatch['tier'],
): PatchBatch => ({
  patchId: 'patch_batch_1',
  tier: (tier ?? (
    patches.length === 0
      ? 'metadata'
      : patches.reduce(
          (max, p) => {
            const order = { value: 2, structural: 3, topology: 4, metadata: 1 }
            return order[(p as { tier: PatchBatch['tier'] }).tier] > order[max]
              ? (p as { tier: PatchBatch['tier'] }).tier
              : max
          },
          'metadata' as PatchBatch['tier'],
        )
  )) as PatchBatch['tier'],
  source: base.source,
  batch: true,
  patches,
})

// ============================================================================
// A. 单 patch 成功
// ============================================================================

describe('A. applyPatch 单 patch 成功', () => {
  it('A1 value patch 修改 layer.params + immutable', () => {
    const originalIr = baseIR
    const patch = validValuePatch({ value: [0, 1, 0, 1] })

    const outcome = applyPatch(originalIr, patch)

    // 返回新 ir，不是同一引用
    expect(outcome.ir).not.toBe(originalIr)
    // affectedScopes
    expect(outcome.affectedScopes).toEqual(['dynamic'])
    // appliedCount
    expect(outcome.appliedCount).toBe(1)
    // 新 layer.params 被替换
    expect(outcome.ir.layers[0].params).toEqual({ color: [0, 1, 0, 1] })
    // 非目标引用不变（regions / effects / canvas）
    expect(outcome.ir.regions).toBe(originalIr.regions)
    expect(outcome.ir.effects).toBe(originalIr.effects)
    expect(outcome.ir.canvas).toBe(originalIr.canvas)
    // 原始 ir 未被修改
    expect(originalIr.layers[0].params).toEqual({ color: [1, 0, 0, 1] })
  })

  it('A2 structural patch visible=false 修改 layer.visible + immutable', () => {
    const originalIr = baseIR
    const patch = validStructuralPatch({ field: 'visible', value: false })

    const outcome = applyPatch(originalIr, patch)

    // 返回新 ir，不是同一引用
    expect(outcome.ir).not.toBe(originalIr)
    // affectedScopes: structural + dynamic
    expect(outcome.affectedScopes).toEqual(['structural', 'dynamic'])
    // appliedCount
    expect(outcome.appliedCount).toBe(1)
    // 新 layer.visible 被替换
    expect(outcome.ir.layers[0].visible).toBe(false)
    // 非目标引用不变
    expect(outcome.ir.regions).toBe(originalIr.regions)
    expect(outcome.ir.effects).toBe(originalIr.effects)
    expect(outcome.ir.canvas).toBe(originalIr.canvas)
    // 原始 ir 未被修改
    expect(originalIr.layers[0].visible).toBe(true)
  })

  it('A4 structural patch blendMode=multiply 修改 layer.blendMode + immutable', () => {
    const originalIr = baseIR
    const patch = validStructuralPatch({ field: 'blendMode', value: 'multiply' })

    const outcome = applyPatch(originalIr, patch)

    // 返回新 ir，不是同一引用
    expect(outcome.ir).not.toBe(originalIr)
    // affectedScopes: structural + dynamic
    expect(outcome.affectedScopes).toEqual(['structural', 'dynamic'])
    // appliedCount
    expect(outcome.appliedCount).toBe(1)
    // 新 layer.blendMode 被设置
    expect(outcome.ir.layers[0].blendMode).toBe('multiply')
    // 非目标引用不变
    expect(outcome.ir.regions).toBe(originalIr.regions)
    expect(outcome.ir.effects).toBe(originalIr.effects)
    // 原始 ir 未被修改（baseIR.layers[0] 没有 blendMode 字段）
    expect(originalIr.layers[0].blendMode).toBeUndefined()
  })

  it('A3 metadata patch 修改 canvas.worldMetadata', () => {
    const originalIr = baseIR2
    const patch = validMetadataPatch()

    const outcome = applyPatch(originalIr, patch)

    expect(outcome.ir.worldMetadata).toEqual({ sceneGraphId: 'sg_new' })
    expect(outcome.affectedScopes).toEqual(['metadata'])
    expect(outcome.appliedCount).toBe(1)
    // 其余字段引用不变
    expect(outcome.ir.layers).toBe(originalIr.layers)
    expect(outcome.ir.regions).toBe(originalIr.regions)
    // 原始 ir 未被修改
    expect(originalIr.worldMetadata).toEqual({ sceneGraphId: 'sg_root' })
  })

  it('A5 atomic topology patch 同时替换 opcode + params', () => {
    const originalIr = baseIR
    const patch = validAtomicLayerPatch()

    const outcome = applyPatch(originalIr, patch)

    expect(outcome.ir.layers[0].opcode).toBe(Opcode.NOISE)
    expect(outcome.ir.layers[0].params).toEqual({ scale: 10 })
    expect(outcome.affectedScopes).toEqual([
      'topology',
      'structural',
      'dynamic',
    ])
    expect(outcome.appliedCount).toBe(1)
    // 原始 ir 未被修改
    expect(originalIr.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
  })
})

// ============================================================================
// B. 单 patch 失败 throw
// ============================================================================

describe('B. applyPatch 单 patch 失败 throw', () => {
  it('B1 value patch target 不存在 → IR_PATCH_TARGET_NOT_FOUND', () => {
    const patch = validValuePatch({ targetId: 'layer_nonexistent' })

    try {
      applyPatch(baseIR, patch)
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_TARGET_NOT_FOUND')
    }
  })

  it('B2 topology add 重复 id → IR_PATCH_DUPLICATE_ID', () => {
    const patch = {
      patchId: 'patch_top_add_1',
      tier: 'topology' as const,
      source: base.source,
      entity: 'layer' as const,
      op: 'add' as const,
      payload: {
        id: 'layer_1', // 已存在
        opcode: Opcode.SOLID_COLOR,
        params: {},
        source: 'user_patch' as const,
        paramOwnership: {},
        visible: true,
      },
    }

    try {
      applyPatch(baseIR, patch)
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_DUPLICATE_ID')
    }
  })

  it('B5 strict path 中间对象不存在 → IR_PATCH_PATH_NOT_ALLOWED', () => {
    // baseIR.layers[0].params = { color: [1,0,0,1] }
    // paramKey='noise.scale'，但 params.noise 不存在
    const patch = validValuePatch({ paramKey: 'noise.scale', value: 0.5 })

    try {
      applyPatch(baseIR, patch)
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_PATH_NOT_ALLOWED')
    }
  })
})

// ============================================================================
// C. batch 语义
// ============================================================================

describe('C. batch 语义', () => {
  it('C1 batch 全成功', () => {
    const patches: PatchBatch['patches'] = [
      validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }),
      validValuePatch({
        patchId: 'p2',
        paramKey: 'opacity',
        value: 0.5,
      }),
    ]
    const batch = validBatch(patches, 'value')

    const outcome = applyPatch(baseIR, batch)

    expect(outcome.errors).toBeUndefined()
    expect(outcome.appliedCount).toBe(2)
    expect(outcome.affectedScopes).toEqual(['dynamic'])
    // 最终 IR 同时包含两处变更
    expect(outcome.ir.layers[0].params).toEqual({
      color: [0, 1, 0, 1],
      opacity: 0.5,
    })
    // 原始 ir 未被修改
    expect(baseIR.layers[0].params).toEqual({ color: [1, 0, 0, 1] })
  })

  it('C2 batch 第二个 patch 失败 → 整批回滚（同一引用）', () => {
    // 第 1 个 patch：合法，会修改 layer_1.params.color
    // 第 2 个 patch：非法，targetId 不存在
    const patches: PatchBatch['patches'] = [
      validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }),
      validValuePatch({
        patchId: 'p2',
        targetId: 'layer_nonexistent',
        value: 0.5,
      }),
    ]
    const batch = validBatch(patches, 'value')

    const outcome = applyPatch(baseIR, batch)

    // 返回错误
    expect(outcome.errors).toBeDefined()
    expect(outcome.errors!.length).toBe(1)
    expect(outcome.errors![0]).toBeInstanceOf(PatchError)
    expect(outcome.errors![0].code).toBe('IR_PATCH_TARGET_NOT_FOUND')
    // violations 也应非空（调用方应同时检查 code 与 violations，见 PatchError 类注释）
    // 注意：apply 阶段 violations 格式是纯描述消息，不含错误码前缀（与 validator 阶段格式不同）
    expect(outcome.errors![0].violations.length).toBeGreaterThan(0)
    expect(outcome.errors![0].violations.some(v => v.includes('layer_nonexistent'))).toBe(true)
    // appliedCount = 0（整批回滚）
    expect(outcome.appliedCount).toBe(0)
    // ir 是原始输入的同一引用
    expect(outcome.ir).toBe(baseIR)
    // 第 1 个 patch 的变更未提交（原始 ir.layers[0].params 未变）
    expect(baseIR.layers[0].params).toEqual({ color: [1, 0, 0, 1] })
  })
})
