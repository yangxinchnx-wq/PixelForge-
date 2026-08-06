/**
 * PixelForge - RenderGraph 资源描述符(Step 40.5)
 *
 * 借鉴 Orillusion RenderGraph 的瞬态资源子系统设计,适配 PixelForge 的 2D 视觉引擎抽象。
 *
 * 本文件定义 Pass 在 setup() 阶段声明瞬态 GPU 资源时使用的描述符。
 * Pass 通过 builder.declareTexture(name, desc) / builder.declareBuffer(name, desc)
 * 声明对瞬态资源的需求,实际分配发生在图编译后,由物理池决定是否别名复用。
 */

/**
 * 符号化尺寸 token。
 *
 * 编译期对着画布尺寸解析,让 Pass 声明"画布大小的临时纹理"而不必在 setup 时知道具体分辨率。
 * 数值 → 字面像素(用于固定大小的查找表 / 阴影图等)。
 */
export type SizeSpec = number | 'screen' | 'screen/2' | 'screen/4' | 'screen/8'

/**
 * 每条 read / write / readWrite 边上的访问 hint。
 *
 * 编译器把这些 hint 合并到资源最终的 GPUTextureUsage 掩码里(当 desc.usage === 'auto' 时)。
 *
 * - 'sample'     → TEXTURE_BINDING
 * - 'storage'    → STORAGE_BINDING
 * - 'attachment' → RENDER_ATTACHMENT
 * - 'copy'       → COPY_SRC(读时)或 COPY_DST(写时)
 *
 * 每个 hint额外贡献 COPY_SRC | COPY_DST,给开发期 debug 复制行方便。
 */
export type AccessHint = 'sample' | 'storage' | 'attachment' | 'copy'

/**
 * 瞬态纹理的声明式描述。
 *
 * Pass 在 setup() 中把它交给 builder.declareTexture(name, desc);
 * 池在编译后分配(或别名)一个 RenderTarget,Pass 在 execute() 中通过
 * ctx.getTexture(name) 取出实际纹理。
 */
export interface TextureDesc {
  format: GPUTextureFormat
  /** 宽度 spec;'screen' 等会按编译期画布宽解析 */
  width: SizeSpec
  /** 高度 spec;'screen' 等会按编译期画布高解析 */
  height: SizeSpec
  /** mip 层数(默认 1)。>1 开启 mip 链模式 —— 注意 mip 链资源通常应 aliasable: false,
   *  因为缓存的 bind group 可能在编译窗口间存活并引用特定 mip 视图 */
  mipLevelCount?: number
  /** WebGPU 采样数;0 或 1 → 非 MSAA(默认 0) */
  sampleCount?: number
  /** 数组层数(>=1,默认 1) */
  numberLayer?: number
  /** 'auto'(默认)⇒ 编译器从每条 read/write/readWrite hint 合并最终 usage;
   *  否则是显式位掩码。即便显式给出,分析器仍会合并它看到的 hint,
   *  如果用户掩码缺失某 bit 会发 console.warn */
  usage?: GPUTextureUsageFlags | 'auto'
  /** false ⇒ 物理池禁止把此资源别名到其它资源。
   *  用于 mip 金字塔、历史纹理(TAA)、通过缓存 bind-group 视图消费的数组 ——
   *  任何 GPUTexture 身份需要跨编译窗口保持稳定的场景。默认 true */
  aliasable?: boolean
  /** 调试标签后缀,转发到底层 GPUTexture */
  label?: string
}

/**
 * 瞬态缓冲区的声明式描述。
 *
 * 池按 (roundedSize, usage) 分桶复用底层 GPUBuffer;
 * 如果复用的 buffer 小于新需求,通过 resizeBuffer 原地扩容。
 */
export interface BufferDesc {
  /** 字节大小。池向上取整到下一个 2 的幂以减少桶碎片化 */
  size: number
  usage: GPUBufferUsageFlags
  /** 默认 true */
  aliasable?: boolean
  label?: string
}
