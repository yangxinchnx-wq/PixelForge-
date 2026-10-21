/**
 * Web Audio 测试替身(Step 41.3 配套)— Fake 实现供单元测试与集成测试使用。
 *
 * 用途:
 * - vitest 运行在 Node 环境,没有 AudioContext,运行时层无法直接实例化
 * - 本文件提供满足 `types.ts` 契约的 Fake 实现,并记录所有连接关系以便断言
 *
 * 说明:
 * - 这不是生产代码路径的一部分,但作为可复用测试夹具随模块一起发布,
 *   方便后续 Step(41.4 Store / 41.7 驱动画面 / 41.8 导出)编写集成测试
 * - 文件名不以 .test.ts 结尾,不会被 vitest 当作测试收集
 *
 * 用法:
 *   const ctx = new FakeAudioContext({ sampleRate: 48000 })
 *   const engine = createAudioEngine(() => ctx)
 *   expect(ctx.connectionCount).toBeGreaterThan(0)
 */

import type {
  AnalyserNodeLike,
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioContextStateLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  ConvolverNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from './types'

// ============================================================================
// 1. 基础组件
// ============================================================================

/** Fake AudioParam */
export class FakeAudioParam implements AudioParamLike {
  value: number
  /** 记录的参数自动化调用 */
  readonly calls: Array<{ method: string; value: number; time: number }> = []

  constructor(value = 0) {
    this.value = value
  }

  setValueAtTime(value: number, startTime: number): this {
    this.value = value
    this.calls.push({ method: 'setValueAtTime', value, time: startTime })
    return this
  }

  linearRampToValueAtTime(value: number, endTime: number): this {
    this.value = value
    this.calls.push({ method: 'linearRampToValueAtTime', value, time: endTime })
    return this
  }

  exponentialRampToValueAtTime(value: number, endTime: number): this {
    this.value = value
    this.calls.push({ method: 'exponentialRampToValueAtTime', value, time: endTime })
    return this
  }
}

/** 节点类型标记 */
export type FakeNodeKind =
  | 'gain'
  | 'panner'
  | 'biquad'
  | 'compressor'
  | 'convolver'
  | 'analyser'
  | 'bufferSource'
  | 'destination'

/** Fake AudioNode 基类 */
export class FakeAudioNode implements AudioNodeLike {
  readonly id: number
  readonly kind: FakeNodeKind
  /** 已连接的目标节点 */
  readonly outputs: FakeAudioNode[] = []
  /** 是否已断开 */
  disconnected = false
  /** 断开次数(用于验证幂等) */
  disconnectCount = 0

  constructor(kind: FakeNodeKind, id: number) {
    this.kind = kind
    this.id = id
  }

  connect(destination: AudioNodeLike): void {
    this.outputs.push(destination as FakeAudioNode)
  }

  disconnect(): void {
    this.disconnected = true
    this.disconnectCount++
    this.outputs.length = 0
  }
}

// ============================================================================
// 2. 各类节点
// ============================================================================

export class FakeGainNode extends FakeAudioNode implements GainNodeLike {
  gain = new FakeAudioParam(1)
  constructor(id: number) {
    super('gain', id)
  }
}

export class FakeStereoPannerNode extends FakeAudioNode implements StereoPannerNodeLike {
  pan = new FakeAudioParam(0)
  constructor(id: number) {
    super('panner', id)
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode implements BiquadFilterNodeLike {
  type = 'lowpass'
  frequency = new FakeAudioParam(350)
  gain = new FakeAudioParam(0)
  Q = new FakeAudioParam(1)
  constructor(id: number) {
    super('biquad', id)
  }
}

export class FakeDynamicsCompressorNode
  extends FakeAudioNode
  implements DynamicsCompressorNodeLike
{
  threshold = new FakeAudioParam(-24)
  knee = new FakeAudioParam(30)
  ratio = new FakeAudioParam(12)
  attack = new FakeAudioParam(0.003)
  release = new FakeAudioParam(0.25)
  constructor(id: number) {
    super('compressor', id)
  }
}

export class FakeConvolverNode extends FakeAudioNode implements ConvolverNodeLike {
  buffer: unknown = null
  constructor(id: number) {
    super('convolver', id)
  }
}

export class FakeAnalyserNode extends FakeAudioNode implements AnalyserNodeLike {
  fftSize = 2048
  /** 供测试注入的时域数据 */
  timeDomainData: Float32Array = new Float32Array(1024)
  /** 供测试注入的频域数据 */
  frequencyData: Float32Array = new Float32Array(1024)

  constructor(id: number) {
    super('analyser', id)
  }

  get frequencyBinCount(): number {
    return this.fftSize / 2
  }

  getFloatTimeDomainData(array: Float32Array): void {
    array.set(this.timeDomainData.subarray(0, array.length))
  }

  getFloatFrequencyData(array: Float32Array): void {
    array.set(this.frequencyData.subarray(0, array.length))
  }
}

export class FakeAudioBufferSourceNode
  extends FakeAudioNode
  implements AudioBufferSourceNodeLike
{
  buffer: unknown = null
  loop = false
  onended: (() => void) | null = null
  /** start 调用记录 */
  startArgs: { when?: number; offset?: number; duration?: number } | null = null
  /** stop 调用次数 */
  stopCount = 0

  constructor(id: number) {
    super('bufferSource', id)
  }

  start(when?: number, offset?: number, duration?: number): void {
    this.startArgs = { when, offset, duration }
  }

  stop(): void {
    this.stopCount++
  }
}

export class FakeAudioBuffer implements AudioBufferLike {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  private readonly channels: Float32Array[]

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = Math.max(1, numberOfChannels)
    this.length = Math.max(0, length)
    this.sampleRate = sampleRate
    this.channels = []
    for (let i = 0; i < this.numberOfChannels; i++) {
      this.channels.push(new Float32Array(this.length))
    }
  }

  get duration(): number {
    return this.sampleRate > 0 ? this.length / this.sampleRate : 0
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[Math.max(0, Math.min(this.numberOfChannels - 1, channel))]
  }
}

// ============================================================================
// 3. 上下文
// ============================================================================

/** Fake 上下文构造选项 */
export interface FakeAudioContextOptions {
  sampleRate?: number
  /** 初始状态,默认 suspended(模拟自动播放策略) */
  initialState?: AudioContextStateLike
  /** resume 是否成功,默认 true */
  resumeSucceeds?: boolean
  /** resume 后是否真的转为 running,默认 true */
  resumeTransitions?: boolean
  /** decodeAudioData 是否成功,默认 true */
  decodeSucceeds?: boolean
}

/** Fake AudioContext */
export class FakeAudioContext implements AudioContextLike {
  readonly sampleRate: number
  readonly destination: FakeAudioNode
  private _state: AudioContextStateLike
  private _currentTime = 0
  private _nodeCounter = 0

  /** 已创建的全部节点(按创建顺序) */
  readonly createdNodes: FakeAudioNode[] = []
  /**
   * resume 是否成功。
   *
   * 测试可动态修改,用于模拟"用户手势之后浏览器才允许 resume"这一时序。
   */
  resumeSucceeds: boolean
  /** resume 成功后是否真的把状态切换为 running */
  resumeTransitions: boolean

  /** resume 调用次数 */
  resumeCount = 0
  /** suspend 调用次数 */
  suspendCount = 0
  /** close 调用次数 */
  closeCount = 0
  /** decodeAudioData 调用次数 */
  decodeCount = 0

  private readonly options: Required<FakeAudioContextOptions>

  constructor(options: FakeAudioContextOptions = {}) {
    this.options = {
      sampleRate: options.sampleRate ?? 48000,
      initialState: options.initialState ?? 'suspended',
      resumeSucceeds: options.resumeSucceeds ?? true,
      resumeTransitions: options.resumeTransitions ?? true,
      decodeSucceeds: options.decodeSucceeds ?? true,
    }
    this.sampleRate = this.options.sampleRate
    this._state = this.options.initialState
    this.resumeSucceeds = this.options.resumeSucceeds
    this.resumeTransitions = this.options.resumeTransitions
    this.destination = new FakeAudioNode('destination', this._nodeCounter++)
  }

  get state(): AudioContextStateLike {
    return this._state
  }

  get currentTime(): number {
    return this._currentTime
  }

  /** 测试辅助:推进上下文时间 */
  advanceTime(seconds: number): void {
    this._currentTime += seconds
  }

  /** 测试辅助:强制设置状态 */
  setState(state: AudioContextStateLike): void {
    this._state = state
  }

  async resume(): Promise<void> {
    this.resumeCount++
    if (!this.resumeSucceeds) {
      throw new Error('resume rejected: no user gesture')
    }
    if (this.resumeTransitions) {
      this._state = 'running'
    }
  }

  async suspend(): Promise<void> {
    this.suspendCount++
    this._state = 'suspended'
  }

  async close(): Promise<void> {
    this.closeCount++
    this._state = 'closed'
  }

  private track<T extends FakeAudioNode>(node: T): T {
    this.createdNodes.push(node)
    return node
  }

  createGain(): GainNodeLike {
    return this.track(new FakeGainNode(this._nodeCounter++))
  }

  createStereoPanner(): StereoPannerNodeLike {
    return this.track(new FakeStereoPannerNode(this._nodeCounter++))
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    return this.track(new FakeBiquadFilterNode(this._nodeCounter++))
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    return this.track(new FakeDynamicsCompressorNode(this._nodeCounter++))
  }

  createConvolver(): ConvolverNodeLike {
    return this.track(new FakeConvolverNode(this._nodeCounter++))
  }

  createAnalyser(): AnalyserNodeLike {
    return this.track(new FakeAnalyserNode(this._nodeCounter++))
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    return this.track(new FakeAudioBufferSourceNode(this._nodeCounter++))
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number,
  ): AudioBufferLike {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate)
  }

  async decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike> {
    this.decodeCount++
    if (!this.options.decodeSucceeds) {
      throw new Error('decode failed')
    }
    // Fake 解码:按字节数伪造一个时长,便于断言
    const length = Math.max(1, Math.floor(data.byteLength / 4))
    return new FakeAudioBuffer(2, length, this.sampleRate)
  }

  /** 测试辅助:统计某种节点被创建了多少次 */
  countNodesOfKind(kind: FakeNodeKind): number {
    return this.createdNodes.filter((n) => n.kind === kind).length
  }

  /** 测试辅助:总连接数 */
  get connectionCount(): number {
    return this.createdNodes.reduce((sum, n) => sum + n.outputs.length, 0)
  }
}
