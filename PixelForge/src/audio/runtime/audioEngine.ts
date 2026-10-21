/**
 * 音频引擎(Step 41.3)— AudioContext 生命周期 + 自动播放策略。
 *
 * 职责:
 * - 懒初始化 AudioContext(浏览器要求必须在用户手势后才能出声)
 * - 处理自动播放策略:上下文被挂起时记录待恢复状态,待用户手势后 resume
 * - 提供采样率 / 当前时间等只读信息
 *
 * 设计原则:
 * - **AudioContext 通过工厂注入**,vitest(Node 环境无 Web Audio)下可注入 stub
 * - 环境不支持时**降级而不是崩溃**:state 保持 'uninitialized',所有操作安全返回
 *
 * 自动播放策略说明:
 *   Chrome / WebView2 会阻止无用户手势的音频播放。新建的 AudioContext 通常处于
 *   suspended 状态,必须等到用户点击等手势后调用 resume() 才会真正出声。
 *   本引擎把这一约束显式建模为 `needsUserGesture` 标志,由 UI 层在首次交互时调用 resume。
 *
 * 数据流:
 *   createAudioEngine(factory)
 *     ↓ init()
 *   AudioContextLike(可能 suspended)
 *     ↓ resume()(用户手势后)
 *   running → 可播放
 */

import {
  defaultAudioContextFactory,
  type AudioContextFactory,
  type AudioContextLike,
  type AudioContextStateLike,
} from './types'

// ============================================================================
// 1. 状态
// ============================================================================

/** 引擎状态(比 AudioContext 多一个"未初始化") */
export type AudioEngineState = 'uninitialized' | 'suspended' | 'running' | 'closed'

/** 音频引擎接口 */
export interface AudioEngine {
  /** 当前上下文,未初始化时为 null */
  readonly context: AudioContextLike | null
  /** 引擎状态 */
  readonly state: AudioEngineState
  /** 是否等待用户手势才能恢复播放 */
  readonly needsUserGesture: boolean
  /** 初始化(幂等) */
  init(): Promise<boolean>
  /** 恢复播放(应在用户手势中调用) */
  resume(): Promise<boolean>
  /** 挂起播放 */
  suspend(): Promise<boolean>
  /** 关闭并释放上下文 */
  close(): Promise<void>
  /** 采样率,未初始化时返回 0 */
  getSampleRate(): number
  /** 上下文当前时间(秒),未初始化时返回 0 */
  getCurrentTime(): number
  /**
   * 环境是否支持音频。
   *
   * 未初始化时会创建一个临时上下文进行探测并立即关闭,
   * 因此 **factory 必须每次返回新实例**;若 factory 返回单例,
   * 该单例会被探测流程关闭,请先 init() 再调用本方法(已初始化时直接返回 true)。
   */
  isSupported(): boolean
}

// ============================================================================
// 2. 实现
// ============================================================================

/**
 * 读取上下文状态。
 *
 * 包装成函数是为了避开 TS 对 readonly 属性的控制流窄化:
 * 在 `if (ctx.state === 'suspended')` 分支内直接读取 `ctx.state` 会被窄化为
 * 字面量 `'suspended'`,再与 `'running'` 比较会被判为不可能。
 */
function readState(ctx: AudioContextLike): AudioContextStateLike {
  return ctx.state
}

/**
 * 创建音频引擎。
 *
 * @param factory AudioContext 工厂,缺省使用全局 AudioContext
 *
 * @example
 * const engine = createAudioEngine()
 * await engine.init()
 * if (engine.needsUserGesture) {
 *   // 等待用户点击后再调用
 *   button.onclick = () => engine.resume()
 * }
 */
export function createAudioEngine(
  factory: AudioContextFactory = defaultAudioContextFactory,
): AudioEngine {
  let ctx: AudioContextLike | null = null
  let state: AudioEngineState = 'uninitialized'
  let needsUserGesture = false
  let initPromise: Promise<boolean> | null = null
  /** 工厂是否可用(缓存探测结果,避免重复创建失败) */
  let supported: boolean | null = null

  function probe(): boolean {
    if (supported === null) {
      let probeCtx: AudioContextLike | null = null
      try {
        probeCtx = factory()
      } catch {
        probeCtx = null
      }
      supported = probeCtx !== null

      // 探测用的上下文必须立即释放。
      // 浏览器对同时存在的 AudioContext 数量有配额(Chrome 约 6 个),
      // 若不关闭就会白白占掉名额,导致后续真正需要的上下文创建失败。
      // 注意:这要求 factory 每次返回新实例;返回单例时请勿调用 isSupported()。
      if (probeCtx !== null) {
        try {
          const closing = probeCtx.close()
          if (closing && typeof closing.catch === 'function') {
            closing.catch(() => undefined)
          }
        } catch {
          // 关闭失败不影响探测结论
        }
      }
    }
    return supported
  }

  async function init(): Promise<boolean> {
    if (ctx !== null) return true
    if (state === 'closed') return false

    // 并发调用共享同一次初始化
    if (initPromise) return initPromise

    initPromise = (async () => {
      let created: AudioContextLike | null = null
      try {
        created = factory()
      } catch {
        created = null
      }

      if (created === null) {
        supported = false
        state = 'uninitialized'
        return false
      }

      supported = true
      ctx = created
      state = created.state === 'running' ? 'running' : 'suspended'
      needsUserGesture = created.state === 'suspended'

      // 部分实现在新建后需要显式 resume 才会转为 running
      if (created.state === 'suspended') {
        try {
          await created.resume()
          const after = readState(created)
          state = after === 'running' ? 'running' : 'suspended'
          needsUserGesture = after !== 'running'
        } catch {
          // resume 被拒绝(无用户手势)是预期行为,保留 suspended 等待手势
          needsUserGesture = true
        }
      }

      return true
    })()

    return initPromise
  }

  async function resume(): Promise<boolean> {
    if (ctx === null) {
      const ok = await init()
      if (!ok) return false
    }
    if (ctx === null) return false
    if (ctx.state === 'closed') {
      state = 'closed'
      return false
    }

    try {
      await ctx.resume()
      state = ctx.state === 'running' ? 'running' : 'suspended'
      needsUserGesture = ctx.state !== 'running'
      return ctx.state === 'running'
    } catch {
      needsUserGesture = true
      return false
    }
  }

  async function suspend(): Promise<boolean> {
    if (ctx === null) return false
    if (ctx.state === 'closed') return false
    try {
      await ctx.suspend()
      state = 'suspended'
      return true
    } catch {
      return false
    }
  }

  async function close(): Promise<void> {
    if (ctx === null) {
      state = 'closed'
      return
    }
    try {
      await ctx.close()
    } catch {
      // 关闭失败也要标记为已关闭,避免调用方继续使用
    }
    ctx = null
    initPromise = null
    state = 'closed'
  }

  return {
    get context(): AudioContextLike | null {
      return ctx
    },
    get state(): AudioEngineState {
      return ctx !== null && state !== 'closed' ? ctx.state : state
    },
    get needsUserGesture(): boolean {
      return needsUserGesture
    },
    init,
    resume,
    suspend,
    close,
    getSampleRate(): number {
      return ctx?.sampleRate ?? 0
    },
    getCurrentTime(): number {
      return ctx?.currentTime ?? 0
    },
    isSupported(): boolean {
      // 已初始化则直接判定支持,避免重复探测(也就不会误关正在使用的上下文)
      if (ctx !== null) return true
      return probe()
    },
  }
}
