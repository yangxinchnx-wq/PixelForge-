/**
 * 音频混音核心(Step 33)— 多轨道混音配置 + 效果链 + 混音计算纯函数。
 *
 * 职责:
 * - 定义混音参数(音量/声像/静音/独奏)
 * - 定义音频效果链(EQ/压缩/混响/增益)
 * - 提供混音计算纯函数(实际增益/声像映射/电平估算)
 * - 不依赖 Web Audio API(纯逻辑,便于测试)
 *
 * 与 Track 的关系:
 * - Track 已有 muted/volume 字段(Step 31.1)
 * - 本模块扩展 pan(声像)和 solo(独奏),以及效果链
 * - 混音器 Store 会读取 Track.volume/muted + 本模块的 MixConfig 共同决定实际输出
 *
 * 数据流:
 *   Track.volume/muted + MixConfig.pan/solo/effects
 *     → computeTrackGain(纯函数)
 *     → Web Audio API GainNode/StereoPannerNode
 *     → 主输出
 */

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 声像位置(-1 = 全左,0 = 居中,1 = 全右) */
export type PanValue = number // [-1, 1]

/** 音量值(0 = 静音,1 = 原始音量,>1 = 放大) */
export type VolumeValue = number // [0, ∞)

/** 效果类型 */
export type AudioEffectType = 'eq' | 'compressor' | 'reverb' | 'gain'

/** 音频效果节点(效果链的一个环节) */
export interface AudioEffect {
  /** 唯一 ID */
  id: string
  /** 效果类型 */
  type: AudioEffectType
  /** 是否启用 */
  enabled: boolean
  /** 干湿比(0 = 全干,1 = 全湿) */
  mix: number
  /** 效果参数(因类型而异) */
  params: AudioEffectParams
}

/** 效果参数(联合类型,按 type 区分) */
export interface AudioEffectParams {
  /** EQ 参数(三段均衡器) */
  eq?: {
    low: number   // dB,[-12, +12]
    mid: number   // dB,[-12, +12]
    high: number  // dB,[-12, +12]
  }
  /** 压缩器参数 */
  compressor?: {
    threshold: number  // dB,[-60, 0]
    ratio: number      // [1, 20]
    attack: number     // ms,[0, 1000]
    release: number    // ms,[0, 5000]
  }
  /** 混响参数 */
  reverb?: {
    decay: number      // 秒,[0.1, 10]
    preDelay: number   // ms,[0, 500]
  }
  /** 增益参数 */
  gain?: {
    amount: number     // dB,[-24, +24]
  }
}

/** 单轨道混音配置 */
export interface TrackMixConfig {
  /** 关联的 Track ID */
  trackId: string
  /** 声像(-1 = 全左,0 = 居中,1 = 全右) */
  pan: PanValue
  /** 独奏(仅该轨道发声) */
  solo: boolean
  /** 效果链(按顺序应用) */
  effects: AudioEffect[]
}

/** 主输出配置 */
export interface MasterMixConfig {
  /** 主音量(0-1) */
  volume: VolumeValue
  /** 主声像 */
  pan: PanValue
  /** 限制器开启(防止削波) */
  limiter: boolean
  /** 限制器阈值 dB */
  limiterThreshold: number
}

/** 完整混音配置(所有轨道 + 主输出) */
export interface MixConfig {
  /** 轨道混音配置(按 trackId 索引) */
  tracks: TrackMixConfig[]
  /** 主输出配置 */
  master: MasterMixConfig
}

// ============================================================================
// 2. 常量与默认值
// ============================================================================

export const PAN_MIN = -1
export const PAN_MAX = 1
export const PAN_CENTER = 0

export const VOLUME_MIN = 0
export const VOLUME_MAX = 2
export const VOLUME_DEFAULT = 1

export const EQ_DB_MIN = -12
export const EQ_DB_MAX = 12

export const COMPRESSOR_RATIO_MIN = 1
export const COMPRESSOR_RATIO_MAX = 20

export const REVERB_DECAY_MIN = 0.1
export const REVERB_DECAY_MAX = 10

/** 默认单轨道混音配置 */
export const DEFAULT_TRACK_MIX: Omit<TrackMixConfig, 'trackId'> = {
  pan: PAN_CENTER,
  solo: false,
  effects: [],
}

/** 默认主输出配置 */
export const DEFAULT_MASTER_MIX: MasterMixConfig = {
  volume: VOLUME_DEFAULT,
  pan: PAN_CENTER,
  limiter: true,
  limiterThreshold: -3,
}

// ============================================================================
// 3. 工厂函数
// ============================================================================

let effectIdCounter = 0

/** 生成效果 ID */
export function genEffectId(): string {
  effectIdCounter++
  return `fx_${Date.now().toString(36)}_${effectIdCounter}`
}

/** 创建单轨道混音配置 */
export function createTrackMixConfig(trackId: string): TrackMixConfig {
  return {
    ...DEFAULT_TRACK_MIX,
    trackId,
    effects: [],
  }
}

/** 创建默认完整混音配置 */
export function createDefaultMixConfig(): MixConfig {
  return {
    tracks: [],
    master: { ...DEFAULT_MASTER_MIX },
  }
}

/** 创建 EQ 效果 */
export function createEqEffect(
  low = 0,
  mid = 0,
  high = 0,
): AudioEffect {
  return {
    id: genEffectId(),
    type: 'eq',
    enabled: true,
    mix: 1,
    params: {
      eq: { low, mid, high },
    },
  }
}

/** 创建压缩器效果 */
export function createCompressorEffect(
  threshold = -24,
  ratio = 4,
  attack = 3,
  release = 250,
): AudioEffect {
  return {
    id: genEffectId(),
    type: 'compressor',
    enabled: true,
    mix: 1,
    params: {
      compressor: { threshold, ratio, attack, release },
    },
  }
}

/** 创建混响效果 */
export function createReverbEffect(
  decay = 2,
  preDelay = 20,
): AudioEffect {
  return {
    id: genEffectId(),
    type: 'reverb',
    enabled: true,
    mix: 0.3,
    params: {
      reverb: { decay, preDelay },
    },
  }
}

/** 创建增益效果 */
export function createGainEffect(amount = 0): AudioEffect {
  return {
    id: genEffectId(),
    type: 'gain',
    enabled: true,
    mix: 1,
    params: {
      gain: { amount },
    },
  }
}

// ============================================================================
// 4. 混音计算纯函数
// ============================================================================

/**
 * 将 dB 转换为线性增益。
 * linearGain = 10^(dB / 20)
 */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

/**
 * 将线性增益转换为 dB。
 * dB = 20 * log10(linearGain)
 */
export function linearToDb(linear: number): number {
  if (linear <= 0) return -Infinity
  return 20 * Math.log10(linear)
}

/**
 * 声像值转换为左右声道增益(等功率声像)。
 *
 * @param pan [-1, 1],-1 = 全左,0 = 居中,1 = 全右
 * @returns { left, right } 线性增益 [0, 1]
 */
export function panToGains(pan: PanValue): { left: number; right: number } {
  const clamped = clamp(pan, PAN_MIN, PAN_MAX)
  // 等功率声像(Equal Power Panning)
  const angle = ((clamped + 1) / 2) * (Math.PI / 2)
  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  }
}

/**
 * 计算某轨道的实际增益(考虑 mute/solo/volume)。
 *
 * 规则:
 * - 若任意轨道 solo = true,则仅 solo 轨道发声,其他轨道静音
 * - 若轨道 muted = true,增益为 0
 * - 否则增益 = volume
 *
 * @param trackVolume  轨道音量(Track.volume,0-1)
 * @param trackMuted   轨道静音(Track.muted)
 * @param trackSolo    轨道独奏(MixConfig.solo)
 * @param hasAnySolo   是否存在任何 solo 轨道
 * @returns 线性增益 [0, ∞)
 */
export function computeTrackGain(
  trackVolume: number,
  trackMuted: boolean,
  trackSolo: boolean,
  hasAnySolo: boolean,
): number {
  // 静音
  if (trackMuted) return 0
  // 有 solo 轨道但本轨道非 solo
  if (hasAnySolo && !trackSolo) return 0
  // 正常发声
  return clamp(trackVolume, VOLUME_MIN, VOLUME_MAX)
}

/**
 * 计算完整混音的轨道增益(含声像)。
 *
 * @returns { leftGain, rightGain } 左右声道线性增益
 */
export function computeTrackChannelGain(
  trackVolume: number,
  trackMuted: boolean,
  trackSolo: boolean,
  hasAnySolo: boolean,
  pan: PanValue,
): { leftGain: number; rightGain: number } {
  const gain = computeTrackGain(trackVolume, trackMuted, trackSolo, hasAnySolo)
  const { left, right } = panToGains(pan)
  return {
    leftGain: gain * left,
    rightGain: gain * right,
  }
}

/**
 * 估算混音输出电平(用于电平表显示)。
 *
 * 这是一个简化估算:假设所有轨道独立,输出电平 = sqrt(Σ(gain²))。
 * 实际电平应由 AnalyserNode 实时测量,此函数仅用于配置预览。
 *
 * @param trackGains 各轨道增益数组
 * @param masterVolume 主音量
 * @returns { left, right } 估算电平 [0, ∞)
 */
export function estimateOutputLevel(
  trackGains: Array<{ leftGain: number; rightGain: number }>,
  masterVolume: number,
): { left: number; right: number } {
  let leftSum = 0
  let rightSum = 0
  for (const g of trackGains) {
    leftSum += g.leftGain * g.leftGain
    rightSum += g.rightGain * g.rightGain
  }
  return {
    left: Math.sqrt(leftSum) * masterVolume,
    right: Math.sqrt(rightSum) * masterVolume,
  }
}

// ============================================================================
// 5. 效果链操作(不可变)
// ============================================================================

/** 添加效果到链尾 */
export function addEffect(chain: AudioEffect[], effect: AudioEffect): AudioEffect[] {
  return [...chain, effect]
}

/** 从链中移除效果 */
export function removeEffect(chain: AudioEffect[], effectId: string): AudioEffect[] {
  return chain.filter((e) => e.id !== effectId)
}

/** 替换效果(用于更新参数) */
export function replaceEffect(chain: AudioEffect[], effectId: string, newEffect: AudioEffect): AudioEffect[] {
  return chain.map((e) => (e.id === effectId ? newEffect : e))
}

/** 切换效果启用状态 */
export function toggleEffect(chain: AudioEffect[], effectId: string): AudioEffect[] {
  return chain.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e))
}

/** 移动效果顺序(在链中前后移动) */
export function moveEffect(
  chain: AudioEffect[],
  effectId: string,
  direction: 'up' | 'down',
): AudioEffect[] {
  const index = chain.findIndex((e) => e.id === effectId)
  if (index === -1) return chain
  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= chain.length) return chain
  const result = [...chain]
  ;[result[index], result[targetIndex]] = [result[targetIndex], result[index]]
  return result
}

// ============================================================================
// 6. 混音配置操作(不可变)
// ============================================================================

/** 查找轨道混音配置 */
export function findTrackMix(config: MixConfig, trackId: string): TrackMixConfig | undefined {
  return config.tracks.find((t) => t.trackId === trackId)
}

/** 获取或创建轨道混音配置(若不存在则用默认值) */
export function getOrCreateTrackMix(config: MixConfig, trackId: string): TrackMixConfig {
  const existing = findTrackMix(config, trackId)
  if (existing) return existing
  return createTrackMixConfig(trackId)
}

/** 设置轨道声像(不可变) */
export function setTrackPan(config: MixConfig, trackId: string, pan: PanValue): MixConfig {
  const clamped = clamp(pan, PAN_MIN, PAN_MAX)
  return updateTrackMix(config, trackId, (tm) => ({ ...tm, pan: clamped }))
}

/** 设置轨道独奏(不可变) */
export function setTrackSolo(config: MixConfig, trackId: string, solo: boolean): MixConfig {
  return updateTrackMix(config, trackId, (tm) => ({ ...tm, solo }))
}

/** 设置主输出音量(不可变) */
export function setMasterVolume(config: MixConfig, volume: VolumeValue): MixConfig {
  return {
    ...config,
    master: { ...config.master, volume: clamp(volume, VOLUME_MIN, VOLUME_MAX) },
  }
}

/** 设置主输出声像(不可变) */
export function setMasterPan(config: MixConfig, pan: PanValue): MixConfig {
  return {
    ...config,
    master: { ...config.master, pan: clamp(pan, PAN_MIN, PAN_MAX) },
  }
}

/** 切换限制器(不可变) */
export function setMasterLimiter(config: MixConfig, enabled: boolean): MixConfig {
  return {
    ...config,
    master: { ...config.master, limiter: enabled },
  }
}

/** 添加效果到轨道(不可变) */
export function addTrackEffect(
  config: MixConfig,
  trackId: string,
  effect: AudioEffect,
): MixConfig {
  return updateTrackMix(config, trackId, (tm) => ({
    ...tm,
    effects: addEffect(tm.effects, effect),
  }))
}

/** 从轨道移除效果(不可变) */
export function removeTrackEffect(
  config: MixConfig,
  trackId: string,
  effectId: string,
): MixConfig {
  return updateTrackMix(config, trackId, (tm) => ({
    ...tm,
    effects: removeEffect(tm.effects, effectId),
  }))
}

// ============================================================================
// 7. 查询函数
// ============================================================================

/** 是否存在任何 solo 轨道 */
export function hasAnySoloTrack(config: MixConfig): boolean {
  return config.tracks.some((t) => t.solo)
}

/** 获取所有 solo 轨道 ID */
export function getSoloTrackIds(config: MixConfig): string[] {
  return config.tracks.filter((t) => t.solo).map((t) => t.trackId)
}

/** 获取轨道效果链(返回副本) */
export function getTrackEffects(config: MixConfig, trackId: string): AudioEffect[] {
  const tm = findTrackMix(config, trackId)
  return tm ? [...tm.effects] : []
}

/** 统计已启用效果数量 */
export function countEnabledEffects(config: MixConfig): number {
  return config.tracks.reduce(
    (sum, tm) => sum + tm.effects.filter((e) => e.enabled).length,
    0,
  )
}

// ============================================================================
// 8. 验证函数
// ============================================================================

/** 验证混音配置完整性 */
export function validateMixConfig(config: MixConfig): { valid: boolean; reason?: string } {
  if (!config.master) {
    return { valid: false, reason: '缺少主输出配置' }
  }
  if (config.master.volume < 0) {
    return { valid: false, reason: `主音量无效: ${config.master.volume}` }
  }
  if (config.master.pan < PAN_MIN || config.master.pan > PAN_MAX) {
    return { valid: false, reason: `主声像无效: ${config.master.pan}` }
  }
  for (const tm of config.tracks) {
    if (!tm.trackId) {
      return { valid: false, reason: '轨道混音配置缺少 trackId' }
    }
    if (tm.pan < PAN_MIN || tm.pan > PAN_MAX) {
      return { valid: false, reason: `轨道 ${tm.trackId} 声像无效: ${tm.pan}` }
    }
  }
  return { valid: true }
}

// ============================================================================
// 9. 辅助函数
// ============================================================================

/** clamp 辅助(避免循环依赖 core/time.ts 的 clamp) */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 更新轨道混音配置(内部辅助) */
function updateTrackMix(
  config: MixConfig,
  trackId: string,
  updater: (tm: TrackMixConfig) => TrackMixConfig,
): MixConfig {
  const existing = findTrackMix(config, trackId)
  if (existing) {
    return {
      ...config,
      tracks: config.tracks.map((tm) =>
        tm.trackId === trackId ? updater(tm) : tm,
      ),
    }
  }
  // 不存在则创建后更新
  const created = updater(createTrackMixConfig(trackId))
  return {
    ...config,
    tracks: [...config.tracks, created],
  }
}
