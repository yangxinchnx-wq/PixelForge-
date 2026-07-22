/**
 * Buffer Pool(Step 39.2)— GPU Buffer 复用池。
 *
 * 核心问题(调研结论):
 *   gpuDispatch.ts / compositor.ts / evaluator.ts 每帧创建+销毁 11 处 buffer,
 *   其中 uniformBuffer 固定 16 字节,aux/param buffer 尺寸有限且变化少。
 *   每帧 N 个 layer × createBuffer+destroy = 显著的 GPU 调用开销。
 *
 * 解决方案:BufferPool 维护一个 buffer 池,同 size+usage 的 buffer 可复用。
 *   第一次:acquire(16, UNIFORM|COPY_DST) → 创建新 buffer A
 *   帧结束:release(A) → A 回到池中(inUse=false)
 *   下一帧:acquire(16, UNIFORM|COPY_DST) → 复用 A(inUse=true)
 *
 * 设计要点(对齐 TexturePool):
 * - 同 size + 同 usage 的 buffer 可复用(acquire 时优先找 inUse=false 的)
 * - size 分桶:变长 storage buffer 用 ceil 到 16 的倍数,避免池碎片化
 * - LRU 策略:池满时淘汰最久未使用的
 * - 不持有 GPU device 引用(由 ResourceManager 注入创建函数)
 * - MAP_READ buffer 不纳入池化(由调用方自行管理)
 *
 * 与 TexturePool 的差异:
 * - TexturePool 用 width+height+format 精确匹配
 * - BufferPool 用 size(bucketed)+usage 精确匹配
 * - BufferPool 不复用 MAP_READ/MAP_WRITE buffer(异步 map 操作不兼容池化)
 */

/**
 * Buffer 描述符(用于匹配可复用的 buffer)。
 */
export interface BufferDescriptor {
  /** buffer 字节大小(会向上取整到 16 的倍数进行分桶) */
  size: number
  /** GPUBufferUsageFlags(参与复用匹配,UNIFORM 与 STORAGE 不可混用) */
  usage: number
  /** 标签(用于 GPU 调试,不参与复用匹配) */
  label?: string
}

/**
 * 池化的 buffer 条目。
 *
 * - id:         唯一 ID(便于日志 / cache key)
 * - descriptor: 创建时的描述符(参与复用匹配)
 * - inUse:      是否正在被使用(acquire 后 true,release 后 false)
 * - lastUsedAt: 最后使用时间戳(LRU 淘汰用)
 * - acquireCount: 累计被 acquire 次数(统计用)
 * - gpuBuffer:  可选的真实 GPUBuffer(测试环境可空)
 */
export interface PooledBuffer {
  id: string
  descriptor: Required<BufferDescriptor>
  inUse: boolean
  lastUsedAt: number
  acquireCount: number
  /** 真实 GPUBuffer(由 ResourceManager 注入的创建函数产生;测试环境可空) */
  gpuBuffer?: GPUBuffer
}

/**
 * size 分桶的粒度(所有 size 向上取整到此值的倍数)。
 * WebGPU 要求 buffer size 是 4 的倍数,这里用 16 以减少分桶数量。
 */
const BUCKET_ALIGNMENT = 16

/**
 * 将 size 向上取整到 BUCKET_ALIGNMENT 的倍数。
 *
 * @example
 *   bucketSize(1)   → 16
 *   bucketSize(16)  → 16
 *   bucketSize(17)  → 32
 *   bucketSize(60)  → 64
 */
export function bucketSize(size: number): number {
  if (size <= 0) return BUCKET_ALIGNMENT
  return Math.ceil(size / BUCKET_ALIGNMENT) * BUCKET_ALIGNMENT
}

/**
 * 判断 usage 是否可池化。
 *
 * MAP_READ / MAP_WRITE buffer 涉及异步 mapAsync 操作,不能安全复用。
 * 调用方应自行管理这类 buffer 的生命周期。
 *
 * GPUBufferUsage 的位掩码值(WebGPU spec):
 *   MAP_READ      = 1
 *   MAP_WRITE     = 2
 *   COPY_SRC      = 4
 *   COPY_DST      = 8
 *   INDEX         = 16
 *   VERTEX        = 32
 *   UNIFORM       = 64
 *   STORAGE       = 128
 *   INDIRECT      = 256
 *   QUERY_RESOLVE = 512
 */
const MAP_FLAGS = 1 | 2 // MAP_READ | MAP_WRITE

export function isPoolableUsage(usage: number): boolean {
  return (usage & MAP_FLAGS) === 0
}

/**
 * BufferPool 选项。
 */
export interface BufferPoolOptions {
  /** 池最大容量(超出时 LRU 淘汰,默认 64) */
  maxPoolSize?: number
  /**
   * 创建真实 GPUBuffer 的函数(可选)。
   * - 提供:acquire 时若需新建,调用此函数产生 GPUBuffer
   * - 不提供:acquire 时仅创建元数据条目(测试用)
   */
  createGpuBuffer?: (desc: Required<BufferDescriptor>) => GPUBuffer | undefined
  /** 销毁 GPUBuffer 的函数(可选,默认调用 buffer.destroy()) */
  destroyGpuBuffer?: (buffer: GPUBuffer) => void
}

/**
 * BufferPool 统计信息。
 */
export interface BufferPoolStats {
  poolSize: number
  inUse: number
  available: number
  totalAcquired: number
  totalHits: number
  totalMisses: number
  hitRate: number
  /** 累计被拒绝池化的次数(usage 含 MAP_READ/MAP_WRITE) */
  totalRejected: number
  /** 当前池中 buffer 占用的总字节数(按 descriptor.size 累加) */
  totalBytes: number
}

/**
 * Buffer Pool 实现。
 *
 * @example
 * const pool = new BufferPool({ maxPoolSize: 32 })
 * const b1 = pool.acquire({ size: 16, usage: 0x40 | 0x08 })  // UNIFORM|COPY_DST,新建
 * const b2 = pool.acquire({ size: 16, usage: 0x40 | 0x08 })  // 新建(因 b1 还在 inUse)
 * pool.release(b1)
 * const b3 = pool.acquire({ size: 16, usage: 0x40 | 0x08 })  // 复用 b1
 * pool.clear()  // 清空池
 */
export class BufferPool {
  private pool: PooledBuffer[] = []
  private idCounter = 0
  private readonly maxPoolSize: number
  private readonly createGpuBuffer?: BufferPoolOptions['createGpuBuffer']
  private readonly destroyGpuBuffer?: BufferPoolOptions['destroyGpuBuffer']

  /** 累计 acquire 次数(统计用) */
  private totalAcquired = 0
  /** 累计 hit(复用)次数 */
  private totalHits = 0
  /** 累计 miss(新建)次数 */
  private totalMisses = 0
  /** 累计被拒绝池化的次数(usage 含 MAP_READ/MAP_WRITE) */
  private totalRejected = 0

  constructor(options: BufferPoolOptions = {}) {
    this.maxPoolSize = options.maxPoolSize ?? 64
    this.createGpuBuffer = options.createGpuBuffer
    this.destroyGpuBuffer = options.destroyGpuBuffer
  }

  /**
   * 获取一个 buffer(优先复用,否则新建)。
   *
   * 复用条件:bucketed size + usage 完全相同 且 inUse=false
   *
   * 注意:usage 含 MAP_READ/MAP_WRITE 时会被拒绝池化,返回 undefined。
   * 调用方应自行创建这类 buffer。
   *
   * @returns PooledBuffer 或 undefined(usage 不可池化时)
   */
  acquire(desc: BufferDescriptor): PooledBuffer | undefined {
    // —— 0. 拒绝不可池化的 usage ——
    if (!isPoolableUsage(desc.usage)) {
      this.totalRejected++
      return undefined
    }

    this.totalAcquired++

    const normalizedDesc: Required<BufferDescriptor> = {
      size: bucketSize(desc.size),
      usage: desc.usage,
      label: desc.label ?? `buffer_${this.idCounter}`,
    }

    // —— 1. 查找可复用的 buffer ——
    for (const buf of this.pool) {
      if (
        !buf.inUse &&
        buf.descriptor.size === normalizedDesc.size &&
        buf.descriptor.usage === normalizedDesc.usage
      ) {
        buf.inUse = true
        buf.lastUsedAt = Date.now()
        buf.acquireCount++
        this.totalHits++
        return buf
      }
    }

    // —— 2. 池满时 LRU 淘汰一个未使用的条目 ——
    if (this.pool.length >= this.maxPoolSize) {
      let lruIndex = -1
      let lruTime = Infinity
      for (let i = 0; i < this.pool.length; i++) {
        const buf = this.pool[i]
        if (!buf.inUse && buf.lastUsedAt < lruTime) {
          lruTime = buf.lastUsedAt
          lruIndex = i
        }
      }
      if (lruIndex >= 0) {
        const evicted = this.pool.splice(lruIndex, 1)[0]
        this.destroyGpuResource(evicted)
      }
    }

    // —— 3. 新建 buffer ——
    this.totalMisses++
    const id = `buf_${(++this.idCounter).toString(36)}`
    const gpuBuffer = this.createGpuBuffer?.(normalizedDesc)
    const buffer: PooledBuffer = {
      id,
      descriptor: normalizedDesc,
      inUse: true,
      lastUsedAt: Date.now(),
      acquireCount: 1,
      gpuBuffer,
    }
    this.pool.push(buffer)
    return buffer
  }

  /**
   * 释放 buffer(标记为可复用,不销毁)。
   */
  release(buffer: PooledBuffer): void {
    const found = this.pool.find((b) => b.id === buffer.id)
    if (!found) {
      // 不在池中(可能已被 LRU 淘汰),忽略
      return
    }
    found.inUse = false
    found.lastUsedAt = Date.now()
  }

  /**
   * 销毁单个 buffer 的 GPU 资源(内部使用,不操作 pool 数组)。
   */
  private destroyGpuResource(entry: PooledBuffer): void {
    if (entry.gpuBuffer) {
      if (this.destroyGpuBuffer) {
        this.destroyGpuBuffer(entry.gpuBuffer)
      } else {
        entry.gpuBuffer.destroy()
      }
    }
  }

  /**
   * 销毁单个 buffer(从池中移除并销毁 GPU 资源)。
   */
  destroyBuffer(buffer: PooledBuffer): void {
    const idx = this.pool.findIndex((b) => b.id === buffer.id)
    if (idx < 0) return
    const removed = this.pool.splice(idx, 1)[0]
    this.destroyGpuResource(removed)
  }

  /**
   * 清空整个池(销毁所有 GPU 资源)。
   */
  clear(): void {
    for (const buf of this.pool) {
      this.destroyGpuResource(buf)
    }
    this.pool = []
  }

  /**
   * 当前池中 buffer 数量(含 inUse 和未 inUse)。
   */
  get size(): number {
    return this.pool.length
  }

  /**
   * 当前正在使用的 buffer 数量。
   */
  get inUseCount(): number {
    return this.pool.filter((b) => b.inUse).length
  }

  /**
   * 当前可复用的 buffer 数量。
   */
  get availableCount(): number {
    return this.pool.filter((b) => !b.inUse).length
  }

  /**
   * 当前池中 buffer 占用的总字节数。
   */
  get totalBytes(): number {
    return this.pool.reduce((sum, b) => sum + b.descriptor.size, 0)
  }

  /**
   * 统计信息(用于 profiler / 调试)。
   */
  getStats(): BufferPoolStats {
    const total = this.totalAcquired
    return {
      poolSize: this.pool.length,
      inUse: this.inUseCount,
      available: this.availableCount,
      totalAcquired: total,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total === 0 ? 0 : this.totalHits / total,
      totalRejected: this.totalRejected,
      totalBytes: this.totalBytes,
    }
  }
}
