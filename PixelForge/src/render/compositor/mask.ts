/**
 * PixelForge Render Compositor — Mask（遮罩系统）。
 *
 * 例如：圆形头像需要只显示区域。
 *
 * Layer 增加可选 mask 字段。
 *
 * Shader 判断：
 *   if (maskDistance > 0) { discard; }
 */

/** Mask 类型。 */
export type MaskType = 'circle' | 'rectangle' | 'path';

/** 圆形 Mask 参数。 */
export interface CircleMask {
  type: 'circle';
  centerX: number;
  centerY: number;
  radius: number;
}

/** 矩形 Mask 参数。 */
export interface RectangleMask {
  type: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 路径 Mask 参数（预留）。 */
export interface PathMask {
  type: 'path';
  /** SVG 路径数据（后续解析为 GPU 可用格式） */
  data: string;
}

/** Mask 联合类型。 */
export type Mask = CircleMask | RectangleMask | PathMask;
