/**
 * Feature Extractor(Step 30.10)— 音频特征聚合器。
 *
 * 职责:
 * - update():  从 AudioAnalyzer 读取数据,计算 AudioFeatures(volume/bass/mid/high/beat/bpm)
 * - 把特征写入 InputRouter(作为 signals)
 *
 * 与 spec §10 对齐:
 *   AudioAnalyzer.getFftData()
 *     ↓ computeBands / computeVolume
 *   { volume, bass, mid, high }
 *     ↓ BeatDetector.detect
 *   { beat, bpm }
 *     ↓ InputRouter.setSignals
 *   audio.volume / audio.bass / audio.beat / ...
 *
 * 设计:
 * - 组合 AudioAnalyzer + BeatDetector(不继承)
 * - 每帧调用 update(),由 scheduler 驱动
 * - 不直接驱动动画(由 inputDriver 消费 InputRouter 中的 signals)
 */

import type { AudioFeatures, InputSourceKind } from '../types'
import { AUDIO_SIGNAL_IDS, EMPTY_AUDIO_FEATURES } from '../types'
import { computeBands, computeVolume } from './fft'
import { BeatDetector, type BeatDetectorOptions } from './beatDetector'
import type { AudioAnalyzer } from './audioAnalyzer'

// ============================================================================
// 1. 配置
// ============================================================================

/**
 * FeatureExtractor 配置。
 *
 * - writeToRouter: 是否自动把特征写入 InputRouter(默认 true)
 * - beatOptions:   BeatDetector 配置
 */
export interface FeatureExtractorOptions {
  writeToRouter: boolean
  beatOptions: Partial<BeatDetectorOptions>
}

export const DEFAULT_FEATURE_OPTIONS: FeatureExtractorOptions = {
  writeToRouter: true,
  beatOptions: {},
}

// ============================================================================
// 2. FeatureExtractor 类
// ============================================================================

/**
 * 输入路由器接口(最小化,避免循环依赖)。
 */
export interface SignalWriter {
  setSignal: (id: string, value: number, source: InputSourceKind) => void
}

/**
 * 音频特征聚合器。
 *
 * 用法:
 *   const extractor = new FeatureExtractor(analyzer, inputRouter)
 *   // 每帧:
 *   const features = extractor.update()
 *   if (features.beat) {
 *     // 触发粒子爆炸
 *   }
 */
export class FeatureExtractor {
  private analyzer: AudioAnalyzer
  private router: SignalWriter | null
  private options: FeatureExtractorOptions
  private beatDetector: BeatDetector
  private lastFeatures: AudioFeatures = { ...EMPTY_AUDIO_FEATURES }

  constructor(
    analyzer: AudioAnalyzer,
    router: SignalWriter | null = null,
    options: Partial<FeatureExtractorOptions> = {},
  ) {
    this.analyzer = analyzer
    this.router = router
    this.options = { ...DEFAULT_FEATURE_OPTIONS, ...options }
    this.beatDetector = new BeatDetector(this.options.beatOptions)
  }

  /**
   * 每帧更新:读取音频数据,计算特征。
   *
   * @param now 当前时间戳(毫秒,默认 performance.now())
   * @returns 当前帧的 AudioFeatures(若 analyzer 未初始化,返回空特征)
   */
  update(now: number = typeof performance !== 'undefined' ? performance.now() : Date.now()): AudioFeatures {
    if (!this.analyzer.isInitialized) {
      return { ...EMPTY_AUDIO_FEATURES }
    }

    const fftData = this.analyzer.getFftData()
    const timeData = this.analyzer.getTimeData()
    if (!fftData || !timeData) {
      return { ...EMPTY_AUDIO_FEATURES }
    }

    // 计算频段
    const bands = computeBands(
      fftData,
      this.analyzer.getSampleRate(),
      this.analyzer.getFftSize(),
      this.analyzer.getBandRanges(),
    )

    // 计算音量
    const volume = computeVolume(timeData)

    // 检测 beat(用 bass 作为输入)
    const beatResult = this.beatDetector.detect(bands.bass, now)

    const features: AudioFeatures = {
      volume,
      bass: bands.bass,
      mid: bands.mid,
      high: bands.high,
      beat: beatResult.beat,
      bpm: beatResult.bpm,
    }

    // 写入 InputRouter
    if (this.options.writeToRouter && this.router) {
      this.router.setSignal(AUDIO_SIGNAL_IDS.volume, features.volume, 'AUDIO')
      this.router.setSignal(AUDIO_SIGNAL_IDS.bass, features.bass, 'AUDIO')
      this.router.setSignal(AUDIO_SIGNAL_IDS.mid, features.mid, 'AUDIO')
      this.router.setSignal(AUDIO_SIGNAL_IDS.high, features.high, 'AUDIO')
      this.router.setSignal(AUDIO_SIGNAL_IDS.beat, features.beat ? 1 : 0, 'AUDIO')
      this.router.setSignal(AUDIO_SIGNAL_IDS.bpm, features.bpm, 'AUDIO')
    }

    this.lastFeatures = features
    return features
  }

  /** 获取上一次的特征(不重新计算) */
  getLastFeatures(): AudioFeatures {
    return { ...this.lastFeatures }
  }

  /** 重置状态(包括 BeatDetector) */
  reset(): void {
    this.beatDetector.reset()
    this.lastFeatures = { ...EMPTY_AUDIO_FEATURES }
  }

  /** 更新配置 */
  setOptions(options: Partial<FeatureExtractorOptions>): void {
    this.options = { ...this.options, ...options }
    if (options.beatOptions) {
      this.beatDetector.setOptions(options.beatOptions)
    }
  }

  /** 获取 BeatDetector(用于高级配置) */
  getBeatDetector(): BeatDetector {
    return this.beatDetector
  }
}

// ============================================================================
// 3. 便捷工厂
// ============================================================================

/**
 * 创建一个不写入 router 的 FeatureExtractor(用于测试)。
 */
export function createLocalFeatureExtractor(analyzer: AudioAnalyzer): FeatureExtractor {
  return new FeatureExtractor(analyzer, null, { writeToRouter: false })
}
