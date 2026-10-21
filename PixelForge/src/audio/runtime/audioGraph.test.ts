import { describe, expect, it } from 'vitest'

import {
  applyMasterParamsTo,
  applyTrackParamsTo,
  connectEffect,
  connectTrackToMaster,
  createMasterNodes,
  createTrackNodes,
  disconnectMasterNodes,
  disconnectTrackNodes,
} from '@/audio/runtime/audioGraph'
import {
  FakeAudioContext,
  FakeAudioNode,
  FakeConvolverNode,
  FakeDynamicsCompressorNode,
} from '@/audio/runtime/fakeAudioContext'
import type { AudioEffectNode, AudioTrack, MasterBus } from '@/audio/core/types'

function makeTrack(overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    id: 't1',
    name: 'Track 1',
    assetId: 'a1',
    startTimeUs: 0n,
    inPointUs: 0n,
    outPointUs: 10_000_000n,
    gainDb: 0,
    pan: 0,
    muted: false,
    soloed: false,
    effects: [],
    ...overrides,
  }
}

function makeMaster(overrides: Partial<MasterBus> = {}): MasterBus {
  return {
    gainDb: 0,
    pan: 0,
    limiterEnabled: false,
    ceilingDb: -1,
    effects: [],
    ...overrides,
  }
}

function makeEffect(type: AudioEffectNode['type'], params: Record<string, number> = {}): AudioEffectNode {
  return { id: `fx-${type}`, type, enabled: true, params }
}

/**
 * 取混响并联支路的两个增益(干声 / 湿声)。
 *
 * 汇合节点(merge)本身也是 GainNode,但它不属于干湿支路,需要排除。
 */
function branchGains(bundle: { tail: unknown; nodes: unknown[] }): number[] {
  return bundle.nodes
    .filter((n) => (n as { kind: string }).kind === 'gain')
    .filter((n) => n !== bundle.tail)
    .map((n) => (n as unknown as { gain: { value: number } }).gain.value)
}

/**
 * 把接口类型还原为 Fake 实现,以便断言连接关系。
 *
 * 运行时层对外只暴露接口(不含 outputs / disconnected 等测试字段),
 * 测试需要访问这些字段时必须显式转换。
 */
function asFake(node: unknown): FakeAudioNode {
  return node as unknown as FakeAudioNode
}

// ============================================================================
// createTrackNodes 测试
// ============================================================================

describe('createTrackNodes', () => {
  it('应创建入口增益与声像节点', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack())
    expect(chain.input).toBeDefined()
    expect(chain.panner).toBeDefined()
    expect(chain.trackId).toBe('t1')
  })

  it('入口应连接到声像节点', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack())
    expect(asFake(chain.input).outputs).toContain(chain.panner)
  })

  it('无效果时链尾应为声像节点', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack())
    expect(chain.tail).toBe(chain.panner)
  })

  it('应应用轨道增益与声像', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack({ gainDb: 6, pan: -1 }))
    expect(chain.panner.pan.value).toBe(-1)
    // 极左时左声道增益为 dbToLinear(6)
    expect(chain.input.gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 6)
  })

  it('独奏/静音状态不应影响节点构建', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack({ muted: true }))
    expect(chain.nodes.length).toBe(2)
  })

  it('应保持 trackId 与输入一致', () => {
    const ctx = new FakeAudioContext()
    expect(createTrackNodes(ctx, makeTrack({ id: 'zzz' })).trackId).toBe('zzz')
  })
})

// ============================================================================
// 效果节点测试
// ============================================================================

describe('connectEffect', () => {
  it('EQ 应创建三个滤波器', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('eq'))
    expect(bundle.nodes).toHaveLength(3)
    expect(ctx.countNodesOfKind('biquad')).toBe(3)
  })

  it('EQ 应串联:入口连到第一个滤波器', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('eq'))
    expect(asFake(source).outputs).toContain(bundle.nodes[0])
  })

  it('压缩器应创建一个 DynamicsCompressor', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('compressor'))
    expect(bundle.nodes).toHaveLength(1)
    expect(ctx.countNodesOfKind('compressor')).toBe(1)
  })

  it('压缩器参数应写入节点', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(
      ctx,
      source,
      makeEffect('compressor', { thresholdDb: -30, ratio: 8, attackMs: 5, releaseMs: 300 }),
    )
    const comp = bundle.nodes[0] as unknown as FakeDynamicsCompressorNode
    expect(comp.threshold.value).toBe(-30)
    expect(comp.ratio.value).toBe(8)
    expect(comp.attack.value).toBeCloseTo(0.005, 10)
    expect(comp.release.value).toBeCloseTo(0.3, 10)
  })

  it('增益效果应创建一个增益节点并写入增益', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('gain', { gainDb: 6 }))
    expect(bundle.nodes).toHaveLength(1)
    expect((bundle.nodes[0] as unknown as { gain: { value: number } }).gain.value).toBeCloseTo(
      Math.pow(10, 6 / 20),
      6,
    )
  })

  it('未知类型应旁路而不是抛异常', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('bogus' as AudioEffectNode['type']))
    expect(bundle.nodes).toEqual([])
    expect(bundle.tail).toBe(source)
  })
})

describe('混响的干湿并联结构', () => {
  it('应创建卷积器、汇合节点与两个增益节点', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1 }))
    expect(ctx.countNodesOfKind('convolver')).toBe(1)
    // merge + dry + wet + convolver
    expect(bundle.nodes).toHaveLength(4)
  })

  it('入口应分出干湿两路(并联而非串联)', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1 }))
    // 入口连出 2 条支路:干声与湿声
    expect(asFake(source).outputs).toHaveLength(2)
  })

  it('两路都应汇入同一个汇合节点', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1 }))
    const merge = bundle.tail
    expect(asFake(merge).outputs).toHaveLength(0)
    // 干声与湿声各自连向 merge
    const feeding = ctx.createdNodes.filter((n) =>
      n.outputs.some((o) => o === merge),
    )
    expect(feeding).toHaveLength(2)
  })

  it('mix=0 时应全干:湿声增益为 0,干声增益为 1', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1, mix: 0 }))
    const gains = branchGains(bundle)
    // dry=1,wet=0
    expect(gains.some((g) => g < 1e-9)).toBe(true)
    expect(gains.some((g) => Math.abs(g - 1) < 1e-9)).toBe(true)
  })

  it('mix=1 时应全湿:干声增益为 0,湿声增益为 1', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1, mix: 1 }))
    const gains = branchGains(bundle)
    expect(gains.some((g) => g < 1e-9)).toBe(true)
    expect(gains.some((g) => Math.abs(g - 1) < 1e-9)).toBe(true)
  })

  it('干湿增益应满足等功率(平方和为 1)', () => {
    const ctx = new FakeAudioContext()
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1, mix: 0.25 }))
    const power = branchGains(bundle).reduce((sum, g) => sum + g * g, 0)
    expect(power).toBeCloseTo(1, 6)
  })

  it('应把 IR 写入卷积器缓冲', () => {
    const ctx = new FakeAudioContext({ sampleRate: 48000 })
    const source = ctx.createGain()
    const bundle = connectEffect(ctx, source, makeEffect('reverb', { decaySeconds: 1 }))
    const conv = asFake(
      bundle.nodes.find((n) => (n as unknown as { kind: string }).kind === 'convolver'),
    ) as unknown as FakeConvolverNode
    expect(conv.buffer).not.toBeNull()
  })
})

describe('createTrackNodes 与效果链串联', () => {
  it('多个效果应依次串联', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack({
      effects: [makeEffect('eq'), makeEffect('compressor')],
    })
    const chain = createTrackNodes(ctx, track)
    // 入口 + 声像 + EQ 三个 + 压缩器一个 = 6
    expect(chain.nodes).toHaveLength(6)
    // 声像之后应为第一个 EQ 节点
    expect(asFake(chain.panner).outputs.length).toBe(1)
  })

  it('禁用的效果应被跳过', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack({
      effects: [{ ...makeEffect('eq'), enabled: false }, makeEffect('compressor')],
    })
    const chain = createTrackNodes(ctx, track)
    // 入口 + 声像 + 压缩器 = 3(EQ 被跳过)
    expect(chain.nodes).toHaveLength(3)
  })

  it('链尾应为最后一个效果节点', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack({ effects: [makeEffect('compressor')] })
    const chain = createTrackNodes(ctx, track)
    expect(chain.tail).not.toBe(chain.panner)
  })

  it('混响在链中应建立干湿并联而不是串联替换', () => {
    const ctx = new FakeAudioContext()
    const track = makeTrack({ effects: [makeEffect('reverb', { decaySeconds: 1 })] })
    const chain = createTrackNodes(ctx, track)
    // 入口 + 声像 + (merge + dry + wet + convolver)
    expect(chain.nodes).toHaveLength(6)
    // 声像之后分出两路
    expect(asFake(chain.panner).outputs).toHaveLength(2)
  })
})

// ============================================================================
// applyTrackParamsTo 测试
// ============================================================================

describe('applyTrackParamsTo', () => {
  it('应更新增益', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack({ gainDb: 0, pan: 0 }))
    applyTrackParamsTo(chain, makeTrack({ gainDb: 12, pan: 0 }))
    expect(chain.input.gain.value).toBeCloseTo(Math.pow(10, 12 / 20), 6)
  })

  it('应更新声像', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack({ pan: 0 }))
    applyTrackParamsTo(chain, makeTrack({ pan: 1 }))
    expect(chain.panner.pan.value).toBe(1)
  })

  it('声像越界应被 clamp', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack({ pan: 0 }))
    applyTrackParamsTo(chain, makeTrack({ pan: 5 }))
    expect(chain.panner.pan.value).toBe(1)
  })

  it('热更新不应重建节点', () => {
    const ctx = new FakeAudioContext()
    const chain = createTrackNodes(ctx, makeTrack())
    const before = ctx.createdNodes.length
    applyTrackParamsTo(chain, makeTrack({ gainDb: 3 }))
    expect(ctx.createdNodes.length).toBe(before)
  })
})

// ============================================================================
// 主输出总线测试
// ============================================================================

describe('createMasterNodes', () => {
  it('应创建入口与声像节点', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster())
    expect(master.input).toBeDefined()
    expect(master.panner).toBeDefined()
  })

  it('应连接到 destination', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster())
    expect(asFake(master.tail).outputs).toContain(ctx.destination)
  })

  it('未启用限幅器时 limiter 应为 null', () => {
    const ctx = new FakeAudioContext()
    expect(createMasterNodes(ctx, makeMaster({ limiterEnabled: false })).limiter).toBeNull()
  })

  it('启用限幅器时应创建并串联', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster({ limiterEnabled: true, ceilingDb: -1 }))
    expect(master.limiter).not.toBeNull()
    expect(master.limiter?.threshold.value).toBe(-1)
    expect(master.limiter?.ratio.value).toBe(20)
    expect(master.limiter?.knee.value).toBe(0)
  })

  it('未请求分析器时 analyser 应为 null', () => {
    const ctx = new FakeAudioContext()
    expect(createMasterNodes(ctx, makeMaster()).analyser).toBeNull()
  })

  it('请求分析器时应创建并设置 fftSize', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster(), {
      withAnalyser: true,
      fftSize: 1024,
    })
    expect(master.analyser).not.toBeNull()
    expect(master.analyser?.fftSize).toBe(1024)
  })

  it('fftSize 过小时应保留默认值', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster(), { withAnalyser: true, fftSize: 8 })
    expect(master.analyser?.fftSize).toBe(2048)
  })

  it('限幅器与分析器同时启用时应位于分析器之前', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(
      ctx,
      makeMaster({ limiterEnabled: true }),
      { withAnalyser: true },
    )
    expect(asFake(master.limiter).outputs).toContain(asFake(master.analyser))
  })

  it('应应用总线增益与声像', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster({ gainDb: -6, pan: 0.5 }))
    expect(master.input.gain.value).toBeCloseTo(Math.pow(10, -6 / 20), 6)
    expect(master.panner.pan.value).toBe(0.5)
  })
})

describe('applyMasterParamsTo', () => {
  it('应更新总线增益与声像', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster())
    applyMasterParamsTo(master, makeMaster({ gainDb: 6, pan: -1 }))
    expect(master.input.gain.value).toBeCloseTo(Math.pow(10, 6 / 20), 6)
    expect(master.panner.pan.value).toBe(-1)
  })
})

// ============================================================================
// 连接与断开测试
// ============================================================================

describe('connectTrackToMaster', () => {
  it('应把轨道链尾接到主输出入口', () => {
    const ctx = new FakeAudioContext()
    const track = createTrackNodes(ctx, makeTrack())
    const master = createMasterNodes(ctx, makeMaster())
    connectTrackToMaster(track, master)
    expect(asFake(track.tail).outputs).toContain(master.input)
  })

  it('带效果的轨道也应正确接入', () => {
    const ctx = new FakeAudioContext()
    const track = createTrackNodes(ctx, makeTrack({ effects: [makeEffect('eq')] }))
    const master = createMasterNodes(ctx, makeMaster())
    connectTrackToMaster(track, master)
    expect(asFake(track.tail).outputs).toContain(master.input)
  })
})

describe('disconnect', () => {
  it('应断开轨道链上的全部节点', () => {
    const ctx = new FakeAudioContext()
    const track = createTrackNodes(ctx, makeTrack({ effects: [makeEffect('eq')] }))
    disconnectTrackNodes(track)
    for (const node of track.nodes) {
      expect(asFake(node).disconnected).toBe(true)
    }
  })

  it('应断开主输出链上的全部节点', () => {
    const ctx = new FakeAudioContext()
    const master = createMasterNodes(ctx, makeMaster({ limiterEnabled: true }))
    disconnectMasterNodes(master)
    for (const node of master.nodes) {
      expect(asFake(node).disconnected).toBe(true)
    }
  })

  it('重复断开不应抛异常', () => {
    const ctx = new FakeAudioContext()
    const track = createTrackNodes(ctx, makeTrack())
    disconnectTrackNodes(track)
    expect(() => disconnectTrackNodes(track)).not.toThrow()
  })
})
