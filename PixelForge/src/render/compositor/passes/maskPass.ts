/**
 * PixelForge Render Compositor — MaskPass（遮罩 Pass）。
 *
 * 例如：圆形头像需要只显示区域。
 *
 * Shader 判断：
 *   if (maskDistance > 0) { discard; }
 *
 * 不是修改 Texture，而是修改 UV（裁剪区域）。
 * 原：0----1 → 裁剪：0.2---0.8
 * Shader: uv = cropMatrix * uv;
 */

import type { Mask } from '../mask';

/**
 * MaskPass — 管理 Mask 裁剪。
 *
 * Mask 类型：
 *   - circle:    圆形区域
 *   - rectangle: 矩形区域
 *   - path:      路径（预留）
 */
export class MaskPass {
  /**
   * 计算 Mask 的 WGSL 条件表达式。
   *
   * @param mask Mask 配置
   * @returns WGSL discard 条件代码片段
   */
  static getMaskCondition(mask: Mask): string {
    switch (mask.type) {
      case 'circle': {
        return `
  let maskDist = distance(vec2<f32>(uv.x * ${mask.centerX.toFixed(4)}, uv.y * ${mask.centerY.toFixed(4)}), uv);
  if (maskDist > ${mask.radius.toFixed(4)}) { discard; }
`;
      }
      case 'rectangle': {
        return `
  if (uv.x < ${mask.x.toFixed(4)} || uv.x > ${(mask.x + mask.width).toFixed(4)} ||
      uv.y < ${mask.y.toFixed(4)} || uv.y > ${(mask.y + mask.height).toFixed(4)}) { discard; }
`;
      }
      case 'path': {
        // 路径 Mask 需要更复杂的实现（SDF 或 stencil buffer）
        return `// path mask: not implemented`;
      }
      default:
        return '';
    }
  }
}
