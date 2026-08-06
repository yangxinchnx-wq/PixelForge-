/**
 * PixelForge - RenderGraph 资源池(Step 40.5)
 *
 * 借鉴 Orillusion RenderGraphResourcePool,适配 PixelForge 抽象。
 *
 * 简单 name → getter 注册表,带可选 kind 边车。
 * 资源由其创建者 Pass(或 RTResourceMap 等外部子系统)拥有;本池只把字符串句柄映射到 () => T 查找,
 * 让其它 Pass 在 execute 时通过 ctx.get(name) 解析依赖。
 *
 * 每图一个池。Pass.setup 通过 RenderGraphBuilder.write(name, factory) 填充
 * (factory 返回被捕获进 getter,getter 始终返回同一实例),
 * 或通过类型化 builder(b.createRenderTarget 等,同时打 kind)。
 */

/**
 * 池条目的类型化 kind 标签。让验证器区分"你试图在非 RT 句柄上开 render pass"
 * 和单纯写错名字查找。
 *
 * - 'opaque': 遗留/无类型句柄(历史 b.write(name, factory) 不走类型 helper 时的默认)
 * - 'texture' / 'buffer': 类型化普通资源
 * - 'rendertarget': b.createRenderTarget / b.adoptRenderTarget 发布;b.useRenderTarget 消费
 */
export type ResourceKind = 'opaque' | 'texture' | 'buffer' | 'rendertarget'

/**
 * 简单 name → getter 注册表,带可选 kind 边车。
 *
 * 资源由创建者 Pass(或外部子系统)拥有;本池只把字符串句柄映射到 () => T 查找。
 */
export class RenderGraphResourcePool {
  private readonly _registry: Map<string, () => unknown> = new Map()
  private readonly _kinds: Map<string, ResourceKind> = new Map()
  /** 边车标记哪些资源是持久(外部拥有,不别名/不池化分配)。
   *  瞬态子系统在 LifetimeAnalyzer + 池分配时跳过这些;工具用此渲染导入句柄以示区别 */
  private readonly _persistent: Set<string> = new Set()

  /**
   * 在 name 下注册 getter。后续 get(name) / has(name) 通过此 getter 解析。
   * 同名重复调用覆盖前 getter —— 图的单创建者验证器捕获生产场景;
   * 测试中便于替换 fake。
   * 可选 kind 默认 'opaque' 让早于类型 builder 的现存调用点继续工作。
   */
  public register(name: string, getter: () => unknown, kind: ResourceKind = 'opaque'): void {
    this._registry.set(name, getter)
    this._kinds.set(name, kind)
  }

  /**
   * 把 name 标记为持久 —— 瞬态池不为其分配或别名 wrapper。
   * 持久标记独立于 kind tag:任何 kind 都可标记持久。
   * 对未注册 name 调用仍记录标记(在 register 时 set)。
   */
  public markPersistent(name: string): void {
    this._persistent.add(name)
  }

  public isPersistent(name: string): boolean {
    return this._persistent.has(name)
  }

  /** name 是否已注册 */
  public has(name: string): boolean {
    return this._registry.has(name)
  }

  /** name 的 kind,未注册时 undefined */
  public kindOf(name: string): ResourceKind | undefined {
    return this._kinds.get(name)
  }

  /** 通过 getter 解析 name。未注册抛错 */
  public get<T>(name: string): T {
    const getter = this._registry.get(name)
    if (!getter) {
      throw new Error(`RenderGraphResourcePool: 资源 '${name}' 未注册。`)
    }
    return getter() as T
  }

  /** 取消注册 name(从 graph.remove / replace 调用,让重新加入 Pass 可重新声明) */
  public unregister(name: string): void {
    this._registry.delete(name)
    this._kinds.delete(name)
    this._persistent.delete(name)
  }

  /** 清空全部注册。图销毁时调用 */
  public clear(): void {
    this._registry.clear()
    this._kinds.clear()
    this._persistent.clear()
  }

  /** 已注册名(只读视图,用于调试 / 工具) */
  public get names(): IterableIterator<string> {
    return this._registry.keys()
  }
}
