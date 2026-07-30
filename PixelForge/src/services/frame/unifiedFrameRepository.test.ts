import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RuntimeFrameRecord } from '@/runtime/types'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'

// Mock unifiedStore，使用内存 Map 模拟
vi.mock('@/storage', () => {
  const metaStore = new Map<string, string>()
  return {
    unifiedStore: {
      writeMetadata: vi.fn(async (key: string, value: string) => {
        metaStore.set(key, value)
      }),
      readMetadata: vi.fn(async (key: string) => metaStore.get(key) ?? null),
      deleteMetadata: vi.fn(async (key: string) => {
        metaStore.delete(key)
      }),
      // 辅助方法供测试验证
      __metaStore: metaStore,
    },
  }
})

import { UnifiedFrameRepository } from './unifiedFrameRepository'
import { unifiedStore } from '@/storage'

// 获取 mock 的内部存储
const metaStore = (unifiedStore as unknown as { __metaStore: Map<string, string> }).__metaStore

/** 构造一条带 typed array 的帧记录 */
function makeFrame(frame: number): RuntimeFrameRecord {
  const artifact: RegionCompileArtifact = {
    schemaVersion: 'v1',
    descriptorData: new Uint32Array([1, 2, 3, 4]),
    auxData: new Float32Array([1.5, 2.5, 3.5]),
    regionData: new Float32Array([0.1, 0.2]),
    effectDescData: new Uint32Array([10, 20]),
    effectParamData: new Float32Array([0.5]),
    layerId: 'layer-1',
    opcode: 'Render' as never,
    layers: [],
    regions: [],
    effects: [],
    visibleLayerCount: 1,
    hasEffects: false,
  }

  return {
    frame,
    timestampMs: Date.now(),
    durationMs: 16.6,
    status: 'ready',
    scenario: 'test-scenario',
    layerId: 'layer-1',
    opcode: 'Render',
    patchId: null,
    patchSummary: null,
    canvasSize: { width: 1920, height: 1080 },
    outputFormat: 'rgba8unorm',
    error: null,
    artifact,
  }
}

describe('UnifiedFrameRepository', () => {
  let repo: UnifiedFrameRepository

  beforeEach(() => {
    metaStore.clear()
    repo = new UnifiedFrameRepository()
    // 清除 mock 调用记录
    vi.mocked(unifiedStore.writeMetadata).mockClear()
    vi.mocked(unifiedStore.readMetadata).mockClear()
    vi.mocked(unifiedStore.deleteMetadata).mockClear()
  })

  describe('基础读写', () => {
    it('upsertFrame / getFrame 同步读写', () => {
      const frame = makeFrame(1)
      repo.upsertFrame(frame)
      const got = repo.getFrame(1)
      expect(got).toBeDefined()
      expect(got!.frame).toBe(1)
    })

    it('getFrame 不存在返回 undefined', () => {
      expect(repo.getFrame(999)).toBeUndefined()
    })

    it('listFrames 按帧号升序', () => {
      repo.upsertFrame(makeFrame(3))
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(2))
      const list = repo.listFrames()
      expect(list.map((f) => f.frame)).toEqual([1, 2, 3])
    })

    it('listFrames 空列表', () => {
      expect(repo.listFrames()).toEqual([])
    })

    it('upsertFrame 覆盖同帧号', () => {
      repo.upsertFrame(makeFrame(1))
      const updated = makeFrame(1)
      updated.status = 'error'
      updated.error = 'compile failed'
      repo.upsertFrame(updated)
      const got = repo.getFrame(1)
      expect(got!.status).toBe('error')
      expect(got!.error).toBe('compile failed')
    })
  })

  describe('typed array 序列化', () => {
    it('artifact 中的 Uint32Array 正确序列化/反序列化', async () => {
      const frame = makeFrame(1)
      repo.upsertFrame(frame)
      await repo.flush()

      // 从底层存储读取 JSON，验证 marker 存在
      const json = metaStore.get('frame_record_1')
      expect(json).toBeDefined()
      expect(json!).toContain('__typed')
      expect(json!).toContain('Uint32Array')

      // 反序列化验证类型恢复
      const newRepo = new UnifiedFrameRepository()
      await newRepo.initialize()
      const got = newRepo.getFrame(1)
      expect(got).toBeDefined()
      expect(got!.artifact).toBeDefined()
      expect(got!.artifact!.descriptorData).toBeInstanceOf(Uint32Array)
      expect(Array.from(got!.artifact!.descriptorData)).toEqual([1, 2, 3, 4])
    })

    it('artifact 中的 Float32Array 正确序列化/反序列化', async () => {
      const frame = makeFrame(1)
      repo.upsertFrame(frame)
      await repo.flush()

      const newRepo = new UnifiedFrameRepository()
      await newRepo.initialize()
      const got = newRepo.getFrame(1)
      expect(got!.artifact!.auxData).toBeInstanceOf(Float32Array)
      expect(Array.from(got!.artifact!.auxData)).toEqual([1.5, 2.5, 3.5])
    })

    it('多帧 typed array 互不干扰', async () => {
      const f1 = makeFrame(1)
      f1.artifact!.descriptorData = new Uint32Array([100, 200])
      const f2 = makeFrame(2)
      f2.artifact!.descriptorData = new Uint32Array([300, 400, 500])
      repo.upsertFrame(f1)
      repo.upsertFrame(f2)
      await repo.flush()

      const newRepo = new UnifiedFrameRepository()
      await newRepo.initialize()
      expect(Array.from(newRepo.getFrame(1)!.artifact!.descriptorData)).toEqual([100, 200])
      expect(Array.from(newRepo.getFrame(2)!.artifact!.descriptorData)).toEqual([300, 400, 500])
    })
  })

  describe('持久化与初始化', () => {
    it('initialize 从持久层加载帧记录', async () => {
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(2))
      repo.upsertFrame(makeFrame(3))
      await repo.flush()

      // 新实例从持久层加载
      const newRepo = new UnifiedFrameRepository()
      await newRepo.initialize()
      expect(newRepo.listFrames()).toHaveLength(3)
      expect(newRepo.getFrame(1)).toBeDefined()
      expect(newRepo.getFrame(2)).toBeDefined()
      expect(newRepo.getFrame(3)).toBeDefined()
    })

    it('initialize 空持久层不报错', async () => {
      const newRepo = new UnifiedFrameRepository()
      await newRepo.initialize()
      expect(newRepo.listFrames()).toEqual([])
    })

    it('initialize 可多次调用（幂等）', async () => {
      repo.upsertFrame(makeFrame(1))
      await repo.flush()

      await repo.initialize()
      await repo.initialize()
      expect(repo.listFrames()).toHaveLength(1)
    })

    it('isPersistent 返回 true', () => {
      expect(repo.isPersistent()).toBe(true)
    })
  })

  describe('clear', () => {
    it('clear 清空内存缓存', () => {
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(2))
      repo.clear()
      expect(repo.listFrames()).toEqual([])
      expect(repo.getFrame(1)).toBeUndefined()
    })

    it('clear 异步清空持久层', async () => {
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(2))
      repo.clear()
      await repo.flush()

      // 持久层应为空
      const newRepo = new UnifiedFrameRepository()
      await newRepo.initialize()
      expect(newRepo.listFrames()).toEqual([])
    })

    it('clear 后帧号索引也被删除', async () => {
      repo.upsertFrame(makeFrame(1))
      await repo.flush()
      expect(metaStore.has('frame_index')).toBe(true)

      repo.clear()
      await repo.flush()
      expect(metaStore.has('frame_index')).toBe(false)
    })
  })

  describe('flush', () => {
    it('flush 等待所有挂起写入完成', async () => {
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(2))
      // flush 前，异步写入可能还在 pending
      await repo.flush()
      // 验证持久层有数据
      expect(metaStore.has('frame_record_1')).toBe(true)
      expect(metaStore.has('frame_record_2')).toBe(true)
      expect(metaStore.has('frame_index')).toBe(true)
    })

    it('flush 空仓库不报错', async () => {
      await expect(repo.flush()).resolves.toBeUndefined()
    })
  })

  describe('帧号索引', () => {
    it('索引包含所有帧号且排序', async () => {
      repo.upsertFrame(makeFrame(3))
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(2))
      await repo.flush()

      const indexJson = metaStore.get('frame_index')
      expect(indexJson).toBeDefined()
      const index = JSON.parse(indexJson!) as number[]
      expect(index).toEqual([1, 2, 3])
    })

    it('upsertFrame 后索引去重', async () => {
      repo.upsertFrame(makeFrame(1))
      repo.upsertFrame(makeFrame(1)) // 同帧号覆盖
      await repo.flush()

      const indexJson = metaStore.get('frame_index')
      const index = JSON.parse(indexJson!) as number[]
      expect(index).toEqual([1])
    })
  })
})
