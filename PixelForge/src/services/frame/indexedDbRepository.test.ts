import { beforeEach, describe, expect, it } from 'vitest'

import 'fake-indexeddb/auto'

import type { RuntimeFrameRecord } from '@/runtime/types'

import { IndexedDBFrameRepository } from './indexedDbRepository'
import { InMemoryFrameRepository } from './repository'

// ============================================================================
// 测试用帧记录工厂
// ============================================================================

function createTestRecord(frame: number, overrides: Partial<RuntimeFrameRecord> = {}): RuntimeFrameRecord {
  return {
    frame,
    timestampMs: 1000 + frame,
    durationMs: 2.5,
    status: 'ready',
    scenario: 'gradient',
    layerId: 'layer_gradient',
    opcode: 'LINEAR_GRADIENT',
    patchId: `patch-${frame}`,
    patchSummary: `colorA -> [0.1, 0.2, 0.3, 1]`,
    canvasSize: { width: 1024, height: 768 },
    outputFormat: 'rgba8unorm',
    error: null,
    artifactSchemaVersion: 'region-artifact-v2',
    artifact: {
      schemaVersion: 'region-artifact-v2',
      descriptorData: new Uint32Array([1, 0]),
      auxData: new Float32Array([0, 1, 1, 0]),
      regionData: new Float32Array([0, 0, 1, 1]),
      effectDescData: new Uint32Array([0]),
      effectParamData: new Float32Array([0, 0, 0, 0]),
      layerId: 'layer_gradient',
      opcode: 'LINEAR_GRADIENT',
      layers: [],
      regions: [],
      effects: [],
      visibleLayerCount: 1,
      hasEffects: false,
    },
    compileContextSnapshot: {
      canvasSize: { width: 1024, height: 768 },
      seed: 1337,
    },
    renderIrSnapshot: {
      canvas: { width: 1024, height: 768 },
      layers: [],
      regions: [],
      effects: [],
      compileHints: { preferredProfile: 'region' },
    },
    payload: {
      compileHints: { preferredProfile: 'region' },
    },
    ...overrides,
  }
}

// ============================================================================
// IndexedDBFrameRepository 测试
// ============================================================================

describe('IndexedDBFrameRepository', () => {
  let repo: IndexedDBFrameRepository

  beforeEach(async () => {
    // 每个测试前创建新的 repo 实例并初始化
    // 使用 clear + flush 重置数据，避免 deleteDatabase 被已打开的连接阻塞
    repo = new IndexedDBFrameRepository()
    await repo.initialize()
    repo.clear()
    await repo.flush()
  })

  it('初始化后应为持久化模式', () => {
    expect(repo.isPersistent()).toBe(true)
  })

  it('应同步写入和读取帧记录', () => {
    const record = createTestRecord(100)
    repo.upsertFrame(record)

    expect(repo.getFrame(100)).toEqual(record)
    expect(repo.listFrames()).toHaveLength(1)
  })

  it('应按帧号升序列出所有记录', () => {
    repo.upsertFrame(createTestRecord(103))
    repo.upsertFrame(createTestRecord(101))
    repo.upsertFrame(createTestRecord(102))

    const frames = repo.listFrames()
    expect(frames.map((f) => f.frame)).toEqual([101, 102, 103])
  })

  it('upsertFrame 应更新已存在的帧记录', () => {
    repo.upsertFrame(createTestRecord(100, { status: 'ready' }))
    repo.upsertFrame(createTestRecord(100, { status: 'error', error: '测试错误' }))

    const record = repo.getFrame(100)
    expect(record?.status).toBe('error')
    expect(record?.error).toBe('测试错误')
  })

  it('clear 应清空所有帧记录', () => {
    repo.upsertFrame(createTestRecord(100))
    repo.upsertFrame(createTestRecord(101))

    repo.clear()
    expect(repo.listFrames()).toHaveLength(0)
    expect(repo.getFrame(100)).toBeUndefined()
  })

  it('应在重新初始化后恢复持久化的帧记录', async () => {
    repo.upsertFrame(createTestRecord(100))
    repo.upsertFrame(createTestRecord(101))
    repo.upsertFrame(createTestRecord(102))

    // 等待异步写入完成
    await repo.flush()

    // 创建新实例模拟页面刷新
    const newRepo = new IndexedDBFrameRepository()
    await newRepo.initialize()

    const frames = newRepo.listFrames()
    expect(frames).toHaveLength(3)
    expect(frames.map((f) => f.frame)).toEqual([100, 101, 102])
  })

  it('应正确持久化和恢复 typed arrays', async () => {
    const record = createTestRecord(200, {
      artifact: {
        schemaVersion: 'region-artifact-v2',
        descriptorData: new Uint32Array([0x01020304, 0x05060708]),
        auxData: new Float32Array([1.5, 2.5, 3.5, 4.5]),
        regionData: new Float32Array([0.1, 0.2, 0.3, 0.4]),
        effectDescData: new Uint32Array([1, 2, 3]),
        effectParamData: new Float32Array([0.5, 0.6, 0.7, 0.8]),
        layerId: 'layer_test',
        opcode: 'SOLID_COLOR',
        layers: [],
        regions: [],
        effects: [],
        visibleLayerCount: 1,
        hasEffects: false,
      },
    })

    repo.upsertFrame(record)
    await repo.flush()

    const newRepo = new IndexedDBFrameRepository()
    await newRepo.initialize()

    const restored = newRepo.getFrame(200)
    expect(restored).toBeDefined()
    expect(restored!.artifact).toBeDefined()
    expect(Array.from(restored!.artifact!.descriptorData)).toEqual([0x01020304, 0x05060708])
    expect(Array.from(restored!.artifact!.auxData)).toEqual([1.5, 2.5, 3.5, 4.5])
    // Float32Array 精度容差比较（0.1 在 float32 中为 0.10000000149011612）
    const regionData = Array.from(restored!.artifact!.regionData)
    expect(regionData.length).toBe(4)
    expect(regionData[0]).toBeCloseTo(0.1, 5)
    expect(regionData[1]).toBeCloseTo(0.2, 5)
    expect(regionData[2]).toBeCloseTo(0.3, 5)
    expect(regionData[3]).toBeCloseTo(0.4, 5)
  })

  it('flush 应等待所有挂起的异步写入完成', async () => {
    repo.upsertFrame(createTestRecord(100))
    repo.upsertFrame(createTestRecord(101))
    repo.upsertFrame(createTestRecord(102))

    await repo.flush()

    // 验证所有记录已持久化
    const newRepo = new IndexedDBFrameRepository()
    await newRepo.initialize()
    expect(newRepo.listFrames()).toHaveLength(3)
  })

  it('clear 后持久化数据也应被清除', async () => {
    repo.upsertFrame(createTestRecord(100))
    repo.upsertFrame(createTestRecord(101))
    await repo.flush()

    repo.clear()
    await repo.flush()

    const newRepo = new IndexedDBFrameRepository()
    await newRepo.initialize()
    expect(newRepo.listFrames()).toHaveLength(0)
  })
})

// ============================================================================
// InMemoryFrameRepository 接口兼容性测试
// ============================================================================

describe('InMemoryFrameRepository 接口兼容性', () => {
  it('应实现 FrameRepository 全部方法', async () => {
    const repo = new InMemoryFrameRepository()

    // 新增方法
    await repo.initialize()
    expect(repo.isPersistent()).toBe(false)
    await repo.flush() // 不应抛出异常

    // 原有方法
    const record = createTestRecord(100)
    repo.upsertFrame(record)
    expect(repo.getFrame(100)).toEqual(record)
    expect(repo.listFrames()).toHaveLength(1)
    repo.clear()
    expect(repo.listFrames()).toHaveLength(0)
  })
})
