/**
 * PixelForge - 图片分析器（Phase D 集成入口）
 *
 * 完整流水线（技术路线 §21.9.4 Phase 1）：
 *   HTMLImageElement
 *     → drawImage 到 canvas（读取像素）
 *     → prepareAnalysis（resize + boxBlur3Pass）
 *     → splitIntoBlocks（积分图 + Sobel + 自适应阈值 + 四象限递归）
 *     → buildColorBlockTree（像素坐标 → 归一化坐标）
 *     → checkBudget（复杂度预算检查 + 自动降级）
 *     → 返回 ColorBlockTree + ImageAnalysisResult
 *
 * 数据流对齐：
 *   - analyzer.ts 是 Phase B 和 Phase D 的统一入口
 *   - Phase B 的 ImageRegion 接口保留向后兼容
 *   - Phase D 新增 ColorBlockTree 作为主输出
 */

import type { BoundingBox } from '@/shared/types'
import { stableColorBlockId } from '@/shared/ids'
import { fromImageData, prepareAnalysis } from './resize'
import { splitIntoBlocks, type SplitOptions } from './adaptiveSplit'
import {
  buildColorBlockTree,
  ColorBlockTree,
  pruneTree,
  mergeLowSignificance,
  keepTopSignificant,
  countColorBlockNodes,
  collectLeafNodes,
  DEFAULT_COMPLEXITY_BUDGET,
  type ComplexityBudget,
  type BudgetCheckResult,
} from './colorBlockTree'

// ============================================================================
// 向后兼容接口（Phase B）
// ============================================================================

/** 分析得到的图片区域(归一化坐标 0-1) */
export interface ImageRegion {
  /** 区域 ID */
  id: string
  /** 归一化 X 坐标(0-1) */
  x: number
  /** 归一化 Y 坐标(0-1) */
  y: number
  /** 归一化宽度(0-1) */
  width: number
  /** 归一化高度(0-1) */
  height: number
  /** 代表色 [r, g, b, a](0-1 范围) */
  color: [number, number, number, number]
}

/** 分析结果 */
export interface ImageAnalysisResult {
  /** 原图尺寸 */
  sourceWidth: number
  sourceHeight: number
  /** 采样尺寸(降采样后) */
  sampleWidth: number
  sampleHeight: number
  /** 平均色 [r, g, b, a](0-1) */
  averageColor: [number, number, number, number]
  /** 分割出的区域列表（从 ColorBlockTree 叶子节点提取） */
  regions: ImageRegion[]
  /** 色块树（Phase D 主输出） */
  colorBlockTree: ColorBlockTree
  /** 复杂度预算检查结果 */
  budgetCheck: BudgetCheckResult
  /** 分析耗时(ms) */
  durationMs: number
}

// ============================================================================
// 分析配置
// ============================================================================

/**
 * 图片分析配置。
 */
export interface AnalyzeOptions {
  /** 采样最大长边（默认 256，用于读取 canvas 像素） */
  sampleMaxSize?: number
  /** 分析最大长边（默认 1920，用于积分图，4K → 1080p） */
  analysisMaxDim?: number
  /** Box blur 半径（默认 2） */
  blurRadius?: number
  /** 细分选项 */
  splitOptions?: SplitOptions
  /** 复杂度预算 */
  budget?: ComplexityBudget
  /** 原图 hash（来源引用，默认 'unknown'） */
  sourceRef?: string
}

/** 默认采样尺寸(长边不超过此值,等比缩放) */
const DEFAULT_SAMPLE_MAX_SIZE = 256

/** 默认分析最大长边（4K → 1080p） */
const DEFAULT_ANALYSIS_MAX_DIM = 1920

// ============================================================================
// analyzeImage — 完整分析流水线
// ============================================================================

/**
 * 分析图片,生成色块树和区域列表。
 *
 * 完整流程：
 *   1. 从 HTMLImageElement 读取像素数据（canvas 降采样到 sampleMaxSize）
 *   2. prepareAnalysis：resize 到 analysisMaxDim + boxBlur3Pass 降噪
 *   3. splitIntoBlocks：积分图 + Sobel + 自适应阈值 + 四象限递归细分
 *   4. buildColorBlockTree：像素坐标 → 归一化坐标
 *   5. checkBudget：复杂度预算检查，超预算时自动降级
 *   6. 从 ColorBlockTree 叶子节点提取 ImageRegion（向后兼容）
 *
 * @param image 已解码的 HTMLImageElement
 * @param options 分析配置
 */
export async function analyzeImage(
  image: HTMLImageElement,
  options: AnalyzeOptions = {},
): Promise<ImageAnalysisResult> {
  const start = performance.now()
  const sampleMaxSize = options.sampleMaxSize ?? DEFAULT_SAMPLE_MAX_SIZE
  const analysisMaxDim = options.analysisMaxDim ?? DEFAULT_ANALYSIS_MAX_DIM
  const blurRadius = options.blurRadius ?? 2
  const budget = options.budget ?? DEFAULT_COMPLEXITY_BUDGET
  const sourceRef = options.sourceRef ?? 'unknown'

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (naturalWidth <= 0 || naturalHeight <= 0) {
    throw new Error('图片尺寸无效,无法分析')
  }

  // Step 1: 降采样到 sampleMaxSize 以内(等比缩放)，读取像素
  const scale = Math.min(1, sampleMaxSize / Math.max(naturalWidth, naturalHeight))
  const sampleWidth = Math.max(1, Math.round(naturalWidth * scale))
  const sampleHeight = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('无法获取 2D 上下文,图片分析失败')
  }
  ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight)
  const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight)
  const samplePixels = fromImageData(imageData)

  // 计算平均色（向后兼容）
  const avg = computeAverageColor(samplePixels.data)

  // Step 2: 预处理（resize + blur）
  const { blurred } = prepareAnalysis(samplePixels, analysisMaxDim, blurRadius)

  // Step 3: 四象限递归细分
  const rawRoot = splitIntoBlocks(blurred, options.splitOptions)

  // Step 4: 构建色块树（像素坐标 → 归一化坐标）
  let tree = buildColorBlockTree(rawRoot, blurred.width, blurred.height, sourceRef)

  // Step 5: 复杂度预算检查 + 自动降级
  let budgetCheck = tree.checkBudget(budget)
  if (budgetCheck.isOverBudget) {
    tree = enforceBudget(tree, budget)
    budgetCheck = tree.checkBudget(budget)
  }

  // Step 6: 从 ColorBlockTree 叶子节点提取 ImageRegion（向后兼容）
  const regions = extractRegionsFromTree(tree)

  const durationMs = performance.now() - start
  return {
    sourceWidth: naturalWidth,
    sourceHeight: naturalHeight,
    sampleWidth,
    sampleHeight,
    averageColor: avg,
    regions,
    colorBlockTree: tree,
    budgetCheck,
    durationMs,
  }
}

// ============================================================================
// enforceBudget — 超预算降级流水线（骨架 §5.4 降级顺序）
// ============================================================================

/**
 * 超预算降级流水线。
 *
 * 降级顺序（骨架 §5.4）：
 *   Step 3: 限制深度（pruneTree）
 *   Step 4: 合并低显著度微块（mergeLowSignificance）
 *   Step 5: 仅保留关注区域（keepTopSignificant）
 *
 * Step 1（降分辨率）和 Step 2（提阈值）需要重新执行 splitIntoBlocks，
 * 在 analyzeImage 中通过减小 analysisMaxDim 和调整 splitOptions 实现。
 * 此函数处理已构建树的降级。
 */
function enforceBudget(
  tree: ColorBlockTree,
  budget: ComplexityBudget,
): ColorBlockTree {
  let { root } = tree

  // Step 3: 限制深度
  const currentMaxDepth = findMaxDepth(root)
  if (currentMaxDepth > budget.maxDepth) {
    root = pruneTree(root, budget.maxDepth)
  }

  // 重新检查
  let nodeCount = countColorBlockNodes(root)
  if (nodeCount > budget.maxNodeCount) {
    // Step 4: 合并低显著度微块（方差低于 30 的叶子）
    root = mergeLowSignificance(root, 30)
    nodeCount = countColorBlockNodes(root)
  }

  if (nodeCount > budget.maxNodeCount) {
    // Step 5: 仅保留关注区域（按方差排序，保留 topN 个叶子）
    const topN = Math.max(1, Math.floor(budget.maxNodeCount / 2))
    root = keepTopSignificant(root, topN)
  }

  // LLM 视图字符数超限：进一步限制深度
  let llmChars = describeLength(root)
  let depthLimit = budget.maxDepth
  while (llmChars > budget.maxLLMContextChars && depthLimit > 1) {
    depthLimit--
    root = pruneTree(root, depthLimit)
    llmChars = describeLength(root)
  }

  return new ColorBlockTree(root, tree.sourceWidth, tree.sourceHeight)
}

// ============================================================================
// extractRegionsFromTree — 从色块树提取 ImageRegion（向后兼容）
// ============================================================================

/**
 * 从 ColorBlockTree 的叶子节点提取 ImageRegion 列表。
 */
function extractRegionsFromTree(tree: ColorBlockTree): ImageRegion[] {
  const leaves = collectLeafNodes(tree.root)
  return leaves.map((node, index) => ({
    id: stableColorBlockId('image_analysis', `${node.path}:${index}`),
    x: node.bounds.x,
    y: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
    color: [
      node.color[0] / 255,
      node.color[1] / 255,
      node.color[2] / 255,
      1,
    ],
  }))
}

// ============================================================================
// regionToBoundingBox — 归一化坐标 → 像素坐标（向后兼容）
// ============================================================================

/** 把 ImageRegion 转成 RenderIR 用的 BoundingBox(归一化 → 像素,可选 canvas 尺寸) */
export function regionToBoundingBox(
  region: ImageRegion,
  canvasWidth: number,
  canvasHeight: number,
): BoundingBox {
  return {
    x: region.x * canvasWidth,
    y: region.y * canvasHeight,
    width: region.width * canvasWidth,
    height: region.height * canvasHeight,
  }
}

// ============================================================================
// 内部辅助
// ============================================================================

/** 计算 RGBA 像素数组的平均色(返回 0-1 范围) */
function computeAverageColor(pixels: Uint8ClampedArray): [number, number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  const pixelCount = pixels.length / 4
  if (pixelCount === 0) return [0, 0, 0, 1]

  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i]
    g += pixels[i + 1]
    b += pixels[i + 2]
    a += pixels[i + 3]
  }

  return [
    r / pixelCount / 255,
    g / pixelCount / 255,
    b / pixelCount / 255,
    a / pixelCount / 255,
  ]
}

/** 查找树的最大深度 */
function findMaxDepth(node: import('./colorBlockTree').ColorBlockNode): number {
  if (node.children.length === 0) return node.depth
  let max = node.depth
  for (const child of node.children) {
    max = Math.max(max, findMaxDepth(child))
  }
  return max
}

/** 估算 describeBlockTree 输出的字符数（简化版，不实际生成完整文本） */
function describeLength(node: import('./colorBlockTree').ColorBlockNode): number {
  // 每行约 80 字符（path + bounds + color + var + px）
  const lineLength = 80
  return countColorBlockNodes(node) * lineLength
}
