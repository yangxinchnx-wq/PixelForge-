/**
 * PixelForge Render Compositor — BlendMode（混合模式）。
 *
 * 专业软件支持的混合模式：
 *   Normal, Multiply, Screen, Overlay, Add, Darken, Lighten
 *
 * 混合公式：
 *   Multiply: result = A * B
 *   Screen:   result = 1 - (1-A) * (1-B)
 *   Overlay:  mix(2*A*B, 1-2*(1-A)*(1-B), step(0.5, A))
 *   Add:      result = min(A + B, 1)
 *   Darken:   result = min(A, B)
 *   Lighten:  result = max(A, B)
 */

/** 混合模式。 */
export enum BlendMode {
  /** 正常（Alpha 混合） */
  NORMAL = 'normal',
  /** 正片叠底 */
  MULTIPLY = 'multiply',
  /** 滤色 */
  SCREEN = 'screen',
  /** 叠加 */
  OVERLAY = 'overlay',
  /** 线性加 */
  ADD = 'add',
  /** 变暗 */
  DARKEN = 'darken',
  /** 变亮 */
  LIGHTEN = 'lighten',
}

/** WGSL 中的混合模式 ID（用于 shader 分支选择）。 */
export const BLEND_MODE_IDS: Record<BlendMode, number> = {
  [BlendMode.NORMAL]: 0,
  [BlendMode.MULTIPLY]: 1,
  [BlendMode.SCREEN]: 2,
  [BlendMode.OVERLAY]: 3,
  [BlendMode.ADD]: 4,
  [BlendMode.DARKEN]: 5,
  [BlendMode.LIGHTEN]: 6,
};
