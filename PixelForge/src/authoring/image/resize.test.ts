/**
 * resize.ts 单元测试
 *
 * 测试覆盖：
 *   R1  resizeImage 下采样（大图 → 小图，双线性插值）
 *   R2  resizeImage 小图不放大（目标 ≥ 原图 → 拷贝）
 *   R3  resizeToMaxDim 等比下采样
 *   R4  resizeToMaxDim 小图不缩放
 *   R5  boxBlur3Pass 均匀图模糊后不变
 *   R6  boxBlur3Pass 非均匀图模糊后方差降低
 *   R7  horizontalBoxBlur 滑动窗口正确性
 *   R8  verticalBoxBlur 滑动窗口正确性
 *   R9  prepareAnalysis 返回 resized + blurred
 *   R10 createPixelData / fromImageData 辅助函数
 */

import { describe, expect, it } from 'vitest'
import {
  resizeImage,
  resizeToMaxDim,
  boxBlur3Pass,
  horizontalBoxBlur,
  verticalBoxBlur,
  prepareAnalysis,
  createPixelData,
  fromImageData,
  type PixelData,
} from './resize'

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
function createSplitPixelData(
  width: number,
  height: number,
): PixelData {
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

/** 计算像素数据的灰度方差 */
function pixelVariance(px: PixelData): number {
  let sum = 0
  let sumSq = 0
  const count = px.width * px.height
  for (let i = 0; i < count; i++) {
    const pi = i * 4
    const gray = px.data[pi] * 0.299 + px.data[pi + 1] * 0.587 + px.data[pi + 2] * 0.114
    sum += gray
    sumSq += gray * gray
  }
  const mean = sum / count
  return sumSq / count - mean * mean
}

// ============================================================================
// 测试
// ============================================================================

describe('resize.ts — 图像预处理', () => {
  describe('createPixelData / fromImageData', () => {
    it('R10a createPixelData 创建空白 PixelData', () => {
      const px = createPixelData(4, 3)
      expect(px.width).toBe(4)
      expect(px.height).toBe(3)
      expect(px.data.length).toBe(4 * 3 * 4)
      // 全部为 0
      expect(px.data.every(v => v === 0)).toBe(true)
    })

    it('R10b fromImageData 从 ImageData 创建 PixelData', () => {
      const imageData = {
        data: new Uint8ClampedArray([1, 2, 3, 4]),
        width: 1,
        height: 1,
      } as unknown as ImageData
      const px = fromImageData(imageData)
      expect(px.width).toBe(1)
      expect(px.height).toBe(1)
      expect(px.data[0]).toBe(1)
      expect(px.data[3]).toBe(4)
    })
  })

  describe('resizeImage', () => {
    it('R1 下采样（8×8 → 4×4），均匀图保持颜色一致', () => {
      const src = createUniformPixelData(8, 8, [200, 100, 50, 255])
      const dst = resizeImage(src, 4, 4)

      expect(dst.width).toBe(4)
      expect(dst.height).toBe(4)
      // 均匀图缩放后颜色不变
      for (let i = 0; i < dst.data.length; i += 4) {
        expect(dst.data[i]).toBeCloseTo(200, 0)
        expect(dst.data[i + 1]).toBeCloseTo(100, 0)
        expect(dst.data[i + 2]).toBeCloseTo(50, 0)
        expect(dst.data[i + 3]).toBe(255)
      }
    })

    it('R2 小图不放大（目标 ≥ 原图 → 拷贝）', () => {
      const src = createUniformPixelData(4, 4, [100, 200, 50, 255])
      const dst = resizeImage(src, 8, 8)

      expect(dst.width).toBe(4)
      expect(dst.height).toBe(4)
      // 应该是拷贝，数据一致
      expect(Array.from(dst.data)).toEqual(Array.from(src.data))
    })

    it('R1b 下采样左半红右半蓝图，边界处应有过渡', () => {
      const src = createSplitPixelData(8, 8)
      const dst = resizeImage(src, 4, 4)

      expect(dst.width).toBe(4)
      expect(dst.height).toBe(4)
      // 左侧应该偏红
      const leftR = dst.data[0] // (0,0) 像素的 R
      expect(leftR).toBeGreaterThan(100)
      // 右侧应该偏蓝
      const rightB = dst.data[(dst.width - 1) * 4 + 2] // (3,0) 像素的 B
      expect(rightB).toBeGreaterThan(100)
    })
  })

  describe('resizeToMaxDim', () => {
    it('R3 等比下采样（长边 10 → maxDim 5）', () => {
      const src = createUniformPixelData(10, 6, [50, 100, 150, 255])
      const dst = resizeToMaxDim(src, 5)

      expect(dst.width).toBe(5)
      expect(dst.height).toBe(3) // 等比缩放 6 * (5/10) = 3
    })

    it('R4 小图不缩放（长边 ≤ maxDim）', () => {
      const src = createUniformPixelData(3, 4, [10, 20, 30, 255])
      const dst = resizeToMaxDim(src, 10)

      expect(dst.width).toBe(3)
      expect(dst.height).toBe(4)
      // 应该是拷贝
      expect(Array.from(dst.data)).toEqual(Array.from(src.data))
    })
  })

  describe('boxBlur3Pass', () => {
    it('R5 均匀图模糊后颜色不变', () => {
      const src = createUniformPixelData(8, 8, [128, 64, 32, 255])
      const blurred = boxBlur3Pass(src, 2)

      expect(blurred.width).toBe(8)
      expect(blurred.height).toBe(8)
      for (let i = 0; i < blurred.data.length; i += 4) {
        expect(blurred.data[i]).toBeCloseTo(128, 1)
        expect(blurred.data[i + 1]).toBeCloseTo(64, 1)
        expect(blurred.data[i + 2]).toBeCloseTo(32, 1)
      }
    })

    it('R6 非均匀图模糊后方差降低', () => {
      const src = createSplitPixelData(16, 16)
      const srcVariance = pixelVariance(src)

      const blurred = boxBlur3Pass(src, 2)
      const blurredVariance = pixelVariance(blurred)

      // 模糊后方差应显著降低
      expect(blurredVariance).toBeLessThan(srcVariance)
    })

    it('R5b 模糊不改变图像尺寸', () => {
      const src = createUniformPixelData(12, 8, [100, 100, 100, 255])
      const blurred = boxBlur3Pass(src, 2)

      expect(blurred.width).toBe(12)
      expect(blurred.height).toBe(8)
    })
  })

  describe('horizontalBoxBlur', () => {
    it('R7 水平模糊均匀图不变', () => {
      const src = createUniformPixelData(8, 4, [100, 50, 25, 255])
      const dst = createPixelData(8, 4)
      horizontalBoxBlur(src, dst, 2)

      for (let i = 0; i < dst.data.length; i += 4) {
        expect(dst.data[i]).toBeCloseTo(100, 1)
        expect(dst.data[i + 1]).toBeCloseTo(50, 1)
        expect(dst.data[i + 2]).toBeCloseTo(25, 1)
      }
    })

    it('R7b 水平模糊保持 Alpha 通道', () => {
      const src = createUniformPixelData(8, 4, [100, 50, 25, 200])
      const dst = createPixelData(8, 4)
      horizontalBoxBlur(src, dst, 2)

      for (let i = 0; i < dst.data.length; i += 4) {
        expect(dst.data[i + 3]).toBe(200) // Alpha 不变
      }
    })
  })

  describe('verticalBoxBlur', () => {
    it('R8 垂直模糊均匀图不变', () => {
      const src = createUniformPixelData(4, 8, [100, 50, 25, 255])
      const dst = createPixelData(4, 8)
      verticalBoxBlur(src, dst, 2)

      for (let i = 0; i < dst.data.length; i += 4) {
        expect(dst.data[i]).toBeCloseTo(100, 1)
        expect(dst.data[i + 1]).toBeCloseTo(50, 1)
        expect(dst.data[i + 2]).toBeCloseTo(25, 1)
      }
    })
  })

  describe('prepareAnalysis', () => {
    it('R9 返回 resized + blurred，尺寸正确', () => {
      const src = createUniformPixelData(3840, 2160, [100, 100, 100, 255])
      const result = prepareAnalysis(src, 1920, 2)

      // 长边 3840 → 1920
      expect(result.resized.width).toBe(1920)
      expect(result.resized.height).toBe(1080)
      expect(result.blurred.width).toBe(1920)
      expect(result.blurred.height).toBe(1080)
    })

    it('R9b 小图不放大', () => {
      const src = createUniformPixelData(100, 80, [50, 50, 50, 255])
      const result = prepareAnalysis(src, 1920, 2)

      expect(result.resized.width).toBe(100)
      expect(result.resized.height).toBe(80)
    })
  })
})
