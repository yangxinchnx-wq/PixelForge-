/**
 * Motion Detector(Step 30.16)— 摄像头运动检测。
 *
 * 原理:
 * - 每帧从 video 采样一个小尺寸的灰度图(如 32x24)
 * - 与上一帧比较,计算差异总和 → motion value(0-1)
 * - 同时计算平均亮度 → brightness(0-1)
 *
 * 与 spec §16 对齐:
 *   Frame A vs Frame B → 差异 → motion value
 *
 * 设计:
 * - 使用一个小 canvas 做降采样(32x24),避免全分辨率比较的性能开销
 * - 把结果写入 InputRouter('camera.motion' / 'camera.brightness')
 * - 不直接读取 video(由调用方传入 ImageData / 灰度数组,便于测试)
 */

import type { VideoElementLike } from './cameraInput'
import { CAMERA_SIGNAL_IDS } from '../types'

// ============================================================================
// 1. 配置
// ============================================================================

/**
 * MotionDetector 配置。
 *
 * - sampleWidth:   采样宽度(默认 32,降采样后的宽度)
 * - sampleHeight:  采样高度(默认 24)
 * - threshold:     差异阈值(单像素差异低于此值视为噪声,默认 30)
 * - smoothing:     平滑系数(0-1,默认 0.5)
 */
export interface MotionDetectorOptions {
  sampleWidth: number
  sampleHeight: number
  threshold: number
  smoothing: number
}

export const DEFAULT_MOTION_OPTIONS: MotionDetectorOptions = {
  sampleWidth: 32,
  sampleHeight: 24,
  threshold: 30,
  smoothing: 0.5,
}

// ============================================================================
// 2. SignalWriter 接口
// ============================================================================

interface SignalWriter {
  setSignal: (id: string, value: number, source: 'CAMERA') => void
}

// ============================================================================
// 3. MotionDetector 类
// ============================================================================

/**
 * 运动检测器。
 *
 * 用法:
 *   const detector = new MotionDetector(inputRouter)
 *   // 每帧:
 *   detector.update(videoElement)
 */
export class MotionDetector {
  private router: SignalWriter | null
  private options: MotionDetectorOptions
  private prevGray: Uint8ClampedArray | null = null
  private lastMotion: number = 0
  private lastBrightness: number = 0
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null

  constructor(router: SignalWriter | null = null, options: Partial<MotionDetectorOptions> = {}) {
    this.router = router
    this.options = { ...DEFAULT_MOTION_OPTIONS, ...options }
  }

  /**
   * 每帧更新:从 video 采样,计算 motion / brightness。
   *
   * @param video video 元素(必须 readyState >= 2)
   * @returns { motion, brightness }(0-1),若 video 未就绪返回 {0, 0}
   */
  update(video: VideoElementLike): { motion: number; brightness: number } {
    if (video.readyState < 2) {
      return { motion: 0, brightness: 0 }
    }

    // 采样:把 video 画到小 canvas 上,得到降采样的 ImageData
    const imageData = this.sampleVideo(video)
    if (!imageData) {
      return { motion: this.lastMotion, brightness: this.lastBrightness }
    }

    // 转灰度
    const gray = toGrayscale(imageData, this.options.sampleWidth, this.options.sampleHeight)

    // 计算亮度
    const brightness = computeBrightness(gray)

    // 计算运动(与上一帧的差异)
    let motion = 0
    if (this.prevGray && this.prevGray.length === gray.length) {
      motion = computeDifference(gray, this.prevGray, this.options.threshold)
    }

    // 平滑
    this.lastMotion = smooth(this.lastMotion, motion, this.options.smoothing)
    this.lastBrightness = smooth(this.lastBrightness, brightness, this.options.smoothing)

    // 保存当前帧
    this.prevGray = gray

    // 写入 router
    if (this.router) {
      this.router.setSignal(CAMERA_SIGNAL_IDS.motion, this.lastMotion, 'CAMERA')
      this.router.setSignal(CAMERA_SIGNAL_IDS.brightness, this.lastBrightness, 'CAMERA')
    }

    return { motion: this.lastMotion, brightness: this.lastBrightness }
  }

  /**
   * 从 video 采样到小 canvas,获取 ImageData。
   */
  private sampleVideo(video: VideoElementLike): ImageData | null {
    const w = this.options.sampleWidth
    const h = this.options.sampleHeight

    // 懒初始化 canvas
    if (!this.canvas) {
      if (typeof document === 'undefined') {
        return null // 测试环境无 document
      }
      this.canvas = document.createElement('canvas')
      this.canvas.width = w
      this.canvas.height = h
      this.ctx = this.canvas.getContext('2d')
    }
    if (!this.ctx) return null

    // 把 video 绘制到 canvas(自动降采样)
    this.ctx.drawImage(video as unknown as CanvasImageSource, 0, 0, w, h)
    return this.ctx.getImageData(0, 0, w, h)
  }

  /** 重置状态 */
  reset(): void {
    this.prevGray = null
    this.lastMotion = 0
    this.lastBrightness = 0
  }

  /** 更新配置 */
  setOptions(options: Partial<MotionDetectorOptions>): void {
    this.options = { ...this.options, ...options }
    // 尺寸变化时重建 canvas
    if (options.sampleWidth || options.sampleHeight) {
      this.canvas = null
      this.ctx = null
    }
  }

  /** 获取上一次的 motion(0-1) */
  getMotion(): number {
    return this.lastMotion
  }

  /** 获取上一次的 brightness(0-1) */
  getBrightness(): number {
    return this.lastBrightness
  }

  /** 销毁 */
  dispose(): void {
    this.canvas = null
    this.ctx = null
    this.prevGray = null
  }
}

// ============================================================================
// 4. 纯函数(便于测试)
// ============================================================================

/**
 * 把 ImageData 转成灰度数组(Uint8ClampedArray)。
 *
 * 使用 ITU-R BT.601 加权:Y = 0.299R + 0.587G + 0.114B
 */
export function toGrayscale(imageData: ImageData, width: number, height: number): Uint8ClampedArray {
  const gray = new Uint8ClampedArray(width * height)
  const data = imageData.data
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  }
  return gray
}

/**
 * 计算两帧灰度图的差异(归一化到 0-1)。
 *
 * - 仅统计差异 > threshold 的像素
 * - 返回差异像素占比 * 平均差异强度
 */
export function computeDifference(
  current: Uint8ClampedArray,
  previous: Uint8ClampedArray,
  threshold: number,
): number {
  if (current.length !== previous.length || current.length === 0) return 0
  let diffPixels = 0
  let totalDiff = 0
  for (let i = 0; i < current.length; i++) {
    const diff = Math.abs(current[i] - previous[i])
    if (diff > threshold) {
      diffPixels++
      totalDiff += diff
    }
  }
  const ratio = diffPixels / current.length
  const avgDiff = diffPixels > 0 ? totalDiff / diffPixels / 255 : 0
  // motion = 占比 * 强度(都归一化到 0-1)
  return Math.min(1, ratio * avgDiff * 4) // 乘 4 放大(因为通常差异很小)
}

/**
 * 计算灰度图的平均亮度(归一化到 0-1)。
 */
export function computeBrightness(gray: Uint8ClampedArray): number {
  if (gray.length === 0) return 0
  let sum = 0
  for (let i = 0; i < gray.length; i++) {
    sum += gray[i]
  }
  return sum / gray.length / 255
}

/**
 * 指数平滑(与 mapper.smoothValue 一致,但内联以避免循环依赖)。
 */
function smooth(current: number, target: number, smoothing: number): number {
  const s = Math.max(0, Math.min(0.99, smoothing))
  return current + (target - current) * (1 - s)
}
