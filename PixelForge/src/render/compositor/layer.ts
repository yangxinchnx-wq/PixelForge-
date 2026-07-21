/**
 * PixelForge Render Compositor — RenderLayer（渲染层）。
 *
 * Clip 是编辑概念，Layer 是渲染概念。
 *
 * Timeline Resolver 输出 Clip[]，Compositor 输入 RenderLayer[]。
 * Layer 包含 GPU 纹理、变换、混合模式等渲染信息。
 *
 * Resolver 输出示例：
 *   [
 *     { "id":"background", "type":"video" },
 *     { "id":"logo",       "type":"image" },
 *     { "id":"title",      "type":"text" }
 *   ]
 *
 * Adjustment Layer（type="adjustment"）：
 *   不是普通 Layer，影响下面所有视频。
 *   流程：Video → Image → Adjustment Shader → Output
 */

import type { RenderTransform } from './transform';
import type { BlendMode } from './blend';
import type { Mask } from './mask';

/** 渲染层类型。 */
export type RenderLayerType = 'video' | 'image' | 'text' | 'adjustment';

/** 渲染层。 */
export interface RenderLayer {
  /** 稳定 ID */
  id: string;
  /** 图层类型（video / image / text / adjustment） */
  type: RenderLayerType;
  /** 图层纹理（已解码的视频帧 / 图片纹理；adjustment 层可为 null） */
  texture: GPUTexture;
  /** 空间变换 */
  transform: RenderTransform;
  /** 透明度（0-1） */
  opacity: number;
  /** 混合模式 */
  blendMode: BlendMode;
  /** 是否可见 */
  visible: boolean;
  /** 可选遮罩 */
  mask?: Mask;
}
