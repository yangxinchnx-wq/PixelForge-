/**
 * 节拍检测(Step 41.6)— 能量差分 + 方差自适应阈值 + 最小间隔约束。
 *
 * 职责:
 * - 维护短时能量历史,计算局部均值与方差
 * - 用方差自适应阈值判定当前帧是否为节拍
 * - 用最小间隔抑制同一拍被重复触发
 *
 * 纯函数 + 不可变状态,零 Web Audio / DOM 依赖。
 * 每帧调用 detectBeat,返回新状态与新判定结果。
 *
 * 算法说明:
 *   阈值系数 C 随方差增大而减小——能量平稳(方差小)时需要更突出的峰值才判定为节拍,
 *   能量起伏剧烈(方差大)时阈值相应放宽。这是经典简单节拍检测(V. Simon)的做法:
 *   `C = -0.0025714 × V + 1.5142857`
 *
 * 数据流:
 *   逐帧能量(0~1)
 *     ↓ detectBeat
 *   { isBeat, strength, state }
 *     ↓ audioInput
 *   inputRouter.setSignal('audio.beat', strength)
 */

// ============================================================================
// 1. 配置与状态
// ============================================================================

/** 节拍检测器配置 */
export interface BeatDetectorConfig {
  /** 能量历史长度(帧),默认 43 约等于 60fps 下的 0.7 秒 */
  historySize: number
  /** 灵敏度乘数,越大越难触发,默认 1.0 */
  sensitivity: number
  /** 相邻节拍的最小间隔(毫秒),默认 250(约 240 BPM 上限) */
  minIntervalMs: number
  /** 触发节拍所需的最小绝对能量,避免静音段误触发 */
  minEnergy: number
}

/** 节拍检测器状态 */
export interface BeatDetectorState {
  /** 能量历史(最新在末尾) */
  history: number[]
  /** 上一次触发节拍的时间戳(毫秒),初始为负无穷表示从未触发 */
  lastBeatMs: number
}

/** 默认配置 */
export const DEFAULT_BEAT_CONFIG: BeatDetectorConfig = {
  historySize: 43,
  sensitivity: 1.0,
  minIntervalMs: 250,
  minEnergy: 0.02,
}

/** 方差自适应阈值系数 */
const VARIANCE_BASE = 1.5142857
const VARIANCE_COEF = 0.0025714
/** 阈值系数的上下界,防止方差极端时阈值失控 */
const C_MIN = 1.1
const C_MAX = 2.0

// ============================================================================
// 2. 构造
// ============================================================================

/**
 * 创建初始状态。
 *
 * @param history 可选的初始历史(用于测试注入)
 */
export function createBeatDetectorState(history?: number[]): BeatDetectorState {
  return {
    history: history ? [...history] : [],
    lastBeatMs: Number.NEGATIVE_INFINITY,
  }
}

// ============================================================================
// 3. 统计量
// ============================================================================

/**
 * 计算均值。
 */
export function computeMean(values: number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  let validCount = 0
  for (const v of values) {
    // 跳过 NaN 且不计入有效样本数,避免脏数据拉低均值
    if (Number.isNaN(v)) continue
    sum += v
    validCount++
  }
  if (validCount === 0) return 0
  return sum / validCount
}

/**
 * 计算方差。
 */
export function computeVariance(values: number[]): number {
  if (values.length === 0) return 0
  const mean = computeMean(values)
  let sum = 0
  let validCount = 0
  for (const v of values) {
    if (Number.isNaN(v)) continue
    const d = v - mean
    sum += d * d
    validCount++
  }
  if (validCount === 0) return 0
  return sum / validCount
}

/**
 * 由方差推导阈值系数 C。
 *
 * 方差越大(能量起伏越剧烈),C 越小(阈值越低)。
 */
export function computeThresholdCoef(variance: number): number {
  if (Number.isNaN(variance)) return VARIANCE_BASE
  const c = VARIANCE_BASE - VARIANCE_COEF * variance
  return Math.min(C_MAX, Math.max(C_MIN, c))
}

// ============================================================================
// 4. 检测
// ============================================================================

/** 单次检测结果 */
export interface BeatDetectionResult {
  /** 是否为节拍 */
  isBeat: boolean
  /** 节拍强度(0 ~ 1),非节拍帧为 0 */
  strength: number
  /** 更新后的状态(新对象) */
  state: BeatDetectorState
}

/**
 * 判定当前帧是否为节拍。
 *
 * 判定条件(需同时满足):
 * 1. 当前能量高于 `C × 局部均值 × sensitivity`
 * 2. 当前能量高于绝对下限 `minEnergy`(避免静音段噪声触发)
 * 3. 距上一次节拍已超过 `minIntervalMs`
 *
 * 历史不足(前几帧)时只累积、不判定,避免冷启动误报。
 *
 * @param state 上一帧状态
 * @param energy 当前帧能量(0~1)
 * @param nowMs 当前时间戳(毫秒)
 * @param config 配置
 * @returns 判定结果与新状态(不修改入参)
 */
export function detectBeat(
  state: BeatDetectorState,
  energy: number,
  nowMs: number,
  config: BeatDetectorConfig = DEFAULT_BEAT_CONFIG,
): BeatDetectionResult {
  const e = Number.isNaN(energy) ? 0 : Math.min(1, Math.max(0, energy))

  // 追加历史并裁剪到窗口长度
  const size = Math.max(1, Math.floor(config.historySize))
  const history = [...state.history, e]
  if (history.length > size) {
    history.splice(0, history.length - size)
  }

  const nextState: BeatDetectorState = {
    history,
    lastBeatMs: state.lastBeatMs,
  }

  // 历史不足:只累积,不判定
  if (history.length < size) {
    return { isBeat: false, strength: 0, state: nextState }
  }

  const mean = computeMean(history)
  const variance = computeVariance(history)
  const coef = computeThresholdCoef(variance)
  const threshold = mean * coef * config.sensitivity

  // 静音保护:均值过低时不做判定
  if (mean < config.minEnergy) {
    return { isBeat: false, strength: 0, state: nextState }
  }

  const intervalOk = nowMs - state.lastBeatMs >= config.minIntervalMs

  if (e > threshold && e >= config.minEnergy && intervalOk) {
    // 强度按超出阈值的相对量归一化
    const strength = Math.min(1, (e - threshold) / Math.max(threshold, 1e-6))
    return {
      isBeat: true,
      strength,
      state: { history, lastBeatMs: nowMs },
    }
  }

  return { isBeat: false, strength: 0, state: nextState }
}

/**
 * 判定当前帧是否为节拍(忽略最小间隔约束)。
 *
 * 仅用于测试与离线分析。
 */
export function isBeatEnergy(
  history: number[],
  energy: number,
  config: BeatDetectorConfig = DEFAULT_BEAT_CONFIG,
): boolean {
  if (history.length === 0) return false
  const mean = computeMean(history)
  const variance = computeVariance(history)
  const coef = computeThresholdCoef(variance)
  const threshold = mean * coef * config.sensitivity
  return energy > threshold && energy >= config.minEnergy
}
