/**
 * PixelForge - RenderGraph 主类(Step 40.5)
 *
 * 借鉴 Orillusion RenderGraph 的核心架构与算法:
 * - 事务性 setup + 多轮重试机制(setup 引用未注册资源时丢弃 draft 重试,而非报错)
 * - 延迟 setup(add() 顺序不约束资源依赖顺序;前向引用通过多轮重试解析)
 * - 拓扑排序 + 单创建者验证
 * - 瞬态资源子系统(生命周期分析 + 别名池)
 *
 * 剥离 Orillusion 3D 耦合(View3D / Context3D / OcclusionSystem / RTResourceMap 等),
 * 适配 PixelForge 的 2D 视觉引擎抽象:
 * - GPU 注入式设计(createGpuTexture / createGpuBuffer / destroyGpu 回调注入,不持有 device)
 * - 画布尺寸通过 setCanvasSize 注入,而非通过 View3D
 * - execute 由调用方注入 PassContext(不绑定具体引擎对象)
 *
 * ## 热插拔契约
 *
 * 突变在帧间任意时刻安全。每个突变标记图脏,下次 compile() 重建;
 * 把一系列突变包在 beginUpdate / endUpdate 中合并。
 *
 * | Op | 对验证器 | 对池 |
 * |----|---------|------|
 * | add(Ctor) | 新 Pass 加入验证 + 拓扑 | Pass 的 b.write(name, getter) 注册 name |
 * | remove(name) | Pass 离开验证 + 拓扑;其输出消费者 compile 失败 | Pass 的 creates 取消注册 |
 * | replace(name, Ctor) | 旧离开,新加入 | 旧 creates 取消,新 setup() 注册 |
 * | disablePass(name) | Pass 如同被移除过滤 | 不变(getter 留着便于 enablePass 廉价) |
 * | enablePass(name) | Pass 重新进入验证 + 拓扑 | 不变 |
 *
 * 验证器视角 disable === remove —— 禁用一个被启用 Pass 读取产出的 Pass 会在下次 compile 抛
 * UnresolvedResourceError,而非 execute 时静默交付陈旧数据。
 * Disable 适合打算翻回来的临时关闭;remove 适合不再启用。
 */

import { GraphValidator, topoSort } from './graphValidator'
import { GraphCompileError } from './graphErrors'
import type { AccessHint, BufferDesc, TextureDesc } from './transient/resourceDesc'
import { makeBufferHandle, makeTextureHandle, resourceName } from './transient/resourceHandle'
import { LifetimeAnalyzer, type ResourceLifetime } from './transient/lifetimeAnalyzer'
import { TransientResourceRegistry } from './transient/transientResourceRegistry'
import {
  TransientTexturePool,
  type TransientTexturePoolOptions,
} from './transient/transientTexturePool'
import { TransientBufferPool, type TransientBufferPoolOptions } from './transient/transientBufferPool'
import type { BufferHandle, TextureHandle } from './transient/resourceHandle'
import { RenderGraphResourcePool, type ResourceKind } from './resourcePool'
import type { RenderGraphBuilder, RenderGraphPass, RenderGraphPassContext } from './renderGraphPass'

/**
 * Pass 元数据(在 add() 时打 stamp)。
 */
interface PassMeta {
  insertedOrder: number
  /** setup() 是否已运行并 commit?
   *  add() 时 false;首个处理此 Pass 的 compile() 翻 true。
   *  replace/remove 据此决定 Pass 是否真拥有池条目需释放 */
  setupDone: boolean
}

/**
 * setup() 引用了尚未注册的资源(或上游 Pass)时由事务性 builder 抛出的哨兵。
 * 当前尝试被回滚(draft 丢弃);_runPendingSetups 在其它 Pass 有机会发布缺失名字后重试。
 */
class _PendingSetupError extends Error {
  constructor(public readonly resourceName: string) {
    super(`RenderGraph: setup pending — '${resourceName}' 尚未注册。`)
    this.name = '_PendingSetupError'
  }
}

/**
 * 单次 setup 尝试的副作用缓冲。仅当 setup 完成不抛 _PendingSetupError 时由 _commitDraft commit;
 * pending 时丢弃,让 Pass 在后续轮次重试无残留状态。
 */
class _SetupDraft {
  reads: string[] = []
  writes: string[] = []
  creates: string[] = []
  deps: Set<string>
  /** name → would-be 池条目(commit 时覆盖真池) */
  poolEntries = new Map<string, { getter: () => unknown; kind: ResourceKind; persistent: boolean }>()
  /** name → 新分配 RT(在 commit 时加入 _renderTargets) */
  rtEntries = new Map<string, unknown>()
  /** name → 本尝试的瞬态 kind(便于 in-flight 单创建者 + recordAccessHint 可见性) */
  transientKinds = new Map<string, 'texture' | 'buffer'>()
  /** 延迟瞬态注册表 mutation(declare/import)。捕获为闭包,commit 时按 setup 顺序回放 */
  transientOps: Array<() => void> = []
  /** 延迟 access hint 记录(recordAccessHint) */
  hintOps: Array<() => void> = []

  constructor(initialDeps: Iterable<string> | undefined) {
    this.deps = new Set(initialDeps ?? [])
  }
}

/**
 * RenderGraph 构造选项。
 */
export interface RenderGraphOptions {
  /** 画布宽(用于 SizeSpec 解析;后续可通过 setCanvasSize 更新) */
  canvasWidth?: number
  /** 画布高 */
  canvasHeight?: number
  /** 瞬态纹理池选项(测试可省略走 fallback) */
  texturePoolOptions?: TransientTexturePoolOptions
  /** 瞬态 buffer 池选项 */
  bufferPoolOptions?: TransientBufferPoolOptions
}

/**
 * 用户面向的帧图。每个业务模块(如 multiPassPipeline / engine)持有一个,
 * 通过 setCanvasSize 注入画布尺寸,通过 add/replace/remove/disablePass/enablePass 管理 Pass,
 * 通过 compile + execute 驱动每帧。
 *
 * Pass 生命周期:
 *   graph.add(MyPass, ...args)
 *     → new MyPass(...args)            // ctor: 无 GPU 操作
 *     → (延迟;setup 在 compile 时运行)
 *     → graph.compile() (lazy)         // setup → validator → topoSort
 *       → pass.setup(builder)          // 声明 reads/writes/creates
 *     → pass.execute(ctx)              // 每帧,按拓扑顺序
 *     → pass.destroy()                 // graph.destroy() 或 remove() 时
 *
 * setup 延迟到 compile() 并以事务性 builder + 多轮迭代运行:
 * 一个读取了尚未 setup Pass 声明资源的 Pass 抛内部 _PendingSetupError,
 * 其 draft 丢弃,在其它 Pass commit 声明后重试。这让 add() 调用顺序无关紧要 ——
 * 拓扑排序仍从声明的 reads/writes/deps 选出正确 execute 顺序。
 */
export class RenderGraph {
  private readonly _pool: RenderGraphResourcePool
  private readonly _passes: RenderGraphPass[] = []
  private readonly _byName: Map<string, RenderGraphPass> = new Map()
  private readonly _transient: TransientResourceRegistry = new TransientResourceRegistry()
  private readonly _texturePool: TransientTexturePool
  private readonly _bufferPool: TransientBufferPool
  /** 最新生命周期分析输出。跨帧持有,便于未来 Phase 6 工作
   *  (storeOp='discard' 派生、debug dumpDot) 查询每资源区间而无需重跑 analyze */
  private _lifetimes: ResourceLifetime[] = []
  /** 当前编译窗口的逻辑名 → 池解析 GPUTexture。每次 compile 清空并从
   *  TransientTexturePool.assign 重填 */
  private _textureBindings: Map<string, GPUTexture> = new Map()
  private _bufferBindings: Map<string, GPUBuffer> = new Map()
  private _compiled: string[] | null = null
  private _dirty: boolean = true
  private _insertCounter: number = 0
  private _batchDepth: number = 0
  private _canvasWidth: number
  private _canvasHeight: number

  constructor(options: RenderGraphOptions = {}) {
    this._pool = new RenderGraphResourcePool()
    this._texturePool = new TransientTexturePool(options.texturePoolOptions)
    this._bufferPool = new TransientBufferPool(options.bufferPoolOptions)
    this._canvasWidth = options.canvasWidth ?? 1920
    this._canvasHeight = options.canvasHeight ?? 1080
  }

  /** 画布宽 */
  public get canvasWidth(): number {
    return this._canvasWidth
  }

  /** 画布高 */
  public get canvasHeight(): number {
    return this._canvasHeight
  }

  /** 更新画布尺寸。canvas resize 时调用 —— 让下次 compile 重解析
   *  'screen' / 'screen/2' 尺寸 token 并重分配同 bucket 新分辨率槽位 */
  public setCanvasSize(width: number, height: number): void {
    if (this._canvasWidth === width && this._canvasHeight === height) return
    this._canvasWidth = width
    this._canvasHeight = height
    this._dirty = true
  }

  /** 资源池(只读视图,用于工具 / 调试) */
  public get pool(): RenderGraphResourcePool {
    return this._pool
  }

  /** 已注册 Pass(只读) */
  public get passes(): readonly RenderGraphPass[] {
    return this._passes
  }

  /**
   * 构造 Pass 并排队等下次 compile()。factory 把 ctor 参数透传 new Ctor(...args);
   * Pass 的 setup() 不在此运行 —— 它在 compile 时运行,所以 add() 调用顺序独立于资源依赖顺序。
   *
   * 返回构造的 Pass 便于调用方按需持有引用 —— 但 add 后访问 Pass 的规范方式是
   * graph.getPass<T>(name)。注意 pass.reads/writes/creates 在首个 compile() 运行 setup 前是空数组。
   */
  public add<C extends new (...args: any[]) => RenderGraphPass>(
    Ctor: C,
    ...args: ConstructorParameters<C>
  ): InstanceType<C> {
    const pass = new Ctor(...args) as InstanceType<C>
    this._registerPending(pass)
    return pass
  }

  /**
   * 按 name 替换 Pass。替换排队等下次 compile() —— 同 add() 的延迟 setup 契约。
   * 旧 Pass 的 destroy() 立即调用,其拥有的资源句柄立即从池取消注册(仅当它已完成 setup,否则尚未拥有任何东西)。
   */
  public replace<C extends new (...args: any[]) => RenderGraphPass>(
    name: string,
    Ctor: C,
    ...args: ConstructorParameters<C>
  ): InstanceType<C> {
    const idx = this._passes.findIndex((p) => p.name === name)
    if (idx < 0) throw new Error(`RenderGraph.replace: Pass '${name}' 未找到。`)
    const prev = this._passes[idx]
    // 保留原插入顺序。replace 是"一个 Pass 原地换另一个",
    // insertedOrder 是 topoSort 链写入者 / 资源流边的单破平 key。不保留的话新 Pass 移到队尾,
    // 其输出的 mutator-writer(例如 SortedTransparentPass 修改 ColorPass 创建的 COLOR_BUFFER)
    // 相对翻转,产生假环
    const prevMeta = (prev as unknown as { [PASS_META]?: PassMeta })[PASS_META] as PassMeta | undefined
    prev.destroy()
    if (prevMeta?.setupDone) {
      for (const n of prev.creates) this._releaseCreated(n)
    }
    const pass = new Ctor(...args) as InstanceType<C>
    // 初始化空冻结数组 + meta,保留顺序
    Object.defineProperty(pass, 'reads', { value: Object.freeze([]), writable: false, configurable: true })
    Object.defineProperty(pass, 'writes', { value: Object.freeze([]), writable: false, configurable: true })
    Object.defineProperty(pass, 'creates', { value: Object.freeze([]), writable: false, configurable: true })
    ;(pass as unknown as { [PASS_META]: PassMeta })[PASS_META] = {
      insertedOrder: prevMeta?.insertedOrder ?? this._insertCounter++,
      setupDone: false,
    }
    this._passes.splice(idx, 1, pass)
    this._byName.delete(name)
    this._byName.set(pass.name, pass)
    this._dirty = true
    return pass
  }

  /**
   * 按 name 移除 Pass。幂等 —— name 未注册时返回 false(调用方可用于无条件清理)。
   * 命中时:pass.destroy() 运行,pass.creates 的每名从池丢弃,Pass 从图解链。
   * 下次 compile() 不带它重建,UnresolvedResourceError 为仍引用其输出的消费者抛出。
   */
  public remove(name: string): boolean {
    const idx = this._passes.findIndex((p) => p.name === name)
    if (idx < 0) return false
    const pass = this._passes[idx]
    const meta = (pass as unknown as { [PASS_META]?: PassMeta })[PASS_META] as PassMeta | undefined
    pass.destroy()
    // 仅当 Pass 真完成 setup 才释放池条目 —— 加后立即移除未 compile 的 Pass 尚未拥有任何东西
    if (meta?.setupDone) {
      for (const n of pass.creates) this._releaseCreated(n)
    }
    this._passes.splice(idx, 1)
    this._byName.delete(name)
    this._dirty = true
    return true
  }

  /**
   * 运行期 kill 开关。被禁用 Pass 如同不在图:不参与验证或拓扑排序,execute 时跳过。
   * 禁用一个被启用 Pass 读取产出的 Pass 会让下次 compile() 抛 UnresolvedResourceError。
   * 适合临时关闭打算翻回;{@link remove} 适合永久移除。
   */
  public disablePass(name: string): this {
    const p = this._byName.get(name)
    if (!p) throw new Error(`RenderGraph.disablePass: Pass '${name}' 未找到。`)
    if (p.enabled) {
      p.enabled = false
      this._dirty = true
    }
    return this
  }

  public enablePass(name: string): this {
    const p = this._byName.get(name)
    if (!p) throw new Error(`RenderGraph.enablePass: Pass '${name}' 未找到。`)
    if (!p.enabled) {
      p.enabled = true
      this._dirty = true
    }
    return this
  }

  /** 按 name 查 Pass */
  public getPass<T extends RenderGraphPass = RenderGraphPass>(name: string): T | null {
    return (this._byName.get(name) as T | undefined) ?? null
  }

  /**
   * 开突变批。compile() 在匹配 endUpdate() 运行前短路,所以一系列 add/remove/replace/disablePass/enablePass
   * 产生最多一次验证 + 拓扑排序。可重入:嵌套两个 beginUpdate 需两个 endUpdate 才 flush。
   * 批中 execute() 允许但跑上次编译顺序(忽略 in-flight 突变);要让新结构生效请 flush 后再下一帧。
   */
  public beginUpdate(): this {
    this._batchDepth++
    return this
  }

  /** 关闭 beginUpdate 开的批。最外层批关闭时若有突变则 compile() 运行 */
  public endUpdate(): this {
    if (this._batchDepth <= 0) {
      throw new Error('RenderGraph.endUpdate: 没有匹配的 beginUpdate。')
    }
    this._batchDepth--
    if (this._batchDepth === 0 && this._dirty) this.compile()
    return this
  }

  /**
   * 验证 + 拓扑排序。幂等 —— 自上次 compile 无突变时短路。验证失败抛 GraphCompileError 子类。
   *
   * 被禁用 Pass 在验证和拓扑排序前过滤 —— 验证器视角 disable === remove。
   * 这意味着禁用一个被启用 Pass 读取产出的 Pass 在此抛 UnresolvedResourceError,
   * 而非 execute 时静默留消费者陈旧/零数据。临时关闭用 disablePass + 所有读者也 disablePass;永久用 remove。
   */
  public compile(): void {
    if (this._batchDepth > 0) return
    if (!this._dirty && this._compiled) return
    // 为尚未处理的 Pass 跑 setup()。这是让 add() 调用顺序独立于资源依赖顺序的延迟 setup 步骤:
    // 前向引用内部抛 _PendingSetupError,draft 回滚,Pass 在后续轮次重试
    this._runPendingSetups()
    const activePasses = this._passes.filter((p) => p.enabled)
    const activeByName: Map<string, RenderGraphPass> = new Map()
    for (const p of activePasses) activeByName.set(p.name, p)
    const validator = new GraphValidator(activePasses)
    validator.validateSingleCreator()
    validator.validateResolvable()
    this._compiled = topoSort(activePasses, activeByName, this._insertedOrder.bind(this))

    // 瞬态池:对照刚编译顺序分析生命周期,然后请池分配物理 wrapper(别名)
    this._lifetimes = LifetimeAnalyzer.analyze(
      this._compiled,
      activeByName,
      this._transient,
      [this._canvasWidth, this._canvasHeight],
    )
    const texAssign = this._texturePool.assign(this._lifetimes)
    const bufAssign = this._bufferPool.assign(this._lifetimes)
    this._textureBindings = texAssign.bindings
    this._bufferBindings = bufAssign.bindings
    for (const [name, tex] of texAssign.bindings) {
      // 持久纹理在导入时注册为 () => tex 且不出现在 texAssign.bindings(池过滤掉持久)
      // 瞬态在此把占位 getter 换成解析后的 wrapper
      this._pool.register(name, () => tex, 'texture')
    }
    for (const [name, buf] of bufAssign.bindings) {
      this._pool.register(name, () => buf, 'buffer')
    }
    this._dirty = false
  }

  /**
   * 跑一帧。首次调用(或突变后)lazy compile。被禁用 Pass 跳过。
   *
   * @param frameIndex 帧序号
   * @param device 可选 GPUDevice(开发期 pushErrorScope 用)
   */
  public execute(frameIndex: number, device?: GPUDevice): void {
    this.compile()
    const order = this._compiled!
    const pool = this._pool
    const graph = this
    const ctx: RenderGraphPassContext = {
      graph,
      frameIndex,
      canvasWidth: this._canvasWidth,
      canvasHeight: this._canvasHeight,
      get<T>(name: string): T {
        return pool.get<T>(name)
      },
      getTexture(name: string | TextureHandle): GPUTexture {
        const n = resourceName(name)
        const kind = pool.kindOf(n)
        if (kind !== 'texture' && kind !== 'opaque') {
          // 'opaque' 覆盖遗留 b.write(name, getter) 纹理资源(kind 从未类型化)——
          // 接受它们让调用方可迁移到 ctx.getTexture 而不必先重新声明上游产出者
          throw new Error(
            `[RenderGraph.ctx.getTexture] '${n}' kind='${kind ?? 'unregistered'}',期望 'texture'。`,
          )
        }
        return pool.get<GPUTexture>(n)
      },
      getBuffer(name: string | BufferHandle): GPUBuffer {
        const n = resourceName(name)
        const kind = pool.kindOf(n)
        if (kind !== 'buffer' && kind !== 'opaque') {
          throw new Error(
            `[RenderGraph.ctx.getBuffer] '${n}' kind='${kind ?? 'unregistered'}',期望 'buffer'。`,
          )
        }
        return pool.get<GPUBuffer>(n)
      },
    }
    const devMode = Boolean(device)
    if (devMode && device) device.pushErrorScope('validation')
    for (const name of order) {
      const p = this._byName.get(name)!
      if (!p.enabled) continue
      p.execute(ctx)
    }
    if (devMode && device) {
      void device
        .popErrorScope()
        .then((err) => {
          if (err) {
            console.error(
              `[RenderGraph] 帧 ${frameIndex} 验证错误: ${err.message}。` +
                `Pass 顺序: ${order.join(' → ')}。`,
            )
          }
        })
        .catch(() => {
          /* device lost 或 scope 空 */
        })
    }
  }

  /**
   * 拆除所有 Pass + 资源池 + 瞬态池。
   */
  public destroy(): void {
    for (const p of this._passes) {
      try {
        p.destroy()
      } catch {
        /* 静默 */
      }
    }
    this._passes.length = 0
    this._byName.clear()
    this._pool.clear()
    this._transient.dispose()
    this._texturePool.dispose()
    this._bufferPool.dispose()
    this._textureBindings.clear()
    this._bufferBindings.clear()
    this._lifetimes = []
    this._compiled = null
    this._dirty = true
  }

  /**
   * 把 device-lost 后的清理委托给池。调用方在 device-lost 事件中调用此方法。
   */
  public handleDeviceLost(): void {
    this._pool.clear()
    this._texturePool.dispose()
    this._bufferPool.dispose()
    this._transient.dispose()
    this._textureBindings.clear()
    this._bufferBindings.clear()
    this._lifetimes = []
    this._compiled = null
    this._dirty = true
  }

  /** 当前瞬态纹理池统计 */
  public texturePoolStats() {
    return this._texturePool.stats()
  }

  /** 当前瞬态 buffer 池统计 */
  public bufferPoolStats() {
    return this._bufferPool.stats()
  }

  // ========================================================================
  // 内部:Pass 注册 + 延迟 setup + 事务性 builder
  // ========================================================================

  private _registerPending(pass: RenderGraphPass): void {
    if (this._byName.has(pass.name)) {
      throw new GraphCompileError(`RenderGraph: 重复 Pass 名 '${pass.name}'。`)
    }
    // 初始化空冻结数组 + meta
    Object.defineProperty(pass, 'reads', { value: Object.freeze([]), writable: false, configurable: true })
    Object.defineProperty(pass, 'writes', { value: Object.freeze([]), writable: false, configurable: true })
    Object.defineProperty(pass, 'creates', { value: Object.freeze([]), writable: false, configurable: true })
    ;(pass as unknown as { [PASS_META]: PassMeta })[PASS_META] = {
      insertedOrder: this._insertCounter++,
      setupDone: false,
    }
    this._passes.push(pass)
    this._byName.set(pass.name, pass)
    this._dirty = true
  }

  private _insertedOrder(p: RenderGraphPass): number {
    const meta = (p as unknown as { [PASS_META]?: PassMeta })[PASS_META] as PassMeta | undefined
    return meta?.insertedOrder ?? 0
  }

  /**
   * 为尚未跑 setup 的 Pass 跑 setup。多轮重试:
   * 引用未注册资源的 Pass 抛 _PendingSetupError,draft 丢弃;
   * 其它 Pass commit 后重试。最多 N 轮(N = Pass 数)。
   */
  private _runPendingSetups(): void {
    const pending = this._passes.filter((p) => {
      const meta = (p as unknown as { [PASS_META]?: PassMeta })[PASS_META] as PassMeta | undefined
      return !meta?.setupDone
    })
    if (pending.length === 0) return

    let remaining = [...pending]
    let attempts = 0
    const maxAttempts = pending.length + 1
    while (remaining.length > 0 && attempts < maxAttempts) {
      const nextRemaining: RenderGraphPass[] = []
      for (const pass of remaining) {
        const prevMeta = (pass as unknown as { [PASS_META]?: PassMeta })[PASS_META] as PassMeta | undefined
        const draft = new _SetupDraft(prevMeta ? undefined : pass.dependencies)
        const builder = this._makeBuilder(pass, draft)
        try {
          pass.setup(builder)
          this._commitDraft(pass, draft)
          const meta = (pass as unknown as { [PASS_META]: PassMeta })[PASS_META]
          meta.setupDone = true
        } catch (e) {
          if (e instanceof _PendingSetupError) {
            nextRemaining.push(pass)
          } else {
            throw e
          }
        }
      }
      remaining = nextRemaining
      attempts++
    }
    if (remaining.length > 0) {
      // 仍 pending 的 Pass 引用了不存在资源 —— 让验证器抛 UnresolvedResourceError
      // (走标准 compile 流程,validator 会给出清晰错误)
    }
  }

  private _commitDraft(pass: RenderGraphPass, draft: _SetupDraft): void {
    // 冻结 reads / writes / creates
    Object.defineProperty(pass, 'reads', { value: Object.freeze([...draft.reads]), writable: false, configurable: true })
    Object.defineProperty(pass, 'writes', { value: Object.freeze([...draft.writes]), writable: false, configurable: true })
    Object.defineProperty(pass, 'creates', { value: Object.freeze([...draft.creates]), writable: false, configurable: true })
    if (draft.deps.size > 0) {
      pass.dependencies = draft.deps
    }
    // 回放延迟瞬态 op
    for (const op of draft.transientOps) op()
    // 回放延迟 hint op
    for (const op of draft.hintOps) op()
    // 注册池条目
    for (const [name, entry] of draft.poolEntries) {
      this._pool.register(name, entry.getter, entry.kind)
      if (entry.persistent) this._pool.markPersistent(name)
    }
  }

  private _makeBuilder(pass: RenderGraphPass, draft: _SetupDraft): RenderGraphBuilder {
    const graph = this
    // mutator write 实现(创建者重载在下方包装)
    const mutatorWrite = (target: string | TextureHandle | BufferHandle, access?: AccessHint): void => {
      const name = resourceName(target)
      draft.writes.push(name)
      if (typeof target !== 'string' && access) {
        draft.hintOps.push(() => {
          const decl = graph._transient.get(name)
          if (decl) graph._transient.recordAccessHint(name, decl.kind, access, 'write')
        })
      }
    }
    // 创建者 + mutator 联合 write 实现
    const writeImpl = <T>(
      target: string | TextureHandle | BufferHandle,
      accessOrGetter?: AccessHint | (() => T),
    ): T | void => {
      if (typeof target === 'string' && typeof accessOrGetter === 'function') {
        // 创建者重载
        const name = target
        const getter = accessOrGetter as () => T
        draft.writes.push(name)
        draft.creates.push(name)
        draft.poolEntries.set(name, { getter: getter as unknown as () => unknown, kind: 'opaque', persistent: false })
        return getter()
      }
      // mutator 重载
      mutatorWrite(target, accessOrGetter as AccessHint | undefined)
      return
    }
    const builder = {
      read(target: string | TextureHandle | BufferHandle, access?: AccessHint): void {
        const name = resourceName(target)
        draft.reads.push(name)
        if (typeof target !== 'string' && access) {
          const kind = draft.transientKinds.get(name) ?? 'texture'
          draft.hintOps.push(() => {
            graph._transient.recordAccessHint(name, kind, access, 'read')
          })
        } else if (typeof target !== 'string' && access) {
          draft.hintOps.push(() => {
            const decl = graph._transient.get(name)
            if (decl) graph._transient.recordAccessHint(name, decl.kind, access, 'read')
          })
        }
        if (!graph._pool.has(name) && !draft.poolEntries.has(name) && !graph._transient.has(name)) {
          throw new _PendingSetupError(name)
        }
      },
      write: writeImpl as RenderGraphBuilder['write'],
      readWrite(target: TextureHandle | BufferHandle, access?: AccessHint): void {
        const name = resourceName(target)
        draft.reads.push(name)
        draft.writes.push(name)
        if (access) {
          draft.hintOps.push(() => {
            const decl = graph._transient.get(name)
            if (decl) {
              graph._transient.recordAccessHint(name, decl.kind, access, 'read')
              graph._transient.recordAccessHint(name, decl.kind, access, 'write')
            }
          })
        }
      },
      declareTexture(name: string, desc: TextureDesc): TextureHandle {
        draft.transientOps.push(() => {
          graph._transient.declareTexture(name, desc, pass.name)
        })
        draft.transientKinds.set(name, 'texture')
        draft.creates.push(name)
        draft.poolEntries.set(name, {
          getter: () => graph._textureBindings.get(name),
          kind: 'texture',
          persistent: false,
        })
        return makeTextureHandle(name)
      },
      declareBuffer(name: string, desc: BufferDesc): BufferHandle {
        draft.transientOps.push(() => {
          graph._transient.declareBuffer(name, desc, pass.name)
        })
        draft.transientKinds.set(name, 'buffer')
        draft.creates.push(name)
        draft.poolEntries.set(name, {
          getter: () => graph._bufferBindings.get(name),
          kind: 'buffer',
          persistent: false,
        })
        return makeBufferHandle(name)
      },
      importExternalTexture(name: string, tex: GPUTexture): TextureHandle {
        draft.transientOps.push(() => {
          graph._transient.importExternalTexture(name, tex, pass.name)
        })
        draft.creates.push(name)
        draft.poolEntries.set(name, {
          getter: () => graph._transient.get(name)?.externalTexture,
          kind: 'texture',
          persistent: true,
        })
        return makeTextureHandle(name)
      },
      importExternalBuffer(name: string, buf: GPUBuffer): BufferHandle {
        draft.transientOps.push(() => {
          graph._transient.importExternalBuffer(name, buf, pass.name)
        })
        draft.creates.push(name)
        draft.poolEntries.set(name, {
          getter: () => graph._transient.get(name)?.externalBuffer,
          kind: 'buffer',
          persistent: true,
        })
        return makeBufferHandle(name)
      },
      dependsOn(passName: string): void {
        if (!graph._byName.has(passName)) {
          throw new Error(`RenderGraph.dependsOn: Pass '${passName}' 未注册。`)
        }
        draft.deps.add(passName)
      },
      dependsOnIfPresent(passName: string): void {
        if (graph._byName.has(passName)) {
          draft.deps.add(passName)
        }
      },
    } as RenderGraphBuilder

    return builder
  }

  private _releaseCreated(name: string): void {
    this._pool.unregister(name)
    this._transient.unregister(name)
  }
}

/**
 * Pass 元数据 symbol key(内部)。
 */
const PASS_META = Symbol('RenderGraphPass.meta')
