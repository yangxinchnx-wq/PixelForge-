/**
 * PixelForge - Tile Grid 系统（骨架 §2.1 workers/ + Phase C）
 *
 * 将画布分割为固定大小的瓦片（tile），用于：
 *   - 确定每个瓦片受哪些 Region/Layer 影响（视域裁剪）
 *   - 确定每个 patch 影响哪些瓦片（增量失效）
 *   - 为 worker pool 分配瓦片级编译任务
 *
 * 设计原则：
 *   - 瓦片大小必须是 workgroup 大小的整数倍（WORKGROUP_SIZE = 16）
 *   - 默认瓦片大小 256×256（16×16 个 workgroup）
 *   - 边缘瓦片可能小于完整瓦片大小
 *   - 瓦片坐标使用像素坐标（非归一化）
 */

import type { BoundingBox } from '@/shared/types'
import { WORKGROUP_SIZE } from '@/shared/constants'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { ValuePatch } from '@/compiler/ir/patch'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 单个瓦片。
 */
export interface Tile {
  /** 瓦片在网格中的列索引 */
  col: number
  /** 瓦片在网格中的行索引 */
  row: number
  /** 瓦片左上角 X 像素坐标 */
  x: number
  /** 瓦片左上角 Y 像素坐标 */
  y: number
  /** 瓦片宽度（像素） */
  width: number
  /** 瓦片高度（像素） */
  height: number
  /** 瓦片全局索引（row * cols + col） */
  index: number
}

/**
 * 瓦片网格。
 */
export interface TileGrid {
  /** 画布宽度 */
  canvasWidth: number
  /** 画布高度 */
  canvasHeight: number
  /** 瓦片大小（正方形边长） */
  tileSize: number
  /** 列数 */
  cols: number
  /** 行数 */
  rows: number
  /** 瓦片总数 */
  count: number
  /** 所有瓦片（按 index 排序） */
  tiles: Tile[]
}

// ============================================================================
// 默认瓦片大小
// ============================================================================

/**
 * 默认瓦片大小：256×256 像素。
 *
 * 选择理由：
 *   - 256 = 16 × 16（WORKGROUP_SIZE 的整数倍）
 *   - 在 1080p（1920×1080）下产生 8×5 = 40 个瓦片，足够并行
 *   - 在 4K（3840×2160）下产生 15×9 = 135 个瓦片，适合动态 worker pool
 *   - 每个瓦片 256×256×4 = 256KB 纹理内存，GPU 友好
 */
export const DEFAULT_TILE_SIZE = 256

/**
 * 最大瓦片大小（受 GPU 限制约束）。
 */
export const MAX_TILE_SIZE = 1024

/**
 * 最小瓦片大小（至少一个 workgroup）。
 */
export const MIN_TILE_SIZE = WORKGROUP_SIZE

// ============================================================================
// 瓦片网格创建
// ============================================================================

/**
 * 创建瓦片网格。
 *
 * @param canvasWidth 画布宽度
 * @param canvasHeight 画布高度
 * @param tileSize 瓦片大小（默认 256，必须是 WORKGROUP_SIZE 的整数倍）
 * @returns TileGrid
 */
export function createTileGrid(
  canvasWidth: number,
  canvasHeight: number,
  tileSize: number = DEFAULT_TILE_SIZE,
): TileGrid {
  // 参数校验
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return {
      canvasWidth,
      canvasHeight,
      tileSize,
      cols: 0,
      rows: 0,
      count: 0,
      tiles: [],
    }
  }

  // 确保 tileSize 是 WORKGROUP_SIZE 的整数倍
  const alignedTileSize = Math.max(
    MIN_TILE_SIZE,
    Math.min(MAX_TILE_SIZE, Math.ceil(tileSize / WORKGROUP_SIZE) * WORKGROUP_SIZE),
  )

  const cols = Math.ceil(canvasWidth / alignedTileSize)
  const rows = Math.ceil(canvasHeight / alignedTileSize)
  const count = cols * rows

  const tiles: Tile[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * alignedTileSize
      const y = row * alignedTileSize
      const width = Math.min(alignedTileSize, canvasWidth - x)
      const height = Math.min(alignedTileSize, canvasHeight - y)
      tiles.push({
        col,
        row,
        x,
        y,
        width,
        height,
        index: row * cols + col,
      })
    }
  }

  return {
    canvasWidth,
    canvasHeight,
    tileSize: alignedTileSize,
    cols,
    rows,
    count,
    tiles,
  }
}

// ============================================================================
// 视域裁剪 — Region ↔ Tile 重叠检测
// ============================================================================

/**
 * 将归一化 BoundingBox（[0,1] 范围）转换为像素坐标。
 */
function boundsToPixels(
  bounds: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number; right: number; bottom: number } {
  return {
    x: bounds.x * canvasWidth,
    y: bounds.y * canvasHeight,
    right: (bounds.x + bounds.width) * canvasWidth,
    bottom: (bounds.y + bounds.height) * canvasHeight,
  }
}

/**
 * 判断瓦片与归一化边界框是否重叠。
 */
function tileOverlapsBounds(
  tile: Tile,
  bounds: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const pixelBounds = boundsToPixels(bounds, canvasWidth, canvasHeight)

  // tile 的右边和下边
  const tileRight = tile.x + tile.width
  const tileBottom = tile.y + tile.height

  // 标准矩形重叠检测
  return (
    tile.x < pixelBounds.right &&
    tileRight > pixelBounds.x &&
    tile.y < pixelBounds.bottom &&
    tileBottom > pixelBounds.y
  )
}

/**
 * 获取与指定 Region 重叠的所有瓦片。
 *
 * @param regionBounds Region 的归一化边界
 * @param grid 瓦片网格
 * @returns 与该 Region 重叠的瓦片列表
 */
export function getTilesForRegion(
  regionBounds: BoundingBox,
  grid: TileGrid,
): Tile[] {
  return grid.tiles.filter((tile) =>
    tileOverlapsBounds(tile, regionBounds, grid.canvasWidth, grid.canvasHeight),
  )
}

/**
 * 获取与 RenderIR 中所有 Region 重叠的瓦片集合。
 *
 * 用于全量编译时确定哪些瓦片需要处理。
 *
 * @param ir RenderIR
 * @param grid 瓦片网格
 * @returns 需要处理的瓦片列表（去重）
 */
export function getActiveTiles(ir: RenderIR, grid: TileGrid): Tile[] {
  const activeIndices = new Set<number>()

  for (const region of ir.regions) {
    const tiles = getTilesForRegion(region.bounds, grid)
    for (const tile of tiles) {
      activeIndices.add(tile.index)
    }
  }

  // 如果没有 Region（不应该发生，但防御性处理），返回所有瓦片
  if (activeIndices.size === 0) {
    return [...grid.tiles]
  }

  return grid.tiles.filter((tile) => activeIndices.has(tile.index))
}

// ============================================================================
// Patch 影响瓦片计算
// ============================================================================

/**
 * 确定一个 ValuePatch 影响哪些瓦片。
 *
 * 策略：
 *   - 找到 patch.targetId 对应的 Layer
 *   - 找到该 Layer 所属的 Region
 *   - 返回与该 Region 重叠的瓦片
 *   - 如果 Layer 不属于任何 Region（全覆盖），返回所有瓦片
 *   - 如果 targetId 是 Effect，返回所有瓦片（效果可能影响全画面）
 *
 * @param patch ValuePatch
 * @param ir 当前 RenderIR
 * @param grid 瓦片网格
 * @returns 受影响的瓦片列表
 */
export function getTilesForValuePatch(
  patch: ValuePatch,
  ir: RenderIR,
  grid: TileGrid,
): Tile[] {
  // Effect 的 ValuePatch：效果可能影响全画面，保守返回所有瓦片
  if (patch.targetEntity === 'effect') {
    return [...grid.tiles]
  }

  // Layer 的 ValuePatch：找到该 Layer 所属的 Region
  const targetLayer = ir.layers.find((l) => l.id === patch.targetId)
  if (!targetLayer) {
    return []
  }

  // 查找包含该 Layer 的 Region
  const containingRegions = ir.regions.filter((r) =>
    r.layerRefs.includes(targetLayer.id),
  )

  // 如果没有 Region 包含该 Layer，保守返回所有瓦片
  if (containingRegions.length === 0) {
    return [...grid.tiles]
  }

  // 收集所有受影响瓦片（去重）
  const affectedIndices = new Set<number>()
  for (const region of containingRegions) {
    const tiles = getTilesForRegion(region.bounds, grid)
    for (const tile of tiles) {
      affectedIndices.add(tile.index)
    }
  }

  return grid.tiles.filter((tile) => affectedIndices.has(tile.index))
}

// ============================================================================
// 瓦片分组 — 为 Worker Pool 分配任务
// ============================================================================

/**
 * 将瓦片列表均匀分配到 N 个分组中（round-robin 策略）。
 *
 * @param tiles 待分配的瓦片列表
 * @param groupCount 分组数（通常等于 worker 数量）
 * @returns 分组后的瓦片二维数组
 */
export function distributeTiles(
  tiles: Tile[],
  groupCount: number,
): Tile[][] {
  if (groupCount <= 0) return [tiles]
  if (tiles.length === 0) return Array.from({ length: groupCount }, () => [])

  const groups: Tile[][] = Array.from({ length: groupCount }, () => [])
  for (let i = 0; i < tiles.length; i++) {
    const groupIndex = i % groupCount
    groups[groupIndex].push(tiles[i])
  }
  return groups
}

/**
 * 获取瓦片的 workgroup 分发尺寸（用于 GPU dispatch）。
 *
 * @param tile 瓦片
 * @returns { x: number, y: number } — x 和 y 方向的 workgroup 数量
 */
export function getTileDispatchSize(tile: Tile): { x: number; y: number } {
  return {
    x: Math.ceil(tile.width / WORKGROUP_SIZE),
    y: Math.ceil(tile.height / WORKGROUP_SIZE),
  }
}
