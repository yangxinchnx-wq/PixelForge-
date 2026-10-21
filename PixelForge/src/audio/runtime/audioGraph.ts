/**
 * 音频节点图(Step 41.3)— 把 AudioTrack / MasterBus 映射为 Web Audio 节点链。
 *
 * 职责:
 * - 为每条轨道构建 `Gain → StereoPanner → [效果链] → 输出` 节点链
 * - 为主输出总线构建 `Gain → Panner → [限幅器] → [分析器] → destination`
 * - 提供参数热更新(改音量 / 声像时不需要重建节点)
 *
 * 设计原则:
 * - 只依赖 `types.ts` 中的接口,不直接引用浏览器全局对象,因此可注入 stub 测试
 * - 效果节点的构建顺序与效果链顺序一致
 * - 所有节点收集在 `nodes` 数组中,便于整体断开
 *
 * 数据流:
 *   AudioTrack + MasterBus
 *     ↓ createTrackNodes / createMasterNodes
 *   Web Audio 节点图
 *     ↓ audioSource 接入 AudioBufferSourceNode
 *   声音输出
 */

import type { AudioEffectNode, AudioTrack, MasterBus } from '../core/types'
import { clampGainDb, clampPan, dbToLinear } from '../core/units'
import { computeWetDryGains, generateImpulseResponse } from '../effects/reverb'
import type {
  AnalyserNodeLike,
  AudioContextLike,
  AudioNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  StereoPannerNodeLike,
} from './types'

// ============================================================================
// 1. 轨道节点链
// ============================================================================

/** 单条轨道的节点链 */
export interface TrackNodeChain {
  trackId: string
  /** 入口节点,接 AudioBufferSourceNode */
  input: GainNodeLike
  /** 轨道增益节点 */
  gain: GainNodeLike
  /** 声像节点 */
  panner: StereoPannerNodeLike
  /** 链尾节点,接到主输出总线入口 */
  tail: AudioNodeLike
  /** 链上全部节点(便于整体断开) */
  nodes: AudioNodeLike[]
}

/**
 * 构建单条轨道的节点链。
 *
 * 结构:`input(增益) → panner → [效果链] → tail`
 * 未启用 / 未知类型的效果会被跳过。
 */
export function createTrackNodes(
  ctx: AudioContextLike,
  track: AudioTrack,
): TrackNodeChain {
  const input = ctx.createGain()
  const panner = ctx.createStereoPanner()

  const nodes: AudioNodeLike[] = [input, panner]

  // 入口 → 声像
  input.connect(panner)

  // 依次接入各效果(每个效果可能引入串联或并联结构)
  let cursor: AudioNodeLike = panner
  for (const effect of track.effects) {
    if (!effect.enabled) continue
    const bundle = connectEffect(ctx, cursor, effect)
    cursor = bundle.tail
    nodes.push(...bundle.nodes)
  }

  applyTrackParamsTo({ input, panner }, track)

  return {
    trackId: track.id,
    input,
    gain: input,
    panner,
    tail: cursor,
    nodes,
  }
}

/**
 * 热更新轨道的增益与声像(不重建节点)。
 */
export function applyTrackParamsTo(
  nodes: { input: GainNodeLike; panner: StereoPannerNodeLike },
  track: AudioTrack,
): void {
  // 增益节点只承载纯增益,声像完全交给 StereoPannerNode。
  // 若在此处混入声像权重,会导致声像被应用两次(增益一次 + Panner 一次),
  // 居中位置会额外损失约 3dB。
  nodes.input.gain.value = dbToLinear(clampGainDb(track.gainDb))
  nodes.panner.pan.value = clampPan(track.pan)
}

/**
 * 把轨道链接到主输出总线入口。
 */
export function connectTrackToMaster(
  track: TrackNodeChain,
  master: MasterNodeChain,
): void {
  track.tail.connect(master.input)
}

/**
 * 断开并释放轨道链上的全部节点。
 */
export function disconnectTrackNodes(chain: TrackNodeChain): void {
  for (const node of chain.nodes) {
    try {
      node.disconnect()
    } catch {
      // 某些实现在已断开时抛错,忽略即可
    }
  }
}

// ============================================================================
// 2. 主输出总线
// ============================================================================

/** 主输出节点链 */
export interface MasterNodeChain {
  /** 入口,所有轨道接到这里 */
  input: GainNodeLike
  /** 总线增益 */
  gain: GainNodeLike
  /** 总线声像 */
  panner: StereoPannerNodeLike
  /** 限幅器,未启用时为 null */
  limiter: DynamicsCompressorNodeLike | null
  /** 分析器,未请求时为 null */
  analyser: AnalyserNodeLike | null
  /** 链尾(接 destination) */
  tail: AudioNodeLike
  /** 链上全部节点 */
  nodes: AudioNodeLike[]
}

/** 主输出构建选项 */
export interface MasterNodesOptions {
  /** 是否挂载分析器(供 Audio Reactive 使用) */
  withAnalyser?: boolean
  /** 分析器 FFT 长度,需为 2 的幂 */
  fftSize?: number
}

/**
 * 构建主输出总线节点链。
 *
 * 结构:`input(增益) → panner → [限幅器] → [分析器] → destination`
 */
export function createMasterNodes(
  ctx: AudioContextLike,
  master: MasterBus,
  options: MasterNodesOptions = {},
): MasterNodeChain {
  const input = ctx.createGain()
  const panner = ctx.createStereoPanner()

  const nodes: AudioNodeLike[] = [input, panner]
  input.connect(panner)

  let cursor: AudioNodeLike = panner

  let limiter: DynamicsCompressorNodeLike | null = null
  if (master.limiterEnabled) {
    limiter = ctx.createDynamicsCompressor()
    // 限幅器:极低阈值 + 极大比值 + 极快启动,等效于硬天花板
    limiter.threshold.value = master.ceilingDb
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.05
    cursor.connect(limiter)
    cursor = limiter
    nodes.push(limiter)
  }

  let analyser: AnalyserNodeLike | null = null
  if (options.withAnalyser) {
    analyser = ctx.createAnalyser()
    if (options.fftSize && options.fftSize >= 32) {
      analyser.fftSize = options.fftSize
    }
    cursor.connect(analyser)
    cursor = analyser
    nodes.push(analyser)
  }

  cursor.connect(ctx.destination)

  input.gain.value = dbToLinear(master.gainDb)
  panner.pan.value = clampPan(master.pan)

  return { input, gain: input, panner, limiter, analyser, tail: cursor, nodes }
}

/**
 * 热更新主输出总线的增益与声像。
 */
export function applyMasterParamsTo(chain: MasterNodeChain, master: MasterBus): void {
  chain.input.gain.value = dbToLinear(master.gainDb)
  chain.panner.pan.value = clampPan(master.pan)
}

/**
 * 断开主输出链上的全部节点。
 */
export function disconnectMasterNodes(chain: MasterNodeChain): void {
  for (const node of chain.nodes) {
    try {
      node.disconnect()
    } catch {
      // 同上,忽略重复断开
    }
  }
}

// ============================================================================
// 3. 效果节点
// ============================================================================

/** 效果接入结果 */
export interface EffectNodeBundle {
  /** 链尾节点,外部继续往后接即可 */
  tail: AudioNodeLike
  /** 本效果创建的全部节点 */
  nodes: AudioNodeLike[]
}

/**
 * 把一个效果接到 source 后面,返回链尾与新建节点。
 *
 * 大多数效果是**串联**(EQ / 压缩器 / 增益),但混响是**并联**:
 * 干声与湿声各走一路再汇合。若把混响简单串联,干声会被湿声替换,
 * `mix = 0`(语义上"全干")反而会导致该轨静音。
 *
 * @param ctx 音频上下文
 * @param source 入口节点
 * @param effect 效果定义
 * @returns 链尾节点与新建节点列表
 */
export function connectEffect(
  ctx: AudioContextLike,
  source: AudioNodeLike,
  effect: AudioEffectNode,
): EffectNodeBundle {
  switch (effect.type) {
    case 'eq':
      return connectSeries(source, createEqNodes(ctx, effect))
    case 'compressor':
      return connectSeries(source, createCompressorNodes(ctx, effect))
    case 'reverb':
      return connectReverbParallel(ctx, source, effect)
    case 'gain':
      return connectSeries(source, createGainEffectNodes(ctx, effect))
    default:
      // 未知类型:直接旁路,不中断整条链
      return { tail: source, nodes: [] }
  }
}

/** 把一串节点依次串联到 source 上 */
function connectSeries(
  source: AudioNodeLike,
  nodes: AudioNodeLike[],
): EffectNodeBundle {
  if (nodes.length === 0) return { tail: source, nodes: [] }
  let cursor = source
  for (const node of nodes) {
    cursor.connect(node)
    cursor = node
  }
  return { tail: cursor, nodes }
}

/** EQ:三个双二阶滤波器串联(低架 / 峰值 / 高架) */
function createEqNodes(ctx: AudioContextLike, effect: AudioEffectNode): AudioNodeLike[] {
  const p = effect.params
  const result: AudioNodeLike[] = []

  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = p.lowFreqHz ?? 250
  low.gain.value = p.lowGainDb ?? 0
  result.push(low)

  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  // 中频中心取两个分频点的几何平均
  const lo = p.lowFreqHz ?? 250
  const hi = p.highFreqHz ?? 4000
  mid.frequency.value = Math.sqrt(Math.max(1, lo) * Math.max(1, hi))
  mid.gain.value = p.midGainDb ?? 0
  mid.Q.value = 1
  result.push(mid)

  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = hi
  high.gain.value = p.highGainDb ?? 0
  result.push(high)

  return result
}

/** 压缩器:单个 DynamicsCompressorNode */
function createCompressorNodes(
  ctx: AudioContextLike,
  effect: AudioEffectNode,
): AudioNodeLike[] {
  const p = effect.params
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = p.thresholdDb ?? -18
  comp.ratio.value = p.ratio ?? 4
  comp.attack.value = (p.attackMs ?? 10) / 1000
  comp.release.value = (p.releaseMs ?? 250) / 1000
  comp.knee.value = p.kneeDb ?? 6
  return [comp]
}

/**
 * 混响:干湿并联。
 *
 * ```
 *        ┌─→ dry ──────────┐
 * source ┤                 ├─→ merge(汇合) ─→ 后续
 *        └─→ convolver → wet┘
 * ```
 *
 * 干湿增益按等功率分配(computeWetDryGains),保证从全干到全湿的过渡中
 * 总功率基本恒定,且 mix=0 时湿声完全静音、只剩干声。
 */
function connectReverbParallel(
  ctx: AudioContextLike,
  source: AudioNodeLike,
  effect: AudioEffectNode,
): EffectNodeBundle {
  const p = effect.params

  const merge = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const convolver = ctx.createConvolver()

  // 干湿比(等功率律)
  const mix = Math.min(1, Math.max(0, p.mix ?? 0.25))
  const gains = computeWetDryGains(mix)
  dry.gain.value = gains.dry
  wet.gain.value = gains.wet

  // 写入脉冲响应
  try {
    const ir = generateImpulseResponse(
      {
        decaySeconds: p.decaySeconds ?? 2,
        preDelayMs: p.preDelayMs ?? 20,
        damping: p.damping ?? 0.5,
        mix,
        roomSize: p.roomSize ?? 0.5,
      },
      ctx.sampleRate,
    )
    if (ir.length > 0) {
      const buffer = ctx.createBuffer(2, ir.length, ctx.sampleRate)
      buffer.getChannelData(0).set(ir)
      buffer.getChannelData(1).set(ir)
      convolver.buffer = buffer
    }
  } catch {
    // IR 生成失败时保留空 convolver(湿声静音),不中断整条链
  }

  // 干声支路
  source.connect(dry)
  dry.connect(merge)
  // 湿声支路
  source.connect(convolver)
  convolver.connect(wet)
  wet.connect(merge)

  return { tail: merge, nodes: [merge, dry, wet, convolver] }
}

/** 增益效果:单个 GainNode */
function createGainEffectNodes(
  ctx: AudioContextLike,
  effect: AudioEffectNode,
): AudioNodeLike[] {
  const g = ctx.createGain()
  g.gain.value = dbToLinear(effect.params.gainDb ?? 0)
  return [g]
}
