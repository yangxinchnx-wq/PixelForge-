/**
 * PixelForge - 多分辨率预览金字塔（Phase C）
 *
 * 技术路线 §19.3 空间渐进：低分辨率先出，高分辨率后台细化。
 *
 * 分辨率金字塔：
 *   Level 0: 1/8  分辨率 — 即时预览（~50ms）
 *   Level 1: 1/4  分辨率 — 粗精化（~200ms）
 *   Level 2: 1/2  分辨率 — 中精化
 *   Level 3: 1/1  分辨率 — 全分辨率输出
 *
 * 工作原理：
 *   1. 编译（RenderIR → artifact）在 Worker 中执行，不阻塞主线程
 *   2. artifact 与分辨率无关（描述符/参数缓冲区不随分辨率变化）
 *   3. GPU dispatch 的 workgroup 数量随分辨率变化
 *   4. 低分辨率 dispatch 极快（1/64 像素量），用户立即看到画面
 *   5. 高分辨率 dispatch 在后台继续，完成后替换低分辨率画面
 *
 * 收益：
 *   - 用户看到画面的时间从 ~500ms 降到 ~50ms（1/8 分辨率）
 *   - 高分辨率后台细化不阻塞 UI
 *   - 大图不会卡死主线程
 */

import { WORKGROUP_SIZE } from '@/shared/constants'

// ============================================================================
// 分辨率级别定义
// ============================================================================

/**
 * 预览分辨率级别。
 *
 * Level 0 = 最低分辨率（1/8），Level 3 = 全分辨率（1/1）。
 */
export type PreviewLevel = 0 | 1 | 2 | 3

/**
 * 分辨率金字塔级别配置。
 */
export interface PreviewLevelConfig {
  level: PreviewLevel
  /** 分辨率缩放因子（1 / 2^level） */
  scale: number
  /** 描述（用于 UI 显示） */
  label: string
}

/**
 * 全部 4 个分辨率级别配置（从低到高）。
 */
export const PREVIEW_LEVELS: readonly PreviewLevelConfig[] = [
  { level: 0, scale: 1 / 8, label: '1/8 预览' },
  { level: 1, scale: 1 / 4, label: '1/4 粗精化' },
  { level: 2, scale: 1 / 2, label: '1/2 中精化' },
  { level: 3, scale: 1 / 1, label: '全分辨率' },
] as const

/** 默认起始预览级别（最低分辨率） */
export const DEFAULT_PREVIEW_START_LEVEL: PreviewLevel = 0

/** 默认终止预览级别（全分辨率） */
export const DEFAULT_PREVIEW_END_LEVEL: PreviewLevel = 3

// ============================================================================
// 分辨率计算
// ============================================================================

/**
 * 根据原始画布尺寸和预览级别计算实际渲染尺寸。
 *
 * 规则：
 *   - 宽高分别乘以 scale
 *   - 对齐到 WORKGROUP_SIZE 的整数倍（GPU dispatch 要求）
 *   - 最小尺寸 = WORKGROUP_SIZE（至少一个 workgroup）
 *
 * @param canvasWidth 原始画布宽度
 * @param canvasHeight 原始画布高度
 * @param level 预览级别
 * @returns 对齐后的渲染尺寸
 */
export function computePreviewSize(
  canvasWidth: number,
  canvasHeight: number,
  level: PreviewLevel,
): { width: number; height: number } {
  const config = PREVIEW_LEVELS[level]
  const scaledWidth = Math.max(WORKGROUP_SIZE, Math.floor(canvasWidth * config.scale))
  const scaledHeight = Math.max(WORKGROUP_SIZE, Math.floor(canvasHeight * config.scale))

  // 对齐到 WORKGROUP_SIZE
  const width = Math.ceil(scaledWidth / WORKGROUP_SIZE) * WORKGROUP_SIZE
  const height = Math.ceil(scaledHeight / WORKGROUP_SIZE) * WORKGROUP_SIZE

  return { width, height }
}

/**
 * 根据渲染尺寸计算 GPU dispatch 的 workgroup 数量。
 *
 * @param width 渲染宽度
 * @param height 渲染高度
 * @returns { x, y } workgroup 数量
 */
export function computeDispatchSize(
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: Math.ceil(width / WORKGROUP_SIZE),
    y: Math.ceil(height / WORKGROUP_SIZE),
  }
}

// ============================================================================
// 渐进式渲染序列
// ============================================================================

/**
 * 生成从 startLevel 到 endLevel 的渐进式渲染序列。
 *
 * 例如：startLevel=0, endLevel=3 → [0, 1, 2, 3]
 *      startLevel=1, endLevel=3 → [1, 2, 3]
 *
 * @param startLevel 起始级别（低分辨率）
 * @param endLevel 终止级别（高分辨率）
 * @returns 级别序列（从低到高）
 */
export function getProgressiveSequence(
  startLevel: PreviewLevel = DEFAULT_PREVIEW_START_LEVEL,
  endLevel: PreviewLevel = DEFAULT_PREVIEW_END_LEVEL,
): PreviewLevel[] {
  const sequence: PreviewLevel[] = []
  for (let l = startLevel; l <= endLevel; l++) {
    sequence.push(l as PreviewLevel)
  }
  return sequence
}

/**
 * 计算每个预览级别的渲染参数。
 *
 * @param canvasWidth 原始画布宽度
 * @param canvasHeight 原始画布高度
 * @param startLevel 起始级别
 * @param endLevel 终止级别
 * @returns 每个级别的渲染参数列表
 */
export function computeProgressiveRenderPlan(
  canvasWidth: number,
  canvasHeight: number,
  startLevel: PreviewLevel = DEFAULT_PREVIEW_START_LEVEL,
  endLevel: PreviewLevel = DEFAULT_PREVIEW_END_LEVEL,
): Array<{
  level: PreviewLevel
  size: { width: number; height: number }
  dispatch: { x: number; y: number }
  label: string
  /** 总像素数（用于估算耗时） */
  pixelCount: number
}> {
  const levels = getProgressiveSequence(startLevel, endLevel)
  return levels.map((level) => {
    const size = computePreviewSize(canvasWidth, canvasHeight, level)
    const dispatch = computeDispatchSize(size.width, size.height)
    const config = PREVIEW_LEVELS[level]
    return {
      level,
      size,
      dispatch,
      label: config.label,
      pixelCount: size.width * size.height,
    }
  })
}

// ============================================================================
// 渐进式渲染回调接口
// ============================================================================

/**
 * 渐进式渲染回调。
 *
 * 在每个级别渲染完成时调用，调用方可以在回调中更新 UI。
 */
export type OnLevelRendered = (info: {
  level: PreviewLevel
  size: { width: number; height: number }
  /** 是否为最终级别 */
  isFinal: boolean
  /** 本级别耗时（毫秒） */
  durationMs: number
}) => void

/**
 * 渐进式渲染选项。
 */
export interface ProgressiveRenderOptions {
  /** 起始级别（默认 0 = 1/8 分辨率） */
  startLevel?: PreviewLevel
  /** 终止级别（默认 3 = 全分辨率） */
  endLevel?: PreviewLevel
  /** 每个级别渲染完成时的回调 */
  onLevelRendered?: OnLevelRendered
  /** 是否在低级别渲染后立即跳到全分辨率（跳过中间级别） */
  skipIntermediate?: boolean
}

/**
 * 根据选项生成实际渲染序列。
 *
 * skipIntermediate=true 时，只渲染起始级别和终止级别（跳过中间）。
 */
export function resolveRenderSequence(
  options: ProgressiveRenderOptions,
): PreviewLevel[] {
  const start = options.startLevel ?? DEFAULT_PREVIEW_START_LEVEL
  const end = options.endLevel ?? DEFAULT_PREVIEW_END_LEVEL

  if (options.skipIntermediate && end - start > 1) {
    return [start, end]
  }

  return getProgressiveSequence(start, end)
}
