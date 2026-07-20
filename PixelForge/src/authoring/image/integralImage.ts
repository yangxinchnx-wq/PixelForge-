/**
 * PixelForge - 积分图（骨架 §5.4 / 技术路线 §21.9.3.3）
 *
 * 积分图把任意矩形区域的「灰度和 / 灰度平方和 / 边缘强度和」查询降到 O(1)。
 * 这是自适应细分（adaptiveSplit.ts）的核心加速结构。
 *
 * 内存模型（技术路线 §21.9.3.3）：
 *   grayIntegral     — 灰度积分图（用于均值 / 方差查询）
 *   graySqIntegral   — 灰度平方积分图（用于方差查询）
 *   edgeIntegral     — Sobel 边缘强度积分图（用于边缘强度查询）
 *
 * 三个积分图各占 width × height × 8 字节（Float64Array）。
 * 1080p 内存：1920×1080 × 8 × 3 ≈ 49.5 MB
 *
 * 数据流：
 *   PixelData（blur 后）
 *     → gray[]（灰度值）
 *     → edge[]（Sobel 梯度幅值）
 *     → grayIntegral / graySqIntegral / edgeIntegral（积分图）
 */

import type { PixelData } from './resize'

// ============================================================================
// Rect — 像素坐标矩形（积分图查询用）
// ============================================================================

/**
 * 像素坐标矩形。
 * x, y 为左上角，width, height 为尺寸。
 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// ============================================================================
// IntegralImages — 积分图类
// ============================================================================

/**
 * 积分图。
 *
 * 构建流程：
 *   1. 从 PixelData 计算每像素灰度值 → gray[]
 *   2. 用 Sobel 算子计算每像素边缘强度 → edge[]
 *   3. 对 gray[] 和 gray[]² 和 edge[] 分别构建积分图
 *
 * 查询：
 *   - queryRectSum(integral, rect)  — 任意积分图的矩形区域和（O(1)）
 *   - queryEdgeStrength(rect)       — 矩形区域平均边缘强度
 *   - queryVariance(rect)           — 矩形区域灰度方差
 */
export class IntegralImages {
  readonly width: number
  readonly height: number

  /** 灰度值数组（非积分图，供 detectTinyObjects 直接访问） */
  readonly gray: Float64Array

  /** 灰度积分图 */
  readonly grayIntegral: Float64Array

  /** 灰度平方积分图 */
  readonly graySqIntegral: Float64Array

  /** Sobel 边缘强度积分图 */
  readonly edgeIntegral: Float64Array

  constructor(imageData: PixelData) {
    this.width = imageData.width
    this.height = imageData.height
    const n = this.width * this.height

    this.gray = new Float64Array(n)
    this.grayIntegral = new Float64Array(n)
    this.graySqIntegral = new Float64Array(n)
    this.edgeIntegral = new Float64Array(n)

    this.build(imageData)
  }

  // --------------------------------------------------------------------------
  // build — 一次性构建所有积分图
  // --------------------------------------------------------------------------

  private build(imageData: PixelData): void {
    const { data, width: w, height: h } = imageData
    const { gray, grayIntegral, graySqIntegral, edgeIntegral } = this

    // Step 1: 计算灰度值（Rec.601 luma）
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const pi = (y * w + x) * 4
        const i = y * w + x
        gray[i] =
          data[pi] * 0.299 +
          data[pi + 1] * 0.587 +
          data[pi + 2] * 0.114
      }
    }

    // Step 2: 构建灰度积分图 + 灰度平方积分图
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const left = x > 0 ? grayIntegral[i - 1] : 0
        const top = y > 0 ? grayIntegral[i - w] : 0
        const topLeft = x > 0 && y > 0 ? grayIntegral[i - w - 1] : 0
        grayIntegral[i] = gray[i] + left + top - topLeft

        const leftSq = x > 0 ? graySqIntegral[i - 1] : 0
        const topSq = y > 0 ? graySqIntegral[i - w] : 0
        const topLeftSq = x > 0 && y > 0 ? graySqIntegral[i - w - 1] : 0
        graySqIntegral[i] = gray[i] * gray[i] + leftSq + topSq - topLeftSq
      }
    }

    // Step 3: 计算 Sobel 边缘强度（需要 3×3 邻域，最外 1 像素为 0）
    const edge = new Float64Array(w * h)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        // Sobel Gx
        const gx =
          -gray[i - w - 1] + gray[i - w + 1] +
          -2 * gray[i - 1] + 2 * gray[i + 1] +
          -gray[i + w - 1] + gray[i + w + 1]
        // Sobel Gy
        const gy =
          -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
          gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]

        edge[i] = Math.sqrt(gx * gx + gy * gy)
      }
    }

    // Step 4: 构建边缘强度积分图
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const left = x > 0 ? edgeIntegral[i - 1] : 0
        const top = y > 0 ? edgeIntegral[i - w] : 0
        const topLeft = x > 0 && y > 0 ? edgeIntegral[i - w - 1] : 0
        edgeIntegral[i] = edge[i] + left + top - topLeft
      }
    }
  }

  // --------------------------------------------------------------------------
  // queryRectSum — O(1) 矩形区域和查询
  // --------------------------------------------------------------------------

  /**
   * 查询任意积分图的矩形区域和（O(1)）。
   *
   * 积分图公式：
   *   sum(rect) = I[y2][x2] - I[y2][x-1] - I[y-1][x2] + I[y-1][x-1]
   *
   * 边界处理：rect 被裁剪到 [0, width) × [0, height)。
   */
  queryRectSum(integral: Float64Array, rect: Rect): number {
    const x = Math.min(Math.max(0, rect.x), this.width - 1)
    const y = Math.min(Math.max(0, rect.y), this.height - 1)
    const w = Math.min(rect.width, this.width - x)
    const h = Math.min(rect.height, this.height - y)
    if (w <= 0 || h <= 0) return 0

    const x2 = x + w - 1
    const y2 = y + h - 1

    const sum = integral[y2 * this.width + x2]
    const left = x > 0 ? integral[y2 * this.width + x - 1] : 0
    const top = y > 0 ? integral[(y - 1) * this.width + x2] : 0
    const topLeft = x > 0 && y > 0 ? integral[(y - 1) * this.width + x - 1] : 0

    return sum - left - top + topLeft
  }

  /**
   * 查询矩形区域的平均边缘强度。
   *
   * 返回值 = edgeIntegral 区域和 / 像素数。
   */
  queryEdgeStrength(rect: Rect): number {
    const count = rect.width * rect.height
    if (count <= 0) return 0
    const sum = this.queryRectSum(this.edgeIntegral, rect)
    return sum / count
  }

  /**
   * 查询矩形区域的灰度方差。
   *
   * 方差公式：Var = E[X²] - (E[X])²
   *   = sumSq / count - (sum / count)²
   */
  queryVariance(rect: Rect): number {
    const count = rect.width * rect.height
    if (count <= 0) return 0
    const sum = this.queryRectSum(this.grayIntegral, rect)
    const sumSq = this.queryRectSum(this.graySqIntegral, rect)
    const mean = sum / count
    return sumSq / count - mean * mean
  }

  /**
   * 查询矩形区域的平均灰度。
   */
  queryMean(rect: Rect): number {
    const count = rect.width * rect.height
    if (count <= 0) return 0
    return this.queryRectSum(this.grayIntegral, rect) / count
  }
}

// ============================================================================
// estimateNoiseLevel — 噪声水平估计（技术路线 §21.9.3.5）
// ============================================================================

/**
 * 估计图像的噪声水平。
 *
 * 原理：比较「全局方差」与「小方块（8×8）局部方差的平均值」。
 *   - 干净图：局部方差 ≈ 全局方差，noiseLevel ≈ 1.0
 *   - 噪声图：局部方差 >> 全局方差，noiseLevel ≈ 3.0~5.0
 *
 * 返回值用于 getAdaptiveThreshold 的噪声补偿因子。
 */
export function estimateNoiseLevel(integrals: IntegralImages): number {
  const globalVariance = integrals.queryVariance({
    x: 0,
    y: 0,
    width: integrals.width,
    height: integrals.height,
  })

  if (globalVariance <= 0) return 0

  let localVarianceSum = 0
  let count = 0
  const step = 8

  for (let y = 0; y < integrals.height; y += step) {
    const remainingH = Math.min(step, integrals.height - y)
    for (let x = 0; x < integrals.width; x += step) {
      const remainingW = Math.min(step, integrals.width - x)
      localVarianceSum += integrals.queryVariance({
        x,
        y,
        width: remainingW,
        height: remainingH,
      })
      count++
    }
  }

  if (count === 0) return 0
  const avgLocalVariance = localVarianceSum / count
  return avgLocalVariance / globalVariance
}

// ============================================================================
// detectTinyObjects — 微小物体检测（技术路线 §21.9.3.6）
// ============================================================================

/**
 * 检测矩形区域内是否存在微小亮物体（如 2-3 像素的星星）。
 *
 * 原理：局部最大值检测 — 中心像素亮度 > 4 邻域像素亮度 + 阈值（30）。
 *
 * @param integrals 积分图实例
 * @param rect 检测区域（像素坐标）
 * @param minSize 最小有效物体尺寸（默认 2），rect 面积必须 ≥ minSize² × 4
 * @returns 是否检测到微小物体
 */
export function detectTinyObjects(
  integrals: IntegralImages,
  rect: Rect,
  brightnessThreshold: number = 30,
): boolean {
  const { gray, width: imgW, height: imgH } = integrals
  const w = rect.width
  const h = rect.height

  // 区域太小，无法检测
  if (w < 3 || h < 3) return false

  let brightSpotCount = 0
  for (let dy = 1; dy < h - 1; dy++) {
    for (let dx = 1; dx < w - 1; dx++) {
      const gx = rect.x + dx
      const gy = rect.y + dy
      // 边界安全检查
      if (gx < 1 || gx >= imgW - 1 || gy < 1 || gy >= imgH - 1) continue

      const idx = gy * imgW + gx
      const center = gray[idx]
      const neighbors = [
        gray[idx - imgW], // 上
        gray[idx + imgW], // 下
        gray[idx - 1],    // 左
        gray[idx + 1],    // 右
      ]
      if (neighbors.every(n => center > n + brightnessThreshold)) {
        brightSpotCount++
      }
    }
  }

  // 至少有 1 个亮点且区域面积足够大
  return brightSpotCount > 0 && w * h >= 4
}
