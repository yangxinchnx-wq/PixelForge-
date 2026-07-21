/**
 * PixelForge Render Compositor — BlendPass（混合 Pass）。
 *
 * Alpha 混合：
 *   Result = Foreground * A + Background * (1 - A)
 *
 * GPU 混合配置：
 *   blend: {
 *     color: {
 *       srcFactor: "src-alpha",
 *       dstFactor: "one-minus-src-alpha"
 *     }
 *   }
 *
 * 效果：透明 Logo → 视频 → 最终画面
 */

import blendShaderSource from '../shader/blend.wgsl?raw';

/**
 * BlendPass — 管理 GPU 混合状态。
 *
 * 使用 WGSL blend_colors 函数在 shader 中实现混合模式。
 */
export class BlendPass {
  private shaderModule: GPUShaderModule;

  constructor(device: GPUDevice) {
    this.shaderModule = device.createShaderModule({
      label: 'blend-shader',
      code: blendShaderSource,
    });
  }

  /** 获取混合 shader module（供 composite pipeline 使用）。 */
  get shader(): GPUShaderModule {
    return this.shaderModule;
  }

  /**
   * 创建标准 Alpha 混合状态（用于 RenderPipeline target 配置）。
   */
  static createAlphaBlendState(): GPUBlendState {
    return {
      color: {
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
      alpha: {
        srcFactor: 'src-alpha',
        dstFactor: 'one-minus-src-alpha',
        operation: 'add',
      },
    };
  }
}
