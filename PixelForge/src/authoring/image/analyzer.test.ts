/**
 * 图片分析器测试（Phase D 集成版）
 *
 * 测试覆盖:
 *   A1  analyzeImage 返回正确的尺寸信息(原图 + 采样)
 *   A2  analyzeImage 生成的 region 覆盖整图(0,0,1,1)
 *   A3  analyzeImage 计算的平均色与像素数据一致
 *   A4  analyzeImage 大图被降采样到 sampleMaxSize 以内
 *   A5  analyzeImage 小图不被放大(采样尺寸 = 原图尺寸)
 *   A6  analyzeImage 无效尺寸(naturalWidth=0)抛错
 *   A7  analyzeImage sampleMaxSize 选项生效
 *   A8  analyzeImage durationMs 非负
 *   A9  region.id 是非空字符串
 *   A10 非正方形图片保持宽高比
 *   A11 analyzeImage 返回 colorBlockTree（Phase D）
 *   A12 analyzeImage 返回 budgetCheck（Phase D）
 *   A13 analyzeImage 返回的 regions 从 colorBlockTree 叶子提取
 *   B1  regionToBoundingBox 把归一化坐标按比例换算成像素
 *   B2  regionToBoundingBox 处理 (0,0,0,0) 区域
 *   B3  regionToBoundingBox 处理非正方形画布
 *   B4  regionToBoundingBox 处理画布原点尺寸(0,0)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { analyzeImage, regionToBoundingBox } from './analyzer'
import type { ImageRegion } from './analyzer'

// ============================================================================
// DOM mock: 为 analyzeImage 提供最小可用的 canvas + ctx
// ============================================================================

interface StubCanvas {
  width: number
  height: number
  getContext: (type: string, options?: unknown) => StubCtx | null
}

interface StubCtx {
  drawImage: (img: unknown, x: number, y: number, w: number, h: number) => void
  getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray; width: number; height: number }
}

/** 构造一个返回固定 RGBA 像素的 stub ctx */
function createStubCtx(
  pixelCount: number,
  fill: [number, number, number, number],
  width: number,
  height: number,
): StubCtx {
  const data = new Uint8ClampedArray(pixelCount * 4)
  for (let i = 0; i < pixelCount; i += 1) {
    data[i * 4 + 0] = fill[0]
    data[i * 4 + 1] = fill[1]
    data[i * 4 + 2] = fill[2]
    data[i * 4 + 3] = fill[3]
  }
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data, width, height })),
  }
}

/** 构造一个 stub canvas,getContext 返回的 ctx 像素全部填充为 fill 色 */
function createStubCanvas(fill: [number, number, number, number]): StubCanvas {
  // 用闭包持有 canvas 自身的 width/height,避免依赖 this 绑定
  const canvas = {
    width: 0,
    height: 0,
  } as StubCanvas
  let cachedCtx: StubCtx | null = null
  canvas.getContext = () => {
    if (!cachedCtx) {
      // 在 getContext 调用时,width/height 已经被 analyzer 设置好
      const w = canvas.width
      const h = canvas.height
      const pixelCount = w * h
      cachedCtx = createStubCtx(Math.max(1, pixelCount), fill, w, h)
    }
    return cachedCtx
  }
  return canvas
}

// ============================================================================
// mock document.createElement('canvas')
// ============================================================================

beforeEach(() => {
  // vitest 在 node 环境下 document 未定义,用 stubGlobal 注入最小 fakeDocument
  // unstubAllGlobals 会自动恢复原值(若有)
  const stubCanvas = createStubCanvas([200, 100, 50, 255])

  const fakeDocument = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return stubCanvas
      // 其他 tag 返回空对象,避免崩溃
      return {} as HTMLElement
    },
  }
  vi.stubGlobal('document', fakeDocument)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ============================================================================
// mock HTMLImageElement: 只需要 naturalWidth / naturalHeight
// ============================================================================

function createStubImage(
  naturalWidth: number,
  naturalHeight: number,
): HTMLImageElement {
  return { naturalWidth, naturalHeight } as unknown as HTMLImageElement
}

// ============================================================================
// 测试
// ============================================================================

describe('图片分析器 analyzer', () => {
  describe('analyzeImage 基础功能', () => {
    it('A1 返回正确的尺寸信息(原图 + 采样)', async () => {
      const image = createStubImage(1024, 768)
      const result = await analyzeImage(image)

      expect(result.sourceWidth).toBe(1024)
      expect(result.sourceHeight).toBe(768)
      // 1024 > 256,采样后长边应 <= 256
      expect(result.sampleWidth).toBeLessThanOrEqual(256)
      expect(result.sampleHeight).toBeLessThanOrEqual(256)
    })

    it('A2 生成的 region 覆盖整图(0,0,1,1)', async () => {
      const image = createStubImage(512, 512)
      const result = await analyzeImage(image)

      // 均匀图不细分,只有根节点(1 个叶子),bounds = (0,0,1,1)
      expect(result.regions.length).toBeGreaterThanOrEqual(1)
      const region = result.regions[0]
      expect(region.x).toBeCloseTo(0, 5)
      expect(region.y).toBeCloseTo(0, 5)
      expect(region.width).toBeCloseTo(1, 5)
      expect(region.height).toBeCloseTo(1, 5)
    })

    it('A3 平均色与像素数据一致(stub 填充 [200,100,50,255])', async () => {
      const image = createStubImage(128, 128)
      const result = await analyzeImage(image)

      // stub canvas 像素全部填充 [200, 100, 50, 255]
      // 归一化后应为 [200/255, 100/255, 50/255, 1]
      expect(result.averageColor[0]).toBeCloseTo(200 / 255, 5)
      expect(result.averageColor[1]).toBeCloseTo(100 / 255, 5)
      expect(result.averageColor[2]).toBeCloseTo(50 / 255, 5)
      expect(result.averageColor[3]).toBeCloseTo(1, 5)
    })

    it('A4 大图被降采样到 sampleMaxSize 以内(默认 256)', async () => {
      const image = createStubImage(4096, 2048)
      const result = await analyzeImage(image)

      // 长边 4096 → 256,等比缩放后短边应为 128
      expect(result.sampleWidth).toBe(256)
      expect(result.sampleHeight).toBe(128)
    })

    it('A5 小图不被放大(采样尺寸 = 原图尺寸)', async () => {
      const image = createStubImage(100, 80)
      const result = await analyzeImage(image)

      // scale = min(1, 256/100) = 1,不放大
      expect(result.sampleWidth).toBe(100)
      expect(result.sampleHeight).toBe(80)
    })

    it('A6 无效尺寸(naturalWidth=0)抛错', async () => {
      const image = createStubImage(0, 100)
      await expect(analyzeImage(image)).rejects.toThrow(/图片尺寸无效/)
    })

    it('A6b 无效尺寸(naturalHeight=0)抛错', async () => {
      const image = createStubImage(100, 0)
      await expect(analyzeImage(image)).rejects.toThrow(/图片尺寸无效/)
    })

    it('A7 sampleMaxSize 选项生效', async () => {
      const image = createStubImage(1024, 1024)
      const result = await analyzeImage(image, { sampleMaxSize: 64 })

      expect(result.sampleWidth).toBe(64)
      expect(result.sampleHeight).toBe(64)
    })

    it('A8 durationMs 非负', async () => {
      const image = createStubImage(256, 256)
      const result = await analyzeImage(image)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('A9 region.id 是非空字符串', async () => {
      const image = createStubImage(64, 64)
      const result = await analyzeImage(image)

      expect(result.regions[0].id).toBeTruthy()
      expect(typeof result.regions[0].id).toBe('string')
    })

    it('A10 非正方形图片保持宽高比', async () => {
      const image = createStubImage(2000, 500)
      const result = await analyzeImage(image)

      // 长边 2000 → 256,短边 500 → 64
      expect(result.sampleWidth).toBe(256)
      expect(result.sampleHeight).toBe(64)
    })
  })

  describe('analyzeImage Phase D 集成', () => {
    it('A11 返回 colorBlockTree', async () => {
      const image = createStubImage(256, 256)
      const result = await analyzeImage(image)

      expect(result.colorBlockTree).toBeTruthy()
      expect(result.colorBlockTree.root).toBeTruthy()
      // 均匀图只有根节点
      expect(result.colorBlockTree.root.bounds.x).toBeCloseTo(0, 5)
      expect(result.colorBlockTree.root.bounds.y).toBeCloseTo(0, 5)
      expect(result.colorBlockTree.root.bounds.width).toBeCloseTo(1, 5)
      expect(result.colorBlockTree.root.bounds.height).toBeCloseTo(1, 5)
    })

    it('A12 返回 budgetCheck', async () => {
      const image = createStubImage(256, 256)
      const result = await analyzeImage(image)

      expect(result.budgetCheck).toBeTruthy()
      expect(typeof result.budgetCheck.isOverBudget).toBe('boolean')
      expect(typeof result.budgetCheck.nodeCount).toBe('number')
      expect(typeof result.budgetCheck.maxDepth).toBe('number')
    })

    it('A13 regions 从 colorBlockTree 叶子提取', async () => {
      const image = createStubImage(128, 128)
      const result = await analyzeImage(image)

      // 均匀图不细分,只有根节点(1 个叶子)
      // regions 应至少有 1 个
      expect(result.regions.length).toBeGreaterThanOrEqual(1)
      // 每个region的坐标在 [0,1] 范围内
      for (const region of result.regions) {
        expect(region.x).toBeGreaterThanOrEqual(0)
        expect(region.y).toBeGreaterThanOrEqual(0)
        expect(region.x + region.width).toBeLessThanOrEqual(1.001)
        expect(region.y + region.height).toBeLessThanOrEqual(1.001)
      }
    })

    it('A14 均匀图不超预算', async () => {
      const image = createStubImage(128, 128)
      const result = await analyzeImage(image)

      expect(result.budgetCheck.isOverBudget).toBe(false)
    })

    it('A15 colorBlockTree.source = "image_analysis"', async () => {
      const image = createStubImage(64, 64)
      const result = await analyzeImage(image)

      expect(result.colorBlockTree.root.source).toBe('image_analysis')
    })

    it('A16 colorBlockTree.toLLMView 输出非空文本', async () => {
      const image = createStubImage(64, 64)
      const result = await analyzeImage(image)

      const llmView = result.colorBlockTree.toLLMView()
      expect(llmView).toBeTruthy()
      expect(llmView.length).toBeGreaterThan(0)
      expect(llmView).toContain('root')
    })
  })

  describe('regionToBoundingBox', () => {
    it('B1 把整图区域 (0,0,1,1) 映射到完整画布', () => {
      const region: ImageRegion = {
        id: 'r1',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        color: [0.5, 0.5, 0.5, 1],
      }
      const box = regionToBoundingBox(region, 1024, 768)

      expect(box.x).toBe(0)
      expect(box.y).toBe(0)
      expect(box.width).toBe(1024)
      expect(box.height).toBe(768)
    })

    it('B2 处理 (0,0,0,0) 区域(退化情况)', () => {
      const region: ImageRegion = {
        id: 'r2',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        color: [0, 0, 0, 1],
      }
      const box = regionToBoundingBox(region, 1024, 768)

      expect(box.x).toBe(0)
      expect(box.y).toBe(0)
      expect(box.width).toBe(0)
      expect(box.height).toBe(0)
    })

    it('B3 处理非正方形画布(宽高比不均)', () => {
      const region: ImageRegion = {
        id: 'r3',
        x: 0.25,
        y: 0.5,
        width: 0.5,
        height: 0.25,
        color: [0.1, 0.2, 0.3, 1],
      }
      const box = regionToBoundingBox(region, 1024, 768)

      expect(box.x).toBe(256)        // 0.25 * 1024
      expect(box.y).toBe(384)        // 0.5  * 768
      expect(box.width).toBe(512)    // 0.5  * 1024
      expect(box.height).toBe(192)   // 0.25 * 768
    })

    it('B4 处理画布原点尺寸(0,0)', () => {
      const region: ImageRegion = {
        id: 'r4',
        x: 0.5,
        y: 0.5,
        width: 1,
        height: 1,
        color: [0, 0, 0, 1],
      }
      const box = regionToBoundingBox(region, 0, 0)

      expect(box.x).toBe(0)
      expect(box.y).toBe(0)
      expect(box.width).toBe(0)
      expect(box.height).toBe(0)
    })
  })
})
