/**
 * PixelForge - RenderGraph 瞬态纹理池(Step 40.5)
 *
 * 借鉴 Orillusion TransientTexturePool 的 lifetime-aware 别名池算法,
 * 适配 PixelForge 的 GPU 注入式设计(不持有 device 引用,createGpuTexture/destroyGpuTexture 回调注入)。
 *
 * 生命周期感知别名池:
 * - 同一编译窗口内,firstUseIdx 排序后,生命周期区间 disjoint 的同 bucket 资源复用同一物理 GPUTexture
 * - 跨编译窗口保留所有已分配 wrapper —— 下次 assign() 重新洗牌哪个逻辑名映射到哪个物理槽位
 * - aliasable: false 资源走专用路径(dedicated slot),身份跨编译窗口稳定
 * - device-lost 时 destroy 所有槽位并清空 bucket;下次 compile 在新 device 上从零分配
 */

import type { TextureDesc } from './resourceDesc'
import type { ResourceLifetime } from './lifetimeAnalyzer'

/**
 * 池持有的一个物理 GPUTexture 槽位。wrapper 跨编译窗口持久;
 * 只有 inUseUntilIdx / inUseByName 调试字段每次 compile 变。
 * @internal
 */
export interface PooledTexture {
  texture: GPUTexture
  bucketKey: string
  /** 当前编译窗口中已分配逻辑资源的最后使用拓扑索引。-1 = 空闲(可被 firstUseIdx > inUseUntilIdx 的逻辑资源复用) */
  inUseUntilIdx: number
  inUseByName: string | null
  estimatedBytes: number
}

/**
 * 单次 assign() 的资源→物理映射快照。
 */
export interface TransientTextureAssignment {
  /** 逻辑资源名 → 池分配的物理 GPUTexture */
  bindings: Map<string, GPUTexture>
  /** 每名调试信息:落入哪个 bucket key,是否别名,是否专用 */
  debug: Map<string, { bucketKey: string; aliased: boolean; dedicated: boolean }>
}

/**
 * 瞬态图纹理的物理池,生命周期感知别名。
 *
 * 生命周期:
 *   compile() → LifetimeAnalyzer.analyze() → ResourceLifetime[]
 *             → pool.assign(lifetimes) → bindings Map
 *             → RenderGraphResourcePool 注册 () => binding
 *   execute() → ctx.getTexture(name) → 池解析的 GPUTexture
 *
 * 别名发生在**单个编译窗口内**:生命周期按 firstUseIdx 升序排;
 * 每个池找同 bucket 且 inUseUntilIdx < firstUseIdx 的条目复用,否则分配新 GPUTexture。
 * 跨编译窗口池保留所有已分配 wrapper —— 下次 assign() 重新洗牌哪个逻辑名映射到哪个物理槽位。
 * 专用槽(aliasable: false, mip 金字塔等)通过绑定到 bucket 复用池外的每名槽位保持 GPUTexture 身份跨窗口稳定。
 *
 * device-lost 时池调用 destroyGpuTexture() 销毁所有槽位并清空 bucket;
 * 下次 compile 在新 device 上从零分配。
 */
export class TransientTexturePool {
  private readonly _buckets = new Map<string, PooledTexture[]>()
  /** aliasable:false 资源的每名专用槽。绕过 bucket 复用,
   *  让消费者可针对稳定 GPUTexture 身份缓存 bind group */
  private readonly _dedicatedByName = new Map<string, PooledTexture>()
  private _currentBytes = 0
  private _peakBytes = 0

  /** 创建真实 GPUTexture 的回调(运行时注入;测试可缺省走元数据模式) */
  private readonly _createGpuTexture: (desc: GPUTextureDescriptor) => GPUTexture
  /** 销毁 GPUTexture 的回调(默认调用 texture.destroy()) */
  private readonly _destroyGpuTexture: (texture: GPUTexture) => void

  constructor(options: TransientTexturePoolOptions = {}) {
    this._createGpuTexture =
      options.createGpuTexture ?? ((desc) => deviceCreateTexture(desc))
    this._destroyGpuTexture = options.destroyGpuTexture ?? ((tex) => tex.destroy())
  }

  /**
   * 为每个瞬态生命周期分配(或复用)物理 wrapper。
   * 持久(导入)生命周期被忽略 —— 那些由 builder 在导入外部纹理时直接注册。
   */
  public assign(lifetimes: readonly ResourceLifetime[]): TransientTextureAssignment {
    // 新编译窗口重置 bucket 占用。wrapper 本身保活;inUse 标记重置
    for (const list of this._buckets.values()) {
      for (const pt of list) {
        pt.inUseUntilIdx = -1
        pt.inUseByName = null
      }
    }

    const bindings = new Map<string, GPUTexture>()
    const debug = new Map<string, { bucketKey: string; aliased: boolean; dedicated: boolean }>()

    // 仅处理瞬态纹理。持久(导入)条目由 builder 直接注册,不进 bucket map
    const texLifetimes = lifetimes.filter((lt) => lt.kind === 'texture' && !lt.persistent)

    // firstUseIdx 升序排 —— 最早开始生命周期先挑,留后开始的复用释放槽位。
    // 同分按名破平保证确定性
    const sorted = [...texLifetimes].sort((a, b) => {
      if (a.firstUseIdx !== b.firstUseIdx) return a.firstUseIdx - b.firstUseIdx
      return a.name < b.name ? -1 : 1
    })

    for (const lt of sorted) {
      const desc = lt.desc as TextureDesc
      const w = lt.resolvedWidth!
      const h = lt.resolvedHeight!
      const usage = lt.resolvedUsage
      if (!usage) {
        console.warn(
          `[RenderGraph] 瞬态纹理 '${lt.name}' resolved usage=0 —— ` +
            `无 read/write 访问 hint 记录,desc 也无显式 usage。` +
            `以 TEXTURE_BINDING 为安全默认分配。`,
        )
      }
      const finalUsage = usage || GPUTextureUsage.TEXTURE_BINDING
      const bucketKey = computeBucketKey(desc, w, h, finalUsage)
      const aliasable = desc.aliasable !== false

      let slot: PooledTexture
      let aliased = false
      let dedicated = false

      if (!aliasable) {
        // 跨编译窗口稳定身份。槽位在 bucket 复用 map 之外
        const existing = this._dedicatedByName.get(lt.name)
        if (existing && existing.bucketKey === bucketKey) {
          slot = existing
        } else if (existing && inPlaceResizable(existing.bucketKey, bucketKey)) {
          // 仅分辨率变了(canvas resize)。原地 resize wrapper 而非分配新 GPUTexture。
          // 专用槽存在正是为了让消费者(LitMaterial 的 transmission pass 等)能针对固定 GPUTexture 身份缓存 bind group;
          // resize 时替换 wrapper 会让那些 bind group 滞留在已销毁旧尺寸 GPUTexture 上,
          // 每帧后报 "Destroyed texture [...] used in a submit"。
          // 这里通过 destroy 老 + create 新实现"原地 resize"(WebGPU 不支持纹理原地 resize)
          this._currentBytes -= existing.estimatedBytes
          this._destroyGpuTexture(existing.texture)
          const newTex = this._createGpuTexture(makeDescriptor(desc, w, h, finalUsage, lt.name))
          existing.texture = newTex
          existing.bucketKey = bucketKey
          existing.estimatedBytes = estimateTextureBytes(desc, w, h)
          this._currentBytes += existing.estimatedBytes
          if (this._currentBytes > this._peakBytes) this._peakBytes = this._currentBytes
          slot = existing
        } else {
          // 无现存槽,或非尺寸属性(format / usage / layers / samples / mips)变了 ——
          // GPUTexture 本质不同,重新分配
          if (existing) this._destroySlot(existing)
          slot = this._allocateSlot(lt, desc, w, h, finalUsage, bucketKey)
          this._dedicatedByName.set(lt.name, slot)
        }
        dedicated = true
      } else {
        // 尝试复用同 bucket 中前一逻辑资源已结束的条目
        let bucket = this._buckets.get(bucketKey)
        if (!bucket) {
          bucket = []
          this._buckets.set(bucketKey, bucket)
        }
        const reused = this._findReusableSlot(bucket, lt.firstUseIdx)
        if (reused) {
          slot = reused
          aliased = slot.inUseByName !== null && slot.inUseByName !== lt.name
        } else {
          slot = this._allocateSlot(lt, desc, w, h, finalUsage, bucketKey)
          bucket.push(slot)
        }
        slot.inUseUntilIdx = lt.lastUseIdx
        slot.inUseByName = lt.name
      }

      bindings.set(lt.name, slot.texture)
      debug.set(lt.name, { bucketKey, aliased, dedicated })
    }

    // 清扫名字从活跃声明集消失的专用槽 —— 那些代表被移除或替换的 Pass。这里销毁保持内存对齐活图
    const liveDedicated = new Set(
      sorted.filter((lt) => (lt.desc as TextureDesc).aliasable === false).map((lt) => lt.name),
    )
    for (const [name, slot] of this._dedicatedByName) {
      if (!liveDedicated.has(name)) {
        this._destroySlot(slot)
        this._dedicatedByName.delete(name)
      }
    }

    // 清扫陈旧可别名 bucket。bucket key 编码 WxH(见 computeBucketKey),
    // canvas resize 把每个瞬态路由到新 key 的 bucket,留下上一尺寸的 bucket。
    // 标记在本次 pass 顶部重置为 null,只为本窗口 claim 的槽位重新设置,
    // 所以无 claim 槽位的 bucket 是活图不再引用的形状 —— 最常见是旧分辨率。
    // 不清理的话池按见过的每个不同尺寸保留一整套瞬态 GPUTexture,每次 resize 都泄漏 GPU 内存直到分配失败。
    // 活尺寸 bucket 保留所有槽位(含空闲别名余量)因为至少一个槽位在用
    for (const [key, list] of this._buckets) {
      if (!list.some((slot) => slot.inUseByName !== null)) {
        for (const slot of list) this._destroySlot(slot)
        this._buckets.delete(key)
      }
    }

    return { bindings, debug }
  }

  /** 销毁所有池化 wrapper。图销毁和 device-lost 时调用 */
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

  private _findReusableSlot(bucket: PooledTexture[], firstUseIdx: number): PooledTexture | null {
    // 优先选前一运行结束最久的槽位 —— 给跨 compile 的确定性打包,最小化 thrash。
    // 线性扫描可接受:bucket 受同形状最大并发资源限制(实际帧图通常 < 8)
    //
    // 注:Orillusion 原版有 `slot.inUseByName !== null` 检查会跳过本 assign 内已 claim 的槽位,
    // 但这与"同编译窗口内别名 disjoint 生命周期"的注释矛盾 —— res1 在 [0,1] 用完后,
    // res2 在 [2,3] 应能复用同槽位。这里去掉该检查,让别名真正按生命周期 disjoint 判断。
    let best: PooledTexture | null = null
    for (const slot of bucket) {
      if (slot.inUseUntilIdx >= firstUseIdx) continue // 上次分配重叠
      if (best === null || slot.inUseUntilIdx < best.inUseUntilIdx) best = slot
    }
    return best
  }

  private _allocateSlot(
    lt: ResourceLifetime,
    desc: TextureDesc,
    w: number,
    h: number,
    usage: number,
    bucketKey: string,
  ): PooledTexture {
    const texture = this._createGpuTexture(makeDescriptor(desc, w, h, usage, lt.name))
    const estimatedBytes = estimateTextureBytes(desc, w, h)
    this._currentBytes += estimatedBytes
    if (this._currentBytes > this._peakBytes) this._peakBytes = this._currentBytes
    return {
      texture,
      bucketKey,
      inUseUntilIdx: lt.lastUseIdx,
      inUseByName: lt.name,
      estimatedBytes,
    }
  }

  private _destroySlot(slot: PooledTexture): void {
    try {
      this._destroyGpuTexture(slot.texture)
    } catch {
      /* device-lost / 已销毁 */
    }
    this._currentBytes -= slot.estimatedBytes
    if (this._currentBytes < 0) this._currentBytes = 0
  }
}

/**
 * 池构造选项。
 */
export interface TransientTexturePoolOptions {
  /** 创建真实 GPUTexture 的函数(测试可省略走 fallback) */
  createGpuTexture?: (desc: GPUTextureDescriptor) => GPUTexture
  /** 销毁 GPUTexture 的函数(默认 texture.destroy()) */
  destroyGpuTexture?: (texture: GPUTexture) => void
}

/**
 * 组合 bucket key。两个生命周期只有 key 完全匹配才能别名 ——
 * 任何差异(format / 尺寸 / sample / layer / mip / usage)路由到独立 bucket。
 *
 * @internal
 */
export function computeBucketKey(desc: TextureDesc, w: number, h: number, usage: number): string {
  const mip = desc.mipLevelCount ?? 1
  const sample = desc.sampleCount ?? 0
  const layers = desc.numberLayer ?? 1
  return `${desc.format}|${w}x${h}|s${sample}|l${layers}|m${mip}|u${usage}`
}

/**
 * bucket key b 是否描述与 a 相同的纹理,只是原地 resize 可重建的属性不同 ——
 * 即仅 WxH 尺寸 token(索引 1)和 m<mip> mip 数 token(索引 4,金字塔是尺寸的函数)不同。
 * format / sample / layer / usage 在构造时固定,resize() 复用,所以那里任何差异都是真正形状变化需重新分配。
 * 为尺寸/mip-only 变化保持 wrapper 身份稳定让专用槽消费者(缓存材质 bind group)能在 canvas resize 后存活。
 *
 * @internal
 */
export function inPlaceResizable(a: string, b: string): boolean {
  if (a === b) return false
  const strip = (k: string) => {
    const p = k.split('|')
    p.splice(4, 1)
    p.splice(1, 1)
    return p.join('|')
  }
  return strip(a) === strip(b)
}

/**
 * HWM 记账的粗略尺寸估算。除非已知更好,否则每个格式按 4 bpp ——
 * 实际 GPU 占用取决于驱动 tiling,WebGPU 不可观察。
 *
 * @internal
 */
export function estimateTextureBytes(desc: TextureDesc, w: number, h: number): number {
  const bpp = bytesPerPixel(desc.format)
  const layers = desc.numberLayer ?? 1
  const samples = Math.max(1, desc.sampleCount ?? 0)
  const mips = desc.mipLevelCount ?? 1
  let total = 0
  let mw = w
  let mh = h
  for (let m = 0; m < mips; m++) {
    total += mw * mh * bpp * layers * samples
    mw = Math.max(1, mw >> 1)
    mh = Math.max(1, mh >> 1)
  }
  return total
}

function bytesPerPixel(format: GPUTextureFormat): number {
  // 粗分类 —— 引擎实际用于瞬态资源的 WebGPU 格式的精确字节数。未知格式回退 4 bpp
  switch (format) {
    case 'r8unorm':
    case 'r8snorm':
    case 'r8uint':
    case 'r8sint':
      return 1
    case 'r16uint':
    case 'r16sint':
    case 'r16float':
    case 'rg8unorm':
    case 'rg8snorm':
    case 'rg8uint':
    case 'rg8sint':
      return 2
    case 'r32uint':
    case 'r32sint':
    case 'r32float':
    case 'rg16uint':
    case 'rg16sint':
    case 'rg16float':
    case 'rgba8unorm':
    case 'rgba8unorm-srgb':
    case 'rgba8snorm':
    case 'rgba8uint':
    case 'rgba8sint':
    case 'bgra8unorm':
    case 'bgra8unorm-srgb':
    case 'rgb10a2unorm':
    case 'rg11b10ufloat':
    case 'depth24plus':
    case 'depth32float':
      return 4
    case 'rg32uint':
    case 'rg32sint':
    case 'rg32float':
    case 'rgba16uint':
    case 'rgba16sint':
    case 'rgba16float':
    case 'depth32float-stencil8':
      return 8
    case 'rgba32uint':
    case 'rgba32sint':
    case 'rgba32float':
      return 16
    default:
      return 4
  }
}

function makeDescriptor(
  desc: TextureDesc,
  w: number,
  h: number,
  usage: number,
  label: string,
): GPUTextureDescriptor {
  return {
    size: [w, h, desc.numberLayer ?? 1],
    format: desc.format,
    usage,
    mipLevelCount: desc.mipLevelCount ?? 1,
    sampleCount: Math.max(1, desc.sampleCount ?? 0),
    label: desc.label ?? label,
  }
}

/**
 * 无注入时的 fallback:尝试全局 device。仅用于元数据测试,
 * 真实运行时应始终注入 createGpuTexture。
 */
function deviceCreateTexture(_desc: GPUTextureDescriptor): GPUTexture {
  throw new Error(
    '[TransientTexturePool] 未注入 createGpuTexture,且无全局 device 可用。' +
      '请在构造池时提供 createGpuTexture 选项。',
  )
}
