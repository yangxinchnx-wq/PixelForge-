/**
 * PixelForge Render Compositor — Compositor（多轨合成器）。
 *
 * 视频编辑器不是播放一个视频，而是同时处理几十个 Layer。
 *
 * 轨道顺序决定绘制顺序：
 *   V3 Text   ↓
 *   V2 Image  ↓
 *   V1 Video  ↓
 *   GPU：从底向上执行
 *
 * 流程：
 *   Timeline Resolver → Active Layers → Decode → Texture → Composite Pass → Effect Pass → Output
 *
 * Compositor 主类：
 *   render(layers: RenderLayer[])
 *   遍历 Layer，在 GPU Render Pass 中逐层绘制
 */

import type { RenderLayer } from './layer';
import { CompositePass } from './passes/compositePass';
import { BlendPass } from './passes/blendPass';
import { createTransformMatrix } from './transform';
import { BLEND_MODE_IDS } from './blend';

/**
 * Compositor — 多轨 GPU 合成器。
 *
 * 用法：
 *   const compositor = new Compositor(device, 'bgra8unorm');
 *   compositor.render(layers, outputTexture);
 */
export class Compositor {
  private device: GPUDevice;
  private compositePass: CompositePass;
  private blendPass: BlendPass;
  private sampler: GPUSampler;

  /**
   * @param device        GPU 设备
   * @param outputFormat  输出纹理格式
   */
  constructor(device: GPUDevice, outputFormat: GPUTextureFormat = 'bgra8unorm') {
    this.device = device;
    this.compositePass = new CompositePass(device, outputFormat);
    this.blendPass = new BlendPass(device);

    this.sampler = device.createSampler({
      label: 'compositor-sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  /** 获取 BlendPass（供外部使用）。 */
  get blend(): BlendPass {
    return this.blendPass;
  }

  /**
   * 渲染所有可见层。
   *
   * 从底向上绘制每个 Layer（后绘制的覆盖在上面）。
   *
   * @param layers       渲染层列表（已按 index 排序，底轨在前）
   * @param outputTexture 输出纹理
   */
  render(layers: RenderLayer[], outputTexture: GPUTexture): void {
    const encoder = this.device.createCommandEncoder({
      label: 'compositor-encoder',
    });

    const pass = encoder.beginRenderPass({
      label: 'compositor-pass',
      colorAttachments: [
        {
          view: outputTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.compositePass.renderPipeline);

    for (const layer of layers) {
      if (!layer.visible) continue;
      this.drawLayer(pass, layer);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * 绘制单个 Layer。
   *
   * @param pass  Render Pass encoder
   * @param layer 渲染层
   */
  private drawLayer(pass: GPURenderPassEncoder, layer: RenderLayer): void {
    // 创建 Layer Uniform Buffer
    const matrix = createTransformMatrix(layer.transform);
    const uniformData = new Float32Array([
      ...matrix,      // mat3x3 (9 floats, but needs padding to 12 for alignment)
      0, 0, 0,         // padding
      layer.opacity,   // opacity
      BLEND_MODE_IDS[layer.blendMode], // blendMode
      0, 0,            // padding
    ]);

    const uniformBuffer = this.device.createBuffer({
      label: `layer-uniform-${layer.id}`,
      size: uniformData.byteLength,
      usage: (typeof GPUBufferUsage !== 'undefined'
        ? GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        : 0x0040 | 0x0008),
    });

    this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    // 创建 BindGroup
    const bindGroup = this.device.createBindGroup({
      label: `layer-bindgroup-${layer.id}`,
      layout: this.compositePass.getBindGroupLayout(),
      entries: [
        { binding: 0, resource: layer.texture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: uniformBuffer } },
      ],
    });

    pass.setBindGroup(0, bindGroup);
    pass.draw(6); // 全屏四边形（两个三角形）

    uniformBuffer.destroy();
  }
}
