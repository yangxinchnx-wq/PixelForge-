/**
 * PixelForge - 像素级签名捕获与验证
 *
 * 阶段五新增：像素级回放一致性验证。
 *
 * 工作原理：
 * 1. 渲染完成后，从 GPU 输出纹理中采样固定网格的像素
 * 2. 计算 FNV-1a hash 作为像素签名
 * 3. 将签名存储到帧记录中
 * 4. 回放时重新采样并比较签名
 *
 * 采样策略：
 * - 在纹理上均匀采样 NxN 网格点（默认 8x8 = 64 个像素）
 * - 每个像素取 RGBA 4 字节
 * - 总采样数据 = 64 * 4 = 256 字节
 * - 足以检测绝大多数渲染差异，同时保持极低开销
 *
 * GPU 同步：
 * - 使用 copyTextureToBuffer 将纹理像素拷贝到缓冲区
 * - 通过 onSubmittedWorkDone 等待 GPU 命令完成
 * - 通过 mapAsync 读取缓冲区数据到 CPU
 */

import type { RuntimeDeviceHandle, RuntimeCanvasSize } from './types'

/** 采样网格默认大小 */
const DEFAULT_SAMPLE_GRID_SIZE = 8

/** FNV-1a hash 常量 */
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * GPUBufferUsage / GPUMapMode 在测试环境（jsdom）中可能未定义。
 * 使用数值常量 fallback，保证在非浏览器环境中也能运行。
 * 数值取自 WebGPU 规范：https://www.w3.org/TR/webgpu/
 */
const BUFFER_USAGE_MAP_READ = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.MAP_READ : 1
const BUFFER_USAGE_COPY_DST = typeof GPUBufferUsage !== 'undefined' ? GPUBufferUsage.COPY_DST : 8
const MAP_MODE_READ = typeof GPUMapMode !== 'undefined' ? GPUMapMode.READ : 1

/**
 * 像素签名捕获结果。
 */
export interface PixelSignatureResult {
  /** 采样像素数据的 FNV-1a hash（十六进制字符串） */
  hash: string
  /** 采样点数量 */
  sampleCount: number
  /** 采样网格大小 */
  gridSize: number
}

/**
 * 从 GPU 输出纹理捕获像素签名。
 *
 * 流程：
 * 1. 创建 staging buffer
 * 2. 将纹理拷贝到 buffer
 * 3. 等待 GPU 完成
 * 4. 映射 buffer 读取像素数据
 * 5. 采样网格点并计算 hash
 *
 * @param device 运行时设备句柄
 * @param texture GPU 输出纹理
 * @param canvasSize 画布尺寸
 * @param gridSize 采样网格大小（默认 8x8）
 * @returns 像素签名结果，失败时返回 null
 */
export async function capturePixelSignature(
  device: RuntimeDeviceHandle,
  texture: GPUTexture,
  canvasSize: RuntimeCanvasSize,
  gridSize: number = DEFAULT_SAMPLE_GRID_SIZE,
): Promise<PixelSignatureResult | null> {
  const { width, height } = canvasSize
  if (width < 1 || height < 1) return null

  try {
    // 1. 创建 staging buffer（用于 CPU 回读）
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256 // 对齐到 256 字节
    const stagingBuffer = device.createBuffer({
      label: '像素签名-staging',
      size: bytesPerRow * height,
      usage: BUFFER_USAGE_MAP_READ | BUFFER_USAGE_COPY_DST,
    })

    // 2. 编码纹理 → buffer 拷贝
    const encoder = device.createCommandEncoder({ label: '像素签名-拷贝编码器' })
    encoder.copyTextureToBuffer(
      { texture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
      { buffer: stagingBuffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    )
    device.queue.submit([encoder.finish()])

    // 3. 等待 GPU 完成
    await device.queue.onSubmittedWorkDone()

    // 4. 映射 buffer 读取像素
    await stagingBuffer.mapAsync(MAP_MODE_READ)
    const mappedData = stagingBuffer.getMappedRange()
    const pixelData = new Uint8Array(mappedData.slice(0))

    // 5. 采样网格点并计算 hash
    const samples = sampleGridPixels(pixelData, width, height, bytesPerRow, gridSize)
    stagingBuffer.unmap()
    stagingBuffer.destroy()

    const hash = fnv1aHash(samples)

    return {
      hash,
      sampleCount: gridSize * gridSize,
      gridSize,
    }
  } catch (error) {
    console.warn('[pixelSignature] 像素签名捕获失败:', error)
    return null
  }
}

/**
 * 从像素数据中采样固定网格点。
 *
 * 采样策略：
 * - 在纹理上均匀选取 gridSize × gridSize 个点
 * - 每个点取 RGBA 4 字节
 * - 返回所有采样数据的 Uint8Array
 */
function sampleGridPixels(
  pixelData: Uint8Array,
  width: number,
  height: number,
  bytesPerRow: number,
  gridSize: number,
): Uint8Array {
  const samples = new Uint8Array(gridSize * gridSize * 4)

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      // 均匀分布采样点，避免边缘
      const px = Math.floor((gx + 0.5) * width / gridSize)
      const py = Math.floor((gy + 0.5) * height / gridSize)

      // 确保不越界
      const clampedX = Math.min(px, width - 1)
      const clampedY = Math.min(py, height - 1)

      const offset = clampedY * bytesPerRow + clampedX * 4
      const sampleIndex = (gy * gridSize + gx) * 4

      // RGBA 4 字节
      samples[sampleIndex] = pixelData[offset] ?? 0
      samples[sampleIndex + 1] = pixelData[offset + 1] ?? 0
      samples[sampleIndex + 2] = pixelData[offset + 2] ?? 0
      samples[sampleIndex + 3] = pixelData[offset + 3] ?? 0
    }
  }

  return samples
}

/**
 * FNV-1a hash 计算。
 *
 * 将 Uint8Array 计算为 32 位 hash，返回十六进制字符串。
 * FNV-1a 特性：
 * - 良好的分布性
 * - 计算极快
 * - 对输入变化敏感（1 bit 变化 → 完全不同 hash）
 */
function fnv1aHash(data: Uint8Array): string {
  let hash = FNV_OFFSET_BASIS

  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]
    hash = Math.imul(hash, FNV_PRIME)
  }

  // 转为无符号 32 位十六进制字符串
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 验证像素签名是否一致。
 *
 * @param expected 预期的像素签名 hash
 * @param actual 实际捕获的像素签名结果
 * @returns true = 一致, false = 不一致
 */
export function verifyPixelSignature(
  expected: string,
  actual: PixelSignatureResult | null,
): boolean {
  if (!actual) return false
  return expected === actual.hash
}
