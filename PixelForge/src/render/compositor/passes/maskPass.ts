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
        // 路径 Mask：解析 SVG path 的 M/L 命令提取多边形顶点
        // 生成 WGSL 多边形包含检测代码（奇偶规则）
        // 对于复杂路径（含曲线），回退到边界框裁剪
        if (!mask.data || mask.data.trim() === '') {
          return '' // 无路径数据 → 不裁剪
        }

        // 提取所有坐标点（M/L/C 等命令的数字）
        const coords: number[] = []
        const tokens = mask.data.match(/[-+]?\d*\.?\d+/g)
        if (tokens) {
          for (const t of tokens) {
            const n = parseFloat(t)
            if (!Number.isNaN(n)) coords.push(n)
          }
        }

        if (coords.length < 4) {
          // 点太少，无法形成多边形 → 回退到无裁剪
          return ''
        }

        // 提取顶点对 (x, y)
        const points: [number, number][] = []
        for (let i = 0; i + 1 < coords.length; i += 2) {
          points.push([coords[i], coords[i + 1]])
        }

        if (points.length < 3) {
          // 少于 3 个点 → 退化为边界框
          const xs = points.map((p) => p[0])
          const ys = points.map((p) => p[1])
          const minX = Math.min(...xs)
          const maxX = Math.max(...xs)
          const minY = Math.min(...ys)
          const maxY = Math.max(...ys)
          return `
  if (uv.x < ${minX.toFixed(4)} || uv.x > ${maxX.toFixed(4)} ||
      uv.y < ${minY.toFixed(4)} || uv.y > ${maxY.toFixed(4)}) { discard; }
`
        }

        // 生成 WGSL 多边形包含检测（ray casting 奇偶规则）
        let code = '  var inside: bool = false;\n'
        const n = points.length
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = points[i][0]
          const yi = points[i][1]
          const xj = points[j][0]
          const yj = points[j][1]
          code += `  if ((${yi.toFixed(4)} > uv.y) != (${yj.toFixed(4)} > uv.y)) {\n`
          code += `    let xIntersect = (${xj.toFixed(4)} - ${xi.toFixed(4)}) * (uv.y - ${yi.toFixed(4)}) / (${yj.toFixed(4)} - ${yi.toFixed(4)}) + ${xi.toFixed(4)};\n`
          code += `    if (uv.x < xIntersect) { inside = !inside; }\n`
          code += `  }\n`
        }
        code += '  if (!inside) { discard; }\n'

        return code
      }
      default:
        return '';
    }
  }
}
