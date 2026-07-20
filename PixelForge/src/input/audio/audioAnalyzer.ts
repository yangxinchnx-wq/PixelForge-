/**
 * Audio Analyzer(Step 30.6)— 麦克风音频采集与 Web Audio API 接入。
 *
 * 职责:
 * - init():    申请麦克风权限,创建 AudioContext + AnalyserNode
 * - start():   启动采集
 * - stop():    停止采集,释放资源
 * - getFftData():  获取当前 FFT 频域数据(Uint8Array, 0-255)
 * - getTimeData():获取当前时域数据(Uint8Array, 0-255)
 *
 * 与 spec §5-6 对齐:
 *   navigator.mediaDevices.getUserMedia({ audio: true })
 *     ↓
 *   AudioContext.createMediaStreamSource(stream)
 *     ↓
 *   AnalyserNode
 *     ↓
 *   getByteFrequencyData / getByteTimeDomainData
 *
 * 设计:
 * - 浏览器 API 依赖延迟到运行时(测试环境无 navigator / AudioContext)
 * - 不直接驱动 InputRouter(由 featureExtractor 消费)
 * - 提供 sampleRate / fftSize 等配置,供 fft.ts 使用
 */

import type { BandRanges } from '../types'
import { DEFAULT_BAND_RANGES } from '../types'

// ============================================================================
// 1. 配置
// ============================================================================

/**
 * AudioAnalyzer 配置。
 *
 * - fftSize:       FFT 大小(必须是 2 的幂,默认 2048)
 * - smoothing:     频谱平滑系数(0-1,默认 0.8)
 * - bandRanges:    频段范围(默认 DEFAULT_BAND_RANGES)
 */
export interface AudioAnalyzerOptions {
  fftSize: number
  smoothing: number
  bandRanges: BandRanges
}

export const DEFAULT_AUDIO_OPTIONS: AudioAnalyzerOptions = {
  fftSize: 2048,
  smoothing: 0.8,
  bandRanges: DEFAULT_BAND_RANGES,
}

// ============================================================================
// 2. 结构化类型(避免直接依赖 DOM 类型,便于测试)
// ============================================================================

/**
 * AudioContext 最小接口(结构化类型)。
 *
 * 浏览器的 AudioContext 实现此接口,测试时可 mock。
 */
export interface AudioContextLike {
  readonly sampleRate: number
  state: 'suspended' | 'running' | 'closed'
  createMediaStreamSource: (stream: MediaStream) => MediaStreamAudioSourceNodeLike
  createAnalyser: () => AnalyserNodeLike
  close: () => Promise<void>
  resume: () => Promise<void>
}

export interface MediaStreamAudioSourceNodeLike {
  connect: (node: AudioNodeLike) => void
  disconnect: () => void
}

export interface AudioNodeLike {
  connect: (node: AudioNodeLike) => void
  disconnect: () => void
}

export interface AnalyserNodeLike extends AudioNodeLike {
  fftSize: number
  frequencyBinCount: number
  smoothingTimeConstant: number
  getByteFrequencyData: (array: Uint8Array) => void
  getByteTimeDomainData: (array: Uint8Array) => void
}

/**
 * MediaDevices 最小接口(结构化类型)。
 */
export interface MediaDevicesLike {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
}

// ============================================================================
// 3. AudioAnalyzer 类
// ============================================================================

/**
 * 音频采集器。
 *
 * 用法:
 *   const analyzer = new AudioAnalyzer()
 *   await analyzer.init()
 *   analyzer.start()
 *   // 每帧:
 *   const fft = analyzer.getFftData()
 *   const time = analyzer.getTimeData()
 */
export class AudioAnalyzer {
  private options: AudioAnalyzerOptions
  private context: AudioContextLike | null = null
  private analyser: AnalyserNodeLike | null = null
  private source: MediaStreamAudioSourceNodeLike | null = null
  private stream: MediaStream | null = null
  private fftBuffer: Uint8Array | null = null
  private timeBuffer: Uint8Array | null = null
  private started: boolean = false

  constructor(options: Partial<AudioAnalyzerOptions> = {}) {
    this.options = { ...DEFAULT_AUDIO_OPTIONS, ...options }
  }

  /**
   * 初始化:申请麦克风权限,创建 AudioContext + AnalyserNode。
   *
   * @throws 若浏览器不支持 / 用户拒绝授权
   */
  async init(): Promise<void> {
    if (this.context) return // 已初始化

    const mediaDevices = this.getMediaDevices()
    if (!mediaDevices) {
      throw new Error('浏览器不支持 MediaDevices API')
    }

    // 申请麦克风
    this.stream = await mediaDevices.getUserMedia({ audio: true, video: false })

    // 创建 AudioContext
    this.context = this.createAudioContext()
    if (!this.context) {
      throw new Error('浏览器不支持 AudioContext')
    }

    // 创建 AnalyserNode
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = this.options.fftSize
    this.analyser.smoothingTimeConstant = this.options.smoothing

    // 连接:source → analyser
    this.source = this.context.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)

    // 预分配缓冲区
    this.fftBuffer = new Uint8Array(this.analyser.frequencyBinCount)
    this.timeBuffer = new Uint8Array(this.analyser.fftSize)
  }

  /**
   * 启动采集(若 context 处于 suspended 状态,resume 它)。
   */
  async start(): Promise<void> {
    if (!this.context || !this.analyser) {
      throw new Error('AudioAnalyzer 未初始化,请先调用 init()')
    }
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }
    this.started = true
  }

  /**
   * 停止采集(停止所有 track,但不关闭 context,便于重启)。
   */
  stop(): void {
    this.started = false
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
    }
  }

  /**
   * 完全销毁(关闭 context,释放所有资源)。
   */
  async dispose(): Promise<void> {
    this.stop()
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        // ignore
      }
      this.source = null
    }
    if (this.context) {
      try {
        await this.context.close()
      } catch {
        // ignore
      }
      this.context = null
    }
    this.analyser = null
    this.stream = null
    this.fftBuffer = null
    this.timeBuffer = null
  }

  // —— 数据读取 ——

  /**
   * 获取当前 FFT 频域数据。
   *
   * @returns Uint8Array(0-255),或 null(未初始化)
   */
  getFftData(): Uint8Array | null {
    if (!this.analyser || !this.fftBuffer) return null
    this.analyser.getByteFrequencyData(this.fftBuffer)
    return this.fftBuffer
  }

  /**
   * 获取当前时域数据(波形)。
   *
   * @returns Uint8Array(0-255,中心 128),或 null(未初始化)
   */
  getTimeData(): Uint8Array | null {
    if (!this.analyser || !this.timeBuffer) return null
    this.analyser.getByteTimeDomainData(this.timeBuffer)
    return this.timeBuffer
  }

  // —— 元信息 ——

  /** 采样率(Hz) */
  getSampleRate(): number {
    return this.context?.sampleRate ?? 44100
  }

  /** FFT 大小 */
  getFftSize(): number {
    return this.options.fftSize
  }

  /** frequencyBinCount(= fftSize / 2) */
  getFrequencyBinCount(): number {
    return this.options.fftSize / 2
  }

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this.context !== null && this.analyser !== null
  }

  /** 是否正在采集 */
  get isRunning(): boolean {
    return this.started && this.context?.state === 'running'
  }

  /** 频段范围配置 */
  getBandRanges(): BandRanges {
    return this.options.bandRanges
  }

  // —— 浏览器 API 注入点(便于测试 mock)——

  /**
   * 获取 MediaDevices(可被子类 / 测试覆盖)。
   *
   * 默认实现:从 navigator.mediaDevices 读取。
   */
  protected getMediaDevices(): MediaDevicesLike | null {
    if (typeof navigator === 'undefined') return null
    if (!navigator.mediaDevices) return null
    return navigator.mediaDevices
  }

  /**
   * 创建 AudioContext(可被子类 / 测试覆盖)。
   *
   * 默认实现:new AudioContext()
   */
  protected createAudioContext(): AudioContextLike | null {
    if (typeof AudioContext === 'undefined') return null
    return new AudioContext() as unknown as AudioContextLike
  }
}
