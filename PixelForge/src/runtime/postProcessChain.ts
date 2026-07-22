/**
 * Post-Process Chain(Step 39.3)— 多 Pass 后处理链。
 *
 * 核心问题:
 *   现有 effect_post.wgsl 把所有效果打包到单个 compute dispatch,无法做:
 *   - 需要多次采样的高斯模糊(半径被 clamp 到 8)
 *   - 需要中间结果的效果(如 bloom:先提取亮部 → 模糊 → 合成)
 *   - 效果链的顺序敏感处理(每个效果独立 input/output)
 *
 * 解决方案:
 *   PostProcessChain 维护一个有序的 pass 列表,自动管理 ping-pong 纹理:
 *     Pass 1: inputTex → rtA
 *     Pass 2: rtA → rtB
 *     Pass 3: rtB → rtA
 *     ...
 *     最后一个 pass 写回 outputTex
 *
 * 设计要点:
 * - 纯数据结构 + 调度逻辑(不直接调用 GPU,由 executor 回调执行)
 * - ping-pong:两个中间 RenderTarget 交替作为 input/output
 * - 单 pass 优化:chain 长度=1 时直接 inputTex → outputTex,无需中间 RT
 * - 空 chain 优化:chain 长度=0 时直接返回 input(无 op)
 * - 支持 enabled / disabled pass(运行时切换)
 * - 顺序敏感:pass 数组顺序 = 执行顺序
 *
 * 与 RenderIR.Effect 的关系:
 * - RenderIR.Effect 是 IR 层的声明(5 种 type,由 regionCompiler 编译到 effectDescBuffer)
 * - PostProcessPass 是 runtime 层的执行单元(可承载任意自定义 shader)
 * - 当前 EffectChain(Step 34,17 种 VideoEffectType)与 GPU 解耦,后续可桥接
 */

import type { RenderTarget, RenderTargetDescriptor, RenderTargetFactoryOptions } from './renderTarget'
import {
  createRenderTarget,
  destroyRenderTarget,
  releaseRenderTarget,
  acquireRenderTarget,
  isCompatibleDescriptor,
  normalizeDescriptor,
  estimateRenderTargetBytes,
} from './renderTarget'

/**
 * 后处理 pass 类型(预留扩展,当前只用 'compute')。
 *
 * - 'compute':compute pass(storage texture 读写,DM-5 rgba8unorm 约束)
 * - 'render': render pass(color attachment,可选 HDR 格式,预留)
 */
export type PostProcessPassKind = 'compute' | 'render'

/**
 * 单个后处理 pass 的描述。
 *
 * - id:          唯一 ID(便于调试 / 日志)
 * - name:        可读名(如 'gaussian_blur' / 'bloom_extract')
 * - kind:        pass 类型(compute / render)
 * - enabled:     是否启用(disabled pass 被跳过)
 * - params:      pass 参数(透传给 executor,如 blur radius / bloom threshold)
 * - shaderKey:   shader 标识(用于 pipeline 缓存,如 'blur_v1' / 'bloom_v2')
 */
export interface PostProcessPass {
  id: string
  name: string
  kind: PostProcessPassKind
  enabled: boolean
  params: Record<string, unknown>
  shaderKey: string
}

/**
 * Pass 执行回调(由调用方注入实际 GPU 逻辑)。
 *
 * @param input    输入 RenderTarget(只读)
 * @param output   输出 RenderTarget(写入)
 * @param pass     pass 描述(含 params)
 * @returns pass 执行耗时(ms,用于 profiler)
 */
export type PostProcessPassExecutor = (
  input: RenderTarget,
  output: RenderTarget,
  pass: PostProcessPass,
) => number

/**
 * Ping-pong 纹理对(两个交替使用的中间 RT)。
 */
interface PingPongPair {
  a: RenderTarget
  b: RenderTarget
}

/**
 * 后处理链执行结果。
 */
export interface PostProcessChainResult {
  /** 实际执行的 pass 数量(跳过 disabled 的) */
  executedPassCount: number
  /** 总耗时(ms,所有 pass executor 返回值之和) */
  totalMs: number
  /** 每个 pass 的耗时明细 */
  passTimings: Array<{ passId: string; passName: string; ms: number; skipped: boolean }>
  /** 是否走了短路优化(0 或 1 pass) */
  shortCircuited: boolean
}

/**
 * 后处理链统计信息。
 */
export interface PostProcessChainStats {
  /** 链中 pass 总数(含 disabled) */
  totalPasses: number
  /** 启用的 pass 数 */
  enabledPasses: number
  /** 中间 RT 数量(0 / 1 / 2) */
  intermediateRTCount: number
  /** 中间 RT 占用字节数(估算) */
  intermediateRTBytes: number
  /** 累计执行次数 */
  totalExecutions: number
  /** 累计 pass 执行次数 */
  totalPassExecutions: number
  /** 累计短路次数 */
  totalShortCircuits: number
}

/**
 * 后处理链选项。
 */
export interface PostProcessChainOptions extends RenderTargetFactoryOptions {
  /** 中间 RT 的描述符覆盖(默认与 input 相同) */
  intermediateDescriptor?: Partial<RenderTargetDescriptor>
}

/**
 * Post-Process Chain 实现。
 *
 * @example
 * const chain = new PostProcessChain()
 * chain.addPass({ id: 'blur', name: 'gaussian_blur', kind: 'compute', enabled: true, params: { radius: 5 }, shaderKey: 'blur_v1' })
 * chain.addPass({ id: 'bloom', name: 'bloom_composite', kind: 'compute', enabled: true, params: { threshold: 0.8 }, shaderKey: 'bloom_v1' })
 *
 * const result = chain.execute(inputRT, outputRT, executor)
 * // Pass 1: inputRT → rtA (blur)
 * // Pass 2: rtA → outputRT (bloom)
 */
export class PostProcessChain {
  private passes: PostProcessPass[] = []
  private pingPong: PingPongPair | null = null
  private readonly options: PostProcessChainOptions
  private idCounter = 0

  /** 累计执行次数(统计用) */
  private totalExecutions = 0
  /** 累计 pass 执行次数 */
  private totalPassExecutions = 0
  /** 累计短路次数 */
  private totalShortCircuits = 0

  constructor(options: PostProcessChainOptions = {}) {
    this.options = options
  }

  /**
   * 添加一个 pass 到链尾。
   */
  addPass(pass: PostProcessPass): void {
    this.passes.push(pass)
    // 添加 pass 后需要重建 ping-pong(若已存在)
    this.disposePingPong()
  }

  /**
   * 在指定位置插入 pass。
   */
  insertPass(index: number, pass: PostProcessPass): void {
    this.passes.splice(index, 0, pass)
    this.disposePingPong()
  }

  /**
   * 移除指定 ID 的 pass。
   */
  removePass(passId: string): boolean {
    const idx = this.passes.findIndex((p) => p.id === passId)
    if (idx < 0) return false
    this.passes.splice(idx, 1)
    this.disposePingPong()
    return true
  }

  /**
   * 获取指定 ID 的 pass。
   */
  getPass(passId: string): PostProcessPass | undefined {
    return this.passes.find((p) => p.id === passId)
  }

  /**
   * 启用/禁用指定 pass。
   */
  setPassEnabled(passId: string, enabled: boolean): boolean {
    const pass = this.getPass(passId)
    if (!pass) return false
    pass.enabled = enabled
    return true
  }

  /**
   * 更新 pass 参数(合并而非替换)。
   */
  updatePassParams(passId: string, params: Record<string, unknown>): boolean {
    const pass = this.getPass(passId)
    if (!pass) return false
    pass.params = { ...pass.params, ...params }
    return true
  }

  /**
   * 获取所有 pass(含 disabled)。
   */
  getPasses(): PostProcessPass[] {
    return [...this.passes]
  }

  /**
   * 获取启用的 pass 数量。
   */
  getEnabledPassCount(): number {
    return this.passes.filter((p) => p.enabled).length
  }

  /**
   * 清空所有 pass。
   */
  clear(): void {
    this.passes = []
    this.disposePingPong()
  }

  /**
   * 执行后处理链。
   *
   * @param input    输入 RT(场景 pass 的输出)
   * @param output   输出 RT(最终结果,通常 = canvas output)
   * @param executor pass 执行回调
   * @returns 执行结果(含耗时明细)
   */
  execute(
    input: RenderTarget,
    output: RenderTarget,
    executor: PostProcessPassExecutor,
  ): PostProcessChainResult {
    this.totalExecutions++
    const enabledPasses = this.passes.filter((p) => p.enabled)
    const passTimings: PostProcessChainResult['passTimings'] = []

    // —— 0. 空 chain:直接返回 input(短路) ——
    if (enabledPasses.length === 0) {
      this.totalShortCircuits++
      for (const pass of this.passes) {
        passTimings.push({ passId: pass.id, passName: pass.name, ms: 0, skipped: true })
      }
      return {
        executedPassCount: 0,
        totalMs: 0,
        passTimings,
        shortCircuited: true,
      }
    }

    // —— 1. 单 pass:直接 input → output(短路,无需中间 RT) ——
    if (enabledPasses.length === 1) {
      this.totalShortCircuits++
      this.totalPassExecutions++
      const pass = enabledPasses[0]
      const ms = executor(input, output, pass)
      passTimings.push({ passId: pass.id, passName: pass.name, ms, skipped: false })
      // 标记 disabled 的 pass 为 skipped
      for (const p of this.passes) {
        if (!p.enabled) {
          passTimings.push({ passId: p.id, passName: p.name, ms: 0, skipped: true })
        }
      }
      return {
        executedPassCount: 1,
        totalMs: ms,
        passTimings,
        shortCircuited: true,
      }
    }

    // —— 2. 多 pass:ping-pong 调度 ——
    // Pass 0: input → rtA
    // Pass 1: rtA → rtB
    // Pass 2: rtB → rtA
    // ...
    // 最后一个 pass: rtX → output
    const pp = this.ensurePingPong(input.descriptor)
    let totalMs = 0
    let currentInput: RenderTarget = input
    let currentOutput: RenderTarget

    for (let i = 0; i < enabledPasses.length; i++) {
      const pass = enabledPasses[i]
      const isLast = i === enabledPasses.length - 1

      if (isLast) {
        // 最后一个 pass 写回 output
        currentOutput = output
      } else if (i % 2 === 0) {
        // 偶数 pass(0, 2, 4...):写 rtA,下次从 rtA 读
        currentOutput = pp.a
        acquireRenderTarget(pp.a)
      } else {
        // 奇数 pass(1, 3, 5...):写 rtB,下次从 rtB 读
        currentOutput = pp.b
        acquireRenderTarget(pp.b)
      }

      this.totalPassExecutions++
      const ms = executor(currentInput, currentOutput, pass)
      totalMs += ms
      passTimings.push({ passId: pass.id, passName: pass.name, ms, skipped: false })

      // 释放非 input 的中间 RT(标记可复用,但 ping-pong 中我们直接交替)
      if (currentInput !== input) {
        releaseRenderTarget(currentInput)
      }
      currentInput = currentOutput
    }

    // 标记 disabled 的 pass 为 skipped
    for (const p of this.passes) {
      if (!p.enabled) {
        passTimings.push({ passId: p.id, passName: p.name, ms: 0, skipped: true })
      }
    }

    return {
      executedPassCount: enabledPasses.length,
      totalMs,
      passTimings,
      shortCircuited: false,
    }
  }

  /**
   * 获取统计信息。
   */
  getStats(): PostProcessChainStats {
    return {
      totalPasses: this.passes.length,
      enabledPasses: this.getEnabledPassCount(),
      intermediateRTCount: this.pingPong ? 2 : 0,
      intermediateRTBytes: this.pingPong
        ? estimateRenderTargetBytes(this.pingPong.a) + estimateRenderTargetBytes(this.pingPong.b)
        : 0,
      totalExecutions: this.totalExecutions,
      totalPassExecutions: this.totalPassExecutions,
      totalShortCircuits: this.totalShortCircuits,
    }
  }

  /**
   * 销毁所有资源(中间 RT + pass 列表)。
   */
  dispose(): void {
    this.disposePingPong()
    this.passes = []
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  /**
   * 确保 ping-pong 对存在且尺寸兼容。
   *
   * @param refDesc 参考描述符(通常 = input.descriptor)
   */
  private ensurePingPong(refDesc: Required<RenderTargetDescriptor>): PingPongPair {
    // 合并 intermediateDescriptor 覆盖
    const baseDesc: RenderTargetDescriptor = {
      width: refDesc.width,
      height: refDesc.height,
      format: this.options.intermediateDescriptor?.format ?? refDesc.format,
      usage: this.options.intermediateDescriptor?.usage ?? refDesc.usage,
    }
    const normalizedDesc = normalizeDescriptor(baseDesc, `pp_${this.idCounter}`)

    if (this.pingPong) {
      // 检查现有 RT 是否尺寸兼容
      if (
        isCompatibleDescriptor(this.pingPong.a.descriptor, normalizedDesc) &&
        isCompatibleDescriptor(this.pingPong.b.descriptor, normalizedDesc)
      ) {
        return this.pingPong
      }
      // 尺寸不兼容,销毁重建
      this.disposePingPong()
    }

    // 创建新的 ping-pong 对
    this.idCounter++
    const a = createRenderTarget(`pp_a_${this.idCounter}`, baseDesc, this.options)
    const b = createRenderTarget(`pp_b_${this.idCounter}`, baseDesc, this.options)
    // 初始状态:两个都 release(执行时按需 acquire)
    releaseRenderTarget(a)
    releaseRenderTarget(b)
    this.pingPong = { a, b }
    return this.pingPong
  }

  /**
   * 销毁 ping-pong 对。
   */
  private disposePingPong(): void {
    if (!this.pingPong) return
    destroyRenderTarget(this.pingPong.a, this.options)
    destroyRenderTarget(this.pingPong.b, this.options)
    this.pingPong = null
  }
}

/**
 * 创建一个 PostProcessPass(便捷工厂)。
 */
export function makePass(
  name: string,
  shaderKey: string,
  params: Record<string, unknown> = {},
  options: { id?: string; kind?: PostProcessPassKind; enabled?: boolean } = {},
): PostProcessPass {
  return {
    id: options.id ?? `pass_${name}_${Date.now().toString(36)}`,
    name,
    kind: options.kind ?? 'compute',
    enabled: options.enabled ?? true,
    params,
    shaderKey,
  }
}
