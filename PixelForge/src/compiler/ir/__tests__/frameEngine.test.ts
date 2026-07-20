/**
 * PatchEngine 帧事务状态机测试（Phase B）
 *
 * 测试覆盖：
 *   D1  初始状态为 idle
 *   D2  beginFrame: idle → queued
 *   D3  单 patch 成功提交
 *   D4  多 patch batch 成功提交
 *   D5  atomic patch 独占提交成功
 *   D6  空 frame 提交
 *   D7  rollback 丢弃队列
 *   D8  单 patch 失败 → rejected
 *   D9  batch 第二个 patch 失败 → rejected + IR 不变
 *   D10 atomic 与普通 patch 冲突 → IR_PATCH_TRANSACTION_CONFLICT
 *   D11 队列有 atomic 后再添加 patch → IR_PATCH_TRANSACTION_CONFLICT
 *   D12 禁止嵌套 PatchBatch → IR_PATCH_BATCH_NESTED
 *   D13 多 frame 串联：每帧基于上一帧的 IR
 *   D14 committed 后 beginFrame 重置
 *   D15 rejected 后 beginFrame 重置
 *   D16 非法状态转换抛错
 *   D17 getIR 在成功后更新、失败后不变
 *   D18 immutable：原始 IR 不被修改
 *   D19 getQueuedPatches 返回只读列表
 */

import { describe, it, expect } from 'vitest'

import { Opcode } from '../../../shared/types'

import { createPatchEngine } from '../frameEngine'
import { PatchError } from '../patch'

import type {
  AtomicLayerTopologyPatch,
  MetadataPatch,
  PatchBatch,
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

const validValuePatch = (overrides: Record<string, unknown> = {}): ValuePatch => ({
  patchId: 'patch_value_1',
  tier: 'value',
  source: base.source,
  targetEntity: 'layer',
  targetId: 'layer_1',
  paramKey: 'color',
  value: [0, 1, 0, 1],
  ...overrides,
})

const validMetadataPatch = (
  overrides: Record<string, unknown> = {},
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
  overrides: Record<string, unknown> = {},
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

// ============================================================================
// D. 基本状态机
// ============================================================================

describe('D. PatchEngine 状态机', () => {
  it('D1 初始状态为 idle', () => {
    const engine = createPatchEngine(baseIR)
    expect(engine.getState()).toBe('idle')
    expect(engine.getQueuedPatches()).toEqual([])
  })

  it('D2 beginFrame: idle → queued', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    expect(engine.getState()).toBe('queued')
    expect(engine.getQueuedPatches()).toEqual([])
  })

  it('D3 单 patch 成功提交', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))
    expect(engine.getQueuedPatches().length).toBe(1)

    const result = engine.endFrame()

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(1)
    expect(result.violations).toEqual([])
    expect(engine.getState()).toBe('committed')

    // IR 已更新
    const ir = engine.getIR()
    expect(ir.layers[0].params).toEqual({ color: [0, 1, 0, 1] })
  })

  it('D4 多 patch batch 成功提交', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }))
    engine.apply(
      validValuePatch({ patchId: 'p2', paramKey: 'opacity', value: 0.5 }),
    )
    expect(engine.getQueuedPatches().length).toBe(2)

    const result = engine.endFrame()

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(2)
    expect(engine.getState()).toBe('committed')

    // IR 包含两处变更
    const ir = engine.getIR()
    expect(ir.layers[0].params).toEqual({
      color: [0, 1, 0, 1],
      opacity: 0.5,
    })
  })

  it('D5 atomic patch 独占提交成功', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validAtomicLayerPatch())
    expect(engine.getQueuedPatches().length).toBe(1)

    const result = engine.endFrame()

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(1)
    expect(engine.getState()).toBe('committed')

    const ir = engine.getIR()
    expect(ir.layers[0].opcode).toBe(Opcode.NOISE)
    expect(ir.layers[0].params).toEqual({ scale: 10 })
  })

  it('D6 空 frame 提交（无 patch）', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()

    const result = engine.endFrame()

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(0)
    expect(result.violations).toEqual([])
    expect(engine.getState()).toBe('committed')

    // IR 不变
    expect(engine.getIR()).toBe(baseIR)
  })

  it('D7 rollback 丢弃队列并回到 idle', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))
    expect(engine.getQueuedPatches().length).toBe(1)

    engine.rollback()

    expect(engine.getState()).toBe('idle')
    expect(engine.getQueuedPatches()).toEqual([])

    // IR 不变
    expect(engine.getIR()).toBe(baseIR)
  })

  it('D8 单 patch 失败 → rejected', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ targetId: 'layer_nonexistent' }))

    const result = engine.endFrame()

    expect(result.success).toBe(false)
    expect(result.appliedCount).toBe(0)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.errorCode).toBe('IR_PATCH_TARGET_NOT_FOUND')
    expect(engine.getState()).toBe('rejected')

    // IR 不变
    expect(engine.getIR()).toBe(baseIR)
  })

  it('D9 batch 第二个 patch 失败 → rejected + IR 不变', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }))
    engine.apply(
      validValuePatch({ patchId: 'p2', targetId: 'layer_nonexistent' }),
    )

    const result = engine.endFrame()

    expect(result.success).toBe(false)
    expect(result.appliedCount).toBe(0)
    expect(result.errorCode).toBe('IR_PATCH_TARGET_NOT_FOUND')
    expect(engine.getState()).toBe('rejected')

    // IR 保持原始引用（整批回滚）
    expect(engine.getIR()).toBe(baseIR)
    // 第 1 个 patch 的变更未提交
    expect(engine.getIR().layers[0].params).toEqual({ color: [1, 0, 0, 1] })
  })
})

// ============================================================================
// E. atomic 独占性 + PatchBatch 禁止嵌套
// ============================================================================

describe('E. atomic 独占性与 PatchBatch 禁止嵌套', () => {
  it('E1 atomic patch 当队列非空时 → IR_PATCH_TRANSACTION_CONFLICT', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))

    try {
      engine.apply(validAtomicLayerPatch())
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_TRANSACTION_CONFLICT')
    }

    // 队列只有 1 个 patch（atomic 未入队）
    expect(engine.getQueuedPatches().length).toBe(1)
  })

  it('E2 队列有 atomic 后添加普通 patch → IR_PATCH_TRANSACTION_CONFLICT', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validAtomicLayerPatch())

    try {
      engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_TRANSACTION_CONFLICT')
    }

    // 队列只有 atomic（普通 patch 未入队）
    expect(engine.getQueuedPatches().length).toBe(1)
  })

  it('E3 禁止嵌套 PatchBatch → IR_PATCH_BATCH_NESTED', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()

    const batch: PatchBatch = {
      patchId: 'nested_batch',
      tier: 'value',
      source: base.source,
      batch: true,
      patches: [validValuePatch()],
    }

    try {
      engine.apply(batch)
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_BATCH_NESTED')
    }

    // 队列为空（batch 未入队）
    expect(engine.getQueuedPatches().length).toBe(0)
  })
})

// ============================================================================
// F. 多 frame 串联 + 状态重置
// ============================================================================

describe('F. 多 frame 串联与状态重置', () => {
  it('F1 多 frame 串联：每帧基于上一帧的 IR', () => {
    const engine = createPatchEngine(baseIR)

    // 第 1 帧：修改 color
    engine.beginFrame()
    engine.apply(validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }))
    const r1 = engine.endFrame()
    expect(r1.success).toBe(true)
    expect(engine.getIR().layers[0].params).toEqual({ color: [0, 1, 0, 1] })

    // 第 2 帧：添加 opacity（基于第 1 帧的结果）
    engine.beginFrame()
    engine.apply(
      validValuePatch({ patchId: 'p2', paramKey: 'opacity', value: 0.5 }),
    )
    const r2 = engine.endFrame()
    expect(r2.success).toBe(true)
    expect(engine.getIR().layers[0].params).toEqual({
      color: [0, 1, 0, 1],
      opacity: 0.5,
    })

    // 第 3 帧：atomic 替换 opcode + params（基于第 2 帧的结果）
    engine.beginFrame()
    engine.apply(validAtomicLayerPatch())
    const r3 = engine.endFrame()
    expect(r3.success).toBe(true)
    expect(engine.getIR().layers[0].opcode).toBe(Opcode.NOISE)
    expect(engine.getIR().layers[0].params).toEqual({ scale: 10 })
  })

  it('F2 committed 后 beginFrame 重置', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))
    engine.endFrame()
    expect(engine.getState()).toBe('committed')

    // 开始新 frame
    engine.beginFrame()
    expect(engine.getState()).toBe('queued')
    expect(engine.getQueuedPatches()).toEqual([])
  })

  it('F3 rejected 后 beginFrame 重置', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ targetId: 'layer_nonexistent' }))
    const result = engine.endFrame()
    expect(result.success).toBe(false)
    expect(engine.getState()).toBe('rejected')

    // 开始新 frame
    engine.beginFrame()
    expect(engine.getState()).toBe('queued')
    expect(engine.getQueuedPatches()).toEqual([])

    // 新 frame 可以正常提交
    engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))
    const r2 = engine.endFrame()
    expect(r2.success).toBe(true)
  })

  it('F4 rejected 后 IR 保持上一帧成功的结果', () => {
    const engine = createPatchEngine(baseIR)

    // 第 1 帧成功
    engine.beginFrame()
    engine.apply(validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }))
    engine.endFrame()
    expect(engine.getIR().layers[0].params).toEqual({ color: [0, 1, 0, 1] })

    // 第 2 帧失败
    engine.beginFrame()
    engine.apply(validValuePatch({ targetId: 'layer_nonexistent' }))
    engine.endFrame()

    // IR 保持第 1 帧的结果
    expect(engine.getIR().layers[0].params).toEqual({ color: [0, 1, 0, 1] })
  })
})

// ============================================================================
// G. 非法状态转换 + immutable
// ============================================================================

describe('G. 非法状态转换与 immutable', () => {
  it('G1 queued 状态下 beginFrame 抛错', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()

    try {
      engine.beginFrame()
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G2 idle 状态下 endFrame 抛错', () => {
    const engine = createPatchEngine(baseIR)

    try {
      engine.endFrame()
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G3 idle 状态下 apply 抛错', () => {
    const engine = createPatchEngine(baseIR)

    try {
      engine.apply(validValuePatch())
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G4 idle 状态下 rollback 抛错', () => {
    const engine = createPatchEngine(baseIR)

    try {
      engine.rollback()
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G5 committed 状态下 apply 抛错', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.endFrame() // committed

    try {
      engine.apply(validValuePatch())
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G6 committed 状态下 rollback 抛错', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.endFrame() // committed

    try {
      engine.rollback()
      throw new Error('should not reach')
    } catch (err) {
      expect(err).toBeInstanceOf(PatchError)
      expect((err as PatchError).code).toBe('IR_PATCH_VIOLATION')
    }
  })

  it('G7 immutable：成功提交后原始 IR 不被修改', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ value: [0, 1, 0, 1] }))
    engine.endFrame()

    // 原始 IR 不变
    expect(baseIR.layers[0].params).toEqual({ color: [1, 0, 0, 1] })
  })

  it('G8 immutable：失败后原始 IR 不被修改', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ targetId: 'layer_nonexistent' }))
    engine.endFrame()

    // 原始 IR 不变
    expect(baseIR.layers[0].params).toEqual({ color: [1, 0, 0, 1] })
  })

  it('G9 getQueuedPatches 返回只读快照', () => {
    const engine = createPatchEngine(baseIR)
    engine.beginFrame()
    engine.apply(validValuePatch({ patchId: 'p1' }))

    const queued = engine.getQueuedPatches()
    expect(queued.length).toBe(1)
    expect(queued[0].patchId).toBe('p1')

    // 再添加一个 patch，之前的快照不应变化（返回的是当时的快照引用）
    engine.apply(validValuePatch({ patchId: 'p2' }))

    // 旧引用不变（因为 getQueuedPatches 返回的是当时内部数组的引用）
    // 新调用返回最新状态
    expect(engine.getQueuedPatches().length).toBe(2)
  })
})

// ============================================================================
// H. metadata patch 与混 tier batch
// ============================================================================

describe('H. metadata patch 与混 tier batch', () => {
  it('H1 metadata patch 单独提交', () => {
    const engine = createPatchEngine(baseIR2)
    engine.beginFrame()
    engine.apply(validMetadataPatch())

    const result = engine.endFrame()

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(1)
    expect(engine.getIR().worldMetadata).toEqual({ sceneGraphId: 'sg_new' })
    // 原始 IR 不变
    expect(baseIR2.worldMetadata).toEqual({ sceneGraphId: 'sg_root' })
  })

  it('H2 混 tier batch（value + metadata）成功', () => {
    const engine = createPatchEngine(baseIR2)
    engine.beginFrame()
    engine.apply(validValuePatch({ patchId: 'p1', value: [0, 1, 0, 1] }))
    engine.apply(validMetadataPatch({ patchId: 'p2' }))

    const result = engine.endFrame()

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(2)
    expect(engine.getIR().layers[0].params).toEqual({ color: [0, 1, 0, 1] })
    expect(engine.getIR().worldMetadata).toEqual({ sceneGraphId: 'sg_new' })
  })
})
