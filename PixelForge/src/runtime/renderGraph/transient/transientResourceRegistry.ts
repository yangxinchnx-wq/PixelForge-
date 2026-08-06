/**
 * PixelForge - RenderGraph 瞬态资源注册表(Step 40.5)
 *
 * 借鉴 Orillusion TransientResourceRegistry,适配 PixelForge 抽象(直接用 GPUTexture / GPUBuffer,
 * 而非 Orillusion 的 RenderTexture / GPUBufferBase 包装)。
 *
 * 每图一个收集器,收集瞬态资源声明 + 访问 hint。
 * 挂在 RenderGraph 上;在每 Pass 的 setup() 中(通过 RenderGraphBuilder)填充,
 * 由 LifetimeAnalyzer 在 RenderGraph.compile() 内消费。
 */

import type { AccessHint, BufferDesc, TextureDesc } from './resourceDesc'
import type { TransientResourceKind } from './types'
/**
 * 单条 b.declareTexture / b.declareBuffer / b.importExternalTexture / b.importExternalBuffer 调用的内部记录。
 * @internal
 */
export interface TransientResourceDeclaration {
  name: string
  kind: TransientResourceKind
  /** 传入的 desc。对导入资源,desc 是外部资源的尽力反射(分析器仍可分桶 / 报告) */
  desc: TextureDesc | BufferDesc
  /** importExternalTexture / importExternalBuffer 时为 true —— 池禁止别名且禁止分配;
   *  外部资源是唯一物理资源 */
  persistent: boolean
  /** 拥有此声明的 Pass(单创建者) */
  creatorPass: string
  /** persistent === true 时:池通过 getTexture / getBuffer 返回的外部拥有 GPU 资源 */
  externalTexture?: GPUTexture
  externalBuffer?: GPUBuffer
}

/**
 * 瞬态资源声明 + 访问 hint 的每图收集器。
 *
 * 挂在 RenderGraph 上作为 _transient。
 * 在每 Pass 的 setup() 中(通过 RenderGraphBuilder)填充,
 * 由 RenderGraph.compile() 内的 LifetimeAnalyzer 消费。
 *
 * 普通 Pass 的 b.read(name) / b.write(name)(无 access hint + 无 TextureHandle/BufferHandle target)
 * 仍走遗留 RenderGraphResourcePool,不触碰本注册表 —— 新 API 完全 opt-in。
 */
export class TransientResourceRegistry {
  /** 逻辑名 → 声明。单创建者:重声明同名抛 */
  private readonly _declarations = new Map<string, TransientResourceDeclaration>()
  /** 逻辑名 → 每条 read/write/readWrite access hint 贡献的 GPUTextureUsage / GPUBufferUsage 合并位掩码。
   *  与 desc 的显式 usage(非 'auto' 时)在分析器内合并 */
  private readonly _hintUsage = new Map<string, number>()

  /**
   * 注册瞬态纹理声明。
   * @throws 若 name 已声明(单创建者)
   */
  public declareTexture(name: string, desc: TextureDesc, creatorPass: string): void {
    this._assertUnique(name, creatorPass)
    this._declarations.set(name, {
      name,
      kind: 'texture',
      desc,
      persistent: false,
      creatorPass,
    })
  }

  /**
   * 注册瞬态缓冲区声明。
   * @throws 若 name 已声明
   */
  public declareBuffer(name: string, desc: BufferDesc, creatorPass: string): void {
    this._assertUnique(name, creatorPass)
    this._declarations.set(name, {
      name,
      kind: 'buffer',
      desc,
      persistent: false,
      creatorPass,
    })
  }

  /**
   * 注册外部拥有的 GPUTexture 为持久资源。
   * 池不分配、不别名、不销毁底层 GPU 纹理。
   * getTexture(name) 原样返回 tex。
   */
  public importExternalTexture(name: string, tex: GPUTexture, creatorPass: string): void {
    this._assertUnique(name, creatorPass)
    // 尽力反射 desc —— 分析器只用 desc 给瞬态资源分桶;持久条目完全跳过分配
    const label = (tex as unknown as { label?: string }).label ?? name
    this._declarations.set(name, {
      name,
      kind: 'texture',
      desc: {
        format: 'rgba8unorm', // 外部纹理格式外部决定,这里给一个占位
        width: 0, // 外部纹理尺寸外部决定
        height: 0,
        usage: 0,
        aliasable: false,
        label,
      },
      persistent: true,
      creatorPass,
      externalTexture: tex,
    })
  }

  /**
   * 注册外部拥有的 GPUBuffer 为持久资源。
   */
  public importExternalBuffer(name: string, buf: GPUBuffer, creatorPass: string): void {
    this._assertUnique(name, creatorPass)
    const label = (buf as unknown as { label?: string }).label ?? name
    this._declarations.set(name, {
      name,
      kind: 'buffer',
      desc: {
        size: buf.size ?? 0,
        usage: buf.usage ?? 0,
        aliasable: false,
        label,
      },
      persistent: true,
      creatorPass,
      externalBuffer: buf,
    })
  }

  /**
   * 为资源记录一条 read / write / readWrite 访问 hint。
   * hint bit 按 OR 合并入每名 hint usage map;
   * 分析器把它与 desc 的 usage(若 'auto')合并产生最终分配 usage。
   *
   * 不在本注册表的 target 静默跳过 —— 它们是遗留 b.write(name, getter) 资源,
   * 仅在 RenderGraphResourcePool 中,不参与瞬态分配。
   */
  public recordAccessHint(
    name: string,
    kind: TransientResourceKind,
    hint: AccessHint,
    mode: 'read' | 'write',
  ): void {
    if (!this._declarations.has(name)) return
    const prev = this._hintUsage.get(name) ?? 0
    this._hintUsage.set(name, prev | hintToUsageBit(kind, hint, mode))
  }

  /** 已注册声明的只读视图 */
  public get declarations(): ReadonlyMap<string, TransientResourceDeclaration> {
    return this._declarations
  }

  /** 每名 access hint 贡献的合并 usage */
  public hintUsageOf(name: string): number {
    return this._hintUsage.get(name) ?? 0
  }

  public has(name: string): boolean {
    return this._declarations.has(name)
  }

  public get(name: string): TransientResourceDeclaration | undefined {
    return this._declarations.get(name)
  }

  /**
   * 丢弃 name 的声明 + access hint。
   * 由 RenderGraph.remove() / replace() 调用,使重新加入的 Pass 可重新声明其输出
   * 而不触发单创建者检查。
   */
  public unregister(name: string): void {
    this._declarations.delete(name)
    this._hintUsage.delete(name)
  }

  /**
   * 丢弃全部声明 + hint。图销毁和 device-lost 时调用。
   */
  public dispose(): void {
    this._declarations.clear()
    this._hintUsage.clear()
  }

  private _assertUnique(name: string, creatorPass: string): void {
    const prior = this._declarations.get(name)
    if (prior) {
      throw new Error(
        `RenderGraph.transient: 资源 '${name}' 已被 Pass '${prior.creatorPass}' 声明 —— ` +
          `Pass '${creatorPass}' 必须用不同的名字。一个 name 只能被一个 Pass 声明/导入。`,
      )
    }
  }
}

/**
 * 把 AccessHint + 资源类型 + read/write 模式映射到对应 GPUTextureUsage / GPUBufferUsage 位。
 *
 * 每个 hint 额外为纹理贡献 COPY_SRC | COPY_DST(开发期 debug 复制方便);
 * buffer 同样拿到 COPY_SRC | COPY_DST。
 *
 * @internal
 */
export function hintToUsageBit(
  kind: TransientResourceKind,
  hint: AccessHint,
  mode: 'read' | 'write',
): number {
  if (kind === 'texture') {
    let bits = GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    switch (hint) {
      case 'sample':
        bits |= GPUTextureUsage.TEXTURE_BINDING
        break
      case 'storage':
        bits |= GPUTextureUsage.STORAGE_BINDING
        break
      case 'attachment':
        bits |= GPUTextureUsage.RENDER_ATTACHMENT
        break
      case 'copy':
        /* COPY_SRC/COPY_DST 已设 */
        break
    }
    return bits
  }
  // buffer
  let bits = GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
  switch (hint) {
    case 'sample':
    case 'attachment':
      // buffer 没有这些 usage;hint 在 COPY bit 之外是 no-op。
      // Pass 作者对非 storage buffer(uniform / vertex 等)应用 BufferDesc 的显式 usage 字段
      break
    case 'storage':
      // storage buffer 访问读写都 flavor STORAGE —— WebGPU 没有独立 STORAGE_READ
      bits |= GPUBufferUsage.STORAGE
      break
    case 'copy':
      // mode 决定方向;两者上面已设,开发期复制方便
      break
  }
  // mode 参数预留给未来收紧(例如 read-only 去掉 COPY_DST)。当前 no-op
  void mode
  return bits
}
