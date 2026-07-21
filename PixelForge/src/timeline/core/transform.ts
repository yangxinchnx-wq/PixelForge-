/**
 * PixelForge Timeline Core — Clip 空间变换。
 *
 * 每个 Clip 拥有独立的 Transform，控制其在输出画面中的
 * 位置、缩放、旋转和透明度。
 */

/** Clip 空间变换参数。 */
export interface Transform {
  /** X 位置（像素） */
  x: number;
  /** Y 位置（像素） */
  y: number;
  /** X 缩放（1 = 原始尺寸） */
  scaleX: number;
  /** Y 缩放（1 = 原始尺寸） */
  scaleY: number;
  /** 旋转角度（度） */
  rotation: number;
  /** 透明度（0-1） */
  opacity: number;
}

/** 默认 Transform：原始位置、无缩放、无旋转、完全不透明。 */
export const defaultTransform: Transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};
