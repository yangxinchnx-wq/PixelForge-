/**
 * PixelForge - RenderGraph 生命周期分析器(Step 40.5)
 *
 * 借鉴 Orillusion LifetimeAnalyzer,纯函数实现,零 GPU 依赖。
 *
 * 编译期对 TransientResourceRegistry 的声明 + 编译后的 Pass 顺序做生命周期分析。
 * 由 RenderGraph.compile() 在 topoSort 后立即调用;输出驱动瞬态纹理 + 缓冲区池。
 *
 * 分析器走拓扑顺序,从每个 Pass 的 reads / writes 数组更新每个资源的
 * [firstUseIdx, lastUseIdx] 包络。
 */

import type { RenderGraphPass } from '../renderGraphPass'
import type { BufferDesc, SizeSpec, TextureDesc } from './resourceDesc'
import type { TransientResourceRegistry, TransientResourceDeclaration } from './transientResourceRegistry'
import type { TransientResourceKind } from './types'

/**
 * 每资源的分析结果。瞬态池消费这些决定别名(同 bucket key + 不相交 [firstUseIdx, lastUseIdx]
 * 区间可共享物理 wrapper)和最终分配。
 */
export interface ResourceLifetime {
  name: string
  kind: TransientResourceKind
  /** 传入的 desc(原样,分析器不修改) */
  desc: TextureDesc | BufferDesc
  /** 拓扑排序后 Pass 顺序中此资源首次被写或读的索引。
   *  无任何启用 Pass 引用时为 Number.POSITIVE_INFINITY —— 分析器对这种"孤儿"声明发 console.warn */
  firstUseIdx: number
  /** 此资源最后一次被引用的索引。无启用 Pass 引用时为 -1 */
  lastUseIdx: number
  /** 最终合并的 GPUTextureUsage / GPUBufferUsage 位掩码
   *  (desc.usage 与所有访问 hint 贡献合并) */
  resolvedUsage: number
  /** 解析后的像素宽(仅纹理)。buffer 时 undefined */
  resolvedWidth?: number
  /** 解析后的像素高(仅纹理)。buffer 时 undefined */
  resolvedHeight?: number
  /** 解析后的字节大小(仅 buffer)。纹理时 undefined */
  resolvedSize?: number
  /** true ⇒ 外部拥有(导入)或显式 aliasable: false。
   *  池禁止把它与同 bucket 其它生命周期别名 */
  persistent: boolean
}

/**
 * 编译期生命周期分析。
 *
 * 在 TransientResourceRegistry 的声明和编译后 Pass 顺序上运行。
 * 由 RenderGraph.compile() 在 topoSort 后立即调用,输出驱动瞬态纹理 + buffer 池。
 *
 * 分析器走拓扑顺序,从每个 Pass 的 reads / writes 数组更新每个资源的 [firstUseIdx, lastUseIdx] 包络。
 */
export class LifetimeAnalyzer {
  /**
   * 分析一个编译窗口。
   *
   * @param order topoSort 输出的 Pass 名顺序
   * @param byName Pass 查找 map
   * @param registry setup 期间填充的每图瞬态注册表
   * @param presentationSize 拥有视图画布的 [宽, 高]。用于解析 'screen' / 'screen/2' 尺寸 token
   */
  public static analyze(
    order: readonly string[],
    byName: ReadonlyMap<string, RenderGraphPass>,
    registry: TransientResourceRegistry,
    presentationSize: readonly [number, number],
  ): ResourceLifetime[] {
    const lifetimes = new Map<string, ResourceLifetime>()

    // 每声明种一个 ResourceLifetime。持久条目预先给完整包络;
    // 瞬态条目起步空包络,在 walk 中扩宽
    for (const [name, decl] of registry.declarations) {
      lifetimes.set(name, seedLifetime(decl, order.length))
    }

    // 走 order,为每条 read/write 扩宽包络
    for (let i = 0; i < order.length; i++) {
      const pass = byName.get(order[i])
      if (!pass) continue
      widenAll(pass.reads, i, lifetimes)
      widenAll(pass.writes, i, lifetimes)
    }

    // 解析 size token 和最终 usage
    const out: ResourceLifetime[] = []
    for (const lt of lifetimes.values()) {
      // 持久资源即使没有 Pass 按名引用也保留预置的完整包络 ——
      // 这是通过材质后门消费的采用 GBuffer 纹理的预期情况
      if (!lt.persistent && lt.lastUseIdx < 0) {
        console.warn(
          `[RenderGraph] 瞬态资源 '${lt.name}' 已声明但本编译窗口无人使用 —— ` +
            `没有启用 Pass 读写它。跳过池分配。`,
        )
        continue
      }
      resolveSizeAndUsage(lt, registry, presentationSize)
      out.push(lt)
    }
    return out
  }
}

function seedLifetime(decl: TransientResourceDeclaration, orderLength: number): ResourceLifetime {
  // persistent 这里指"外部拥有,池禁止分配" —— 仅 importExternalTexture / importExternalBuffer 为 true。
  // aliasable: false 是不同关注点:池仍分配(并跟踪生命周期 + 尺寸),只是拒绝与其它生命周期共享 wrapper。
  // 专用路径在 TransientTexturePool 内处理
  const persistent = decl.persistent
  const firstUseIdx = decl.persistent ? 0 : Number.POSITIVE_INFINITY
  const lastUseIdx = decl.persistent ? Math.max(0, orderLength - 1) : -1
  return {
    name: decl.name,
    kind: decl.kind,
    desc: decl.desc,
    firstUseIdx,
    lastUseIdx,
    resolvedUsage: 0,
    persistent,
  }
}

function widenAll(names: readonly string[], passIdx: number, lifetimes: Map<string, ResourceLifetime>): void {
  for (const n of names) {
    const lt = lifetimes.get(n)
    if (!lt) continue
    if (passIdx < lt.firstUseIdx) lt.firstUseIdx = passIdx
    if (passIdx > lt.lastUseIdx) lt.lastUseIdx = passIdx
  }
}

function resolveSizeAndUsage(
  lt: ResourceLifetime,
  registry: TransientResourceRegistry,
  presentationSize: readonly [number, number],
): void {
  if (lt.kind === 'texture') {
    const desc = lt.desc as TextureDesc
    lt.resolvedWidth = resolveSizeSpec(desc.width, presentationSize[0])
    lt.resolvedHeight = resolveSizeSpec(desc.height, presentationSize[1])
  } else {
    const desc = lt.desc as BufferDesc
    lt.resolvedSize = desc.size
  }

  const hintBits = registry.hintUsageOf(lt.name)
  const explicit = (lt.desc as TextureDesc | BufferDesc).usage
  if (typeof explicit === 'number') {
    lt.resolvedUsage = explicit | hintBits
    // 调用者写了显式掩码但漏了 hint 要求的 bit 时 warn —— 合并是宽松的(掩码仍拿到漏 bit),
    // 但分歧通常意味着调用者对资源使用的心理模型过时
    const missing = hintBits & ~explicit
    if (missing !== 0) {
      console.warn(
        `[RenderGraph] 瞬态 '${lt.name}' 显式 usage 0x${explicit.toString(16)} ` +
          `缺失 hint 要求的 bit 0x${missing.toString(16)}。` +
          `最终 usage 为 0x${lt.resolvedUsage.toString(16)} —— 考虑切到 usage:'auto' 或扩展显式掩码。`,
      )
    }
  } else {
    // 'auto' 或 undefined: 仅用 hint 派生 bit
    // 空 hint(无 read/write with intent)留 usage = 0,池检测到并报告为畸形声明
    lt.resolvedUsage = hintBits
  }
}

/**
 * 按 canvas 维度解析 SizeSpec token。数值 spec 原样过;
 * 符号 token 把 canvas 维度除以对应分母。
 *
 * @internal
 */
export function resolveSizeSpec(spec: SizeSpec, canvasDim: number): number {
  if (typeof spec === 'number') return Math.max(1, Math.floor(spec))
  switch (spec) {
    case 'screen':
      return Math.max(1, Math.floor(canvasDim))
    case 'screen/2':
      return Math.max(1, Math.floor(canvasDim / 2))
    case 'screen/4':
      return Math.max(1, Math.floor(canvasDim / 4))
    case 'screen/8':
      return Math.max(1, Math.floor(canvasDim / 8))
  }
  // 穷尽守卫 —— SizeSpec 是唯一输入类型时不可达,防御未来新增
  throw new Error(`[RenderGraph] 未知 SizeSpec: ${String(spec)}`)
}
