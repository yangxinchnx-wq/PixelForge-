/**
 * GpuResourceManager(Step 31.5)— WebGPU 资源生命周期 + 帧同步。
 *
 * 职责:
 * - 注册 / 注销 GPU 资源(buffer / texture / pipeline / bindGroup / sampler)
 * - 跟踪资源状态:active / released,自动调用 destroy()
 * - 帧同步:每帧结束前可选等待 GPU 队列完成(onSubmittedWorkDone)
 * - 资源指标:liveBufferBytes / liveTextureBytes / totalCreated / totalReleased
 * - 与 FrameScheduler 的 gpu-render phase 集成
 *
 * 设计:
 * - 不替代 RuntimeDeviceHandle,而是在其之上叠加资源追踪层
 * - 资源 id 由调用方提供(便于与 IR / artifact 对齐),或自动生成
 * - released 资源在下一帧统一销毁(避免渲染中销毁导致 GPU 错误)
 *
 * 用法:
 *   const mgr = new GpuResourceManager(device)
 *   mgr.registerBuffer('layer1.uniform', buffer, 256)
 *   ...
 *   mgr.release('layer1.uniform')
 *   mgr.endFrame()       // 真正销毁 released 资源
 *   await mgr.syncFrame() // 可选:等待 GPU 完成
 */
import type { RuntimeDeviceHandle } from './types'

// ============================================================================
// 1. 类型 — 资源种类 / 状态 / 条目
// ============================================================================

export type GpuResourceKind = 'buffer' | 'texture' | 'pipeline' | 'bindGroup' | 'sampler' | 'other'

export type GpuResourceState = 'active' | 'released'

/**
 * 资源句柄(buffer / texture 等都满足 { destroy: () => void })。
 */
export interface GpuResourceHandle {
  destroy: () => void
}

/**
 * 资源注册条目。
 */
export interface GpuResourceEntry {
  id: string
  kind: GpuResourceKind
  handle: GpuResourceHandle
  /** 创建时的字节大小(buffer / texture),用于指标统计 */
  bytes: number
  state: GpuResourceState
  createdAt: number
  releasedAt: number | null
  /** 标签(用于调试 / HUD 显示) */
  tag?: string
}

/**
 * GPU 资源指标(用于 HUD / 调试面板)。
 */
export interface GpuResourceMetrics {
  /** 当前活跃资源数 */
  liveCount: number
  /** 当前活跃 buffer 字节数 */
  liveBufferBytes: number
  /** 当前活跃 texture 字节数 */
  liveTextureBytes: number
  /** 累计创建资源数 */
  totalCreated: number
  /** 累计释放资源数 */
  totalReleased: number
  /** 本帧释放(待销毁)资源数 */
  pendingReleaseCount: number
  /** 累计帧同步次数 */
  syncCount: number
  /** 累计帧数 */
  frameCount: number
}

// ============================================================================
// 2. GpuResourceManager 类
// ============================================================================

/**
 * GpuResourceManager — WebGPU 资源生命周期追踪器。
 *
 * 在 RuntimeDeviceHandle 之上叠加资源注册表,提供:
 * - 资源注册 / 释放 / 强制销毁
 * - 帧边界:beginFrame / endFrame(released → 实际 destroy)
 * - 帧同步:syncFrame(await onSubmittedWorkDone)
 * - 指标查询:getMetrics
 */
export class GpuResourceManager {
  private device: RuntimeDeviceHandle
  private resources: Map<string, GpuResourceEntry> = new Map()
  private pendingDestroy: GpuResourceEntry[] = []
  private idCounter = 0
  private metrics: GpuResourceMetrics
  private autoSync: boolean

  constructor(
    device: RuntimeDeviceHandle,
    options: {
      /** 每帧 endFrame 后是否自动等待 GPU 完成(默认 false,由调用方控制) */
      autoSync?: boolean
    } = {},
  ) {
    this.device = device
    this.autoSync = options.autoSync ?? false
    this.metrics = {
      liveCount: 0,
      liveBufferBytes: 0,
      liveTextureBytes: 0,
      totalCreated: 0,
      totalReleased: 0,
      pendingReleaseCount: 0,
      syncCount: 0,
      frameCount: 0,
    }
  }

  // --------------------------------------------------------------------------
  // 2.1 资源注册 / 释放
  // --------------------------------------------------------------------------

  /**
   * 注册一个 GPU 资源。
   *
   * @param id    资源 id(若已存在则覆盖并销毁旧的)
   * @param kind  资源类型
   * @param handle 资源句柄(必须实现 destroy())
   * @param bytes 资源字节大小(用于指标统计,可选)
   * @param tag   调试标签(可选)
   */
  register(
    id: string,
    kind: GpuResourceKind,
    handle: GpuResourceHandle,
    bytes: number = 0,
    tag?: string,
  ): void {
    // 若 id 已存在,先释放旧资源
    if (this.resources.has(id)) {
      this.release(id)
    }
    const entry: GpuResourceEntry = {
      id,
      kind,
      handle,
      bytes,
      state: 'active',
      createdAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      releasedAt: null,
      tag,
    }
    this.resources.set(id, entry)
    this.metrics.totalCreated++
    this.recalcLiveMetrics()
  }

  /** 注册 buffer 的便捷方法 */
  registerBuffer(id: string, handle: GpuResourceHandle, bytes: number, tag?: string): void {
    this.register(id, 'buffer', handle, bytes, tag)
  }

  /** 注册 texture 的便捷方法 */
  registerTexture(id: string, handle: GpuResourceHandle, bytes: number, tag?: string): void {
    this.register(id, 'texture', handle, bytes, tag)
  }

  /** 注册 pipeline 的便捷方法 */
  registerPipeline(id: string, handle: GpuResourceHandle, tag?: string): void {
    this.register(id, 'pipeline', handle, 0, tag)
  }

  /** 注册 bindGroup 的便捷方法 */
  registerBindGroup(id: string, handle: GpuResourceHandle, tag?: string): void {
    this.register(id, 'bindGroup', handle, 0, tag)
  }

  /** 注册 sampler 的便捷方法 */
  registerSampler(id: string, handle: GpuResourceHandle, tag?: string): void {
    this.register(id, 'sampler', handle, 0, tag)
  }

  /**
   * 释放资源(标记为 released,延迟到 endFrame 时真正销毁)。
   *
   * @param id 资源 id
   * @returns 是否找到并释放
   */
  release(id: string): boolean {
    const entry = this.resources.get(id)
    if (!entry) return false
    if (entry.state === 'released') return true
    entry.state = 'released'
    entry.releasedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    this.pendingDestroy.push(entry)
    this.metrics.totalReleased++
    this.recalcLiveMetrics()
    return true
  }

  /**
   * 立即销毁资源(不等待 endFrame,慎用 — 可能在 GPU 仍在使用时销毁)。
   *
   * @param id 资源 id
   */
  forceDestroy(id: string): boolean {
    const entry = this.resources.get(id)
    if (!entry) return false
    try {
      entry.handle.destroy()
    } catch (e) {
      console.error('[GpuResourceManager] forceDestroy error:', e)
    }
    this.resources.delete(id)
    // 从 pendingDestroy 中移除
    const idx = this.pendingDestroy.indexOf(entry)
    if (idx >= 0) this.pendingDestroy.splice(idx, 1)
    this.recalcLiveMetrics()
    return true
  }

  /**
   * 批量释放匹配 tag 的所有资源。
   *
   * @param tag 标签
   * @returns 释放的资源数量
   */
  releaseByTag(tag: string): number {
    let count = 0
    for (const [id, entry] of this.resources) {
      if (entry.tag === tag && entry.state === 'active') {
        this.release(id)
        count++
      }
    }
    return count
  }

  /**
   * 销毁所有资源(用于 dispose / 重建场景)。
   */
  releaseAll(): void {
    for (const [id] of this.resources) {
      this.release(id)
    }
    this.flushPendingDestroy()
  }

  // --------------------------------------------------------------------------
  // 2.2 帧边界
  // --------------------------------------------------------------------------

  /**
   * 帧开始(目前仅记录,预留用于将来 per-frame 资源追踪)。
   */
  beginFrame(): void {
    // 预留:可在每帧开始时重置 per-frame 资源组
  }

  /**
   * 帧结束:销毁所有 released 资源。
   *
   * 在 FrameScheduler 的 gpu-render phase 结束后调用。
   */
  endFrame(): void {
    this.flushPendingDestroy()
    this.metrics.frameCount++
    if (this.autoSync) {
      void this.syncFrame()
    }
  }

  /**
   * 真正销毁 pendingDestroy 中的资源。
   */
  private flushPendingDestroy(): void {
    if (this.pendingDestroy.length === 0) return
    for (const entry of this.pendingDestroy) {
      try {
        entry.handle.destroy()
      } catch (e) {
        console.error('[GpuResourceManager] destroy error:', e)
      }
      this.resources.delete(entry.id)
    }
    this.pendingDestroy.length = 0
    this.metrics.pendingReleaseCount = 0
    this.recalcLiveMetrics()
  }

  // --------------------------------------------------------------------------
  // 2.3 帧同步
  // --------------------------------------------------------------------------

  /**
   * 等待 GPU 队列完成所有已提交命令。
   *
   * 用于:
   * - 像素回读前确保 GPU 渲染完成
   * - 资源销毁前确保 GPU 不再引用
   * - 帧同步(避免渲染撕裂)
   *
   * @returns Promise,resolve 时 GPU 已完成
   */
  async syncFrame(): Promise<void> {
    try {
      await this.device.queue.onSubmittedWorkDone()
    } catch (e) {
      console.error('[GpuResourceManager] syncFrame error:', e)
    }
    this.metrics.syncCount++
  }

  // --------------------------------------------------------------------------
  // 2.4 查询
  // --------------------------------------------------------------------------

  /** 获取资源条目(只读) */
  get(id: string): GpuResourceEntry | undefined {
    return this.resources.get(id)
  }

  /** 资源是否活跃 */
  isActive(id: string): boolean {
    const entry = this.resources.get(id)
    return !!entry && entry.state === 'active'
  }

  /** 当前活跃资源数 */
  getLiveCount(): number {
    let count = 0
    for (const entry of this.resources.values()) {
      if (entry.state === 'active') count++
    }
    return count
  }

  /** 获取指标快照 */
  getMetrics(): GpuResourceMetrics {
    return { ...this.metrics }
  }

  /** 列出所有资源条目(用于调试) */
  listEntries(): GpuResourceEntry[] {
    return Array.from(this.resources.values())
  }

  /** 重新计算 live 指标 */
  private recalcLiveMetrics(): void {
    let liveCount = 0
    let liveBufferBytes = 0
    let liveTextureBytes = 0
    for (const entry of this.resources.values()) {
      if (entry.state !== 'active') continue
      liveCount++
      if (entry.kind === 'buffer') liveBufferBytes += entry.bytes
      else if (entry.kind === 'texture') liveTextureBytes += entry.bytes
    }
    this.metrics.liveCount = liveCount
    this.metrics.liveBufferBytes = liveBufferBytes
    this.metrics.liveTextureBytes = liveTextureBytes
    this.metrics.pendingReleaseCount = this.pendingDestroy.length
  }

  // --------------------------------------------------------------------------
  // 2.5 生成 id
  // --------------------------------------------------------------------------

  /** 生成自动 id(若调用方未提供) */
  genId(prefix: string = 'gpu'): string {
    this.idCounter++
    return `${prefix}_${this.idCounter.toString(36)}`
  }
}

// ============================================================================
// 3. 便捷:创建绑定到 FrameScheduler gpu-render phase 的 manager
// ============================================================================

/**
 * GPU 帧渲染上下文 — 在 gpu-render phase 中传入回调。
 */
export interface GpuRenderContext {
  /** 当前帧序号(来自 FrameScheduler) */
  frameCount: number
  /** 距上一帧增量时间(秒) */
  dt: number
  /** 当前时间戳(毫秒) */
  now: number
  /** GPU 资源管理器 */
  resources: GpuResourceManager
}

/**
 * 创建一个 GpuResourceManager 并绑定到 FrameScheduler 的 gpu-render phase。
 *
 * @param scheduler 目标 FrameScheduler
 * @param device    RuntimeDeviceHandle
 * @param onRender  每帧 gpu-render 回调(在 resources.beginFrame / endFrame 之间调用)
 * @returns GpuResourceManager 实例
 *
 * @example
 *   const mgr = bindGpuRenderPhase(sched, device, (ctx) => {
 *     renderCurrentIR()  // 业务渲染逻辑
 *   })
 */
export function bindGpuRenderPhase(
  scheduler: import('./frameScheduler').FrameScheduler,
  device: RuntimeDeviceHandle,
  onRender: (ctx: GpuRenderContext) => void,
  options: { autoSync?: boolean } = {},
): GpuResourceManager {
  const mgr = new GpuResourceManager(device, { autoSync: options.autoSync })
  let frameCount = 0

  scheduler.setPhaseCallback('gpu-render', (dt, now) => {
    mgr.beginFrame()
    try {
      onRender({ frameCount, dt, now, resources: mgr })
    } catch (e) {
      console.error('[GpuRender] onRender error:', e)
    }
    mgr.endFrame()
    frameCount++
  })

  return mgr
}
