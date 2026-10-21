/**
 * Web Audio 最小接口层(Step 41.3)— 运行时层依赖的类型契约。
 *
 * 职责:
 * - 定义运行时层所需的 Web Audio API 子集
 * - 让 AudioContext 可以被注入和替换,从而在 vitest(Node 环境,无 Web Audio)中测试
 *
 * 设计原则:
 * - 只声明本模块真正用到的成员,不追求完整覆盖 Web Audio 规范
 * - 真实 `AudioContext` 结构上满足这些接口,可直接传入无需适配层
 * - 类型名统一加 Like 后缀,与浏览器原生类型区分
 *
 * 数据流:
 *   createAudioEngine(factory) → AudioContextLike
 *     ↓ audioGraph 构建节点图
 *   GainNode / StereoPanner / Effects → Master → destination
 */

// ============================================================================
// 1. 基础
// ============================================================================

/** AudioContext 状态 */
export type AudioContextStateLike = 'suspended' | 'running' | 'closed'

/** AudioParam 子集 */
export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, startTime: number): AudioParamLike
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike
}

/** AudioNode 子集 */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void
  disconnect(): void
}

// ============================================================================
// 2. 各类节点
// ============================================================================

/** 增益节点 */
export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

/** 立体声声像节点 */
export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike
}

/** 双二阶滤波器(承载 EQ) */
export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  gain: AudioParamLike
  Q: AudioParamLike
}

/** 动态压缩器 */
export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike
  knee: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
}

/** 卷积混响 */
export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: unknown
}

/** 分析节点(时域 / 频域数据) */
export interface AnalyserNodeLike extends AudioNodeLike {
  fftSize: number
  readonly frequencyBinCount: number
  getFloatTimeDomainData(array: Float32Array): void
  getFloatFrequencyData(array: Float32Array): void
}

/** 音频缓冲源 */
export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: unknown
  loop: boolean
  onended: (() => void) | null
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
}

/** 解码后的音频缓冲 */
export interface AudioBufferLike {
  readonly duration: number
  readonly sampleRate: number
  readonly length: number
  readonly numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

// ============================================================================
// 3. 上下文
// ============================================================================

/** AudioContext 子集 */
export interface AudioContextLike {
  readonly state: AudioContextStateLike
  readonly sampleRate: number
  readonly currentTime: number
  readonly destination: AudioNodeLike

  resume(): Promise<void>
  suspend(): Promise<void>
  close(): Promise<void>

  createGain(): GainNodeLike
  createStereoPanner(): StereoPannerNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createDynamicsCompressor(): DynamicsCompressorNodeLike
  createConvolver(): ConvolverNodeLike
  createAnalyser(): AnalyserNodeLike
  createBufferSource(): AudioBufferSourceNodeLike
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBufferLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
}

/** AudioContext 工厂(用于依赖注入) */
export type AudioContextFactory = () => AudioContextLike | null

// ============================================================================
// 4. 默认工厂
// ============================================================================

/**
 * 默认工厂:使用浏览器全局 AudioContext。
 *
 * 环境不存在时返回 null(而不是抛异常),交由引擎降级处理。
 */
export function defaultAudioContextFactory(): AudioContextLike | null {
  const ctor = (globalThis as { AudioContext?: new () => AudioContextLike })
    .AudioContext
  if (typeof ctor !== 'function') return null
  try {
    return new ctor()
  } catch {
    return null
  }
}
