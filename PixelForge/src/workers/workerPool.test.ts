/**
 * WorkerPool 死锁回归测试。
 *
 * 背景（2026-08-19 生产实测发现）：
 * - postMessage 抛错（如 reactive Proxy 无法结构化克隆）时，旧实现
 *   在 busy[i]=true 之后没有回滚，每次泄漏一个 worker；8 次后全池
 *   busy=true，新任务永久滞留队列 → 渲染管线挂死。
 * - Worker 无响应（脚本崩溃 / 消息丢失）时，挂起任务的 Promise 永不
 *   settle，调用方永久 await。
 *
 * 本文件验证修复后的三条防线：
 * 1. postMessage 失败 → 立即 reject + busy 回滚（池可继续服务）
 * 2. Worker 无响应 → 超时 reject（调用方可降级主线程编译）
 * 3. Worker 崩溃（onerror）→ 该 worker 上挂起的任务被 reject
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { destroyWorkerPool, getWorkerPool } from './workerPool'
import type { CompileRequest, WorkerResponse } from './tileWorker'

/** 构造最小可用的假 RenderIR（workerPool 只透传，不校验内容） */
function makeIr(): RenderIR {
  return {
    version: 'ir/v1',
    canvas: { width: 8, height: 8 },
    layers: [],
    effects: [],
  } as unknown as RenderIR
}

function makeArtifact(): RegionCompileArtifact {
  return {
    descriptorData: new Uint8Array(1),
    auxData: new Uint8Array(1),
    regionData: new Uint8Array(1),
    effectDescData: new Uint8Array(1),
    effectParamData: new Uint8Array(1),
  } as unknown as RegionCompileArtifact
}

type MessageHandler = (e: MessageEvent<WorkerResponse>) => void

/** 可编程的假 Worker */
class MockWorker {
  static instances: MockWorker[] = []
  static behavior: {
    postMessageThrows?: boolean
    respond?: boolean
  } = {}

  onmessage: MessageHandler | null = null
  onerror: ((e: ErrorEvent) => void) | null = null

  constructor(_url: URL) {
    MockWorker.instances.push(this)
  }

  postMessage(request: CompileRequest): void {
    if (MockWorker.behavior.postMessageThrows) {
      throw new DOMException('could not be cloned', 'DataCloneError')
    }
    if (!MockWorker.behavior.respond) {
      return // 模拟无响应 worker
    }
    const worker = this
    setTimeout(() => {
      worker.onmessage?.(
        new MessageEvent('message', {
          data: { type: 'result', id: request.id, artifact: makeArtifact() },
        }),
      )
    }, 0)
  }

  terminate(): void {
    /* no-op */
  }
}

/** 等待微任务队列排空（promise settle 后再推进假定时器） */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('WorkerPool 死锁回归', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockWorker.instances = []
    MockWorker.behavior = { respond: true }
    vi.stubGlobal('Worker', MockWorker)
    // hardwareConcurrency=4 → 池中 2 个 worker，便于验证 busy 泄漏
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 })
    destroyWorkerPool()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    destroyWorkerPool()
  })

  it('postMessage 抛错时：reject 该任务并回滚 busy，多次调用后池不泄漏', async () => {
    MockWorker.behavior = { respond: true, postMessageThrows: true }

    const pool = getWorkerPool()
    // 池只有 2 个 worker：若 busy 泄漏，第 3 次调用将排队且无人唤醒
    const results: PromiseSettledResult<unknown>[] = []
    for (let i = 0; i < 4; i++) {
      const p = pool.compile(makeIr())
      p.catch(() => {
        /* 预期 reject */
      })
      results.push(await Promise.resolve(p).then(
        (v) => ({ status: 'fulfilled', value: v }) as const,
        (e) => ({ status: 'rejected', reason: e }) as const,
      ))
    }

    // 4 次全部快速 reject（而非挂起或排队）
    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // busy 已回滚：无任务滞留队列
    expect(pool.pendingCount).toBe(0)
  })

  it('Worker 无响应时：任务在超时后 reject，不永久挂起', async () => {
    MockWorker.behavior = { respond: false }

    const pool = getWorkerPool()
    const compilePromise = pool.compile(makeIr())
    const outcome = compilePromise.then(
      () => 'fulfilled',
      (e: Error) => `rejected: ${e.message}`,
    )
    outcome.catch(() => {
      /* 已转为字符串，不会 reject */
    })

    // 超时前挂起
    await flushMicrotasks()
    vi.advanceTimersByTime(9_000)
    await flushMicrotasks()
    // 超时后 reject
    vi.advanceTimersByTime(1_500)
    await flushMicrotasks()
    expect(await outcome).toContain('rejected: Worker compile timeout')
    // worker 已释放
    expect(pool.pendingCount).toBe(0)
  })

  it('Worker 崩溃（onerror）时：挂起任务被 reject', async () => {
    MockWorker.behavior = { respond: false }

    const pool = getWorkerPool()
    const compilePromise = pool.compile(makeIr())
    const outcome = compilePromise.then(
      () => 'fulfilled',
      (e: Error) => `rejected: ${e.message}`,
    )
    outcome.catch(() => {
      /* 已转为字符串，不会 reject */
    })

    await flushMicrotasks()
    // worker 脚本崩溃（node 测试环境无 ErrorEvent，用最小对象模拟即可，
    // handleWorkerError 不读取事件属性）
    MockWorker.instances[0].onerror?.({ type: 'error' } as ErrorEvent)
    await flushMicrotasks()

    expect(await outcome).toContain('rejected: Worker crashed')
    expect(pool.pendingCount).toBe(0)
  })

  it('正常路径：分发到 worker 并返回编译产物', async () => {
    MockWorker.behavior = { respond: true }

    const pool = getWorkerPool()
    const compilePromise = pool.compile(makeIr())
    await flushMicrotasks()
    vi.advanceTimersByTime(1)
    await flushMicrotasks()

    await expect(compilePromise).resolves.toBeDefined()
    expect(pool.pendingCount).toBe(0)
  })
})
