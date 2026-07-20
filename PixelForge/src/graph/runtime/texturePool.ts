/**
 * Texture Pool(Step 26.9)— GPU 纹理复用池。
 *
 * 核心问题(用户 spec):
 *   每个节点创建 Texture 会非常浪费:
 *     Noise   → 创建 Texture A
 *     Spiral  → 创建 Texture B
 *     Color   → 创建 Texture C
 *   一帧渲染完,这些 Texture 都被丢弃,下一帧再创建。
 *
 * 解决方案:TexturePool 维护一个纹理池,同尺寸的纹理可复用。
 *   第一次:Noise → pool.acquire() → 创建新 Texture A
 *   第一帧结束:release(A) → A 回到池中(inUse=false)
 *   第二帧:Noise → pool.acquire() → 复用 A(inUse=true)
 *
 * 设计要点:
 * - 同尺寸 + 同 format 的纹理可复用(acquire 时优先找 inUse=false 的)
 * - LRU 策略:池满时淘汰最久未使用的
 * - 引用计数:acquire +1,release -1,归零时回收到池中
 * - 不持有 GPU device 引用(由 ResourceManager 注入创建函数)
 *
 * 与 runtime/types.ts 的 RuntimeTextureBundle 的区别:
 * - RuntimeTextureBundle: 顶层输出纹理(单例,画布呈现)
 * - TexturePool:          节点中间纹理(多实例,可复用)
 */

/**
 * 纹理描述符(用于匹配可复用的纹理)。
 */
export interface TextureDescriptor {
  width: number
  height: number
  /** 纹理格式(默认 'rgba8unorm',与 DM-5 收口一致) */
  format?: string
  /** 标签(用于 GPU 调试,不参与复用匹配) */
  label?: string
}

/**
 * 池化的纹理条目。
 *
 * - id:         唯一 ID(便于日志 / cache key)
 * - descriptor: 创建时的描述符(参与复用匹配)
 * - inUse:      是否正在被使用(acquire 后 true,release 后 false)
 * - lastUsedAt: 最后使用时间戳(LRU 淘汰用)
 * - acquireCount: 累计被 acquire 次数(统计用)
 * - gpuTexture: 可选的真实 GPUTexture(测试环境可空)
 */
export interface PooledTexture {
  id: string
  descriptor: Required<TextureDescriptor>
  inUse: boolean
  lastUsedAt: number
  acquireCount: number
  /** 真实 GPUTexture(由 ResourceManager 注入的创建函数产生;测试环境可空) */
  gpuTexture?: GPUTexture
}

/**
 * 默认纹理格式(与 runtime/capability.ts 的 DM-5 强制格式一致)。
 */
const DEFAULT_FORMAT = 'rgba8unorm'

/**
 * TexturePool 选项。
 */
export interface TexturePoolOptions {
  /** 池最大容量(超出时 LRU 淘汰,默认 32) */
  maxPoolSize?: number
  /**
   * 创建真实 GPUTexture 的函数(可选)。
   * - 提供:acquire 时若需新建,调用此函数产生 GPUTexture
   * - 不提供:acquire 时仅创建元数据条目(测试用)
   */
  createGpuTexture?: (desc: Required<TextureDescriptor>) => GPUTexture | undefined
  /** 销毁 GPUTexture 的函数(可选,默认调用 texture.destroy()) */
  destroyGpuTexture?: (texture: GPUTexture) => void
}

/**
 * Texture Pool 实现。
 *
 * @example
 * const pool = new TexturePool({ maxPoolSize: 16 })
 * const t1 = pool.acquire({ width: 1920, height: 1080 })  // 新建
 * const t2 = pool.acquire({ width: 1920, height: 1080 })  // 新建(因 t1 还在 inUse)
 * pool.release(t1)
 * const t3 = pool.acquire({ width: 1920, height: 1080 })  // 复用 t1
 * pool.clear()  // 清空池
 */
export class TexturePool {
  private pool: PooledTexture[] = []
  private idCounter = 0
  private readonly maxPoolSize: number
  private readonly createGpuTexture?: TexturePoolOptions['createGpuTexture']
  private readonly destroyGpuTexture?: TexturePoolOptions['destroyGpuTexture']

  /** 累计 acquire 次数(统计用) */
  private totalAcquired = 0
  /** 累计 hit(复用)次数 */
  private totalHits = 0
  /** 累计 miss(新建)次数 */
  private totalMisses = 0

  constructor(options: TexturePoolOptions = {}) {
    this.maxPoolSize = options.maxPoolSize ?? 32
    this.createGpuTexture = options.createGpuTexture
    this.destroyGpuTexture = options.destroyGpuTexture
  }

  /**
   * 获取一个纹理(优先复用,否则新建)。
   *
   * 复用条件:width + height + format 完全相同 且 inUse=false
   */
  acquire(desc: TextureDescriptor): PooledTexture {
    this.totalAcquired++
    const normalizedDesc: Required<TextureDescriptor> = {
      width: desc.width,
      height: desc.height,
      format: desc.format ?? DEFAULT_FORMAT,
      label: desc.label ?? `texture_${this.idCounter}`,
    }

    // —— 1. 查找可复用的纹理 ——
    for (const tex of this.pool) {
      if (
        !tex.inUse &&
        tex.descriptor.width === normalizedDesc.width &&
        tex.descriptor.height === normalizedDesc.height &&
        tex.descriptor.format === normalizedDesc.format
      ) {
        tex.inUse = true
        tex.lastUsedAt = Date.now()
        tex.acquireCount++
        this.totalHits++
        return tex
      }
    }

    // —— 2. 池满时 LRU 淘汰一个未使用的条目 ——
    if (this.pool.length >= this.maxPoolSize) {
      let lruIndex = -1
      let lruTime = Infinity
      for (let i = 0; i < this.pool.length; i++) {
        const tex = this.pool[i]
        if (!tex.inUse && tex.lastUsedAt < lruTime) {
          lruTime = tex.lastUsedAt
          lruIndex = i
        }
      }
      if (lruIndex >= 0) {
        const evicted = this.pool.splice(lruIndex, 1)[0]
        this.destroyTexture(evicted)
      }
    }

    // —— 3. 新建纹理 ——
    this.totalMisses++
    const id = `tex_${(++this.idCounter).toString(36)}`
    const gpuTexture = this.createGpuTexture?.(normalizedDesc)
    const texture: PooledTexture = {
      id,
      descriptor: normalizedDesc,
      inUse: true,
      lastUsedAt: Date.now(),
      acquireCount: 1,
      gpuTexture,
    }
    this.pool.push(texture)
    return texture
  }

  /**
   * 释放纹理(标记为可复用,不销毁)。
   */
  release(texture: PooledTexture): void {
    const found = this.pool.find((t) => t.id === texture.id)
    if (!found) {
      // 不在池中(可能已被 LRU 淘汰),忽略
      return
    }
    found.inUse = false
    found.lastUsedAt = Date.now()
  }

  /**
   * 销毁单个纹理(从池中移除并销毁 GPU 资源)。
   */
  destroyTexture(texture: PooledTexture): void {
    const idx = this.pool.findIndex((t) => t.id === texture.id)
    if (idx < 0) return
    const removed = this.pool.splice(idx, 1)[0]
    if (removed.gpuTexture) {
      if (this.destroyGpuTexture) {
        this.destroyGpuTexture(removed.gpuTexture)
      } else {
        removed.gpuTexture.destroy()
      }
    }
  }

  /**
   * 清空整个池(销毁所有 GPU 资源)。
   */
  clear(): void {
    for (const tex of this.pool) {
      if (tex.gpuTexture) {
        if (this.destroyGpuTexture) {
          this.destroyGpuTexture(tex.gpuTexture)
        } else {
          tex.gpuTexture.destroy()
        }
      }
    }
    this.pool = []
  }

  /**
   * 当前池中纹理数量(含 inUse 和未 inUse)。
   */
  get size(): number {
    return this.pool.length
  }

  /**
   * 当前正在使用的纹理数量。
   */
  get inUseCount(): number {
    return this.pool.filter((t) => t.inUse).length
  }

  /**
   * 当前可复用的纹理数量。
   */
  get availableCount(): number {
    return this.pool.filter((t) => !t.inUse).length
  }

  /**
   * 统计信息(用于 profiler / 调试)。
   */
  getStats(): {
    poolSize: number
    inUse: number
    available: number
    totalAcquired: number
    totalHits: number
    totalMisses: number
    hitRate: number
  } {
    const total = this.totalAcquired
    return {
      poolSize: this.pool.length,
      inUse: this.inUseCount,
      available: this.availableCount,
      totalAcquired: total,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total === 0 ? 0 : this.totalHits / total,
    }
  }
}
