/**
 * PixelForge - 图像预处理（骨架 §5.4 / 技术路线 §21.9.3）
 *
 * 本模块实现图像理解 Phase 1 的预处理流水线：
 *   1. resizeImage  — 下采样到分析尺寸（4K → 1080p，降低积分图内存）
 *   2. boxBlur3Pass — 3 次 box blur 近似 Gaussian blur（σ ≈ 1.5），降噪保护 Sobel
 *
 * 数据流（技术路线 §21.9.3.7）：
 *   原始图像
 *     ↓ resizeImage（如需要）
 *   分析尺寸图像
 *     ↓ boxBlur3Pass（radius=2）
 *   模糊图像（噪声降低）
 *     ↓ IntegralImages（integralImage.ts）
 *   积分图（边缘 + 灰度 + 灰度平方）
 *
 * PixelData 接口不依赖浏览器 ImageData，可在 Node.js / Worker 中使用。
 */

// ============================================================================
// PixelData — 跨环境的像素数据接口
// ============================================================================

/**
 * 像素数据接口（RGBA，不依赖浏览器 ImageData）。
 *
 * data 布局：每像素 4 字节（R, G, B, A），按行优先排列。
 * data.length === width * height * 4
 */
export interface PixelData {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * 从浏览器 ImageData 创建 PixelData（零拷贝，共享底层 buffer）。
 */
export function fromImageData(imageData: ImageData): PixelData {
  return {
    data: imageData.data,
    width: imageData.width,
    height: imageData.height,
  }
}

/**
 * 创建空白 PixelData（全部像素初始化为透明黑）。
 */
export function createPixelData(width: number, height: number): PixelData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
  }
}

// ============================================================================
// resizeImage — 双线性插值下采样
// ============================================================================

/**
 * 下采样图像到指定尺寸（双线性插值）。
 *
 * 如果目标尺寸 ≥ 原图尺寸，返回原图的拷贝（不放大）。
 *
 * @param src 源像素数据
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 * @returns 缩放后的 PixelData
 */
export function resizeImage(
  src: PixelData,
  targetWidth: number,
  targetHeight: number,
): PixelData {
  const { data: srcData, width: srcWidth, height: srcHeight } = src

  // 目标尺寸 ≥ 原图 → 直接拷贝
  if (targetWidth >= srcWidth && targetHeight >= srcHeight) {
    return {
      data: new Uint8ClampedArray(srcData),
      width: srcWidth,
      height: srcHeight,
    }
  }

  const dst = createPixelData(targetWidth, targetHeight)
  const dstData = dst.data

  // X 方向缩放比：源坐标 = 目标坐标 * (srcWidth / targetWidth)
  const scaleX = srcWidth / targetWidth
  const scaleY = srcHeight / targetHeight

  for (let dy = 0; dy < targetHeight; dy++) {
    // 源 Y 坐标（中心点对齐：dy + 0.5）
    const sy = (dy + 0.5) * scaleY - 0.5
    const y0 = Math.max(0, Math.floor(sy))
    const y1 = Math.min(srcHeight - 1, y0 + 1)
    const fy = sy - y0
    const fyInv = 1 - fy

    for (let dx = 0; dx < targetWidth; dx++) {
      // 源 X 坐标
      const sx = (dx + 0.5) * scaleX - 0.5
      const x0 = Math.max(0, Math.floor(sx))
      const x1 = Math.min(srcWidth - 1, x0 + 1)
      const fx = sx - x0
      const fxInv = 1 - fx

      // 4 个邻域像素索引
      const i00 = (y0 * srcWidth + x0) * 4
      const i01 = (y0 * srcWidth + x1) * 4
      const i10 = (y1 * srcWidth + x0) * 4
      const i11 = (y1 * srcWidth + x1) * 4

      const di = (dy * targetWidth + dx) * 4

      // 双线性插值（R, G, B, A 四通道）
      for (let c = 0; c < 4; c++) {
        const top = srcData[i00 + c] * fxInv + srcData[i01 + c] * fx
        const bot = srcData[i10 + c] * fxInv + srcData[i11 + c] * fx
        dstData[di + c] = top * fyInv + bot * fy
      }
    }
  }

  return dst
}

/**
 * 按最大长边等比下采样。
 *
 * 如果原图长边 ≤ maxDim，返回原图拷贝。
 */
export function resizeToMaxDim(src: PixelData, maxDim: number): PixelData {
  const longest = Math.max(src.width, src.height)
  if (longest <= maxDim) {
    return {
      data: new Uint8ClampedArray(src.data),
      width: src.width,
      height: src.height,
    }
  }
  const scale = maxDim / longest
  return resizeImage(
    src,
    Math.max(1, Math.floor(src.width * scale)),
    Math.max(1, Math.floor(src.height * scale)),
  )
}

// ============================================================================
// Box Blur — 3 pass 近似 Gaussian（技术路线 §21.9.3.4）
// ============================================================================

/**
 * 3 次 box blur 近似 Gaussian blur（σ ≈ 1.5 when radius=2）。
 *
 * 原理：3 次 box blur → Gaussian 的快速近似。
 * 实现：水平 → 垂直 → 水平，每 pass 使用滑动窗口 O(1) per pixel。
 *
 * @param src 源像素数据
 * @param radius 模糊半径（默认 2），diameter = radius * 2 + 1
 * @returns 模糊后的 PixelData（新分配，不修改源数据）
 */
export function boxBlur3Pass(src: PixelData, radius: number = 2): PixelData {
  const temp = createPixelData(src.width, src.height)
  const pass1 = createPixelData(src.width, src.height)
  const pass2 = createPixelData(src.width, src.height)

  // Pass 1: 水平模糊 → temp
  horizontalBoxBlur(src, temp, radius)
  // Pass 2: 垂直模糊 → pass1
  verticalBoxBlur(temp, pass1, radius)
  // Pass 3: 水平模糊 → pass2（最终结果）
  horizontalBoxBlur(pass1, pass2, radius)

  return pass2
}

/**
 * 水平方向 box blur（滑动窗口优化，O(1) per pixel）。
 *
 * 窗口大小 = diameter = radius * 2 + 1。
 * 边界处理：clamp（超出边界的坐标映射到边界像素）。
 */
export function horizontalBoxBlur(
  src: PixelData,
  dst: PixelData,
  radius: number,
): void {
  const { data: srcData, width: w, height: h } = src
  const { data: dstData } = dst
  const diameter = radius * 2 + 1

  for (let y = 0; y < h; y++) {
    // 初始化窗口内 R/G/B 累加（处理左边界 clamp）
    let r = 0
    let g = 0
    let b = 0
    for (let x = -radius; x <= radius; x++) {
      const xi = Math.min(w - 1, Math.max(0, x))
      const i = (y * w + xi) * 4
      r += srcData[i]
      g += srcData[i + 1]
      b += srcData[i + 2]
    }

    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4
      dstData[di] = r / diameter
      dstData[di + 1] = g / diameter
      dstData[di + 2] = b / diameter
      dstData[di + 3] = srcData[di + 3] // Alpha 保留

      // 滑动窗口：加入右侧新像素，移除左侧旧像素
      const addX = Math.min(w - 1, x + radius + 1)
      const subX = Math.max(0, x - radius)
      const addI = (y * w + addX) * 4
      const subI = (y * w + subX) * 4

      r += srcData[addI] - srcData[subI]
      g += srcData[addI + 1] - srcData[subI + 1]
      b += srcData[addI + 2] - srcData[subI + 2]
    }
  }
}

/**
 * 垂直方向 box blur（滑动窗口优化，O(1) per pixel）。
 *
 * 窗口大小 = diameter = radius * 2 + 1。
 * 边界处理：clamp。
 */
export function verticalBoxBlur(
  src: PixelData,
  dst: PixelData,
  radius: number,
): void {
  const { data: srcData, width: w, height: h } = src
  const { data: dstData } = dst
  const diameter = radius * 2 + 1

  for (let x = 0; x < w; x++) {
    // 初始化窗口内 R/G/B 累加（处理上边界 clamp）
    let r = 0
    let g = 0
    let b = 0
    for (let y = -radius; y <= radius; y++) {
      const yi = Math.min(h - 1, Math.max(0, y))
      const i = (yi * w + x) * 4
      r += srcData[i]
      g += srcData[i + 1]
      b += srcData[i + 2]
    }

    for (let y = 0; y < h; y++) {
      const di = (y * w + x) * 4
      dstData[di] = r / diameter
      dstData[di + 1] = g / diameter
      dstData[di + 2] = b / diameter
      dstData[di + 3] = srcData[di + 3] // Alpha 保留

      // 滑动窗口：加入下侧新像素，移除上侧旧像素
      const addY = Math.min(h - 1, y + radius + 1)
      const subY = Math.max(0, y - radius)
      const addI = (addY * w + x) * 4
      const subI = (subY * w + x) * 4

      r += srcData[addI] - srcData[subI]
      g += srcData[addI + 1] - srcData[subI + 1]
      b += srcData[addI + 2] - srcData[subI + 2]
    }
  }
}

// ============================================================================
// prepareAnalysis — 预处理流水线入口（技术路线 §21.9.3.7）
// ============================================================================

/**
 * 图像预处理结果。
 */
export interface PreparedAnalysis {
  /** 缩放后的图像（可能等于原图） */
  resized: PixelData
  /** 模糊后的图像（降噪） */
  blurred: PixelData
}

/**
 * 预处理流水线：resize → blur。
 *
 * 按技术路线 §21.9.3.7：
 *   原始 4K 图 → resize（maxDim=1920）→ 1080p → boxBlur3Pass（radius=2）→ 模糊图
 *
 * @param src 原始像素数据
 * @param maxDim 分析最大长边（默认 1920，4K → 1080p）
 * @param blurRadius 模糊半径（默认 2，近似 Gaussian σ=1.5）
 */
export function prepareAnalysis(
  src: PixelData,
  maxDim: number = 1920,
  blurRadius: number = 2,
): PreparedAnalysis {
  const resized = resizeToMaxDim(src, maxDim)
  const blurred = boxBlur3Pass(resized, blurRadius)
  return { resized, blurred }
}
