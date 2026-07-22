/**
 * Render Target(Step 39.3)— 离屏渲染目标抽象。
 *
 * 核心问题:
 *   多 Pass 后处理链需要"中间纹理"作为每个 pass 的输入/输出。
 *   现有 output.ts 只提供单一输出纹理,无法做 ping-pong。
 *
 * 解决方案:
 *   RenderTarget 封装 "texture + view + descriptor",作为后处理 pass 的 I/O 单元。
 *   - 可由外部注入 GPU device 创建真实 GPUTexture(运行时)
 *   - 不提供 device 时仅创建元数据条目(测试用,对齐 TexturePool/BufferPool 模式)
 *
 * 设计要点:
 * - DM-5 强制格式:rgba8unorm(与 capability.ts STORAGE_TEXTURE_FORMAT 对齐)
 * - usage 默认含 STORAGE_BINDING | TEXTURE_BINDING | COPY_DST(与 createGraphGpuTexture 一致)
 * - 可选 RENDER_ATTACHMENT(若 pass 走 render path 而非 compute path)
 * - id + label 用于调试和日志
 * - 不持有 device 引用(由工厂函数注入)
 *
 * 与 RuntimeTextureBundle 的区别:
 * - RuntimeTextureBundle:顶层输出纹理(单例,canvas 呈现)
 * - RenderTarget:中间渲染目标(多实例,可复用,可池化)
 */

/**
 * RenderTarget 描述符。
 */
export interface RenderTargetDescriptor {
  width: number
  height: number
  /** 纹理格式(默认 'rgba8unorm',与 DM-5 强制格式一致) */
  format?: GPUTextureFormat
  /** GPUTextureUsageFlags(默认 STORAGE | TEXTURE_BINDING | COPY_DST) */
  usage?: number
  /** 标签(用于 GPU 调试) */
  label?: string
}

/**
 * 离屏渲染目标。
 *
 * - id:         唯一 ID(便于日志 / cache key)
 * - descriptor: 创建时的描述符(width + height + format + usage 参与 size 匹配)
 * - texture:    可选的真实 GPUTexture(测试环境可空)
 * - view:       可选的 GPUTextureView(由 texture.createView() 产生)
 * - inUse:      是否正在被某个 pass 使用(ping-pong 调度用)
 * - lastUsedAt: 最后使用时间戳(LRU 用)
 */
export interface RenderTarget {
  id: string
  descriptor: Required<RenderTargetDescriptor>
  texture?: GPUTexture
  view?: GPUTextureView
  inUse: boolean
  lastUsedAt: number
}

/**
 * 默认格式(DM-5 强制约束,对齐 capability.ts 的 STORAGE_TEXTURE_FORMAT)。
 */
export const DEFAULT_RT_FORMAT: GPUTextureFormat = 'rgba8unorm'

/**
 * 默认 usage flags(STORAGE | TEXTURE_BINDING | COPY_DST,与 createGraphGpuTexture 一致)。
 *
 * GPUTextureUsage 位掩码:
 *   COPY_SRC          = 4
 *   COPY_DST          = 8
 *   TEXTURE_BINDING   = 16
 *   STORAGE_BINDING   = 128
 *   RENDER_ATTACHMENT = 32
 */
export const DEFAULT_RT_USAGE = 8 | 16 | 128 // COPY_DST | TEXTURE_BINDING | STORAGE_BINDING

/**
 * RenderTarget 工厂选项。
 */
export interface RenderTargetFactoryOptions {
  /**
   * 创建真实 GPUTexture 的函数(可选)。
   * - 提供:create 时调用此函数产生 GPUTexture + view
   * - 不提供:仅创建元数据条目(测试用)
   */
  createGpuTexture?: (desc: Required<RenderTargetDescriptor>) => GPUTexture | undefined
  /** 销毁 GPUTexture 的函数(可选,默认调用 texture.destroy()) */
  destroyGpuTexture?: (texture: GPUTexture) => void
}

/**
 * 判断两个 RenderTargetDescriptor 是否尺寸兼容(可复用)。
 *
 * 复用条件:width + height + format + usage 完全相同。
 */
export function isCompatibleDescriptor(
  a: Required<RenderTargetDescriptor>,
  b: Required<RenderTargetDescriptor>,
): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.format === b.format &&
    a.usage === b.usage
  )
}

/**
 * 规范化 RenderTargetDescriptor(填充默认值)。
 */
export function normalizeDescriptor(
  desc: RenderTargetDescriptor,
  fallbackLabel?: string,
): Required<RenderTargetDescriptor> {
  return {
    width: desc.width,
    height: desc.height,
    format: desc.format ?? DEFAULT_RT_FORMAT,
    usage: desc.usage ?? DEFAULT_RT_USAGE,
    label: desc.label ?? fallbackLabel ?? `rt_${Date.now().toString(36)}`,
  }
}

/**
 * 创建一个 RenderTarget。
 *
 * @param id        唯一 ID
 * @param desc      描述符
 * @param options   工厂选项(含 GPU 创建函数)
 * @returns RenderTarget(inUse=true)
 */
export function createRenderTarget(
  id: string,
  desc: RenderTargetDescriptor,
  options: RenderTargetFactoryOptions = {},
): RenderTarget {
  const normalizedDesc = normalizeDescriptor(desc, `${id}_tex`)
  const texture = options.createGpuTexture?.(normalizedDesc)
  const view = texture?.createView()

  return {
    id,
    descriptor: normalizedDesc,
    texture,
    view,
    inUse: true,
    lastUsedAt: Date.now(),
  }
}

/**
 * 销毁 RenderTarget 的 GPU 资源。
 *
 * @param rt      RenderTarget
 * @param options 工厂选项(含 GPU 销毁函数)
 */
export function destroyRenderTarget(
  rt: RenderTarget,
  options: RenderTargetFactoryOptions = {},
): void {
  if (rt.texture) {
    if (options.destroyGpuTexture) {
      options.destroyGpuTexture(rt.texture)
    } else {
      rt.texture.destroy()
    }
  }
  rt.texture = undefined
  rt.view = undefined
  rt.inUse = false
}

/**
 * 标记 RenderTarget 为可复用(inUse=false)。
 */
export function releaseRenderTarget(rt: RenderTarget): void {
  rt.inUse = false
  rt.lastUsedAt = Date.now()
}

/**
 * 标记 RenderTarget 为使用中(inUse=true)。
 */
export function acquireRenderTarget(rt: RenderTarget): void {
  rt.inUse = true
  rt.lastUsedAt = Date.now()
}

/**
 * 计算 RenderTarget 占用的字节数(估算)。
 *
 * 注:rgba8unorm = 4 bytes/pixel;若含 mip 则 ×1.33,这里简化为单层。
 */
export function estimateRenderTargetBytes(rt: RenderTarget): number {
  return rt.descriptor.width * rt.descriptor.height * 4
}
