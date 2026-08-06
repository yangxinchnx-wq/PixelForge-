/**
 * PixelForge - RenderGraph 瞬态缓冲区池(Step 40.5)
 *
 * 借鉴 Orillusion TransientBufferPool,适配 PixelForge 抽象(直接用 GPUBuffer)。
 *
 * 按 (roundedSize, usage) 分桶复用 GPUBuffer wrapper。
 * 复用 buffer 小于新需求时通过销毁+重建扩容(WebGPU 的 GPUBuffer 不支持原地 resize)。
 */

import type { BufferDesc } from './resourceDesc'
import type { ResourceLifetime } from './lifetimeAnalyzer'

/**
 * 池持有的一个物理 GPUBuffer 槽位。
 * @internal
 */
export interface PooledBuffer {
  buf: GPUBuffer
  bucketKey: string
  actualSize: number
  inUseUntilIdx: number
  inUseByName: string | null
}

/**
 * 单次 assign() 的快照。
 */
export interface TransientBufferAssignment {
  bindings: Map<string, GPUBuffer>
  debug: Map<string, { bucketKey: string; aliased: boolean; dedicated: boolean; grew: boolean }>
}

/**
 * 瞬态图 buffer 的物理池。镜像 TransientTexturePool,
 * 但按 (roundedSize, usage) 分桶,复用 GPUBuffer 时通过销毁+重建扩容。
 */
export class TransientBufferPool {
  private readonly _buckets = new Map<string, PooledBuffer[]>()
  private readonly _dedicatedByName = new Map<string, PooledBuffer>()
  private _currentBytes = 0
  private _peakBytes = 0

  private readonly _createGpuBuffer: (desc: GPUBufferDescriptor) => GPUBuffer
  private readonly _destroyGpuBuffer: (buffer: GPUBuffer) => void

  constructor(options: TransientBufferPoolOptions = {}) {
    this._createGpuBuffer = options.createGpuBuffer ?? ((desc) => deviceCreateBuffer(desc))
    this._destroyGpuBuffer = options.destroyGpuBuffer ?? ((buf) => buf.destroy())
  }

  public assign(lifetimes: readonly ResourceLifetime[]): TransientBufferAssignment {
    for (const list of this._buckets.values()) {
      for (const slot of list) {
        slot.inUseUntilIdx = -1
        slot.inUseByName = null
      }
    }

    const bindings = new Map<string, GPUBuffer>()
    const debug = new Map<string, { bucketKey: string; aliased: boolean; dedicated: boolean; grew: boolean }>()

    const bufLifetimes = lifetimes
      .filter((lt) => lt.kind === 'buffer' && !lt.persistent)
      .sort((a, b) => {
        if (a.firstUseIdx !== b.firstUseIdx) return a.firstUseIdx - b.firstUseIdx
        return a.name < b.name ? -1 : 1
      })

    for (const lt of bufLifetimes) {
      const desc = lt.desc as BufferDesc
      const requested = lt.resolvedSize!
      const rounded = roundUpToPow2(Math.max(16, requested))
      const usage = lt.resolvedUsage || desc.usage
      const bucketKey = `${rounded}|u${usage}`
      const aliasable = desc.aliasable !== false

      let slot: PooledBuffer
      let aliased = false
      let dedicated = false
      let grew = false

      if (!aliasable) {
        const existing = this._dedicatedByName.get(lt.name)
        if (existing && existing.bucketKey === bucketKey) {
          slot = existing
        } else {
          if (existing) this._destroySlot(existing)
          slot = this._allocateSlot(lt, usage, rounded, bucketKey)
          this._dedicatedByName.set(lt.name, slot)
        }
        dedicated = true
      } else {
        let bucket = this._buckets.get(bucketKey)
        if (!bucket) {
          bucket = []
          this._buckets.set(bucketKey, bucket)
        }
        const reused = this._findReusableSlot(bucket, lt.firstUseIdx)
        if (reused) {
          slot = reused
          if (slot.actualSize < requested) {
            // GPUBuffer 不支持原地 resize,销毁重建
            this._destroyGpuBuffer(slot.buf)
            this._currentBytes -= slot.actualSize
            const newBuf = this._createGpuBuffer(makeBufferDescriptor(rounded, usage, lt.name))
            slot.buf = newBuf
            this._currentBytes += rounded
            slot.actualSize = rounded
            grew = true
          }
          aliased = slot.inUseByName !== null && slot.inUseByName !== lt.name
        } else {
          slot = this._allocateSlot(lt, usage, rounded, bucketKey)
          bucket.push(slot)
        }
        slot.inUseUntilIdx = lt.lastUseIdx
        slot.inUseByName = lt.name
        if (this._currentBytes > this._peakBytes) this._peakBytes = this._currentBytes
      }

      bindings.set(lt.name, slot.buf)
      debug.set(lt.name, { bucketKey, aliased, dedicated, grew })
    }

    // 清扫消失名字的专用槽
    const liveDedicated = new Set(
      bufLifetimes.filter((lt) => (lt.desc as BufferDesc).aliasable === false).map((lt) => lt.name),
    )
    for (const [name, slot] of this._dedicatedByName) {
      if (!liveDedicated.has(name)) {
        this._destroySlot(slot)
        this._dedicatedByName.delete(name)
      }
    }

    // 清扫陈旧可别名 bucket(同 TransientTexturePool 思路)
    for (const [key, list] of this._buckets) {
      if (!list.some((slot) => slot.inUseByName !== null)) {
        for (const slot of list) this._destroySlot(slot)
        this._buckets.delete(key)
      }
    }

    return { bindings, debug }
  }

  public dispose(): void {
    for (const list of this._buckets.values()) {
      for (const slot of list) this._destroySlot(slot)
    }
    this._buckets.clear()
    for (const slot of this._dedicatedByName.values()) this._destroySlot(slot)
    this._dedicatedByName.clear()
    this._currentBytes = 0
  }

  public stats(): { currentBytes: number; peakBytes: number; bucketCount: number; slotCount: number } {
    let slotCount = this._dedicatedByName.size
    for (const list of this._buckets.values()) slotCount += list.length
    return {
      currentBytes: this._currentBytes,
      peakBytes: this._peakBytes,
      bucketCount: this._buckets.size,
      slotCount,
    }
  }

  private _findReusableSlot(bucket: PooledBuffer[], firstUseIdx: number): PooledBuffer | null {
    // 同 TransientTexturePool:去掉 inUseByName !== null 检查,让别名真正按生命周期 disjoint 判断
    let best: PooledBuffer | null = null
    for (const slot of bucket) {
      if (slot.inUseUntilIdx >= firstUseIdx) continue
      if (best === null || slot.inUseUntilIdx < best.inUseUntilIdx) best = slot
    }
    return best
  }

  private _allocateSlot(
    lt: ResourceLifetime,
    usage: number,
    size: number,
    bucketKey: string,
  ): PooledBuffer {
    const buf = this._createGpuBuffer(makeBufferDescriptor(size, usage, lt.name))
    this._currentBytes += size
    if (this._currentBytes > this._peakBytes) this._peakBytes = this._currentBytes
    return {
      buf,
      bucketKey,
      actualSize: size,
      inUseUntilIdx: lt.lastUseIdx,
      inUseByName: lt.name,
    }
  }

  private _destroySlot(slot: PooledBuffer): void {
    try {
      this._destroyGpuBuffer(slot.buf)
    } catch {
      /* device-lost / 已销毁 */
    }
    this._currentBytes -= slot.actualSize
    if (this._currentBytes < 0) this._currentBytes = 0
  }
}

/**
 * 池构造选项。
 */
export interface TransientBufferPoolOptions {
  createGpuBuffer?: (desc: GPUBufferDescriptor) => GPUBuffer
  destroyGpuBuffer?: (buffer: GPUBuffer) => void
}

function makeBufferDescriptor(size: number, usage: number, label: string): GPUBufferDescriptor {
  return { size, usage, label }
}

/**
 * 向上取整到 2 的幂。
 * @internal
 */
export function roundUpToPow2(n: number): number {
  if (n <= 1) return 1
  let p = 1
  while (p < n) p <<= 1
  return p
}

function deviceCreateBuffer(_desc: GPUBufferDescriptor): GPUBuffer {
  throw new Error(
    '[TransientBufferPool] 未注入 createGpuBuffer,且无全局 device 可用。' +
      '请在构造池时提供 createGpuBuffer 选项。',
  )
}
