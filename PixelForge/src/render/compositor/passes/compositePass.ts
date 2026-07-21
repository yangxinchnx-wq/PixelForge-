/**
 * PixelForge Render Compositor — CompositePass（合成 Pass）。
 *
 * 创建 RenderPipeline：
 *   Vertex Shader → Fragment Shader → Framebuffer
 *
 * 最简单：把视频画出来。
 */

import compositeShaderSource from '../shader/composite.wgsl?raw';

/**
 * CompositePass — 创建合成 RenderPipeline。
 *
 * 结构：
 *   Vertex Shader → Fragment Shader → Framebuffer
 */
export class CompositePass {
  private pipeline: GPURenderPipeline;

  /**
   * @param device        GPU 设备
   * @param outputFormat  输出纹理格式（如 'bgra8unorm'）
   */
  constructor(device: GPUDevice, outputFormat: GPUTextureFormat = 'bgra8unorm') {
    const shaderModule = device.createShaderModule({
      label: 'composite-shader',
      code: compositeShaderSource,
    });

    this.pipeline = device.createRenderPipeline({
      label: 'composite-pipeline',
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: outputFormat,
            // Alpha 混合
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
              alpha: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
              },
            },
          },
        ],
      },
    });
  }

  /** 获取 RenderPipeline。 */
  get renderPipeline(): GPURenderPipeline {
    return this.pipeline;
  }

  /** 获取 BindGroupLayout（用于创建 BindGroup）。 */
  getBindGroupLayout(): GPUBindGroupLayout {
    return this.pipeline.getBindGroupLayout(0);
  }
}
