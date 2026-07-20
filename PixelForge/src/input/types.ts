/**
 * Input Types(Step 30.1)— 实时输入系统类型定义。
 *
 * 与 animation/types.ts 的区别:
 * - animation: 基于 time(秒)的关键帧 / 表达式动画
 * - input(本模块): 基于 Signal 的实时输入(音频 / MIDI / 摄像头 / 传感器)
 *
 * 数据流(Step 30 完整):
 *   Input Source(audio / midi / camera / sensor)
 *     ↓ InputRouter.setSignal
 *   Signal(实时值)
 *     ↓ inputDriver.evaluate
 *   ControlMapping(映射后的参数值)
 *     ↓ binding.applyInputBindings
 *   GraphNode / MaterialNode
 *     ↓ compiler
 *   WGSL + Uniform Buffer
 *     ↓ GPU
 *   Canvas
 */

// ============================================================================
// 1. Signal - 实时信号
// ============================================================================

/**
 * 输入源类型(与 AnimationMode 平行,但用于实时输入)。
 *
 * - AUDIO:   音频(麦克风 / 音频文件)
 * - MIDI:    MIDI 设备(旋钮 / 滑块 / 键盘)
 * - CAMERA:  摄像头(运动检测 / 颜色采样)
 * - SENSOR:  通用传感器(鼠标 / 键盘 / 自定义)
 * - AI:      AI 事件(由 LLM 触发的瞬时信号)
 */
export type InputSourceKind = 'AUDIO' | 'MIDI' | 'CAMERA' | 'SENSOR' | 'AI'

/**
 * 实时信号(由 InputRouter 管理)。
 *
 * - id:        信号唯一 id(如 'audio.bass' / 'midi.knob1' / 'camera.motion')
 * - value:     当前值(归一化到 0-1,或原始值)
 * - timestamp: 最后更新时间(performance.now(),毫秒)
 * - source:    来源类型
 * - active:    是否活跃(超时未更新则置 false)
 */
export interface Signal {
  id: string
  value: number
  timestamp: number
  source: InputSourceKind
  active: boolean
}

// ============================================================================
// 2. AudioFeatures - 音频特征
// ============================================================================

/**
 * 音频特征(由 FeatureExtractor 每帧输出)。
 *
 * - volume: 总音量(RMS,0-1)
 * - bass:   低频能量(0-200Hz,0-1)
 * - mid:    中频能量(200-2000Hz,0-1)
 * - high:   高频能量(2000-8000Hz,0-1)
 * - beat:   是否检测到鼓点(瞬时能量突增)
 * - bpm:    估算的 BPM(每分钟节拍数,0 表示未检测)
 *
 * 所有值都归一化到 0-1(除了 bpm)。
 */
export interface AudioFeatures {
  volume: number
  bass: number
  mid: number
  high: number
  beat: boolean
  bpm: number
}

/** 空特征(用于初始化 / 错误降级) */
export const EMPTY_AUDIO_FEATURES: AudioFeatures = {
  volume: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beat: false,
  bpm: 0,
}

// ============================================================================
// 3. 频段定义
// ============================================================================

/**
 * 频段范围(Hz)。
 *
 * 用于 FFT 频段提取,与 spec §8 对齐:
 * - bass: 0-200 Hz(底鼓 / 贝斯)
 * - mid:  200-2000 Hz(人声 / 主旋律)
 * - high: 2000-8000 Hz(镲片 / 高频细节)
 */
export interface BandRanges {
  bass: { min: number; max: number }
  mid: { min: number; max: number }
  high: { min: number; max: number }
}

/** 默认频段范围 */
export const DEFAULT_BAND_RANGES: BandRanges = {
  bass: { min: 0, max: 200 },
  mid: { min: 200, max: 2000 },
  high: { min: 2000, max: 8000 },
}

// ============================================================================
// 4. InputBinding - 输入绑定
// ============================================================================

/**
 * 目标类型(与 animation/types.ts 的 TargetKind 一致,避免循环依赖)。
 *
 * - graph:    RenderGraph 节点(更新 graphStore.nodes,不直接触发渲染)
 * - material: MaterialGraph 节点(更新 materialGraphStore.nodes,不直接触发渲染)
 * - runtime:  RenderIR 直接目标(调用 runtimeStore.applyValuePatch,立即触发 GPU 重渲染)
 *             适用于实时输入驱动画面(audio.bass → layer.scale 等)
 */
export type InputTargetKind = 'graph' | 'material' | 'runtime'

/**
 * 输入绑定(连接 Signal → Node 参数)。
 *
 * - id:          绑定唯一 id
 * - signalId:    源信号 id(如 'audio.bass')
 * - targetKind:  目标类型(graph / material)
 * - nodeId:      目标节点 id
 * - property:    目标参数 key(如 'scale' / 'intensity')
 * - mapping:     值映射(输入 0-1 → 输出 outMin-outMax)
 * - enabled:     是否启用
 *
 * 数据流:
 *   Signal.value(0-1)
 *     ↓ mapping.mapRange
 *   输出值(outMin-outMax)
 *     ↓ binding.applyInputBindings
 *   node.params[property] = 输出值
 */
export interface InputBinding {
  id: string
  signalId: string
  targetKind: InputTargetKind
  nodeId: string
  property: string
  mapping: ControlMapping
  enabled: boolean
}

// ============================================================================
// 5. ControlMapping - 值映射
// ============================================================================

/**
 * 值映射(把输入信号 0-1 映射到目标参数范围)。
 *
 * - inMin/inMax:     输入范围(通常 0-1,但可裁剪如 0.2-0.8)
 * - outMin/outMax:   输出范围(如 scale 的 0.5-3.0)
 * - curve:           映射曲线(linear / exponential / logarithmic)
 * - smoothing:       平滑系数(0=无平滑, 1=完全平滑,默认 0.3)
 *
 * 示例:
 *   bass(0-1) → scale(0.5-3.0)
 *   mapping = { inMin: 0, inMax: 1, outMin: 0.5, outMax: 3.0, curve: 'linear', smoothing: 0.3 }
 */
export interface ControlMapping {
  inMin: number
  inMax: number
  outMin: number
  outMax: number
  curve: MappingCurve
  smoothing: number
}

/** 映射曲线类型 */
export type MappingCurve = 'linear' | 'exponential' | 'logarithmic'

/** 默认映射(0-1 → 0-1,线性,无平滑) */
export const DEFAULT_MAPPING: ControlMapping = {
  inMin: 0,
  inMax: 1,
  outMin: 0,
  outMax: 1,
  curve: 'linear',
  smoothing: 0,
}

// ============================================================================
// 6. MIDI 消息
// ============================================================================

/**
 * MIDI 消息类型(简化版,仅支持本系统需要的)。
 *
 * - noteon:   音符按下(data[1]=音高, data[2]=力度 0-127)
 * - noteoff:  音符释放
 * - cc:       控制变化(旋钮 / 滑块,data[1]=cc 号, data[2]=值 0-127)
 * - pitchbend:弯音轮
 */
export type MidiMessageType = 'noteon' | 'noteoff' | 'cc' | 'pitchbend'

/**
 * 解析后的 MIDI 消息。
 *
 * - type:    消息类型
 * - channel: 通道(0-15)
 * - value1:  第一个数据字节(音高 / cc 号)
 * - value2:  第二个数据字节(力度 / cc 值),0-127
 */
export interface MidiMessage {
  type: MidiMessageType
  channel: number
  value1: number
  value2: number
  timestamp: number
}

// ============================================================================
// 7. 默认值 / 工具
// ============================================================================

/** 信号超时时间(毫秒,超过则标记为 inactive) */
export const SIGNAL_TIMEOUT_MS = 1000

/** 生成简单唯一 id */
let inputIdCounter = 0
export function genInputId(prefix: string = 'input'): string {
  inputIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${inputIdCounter.toString(36)}`
}

/** 频段名 → 信号 id 的约定 */
export const AUDIO_SIGNAL_IDS = {
  volume: 'audio.volume',
  bass: 'audio.bass',
  mid: 'audio.mid',
  high: 'audio.high',
  beat: 'audio.beat', // beat 是 0/1 信号(0=无鼓点, 1=有鼓点)
  bpm: 'audio.bpm',
} as const

/** 摄像头信号 id 约定 */
export const CAMERA_SIGNAL_IDS = {
  motion: 'camera.motion',
  brightness: 'camera.brightness',
} as const
