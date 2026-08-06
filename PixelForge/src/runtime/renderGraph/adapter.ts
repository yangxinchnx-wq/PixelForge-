/**
 * PixelForge - RenderGraph 适配 Pass(Step 40.5 接入层)
 *
 * 把现有渲染逻辑(RegionEvaluator.render + renderPresentPass)包装成 RenderGraphPass,
 * 让现有渲染链路能通过 RenderGraph 编排。
 *
 * 两个 Pass:
 * - SceneDispatchPass:包装 RegionEvaluator.render(计算着色器 dispatch)
 * - PresentToCanvasPass:包装 renderPresentPass(输出纹理 blit 到 canvas)
 *
 * 接入方式:
 *   const graph = new RenderGraph({ canvasWidth, canvasHeight, texturePoolOptions, bufferPoolOptions })
 *   graph.add(SceneDispatchPass, evaluator, artifact)
 *   graph.add(PresentToCanvasPass, device, canvasContext, presentResources)
 *   graph.compile()
 *   graph.execute(frameIndex, device)
 *
 * 设计要点:
 * - 两个 Pass 都通过 importExternalTexture 把现有 output.texture 注入图,
 *   让 RenderGraph 知道资源依赖但不接管其生命周期
 * - SceneDispatchPass 写入 output 纹理(声明为创建者 + mutator)
 * - PresentToCanvasPass 读取 output 纹理(声明为消费者)
 * - 两 Pass 之间通过 named resource 'sceneOutput' 建立依赖
 * - 现有 evaluator.render / renderPresentPass 实现完全不动,只是被包进 Pass.execute
 */

import { RenderGraphPass } from './renderGraphPass'
import type { RenderGraphBuilder, RenderGraphPassContext } from './renderGraphPass'
import type { RegionEvaluator } from '@/compiler/region/evaluator'
import type { RegionCompileArtifact } from '@/compiler/region/regionCompiler'
import type { PresentPipelineResources } from '@/runtime/pipeline'
import type { RuntimeDeviceHandle } from '@/runtime/types'

/**
 * 共享资源名 —— SceneDispatchPass 创建,PresentToCanvasPass 消费。
 */
const SCENE_OUTPUT_RESOURCE = 'sceneOutput'

/**
 * 场景调度 Pass —— 包装 RegionEvaluator.render。
 *
 * 声明为 SCENE_OUTPUT_RESOURCE 的创建者(importExternalTexture),
 * 把现有 output.texture 注入图。execute 时调用 evaluator.render(artifact)。
 *
 * 构造参数通过闭包捕获,不参与图编译。
 */
export class SceneDispatchPass extends RenderGraphPass {
  public readonly name = 'SceneDispatchPass'

  constructor(
    private readonly evaluator: RegionEvaluator,
    private readonly artifact: RegionCompileArtifact,
    private readonly outputTexture: GPUTexture,
  ) {
    super()
  }

  public setup(b: RenderGraphBuilder): void {
    // 把现有 output.texture 作为外部资源导入,声明为创建者
    b.importExternalTexture(SCENE_OUTPUT_RESOURCE, this.outputTexture)
    // 声明对此资源的写入(创建者 + mutator)
    // 注:importExternalTexture 已注册为创建者,这里只需声明 access hint
  }

  public execute(_ctx: RenderGraphPassContext): void {
    // 直接调用现有 evaluator.render,不动实现
    this.evaluator.render(this.artifact)
  }
}

/**
 * 呈现到 Canvas Pass —— 包装 renderPresentPass。
 *
 * 声明为 SCENE_OUTPUT_RESOURCE 的消费者(读取)。execute 时调用 renderPresentPass。
 */
export class PresentToCanvasPass extends RenderGraphPass {
  public readonly name = 'PresentToCanvasPass'

  constructor(
    private readonly device: RuntimeDeviceHandle,
    private readonly canvasContext: GPUCanvasContext,
    private readonly present: PresentPipelineResources,
    /** 场景输出纹理(仅用于声明图依赖,execute 不直接读取) */
    _sceneOutputTexture: GPUTexture,
  ) {
    super()
  }

  public setup(b: RenderGraphBuilder): void {
    // 读取场景输出(由 SceneDispatchPass 创建)
    b.read(SCENE_OUTPUT_RESOURCE)
  }

  public execute(_ctx: RenderGraphPassContext): void {
    // 直接调用现有 renderPresentPass,不动实现
    // 注:renderPresentPass 内部从 canvasContext.getCurrentTexture() 取目标,不读 sceneOutputTexture 参数
    // sceneOutputTexture 在 setup 中仅用于声明图依赖
    const encoder = this.device.createCommandEncoder({
      label: 'present-to-canvas-encoder',
    })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.canvasContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.present.pipeline)
    pass.setBindGroup(0, this.present.bindGroup)
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }
}

/**
 * RenderGraph 渲染适配器 —— 把现有 executeArtifactRender 的两阶段包装成 RenderGraph。
 *
 * 用法:
 *   const adapter = new RenderGraphAdapter({ canvasWidth, canvasHeight, texturePoolOptions, bufferPoolOptions })
 *   adapter.render(evaluator, artifact, device, canvasContext, present, outputTexture, frameIndex)
 *
 * 内部:
 *   1. 清空旧 Pass(graph.destroy + 重建,或复用图 + replace Pass)
 *   2. add(SceneDispatchPass, ...) + add(PresentToCanvasPass, ...)
 *   3. compile + execute
 *
 * 性能注:本适配器每帧重建 Pass。如果 Pass 数量大,应改为复用图 + 仅更新 artifact。
 * 当前两 Pass 场景下重建开销可忽略。
 */

import { RenderGraph, type RenderGraphOptions } from './renderGraph'

export interface RenderGraphAdapterOptions extends RenderGraphOptions {
  /** 是否启用 RenderGraph 路径(默认 false,保持原 evaluator + renderPresentPass 路径) */
  enabled?: boolean
}

export class RenderGraphAdapter {
  private readonly _graph: RenderGraph
  private readonly _enabled: boolean
  private _initialized = false

  constructor(options: RenderGraphAdapterOptions = {}) {
    const { enabled = false, ...graphOptions } = options
    this._enabled = enabled
    this._graph = new RenderGraph(graphOptions)
  }

  /** 是否启用 RenderGraph 路径 */
  public get enabled(): boolean {
    return this._enabled
  }

  /** 更新画布尺寸(canvas resize 时调用) */
  public setCanvasSize(width: number, height: number): void {
    this._graph.setCanvasSize(width, height)
  }

  /**
   * 执行一帧渲染。启用时走 RenderGraph 路径,否则走原路径。
   *
   * @param evaluator      区域求值器
   * @param artifact       编译工件
   * @param device         GPU 设备
   * @param canvasContext  Canvas 上下文
   * @param present        呈现管线资源
   * @param outputTexture  输出纹理(SceneDispatchPass 写入,PresentToCanvasPass 读取)
   * @param frameIndex     帧序号
   * @param presentImpl    可选的 present 实现(测试可注入 mock;默认走内联实现)
   */
  public render(
    evaluator: RegionEvaluator,
    artifact: RegionCompileArtifact,
    device: RuntimeDeviceHandle,
    canvasContext: GPUCanvasContext,
    present: PresentPipelineResources,
    outputTexture: GPUTexture,
    frameIndex: number,
    presentImpl?: (device: RuntimeDeviceHandle, canvasContext: GPUCanvasContext, present: PresentPipelineResources) => void,
  ): void {
    if (!this._enabled) {
      // 原路径:直接调用,不经过 RenderGraph
      evaluator.render(artifact)
      if (presentImpl) {
        presentImpl(device, canvasContext, present)
      }
      return
    }

    // RenderGraph 路径:每帧重建 Pass(两 Pass 场景开销可忽略)
    if (this._initialized) {
      this._graph.remove('SceneDispatchPass')
      this._graph.remove('PresentToCanvasPass')
    }
    this._graph.add(SceneDispatchPass, evaluator, artifact, outputTexture)
    this._graph.add(
      PresentToCanvasPass,
      device,
      canvasContext,
      present,
      outputTexture,
    )
    this._initialized = true

    // compile + execute
    this._graph.execute(frameIndex, device as unknown as GPUDevice)
  }

  /** 销毁 */
  public destroy(): void {
    this._graph.destroy()
  }

  /** 瞬态纹理池统计 */
  public get texturePoolStats() {
    return this._graph.texturePoolStats()
  }

  /** 瞬态 buffer 池统计 */
  public get bufferPoolStats() {
    return this._graph.bufferPoolStats()
  }
}
