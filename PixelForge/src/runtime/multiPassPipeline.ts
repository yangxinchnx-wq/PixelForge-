/**
 * Multi-Pass Pipeline(Step 39.3)— 多 Pass 渲染管线编排。
 *
 * 核心问题:
 *   现有渲染流程是 "scene pass + effect pass + present" 三段式,效果全部打包到单 dispatch。
 *   多 Pass 后处理链需要一个统一的编排器,管理:
 *   - Scene Pass:渲染场景到 input RT(由调用方注入)
 *   - Post-Process Chain:链式后处理(ping-pong)
 *   - Present Pass:最终 RT → canvas(由调用方注入)
 *
 * 解决方案:
 *   MultiPassPipeline 把三个阶段抽象为回调,编排执行顺序:
 *     1. sceneExecutor(inputRT) → 渲染场景到 inputRT
 *     2. postProcessChain.execute(inputRT, outputRT, passExecutor) → 后处理链
 *     3. presentExecutor(outputRT) → 把 outputRT blit 到 canvas
 *
 * 设计要点:
 * - 纯编排逻辑(不直接调用 GPU,所有 GPU 操作由 executor 回调注入)
 * - 与 Step 39.1 renderProfiler 集成(每阶段采集 FrameSample)
 * - 支持"跳过后处理"快速路径(scene → present 直连)
 * - 支持"多 chain"扩展(主 chain + overlay chain,预留)
 * - 帧序号 + 时间戳追踪(便于与 FrameScheduler 集成)
 *
 * 与现有 engine.ts / encoder.ts 的关系:
 * - engine.ts:业务逻辑层(Timeline → ParamPatch → GPU)
 * - encoder.ts:GPU 操作层(clearOutputTexture / renderPresentPass)
 * - MultiPassPipeline:编排层(在 engine 和 encoder 之间,管理多 pass 顺序)
 * 改造时:engine.ts 的 renderFrame 调用可替换为 MultiPassPipeline.execute,
 *         sceneExecutor = evaluator.render, presentExecutor = renderPresentPass。
 */

import type { RenderTarget, RenderTargetDescriptor } from './renderTarget'
import { createRenderTarget, destroyRenderTarget, releaseRenderTarget, acquireRenderTarget, normalizeDescriptor } from './renderTarget'
import { PostProcessChain } from './postProcessChain'
import type { PostProcessPassExecutor, PostProcessChainResult } from './postProcessChain'

/**
 * Scene Pass 执行回调。
 *
 * @param inputRT 场景渲染目标(scene pass 写入此 RT)
 * @returns 场景渲染耗时(ms)
 */
export type ScenePassExecutor = (inputRT: RenderTarget) => number

/**
 * Present Pass 执行回调。
 *
 * @param outputRT 最终输出 RT(present pass 读取此 RT 并 blit 到 canvas)
 * @returns present 耗时(ms)
 */
export type PresentPassExecutor = (outputRT: RenderTarget) => number

/**
 * 多 Pass 管线阶段类型。
 */
export type PipelinePhase = 'scene' | 'post-process' | 'present'

/**
 * 单帧执行结果。
 */
export interface MultiPassFrameResult {
  /** 帧序号 */
  frameIndex: number
  /** 帧开始时间戳(performance.now()) */
  timestamp: number
  /** 总帧耗时(ms,scene + post-process + present) */
  totalMs: number
  /** Scene pass 耗时 */
  sceneMs: number
  /** Post-process chain 执行结果(若跳过则为 null) */
  postProcessResult: PostProcessChainResult | null
  /** Present pass 耗时 */
  presentMs: number
  /** 是否跳过了后处理链(scene → present 直连) */
  postProcessSkipped: boolean
  /** 执行阶段列表(按顺序) */
  phases: Array<{ phase: PipelinePhase; ms: number; skipped: boolean }>
}

/**
 * 多 Pass 管线统计信息。
 */
export interface MultiPassPipelineStats {
  /** 累计执行帧数 */
  totalFrames: number
  /** 累计跳过后处理的帧数 */
  totalPostProcessSkipped: number
  /** 累计 scene pass 耗时(ms) */
  totalSceneMs: number
  /** 累计 post-process 耗时(ms) */
  totalPostProcessMs: number
  /** 累计 present pass 耗时(ms) */
  totalPresentMs: number
  /** 累计总耗时(ms) */
  totalMs: number
  /** 平均帧耗时(ms) */
  avgFrameMs: number
  /** 后处理跳过率(0~1) */
  postProcessSkipRate: number
}

/**
 * 多 Pass 管线选项。
 */
export interface MultiPassPipelineOptions {
  /** 是否启用后处理链(默认 true,false 时 scene → present 直连) */
  enablePostProcess?: boolean
  /** 输入 RT 描述符覆盖(默认按 canvas 尺寸 + rgba8unorm) */
  inputDescriptor?: Partial<RenderTargetDescriptor>
  /** 输出 RT 描述符覆盖(默认按 canvas 尺寸 + rgba8unorm) */
  outputDescriptor?: Partial<RenderTargetDescriptor>
  /** GPU 创建/销毁回调(注入式,对齐 RenderTargetFactoryOptions) */
  createGpuTexture?: (desc: Required<RenderTargetDescriptor>) => GPUTexture | undefined
  destroyGpuTexture?: (texture: GPUTexture) => void
}

/**
 * 多 Pass 渲染管线。
 *
 * @example
 * const pipeline = new MultiPassPipeline({
 *   createGpuTexture: (desc) => device.createTexture({ ... }),
 * })
 * pipeline.setPostProcessChain(myChain)
 *
 * const result = pipeline.execute({
 *   frameIndex: 0,
 *   canvasSize: { width: 1920, height: 1080 },
 *   sceneExecutor: (inputRT) => { evaluator.render(artifact); return 5.2 },
 *   passExecutor: (in, out, pass) => { dispatchEffect(...); return 1.8 },
 *   presentExecutor: (outputRT) => { renderPresentPass(...); return 0.5 },
 * })
 */
export class MultiPassPipeline {
  private chain: PostProcessChain | null = null
  private inputRT: RenderTarget | null = null
  private outputRT: RenderTarget | null = null
  private readonly options: Required<Omit<MultiPassPipelineOptions, 'createGpuTexture' | 'destroyGpuTexture' | 'inputDescriptor' | 'outputDescriptor'>>
  private readonly rawOptions: MultiPassPipelineOptions
  private frameCounter = 0

  /** 累计统计 */
  private totalFrames = 0
  private totalPostProcessSkipped = 0
  private totalSceneMs = 0
  private totalPostProcessMs = 0
  private totalPresentMs = 0
  private totalMs = 0

  constructor(options: MultiPassPipelineOptions = {}) {
    this.rawOptions = options
    this.options = {
      enablePostProcess: options.enablePostProcess ?? true,
    }
  }

  /**
   * 设置后处理链。
   */
  setPostProcessChain(chain: PostProcessChain | null): void {
    this.chain = chain
    // chain 变化时需要重建 RT(尺寸可能不同)
    this.disposeRTs()
  }

  /**
   * 获取当前后处理链。
   */
  getPostProcessChain(): PostProcessChain | null {
    return this.chain
  }

  /**
   * 设置是否启用后处理链。
   */
  setEnablePostProcess(enabled: boolean): void {
    this.options.enablePostProcess = enabled
  }

  /**
   * 执行一帧多 Pass 渲染。
   *
   * @param params 执行参数
   * @returns 帧执行结果
   */
  execute(params: {
    frameIndex?: number
    canvasSize: { width: number; height: number }
    sceneExecutor: ScenePassExecutor
    passExecutor?: PostProcessPassExecutor
    presentExecutor: PresentPassExecutor
  }): MultiPassFrameResult {
    const frameIndex = params.frameIndex ?? this.frameCounter++
    const timestamp = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const phases: MultiPassFrameResult['phases'] = []

    // —— 1. 准备 input/output RT ——
    const inputRT = this.ensureInputRT(params.canvasSize)
    const outputRT = this.ensureOutputRT(params.canvasSize)

    // —— 2. Scene pass ——
    const sceneMs = params.sceneExecutor(inputRT)
    phases.push({ phase: 'scene', ms: sceneMs, skipped: false })
    releaseRenderTarget(inputRT) // scene pass 完成后标记可复用

    // —— 3. Post-process chain(可选) ——
    let postProcessResult: PostProcessChainResult | null = null
    let postProcessSkipped = false
    let postProcessMs = 0

    const shouldSkipPostProcess =
      !this.options.enablePostProcess ||
      this.chain === null ||
      this.chain.getEnabledPassCount() === 0 ||
      params.passExecutor === undefined

    if (shouldSkipPostProcess) {
      postProcessSkipped = true
      phases.push({ phase: 'post-process', ms: 0, skipped: true })
    } else {
      acquireRenderTarget(inputRT) // 后处理链需要读取 input
      acquireRenderTarget(outputRT) // 后处理链需要写入 output
      postProcessResult = this.chain!.execute(inputRT, outputRT, params.passExecutor!)
      postProcessMs = postProcessResult.totalMs
      phases.push({ phase: 'post-process', ms: postProcessMs, skipped: false })
      releaseRenderTarget(inputRT)
      releaseRenderTarget(outputRT)
    }

    // —— 4. Present pass ——
    // 若跳过了后处理,直接从 inputRT present;否则从 outputRT present
    const presentSource = postProcessSkipped ? inputRT : outputRT
    acquireRenderTarget(presentSource)
    const presentMs = params.presentExecutor(presentSource)
    phases.push({ phase: 'present', ms: presentMs, skipped: false })
    releaseRenderTarget(presentSource)

    // —— 5. 汇总 ——
    const totalMs = sceneMs + postProcessMs + presentMs

    // 更新累计统计
    this.totalFrames++
    if (postProcessSkipped) this.totalPostProcessSkipped++
    this.totalSceneMs += sceneMs
    this.totalPostProcessMs += postProcessMs
    this.totalPresentMs += presentMs
    this.totalMs += totalMs

    return {
      frameIndex,
      timestamp,
      totalMs,
      sceneMs,
      postProcessResult,
      presentMs,
      postProcessSkipped,
      phases,
    }
  }

  /**
   * 获取累计统计信息。
   */
  getStats(): MultiPassPipelineStats {
    return {
      totalFrames: this.totalFrames,
      totalPostProcessSkipped: this.totalPostProcessSkipped,
      totalSceneMs: this.totalSceneMs,
      totalPostProcessMs: this.totalPostProcessMs,
      totalPresentMs: this.totalPresentMs,
      totalMs: this.totalMs,
      avgFrameMs: this.totalFrames === 0 ? 0 : this.totalMs / this.totalFrames,
      postProcessSkipRate: this.totalFrames === 0 ? 0 : this.totalPostProcessSkipped / this.totalFrames,
    }
  }

  /**
   * 重置累计统计(不影响当前 chain 和 RT)。
   */
  resetStats(): void {
    this.totalFrames = 0
    this.totalPostProcessSkipped = 0
    this.totalSceneMs = 0
    this.totalPostProcessMs = 0
    this.totalPresentMs = 0
    this.totalMs = 0
  }

  /**
   * 销毁所有资源(RT + chain)。
   */
  dispose(): void {
    this.disposeRTs()
    this.chain?.dispose()
    this.chain = null
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  /**
   * 确保输入 RT 存在且尺寸兼容。
   */
  private ensureInputRT(canvasSize: { width: number; height: number }): RenderTarget {
    const desc: RenderTargetDescriptor = {
      width: canvasSize.width,
      height: canvasSize.height,
      format: this.rawOptions.inputDescriptor?.format,
      usage: this.rawOptions.inputDescriptor?.usage,
      label: 'pipeline_input',
    }
    const normalizedDesc = normalizeDescriptor(desc, 'pipeline_input')

    if (this.inputRT && this.isCompatible(this.inputRT.descriptor, normalizedDesc)) {
      acquireRenderTarget(this.inputRT)
      return this.inputRT
    }

    // 尺寸不兼容,销毁重建
    if (this.inputRT) {
      destroyRenderTarget(this.inputRT, this.rawOptions)
    }
    this.inputRT = createRenderTarget('pipeline_input', desc, this.rawOptions)
    return this.inputRT
  }

  /**
   * 确保输出 RT 存在且尺寸兼容。
   */
  private ensureOutputRT(canvasSize: { width: number; height: number }): RenderTarget {
    const desc: RenderTargetDescriptor = {
      width: canvasSize.width,
      height: canvasSize.height,
      format: this.rawOptions.outputDescriptor?.format,
      usage: this.rawOptions.outputDescriptor?.usage,
      label: 'pipeline_output',
    }
    const normalizedDesc = normalizeDescriptor(desc, 'pipeline_output')

    if (this.outputRT && this.isCompatible(this.outputRT.descriptor, normalizedDesc)) {
      acquireRenderTarget(this.outputRT)
      return this.outputRT
    }

    if (this.outputRT) {
      destroyRenderTarget(this.outputRT, this.rawOptions)
    }
    this.outputRT = createRenderTarget('pipeline_output', desc, this.rawOptions)
    return this.outputRT
  }

  /**
   * 检查两个描述符是否兼容(可复用)。
   */
  private isCompatible(
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
   * 销毁 input/output RT。
   */
  private disposeRTs(): void {
    if (this.inputRT) {
      destroyRenderTarget(this.inputRT, this.rawOptions)
      this.inputRT = null
    }
    if (this.outputRT) {
      destroyRenderTarget(this.outputRT, this.rawOptions)
      this.outputRT = null
    }
  }
}
