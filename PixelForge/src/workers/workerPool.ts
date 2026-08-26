/**
 * PixelForge - Worker Pool（骨架 §2.1 workers/ + Phase C）
 *
 * 动态管理 Web Worker 线程池，将 L1 编译任务分发到后台线程执行。
 *
 * 设计原则：
 *   - Worker 数量基于 navigator.hardwareConcurrency 动态裁剪
 *   - 不假设 24 线程（实施优先级重排版 §2 Phase C 验收标准）
 *   - 最小 1 个 Worker，最大 8 个 Worker
 *   - Worker 不可用时自动降级为主线程编译（不阻塞功能）
 *   - 任务队列：当所有 Worker 忙时，新任务排队等待
 *
 * 性能考量：
 *   - 编译（compileRenderIRToRegionArtifact）是纯 CPU 操作，适合并行化
 *   - Worker 间不共享状态，每个编译任务独立
 *   - TypedArray 通过 Transferable 传输，避免拷贝开销
 */

import { compileRenderIRToRegionArtifact } from '@/compiler/region/regionCompiler'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { CompileRequest, WorkerResponse } from './tileWorker'

// ============================================================================
// 常量
// ============================================================================

/** 最大 Worker 数量（不超过硬件并发数，也不超过此上限） */
const MAX_WORKERS = 8

/** 最小 Worker 数量 */
const MIN_WORKERS = 1

/**
 * 单次编译任务超时（毫秒）。
 *
 * Worker 无响应（脚本崩溃 / 消息丢失 / postMessage 序列化异常）时，
 * 超时的任务会被 reject，调用方（renderCurrentIR）降级为主线程编译，
 * 保证渲染流程永不因单个 Worker 故障而挂起。
 */
const COMPILE_TIMEOUT_MS = 10_000

/**
 * 根据硬件并发数计算 Worker 数量。
 *
 * 策略：
 *   - navigator.hardwareConcurrency 不可用时默认 2
 *   - 取 hardwareConcurrency 的一半（留一半给主线程 + GPU）
 *   - 裁剪到 [MIN_WORKERS, MAX_WORKERS] 范围
 */
function computeWorkerCount(): number {
  if (typeof navigator === 'undefined' || !navigator.hardwareConcurrency) {
    return 2
  }
  const half = Math.floor(navigator.hardwareConcurrency / 2)
  return Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, half))
}

// ============================================================================
// Worker Pool 实现
// ============================================================================

interface PendingTask {
  id: number
  ir: RenderIR
  resolve: (artifact: RegionCompileArtifact) => void
  reject: (error: Error) => void
}

interface PendingResolver {
  resolve: (artifact: RegionCompileArtifact) => void
  reject: (error: Error) => void
  /** 分发到的 worker 下标（错误时用于反查该 worker 上挂起的任务） */
  workerIndex: number
}

/**
 * Worker Pool 单例。
 *
 * 使用方式：
 *   const pool = getWorkerPool()
 *   const artifact = await pool.compile(ir)
 */
class WorkerPool {
  private workers: Worker[] = []
  private busy: boolean[] = []
  private queue: PendingTask[] = []
  private nextTaskId = 0
  private _isAvailable: boolean = false
  private _workerCount: number = 0
  private initialized = false

  /**
   * 惰性初始化 Worker Pool。
   *
   * 在首次 compile() 调用时执行：
   *   - 检测 Worker 是否可用
   *   - 创建 Worker 实例
   *   - 标记为可用
   */
  private ensureInitialized(): void {
    if (this.initialized) return
    this.initialized = true

    // 检测 Worker API 是否可用
    if (typeof Worker === 'undefined') {
      this._isAvailable = false
      this._workerCount = 0
      return
    }

    try {
      const count = computeWorkerCount()
      for (let i = 0; i < count; i++) {
        const worker = new Worker(
          new URL('./tileWorker.ts', import.meta.url),
          { type: 'module' },
        )
        worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(i, e.data)
        }
        worker.onerror = (e) => {
          this.handleWorkerError(i, e)
        }
        this.workers.push(worker)
        this.busy.push(false)
      }
      this._isAvailable = true
      this._workerCount = count
    } catch {
      // Worker 创建失败（可能是测试环境或 CSP 限制）
      this._isAvailable = false
      this._workerCount = 0
      // 清理已创建的 Worker
      for (const w of this.workers) {
        w.terminate()
      }
      this.workers = []
      this.busy = []
    }
  }

  /**
   * 编译 RenderIR → RegionCompileArtifact。
   *
   * - Worker 可用时：分发到空闲 Worker 执行
   * - Worker 不可用时：降级为主线程同步编译
   *
   * @param ir 待编译的 RenderIR
   * @returns 编译产物 RegionCompileArtifact
   */
  async compile(ir: RenderIR): Promise<RegionCompileArtifact> {
    this.ensureInitialized()

    // Worker 不可用 → 主线程降级编译
    if (!this._isAvailable) {
      return compileRenderIRToRegionArtifact(ir)
    }

    // 查找空闲 Worker
    const freeIndex = this.busy.indexOf(false)
    if (freeIndex >= 0) {
      return this.dispatchToWorker(freeIndex, ir)
    }

    // 所有 Worker 忙 → 排队等待
    return new Promise<RegionCompileArtifact>((resolve, reject) => {
      const task: PendingTask = {
        id: this.nextTaskId++,
        ir,
        resolve,
        reject,
      }
      this.queue.push(task)
      // 防御：若长时间无人分发（Worker 池异常停滞），主动唤醒队列
      setTimeout(() => {
        if (this.queue.includes(task)) this.processQueue()
      }, COMPILE_TIMEOUT_MS)
    })
  }

  /**
   * 将编译任务分发给指定 Worker。
   */
  private dispatchToWorker(
    workerIndex: number,
    ir: RenderIR,
  ): Promise<RegionCompileArtifact> {
    const taskId = this.nextTaskId++
    const request: CompileRequest = {
      type: 'compile',
      id: taskId,
      ir,
    }

    return new Promise<RegionCompileArtifact>((resolve, reject) => {
      const entry: PendingResolver = { resolve, reject, workerIndex }
      // 存储 resolve/reject 以便在消息回调中使用
      this.pendingResolvers.set(taskId, entry)
      this.busy[workerIndex] = true
      try {
        this.workers[workerIndex].postMessage(request)
      } catch (err) {
        // postMessage 失败（如 IR 不可结构化克隆）：回滚占用并 reject，
        // 调用方降级为主线程编译，避免 busy 永久泄漏导致池死锁
        this.pendingResolvers.delete(taskId)
        this.busy[workerIndex] = false
        this.processQueue()
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      // 超时保护：Worker 无响应时 reject 该任务并释放 worker
      setTimeout(() => {
        if (this.pendingResolvers.get(taskId) !== entry) return
        this.pendingResolvers.delete(taskId)
        this.busy[workerIndex] = false
        this.processQueue()
        entry.reject(new Error('Worker compile timeout'))
      }, COMPILE_TIMEOUT_MS)
    })
  }

  /**
   * taskId → resolver 映射（用于在 Worker 消息回调中找到对应的 Promise）
   */
  private pendingResolvers = new Map<number, PendingResolver>()

  /**
   * Worker 消息处理。
   */
  private handleWorkerMessage(workerIndex: number, msg: WorkerResponse): void {
    this.busy[workerIndex] = false

    const resolver = this.pendingResolvers.get(msg.id)
    if (!resolver) {
      // 未知消息（重复投递 / 已超时清理）：仍需尝试推进队列
      this.processQueue()
      return
    }
    this.pendingResolvers.delete(msg.id)

    if (msg.type === 'result') {
      resolver.resolve(msg.artifact)
    } else {
      // Worker 编译失败 → reject，调用方降级为主线程编译
      resolver.reject(new Error(msg.message))
    }

    // 处理队列中的下一个任务
    this.processQueue()
  }

  /**
   * Worker 错误处理。
   */
  private handleWorkerError(workerIndex: number, _e: ErrorEvent): void {
    this.busy[workerIndex] = false

    // Worker 脚本崩溃：该 worker 上挂起的任务永远不会收到回复，
    // 必须显式 reject（否则调用方永久挂起），调用方降级为主线程编译
    for (const [taskId, entry] of [...this.pendingResolvers]) {
      if (entry.workerIndex === workerIndex) {
        this.pendingResolvers.delete(taskId)
        entry.reject(new Error('Worker crashed'))
      }
    }

    // 处理队列中的下一个任务（可能用其他 Worker 或降级）
    this.processQueue()
  }

  /**
   * 处理任务队列。
   * 当有 Worker 空闲且队列中有任务时，分发任务。
   */
  private processQueue(): void {
    while (this.queue.length > 0) {
      const freeIndex = this.busy.indexOf(false)
      if (freeIndex < 0) break

      const task = this.queue.shift()!
      this.dispatchToWorker(freeIndex, task.ir).then(task.resolve).catch(task.reject)
    }
  }

  /**
   * 销毁所有 Worker（在应用卸载时调用）。
   */
  destroy(): void {
    for (const w of this.workers) {
      w.terminate()
    }
    this.workers = []
    this.busy = []
    this._isAvailable = false
    this._workerCount = 0
    this.initialized = false
    this.pendingResolvers.clear()
    this.queue = []
  }

  /** Worker Pool 是否可用（Worker 创建成功） */
  get isAvailable(): boolean {
    return this._isAvailable
  }

  /** Worker 数量 */
  get workerCount(): number {
    return this._workerCount
  }

  /** 当前队列中等待的任务数 */
  get pendingCount(): number {
    return this.queue.length
  }
}

// ============================================================================
// 单例
// ============================================================================

let poolInstance: WorkerPool | null = null

/**
 * 获取 Worker Pool 单例。
 *
 * 首次调用时惰性创建 Worker Pool。
 * Worker 的实际创建延迟到首次 compile() 调用。
 */
export function getWorkerPool(): WorkerPool {
  if (!poolInstance) {
    poolInstance = new WorkerPool()
  }
  return poolInstance
}

/**
 * 销毁 Worker Pool 单例（测试 / 应用卸载时使用）。
 */
export function destroyWorkerPool(): void {
  if (poolInstance) {
    poolInstance.destroy()
    poolInstance = null
  }
}
