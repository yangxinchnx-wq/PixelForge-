/**
 * 增益与淡入淡出(Step 41.2)— 参数模型 + 包络计算纯函数。
 *
 * 职责:
 * - 定义增益参数模型(静态增益 + 淡入 + 淡出 + 曲线类型)
 * - 计算任意时间点的包络乘数(0 ~ 1)
 *
 * 纯函数,零 Web Audio / DOM 依赖。运行时层用 GainNode 的
 * `gain.setValueCurveAtTime` 或逐帧 setTargetAtTime 承载同样的包络。
 *
 * 数据流:
 *   GainParams + 当前时间
 *     ↓ computeFadeMultiplier
 *   包络乘数(0 ~ 1)
 *     ↓ 乘以静态增益
 *   实际增益
 */

import { clampGainDb, dbToLinear } from '../core/units'

// ============================================================================
// 1. 参数模型
// ============================================================================

/** 淡入淡出曲线类型(以数字存储,便于放进 Record<string, number> 参数表) */
export type FadeCurve = 0 | 1 | 2

/** 曲线类型枚举值 */
export const FADE_CURVE = {
  /** 线性 */
  LINEAR: 0,
  /** 指数(听觉上更自然) */
  EXPONENTIAL: 1,
  /** S 曲线(smoothstep,首尾平滑) */
  SCURVE: 2,
} as const satisfies Record<string, FadeCurve>

/** 曲线显示名 */
export const FADE_CURVE_LABELS: Record<FadeCurve, string> = {
  0: '线性',
  1: '指数',
  2: 'S 曲线',
}

/** 增益参数 */
export type GainParams = {
  /** 静态增益(dB) */
  gainDb: number
  /** 淡入时长(毫秒),0 表示不淡入 */
  fadeInMs: number
  /** 淡出时长(毫秒),0 表示不淡出 */
  fadeOutMs: number
  /** 淡入淡出曲线类型 */
  fadeCurve: FadeCurve
}

/** 增益默认参数(单位增益,无淡入淡出) */
export const DEFAULT_GAIN_PARAMS: GainParams = {
  gainDb: 0,
  fadeInMs: 0,
  fadeOutMs: 0,
  fadeCurve: FADE_CURVE.LINEAR,
}

// ============================================================================
// 2. 参数校验
// ============================================================================

/**
 * 把增益参数限制在合法范围内。
 */
export function clampGainParams(params: GainParams): GainParams {
  const clamp = (v: number, min: number, max: number, fallback: number): number => {
    if (Number.isNaN(v)) return fallback
    return Math.min(max, Math.max(min, v))
  }

  const curve = clamp(params.fadeCurve, 0, 2, FADE_CURVE.LINEAR) as FadeCurve

  return {
    gainDb: clampGainDb(params.gainDb),
    fadeInMs: clamp(params.fadeInMs, 0, 60000, 0),
    fadeOutMs: clamp(params.fadeOutMs, 0, 60000, 0),
    fadeCurve: curve,
  }
}

// ============================================================================
// 3. 曲线
// ============================================================================

/**
 * 把 0~1 的线性进度按指定曲线重映射。
 *
 * @param t 线性进度(0 ~ 1),越界会被 clamp
 * @param curve 曲线类型
 * @returns 重映射后的值(0 ~ 1)
 */
export function applyFadeCurve(t: number, curve: FadeCurve): number {
  const x = Math.min(1, Math.max(0, Number.isNaN(t) ? 0 : t))

  switch (curve) {
    case FADE_CURVE.EXPONENTIAL:
      // 指数上升:起始变化快、接近 1 时逐渐变缓,听觉上更接近"自然淡入"
      // 用 (1 - e^{-5x}) / (1 - e^{-5}) 归一化,保证端点严格为 0 和 1
      return (1 - Math.exp(-5 * x)) / (1 - Math.exp(-5))
    case FADE_CURVE.SCURVE:
      // smoothstep:首尾导数为 0,过渡最柔和
      return x * x * (3 - 2 * x)
    case FADE_CURVE.LINEAR:
    default:
      return x
  }
}

// ============================================================================
// 4. 包络
// ============================================================================

/**
 * 计算指定时间点上的淡入淡出乘数。
 *
 * 淡入区:从 0 升到 1;淡出区:从 1 降到 0;中间恒为 1。
 * 若淡入与淡出区间重叠(音频过短),取两者乘积,保证末尾一定归零。
 *
 * @param params 增益参数(会被 clamp)
 * @param elapsedMs 已播放时间(毫秒)
 * @param totalMs 素材总时长(毫秒)
 * @returns 包络乘数(0 ~ 1)
 */
export function computeFadeMultiplier(
  params: GainParams,
  elapsedMs: number,
  totalMs: number,
): number {
  const p = clampGainParams(params)

  if (Number.isNaN(elapsedMs)) return 0
  if (Number.isNaN(totalMs) || totalMs <= 0) return 0

  // 超出素材范围视为静音
  if (elapsedMs < 0 || elapsedMs > totalMs) return 0

  let multiplier = 1

  // 淡入
  if (p.fadeInMs > 0) {
    if (elapsedMs < p.fadeInMs) {
      multiplier *= applyFadeCurve(elapsedMs / p.fadeInMs, p.fadeCurve)
    }
  }

  // 淡出
  if (p.fadeOutMs > 0) {
    const fadeOutStart = totalMs - p.fadeOutMs
    if (elapsedMs > fadeOutStart) {
      const remaining = totalMs - elapsedMs
      multiplier *= applyFadeCurve(remaining / p.fadeOutMs, p.fadeCurve)
    }
  }

  return Math.min(1, Math.max(0, multiplier))
}

/**
 * 计算完整增益(静态增益 × 包络),返回线性值。
 *
 * @param params 增益参数
 * @param elapsedMs 已播放时间(毫秒)
 * @param totalMs 素材总时长(毫秒)
 */
export function computeTotalGainLinear(
  params: GainParams,
  elapsedMs: number,
  totalMs: number,
): number {
  const p = clampGainParams(params)
  return dbToLinear(p.gainDb) * computeFadeMultiplier(p, elapsedMs, totalMs)
}

/**
 * 对单个采样值应用完整增益。
 */
export function applyGainEnvelope(
  sample: number,
  params: GainParams,
  elapsedMs: number,
  totalMs: number,
): number {
  if (Number.isNaN(sample)) return 0
  return sample * computeTotalGainLinear(params, elapsedMs, totalMs)
}

/**
 * 计算包络达到指定比例所需的时间(毫秒)。
 *
 * 用于测试与 UI 显示(例如"淡入到 -3dB 需要多久")。
 *
 * @param ratio 目标比例(0 ~ 1)
 * @param fadeMs 淡变时长
 * @param curve 曲线类型
 * @param isFadeOut 是否为淡出(淡出时返回距末尾的时间)
 */
export function computeFadeTimeAt(
  ratio: number,
  fadeMs: number,
  curve: FadeCurve,
  isFadeOut = false,
): number {
  const target = Math.min(1, Math.max(0, Number.isNaN(ratio) ? 0 : ratio))

  // 对指数 / S 曲线求逆:二分查找足够精确且实现简单
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (applyFadeCurve(mid, curve) < target) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const t = (lo + hi) / 2
  const time = t * fadeMs
  return isFadeOut ? fadeMs - time : time
}
