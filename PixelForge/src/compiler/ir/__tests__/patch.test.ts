import { describe, it, expect } from 'vitest'

import { Opcode } from '../../../shared/types'

import type {
  AtomicEffectTopologyPatch,
  AtomicLayerTopologyPatch,
  MetadataPatch,
  PatchBatch,
  RenderIRPatch,
  StructuralPatch,
  TopologyPatch,
  ValuePatch,
} from '../patch'

import {
  PatchError,
  assertPatchValid,
  getAffectedCacheScopes,
  getBatchTier,
  isAtomicPatch,
  isAtomicTopologyPatch,
  isMetadataPatch,
  isPatchBatch,
  isPlainTopologyPatch,
  isStructuralPatch,
  isValuePatch,
  parseParamPath,
  validatePatch,
} from '../patch'

/**
 * 说明：
 * 1. 这份测试尽量只依赖 patch.ts 的运行时行为，不强绑具体 IR 实体类型定义。
 * 2. 若你的 patch.ts 导出的对象形状与这里略有出入，可按实际字段名微调 fixture。
 * 3. 重点先守住 freeze-1 的静态边界与 tier/batch 规则。
 */

type AnyRecord = Record<string, any>

const base = {
  source: 'user_patch' as const,
}

const validValuePatch = (overrides: AnyRecord = {}): ValuePatch => ({
  patchId: 'patch_value_1',
  tier: 'value',
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  paramKey: 'color',
  value: [0, 1, 0, 1],
  ...overrides,
})

const validStructuralPatch = (overrides: AnyRecord = {}): StructuralPatch => ({
  patchId: 'patch_struct_1',
  tier: 'structural',
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  field: 'visible',
  value: true,
  ...overrides,
})

const validMetadataPatch = (overrides: AnyRecord = {}): MetadataPatch => ({
  patchId: 'patch_meta_1',
  tier: 'metadata',
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  field: 'source',
  value: 'user_patch',
  ...overrides,
})

const validAtomicLayerPatch = (
  overrides: AnyRecord = {},
): AtomicLayerTopologyPatch => ({
  patchId: 'patch_atomic_layer_1',
  tier: 'topology',
  atomic: true,
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  newOpcode: Opcode.SOLID_COLOR,
  newParams: { color: [1, 0, 0, 1] },
  ...overrides,
})

const validAtomicEffectPatch = (
  overrides: AnyRecord = {},
): AtomicEffectTopologyPatch => ({
  patchId: 'patch_atomic_effect_1',
  tier: 'topology',
  atomic: true,
  source: base.source,
  targetEntity: 'effect',
  targetId: 'effect_1',
  newType: 'BLUR',
  newParams: { radius: 4 },
  ...overrides,
})

const validLayerPayload = (overrides: AnyRecord = {}) => ({
  id: 'layer_new_1',
  opcode: Opcode.SOLID_COLOR,
  params: { color: [1, 1, 1, 1] },
  source: 'user_patch' as const,
  paramOwnership: {},
  visible: true,
  ...overrides,
})

const validTopologyAddPatch = (overrides: AnyRecord = {}): TopologyPatch => ({
  patchId: 'patch_top_add_1',
  tier: 'topology',
  source: base.source,
  entity: 'layer',
  op: 'add',
  payload: validLayerPayload(),
  ...overrides,
})

const validTopologyRemovePatch = (overrides: AnyRecord = {}): TopologyPatch => ({
  patchId: 'patch_top_remove_1',
  tier: 'topology',
  source: base.source,
  entity: 'layer',
  targetId: 'layer_1',
  op: 'remove',
  ...overrides,
})

const validTopologyReplacePatch = (overrides: AnyRecord = {}): TopologyPatch => ({
  patchId: 'patch_top_replace_1',
  tier: 'topology',
  source: base.source,
  entity: 'layer',
  targetId: 'layer_1',
  op: 'replace',
  payload: validLayerPayload({ id: 'layer_1' }),
  ...overrides,
})

const validTopologyReorderPatch = (overrides: AnyRecord = {}): TopologyPatch => ({
  patchId: 'patch_top_reorder_1',
  tier: 'topology',
  source: base.source,
  entity: 'layer',
  op: 'reorder',
  payload: { newOrder: ['a', 'b', 'c'] },
  ...overrides,
})

const validBatch = (
  patches: RenderIRPatch[],
  tier?: PatchBatch['tier'],
): PatchBatch => ({
  patchId: 'patch_batch_1',
  tier: (tier ?? getBatchTier(patches)) as PatchBatch['tier'],
  source: base.source,
  batch: true,
  patches,
})

const getViolations = (patch: any): string[] => validatePatch(patch) ?? []

const expectNoViolation = (patch: any) => {
  expect(getViolations(patch)).toEqual([])
}

const expectHasViolation = (patch: any, code: string, text?: string) => {
  const violations = getViolations(patch)
  expect(violations.length).toBeGreaterThan(0)
  expect(violations.some(v => v.includes(code))).toBe(true)
  if (text) {
    expect(violations.some(v => v.includes(text))).toBe(true)
  }
}

describe('G1 type guards', () => {
  it('G1-1 ValuePatch 识别', () => {
    const patch = validValuePatch()
    expect(isValuePatch(patch)).toBe(true)
    expect(isStructuralPatch(patch)).toBe(false)
    expect(isPlainTopologyPatch(patch)).toBe(false)
    expect(isAtomicTopologyPatch(patch)).toBe(false)
    expect(isAtomicPatch(patch)).toBe(false)
    expect(isMetadataPatch(patch)).toBe(false)
    expect(isPatchBatch(patch)).toBe(false)
  })

  it('G1-2 StructuralPatch 识别', () => {
    const patch = validStructuralPatch()
    expect(isValuePatch(patch)).toBe(false)
    expect(isStructuralPatch(patch)).toBe(true)
    expect(isPlainTopologyPatch(patch)).toBe(false)
    expect(isAtomicTopologyPatch(patch)).toBe(false)
    expect(isMetadataPatch(patch)).toBe(false)
    expect(isPatchBatch(patch)).toBe(false)
  })

  it('G1-3 PlainTopologyPatch 识别', () => {
    const patch = validTopologyAddPatch()
    expect(isPlainTopologyPatch(patch)).toBe(true)
    expect(isAtomicTopologyPatch(patch)).toBe(false)
    expect(isAtomicPatch(patch)).toBe(false)
  })

  it('G1-4 AtomicLayerTopologyPatch 识别', () => {
    const patch = validAtomicLayerPatch()
    expect(isAtomicTopologyPatch(patch)).toBe(true)
    expect(isAtomicPatch(patch)).toBe(true)
    expect(isPlainTopologyPatch(patch)).toBe(false)
  })

  it('G1-5 AtomicEffectTopologyPatch 识别', () => {
    const patch = validAtomicEffectPatch()
    expect(isAtomicTopologyPatch(patch)).toBe(true)
    expect(isAtomicPatch(patch)).toBe(true)
    expect(isPlainTopologyPatch(patch)).toBe(false)
  })

  it('G1-6 MetadataPatch 识别', () => {
    const patch = validMetadataPatch()
    expect(isMetadataPatch(patch)).toBe(true)
    expect(isValuePatch(patch)).toBe(false)
    expect(isStructuralPatch(patch)).toBe(false)
    expect(isPlainTopologyPatch(patch)).toBe(false)
    expect(isPatchBatch(patch)).toBe(false)
  })

  it('G1-7 PatchBatch 识别', () => {
    const patch = validBatch([validValuePatch()])
    expect(isPatchBatch(patch)).toBe(true)
    expect(isValuePatch(patch)).toBe(false)
    expect(isStructuralPatch(patch)).toBe(false)
    expect(isPlainTopologyPatch(patch)).toBe(false)
    expect(isMetadataPatch(patch)).toBe(false)
  })

  it('G1-8 batch.tier=topology 不被误判为 topology patch', () => {
    const patch = validBatch([validValuePatch()], 'topology')
    expect(isPatchBatch(patch)).toBe(true)
    expect(isPlainTopologyPatch(patch)).toBe(false)
    expect(isAtomicTopologyPatch(patch)).toBe(false)
  })
})

describe('G2 getBatchTier', () => {
  it('G2-1 空数组返回 metadata', () => {
    expect(getBatchTier([])).toBe('metadata')
  })

  it('G2-2 全 value 返回 value', () => {
    expect(getBatchTier([validValuePatch(), validValuePatch({ patchId: 'p2' })])).toBe('value')
  })

  it('G2-3 value + structural 返回 structural', () => {
    expect(getBatchTier([validValuePatch(), validStructuralPatch()])).toBe('structural')
  })

  it('G2-4 metadata + value 返回 value', () => {
    expect(getBatchTier([validMetadataPatch(), validValuePatch()])).toBe('value')
  })

  it('G2-5 value + topology + metadata 返回 topology', () => {
    expect(getBatchTier([validValuePatch(), validTopologyAddPatch(), validMetadataPatch()])).toBe('topology')
  })
})

describe('G3 getAffectedCacheScopes', () => {
  it('G3-1 ValuePatch => dynamic', () => {
    expect(getAffectedCacheScopes(validValuePatch())).toEqual(['dynamic'])
  })

  it('G3-2 StructuralPatch => structural,dynamic', () => {
    expect(getAffectedCacheScopes(validStructuralPatch())).toEqual(['structural', 'dynamic'])
  })

  it('G3-3 PlainTopologyPatch => topology,structural,dynamic', () => {
    expect(getAffectedCacheScopes(validTopologyAddPatch())).toEqual(['topology', 'structural', 'dynamic'])
  })

  it('G3-4 AtomicTopologyPatch => topology,structural,dynamic', () => {
    expect(getAffectedCacheScopes(validAtomicLayerPatch())).toEqual(['topology', 'structural', 'dynamic'])
  })

  it('G3-5 MetadataPatch => metadata', () => {
    expect(getAffectedCacheScopes(validMetadataPatch())).toEqual(['metadata'])
  })

  it('G3-6 PatchBatch 取并集', () => {
    const scopes = getAffectedCacheScopes(validBatch([validValuePatch(), validMetadataPatch()]))
    expect(scopes).toEqual(expect.arrayContaining(['dynamic', 'metadata']))
    expect(scopes.length).toBe(2)
  })
})

describe('G4 validatePatch · ValuePatch', () => {
  it('G4-1 合法 value patch', () => {
    expectNoViolation(validValuePatch())
  })

  it('G4-2 patchId 空', () => {
    expectHasViolation(validValuePatch({ patchId: '' }), 'IR_PATCH_VIOLATION', 'patchId')
  })

  it('G4-3 patchId whitespace', () => {
    expectHasViolation(validValuePatch({ patchId: '   ' }), 'IR_PATCH_VIOLATION', 'patchId')
  })

  it('G4-4 targetId 空', () => {
    expectHasViolation(validValuePatch({ targetId: '' }), 'IR_PATCH_VIOLATION', 'targetId')
  })

  it('G4-5 paramKey 空', () => {
    expectHasViolation(validValuePatch({ paramKey: '' }), 'IR_PATCH_PATH_NOT_ALLOWED', 'paramKey')
  })

  it('G4-6 paramKey=id', () => {
    expectHasViolation(validValuePatch({ paramKey: 'id' }), 'IR_PATCH_PATH_NOT_ALLOWED', 'id')
  })

  it('G4-7 paramKey=opcode', () => {
    expectHasViolation(validValuePatch({ paramKey: 'opcode' }), 'IR_PATCH_PATH_NOT_ALLOWED', 'opcode')
  })

  it('G4-8 paramKey=visible', () => {
    expectHasViolation(validValuePatch({ paramKey: 'visible' }), 'IR_PATCH_PATH_NOT_ALLOWED', 'visible')
  })

  it('G4-9 paramKey=blendMode', () => {
    expectHasViolation(validValuePatch({ paramKey: 'blendMode' }), 'IR_PATCH_PATH_NOT_ALLOWED', 'blend')
  })

  it('G4-10 paramKey=noise.scale 合法', () => {
    expectNoViolation(validValuePatch({ paramKey: 'noise.scale', value: 0.5 }))
  })

  it('G4-11 value=Date', () => {
    expectHasViolation(validValuePatch({ value: new Date() }), 'IR_STATIC_BOUNDARY_VIOLATION')
  })

  it('G4-12 value=Map', () => {
    expectHasViolation(validValuePatch({ value: new Map([['a', 1]]) }), 'IR_STATIC_BOUNDARY_VIOLATION')
  })

  it('G4-13 value=undefined', () => {
    expectHasViolation(validValuePatch({ value: undefined }), 'IR_STATIC_BOUNDARY_VIOLATION')
  })

  it('G4-14 value=循环引用对象', () => {
    const obj: AnyRecord = {}
    obj.self = obj
    expectHasViolation(validValuePatch({ value: obj }), 'IR_STATIC_BOUNDARY_VIOLATION')
  })
})

describe('G5 validatePatch · StructuralPatch', () => {
  it('G5-1 visible=true 合法', () => {
    expectNoViolation(validStructuralPatch({ field: 'visible', value: true }))
  })

  it('G5-2 bounds 合法', () => {
    expectNoViolation(
      validStructuralPatch({
        field: 'bounds',
        value: { x: 0, y: 0, width: 1, height: 1 },
      }),
    )
  })

  it('G5-3 targetLayer=undefined 合法', () => {
    expectNoViolation(validStructuralPatch({ field: 'targetLayer', value: undefined }))
  })

  it('G5-4 targetLayer=string 合法', () => {
    expectNoViolation(validStructuralPatch({ field: 'targetLayer', value: 'layer_2' }))
  })

  it('G5-5 visible=string 非法', () => {
    expectHasViolation(
      validStructuralPatch({ field: 'visible', value: 'true' }),
      'IR_PATCH_INVALID_VALUE',
    )
  })

  it('G5-6 bounds 缺字段 非法', () => {
    expectHasViolation(
      validStructuralPatch({
        field: 'bounds',
        value: { x: 0, y: 0, width: 1 },
      }),
      'IR_PATCH_INVALID_VALUE',
    )
  })

  it('G5-7 bounds=null 非法', () => {
    expectHasViolation(validStructuralPatch({ field: 'bounds', value: null }), 'IR_PATCH_INVALID_VALUE')
  })

  it('G5-8 targetId 空', () => {
    expectHasViolation(validStructuralPatch({ targetId: '' }), 'IR_PATCH_VIOLATION', 'targetId')
  })

  it('G5-9 blendMode=multiply 合法', () => {
    expectNoViolation(validStructuralPatch({ field: 'blendMode', value: 'multiply' }))
  })

  it('G5-10 blendMode=invalid 非法', () => {
    expectHasViolation(
      validStructuralPatch({ field: 'blendMode', value: 'invalid' }),
      'IR_PATCH_INVALID_VALUE',
    )
  })

  it('G5-11 blendMode=123 非法(非字符串)', () => {
    expectHasViolation(
      validStructuralPatch({ field: 'blendMode', value: 123 }),
      'IR_PATCH_INVALID_VALUE',
    )
  })

  it('G5-12 blendMode=undefined 非法', () => {
    expectHasViolation(
      validStructuralPatch({ field: 'blendMode', value: undefined }),
      'IR_PATCH_INVALID_VALUE',
    )
  })
})

describe('G6 validatePatch · MetadataPatch', () => {
  it('G6-1 layer source 合法', () => {
    expectNoViolation(
      validMetadataPatch({
        targetEntity: 'layer',
        targetId: 'layer_1',
        field: 'source',
        value: 'user_patch',
      }),
    )
  })

  it('G6-2 region sourceRef 合法', () => {
    expectNoViolation(
      validMetadataPatch({
        targetEntity: 'region',
        targetId: 'region_1',
        field: 'sourceRef',
        value: 'ref_x',
      }),
    )
  })

  it('G6-3 canvas worldMetadata 合法', () => {
    expectNoViolation(
      validMetadataPatch({
        targetEntity: 'canvas',
        targetId: undefined,
        field: 'worldMetadata',
        value: { sceneGraphId: 'sg1' },
      }),
    )
  })

  it('G6-4 region 改 paramOwnership 非法', () => {
    expectHasViolation(
      validMetadataPatch({
        targetEntity: 'region',
        targetId: 'region_1',
        field: 'paramOwnership',
        value: {},
      }),
      'IR_PATCH_PATH_NOT_ALLOWED',
    )
  })

  it('G6-5 canvas 改 source 非法', () => {
    expectHasViolation(
      validMetadataPatch({
        targetEntity: 'canvas',
        targetId: undefined,
        field: 'source',
        value: 'x',
      }),
      'IR_PATCH_PATH_NOT_ALLOWED',
    )
  })

  it('G6-6 非 canvas targetId 空 非法', () => {
    expectHasViolation(
      validMetadataPatch({
        targetEntity: 'layer',
        targetId: '',
      }),
      'IR_PATCH_VIOLATION',
      'targetId',
    )
  })

  it('G6-7 canvas 无 targetId 合法', () => {
    expectNoViolation(
      validMetadataPatch({
        targetEntity: 'canvas',
        targetId: undefined,
        field: 'worldMetadata',
        value: { sceneGraphId: 'sg1' },
      }),
    )
  })
})

describe('G7 validatePatch · AtomicTopologyPatch', () => {
  it('G7-1 layer atomic 合法', () => {
    expectNoViolation(validAtomicLayerPatch())
  })

  it('G7-2 effect atomic 合法', () => {
    expectNoViolation(validAtomicEffectPatch())
  })

  it('G7-3 layer 缺 newOpcode', () => {
    const { newOpcode: _omit, ...patch } = validAtomicLayerPatch()
    void _omit
    expectHasViolation(patch, 'IR_PATCH_ATOMIC_INCOMPLETE', 'newOpcode')
  })

  it('G7-4 effect 缺 newType', () => {
    const { newType: _omit, ...patch } = validAtomicEffectPatch()
    void _omit
    expectHasViolation(patch, 'IR_PATCH_ATOMIC_INCOMPLETE', 'newType')
  })

  it('G7-5 缺 newParams', () => {
    const { newParams: _omit, ...patch } = validAtomicLayerPatch()
    void _omit
    expectHasViolation(patch, 'IR_PATCH_ATOMIC_INCOMPLETE', 'newParams')
  })

  it('G7-6 newParams 含 Date 非法', () => {
    expectHasViolation(
      validAtomicLayerPatch({
        newParams: { d: new Date() },
      }),
      'IR_PATCH_ATOMIC_INCOMPLETE',
    )
  })

  it('G7-7 targetId 空', () => {
    expectHasViolation(validAtomicLayerPatch({ targetId: '' }), 'IR_PATCH_VIOLATION', 'targetId')
  })

  it('G7-8 patchId 空', () => {
    expectHasViolation(validAtomicLayerPatch({ patchId: '' }), 'IR_PATCH_VIOLATION', 'patchId')
  })
})

describe('G8 validatePatch · TopologyPatch · add', () => {
  it('G8-1 合法 add', () => {
    expectNoViolation(validTopologyAddPatch())
  })

  it('G8-2 add 无 payload', () => {
    expectHasViolation(validTopologyAddPatch({ payload: undefined }), 'IR_PATCH_VIOLATION', 'payload')
  })

  it('G8-3 add payload 无 id', () => {
    const { id: _omit, ...payload } = validLayerPayload()
    void _omit
    expectHasViolation(validTopologyAddPatch({ payload }), 'IR_PATCH_VIOLATION', 'payload.id')
  })

  it('G8-4 add payload.id 空', () => {
    expectHasViolation(
      validTopologyAddPatch({
        payload: validLayerPayload({ id: '' }),
      }),
      'IR_PATCH_VIOLATION',
      'payload.id',
    )
  })

  it('G8-5 add 同时带 targetId', () => {
    expectHasViolation(validTopologyAddPatch({ targetId: 'x' }), 'IR_PATCH_VIOLATION', 'targetId')
  })
})

describe('G9 validatePatch · TopologyPatch · remove', () => {
  it('G9-1 合法 remove', () => {
    expectNoViolation(validTopologyRemovePatch())
  })

  it('G9-2 remove 无 targetId', () => {
    expectHasViolation(validTopologyRemovePatch({ targetId: '' }), 'IR_PATCH_VIOLATION', 'targetId')
  })

  it('G9-3 remove 带 payload', () => {
    expectHasViolation(
      validTopologyRemovePatch({
        payload: validLayerPayload(),
      }),
      'IR_PATCH_VIOLATION',
      'payload',
    )
  })
})

describe('G10 validatePatch · TopologyPatch · replace', () => {
  it('G10-1 合法 replace', () => {
    expectNoViolation(validTopologyReplacePatch())
  })

  it('G10-2 replace 无 targetId', () => {
    expectHasViolation(validTopologyReplacePatch({ targetId: '' }), 'IR_PATCH_VIOLATION', 'targetId')
  })

  it('G10-3 replace 无 payload', () => {
    expectHasViolation(validTopologyReplacePatch({ payload: undefined }), 'IR_PATCH_VIOLATION', 'payload')
  })

  it('G10-4 payload.id 与 targetId 不一致', () => {
    expectHasViolation(
      validTopologyReplacePatch({
        targetId: 'layer_1',
        payload: validLayerPayload({ id: 'layer_2' }),
      }),
      'IR_PATCH_VIOLATION',
      'match',
    )
  })
})

describe('G11 validatePatch · TopologyPatch · reorder', () => {
  it('G11-1 合法 reorder', () => {
    expectNoViolation(validTopologyReorderPatch())
  })

  it('G11-2 reorder 无 payload', () => {
    expectHasViolation(validTopologyReorderPatch({ payload: undefined }), 'IR_PATCH_VIOLATION', 'newOrder')
  })

  it('G11-3 payload 非 {newOrder}', () => {
    expectHasViolation(validTopologyReorderPatch({ payload: { ids: ['a'] } }), 'IR_PATCH_VIOLATION', 'newOrder')
  })

  it('G11-4 newOrder 含非字符串', () => {
    expectHasViolation(
      validTopologyReorderPatch({
        payload: { newOrder: ['a', 1, 'b'] },
      }),
      'IR_PATCH_INVALID_VALUE',
    )
  })

  it('G11-5 newOrder 含空字符串', () => {
    expectHasViolation(
      validTopologyReorderPatch({
        payload: { newOrder: ['a', '', 'b'] },
      }),
      'IR_PATCH_INVALID_VALUE',
    )
  })
})

describe('G12 validatePatch · PatchBatch', () => {
  it('G12-1 合法全 value', () => {
    const batch = validBatch([validValuePatch(), validValuePatch({ patchId: 'patch_value_2' })], 'value')
    expectNoViolation(batch)
  })

  it('G12-2 合法混 tier，最高 structural', () => {
    const batch = validBatch([validValuePatch(), validStructuralPatch()], 'structural')
    expectNoViolation(batch)
  })

  it('G12-3 metadata + value，最高为 value', () => {
    const batch = validBatch([validMetadataPatch(), validValuePatch()], 'value')
    expectNoViolation(batch)
  })

  it('G12-4 全 metadata', () => {
    const batch = validBatch(
      [validMetadataPatch(), validMetadataPatch({ patchId: 'patch_meta_2' })],
      'metadata',
    )
    expectNoViolation(batch)
  })

  it('G12-5 空 patches', () => {
    expectHasViolation(validBatch([], 'value'), 'IR_PATCH_VIOLATION', 'non-empty')
  })

  it('G12-6 含嵌套 PatchBatch', () => {
    const nested = validBatch([validValuePatch()], 'value')
    // 故意构造非法嵌套：把 batch 作为子 patch 塞入另一 batch
    const batch = {
      patchId: 'patch_batch_outer',
      tier: 'value' as const,
      source: base.source,
      batch: true as const,
      patches: [nested] as any[],
    }
    expectHasViolation(batch, 'IR_PATCH_BATCH_NESTED')
  })

  it('G12-7 含 AtomicTopologyPatch', () => {
    // 故意构造非法 batch：子 patch 是 atomic（应由 validatePatch 拒绝）
    const batch = {
      patchId: 'patch_batch_with_atomic',
      tier: 'topology' as const,
      source: base.source,
      batch: true as const,
      patches: [validAtomicLayerPatch()] as any[],
    }
    expectHasViolation(batch, 'IR_PATCH_TRANSACTION_CONFLICT')
  })

  it('G12-8 tier 与最高子 tier 不一致', () => {
    const batch = validBatch([validTopologyAddPatch()], 'value')
    expectHasViolation(batch, 'IR_PATCH_VIOLATION', 'tier')
  })

  it('G12-9 子 patch 非法透传带 patches[i] 前缀', () => {
    const batch = validBatch([validValuePatch({ paramKey: 'time' })], 'value')
    const violations = getViolations(batch)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some(v => v.includes('patches[0]'))).toBe(true)
    expect(violations.some(v => v.includes('IR_PATCH_PATH_NOT_ALLOWED'))).toBe(true)
  })
})

describe('G13 assertPatchValid + PatchError', () => {
  it('G13-1 合法 patch 不抛', () => {
    expect(() => assertPatchValid(validValuePatch())).not.toThrow()
  })

  it('G13-2 非法 patch 抛 PatchError', () => {
    expect(() => assertPatchValid(validValuePatch({ patchId: '' }))).toThrow(PatchError)
  })

  it('G13-3 PatchError instanceof Error', () => {
    try {
      assertPatchValid(validValuePatch({ patchId: '' }))
      throw new Error('should not reach')
    } catch (err) {
      expect(err instanceof Error).toBe(true)
    }
  })

  it('G13-4 PatchError.code === 第一个 errorCode', () => {
    try {
      assertPatchValid(validValuePatch({ patchId: '' }))
      throw new Error('should not reach')
    } catch (err: any) {
      expect(err).toBeInstanceOf(PatchError)
      expect(typeof err.code).toBe('string')
      expect(err.code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G13-5 PatchError.violations 非空', () => {
    try {
      assertPatchValid(validValuePatch({ patchId: '' }))
      throw new Error('should not reach')
    } catch (err: any) {
      expect(Array.isArray(err.violations)).toBe(true)
      expect(err.violations.length).toBeGreaterThan(0)
    }
  })

  it('G13-6 多 violation 时 code 只反映首个（设计契约固化）', () => {
    // 同时触发两个不同错误码：
    //   patchId 为空 → IR_PATCH_VIOLATION（validatePatch L603）
    //   value 为 Date 实例 → IR_STATIC_BOUNDARY_VIOLATION（validatePatch L679）
    // freeze-1 设计选择：assertPatchValid 从 violations[0] 提取 code（见 patch.ts extractErrorCode）
    // 本测试固化此契约：若未来改为"取最严重错误码"等策略，此测试会失败，提醒团队审视
    try {
      assertPatchValid(validValuePatch({ patchId: '', value: new Date() }))
      throw new Error('should not reach')
    } catch (err: any) {
      expect(err).toBeInstanceOf(PatchError)
      // violations 含至少 2 条，且含两个不同错误码
      expect(err.violations.length).toBeGreaterThanOrEqual(2)
      expect(err.violations.some((v: string) => v.includes('IR_PATCH_VIOLATION'))).toBe(true)
      expect(err.violations.some((v: string) => v.includes('IR_STATIC_BOUNDARY_VIOLATION'))).toBe(true)
      // code === violations[0] 中提取的错误码（证明 code 来自首个 violation）
      const firstCode = err.violations[0].match(/IR_[A-Z_]+/)?.[0]
      expect(err.code).toBe(firstCode)
    }
  })
})

describe('G14 parseParamPath', () => {
  it('G14-1 a.b.c => [a,b,c]', () => {
    expect(parseParamPath('a.b.c')).toEqual(['a', 'b', 'c'])
  })

  it('G14-2 空字符串 => null', () => {
    expect(parseParamPath('')).toBeNull()
  })

  it('G14-3 a..b => null', () => {
    expect(parseParamPath('a..b')).toBeNull()
  })

  it('G14-4 .a => null', () => {
    expect(parseParamPath('.a')).toBeNull()
  })

  it('G14-5 a. => null', () => {
    expect(parseParamPath('a.')).toBeNull()
  })
})

describe('G15 freeze-1 静态边界回归（核心）', () => {
  describe('15a ValuePatch 拒绝改静态字段', () => {
    const forbiddenKeys = [
      'time',
      'frame',
      'progress',
      'animated',
      'prevFrame',
      'historyBuffer',
      'script',
      'lambda',
      'id',
      'opcode',
    ]

    for (const key of forbiddenKeys) {
      it(`G15-forbidden ${key}`, () => {
        expectHasViolation(validValuePatch({ paramKey: key }), 'IR_PATCH_PATH_NOT_ALLOWED', key)
      })
    }
  })

  describe('15b ValuePatch.value 必须是 JsonLiteral', () => {
    it('G15-11 Date', () => {
      expectHasViolation(validValuePatch({ value: new Date() }), 'IR_STATIC_BOUNDARY_VIOLATION')
    })

    it('G15-12 Map', () => {
      expectHasViolation(validValuePatch({ value: new Map([['x', 1]]) }), 'IR_STATIC_BOUNDARY_VIOLATION')
    })

    it('G15-13 Set', () => {
      expectHasViolation(validValuePatch({ value: new Set([1, 2]) }), 'IR_STATIC_BOUNDARY_VIOLATION')
    })

    it('G15-14 undefined', () => {
      expectHasViolation(validValuePatch({ value: undefined }), 'IR_STATIC_BOUNDARY_VIOLATION')
    })

    it('G15-15 循环引用 object', () => {
      const obj: AnyRecord = { a: 1 }
      obj.self = obj
      expectHasViolation(validValuePatch({ value: obj }), 'IR_STATIC_BOUNDARY_VIOLATION')
    })

    it('G15-16 深度 > 16', () => {
      let root: AnyRecord = {}
      let cur = root
      for (let i = 0; i < 18; i += 1) {
        cur.next = {}
        cur = cur.next
      }
      expectHasViolation(validValuePatch({ value: root }), 'IR_STATIC_BOUNDARY_VIOLATION')
    })
  })

  describe('15c 跨 tier 边界不可串', () => {
    it('G15-17 ValuePatch 改 visible', () => {
      expectHasViolation(validValuePatch({ paramKey: 'visible' }), 'IR_PATCH_PATH_NOT_ALLOWED')
    })

    it('G15-18 ValuePatch 改 blendMode', () => {
      expectHasViolation(validValuePatch({ paramKey: 'blendMode' }), 'IR_PATCH_PATH_NOT_ALLOWED')
    })

    it('G15-19 ValuePatch 改 bounds', () => {
      expectHasViolation(validValuePatch({ paramKey: 'bounds' }), 'IR_PATCH_PATH_NOT_ALLOWED')
    })

    it('G15-20 ValuePatch 改 layerRefs', () => {
      expectHasViolation(validValuePatch({ paramKey: 'layerRefs' }), 'IR_PATCH_PATH_NOT_ALLOWED')
    })
  })
})
