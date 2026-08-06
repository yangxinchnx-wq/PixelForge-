/**
 * PixelForge - RenderGraph Pass 抽象(Step 40.5)
 *
 * 借鉴 Orillusion RenderGraphPass 设计,但剥离 3D 引擎耦合(View3D / Camera3D / EntityCollect 等),
 * 适配 PixelForge 的 2D 视觉引擎抽象。
 *
 * 一个 Pass 代表图中一项渲染能力。子类通过 name 标识身份,
 * 在 setup() 中分配 GPU 资源 + 声明依赖(b.read / b.write),
 * 在 execute() 中提交 GPU 工作。
 *
 * reads / writes / creates 在 RenderGraph.compile() 后由 setup() 填充
 * (setup 从 add() 延迟到下次 compile,所以 add() 调用顺序不约束资源依赖顺序)。
 * 它们在 add() 时是冻结的空数组,在 commit 时被替换为 setup 中记录的 b.read / b.write 名字。
 */

import type { AccessHint, BufferDesc, TextureDesc } from './transient/resourceDesc'
import type { BufferHandle, TextureHandle } from './transient/resourceHandle'

/**
 * Pass setup 阶段交给 Pass 的 builder。
 *
 * Pass 用它声明图级依赖(read)和产出(write)。
 *
 * write 的两种模式:
 * - 创建者 — write(name, factory)。调用 factory 分配资源,在池中注册到 name 下,
 *   并把 name 记入此 Pass 的 creates 集合。单创建者规则:每个 name 只能有一个 Pass 传 factory。
 * - 修改者 — write(name)。声明此 Pass 修改由别处创建的资源。多个 Pass 可声明无 factory 的 write;
 *   顺序由插入顺序决定。下游 read 看到最新写入者的状态。
 */
export interface RenderGraphBuilder {
  /**
   * 声明对命名资源的读依赖。命名句柄必须在此 Pass 执行前有创建者;
   * 验证器强制。
   *
   * 传 TextureHandle / BufferHandle(declareTexture / declareBuffer /
   * importExternalTexture / importExternalBuffer 的返回值)可对目标做类型检查,
   * 并把可选 access hint 贡献到资源最终的 GPUTextureUsage / GPUBufferUsage。
   * 字符串形式仍可用于通过 b.write(name, getter) 注册的遗留资源。
   */
  read(target: string | TextureHandle | BufferHandle, access?: AccessHint): void

  /**
   * 创建者重载:声明对 name 的写入,在池中注册 getter。
   * getter 在每次 pool.get(name) 时被调用 —— Pass 作者通常闭包一个局部变量 / 实例字段
   * 以稳定身份(eager 模式),或实现内部缓存按 resize 重建(lazy 模式)。
   * 返回 getter() 一次便于调用方使用。单创建者规则适用。
   */
  write<T>(name: string, getter: () => T): T

  /**
   * 修改者重载:声明此 Pass 写入已存在的命名资源(由其它 Pass 创建)。
   * 多修改者 OK;顺序按插入。
   *
   * Handle 形式贡献 access hint 到资源 usage 合并;字符串形式保留遗留行为。
   */
  write(target: string | TextureHandle | BufferHandle, access?: AccessHint): void

  /**
   * 合并 read + write,用于原地修改的资源(例如 compute pass 采样并写回同一 storage 纹理)。
   * 等价于先 b.read(target, access) 再 b.write(target, access) ——
   * 两个数组都会被填充,hint 被合并到资源 usage。
   */
  readWrite(target: TextureHandle | BufferHandle, access?: AccessHint): void

  /**
   * 声明此 Pass 拥有的瞬态纹理。
   * 图在编译后从池化物理槽位(可能与生命周期结束在自己开始之前的另一资源别名)分配底层 RenderTarget。
   * Pass 在 execute() 内通过 ctx.getTexture(name) 取实际纹理。
   *
   * 单创建者规则适用 —— 同名声明两次会抛。
   * declareTexture 把此 Pass 注册为资源的创建者,但不自动记录 read 或 write 访问 ——
   * Pass 作者必须跟随以下之一:
   *   - b.write(handle, hint) / b.read(handle, hint),或
   *   - b.readWrite(handle, hint)
   * 来声明 Pass 实际如何使用资源。hint ('sample'|'storage'|'attachment'|'copy')
   * 在 desc.usage === 'auto'(默认)时驱动最终 GPUTextureUsage 合并。
   * declareTexture 后无后续访问的视为孤儿声明,池会跳过分配并警告。
   */
  declareTexture(name: string, desc: TextureDesc): TextureHandle

  /**
   * 声明此 Pass 拥有的瞬态缓冲区。与 declareTexture 对称:
   * 只注册创建者,实际访问模式必须通过 b.read/write/readWrite 声明。
   * 池按 (rounded-pow2 size, usage) 分桶复用 buffer wrapper,按需 resizeBuffer 扩容。
   */
  declareBuffer(name: string, desc: BufferDesc): BufferHandle

  /**
   * 把外部拥有的 GPUTexture(封装为 RenderTarget)发布到 name 下作为持久资源
   * (不可别名,不池化分配)。用于生命周期在图外管理的纹理。
   * 返回 TextureHandle 供调用方使用类型化 read/write 重载。
   */
  importExternalTexture(name: string, tex: GPUTexture): TextureHandle

  /**
   * 把外部拥有的 GPUBuffer 发布为持久资源。与 importExternalTexture 对称。
   */
  importExternalBuffer(name: string, buf: GPUBuffer): BufferHandle

  /**
   * 声明对另一个 Pass(按 name)的显式顺序依赖,独立于任何 read/write 资源边。
   * 用于上游 Pass 产生副作用、下游 Pass 通过非图渠道消费的场景
   * (例如 GPU indirect buffer 通过 GlobalBindGroup 消费,或离屏 RT 被兄弟材质消费)。
   * 命名 Pass 必须已注册。
   *
   * 除拓扑边外,还把本 Pass 在编译调度中的位置定位到"紧贴其最新显式 dep 之后",
   * 即 dependsOn(X) 读作"把我调度到 X 旁边",而非仅仅"在 X 后面某处"。
   */
  dependsOn(passName: string): void

  /**
   * dependsOn 的可选依赖变体:如果名为 passName 的 Pass 已注册,加一条
   * <passName> → this 的顺序边;否则静默跳过。
   * 用于本 Pass 只在某上游 Pass 存在时才需要在其后运行、且不读不写其产出的场景。
   * 边被加上时携带与 dependsOn 相同的调度位移行为。
   */
  dependsOnIfPresent(passName: string): void
}

/**
 * 每帧交给 RenderGraphPass.execute 一次的运行时上下文。
 * get<T>(name) 通过图池解析命名句柄;graph 暴露出来让 Pass 查找兄弟 Pass
 * 做 RPC 风格调用。
 */
export interface RenderGraphPassContext {
  /** 拥有此图的 RenderGraph */
  readonly graph: import('./renderGraph').RenderGraph
  /** 帧序号 */
  readonly frameIndex: number
  /** 画布宽(用于 SizeSpec 解析后回传给 Pass 用) */
  readonly canvasWidth: number
  /** 画布高 */
  readonly canvasHeight: number

  /** 通过图池解析命名资源。 */
  get<T>(name: string): T

  /**
   * 按 name 解析 GPUTexture。返回瞬态资源对应的池分配物理纹理,
   * 或 importExternalTexture 注册的导入纹理。
   * 若 name 不是纹理类型抛错(验证器应在编译期捕获,这是运行期防御检查)。
   */
  getTexture(name: string | TextureHandle): GPUTexture

  /**
   * 按 name 解析 GPUBuffer。与 getTexture 对称。
   */
  getBuffer(name: string | BufferHandle): GPUBuffer
}

/**
 * 图中的一项渲染能力。子类通过 name 声明身份,
 * 在 setup 中分配 GPU 资源 + 声明依赖,在 execute 中提交 GPU 工作。
 *
 * reads / writes / creates 由 RenderGraph.compile 在 setup() 运行后填充
 * (setup 从 add() 延迟到下次 compile,所以 add() 调用顺序不约束资源依赖顺序)。
 * 它们在 add() 时是冻结的空数组,在 commit 时被替换为 setup 中记录的 b.read / b.write 名字。
 */
export abstract class RenderGraphPass {
  /** 唯一 Pass 标识。作为图节点键 + 错误消息引用 —— 推荐 PascalCase 以 Pass 结尾 */
  public abstract readonly name: string

  /**
   * 运行期 kill 开关。graph.disablePass(name) 翻转此位。
   * 被禁用的 Pass 在图中如同不存在:验证 + 拓扑排序前被过滤,execute 时跳过。
   * 禁用一个被其它启用 Pass 读取产出的 Pass 会让下次 compile() 抛 UnresolvedResourceError。
   */
  public enabled: boolean = true

  /**
   * 此 Pass 读取的资源名。在首个处理此 Pass 的 RenderGraph.compile() 时
   * 从 setup() 中的 b.read(...) 调用填充。编译前为冻结空数组。
   */
  public readonly reads!: readonly string[]

  /**
   * 此 Pass 写入的资源名(创建者 + 修改者合并)。在首个 compile() 时
   * 从 setup() 中的 b.write(...) 调用填充。编译前为冻结空数组。
   */
  public readonly writes!: readonly string[]

  /**
   * writes 的子集,本 Pass 是创建者(调用 b.write(name, factory) 而非 b.write(name))。
   * 验证器的单创建者规则在此集合上运行。
   */
  public readonly creates!: readonly string[]

  /**
   * 对其它 Pass 名的显式顺序依赖,通过 setup() 中的 b.dependsOn(name) 或
   * 直接赋值设置。每条加一条拓扑排序边 <name> → this,独立于资源边。
   * 用于图看不见的副作用依赖(indirect buffer、离屏 RT 经材质消费等)。
   *
   * 除边之外,这里的一条还会把本 Pass 在编译调度中定位到"紧贴最新 dep 之后",
   * 让后加入但有显式依赖的 Pass 跑在 dep 旁边而非队尾。
   * 参见 topoSort 的完整规则。
   */
  public dependencies?: ReadonlySet<string>

  /**
   * 分配 GPU 资源,通过 b.read / b.write 声明图级依赖。
   * 从 RenderGraph.compile() 调用 —— setup 从 add() 延迟,所以 add() 调用顺序
   * 不约束资源依赖顺序。前向引用(读后加入 Pass 创建的资源)通过 compile() 的多轮重试循环解析。
   */
  public setup(_b: RenderGraphBuilder): void {
    // 默认空实现
  }

  /**
   * 为一帧执行 Pass。实现通过 ctx.get('<name>') 读输入,提交 GPU 工作。
   */
  public abstract execute(ctx: RenderGraphPassContext): void

  /**
   * 可选的拆除钩子,从 graph.destroy() 调用 —— 释放 Pass 直接拥有的孤儿资源。
   */
  public destroy(): void {
    // 默认空实现
  }
}
