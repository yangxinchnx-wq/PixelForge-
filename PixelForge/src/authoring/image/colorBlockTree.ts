/**
 * PixelForge - 颜色块树（骨架 §5.4 / 技术路线 §21.9.2）
 *
 * 将 adaptiveSplit.ts 输出的 RawBlockNode 树（像素坐标）转换为
 * ColorBlockNode 树（归一化坐标），并提供两种消费视图：
 *
 *   1. toLLMView(maxDepth)  — 树形文本输出，供 LLM 理解图像结构（§22.4 P1 优先级）
 *   2. toUserView(depth)    — 提取指定深度的色块列表（Phase 3 交互式编辑用）
 *
 * 复杂度预算控制（骨架 §4.6 / §5.4）：
 *   maxNodeCount: 5000
 *   maxDepth: 7
 *   maxLLMContextChars: 8000
 *   maxTinyObjectNodes: 200
 *   maxAnalysisTimeMs: 5000
 *
 * 超预算降级顺序（骨架 §5.4）：
 *   降分辨率 → 提阈值 → 限制深度 → 合并低显著度微块 → 仅保留关注区域
 */

import type { BoundingBox, Color, SourceKind } from '@/shared/types'
import { stableColorBlockId } from '@/shared/ids'
import type { RawBlockNode } from './adaptiveSplit'

// ============================================================================
// ColorBlockNode — 颜色块树节点（骨架 §5.4）
// ============================================================================

/**
 * 颜色块树节点（骨架 §5.4）。
 *
 * bounds 使用归一化坐标 [0,1]（对齐 BoundingBox 类型定义），
 * 与 RawBlockNode（像素坐标）区别。
 */
export interface ColorBlockNode {
  /** 稳定 ID（基于来源 + 坐标 + 深度生成） */
  id: string
  /** 归一化边界 [0,1] */
  bounds: BoundingBox
  /** 平均色 [r, g, b]（0-255） */
  color: Color
  /** 主色 [r, g, b]（0-255） */
  dominantColor: Color
  /** 灰度方差 */
  variance: number
  /** 像素数 */
  pixelCount: number
  /** 树深度（根节点 = 0） */
  depth: number
  /** 空间路径编码（如 "root/0/1/3"） */
  path: string
  /** 子节点 */
  children: ColorBlockNode[]
  /** 来源追踪（骨架 §4.1.4 / §6.2 接入点 4） */
  source: Extract<SourceKind, 'image_analysis'>
  /** 原图 hash（来源引用） */
  sourceRef: string
}

// ============================================================================
// ComplexityBudget — 复杂度预算（骨架 §4.6 / §5.4）
// ============================================================================

/**
 * 复杂度预算硬约束（骨架 §5.4）。
 */
export interface ComplexityBudget {
  /** 最大节点数 */
  maxNodeCount: number
  /** 最大深度 */
  maxDepth: number
  /** LLM 视图最大字符数 */
  maxLLMContextChars: number
  /** 微小物体节点最大数 */
  maxTinyObjectNodes: number
  /** 最大分析时间（ms） */
  maxAnalysisTimeMs: number
}

/**
 * 默认复杂度预算（骨架 §5.4 硬约束值）。
 */
export const DEFAULT_COMPLEXITY_BUDGET: ComplexityBudget = {
  maxNodeCount: 5000,
  maxDepth: 7,
  maxLLMContextChars: 8000,
  maxTinyObjectNodes: 200,
  maxAnalysisTimeMs: 5000,
}

/**
 * 复杂度预算检查结果。
 */
export interface BudgetCheckResult {
  /** 是否超预算 */
  isOverBudget: boolean
  /** 总节点数 */
  nodeCount: number
  /** 最大深度 */
  maxDepth: number
  /** LLM 视图字符数 */
  llmContextChars: number
  /** 微小物体节点数 */
  tinyObjectNodeCount: number
  /** 超出的预算项 */
  violations: string[]
}

// ============================================================================
// ColorBlockTree — 颜色块树类（技术路线 §21.9.2）
// ============================================================================

/**
 * 颜色块树。
 *
 * 从 RawBlockNode（像素坐标）构建，转换为 ColorBlockNode（归一化坐标）。
 * 提供 toLLMView / toUserView 两种消费视图。
 */
export class ColorBlockTree {
  /** 根节点 */
  readonly root: ColorBlockNode
  /** 原图宽度（像素，用于坐标归一化） */
  readonly sourceWidth: number
  /** 原图高度（像素，用于坐标归一化） */
  readonly sourceHeight: number

  constructor(root: ColorBlockNode, sourceWidth: number, sourceHeight: number) {
    this.root = root
    this.sourceWidth = sourceWidth
    this.sourceHeight = sourceHeight
  }

  // --------------------------------------------------------------------------
  // toLLMView — LLM 可读的树形文本（§22.4 P1 优先级）
  // --------------------------------------------------------------------------

  /**
   * 生成 LLM 可读的树形文本描述。
   *
   * 输出格式示例：
   * ```
   * [0] root (0.00,0.00 1.00×1.00) color=#a0b0c0 var=1234 px=1920×1080
   *   ├─[1] root/0 (0.00,0.00 0.50×0.50) color=#ff0000 var=50 px=480×270
   *   ├─[1] root/1 (0.50,0.00 0.50×0.50) color=#00ff00 var=80 px=480×270
   *   │  ├─[2] root/1/0 (0.50,0.00 0.25×0.25) color=#00cc00 var=20 px=240×135
   *   │  └─[2] root/1/1 (0.75,0.25 0.25×0.25) color=#00aa00 var=15 px=240×135
   *   ├─[1] root/2 (0.00,0.50 0.50×0.50) color=#0000ff var=30 px=480×270
   *   └─[1] root/3 (0.50,0.50 0.50×0.50) color=#ffff00 var=200 px=480×270
   * ```
   *
   * @param maxDepth 最大输出深度（默认 4），超过此深度的子树不输出
   * @returns 树形文本
   */
  toLLMView(maxDepth: number = 4): string {
    return describeBlockTree(this.root, maxDepth)
  }

  // --------------------------------------------------------------------------
  // toUserView — 提取指定深度的色块（技术路线 §21.9.2）
  // --------------------------------------------------------------------------

  /**
   * 提取指定深度的色块列表（供 Phase 3 交互式编辑用）。
   *
   * BFS 到目标深度，收集该深度所有节点。
   * 如果某分支在目标深度之前已为叶子，则收集该叶子。
   *
   * @param depth 目标深度（默认 2）
   * @returns 色块节点列表
   */
  toUserView(depth: number = 2): ColorBlockNode[] {
    return extractBlocksAtDepth(this.root, depth)
  }

  // --------------------------------------------------------------------------
  // checkBudget — 复杂度预算检查
  // --------------------------------------------------------------------------

  /**
   * 检查当前树是否超出复杂度预算。
   */
  checkBudget(budget: ComplexityBudget = DEFAULT_COMPLEXITY_BUDGET): BudgetCheckResult {
    const nodeCount = countColorBlockNodes(this.root)
    const maxDepth = maxColorBlockDepth(this.root)
    const llmContextChars = this.toLLMView().length
    const tinyObjectNodeCount = countTinyObjectNodes(this.root)

    const violations: string[] = []
    if (nodeCount > budget.maxNodeCount) {
      violations.push(`nodeCount ${nodeCount} > ${budget.maxNodeCount}`)
    }
    if (maxDepth > budget.maxDepth) {
      violations.push(`maxDepth ${maxDepth} > ${budget.maxDepth}`)
    }
    if (llmContextChars > budget.maxLLMContextChars) {
      violations.push(`llmContextChars ${llmContextChars} > ${budget.maxLLMContextChars}`)
    }
    if (tinyObjectNodeCount > budget.maxTinyObjectNodes) {
      violations.push(`tinyObjectNodeCount ${tinyObjectNodeCount} > ${budget.maxTinyObjectNodes}`)
    }

    return {
      isOverBudget: violations.length > 0,
      nodeCount,
      maxDepth,
      llmContextChars,
      tinyObjectNodeCount,
      violations,
    }
  }
}

// ============================================================================
// buildColorBlockTree — 从 RawBlockNode 构建 ColorBlockTree
// ============================================================================

/**
 * 从 RawBlockNode（像素坐标）构建 ColorBlockTree（归一化坐标）。
 *
 * @param rawRoot adaptiveSplit 输出的原始色块树根节点
 * @param sourceWidth 原图宽度（像素）
 * @param sourceHeight 原图高度（像素）
 * @param sourceRef 原图 hash（来源引用）
 * @returns ColorBlockTree 实例
 */
export function buildColorBlockTree(
  rawRoot: RawBlockNode,
  sourceWidth: number,
  sourceHeight: number,
  sourceRef: string,
): ColorBlockTree {
  const root = convertNode(rawRoot, sourceWidth, sourceHeight, sourceRef)
  return new ColorBlockTree(root, sourceWidth, sourceHeight)
}

/**
 * 递归转换 RawBlockNode → ColorBlockNode（像素坐标 → 归一化坐标）。
 */
function convertNode(
  raw: RawBlockNode,
  sourceWidth: number,
  sourceHeight: number,
  sourceRef: string,
): ColorBlockNode {
  const { rect } = raw

  // 归一化坐标 [0,1]
  const bounds: BoundingBox = {
    x: rect.x / sourceWidth,
    y: rect.y / sourceHeight,
    width: rect.width / sourceWidth,
    height: rect.height / sourceHeight,
  }

  // 稳定 ID：基于来源 + 路径 + 坐标
  const id = stableColorBlockId(
    'image_analysis',
    `${raw.path}:${rect.x},${rect.y},${rect.width},${rect.height}`,
  )

  return {
    id,
    bounds,
    color: raw.avgColor,
    dominantColor: raw.dominantColor,
    variance: raw.variance,
    pixelCount: raw.pixelCount,
    depth: raw.depth,
    path: raw.path,
    children: raw.children.map(child =>
      convertNode(child, sourceWidth, sourceHeight, sourceRef),
    ),
    source: 'image_analysis',
    sourceRef,
  }
}

// ============================================================================
// describeBlockTree — 树形文本输出（§22.4 P1 优先级）
// ============================================================================

/**
 * 递归生成色块树的树形文本描述。
 *
 * 使用 ├─ / └─ / │  字符绘制树形结构。
 *
 * @param node 根节点
 * @param maxDepth 最大输出深度
 * @param prefix 当前行的前缀（用于缩进）
 * @param isLast 是否是父节点的最后一个子节点
 * @param currentDepth 当前递归深度（从 0 开始）
 * @returns 树形文本
 */
export function describeBlockTree(
  node: ColorBlockNode,
  maxDepth: number = 4,
  prefix: string = '',
  isLast: boolean = true,
  currentDepth: number = 0,
): string {
  const lines: string[] = []

  // 当前行
  const connector = currentDepth === 0 ? '' : (isLast ? '└─' : '├─')
  const colorHex = rgbToHex(node.color)
  const boundsStr = formatBounds(node.bounds)
  const dimStr = formatPixelDimensions(node, currentDepth)
  const line =
    `${prefix}${connector}[${node.depth}] ${node.path} ` +
    `${boundsStr} color=${colorHex} ` +
    `var=${Math.round(node.variance)} ${dimStr}`
  lines.push(line)

  // 子节点
  if (currentDepth < maxDepth && node.children.length > 0) {
    const childPrefix = currentDepth === 0 ? '' : prefix + (isLast ? '  ' : '│ ')
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]
      const childIsLast = i === node.children.length - 1
      lines.push(
        describeBlockTree(child, maxDepth, childPrefix, childIsLast, currentDepth + 1),
      )
    }
  } else if (currentDepth >= maxDepth && currentDepth > 0 && node.children.length > 0) {
    // 超过最大深度，显示省略提示
    const childPrefix = currentDepth === 0 ? '' : prefix + (isLast ? '  ' : '│ ')
    const childCount = countColorBlockNodes(node) - 1
    lines.push(`${childPrefix}└─ ... (${childCount} child nodes omitted)`)
  }

  return lines.join('\n')
}

// ============================================================================
// extractBlocksAtDepth — BFS 提取指定深度色块（§22.4）
// ============================================================================

/**
 * BFS 到目标深度，收集该深度所有节点。
 *
 * 如果某分支在目标深度之前已为叶子，则收集该叶子。
 *
 * @param root 根节点
 * @param targetDepth 目标深度
 * @returns 色块节点列表
 */
export function extractBlocksAtDepth(
  root: ColorBlockNode,
  targetDepth: number,
): ColorBlockNode[] {
  const result: ColorBlockNode[] = []

  function traverse(node: ColorBlockNode, currentDepth: number): void {
    // 到达目标深度，或提前遇到叶子节点
    if (currentDepth >= targetDepth || node.children.length === 0) {
      result.push(node)
      return
    }
    for (const child of node.children) {
      traverse(child, currentDepth + 1)
    }
  }

  traverse(root, 0)
  return result
}

// ============================================================================
// 树统计工具
// ============================================================================

/**
 * 统计 ColorBlockNode 树的总节点数。
 */
export function countColorBlockNodes(node: ColorBlockNode): number {
  let count = 1
  for (const child of node.children) {
    count += countColorBlockNodes(child)
  }
  return count
}

/**
 * 统计 ColorBlockNode 树的最大深度。
 */
export function maxColorBlockDepth(node: ColorBlockNode): number {
  if (node.children.length === 0) return node.depth
  let maxChildDepth = node.depth
  for (const child of node.children) {
    maxChildDepth = Math.max(maxChildDepth, maxColorBlockDepth(child))
  }
  return maxChildDepth
}

/**
 * 统计微小物体节点数（深度 ≥ 3 且尺寸 ≤ 32 像素的叶子节点）。
 */
export function countTinyObjectNodes(
  node: ColorBlockNode,
  sourceWidth?: number,
  sourceHeight?: number,
): number {
  let count = 0

  function traverse(n: ColorBlockNode): void {
    if (n.children.length === 0 && n.depth >= 3) {
      // 如果有原图尺寸，按像素判断；否则按归一化面积近似
      if (sourceWidth && sourceHeight) {
        const pixelW = n.bounds.width * sourceWidth
        const pixelH = n.bounds.height * sourceHeight
        if (pixelW <= 32 && pixelH <= 32) count++
      } else if (n.bounds.width <= 0.1 && n.bounds.height <= 0.1) {
        count++
      }
    }
    for (const child of n.children) {
      traverse(child)
    }
  }

  traverse(node)
  return count
}

// ============================================================================
// 超预算降级：树操作（骨架 §5.4 降级顺序 Step 3-4）
// ============================================================================

/**
 * 限制树的最大深度（骨架 §5.4 降级顺序 Step 3）。
 *
 * 超过 maxDepth 的子树被截断，截断处的节点变为叶子。
 * 返回新树（不修改原树）。
 *
 * @param node 原始根节点
 * @param maxDepth 允许的最大深度
 * @returns 截断后的新树
 */
export function pruneTree(node: ColorBlockNode, maxDepth: number): ColorBlockNode {
  function clone(n: ColorBlockNode, currentMaxDepth: number): ColorBlockNode {
    if (n.depth >= currentMaxDepth) {
      // 截断：不复制子节点
      return { ...n, children: [] }
    }
    return {
      ...n,
      children: n.children.map(c => clone(c, currentMaxDepth)),
    }
  }
  return clone(node, maxDepth)
}

/**
 * 合并低显著度微块（骨架 §5.4 降级顺序 Step 4）。
 *
 * 将方差低于 threshold 的叶子节点合并到父节点（删除子节点，父节点变叶子）。
 * 递归从叶子向上处理。
 *
 * @param node 原始根节点
 * @param varianceThreshold 方差阈值，低于此值的叶子被合并
 * @returns 合并后的新树
 */
export function mergeLowSignificance(
  node: ColorBlockNode,
  varianceThreshold: number,
): ColorBlockNode {
  function process(n: ColorBlockNode): ColorBlockNode {
    if (n.children.length === 0) {
      return { ...n }
    }

    // 先递归处理子节点
    const processedChildren = n.children.map(process)

    // 如果所有子节点都是叶子，且都低于阈值，则合并
    const allLeaves = processedChildren.every(c => c.children.length === 0)
    const allBelowThreshold = processedChildren.every(
      c => c.variance < varianceThreshold,
    )

    if (allLeaves && allBelowThreshold) {
      return { ...n, children: [] }
    }

    return { ...n, children: processedChildren }
  }

  return process(node)
}

/**
 * 仅保留关注区域（骨架 §5.4 降级顺序 Step 5）。
 *
 * 保留方差最高的 topN 个叶子节点，其余叶子合并到父节点。
 * 这是最激进的降级策略。
 *
 * @param node 原始根节点
 * @param topN 保留的叶子节点数
 * @returns 降级后的新树
 */
export function keepTopSignificant(
  node: ColorBlockNode,
  topN: number,
): ColorBlockNode {
  // 收集所有叶子节点
  const leaves = collectLeafNodes(node)
  if (leaves.length <= topN) {
    return { ...node, children: node.children.map(c => deepClone(c)) }
  }

  // 按方差降序排序，取前 topN
  const topLeaves = new Set(
    leaves
      .slice()
      .sort((a, b) => b.variance - a.variance)
      .slice(0, topN)
      .map(l => l.id),
  )

  // 重建树：非根节点如果子树中无保留叶子，则删除该节点（返回 null）
  // 根节点始终保留（即使子树无保留叶子，也保留为叶子）
  function process(n: ColorBlockNode, isRoot: boolean): ColorBlockNode | null {
    if (n.children.length === 0) {
      // 叶子节点：只在保留集合中才保留（根节点除外）
      if (topLeaves.has(n.id) || isRoot) {
        return { ...n }
      }
      return null
    }

    // 递归处理子节点，过滤掉返回 null 的
    const processedChildren: ColorBlockNode[] = []
    for (const child of n.children) {
      const result = process(child, false)
      if (result) processedChildren.push(result)
    }

    if (processedChildren.length === 0) {
      // 所有子节点都被删除了
      if (isRoot) {
        return { ...n, children: [] } // 根节点保留为叶子
      }
      return null // 非根节点，删除
    }

    return { ...n, children: processedChildren }
  }

  return process(node, true) ?? node
}

/**
 * 收集所有叶子节点。
 */
export function collectLeafNodes(node: ColorBlockNode): ColorBlockNode[] {
  if (node.children.length === 0) return [node]
  const leaves: ColorBlockNode[] = []
  for (const child of node.children) {
    leaves.push(...collectLeafNodes(child))
  }
  return leaves
}

/**
 * 深拷贝 ColorBlockNode。
 */
function deepClone(node: ColorBlockNode): ColorBlockNode {
  return {
    ...node,
    children: node.children.map(deepClone),
  }
}

// ============================================================================
// 格式化辅助
// ============================================================================

/**
 * RGB → 十六进制颜色字符串。
 */
function rgbToHex(color: Color): string {
  const [r, g, b] = color
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * 格式化 BoundingBox 为 (x,y w×h) 字符串。
 */
function formatBounds(bounds: BoundingBox): string {
  return `(${bounds.x.toFixed(2)},${bounds.y.toFixed(2)} ${bounds.width.toFixed(2)}×${bounds.height.toFixed(2)})`
}

/**
 * 格式化像素尺寸信息。
 */
function formatPixelDimensions(node: ColorBlockNode, _currentDepth: number): string {
  // 像素尺寸需要从 pixelCount 反推，但这里我们只有归一化坐标
  // 直接显示 pixelCount 作为面积信息
  return `px=${node.pixelCount}`
}
