/**
 * PixelForge - RenderGraph 资源句柄(Step 40.5)
 *
 * 瞬态资源的品牌类型句柄。builder.declareTexture(name, desc) / declareBuffer(name, desc)
 * 在 setup() 中返回句柄;句柄只携带资源的逻辑名,绝不携带底层 GPU 资源。
 *
 * Pass 把句柄传入后续的 b.read(handle, hint) / b.write(handle, hint) / b.readWrite(handle, hint),
 * 让编译器能在编译期对访问目标做类型检查,与池里的裸字符串查找分离。
 *
 * 通过 unique symbol 属性做品牌,防止误把 TextureHandle 当 BufferHandle 用的编译期错误。
 * 品牌是幻影的 —— 没有运行时字段,内存表示就是 { name }。
 */

declare const __texBrand: unique symbol
declare const __bufBrand: unique symbol

/**
 * 瞬态(或导入)纹理资源的不可见句柄。
 * 传给 b.read / b.write / b.readWrite 声明访问,
 * 在 execute() 内通过 ctx.getTexture(handle.name) 解析到实际 RenderTarget。
 */
export interface TextureHandle {
  readonly [__texBrand]: void
  readonly name: string
}

/**
 * 瞬态(或导入)缓冲区资源的不可见句柄。与 TextureHandle 对称。
 */
export interface BufferHandle {
  readonly [__bufBrand]: void
  readonly name: string
}

/**
 * 内部辅助:铸造一个 TextureHandle。cast 是幻影品牌的代价;只有 builder 应该调用。
 * @internal
 */
export function makeTextureHandle(name: string): TextureHandle {
  return { name } as TextureHandle
}

/**
 * 内部辅助:铸造一个 BufferHandle。参见 makeTextureHandle。
 * @internal
 */
export function makeBufferHandle(name: string): BufferHandle {
  return { name } as BufferHandle
}

/**
 * 把 TextureHandle / BufferHandle 或裸字符串收窄到底层资源名。
 * builder 的 read/write 重载内部用,让实现走单一代码路径,不管调用方用了哪种形式。
 * @internal
 */
export function resourceName(target: string | TextureHandle | BufferHandle): string {
  return typeof target === 'string' ? target : target.name
}
