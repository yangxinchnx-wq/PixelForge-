/**
 * Beat Detector(Step 30.9)— 鼓点检测。
 *
 * 原理:
 * - 维护一个滑动窗口的能量历史
 * - 当当前能量 > 平均能量 * threshold 时,判定为 beat
 * - 加入 refractory period(不应期),避免单次 beat 被多次触发
 * - 估算 BPM(基于 beat 间隔)
 *
 * 与 spec §9 对齐:
 *   bass: [0.2, 0.3, 0.4, 0.95, 0.3] → 第 4 帧检测到 beat
 *
 * 设计:
 * - 纯逻辑类,不依赖 AudioContext(便于测试)
 * - 输入:当前帧的频段能量(通常用 bass)
 * - 输出:{ beat: boolean, bpm: number }
 */

// ============================================================================
// 1. 配置
// ============================================================================

/**
 * Beat 检测配置。
 *
 * - historySize:    能量历史窗口大小(帧数,默认 43 ≈ 1 秒 @ 60fps)
 * - threshold:      触发阈值(当前能量 / 平均能量,默认 1.3)
 * - minEnergy:      最小能量门槛(低于此值不触发,避免静音误判)
 * - refractoryMs:   不应期(毫秒,避免连续触发,默认 250ms)
 * - bpmWindow:      BPM 估算窗口(beat 间隔数,默认 8)
 */
export interface BeatDetectorOptions {
  historySize: number
  threshold: number
  minEnergy: number
  refractoryMs: number
  bpmWindow: number
}

export const DEFAULT_BEAT_OPTIONS: BeatDetectorOptions = {
  historySize: 43, // ~1 秒 @ 60fps
  threshold: 1.3,
  minEnergy: 0.05,
  refractoryMs: 250,
  bpmWindow: 8,
}

// ============================================================================
// 2. BeatDetector 类
// ============================================================================

/**
 * 鼓点检测器。
 *
 * 用法:
 *   const detector = new BeatDetector()
 *   // 每帧调用:
 *   const result = detector.detect(bassEnergy, now)
 *   if (result.beat) {
 *     // 触发粒子爆炸等效果
 *   }
 */
export class BeatDetector {
  private options: BeatDetectorOptions
  private history: number[] = []
  private lastBeatTime: number = 0
  private beatIntervals: number[] = [] // 最近的 beat 间隔(毫秒)

  constructor(options: Partial<BeatDetectorOptions> = {}) {
    this.options = { ...DEFAULT_BEAT_OPTIONS, ...options }
  }

  /**
   * 检测当前帧是否为 beat。
   *
   * @param energy 当前帧的能量(0-1,通常用 bass)
   * @param now    当前时间戳(毫秒)
   * @returns { beat: boolean, bpm: number }
   */
  detect(energy: number, now: number): { beat: boolean; bpm: number } {
    // 加入历史
    this.history.push(energy)
    if (this.history.length > this.options.historySize) {
      this.history.shift()
    }

    // 历史不足,无法判断
    if (this.history.length < 4) {
      return { beat: false, bpm: 0 }
    }

    // 计算平均能量
    const avg = this.history.reduce((s, v) => s + v, 0) / this.history.length

    // 不应期检查
    if (now - this.lastBeatTime < this.options.refractoryMs) {
      return { beat: false, bpm: this.estimateBpm() }
    }

    // 能量低于门槛
    if (energy < this.options.minEnergy) {
      return { beat: false, bpm: this.estimateBpm() }
    }

    // 平均能量过低时,降低阈值(避免静音段误判)
    const effectiveThreshold = avg < 0.05
      ? this.options.threshold + 0.5
      : this.options.threshold

    // 检测:当前能量 > 平均 * 阈值
    const isBeat = energy > avg * effectiveThreshold && energy > this.options.minEnergy

    if (isBeat) {
      // 记录 beat 间隔
      if (this.lastBeatTime > 0) {
        const interval = now - this.lastBeatTime
        this.beatIntervals.push(interval)
        if (this.beatIntervals.length > this.options.bpmWindow) {
          this.beatIntervals.shift()
        }
      }
      this.lastBeatTime = now
      return { beat: true, bpm: this.estimateBpm() }
    }

    return { beat: false, bpm: this.estimateBpm() }
  }

  /**
   * 估算 BPM(基于最近的 beat 间隔)。
   */
  private estimateBpm(): number {
    if (this.beatIntervals.length < 2) return 0
    const avgInterval =
      this.beatIntervals.reduce((s, v) => s + v, 0) / this.beatIntervals.length
    if (avgInterval <= 0) return 0
    return Math.round(60000 / avgInterval)
  }

  /** 重置状态 */
  reset(): void {
    this.history.length = 0
    this.beatIntervals.length = 0
    this.lastBeatTime = 0
  }

  /** 更新配置 */
  setOptions(options: Partial<BeatDetectorOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /** 获取当前配置 */
  getOptions(): BeatDetectorOptions {
    return { ...this.options }
  }
}

// ============================================================================
// 3. 简化版(无状态,仅基于能量差)
// ============================================================================

/**
 * 简化版 beat 检测(无状态,基于能量差)。
 *
 * 用于不需要 BPM 估算的简单场景。
 *
 * @param current    当前能量
 * @param previous   上一帧能量
 * @param threshold  触发阈值(能量差,默认 0.3)
 * @param minEnergy  最小能量门槛
 */
export function detectBeatByDiff(
  current: number,
  previous: number,
  threshold: number = 0.3,
  minEnergy: number = 0.05,
): boolean {
  if (current < minEnergy) return false
  return current - previous > threshold
}
