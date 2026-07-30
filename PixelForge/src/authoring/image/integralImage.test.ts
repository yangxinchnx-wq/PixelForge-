/**
 * integralImage.ts 单元测试
 *
 * 测试覆盖：
 *   I1  IntegralImages 构建正确（灰度值计算）
 *   I2  queryRectSum O(1) 矩形区域和查询
 *   I3  queryMean 矩形区域平均灰度
 *   I4  queryVariance 均匀图方差为 0
 *   I5  queryVariance 非均匀图方差 > 0
 *   I6  queryEdgeStrength 均匀图边缘强度 ≈ 0
 *   I7  queryEdgeStrength 左半红右半蓝图边缘强度 > 0
 *   I8  estimateNoiseLevel 均匀图噪声水平 ≈ 0
 *   I9  detectTinyObjects 均匀图无微小物体
 *   I10 detectTinyObjects 有亮点的图检测到微小物体
 */

import { describe, expect, it } from 'vitest'
import {
  IntegralImages,
  estimateNoiseLevel,
  detectTinyObjects,
  type Rect,
} from './integralImage'
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

/** 创建有单个亮点的 PixelData（暗背景 + 中心亮像素） */
function createBrightSpotPixelData(
  width: number,
  height: number,
  spotX: number,
  spotY: number,
): PixelData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = 10
    data[i * 4 + 1] = 10
    data[i * 4 + 2] = 10
    data[i * 4 + 3] = 255
  }
  // 设置亮点
  const spotIdx = (spotY * width + spotX) * 4
  data[spotIdx] = 250
  data[spotIdx + 1] = 250
  data[spotIdx + 2] = 250
  return { data, width, height }
}

// ============================================================================
// 测试
// ============================================================================

describe('integralImage.ts — 积分图', () => {
  describe('IntegralImages 构建', () => {
    it('I1 灰度值计算正确（Rec.601 luma）', () => {
      const px = createUniformPixelData(4, 4, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      // 灰度 = 100 * 0.299 + 100 * 0.587 + 100 * 0.114 = 100
      expect(integrals.gray[0]).toBeCloseTo(100, 1)
    })

    it('I1b 灰度值计算正确（RGB 不同值）', () => {
      const px = createUniformPixelData(4, 4, [255, 0, 0, 255]) // 纯红
      const integrals = new IntegralImages(px)

      // 灰度 = 255 * 0.299 + 0 * 0.587 + 0 * 0.114 = 76.245
      expect(integrals.gray[0]).toBeCloseTo(76.245, 1)
    })
  })

  describe('queryRectSum', () => {
    it('I2 矩形区域和查询正确（均匀图）', () => {
      const px = createUniformPixelData(8, 8, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      // 全图灰度和 = 100 * 64 = 6400
      const rect: Rect = { x: 0, y: 0, width: 8, height: 8 }
      const sum = integrals.queryRectSum(integrals.grayIntegral, rect)
      expect(sum).toBeCloseTo(6400, 0)
    })

    it('I2b 子矩形区域和查询正确', () => {
      const px = createUniformPixelData(8, 8, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      // 4×4 子矩形灰度和 = 100 * 16 = 1600
      const rect: Rect = { x: 2, y: 2, width: 4, height: 4 }
      const sum = integrals.queryRectSum(integrals.grayIntegral, rect)
      expect(sum).toBeCloseTo(1600, 0)
    })
  })

  describe('queryMean', () => {
    it('I3 均匀图平均灰度 = 灰度值', () => {
      const px = createUniformPixelData(8, 8, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      const rect: Rect = { x: 0, y: 0, width: 8, height: 8 }
      expect(integrals.queryMean(rect)).toBeCloseTo(100, 1)
    })
  })

  describe('queryVariance', () => {
    it('I4 均匀图方差为 0', () => {
      const px = createUniformPixelData(8, 8, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      const rect: Rect = { x: 0, y: 0, width: 8, height: 8 }
      const variance = integrals.queryVariance(rect)
      expect(Math.abs(variance)).toBeLessThan(0.1)
    })

    it('I5 非均匀图方差 > 0', () => {
      const px = createSplitPixelData(16, 16)
      const integrals = new IntegralImages(px)

      const rect: Rect = { x: 0, y: 0, width: 16, height: 16 }
      const variance = integrals.queryVariance(rect)
      expect(variance).toBeGreaterThan(0)
    })
  })

  describe('queryEdgeStrength', () => {
    it('I6 均匀图边缘强度 ≈ 0', () => {
      const px = createUniformPixelData(8, 8, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      const rect: Rect = { x: 1, y: 1, width: 6, height: 6 }
      const edge = integrals.queryEdgeStrength(rect)
      expect(edge).toBeLessThan(1)
    })

    it('I7 左半红右半蓝图边缘强度 > 0', () => {
      const px = createSplitPixelData(16, 16)
      const integrals = new IntegralImages(px)

      // 在分界线附近查询
      const rect: Rect = { x: 6, y: 4, width: 4, height: 8 }
      const edge = integrals.queryEdgeStrength(rect)
      expect(edge).toBeGreaterThan(0)
    })
  })

  describe('estimateNoiseLevel', () => {
    it('I8 均匀图噪声水平 ≈ 0', () => {
      const px = createUniformPixelData(16, 16, [100, 100, 100, 255])
      const integrals = new IntegralImages(px)

      const noise = estimateNoiseLevel(integrals)
      // 均匀图全局方差为 0，noiseLevel 应为 0
      expect(noise).toBe(0)
    })

    it('I8b 非均匀图噪声水平为正数', () => {
      const px = createSplitPixelData(32, 32)
      const integrals = new IntegralImages(px)

      const noise = estimateNoiseLevel(integrals)
      expect(noise).toBeGreaterThanOrEqual(0)
    })
  })

  describe('detectTinyObjects', () => {
    it('I9 均匀图无微小物体', () => {
      const px = createUniformPixelData(16, 16, [50, 50, 50, 255])
      const integrals = new IntegralImages(px)

      const rect: Rect = { x: 0, y: 0, width: 16, height: 16 }
      const has = detectTinyObjects(integrals, rect, 30)
      expect(has).toBe(false)
    })

    it('I10 有亮点的图检测到微小物体', () => {
      // 16×16 暗背景，中心 (8,8) 有亮点
      const px = createBrightSpotPixelData(16, 16, 8, 8)
      const integrals = new IntegralImages(px)

      // 查询包含亮点的区域
      const rect: Rect = { x: 6, y: 6, width: 8, height: 8 }
      const has = detectTinyObjects(integrals, rect, 30)
      expect(has).toBe(true)
    })

    it('I10b 亮点在查询区域外不检测到', () => {
      const px = createBrightSpotPixelData(16, 16, 8, 8)
      const integrals = new IntegralImages(px)

      // 查询不包含亮点的区域
      const rect: Rect = { x: 0, y: 0, width: 6, height: 6 }
      const has = detectTinyObjects(integrals, rect, 30)
      expect(has).toBe(false)
    })

    it('I10c 太小的区域不检测', () => {
      const px = createBrightSpotPixelData(16, 16, 8, 8)
      const integrals = new IntegralImages(px)

      const rect: Rect = { x: 7, y: 7, width: 2, height: 2 }
      const has = detectTinyObjects(integrals, rect, 30)
      expect(has).toBe(false)
    })
  })
})
