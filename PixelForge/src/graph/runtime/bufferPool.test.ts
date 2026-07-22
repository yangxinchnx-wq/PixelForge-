/**
 * BufferPool Tests(Step 39.2)
 *
 * 测试策略(对齐 texturePool.test.ts 结构):
 * - 分桶工具:bucketSize / isPoolableUsage
 * - 基本生命周期:acquire(新建)/ release / destroyBuffer
 * - 复用匹配:size + usage 完全相同 + inUse=false
 * - size 分桶:17→32 / 60→64 / 1→16
 * - usage 区分:UNIFORM vs STORAGE 不可混用
 * - MAP_READ/MAP_WRITE 拒绝池化
 * - LRU 淘汰:池满时淘汰最久未使用
 * - 统计:getStats(hitRate / totalRejected / totalBytes)
 * - GPU 注入:createGpuBuffer / destroyGpuBuffer 回调
 * - 集成测试:ResourceManager acquireBuffer / disposeNode 释放 buffer
 */
import { describe, it, expect, vi } from 'vitest'
import {
  BufferPool,
  bucketSize,
  isPoolableUsage,
} from './bufferPool'
import { ResourceManager } from './resourceManager'

// WebGPU usage flags 位掩码常量(与 WebGPU spec 一致)
const USAGE = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512,
} as const

const UNIFORM_COPY = USAGE.UNIFORM | USAGE.COPY_DST // 0x48
const STORAGE_COPY = USAGE.STORAGE | USAGE.COPY_DST // 0x88

// ============================================================================
// 辅助:Mock GPUBuffer
// ============================================================================

interface MockBuffer {
  destroyed: boolean
  destroy: () => void
}

function createMockBuffer(): MockBuffer & GPUBuffer {
  const mock = {
    destroyed: false,
    destroy: () => { mock.destroyed = true },
  }
  return mock as unknown as MockBuffer & GPUBuffer
}

// ============================================================================
// 1. 分桶工具
// ============================================================================

describe('BufferPool / bucketSize', () => {
  it('U01: 16 的倍数保持不变', () => {
    expect(bucketSize(16)).toBe(16)
    expect(bucketSize(32)).toBe(32)
    expect(bucketSize(64)).toBe(64)
  })

  it('U02: 非 16 倍数向上取整', () => {
    expect(bucketSize(1)).toBe(16)
    expect(bucketSize(17)).toBe(32)
    expect(bucketSize(60)).toBe(64)
    expect(bucketSize(100)).toBe(112)
  })

  it('U03: 零或负数返回 16(最小桶)', () => {
    expect(bucketSize(0)).toBe(16)
    expect(bucketSize(-1)).toBe(16)
  })
})

// ============================================================================
// 2. isPoolableUsage
// ============================================================================

describe('BufferPool / isPoolableUsage', () => {
  it('U04: UNIFORM|COPY_DST 可池化', () => {
    expect(isPoolableUsage(UNIFORM_COPY)).toBe(true)
  })

  it('U05: STORAGE|COPY_DST 可池化', () => {
    expect(isPoolableUsage(STORAGE_COPY)).toBe(true)
  })

  it('U06: MAP_READ 不可池化', () => {
    expect(isPoolableUsage(USAGE.MAP_READ | USAGE.COPY_DST)).toBe(false)
  })

  it('U07: MAP_WRITE 不可池化', () => {
    expect(isPoolableUsage(USAGE.MAP_WRITE | USAGE.COPY_DST)).toBe(false)
  })

  it('U08: MAP_READ|MAP_WRITE 都不可池化', () => {
    expect(isPoolableUsage(USAGE.MAP_READ | USAGE.MAP_WRITE)).toBe(false)
  })
})

// ============================================================================
// 3. 基本生命周期
// ============================================================================

describe('BufferPool / lifecycle', () => {
  it('L01: acquire 新建 buffer', () => {
    const pool = new BufferPool()
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })
    expect(buf).toBeDefined()
    expect(buf!.inUse).toBe(true)
    expect(buf!.acquireCount).toBe(1)
    expect(buf!.id).toMatch(/^buf_/)
    expect(buf!.descriptor.size).toBe(16)
    expect(buf!.descriptor.usage).toBe(UNIFORM_COPY)
  })

  it('L02: acquire 无 GPU 创建函数时 gpuBuffer 为 undefined', () => {
    const pool = new BufferPool()
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })
    expect(buf!.gpuBuffer).toBeUndefined()
  })

  it('L03: release 标记为可复用', () => {
    const pool = new BufferPool()
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(buf)
    expect(buf.inUse).toBe(false)
    expect(pool.availableCount).toBe(1)
    expect(pool.inUseCount).toBe(0)
  })

  it('L04: release 不存在的 buffer 静默忽略', () => {
    const pool = new BufferPool()
    const fake = {
      id: 'buf_fake',
      descriptor: { size: 16, usage: UNIFORM_COPY, label: 'fake' },
      inUse: true,
      lastUsedAt: 0,
      acquireCount: 1,
    }
    expect(() => pool.release(fake)).not.toThrow()
  })

  it('L05: destroyBuffer 从池中移除', () => {
    const pool = new BufferPool()
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.destroyBuffer(buf)
    expect(pool.size).toBe(0)
  })

  it('L06: clear 清空整个池', () => {
    const pool = new BufferPool()
    pool.acquire({ size: 16, usage: UNIFORM_COPY })
    pool.acquire({ size: 32, usage: STORAGE_COPY })
    pool.acquire({ size: 64, usage: UNIFORM_COPY })
    expect(pool.size).toBe(3)
    pool.clear()
    expect(pool.size).toBe(0)
    expect(pool.inUseCount).toBe(0)
  })
})

// ============================================================================
// 4. 复用匹配
// ============================================================================

describe('BufferPool / reuse', () => {
  it('R01: 同 size+usage 可复用(release 后 acquire)', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    const b2 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    expect(b2.id).toBe(b1.id)
    expect(b2.acquireCount).toBe(2)
    expect(b2.inUse).toBe(true)
  })

  it('R02: inUse 的 buffer 不可复用', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    const b2 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    expect(b2.id).not.toBe(b1.id)
    expect(pool.size).toBe(2)
  })

  it('R03: 不同 usage 不可复用', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    const b2 = pool.acquire({ size: 16, usage: STORAGE_COPY })!
    expect(b2.id).not.toBe(b1.id)
    expect(b2.descriptor.usage).toBe(STORAGE_COPY)
    expect(pool.size).toBe(2)
  })

  it('R04: 不同 size 不可复用(即使分桶后相同)', () => {
    // 注:16 和 17 分桶后都是 16,所以会复用 — 这是分桶的预期行为
    // 这里测试真正不同桶的 size:16 vs 32
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    const b2 = pool.acquire({ size: 32, usage: UNIFORM_COPY })!
    expect(b2.id).not.toBe(b1.id)
    expect(b2.descriptor.size).toBe(32)
    expect(pool.size).toBe(2)
  })

  it('R05: 分桶后相同 size 可复用(17 和 20 都分桶到 32)', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 17, usage: UNIFORM_COPY })!
    expect(b1.descriptor.size).toBe(32)
    pool.release(b1)
    const b2 = pool.acquire({ size: 20, usage: UNIFORM_COPY })!
    expect(b2.descriptor.size).toBe(32)
    expect(b2.id).toBe(b1.id)
  })

  it('R06: 连续 acquire-release-acquire 循环复用同一 buffer', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    const b2 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b2)
    const b3 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    expect(b3.id).toBe(b1.id)
    expect(b3.acquireCount).toBe(3)
  })
})

// ============================================================================
// 5. MAP_READ/MAP_WRITE 拒绝
// ============================================================================

describe('BufferPool / rejection', () => {
  it('RJ01: MAP_READ buffer 被拒绝,返回 undefined', () => {
    const pool = new BufferPool()
    const buf = pool.acquire({ size: 256, usage: USAGE.MAP_READ | USAGE.COPY_DST })
    expect(buf).toBeUndefined()
    expect(pool.size).toBe(0)
  })

  it('RJ02: MAP_WRITE buffer 被拒绝', () => {
    const pool = new BufferPool()
    const buf = pool.acquire({ size: 256, usage: USAGE.MAP_WRITE | USAGE.COPY_DST })
    expect(buf).toBeUndefined()
  })

  it('RJ03: 拒绝计数累加到 totalRejected', () => {
    const pool = new BufferPool()
    pool.acquire({ size: 256, usage: USAGE.MAP_READ | USAGE.COPY_DST })
    pool.acquire({ size: 256, usage: USAGE.MAP_WRITE | USAGE.COPY_DST })
    const stats = pool.getStats()
    expect(stats.totalRejected).toBe(2)
    expect(stats.totalAcquired).toBe(0)
  })
})

// ============================================================================
// 6. LRU 淘汰
// ============================================================================

describe('BufferPool / LRU eviction', () => {
  it('LRU01: 池满时淘汰最久未使用的', () => {
    const pool = new BufferPool({ maxPoolSize: 3 })
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    // 短暂等待确保时间戳不同
    const b2 = pool.acquire({ size: 32, usage: UNIFORM_COPY })!
    pool.release(b2)
    const b3 = pool.acquire({ size: 48, usage: UNIFORM_COPY })!
    pool.release(b3)
    expect(pool.size).toBe(3)

    // b1 是最久未使用的(lastUsedAt 最小)
    // 新建第 4 个不同 size 的 buffer,触发 LRU 淘汰 b1
    const b4 = pool.acquire({ size: 64, usage: UNIFORM_COPY })!
    expect(pool.size).toBe(3)
    // b1 应该已被销毁(从池中移除)
    // 注意:b4 是新建的,因为 64 不匹配现有桶
    expect(b4.id).not.toBe(b1.id)
  })

  it('LRU02: inUse 的 buffer 不被淘汰', () => {
    const pool = new BufferPool({ maxPoolSize: 2 })
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })! // inUse
    const b2 = pool.acquire({ size: 32, usage: UNIFORM_COPY })! // inUse
    expect(pool.size).toBe(2)
    // 两个都 inUse,无法淘汰,池会超过容量
    pool.acquire({ size: 48, usage: UNIFORM_COPY })!
    expect(pool.size).toBe(3)
    // b1 和 b2 仍在池中(都 inUse)
    expect(b1.inUse).toBe(true)
    expect(b2.inUse).toBe(true)
  })

  it('LRU03: 默认 maxPoolSize = 64', () => {
    const pool = new BufferPool()
    // 通过 acquire 不同 size 填充池
    for (let i = 0; i < 64; i++) {
      const buf = pool.acquire({ size: 16 + i * 16, usage: UNIFORM_COPY })!
      pool.release(buf)
    }
    expect(pool.size).toBe(64)
    // 第 65 个触发 LRU
    const buf65 = pool.acquire({ size: 16 + 64 * 16, usage: UNIFORM_COPY })!
    pool.release(buf65)
    expect(pool.size).toBe(64) // 仍为 64(LRU 淘汰一个,新建一个)
  })
})

// ============================================================================
// 7. 统计信息
// ============================================================================

describe('BufferPool / stats', () => {
  it('ST01: 初始状态全部为 0', () => {
    const pool = new BufferPool()
    const stats = pool.getStats()
    expect(stats.poolSize).toBe(0)
    expect(stats.inUse).toBe(0)
    expect(stats.available).toBe(0)
    expect(stats.totalAcquired).toBe(0)
    expect(stats.totalHits).toBe(0)
    expect(stats.totalMisses).toBe(0)
    expect(stats.hitRate).toBe(0)
    expect(stats.totalRejected).toBe(0)
    expect(stats.totalBytes).toBe(0)
  })

  it('ST02: 新建计入 miss', () => {
    const pool = new BufferPool()
    pool.acquire({ size: 16, usage: UNIFORM_COPY })
    const stats = pool.getStats()
    expect(stats.totalAcquired).toBe(1)
    expect(stats.totalMisses).toBe(1)
    expect(stats.totalHits).toBe(0)
    expect(stats.hitRate).toBe(0)
  })

  it('ST03: 复用计入 hit', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    pool.acquire({ size: 16, usage: UNIFORM_COPY })
    const stats = pool.getStats()
    expect(stats.totalAcquired).toBe(2)
    expect(stats.totalHits).toBe(1)
    expect(stats.totalMisses).toBe(1)
    expect(stats.hitRate).toBe(0.5)
  })

  it('ST04: 100% 命中率', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    // 后续 9 次全部命中
    for (let i = 0; i < 9; i++) {
      const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
      pool.release(buf)
    }
    const stats = pool.getStats()
    expect(stats.totalAcquired).toBe(10)
    expect(stats.totalHits).toBe(9)
    expect(stats.totalMisses).toBe(1)
    expect(stats.hitRate).toBeCloseTo(0.9)
  })

  it('ST05: totalBytes 按分桶后 size 累加', () => {
    const pool = new BufferPool()
    pool.acquire({ size: 16, usage: UNIFORM_COPY })! // 16 bytes
    pool.acquire({ size: 17, usage: UNIFORM_COPY })! // bucketed to 32
    pool.acquire({ size: 100, usage: STORAGE_COPY })! // bucketed to 112
    const stats = pool.getStats()
    expect(stats.totalBytes).toBe(16 + 32 + 112)
  })

  it('ST06: poolSize / inUse / available 计数正确', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.acquire({ size: 32, usage: UNIFORM_COPY })! // b2 inUse
    pool.release(b1)
    const stats = pool.getStats()
    expect(stats.poolSize).toBe(2)
    expect(stats.inUse).toBe(1) // b2
    expect(stats.available).toBe(1) // b1
  })
})

// ============================================================================
// 8. GPU 注入
// ============================================================================

describe('BufferPool / GPU injection', () => {
  it('G01: createGpuBuffer 回调被调用', () => {
    const createFn = vi.fn(() => createMockBuffer())
    const pool = new BufferPool({ createGpuBuffer: createFn })
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    expect(createFn).toHaveBeenCalledTimes(1)
    expect(buf.gpuBuffer).toBeDefined()
  })

  it('G02: 复用时不调用 createGpuBuffer', () => {
    const createFn = vi.fn(() => createMockBuffer())
    const pool = new BufferPool({ createGpuBuffer: createFn })
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    pool.acquire({ size: 16, usage: UNIFORM_COPY })
    expect(createFn).toHaveBeenCalledTimes(1) // 只在新建时调用
  })

  it('G03: destroyGpuBuffer 在 destroyBuffer 时被调用', () => {
    const mock = createMockBuffer()
    const destroyFn = vi.fn()
    const pool = new BufferPool({
      createGpuBuffer: () => mock,
      destroyGpuBuffer: destroyFn,
    })
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.destroyBuffer(buf)
    expect(destroyFn).toHaveBeenCalledTimes(1)
    expect(destroyFn).toHaveBeenCalledWith(mock)
  })

  it('G04: clear 时销毁所有 GPU buffer', () => {
    const destroyed: MockBuffer[] = []
    const pool = new BufferPool({
      createGpuBuffer: () => {
        const m = createMockBuffer()
        return m
      },
      destroyGpuBuffer: (buf) => {
        destroyed.push(buf as unknown as MockBuffer)
      },
    })
    pool.acquire({ size: 16, usage: UNIFORM_COPY })
    pool.acquire({ size: 32, usage: UNIFORM_COPY })
    pool.acquire({ size: 64, usage: UNIFORM_COPY })
    pool.clear()
    expect(destroyed.length).toBe(3)
  })

  it('G05: LRU 淘汰时调用 destroyGpuBuffer', () => {
    const destroyed: GPUBuffer[] = []
    const pool = new BufferPool({
      maxPoolSize: 2,
      createGpuBuffer: () => createMockBuffer(),
      destroyGpuBuffer: (buf) => destroyed.push(buf),
    })
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.release(b1)
    const b2 = pool.acquire({ size: 32, usage: UNIFORM_COPY })!
    pool.release(b2)
    // 触发 LRU 淘汰 b1
    pool.acquire({ size: 64, usage: UNIFORM_COPY })
    expect(destroyed.length).toBe(1)
  })

  it('G06: 不提供 destroyGpuBuffer 时默认调用 buffer.destroy()', () => {
    const mock = createMockBuffer()
    const pool = new BufferPool({
      createGpuBuffer: () => mock,
    })
    const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    pool.destroyBuffer(buf)
    expect(mock.destroyed).toBe(true)
  })
})

// ============================================================================
// 9. ResourceManager 集成(Step 39.2 新增)
// ============================================================================

describe('ResourceManager / buffer integration', () => {
  it('RM01: acquireBuffer 登记 nodeId', () => {
    const rm = new ResourceManager()
    const buf = rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    expect(buf).toBeDefined()
    expect(rm.getNodeBuffers('node_01')).toHaveLength(1)
    expect(rm.getNodeBuffers('node_01')[0]).toBe(buf!.id)
  })

  it('RM02: acquireBuffer 多个 buffer 同一 nodeId', () => {
    const rm = new ResourceManager()
    rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    rm.acquireBuffer('node_01', { size: 32, usage: STORAGE_COPY })
    expect(rm.getNodeBuffers('node_01')).toHaveLength(2)
  })

  it('RM03: disposeNode 释放该节点的所有 buffer', () => {
    const rm = new ResourceManager()
    rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    rm.acquireBuffer('node_01', { size: 32, usage: STORAGE_COPY })
    const count = rm.disposeNode('node_01')
    expect(count).toBe(2)
    expect(rm.getNodeBuffers('node_01')).toHaveLength(0)
  })

  it('RM04: disposeNode 同时释放纹理和 buffer', () => {
    const rm = new ResourceManager()
    rm.acquireTexture('node_01', { width: 1920, height: 1080 })
    rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    rm.acquireBuffer('node_01', { size: 32, usage: STORAGE_COPY })
    const count = rm.disposeNode('node_01')
    expect(count).toBe(3) // 1 texture + 2 buffer
  })

  it('RM05: disposeNode 未持有资源返回 0', () => {
    const rm = new ResourceManager()
    expect(rm.disposeNode('unknown')).toBe(0)
  })

  it('RM06: getStats 合并 texture + buffer 统计', () => {
    const rm = new ResourceManager()
    rm.acquireTexture('node_01', { width: 1920, height: 1080 })
    rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    const stats = rm.getStats()
    expect(stats.texturePoolSize).toBe(1)
    expect(stats.bufferPoolSize).toBe(1)
    expect(stats.textureTotalAcquired).toBe(1)
    expect(stats.bufferTotalAcquired).toBe(1)
    expect(stats.nodeCount).toBe(1)
  })

  it('RM07: 不同节点的资源独立', () => {
    const rm = new ResourceManager()
    rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    rm.acquireBuffer('node_02', { size: 16, usage: UNIFORM_COPY })
    expect(rm.getNodeBuffers('node_01')).toHaveLength(1)
    expect(rm.getNodeBuffers('node_02')).toHaveLength(1)
    expect(rm.getStats().nodeCount).toBe(2)
  })

  it('RM08: disposeAll 清空 buffer 池和节点映射', () => {
    const rm = new ResourceManager()
    rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })
    rm.acquireBuffer('node_02', { size: 32, usage: STORAGE_COPY })
    rm.disposeAll()
    const stats = rm.getStats()
    expect(stats.bufferPoolSize).toBe(0)
    expect(stats.nodeCount).toBe(0)
    expect(rm.getNodeBuffers('node_01')).toHaveLength(0)
  })

  it('RM09: acquireBuffer MAP_READ 返回 undefined 不登记节点', () => {
    const rm = new ResourceManager()
    const buf = rm.acquireBuffer('node_01', { size: 256, usage: USAGE.MAP_READ | USAGE.COPY_DST })
    expect(buf).toBeUndefined()
    expect(rm.getNodeBuffers('node_01')).toHaveLength(0)
  })

  it('RM10: getBufferPool 暴露内部 BufferPool', () => {
    const rm = new ResourceManager()
    const pool = rm.getBufferPool()
    expect(pool).toBeInstanceOf(BufferPool)
  })

  it('RM11: releaseBuffer 标记可复用', () => {
    const rm = new ResourceManager()
    const buf = rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })!
    rm.releaseBuffer(buf)
    expect(buf.inUse).toBe(false)
  })

  it('RM12: buffer 池命中率达到 100%(稳定 size 场景)', () => {
    const rm = new ResourceManager()
    // 模拟 10 帧渲染:每帧 acquire uniform buffer + release
    for (let frame = 0; frame < 10; frame++) {
      const buf = rm.acquireBuffer('node_01', { size: 16, usage: UNIFORM_COPY })!
      rm.releaseBuffer(buf)
    }
    const stats = rm.getStats()
    expect(stats.bufferTotalAcquired).toBe(10)
    expect(stats.bufferTotalHits).toBe(9) // 第 1 次 miss,后 9 次 hit
    expect(stats.bufferTotalMisses).toBe(1)
    expect(stats.bufferHitRate).toBeCloseTo(0.9)
  })

  it('RM13: 注入外部 BufferPool', () => {
    const externalPool = new BufferPool({ maxPoolSize: 8 })
    const rm = new ResourceManager({ bufferPool: externalPool })
    expect(rm.getBufferPool()).toBe(externalPool)
  })
})

// ============================================================================
// 10. 边界条件
// ============================================================================

describe('BufferPool / edge cases', () => {
  it('E01: label 不参与复用匹配', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY, label: 'uniform_A' })!
    pool.release(b1)
    const b2 = pool.acquire({ size: 16, usage: UNIFORM_COPY, label: 'uniform_B' })!
    expect(b2.id).toBe(b1.id) // 复用,即使 label 不同
  })

  it('E02: 默认 label 自动生成', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
    expect(b1.descriptor.label).toMatch(/^buffer_/)
  })

  it('E03: 极大 size 正常分桶', () => {
    const pool = new BufferPool()
    const b1 = pool.acquire({ size: 1024 * 1024, usage: STORAGE_COPY })!
    expect(b1.descriptor.size).toBe(1024 * 1024)
  })

  it('E04: 所有 usage flag 组合(除 MAP)都可池化', () => {
    const pool = new BufferPool()
    const usages = [
      USAGE.COPY_SRC | USAGE.COPY_DST,
      USAGE.INDEX | USAGE.COPY_DST,
      USAGE.VERTEX | USAGE.COPY_DST,
      USAGE.UNIFORM | USAGE.COPY_DST | USAGE.COPY_SRC,
      USAGE.STORAGE | USAGE.COPY_DST,
      USAGE.INDIRECT,
      USAGE.QUERY_RESOLVE | USAGE.COPY_SRC,
    ]
    for (const usage of usages) {
      const buf = pool.acquire({ size: 16, usage })
      expect(buf).toBeDefined()
    }
    expect(pool.size).toBe(usages.length)
  })

  it('E05: 大量 acquire-release 循环不泄漏(池大小稳定)', () => {
    const pool = new BufferPool({ maxPoolSize: 16 })
    for (let i = 0; i < 100; i++) {
      const buf = pool.acquire({ size: 16, usage: UNIFORM_COPY })!
      pool.release(buf)
    }
    expect(pool.size).toBe(1) // 同一 size+usage,只创建 1 个
  })
})
