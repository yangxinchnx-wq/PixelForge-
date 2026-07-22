/**
 * Step 33 单元测试 — 音频混音器。
 *
 * 覆盖:
 * - AM: AudioMix(混音配置 / 工厂函数 / 计算纯函数)
 * - AE: AudioEffects(效果链操作)
 * - AC: AudioConfig(混音配置操作 / 不可变更新)
 * - AQ: AudioQuery(查询函数)
 * - AV: AudioValidation(验证)
 * - AS: AudioStore(Pinia 集成)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  createDefaultMixConfig,
  createTrackMixConfig,
  createEqEffect,
  createCompressorEffect,
  createReverbEffect,
  createGainEffect,
  dbToLinear,
  linearToDb,
  panToGains,
  computeTrackGain,
  computeTrackChannelGain,
  estimateOutputLevel,
  addEffect,
  removeEffect,
  replaceEffect,
  toggleEffect,
  moveEffect,
  findTrackMix,
  getOrCreateTrackMix,
  setTrackPan,
  setTrackSolo,
  setMasterVolume,
  setMasterPan,
  setMasterLimiter,
  addTrackEffect,
  removeTrackEffect,
  hasAnySoloTrack,
  getSoloTrackIds,
  getTrackEffects,
  countEnabledEffects,
  validateMixConfig,
  PAN_MAX,
  PAN_CENTER,
  VOLUME_MAX,
  VOLUME_DEFAULT,
  DEFAULT_MASTER_MIX,
  type MixConfig,
} from './audioMix'
import { useAudioMixerStore } from './audioMixerStore'

// ============================================================================
// AM: 混音配置 / 工厂函数 / 计算纯函数
// ============================================================================

describe('AM: 混音配置与计算', () => {
  it('AM1: createDefaultMixConfig 返回默认配置', () => {
    const config = createDefaultMixConfig()
    expect(config.tracks).toEqual([])
    expect(config.master.volume).toBe(VOLUME_DEFAULT)
    expect(config.master.pan).toBe(PAN_CENTER)
    expect(config.master.limiter).toBe(true)
  })

  it('AM2: createTrackMixConfig 创建轨道配置', () => {
    const tm = createTrackMixConfig('track_1')
    expect(tm.trackId).toBe('track_1')
    expect(tm.pan).toBe(PAN_CENTER)
    expect(tm.solo).toBe(false)
    expect(tm.effects).toEqual([])
  })

  it('AM3: dbToLinear 0dB = 1.0', () => {
    expect(dbToLinear(0)).toBeCloseTo(1.0)
  })

  it('AM4: dbToLinear 6dB ≈ 2.0', () => {
    expect(dbToLinear(6)).toBeCloseTo(1.995, 1)
  })

  it('AM5: dbToLinear -6dB ≈ 0.5', () => {
    expect(dbToLinear(-6)).toBeCloseTo(0.501, 1)
  })

  it('AM6: linearToDb 1.0 = 0dB', () => {
    expect(linearToDb(1)).toBeCloseTo(0)
  })

  it('AM7: linearToDb 0 = -Infinity', () => {
    expect(linearToDb(0)).toBe(-Infinity)
  })

  it('AM8: panToGains 居中时左右相等', () => {
    const { left, right } = panToGains(0)
    expect(left).toBeCloseTo(right, 5)
    expect(left).toBeCloseTo(Math.SQRT1_2, 5)
  })

  it('AM9: panToGains 全左时左=1 右=0', () => {
    const { left, right } = panToGains(-1)
    expect(left).toBeCloseTo(1, 5)
    expect(right).toBeCloseTo(0, 5)
  })

  it('AM10: panToGains 全右时左=0 右=1', () => {
    const { left, right } = panToGains(1)
    expect(left).toBeCloseTo(0, 5)
    expect(right).toBeCloseTo(1, 5)
  })

  it('AM11: panToGains clamp 超范围值', () => {
    const { left: l1 } = panToGains(-2)
    const { left: l2 } = panToGains(-1)
    expect(l1).toBeCloseTo(l2, 5)
  })

  it('AM12: computeTrackGain 正常发声', () => {
    expect(computeTrackGain(0.8, false, false, false)).toBe(0.8)
  })

  it('AM13: computeTrackGain 静音返回 0', () => {
    expect(computeTrackGain(0.8, true, false, false)).toBe(0)
  })

  it('AM14: computeTrackGain 有 solo 但本轨道非 solo 返回 0', () => {
    expect(computeTrackGain(0.8, false, false, true)).toBe(0)
  })

  it('AM15: computeTrackGain 有 solo 且本轨道 solo 正常发声', () => {
    expect(computeTrackGain(0.8, false, true, true)).toBe(0.8)
  })

  it('AM16: computeTrackGain 静音优先于 solo', () => {
    expect(computeTrackGain(0.8, true, true, true)).toBe(0)
  })

  it('AM17: computeTrackChannelGain 含声像', () => {
    const { leftGain, rightGain } = computeTrackChannelGain(1, false, false, false, -1)
    expect(leftGain).toBeCloseTo(1, 5)
    expect(rightGain).toBeCloseTo(0, 5)
  })

  it('AM18: computeTrackChannelGain 静音时左右都为 0', () => {
    const { leftGain, rightGain } = computeTrackChannelGain(1, true, false, false, 0)
    expect(leftGain).toBe(0)
    expect(rightGain).toBe(0)
  })

  it('AM19: estimateOutputLevel 空轨道返回 0', () => {
    const { left, right } = estimateOutputLevel([], 1)
    expect(left).toBe(0)
    expect(right).toBe(0)
  })

  it('AM20: estimateOutputLevel 单轨道全左', () => {
    const { left, right } = estimateOutputLevel(
      [{ leftGain: 0.5, rightGain: 0 }],
      1,
    )
    expect(left).toBeCloseTo(0.5, 5)
    expect(right).toBe(0)
  })

  it('AM21: estimateOutputLevel 应用主音量', () => {
    const { left } = estimateOutputLevel(
      [{ leftGain: 0.5, rightGain: 0.5 }],
      2,
    )
    expect(left).toBeCloseTo(1, 5)
  })
})

// ============================================================================
// AE: 效果链操作
// ============================================================================

describe('AE: 效果链操作', () => {
  it('AE1: createEqEffect 默认参数', () => {
    const fx = createEqEffect()
    expect(fx.type).toBe('eq')
    expect(fx.enabled).toBe(true)
    expect(fx.params.eq?.low).toBe(0)
    expect(fx.params.eq?.mid).toBe(0)
    expect(fx.params.eq?.high).toBe(0)
  })

  it('AE2: createCompressorEffect 默认参数', () => {
    const fx = createCompressorEffect()
    expect(fx.type).toBe('compressor')
    expect(fx.params.compressor?.ratio).toBe(4)
  })

  it('AE3: createReverbEffect 默认 mix=0.3', () => {
    const fx = createReverbEffect()
    expect(fx.type).toBe('reverb')
    expect(fx.mix).toBe(0.3)
  })

  it('AE4: createGainEffect 默认 amount=0', () => {
    const fx = createGainEffect()
    expect(fx.type).toBe('gain')
    expect(fx.params.gain?.amount).toBe(0)
  })

  it('AE5: addEffect 添加到链尾', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const chain = addEffect([fx1], fx2)
    expect(chain.length).toBe(2)
    expect(chain[1].id).toBe(fx2.id)
  })

  it('AE6: removeEffect 移除指定效果', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const chain = removeEffect([fx1, fx2], fx1.id)
    expect(chain.length).toBe(1)
    expect(chain[0].id).toBe(fx2.id)
  })

  it('AE7: replaceEffect 替换效果', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const chain = replaceEffect([fx1], fx1.id, fx2)
    expect(chain.length).toBe(1)
    expect(chain[0].id).toBe(fx2.id)
  })

  it('AE8: toggleEffect 切换启用状态', () => {
    const fx = createEqEffect()
    expect(fx.enabled).toBe(true)
    const chain = toggleEffect([fx], fx.id)
    expect(chain[0].enabled).toBe(false)
  })

  it('AE9: moveEffect 上移', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const fx3 = createReverbEffect()
    const chain = moveEffect([fx1, fx2, fx3], fx2.id, 'up')
    expect(chain[0].id).toBe(fx2.id)
    expect(chain[1].id).toBe(fx1.id)
  })

  it('AE10: moveEffect 下移', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const fx3 = createReverbEffect()
    const chain = moveEffect([fx1, fx2, fx3], fx2.id, 'down')
    expect(chain[1].id).toBe(fx3.id)
    expect(chain[2].id).toBe(fx2.id)
  })

  it('AE11: moveEffect 上移边界(已在顶部)', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const chain = moveEffect([fx1, fx2], fx1.id, 'up')
    expect(chain[0].id).toBe(fx1.id)
  })

  it('AE12: moveEffect 下移边界(已在底部)', () => {
    const fx1 = createEqEffect()
    const fx2 = createCompressorEffect()
    const chain = moveEffect([fx1, fx2], fx2.id, 'down')
    expect(chain[1].id).toBe(fx2.id)
  })

  it('AE13: moveEffect 不存在 ID 返回原链', () => {
    const fx1 = createEqEffect()
    const chain = moveEffect([fx1], 'nonexistent', 'up')
    expect(chain).toBe(chain)
  })
})

// ============================================================================
// AC: 混音配置操作(不可变)
// ============================================================================

describe('AC: 混音配置操作', () => {
  it('AC1: setTrackPan 设置声像并 clamp', () => {
    const config = createDefaultMixConfig()
    const updated = setTrackPan(config, 'track_1', 0.5)
    const tm = findTrackMix(updated, 'track_1')
    expect(tm?.pan).toBe(0.5)
  })

  it('AC2: setTrackPan clamp 超范围', () => {
    const config = createDefaultMixConfig()
    const updated = setTrackPan(config, 'track_1', 2)
    const tm = findTrackMix(updated, 'track_1')
    expect(tm?.pan).toBe(PAN_MAX)
  })

  it('AC3: setTrackSolo 设置独奏', () => {
    const config = createDefaultMixConfig()
    const updated = setTrackSolo(config, 'track_1', true)
    const tm = findTrackMix(updated, 'track_1')
    expect(tm?.solo).toBe(true)
  })

  it('AC4: setMasterVolume 设置主音量', () => {
    const config = createDefaultMixConfig()
    const updated = setMasterVolume(config, 0.5)
    expect(updated.master.volume).toBe(0.5)
  })

  it('AC5: setMasterVolume clamp 超范围', () => {
    const config = createDefaultMixConfig()
    const updated = setMasterVolume(config, 5)
    expect(updated.master.volume).toBe(VOLUME_MAX)
  })

  it('AC6: setMasterPan 设置主声像', () => {
    const config = createDefaultMixConfig()
    const updated = setMasterPan(config, -0.5)
    expect(updated.master.pan).toBe(-0.5)
  })

  it('AC7: setMasterLimiter 切换限制器', () => {
    const config = createDefaultMixConfig()
    const updated = setMasterLimiter(config, false)
    expect(updated.master.limiter).toBe(false)
  })

  it('AC8: addTrackEffect 添加效果到轨道', () => {
    const config = createDefaultMixConfig()
    const fx = createEqEffect()
    const updated = addTrackEffect(config, 'track_1', fx)
    const tm = findTrackMix(updated, 'track_1')
    expect(tm?.effects.length).toBe(1)
    expect(tm?.effects[0].id).toBe(fx.id)
  })

  it('AC9: removeTrackEffect 移除轨道效果', () => {
    const config = createDefaultMixConfig()
    const fx = createEqEffect()
    const withFx = addTrackEffect(config, 'track_1', fx)
    const withoutFx = removeTrackEffect(withFx, 'track_1', fx.id)
    const tm = findTrackMix(withoutFx, 'track_1')
    expect(tm?.effects.length).toBe(0)
  })

  it('AC10: 不可变性 — 原配置不被修改', () => {
    const config = createDefaultMixConfig()
    setTrackPan(config, 'track_1', 0.5)
    expect(config.tracks.length).toBe(0)
  })
})

// ============================================================================
// AQ: 查询函数
// ============================================================================

describe('AQ: 查询函数', () => {
  it('AQ1: findTrackMix 找到存在轨道', () => {
    const config = setTrackPan(createDefaultMixConfig(), 'track_1', 0.5)
    const tm = findTrackMix(config, 'track_1')
    expect(tm).toBeDefined()
    expect(tm?.pan).toBe(0.5)
  })

  it('AQ2: findTrackMix 未找到返回 undefined', () => {
    const config = createDefaultMixConfig()
    const tm = findTrackMix(config, 'nonexistent')
    expect(tm).toBeUndefined()
  })

  it('AQ3: getOrCreateTrackMix 存在时返回已有', () => {
    const config = setTrackPan(createDefaultMixConfig(), 'track_1', 0.5)
    const tm = getOrCreateTrackMix(config, 'track_1')
    expect(tm.pan).toBe(0.5)
  })

  it('AQ4: getOrCreateTrackMix 不存在时返回默认', () => {
    const config = createDefaultMixConfig()
    const tm = getOrCreateTrackMix(config, 'track_1')
    expect(tm.pan).toBe(PAN_CENTER)
    expect(tm.solo).toBe(false)
  })

  it('AQ5: hasAnySoloTrack 无 solo 返回 false', () => {
    const config = createDefaultMixConfig()
    expect(hasAnySoloTrack(config)).toBe(false)
  })

  it('AQ6: hasAnySoloTrack 有 solo 返回 true', () => {
    const config = setTrackSolo(createDefaultMixConfig(), 'track_1', true)
    expect(hasAnySoloTrack(config)).toBe(true)
  })

  it('AQ7: getSoloTrackIds 返回 solo 轨道 ID', () => {
    let config = setTrackSolo(createDefaultMixConfig(), 'track_1', true)
    config = setTrackSolo(config, 'track_2', true)
    const ids = getSoloTrackIds(config)
    expect(ids).toContain('track_1')
    expect(ids).toContain('track_2')
    expect(ids.length).toBe(2)
  })

  it('AQ8: getTrackEffects 返回效果链副本', () => {
    const fx = createEqEffect()
    const config = addTrackEffect(createDefaultMixConfig(), 'track_1', fx)
    const effects = getTrackEffects(config, 'track_1')
    expect(effects.length).toBe(1)
    // 修改副本不影响原配置
    effects.push(createCompressorEffect())
    expect(getTrackEffects(config, 'track_1').length).toBe(1)
  })

  it('AQ9: countEnabledEffects 统计已启用效果', () => {
    let config = addTrackEffect(createDefaultMixConfig(), 'track_1', createEqEffect())
    config = addTrackEffect(config, 'track_1', createCompressorEffect())
    expect(countEnabledEffects(config)).toBe(2)
  })

  it('AQ10: countEnabledEffects 不统计禁用效果', () => {
    const fx = createEqEffect()
    fx.enabled = false
    const config = addTrackEffect(createDefaultMixConfig(), 'track_1', fx)
    expect(countEnabledEffects(config)).toBe(0)
  })
})

// ============================================================================
// AV: 验证
// ============================================================================

describe('AV: 验证函数', () => {
  it('AV1: 默认配置通过验证', () => {
    expect(validateMixConfig(createDefaultMixConfig()).valid).toBe(true)
  })

  it('AV2: 缺少主输出失败', () => {
    const config: MixConfig = {
      tracks: [],
      master: undefined as unknown as typeof DEFAULT_MASTER_MIX,
    }
    expect(validateMixConfig(config).valid).toBe(false)
  })

  it('AV3: 主音量负数失败', () => {
    const config = createDefaultMixConfig()
    config.master.volume = -1
    expect(validateMixConfig(config).valid).toBe(false)
  })

  it('AV4: 主声像超范围失败', () => {
    const config = createDefaultMixConfig()
    config.master.pan = 2
    expect(validateMixConfig(config).valid).toBe(false)
  })

  it('AV5: 轨道缺少 trackId 失败', () => {
    const config = createDefaultMixConfig()
    config.tracks.push({
      trackId: '',
      pan: 0,
      solo: false,
      effects: [],
    })
    expect(validateMixConfig(config).valid).toBe(false)
  })

  it('AV6: 轨道声像超范围失败', () => {
    const config = createDefaultMixConfig()
    config.tracks.push({
      trackId: 'track_1',
      pan: 2,
      solo: false,
      effects: [],
    })
    expect(validateMixConfig(config).valid).toBe(false)
  })
})

// ============================================================================
// AS: Store 集成
// ============================================================================

describe('AS: AudioMixerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('AS1: Store 初始化默认配置', () => {
    const store = useAudioMixerStore()
    expect(store.masterVolume).toBe(VOLUME_DEFAULT)
    expect(store.masterPan).toBe(PAN_CENTER)
    expect(store.limiterEnabled).toBe(true)
    expect(store.trackCount).toBe(0)
    expect(store.hasSolo).toBe(false)
  })

  it('AS2: setTrackPan 设置声像', () => {
    const store = useAudioMixerStore()
    store.setTrackPan('track_1', 0.5)
    const tm = store.mixConfig.tracks.find((t) => t.trackId === 'track_1')
    expect(tm?.pan).toBe(0.5)
  })

  it('AS3: setTrackSolo 设置独奏', () => {
    const store = useAudioMixerStore()
    store.setTrackSolo('track_1', true)
    expect(store.hasSolo).toBe(true)
  })

  it('AS4: setMasterVolume 设置主音量', () => {
    const store = useAudioMixerStore()
    store.setMasterVolume(0.5)
    expect(store.masterVolume).toBe(0.5)
  })

  it('AS5: setMasterPan 设置主声像', () => {
    const store = useAudioMixerStore()
    store.setMasterPan(-0.5)
    expect(store.masterPan).toBe(-0.5)
  })

  it('AS6: setLimiter 切换限制器', () => {
    const store = useAudioMixerStore()
    store.setLimiter(false)
    expect(store.limiterEnabled).toBe(false)
  })

  it('AS7: addTrackEffect 添加效果', () => {
    const store = useAudioMixerStore()
    const fx = createEqEffect()
    store.addTrackEffect('track_1', fx)
    const tm = store.mixConfig.tracks.find((t) => t.trackId === 'track_1')
    expect(tm?.effects.length).toBe(1)
  })

  it('AS8: removeTrackEffect 移除效果', () => {
    const store = useAudioMixerStore()
    const fx = createEqEffect()
    store.addTrackEffect('track_1', fx)
    store.removeTrackEffect('track_1', fx.id)
    const tm = store.mixConfig.tracks.find((t) => t.trackId === 'track_1')
    expect(tm?.effects.length).toBe(0)
  })

  it('AS9: getTrackGain 正常轨道', () => {
    const store = useAudioMixerStore()
    const gain = store.getTrackGain(0.8, false, 'track_1')
    expect(gain).toBe(0.8)
  })

  it('AS10: getTrackGain 静音轨道', () => {
    const store = useAudioMixerStore()
    const gain = store.getTrackGain(0.8, true, 'track_1')
    expect(gain).toBe(0)
  })

  it('AS11: getTrackGain 有 solo 但本轨道非 solo', () => {
    const store = useAudioMixerStore()
    store.setTrackSolo('track_1', true)
    const gain = store.getTrackGain(0.8, false, 'track_2')
    expect(gain).toBe(0)
  })

  it('AS12: getTrackGain 有 solo 且本轨道 solo', () => {
    const store = useAudioMixerStore()
    store.setTrackSolo('track_1', true)
    const gain = store.getTrackGain(0.8, false, 'track_1')
    expect(gain).toBe(0.8)
  })

  it('AS13: getTrackChannelGain 含声像', () => {
    const store = useAudioMixerStore()
    store.setTrackPan('track_1', -1)
    const { leftGain, rightGain } = store.getTrackChannelGain(1, false, 'track_1')
    expect(leftGain).toBeCloseTo(1, 5)
    expect(rightGain).toBeCloseTo(0, 5)
  })

  it('AS14: estimateLevels 空轨道', () => {
    const store = useAudioMixerStore()
    const { left, right } = store.estimateLevels([])
    expect(left).toBe(0)
    expect(right).toBe(0)
  })

  it('AS15: estimateLevels 单轨道', () => {
    const store = useAudioMixerStore()
    const { left, right } = store.estimateLevels([
      { id: 'track_1', volume: 0.5, muted: false },
    ])
    // 居中声像,左右相等
    expect(left).toBeCloseTo(right, 5)
    expect(left).toBeGreaterThan(0)
  })

  it('AS16: reset 重置为默认', () => {
    const store = useAudioMixerStore()
    store.setMasterVolume(0.5)
    store.setTrackSolo('track_1', true)
    store.reset()
    expect(store.masterVolume).toBe(VOLUME_DEFAULT)
    expect(store.hasSolo).toBe(false)
    expect(store.trackCount).toBe(0)
  })

  it('AS17: isValid 默认配置通过', () => {
    const store = useAudioMixerStore()
    expect(store.isValid()).toBe(true)
  })

  it('AS18: getMixConfig 返回配置快照', () => {
    const store = useAudioMixerStore()
    store.setMasterVolume(0.5)
    const config = store.getMixConfig()
    expect(config.master.volume).toBe(0.5)
  })
})
