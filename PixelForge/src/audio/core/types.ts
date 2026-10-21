/**
 * 音频核心类型定义(Step 41.1)— 全部音频模块的公共类型。
 *
 * 职责:
 * - 定义音轨 / 效果节点 / 主输出总线 / 电平读数 / 音频特征
 * - 不依赖 Web Audio API 与 DOM(纯类型,可在任意环境导入)
 *
 * 设计约定:
 * - 时间单位统一为微秒 bigint,与 timelineStore 保持一致
 * - 增益对外一律用 dB(number),内部计算转线性
 * - 声像范围 -1(左) ~ 0(中) ~ +1(右)
 *
 * 数据流:
 *   AudioTrack(+ AudioEffectNode[])
 *     ↓ mixer.computeTrackGains
 *   TrackGain(left / right 线性增益)
 *     ↓ runtime.audioGraph
 *   Web Audio 节点图
 */

// ============================================================================
// 1. 效果
// ============================================================================

/** 音频效果类型 */
export type AudioEffectType = 'eq' | 'compressor' | 'reverb' | 'gain'

/** 音频效果节点(有序,通过 enabled 控制是否参与运算) */
export interface AudioEffectNode {
  id: string
  type: AudioEffectType
  enabled: boolean
  /** 参数键值对,具体键由每种效果的参数模型定义 */
  params: Record<string, number>
}

// ============================================================================
// 2. 音轨
// ============================================================================

/** 音频轨道 */
export interface AudioTrack {
  id: string
  name: string
  /** 音频资产 id(指向 OPFS 中的音频文件) */
  assetId: string
  /** 在音轨上的起始时间(微秒) */
  startTimeUs: bigint
  /** 裁剪入点(微秒,相对音频文件自身) */
  inPointUs: bigint
  /** 裁剪出点(微秒,相对音频文件自身) */
  outPointUs: bigint
  /** 增益(dB),取值范围 [GAIN_DB_MIN, GAIN_DB_MAX] */
  gainDb: number
  /** 声像,-1 左 ~ 0 中 ~ +1 右 */
  pan: number
  /** 静音 */
  muted: boolean
  /** 独奏(优先级高于静音) */
  soloed: boolean
  /** 效果链 */
  effects: AudioEffectNode[]
}

// ============================================================================
// 3. 主输出总线
// ============================================================================

/** 主输出总线 */
export interface MasterBus {
  /** 总线增益(dB) */
  gainDb: number
  /** 总线声像 */
  pan: number
  /** 是否启用限幅器(防削波) */
  limiterEnabled: boolean
  /** 限幅天花板(dB),通常为 -0.1 ~ -1 */
  ceilingDb: number
  /** 总线效果链 */
  effects: AudioEffectNode[]
}

// ============================================================================
// 4. 增益与电平
// ============================================================================

/** 单轨计算后的左右声道线性增益 */
export interface TrackGain {
  trackId: string
  /** 左声道线性增益 */
  left: number
  /** 右声道线性增益 */
  right: number
}

/** 电平读数(归一化 0 ~ 1) */
export interface MeterReading {
  /** 均方根电平 */
  rms: number
  /** 峰值电平 */
  peak: number
  /** 是否削波(峰值达到或超过 1.0) */
  clipped: boolean
}

// ============================================================================
// 5. 音频特征(驱动画面用,Step 41.6)
// ============================================================================

/** 音频特征(全部归一化到 0 ~ 1) */
export interface AudioFeatures {
  /** 低频能量(约 20-250Hz) */
  bass: number
  /** 中频能量(约 250-4000Hz) */
  mid: number
  /** 高频能量(约 4000Hz 以上) */
  treble: number
  /** 总能量 */
  energy: number
  /** 节拍强度,非节拍帧为 0 */
  beat: number
  /** 频谱质心 */
  centroid: number
}
