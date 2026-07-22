/**
 * 音频混音器 Store(Step 33)— 管理混音配置状态 + Web Audio API 集成。
 *
 * 职责:
 * - 持有混音配置(MixConfig,响应式)
 * - 提供 setTrackPan/setTrackSolo/setMasterVolume 等 actions
 * - 管理 AudioContext 生命周期(延迟创建,单例)
 * - 实时电平表数据(由 AnalyserNode 驱动)
 *
 * 与 ProTimelineStore 的关系:
 * - ProTimelineStore 持有 Track(volume/muted)
 * - 本 Store 持有 MixConfig(pan/solo/effects) + master
 * - 实际增益 = computeTrackGain(Track.volume, Track.muted, MixConfig.solo, ...)
 *
 * 用法:
 *   const store = useAudioMixerStore()
 *   store.setTrackPan('track_1', -0.5)
 *   store.setMasterVolume(0.8)
 *   store.initAudioContext()
 */

import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'

import {
  createDefaultMixConfig,
  findTrackMix,
  hasAnySoloTrack,
  setTrackPan as setTrackPanInConfig,
  setTrackSolo as setTrackSoloInConfig,
  setMasterVolume as setMasterVolumeInConfig,
  setMasterPan as setMasterPanInConfig,
  setMasterLimiter as setMasterLimiterInConfig,
  addTrackEffect as addTrackEffectInConfig,
  removeTrackEffect as removeTrackEffectInConfig,
  computeTrackGain,
  computeTrackChannelGain,
  estimateOutputLevel,
  validateMixConfig,
  PAN_CENTER,
  type MixConfig,
  type AudioEffect,
  type PanValue,
  type VolumeValue,
} from './audioMix'

// ============================================================================
// Web Audio API 类型(最小化,便于测试 mock)
// ============================================================================

interface AudioContextLike {
  readonly sampleRate: number
  state: 'suspended' | 'running' | 'closed'
  destination: AudioNodeLike
  createGain(): GainNodeLike
  createStereoPanner?(): StereoPannerNodeLike
  createAnalyser(): AnalyserNodeLike
  resume(): Promise<void>
  close(): Promise<void>
}

interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike
  disconnect(): void
}

interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike
}

interface AnalyserNodeLike extends AudioNodeLike {
  fftSize: number
  frequencyBinCount: number
  getByteFrequencyData(array: Uint8Array): void
  getByteTimeDomainData(array: Uint8Array): void
}

interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
}

// ============================================================================
// Store 定义
// ============================================================================

export const useAudioMixerStore = defineStore('audioMixer', () => {
  // —— 状态 ——
  const mixConfig = ref<MixConfig>(createDefaultMixConfig())
  const audioContext = shallowRef<AudioContextLike | null>(null)
  const analyser = shallowRef<AnalyserNodeLike | null>(null)
  const levelData = ref({ left: 0, right: 0 })

  // 轨道增益节点缓存(trackId → GainNode)
  const trackGainNodes = new Map<string, GainNodeLike>()
  const trackPannerNodes = new Map<string, StereoPannerNodeLike>()

  // —— 计算属性 ——

  /** 是否存在 solo 轨道 */
  const hasSolo = computed(() => hasAnySoloTrack(mixConfig.value))

  /** 轨道数量 */
  const trackCount = computed(() => mixConfig.value.tracks.length)

  /** 主音量 */
  const masterVolume = computed(() => mixConfig.value.master.volume)

  /** 主声像 */
  const masterPan = computed(() => mixConfig.value.master.pan)

  /** 限制器是否开启 */
  const limiterEnabled = computed(() => mixConfig.value.master.limiter)

  /** 左右声道电平(0-1) */
  const levels = computed(() => levelData.value)

  // —— Actions ——

  /** 设置轨道声像 */
  function setTrackPan(trackId: string, pan: PanValue): void {
    mixConfig.value = setTrackPanInConfig(mixConfig.value, trackId, pan)
    updateAudioNodePan(trackId, pan)
  }

  /** 设置轨道独奏 */
  function setTrackSolo(trackId: string, solo: boolean): void {
    mixConfig.value = setTrackSoloInConfig(mixConfig.value, trackId, solo)
  }

  /** 设置主音量 */
  function setMasterVolume(volume: VolumeValue): void {
    mixConfig.value = setMasterVolumeInConfig(mixConfig.value, volume)
    updateMasterGain()
  }

  /** 设置主声像 */
  function setMasterPan(pan: PanValue): void {
    mixConfig.value = setMasterPanInConfig(mixConfig.value, pan)
  }

  /** 切换限制器 */
  function setLimiter(enabled: boolean): void {
    mixConfig.value = setMasterLimiterInConfig(mixConfig.value, enabled)
  }

  /** 添加效果到轨道 */
  function addTrackEffect(trackId: string, effect: AudioEffect): void {
    mixConfig.value = addTrackEffectInConfig(mixConfig.value, trackId, effect)
  }

  /** 从轨道移除效果 */
  function removeTrackEffect(trackId: string, effectId: string): void {
    mixConfig.value = removeTrackEffectInConfig(mixConfig.value, trackId, effectId)
  }

  /**
   * 计算某轨道的实际增益(结合 Track 参数)。
   *
   * @param trackVolume  Track.volume
   * @param trackMuted   Track.muted
   * @param trackId      轨道 ID
   * @returns 线性增益 [0, ∞)
   */
  function getTrackGain(
    trackVolume: number,
    trackMuted: boolean,
    trackId: string,
  ): number {
    const tm = findTrackMix(mixConfig.value, trackId)
    const solo = tm?.solo ?? false
    return computeTrackGain(trackVolume, trackMuted, solo, hasSolo.value)
  }

  /**
   * 计算某轨道的左右声道增益(含声像)。
   */
  function getTrackChannelGain(
    trackVolume: number,
    trackMuted: boolean,
    trackId: string,
  ): { leftGain: number; rightGain: number } {
    const tm = findTrackMix(mixConfig.value, trackId)
    const solo = tm?.solo ?? false
    const pan = tm?.pan ?? PAN_CENTER
    return computeTrackChannelGain(trackVolume, trackMuted, solo, hasSolo.value, pan)
  }

  /**
   * 估算所有轨道的总输出电平(配置预览用)。
   *
   * @param tracks Track 数组(提供 volume/muted/id)
   * @returns { left, right } 估算电平
   */
  function estimateLevels(
    tracks: Array<{ id: string; volume: number; muted: boolean }>,
  ): { left: number; right: number } {
    const gains = tracks.map((t) =>
      getTrackChannelGain(t.volume, t.muted, t.id),
    )
    return estimateOutputLevel(gains, masterVolume.value)
  }

  /** 重置为默认配置 */
  function reset(): void {
    mixConfig.value = createDefaultMixConfig()
    trackGainNodes.clear()
    trackPannerNodes.clear()
  }

  // —— Web Audio API 集成 ——

  /**
   * 初始化 AudioContext(延迟创建,浏览器策略要求用户交互后才能运行)。
   */
  async function initAudioContext(): Promise<boolean> {
    if (audioContext.value) return true
    try {
      const Ctx = (globalThis as any).AudioContext
      if (!Ctx) return false
      const ctx: AudioContextLike = new Ctx()
      audioContext.value = ctx

      // 创建主 analyser(用于电平表)
      analyser.value = ctx.createAnalyser()
      analyser.value.fftSize = 256
      analyser.value.connect(ctx.destination)

      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      return true
    } catch {
      return false
    }
  }

  /** 关闭 AudioContext */
  async function disposeAudioContext(): Promise<void> {
    if (analyser.value) {
      analyser.value.disconnect()
      analyser.value = null
    }
    trackGainNodes.clear()
    trackPannerNodes.clear()
    if (audioContext.value) {
      await audioContext.value.close()
      audioContext.value = null
    }
  }

  /** 更新轨道声像节点 */
  function updateAudioNodePan(trackId: string, pan: PanValue): void {
    const panner = trackPannerNodes.get(trackId)
    if (panner) {
      panner.pan.value = pan
    }
  }

  /** 更新主增益节点 */
  function updateMasterGain(): void {
    // 主增益由 AudioContext.destination 前的 GainNode 控制
    // 实际实现需要维护 masterGainNode,此处简化
  }

  /** 读取电平表数据(每帧调用) */
  function updateLevels(): void {
    if (!analyser.value) return
    const data = new Uint8Array(analyser.value.frequencyBinCount)
    analyser.value.getByteFrequencyData(data)

    // 简化:左右声道取前半/后半平均
    const half = Math.floor(data.length / 2)
    let leftSum = 0
    let rightSum = 0
    for (let i = 0; i < half; i++) leftSum += data[i]
    for (let i = half; i < data.length; i++) rightSum += data[i]

    levelData.value = {
      left: leftSum / half / 255,
      right: rightSum / (data.length - half) / 255,
    }
  }

  /** 获取当前混音配置快照 */
  function getMixConfig(): MixConfig {
    return mixConfig.value
  }

  /** 验证当前配置 */
  function isValid(): boolean {
    return validateMixConfig(mixConfig.value).valid
  }

  return {
    // 状态
    mixConfig,
    audioContext,
    analyser,
    levels,
    // 计算属性
    hasSolo,
    trackCount,
    masterVolume,
    masterPan,
    limiterEnabled,
    // Actions
    setTrackPan,
    setTrackSolo,
    setMasterVolume,
    setMasterPan,
    setLimiter,
    addTrackEffect,
    removeTrackEffect,
    getTrackGain,
    getTrackChannelGain,
    estimateLevels,
    reset,
    initAudioContext,
    disposeAudioContext,
    updateLevels,
    getMixConfig,
    isValid,
  }
})
