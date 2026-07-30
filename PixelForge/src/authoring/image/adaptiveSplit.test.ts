/**
 * adaptiveSplit.ts 单元测试
 *
 * 测试覆盖：
 *   S1  splitIntoBlocks 均匀图只生成根节点（不细分）
 *   S2  splitIntoBlocks 非均匀图生成多级树
 *   S3  shouldSplit 硬性最小尺寸限制
 *   S4  shouldSplit 最大深度限制
 *   S5  getAdaptiveThreshold 噪声补偿因子
 *   S6  getAdaptiveThreshold 深度递增阈值
 *   S7  countNodes / countLeafNodes / maxDepthOf 统计函数
 *   S8  splitIntoBlocks 树深度不超过 maxDepth
 *   S9  analyzeBlock 计算正确的平均色和方差
 *   S10 splitIntoBlocks 自定义选项生效
 */

import { describe, expect, it } from 'vitest'
import {
  splitIntoBlocks,
  shouldSplit,
  getAdaptiveThreshold,
  analyzeBlock,
  countNodes,
  countLeafNodes,
  maxDepthOf,
  type RawBlockNode,
  type SplitContext,
} from './adaptiveSplit'
import { IntegralImages } from './integralImage'
import { type PixelData } from './resize'

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建均匀填充的 PixelData */
function createUniformPixelData(
  width: number,
  height: number,
  fill: [number, number, number, number],
): PixelData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = fill[3]
  }
  return { data, width, height }
}

/** 创建左半红右半蓝的 PixelData */
function createSplitPixelData(width: number, height: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4)
  const halfW = Math.floor(width / 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (x < halfW) {
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255
      } else {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255
      }
    }
  }
  return { data, width, height }
}

/** 创建四象限不同颜色的 PixelData */
function createQuadrantPixelData(width: number, height: number): PixelData {
  const data = new Uint8ClampedArray(width * height * 4)
  const halfW = Math.floor(width / 2)
  const halfH = Math.floor(height / 2)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (x < halfW && y < halfH) {
        // 左上：红
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255
      } else if (x >= halfW && y < halfH) {
        // 右上：绿
        data[i] = 0; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = 255
      } else if (x < halfW && y >= halfH) {
        // 左下：蓝
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255
      } else {
        // 右下：白
        data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255
      }
    }
  }
  return { data, width, height }
}

// ============================================================================
// 测试
// ============================================================================

describe('adaptiveSplit.ts — 自适应细分', () => {
  describe('getAdaptiveThreshold', () => {
    it('S5 噪声补偿因子正确（noiseLevel=1 → factor=3）', () => {
      const result = getAdaptiveThreshold(1.0, 0, 50)
      // edge = 50 * 0.3 * (1 + 1 * 2) = 50 * 0.3 * 3 = 45
      expect(result.edge).toBeCloseTo(45, 1)
      // variance = 50 * 1.2^0 * 3 = 150
      expect(result.variance).toBeCloseTo(150, 1)
    })

    it('S5b 噪声水平为 0 → factor=1', () => {
      const result = getAdaptiveThreshold(0, 0, 50)
      // edge = 50 * 0.3 * 1 = 15
      expect(result.edge).toBeCloseTo(15, 1)
      // variance = 50 * 1.2^0 * 1 = 50
      expect(result.variance).toBeCloseTo(50, 1)
    })

    it('S6 深度递增阈值（depth=3 > depth=0）', () => {
      const d0 = getAdaptiveThreshold(0, 0, 50)
      const d3 = getAdaptiveThreshold(0, 3, 50)
      // variance = 50 * 1.2^depth
      expect(d3.variance).toBeGreaterThan(d0.variance)
    })
  })

  describe('shouldSplit', () => {
    it('S3 硬性最小尺寸限制（width < 8 不细分）', () => {
      const px = createUniformPixelData(16, 16, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)
      const ctx: SplitContext = {
        integrals,
        noiseLevel: 0,
        globalEdgeStrength: 0,
        maxDepth: 6,
        minBlockSize: 8,
        tinyObjectBrightnessThreshold: 30,
      }
      const block: RawBlockNode = {
        rect: { x: 0, y: 0, width: 4, height: 4 },
        avgColor: [100, 100, 100],
        dominantColor: [100, 100, 100],
        variance: 0,
        pixelCount: 16,
        depth: 0,
        path: 'root',
        children: [],
      }
      expect(shouldSplit(block, ctx)).toBe(false)
    })

    it('S4 最大深度限制（depth >= maxDepth 不细分）', () => {
      const px = createSplitPixelData(64, 64)
      const integrals = new IntegralImages(px)
      const ctx: SplitContext = {
        integrals,
        noiseLevel: 0,
        globalEdgeStrength: 100,
        maxDepth: 3,
        minBlockSize: 8,
        tinyObjectBrightnessThreshold: 30,
      }
      const block: RawBlockNode = {
        rect: { x: 0, y: 0, width: 32, height: 32 },
        avgColor: [128, 0, 128],
        dominantColor: [128, 0, 128],
        variance: 1000,
        pixelCount: 1024,
        depth: 3,
        path: 'root',
        children: [],
      }
      expect(shouldSplit(block, ctx)).toBe(false)
    })
  })

  describe('splitIntoBlocks', () => {
    it('S1 均匀图只生成根节点（不细分）', () => {
      const px = createUniformPixelData(64, 64, [100, 100, 100, 255])
      const root = splitIntoBlocks(px)

      expect(root.children.length).toBe(0)
      expect(root.depth).toBe(0)
      expect(root.path).toBe('root')
    })

    it('S2 非均匀图生成多级树', () => {
      const px = createSplitPixelData(64, 64)
      const root = splitIntoBlocks(px)

      // 左半红右半蓝，分界线处有强边缘，应该被细分
      expect(root.children.length).toBeGreaterThan(0)
    })

    it('S2b 四象限不同颜色图被细分', () => {
      const px = createQuadrantPixelData(64, 64)
      const root = splitIntoBlocks(px)

      expect(root.children.length).toBeGreaterThan(0)
    })

    it('S8 树深度不超过 maxDepth', () => {
      const px = createSplitPixelData(128, 128)
      const root = splitIntoBlocks(px, { maxDepth: 3 })

      const maxD = maxDepthOf(root)
      expect(maxD).toBeLessThanOrEqual(3)
    })

    it('S10 自定义 minBlockSize 生效', () => {
      const px = createSplitPixelData(64, 64)
      // minBlockSize=65 → 整图 64×64 不再细分（64 < 65 = true）
      const root = splitIntoBlocks(px, { minBlockSize: 65 })

      expect(root.children.length).toBe(0)
    })

    it('S10b 自定义 maxDepth=0 只生成根节点', () => {
      const px = createSplitPixelData(64, 64)
      const root = splitIntoBlocks(px, { maxDepth: 0 })

      expect(root.children.length).toBe(0)
    })
  })

  describe('analyzeBlock', () => {
    it('S9 计算正确的平均色', () => {
      const px = createUniformPixelData(16, 16, [200, 100, 50, 255])
      const integrals = new IntegralImages(px)
      const result = analyzeBlock(px, { x: 0, y: 0, width: 16, height: 16 }, integrals)

      expect(result.avgColor[0]).toBeCloseTo(200, 0)
      expect(result.avgColor[1]).toBeCloseTo(100, 0)
      expect(result.avgColor[2]).toBeCloseTo(50, 0)
    })

    it('S9b 均匀图方差为 0', () => {
      const px = createUniformPixelData(16, 16, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)
      const result = analyzeBlock(px, { x: 0, y: 0, width: 16, height: 16 }, integrals)

      expect(Math.abs(result.variance)).toBeLessThan(0.1)
    })

    it('S9c pixelCount 正确', () => {
      const px = createUniformPixelData(16, 16, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)
      const result = analyzeBlock(px, { x: 0, y: 0, width: 8, height: 8 }, integrals)

      expect(result.pixelCount).toBe(64)
    })
  })

  describe('树统计函数', () => {
    it('S7a countNodes 单节点树 = 1', () => {
      const px = createUniformPixelData(64, 64, [100, 100, 100, 255])
      const root = splitIntoBlocks(px)

      expect(countNodes(root)).toBe(1)
    })

    it('S7b countNodes 多节点树', () => {
      const px = createSplitPixelData(64, 64)
      const root = splitIntoBlocks(px)

      const nodes = countNodes(root)
      const leaves = countLeafNodes(root)
      expect(nodes).toBeGreaterThanOrEqual(1)
      expect(leaves).toBeGreaterThanOrEqual(1)
      expect(nodes).toBeGreaterThanOrEqual(leaves)
    })

    it('S7c countLeafNodes 单节点树 = 1', () => {
      const px = createUniformPixelData(64, 64, [100, 100, 100, 255])
      const root = splitIntoBlocks(px)

      expect(countLeafNodes(root)).toBe(1)
    })

    it('S7d maxDepthOf 不超过 maxDepth', () => {
      const px = createSplitPixelData(128, 128)
      const root = splitIntoBlocks(px, { maxDepth: 4 })

      expect(maxDepthOf(root)).toBeLessThanOrEqual(4)
    })
  })
})
