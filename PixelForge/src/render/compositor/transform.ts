/**
 * PixelForge Render Compositor — Transform（空间变换）。
 *
 * 视频编辑必须：移动、缩放、旋转。
 *
 * GPU 不理解 x/y，需要矩阵。
 * 使用 3×3 矩阵（二维）：
 *   | a c tx |
 *   | b d ty |
 *   | 0 0 1  |
 *
 * 生成矩阵 → Uniform Buffer → Vertex Shader → 变换
 */

/** Compositor 空间变换参数。 */
export interface RenderTransform {
  /** 位置 */
  position: { x: number; y: number };
  /** 缩放 */
  scale: { x: number; y: number };
  /** 旋转角度（度） */
  rotation: number;
}

/** 默认 Transform：无变换。 */
export const defaultRenderTransform: RenderTransform = {
  position: { x: 0, y: 0 },
  scale: { x: 1, y: 1 },
  rotation: 0,
};

/**
 * 根据 Transform 生成 3×3 矩阵（行优先，9 个元素）。
 *
 * 组合顺序：缩放 → 旋转 → 平移
 *
 * 结果矩阵：
 *   | sx*cos  -sy*sin  tx |
 *   | sx*sin   sy*cos  ty |
 *   | 0        0       1  |
 *
 * @param transform 变换参数
 * @returns 9 元素数组（mat3x3<f32> 兼容）
 */
export function createTransformMatrix(transform: RenderTransform): number[] {
  const { x: tx, y: ty } = transform.position;
  const { x: sx, y: sy } = transform.scale;
  const rad = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 行优先 3×3 矩阵
  return [
    sx * cos, -sy * sin, tx,  // 第一行
    sx * sin,  sy * cos, ty,  // 第二行
    0,        0,        1,   // 第三行
  ];
}
