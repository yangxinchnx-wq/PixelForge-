/**
 * PixelForge - 自适应细分（骨架 §5.4 / 技术路线 §21.9.3.8）
 *
 * 四象限递归细分算法，使用「边缘检测 + 方差 + 最小尺寸 + 噪声鲁棒性」
 * 四重判断替代固定阈值（技术路线 §21.9.3）。
 *
 * 决策逻辑（§21.9.3.8 最终版）：
 * | 条件                 | 结果   | 说明                 |
 * |---------------------|--------|---------------------|
 * | 微小物体 + 小尺寸块   | 强制细分 | 2-3 像素星星必须捕获  |
 * | 边缘强 + 方差高       | 细分    | 典型物体边界          |
 * | 边缘强 + 方差低       | 细分    | 细线、渐变边界        |
 * | 边缘弱 + 方差高       | 不细分  | 纹理区域整体保留      |
 * | 边缘弱 + 方差低       | 不细分  | 均匀区域             |
 *
 * 数据流：
 *   IntegralImages + 噪声水平
 *     → shouldSplit(block, ctx)
 *     → 四象限递归（splitRecursive）
 *     → RawBlockNode 树（像素坐标）
 *     → colorBlockTree.ts 转换为 ColorBlockNode（归一化坐标）
 */

import type { PixelData } from './resize'
import type { Rect, IntegralImages } from './integralImage'
import {
  IntegralImages as IntegralImagesClass,
  estimateNoiseLevel,
  detectTinyObjects,
} from './integralImage'

// ============================================================================
// RawBlock — 细分过程中的原始色块（像素坐标）
// ============================================================================

/**
 * 细分过程中的原始色块（像素坐标）。
 *
 * 与 colorBlockTree.ts 的 ColorBlockNode 区别：
 *   - RawBlockNode 使用像素坐标（用于积分图查询）
 *   - ColorBlockNode 使用归一化坐标（BoundingBox，用于跨层传输）
 */
export interface RawBlockNode {
  /** 像素坐标矩形 */
  rect: Rect
  /** 平均色 [r, g, b]（0-255） */
  avgColor: [number, number, number]
  /** 主色 [r, g, b]（0-255） */
  dominantColor: [number, number, number]
  /** 灰度方差 */
  variance: number
  /** 像素数 */
  pixelCount: number
  /** 树深度（根节点 = 0） */
  depth: number
  /** 空间路径编码（如 "root/0/1/3"） */
  path: string
  /** 子节点 */
  children: RawBlockNode[]
}

// ============================================================================
// SplitContext — 细分上下文（技术路线 §21.9.3.8）
// ============================================================================

/**
 * 细分上下文。
 *
 * 在 splitIntoBlocks 开始时一次性计算，递归过程中不变。
 */
export interface SplitContext {
  /** 积分图实例 */
  integrals: IntegralImages
  /** 噪声水平（来自 estimateNoiseLevel） */
  noiseLevel: number
  /** 全局平均边缘强度（用于自适应阈值基线） */
  globalEdgeStrength: number
  /** 最大深度（默认 6） */
  maxDepth: number
  /** 最小块尺寸（默认 8，小于此值不再细分） */
  minBlockSize: number
  /** 微小物体检测的亮度阈值（默认 30） */
  tinyObjectBrightnessThreshold: number
}

// ============================================================================
// getAdaptiveThreshold — 自适应阈值（技术路线 §21.9.3.5）
// ============================================================================

/**
 * 计算自适应阈值。
 *
 * 噪声补偿因子 = 1 + noiseLevel × 2
 *   - 干净图（noiseLevel ≈ 1.0）：edge=15, variance=50 × 1.2^depth
 *   - 噪声图（noiseLevel ≈ 3.0）：edge=75, variance=150~250 × 1.2^depth
 *
 * @param noiseLevel 噪声水平
 * @param depth 当前块深度
 * @param globalEdgeStrength 全局平均边缘强度
 * @returns 边缘阈值 + 方差阈值
 */
export function getAdaptiveThreshold(
  noiseLevel: number,
  depth: number,
  globalEdgeStrength: number,
): { edge: number; variance: number } {
  const noiseCompensation = 1 + noiseLevel * 2
  // 边缘阈值 = 全局边缘强度 × 0.3 × 噪声补偿
  // 最小值 1，防止均匀图（globalEdgeStrength=0）时 edgeThreshold=0 导致 0>=0 误判
  const edgeThreshold = Math.max(1, globalEdgeStrength * 0.3 * noiseCompensation)
  // 方差阈值 = 50 × 1.2^depth × 噪声补偿（深度越深，阈值越高，避免过度细分）
  const varianceThreshold = 50 * Math.pow(1.2, depth) * noiseCompensation

  return { edge: edgeThreshold, variance: varianceThreshold }
}

// ============================================================================
// shouldSplit — 细分判断（技术路线 §21.9.3.8 最终版）
// ============================================================================

/**
 * 判断一个色块是否应该继续细分。
 *
 * 决策优先级：微小物体 > 强边缘+高方差 > 强边缘 > 其余不细分
 *
 * @param block 当前色块
 * @param ctx 细分上下文
 * @returns 是否应该细分
 */
export function shouldSplit(block: RawBlockNode, ctx: SplitContext): boolean {
  // 1. 硬性限制（不可突破）
  if (block.rect.width < ctx.minBlockSize || block.rect.height < ctx.minBlockSize) {
    return false
  }
  if (block.depth >= ctx.maxDepth) {
    return false
  }

  // 2. 自适应阈值
  const threshold = getAdaptiveThreshold(
    ctx.noiseLevel,
    block.depth,
    ctx.globalEdgeStrength,
  )

  // 3. 边缘检测
  const edgeStrength = ctx.integrals.queryEdgeStrength(block.rect)

  // 4. 方差检测
  const variance = ctx.integrals.queryVariance(block.rect)

  // 5. 微小物体检测（仅小尺寸块触发）
  const hasTinyObject =
    block.rect.width <= 32 &&
    block.rect.height <= 32 &&
    detectTinyObjects(
      ctx.integrals,
      block.rect,
      ctx.tinyObjectBrightnessThreshold,
    )

  // 6. 优先级决策
  if (hasTinyObject) return true
  if (edgeStrength >= threshold.edge && variance >= threshold.variance) return true
  if (edgeStrength >= threshold.edge) return true

  return false
}

// ============================================================================
// analyzeBlock — 计算色块属性
// ============================================================================

/**
 * 计算一个矩形区域的色块属性（平均色、主色、方差、像素数）。
 */
export function analyzeBlock(
  pixels: PixelData,
  rect: Rect,
  integrals: IntegralImages,
): Omit<RawBlockNode, 'depth' | 'path' | 'children'> {
  const { data, width: imgW } = pixels
  const { x, y, width: w, height: h } = rect

  let totalR = 0
  let totalG = 0
  let totalB = 0
  const pixelCount = w * h

  // 颜色直方图（用于主色计算，量化到 16 级）
  const binCount = 16
  const histogram = new Map<string, number>()

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const pi = ((y + dy) * imgW + (x + dx)) * 4
      const r = data[pi]
      const g = data[pi + 1]
      const b = data[pi + 2]

      totalR += r
      totalG += g
      totalB += b

      // 量化到 bin
      const rBin = Math.floor(r / (256 / binCount))
      const gBin = Math.floor(g / (256 / binCount))
      const bBin = Math.floor(b / (256 / binCount))
      const key = `${rBin},${gBin},${bBin}`
      histogram.set(key, (histogram.get(key) ?? 0) + 1)
    }
  }

  // 平均色
  const avgColor: [number, number, number] = [
    Math.round(totalR / pixelCount),
    Math.round(totalG / pixelCount),
    Math.round(totalB / pixelCount),
  ]

  // 主色（直方图中出现次数最多的 bin 的中心值）
  let maxCount = 0
  let dominantBin = [0, 0, 0]
  for (const [key, count] of histogram) {
    if (count > maxCount) {
      maxCount = count
      const parts = key.split(',').map(Number)
      dominantBin = parts
    }
  }
  const binSize = 256 / binCount
  const dominantColor: [number, number, number] = [
    Math.round((dominantBin[0] + 0.5) * binSize),
    Math.round((dominantBin[1] + 0.5) * binSize),
    Math.round((dominantBin[2] + 0.5) * binSize),
  ]

  // 方差（从积分图查询，O(1)）
  const variance = integrals.queryVariance(rect)

  return {
    rect,
    avgColor,
    dominantColor,
    variance,
    pixelCount,
  }
}

// ============================================================================
// splitIntoBlocks — 四象限递归细分主函数
// ============================================================================

/**
 * 细分配置选项。
 */
export interface SplitOptions {
  /** 最大深度（默认 6） */
  maxDepth?: number
  /** 最小块尺寸（默认 8） */
  minBlockSize?: number
  /** 微小物体检测亮度阈值（默认 30） */
  tinyObjectBrightnessThreshold?: number
}

/**
 * 四象限递归细分。
 *
 * 完整流程（技术路线 §21.9.3.7 + §21.9.3.8）：
 *   1. 从 PixelData 构建积分图
 *   2. 估计噪声水平
 *   3. 计算全局边缘强度
 *   4. 四象限递归细分，每层用 shouldSplit 判断是否继续
 *
 * @param pixels 预处理后的像素数据（建议传入 blur 后的图像）
 * @param options 细分选项
 * @returns 根色块节点（像素坐标树）
 */
export function splitIntoBlocks(
  pixels: PixelData,
  options: SplitOptions = {},
): RawBlockNode {
  const maxDepth = options.maxDepth ?? 6
  const minBlockSize = options.minBlockSize ?? 8
  const tinyObjectBrightnessThreshold = options.tinyObjectBrightnessThreshold ?? 30

  // 构建积分图
  const integrals = new IntegralImagesClass(pixels)

  // 估计噪声水平
  const noiseLevel = estimateNoiseLevel(integrals)

  // 全局边缘强度（整图平均）
  const globalEdgeStrength = integrals.queryEdgeStrength({
    x: 0,
    y: 0,
    width: pixels.width,
    height: pixels.height,
  })

  const ctx: SplitContext = {
    integrals,
    noiseLevel,
    globalEdgeStrength,
    maxDepth,
    minBlockSize,
    tinyObjectBrightnessThreshold,
  }

  // 递归细分
  return splitRecursive(pixels, ctx, 0, 0, pixels.width, pixels.height, 0, 'root')
}

/**
 * 递归细分单个区域。
 */
function splitRecursive(
  pixels: PixelData,
  ctx: SplitContext,
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
  path: string,
): RawBlockNode {
  const rect: Rect = { x, y, width: w, height: h }

  // 计算色块属性
  const blockProps = analyzeBlock(pixels, rect, ctx.integrals)
  const block: RawBlockNode = {
    ...blockProps,
    depth,
    path,
    children: [],
  }

  // 判断是否需要细分
  if (!shouldSplit(block, ctx)) {
    return block
  }

  // 四象限细分
  const halfW = Math.floor(w / 2)
  const halfH = Math.floor(h / 2)
  const rightW = w - halfW
  const bottomH = h - halfH

  // 如果无法再分（halfW/halfH 为 0），直接返回
  if (halfW < 1 || halfH < 1) {
    return block
  }

  block.children = [
    // 左上
    splitRecursive(pixels, ctx, x, y, halfW, halfH, depth + 1, `${path}/0`),
    // 右上
    splitRecursive(pixels, ctx, x + halfW, y, rightW, halfH, depth + 1, `${path}/1`),
    // 左下
    splitRecursive(pixels, ctx, x, y + halfH, halfW, bottomH, depth + 1, `${path}/2`),
    // 右下
    splitRecursive(pixels, ctx, x + halfW, y + halfH, rightW, bottomH, depth + 1, `${path}/3`),
  ]

  return block
}

// ============================================================================
// countNodes — 统计树节点数
// ============================================================================

/**
 * 统色块树的总节点数（含根节点）。
 */
export function countNodes(root: RawBlockNode): number {
  let count = 1
  for (const child of root.children) {
    count += countNodes(child)
  }
  return count
}

/**
 * 统计色块树的叶子节点数。
 */
export function countLeafNodes(root: RawBlockNode): number {
  if (root.children.length === 0) return 1
  let count = 0
  for (const child of root.children) {
    count += countLeafNodes(child)
  }
  return count
}

/**
 * 统计色块树的最大深度。
 */
export function maxDepthOf(root: RawBlockNode): number {
  if (root.children.length === 0) return root.depth
  let maxChildDepth = root.depth
  for (const child of root.children) {
    maxChildDepth = Math.max(maxChildDepth, maxDepthOf(child))
  }
  return maxChildDepth
}
