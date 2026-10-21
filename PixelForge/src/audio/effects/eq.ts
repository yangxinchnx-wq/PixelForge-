/**
 * 三段参数 EQ(Step 41.2)— 参数模型 + 频响计算纯函数。
 *
 * 职责:
 * - 定义 EQ 的参数模型、默认值与取值范围
 * - 提供频响计算(用于测试与频响曲线可视化)
 *
 * 纯函数,零 Web Audio / DOM 依赖。运行时层用 BiquadFilterNode
 * (lowshelf / peaking / highshelf)承载同样的参数。
 *
 * 数据流:
 *   EqParams
 *     ↓ computeEqGainDb(在给定频点)
 *   该频点的增益(dB)
 *     ↓ 频响曲线渲染 / 单测断言
 */

// ============================================================================
// 1. 参数模型
// ============================================================================

/** EQ 参数(三段 shelving + 两个分频点) */
export type EqParams = {
  /** 低频增益(dB) */
  lowGainDb: number
  /** 中频增益(dB) */
  midGainDb: number
  /** 高频增益(dB) */
  highGainDb: number
  /** 低/中分频点(Hz) */
  lowFreqHz: number
  /** 中/高分频点(Hz) */
  highFreqHz: number
}

/** EQ 默认参数(全平) */
export const DEFAULT_EQ_PARAMS: EqParams = {
  lowGainDb: 0,
  midGainDb: 0,
  highGainDb: 0,
  lowFreqHz: 250,
  highFreqHz: 4000,
}

// ============================================================================
// 2. 参数校验
// ============================================================================

/**
 * 把 EQ 参数限制在合法范围内。
 *
 * 同时保证 lowFreqHz < highFreqHz,否则分频点失去意义。
 */
export function clampEqParams(params: EqParams): EqParams {
  const clamp = (v: number, min: number, max: number, fallback: number): number => {
    if (Number.isNaN(v)) return fallback
    return Math.min(max, Math.max(min, v))
  }

  let lowFreqHz = clamp(params.lowFreqHz, 20, 20000, DEFAULT_EQ_PARAMS.lowFreqHz)
  let highFreqHz = clamp(params.highFreqHz, 20, 20000, DEFAULT_EQ_PARAMS.highFreqHz)

  // 分频点必须有序;相等时把高频点上推一个八度,避免除零与权重塌陷
  if (highFreqHz <= lowFreqHz) {
    highFreqHz = Math.min(20000, lowFreqHz * 2)
    if (highFreqHz <= lowFreqHz) {
      lowFreqHz = highFreqHz / 2
    }
  }

  return {
    lowGainDb: clamp(params.lowGainDb, -24, 24, 0),
    midGainDb: clamp(params.midGainDb, -24, 24, 0),
    highGainDb: clamp(params.highGainDb, -24, 24, 0),
    lowFreqHz,
    highFreqHz,
  }
}

// ============================================================================
// 3. 频响计算
// ============================================================================

/**
 * 计算低频段权重(0~1)。
 *
 * 低于分频点时接近 1,高于时快速衰减到 0,用一阶滚降近似 shelving 滤波器的过渡带。
 */
export function lowBandWeight(freqHz: number, lowFreqHz: number): number {
  if (freqHz <= 0) return 1
  if (lowFreqHz <= 0) return 0
  const r = freqHz / lowFreqHz
  return 1 / (1 + r * r)
}

/**
 * 计算高频段权重(0~1)。
 *
 * 高于分频点时接近 1,低于时衰减到 0。
 */
export function highBandWeight(freqHz: number, highFreqHz: number): number {
  if (highFreqHz <= 0) return 1
  if (freqHz <= 0) return 0
  const r = freqHz / highFreqHz
  const r2 = r * r
  return r2 / (1 + r2)
}

/**
 * 计算指定频点的 EQ 增益(dB)。
 *
 * 三段权重之和归一化为 1,保证只提升某一个频段时,另外两个频段不受影响。
 *
 * @param params EQ 参数(会被 clamp)
 * @param freqHz 目标频点
 * @returns 该频点的增益(dB)
 *
 * @example
 * computeEqGainDb({ ...DEFAULT_EQ_PARAMS, lowGainDb: 6 }, 50)   // ≈ +6
 * computeEqGainDb({ ...DEFAULT_EQ_PARAMS, lowGainDb: 6 }, 8000) // ≈ 0
 */
export function computeEqGainDb(params: EqParams, freqHz: number): number {
  const p = clampEqParams(params)
  if (Number.isNaN(freqHz) || freqHz <= 0) return 0

  const wLow = lowBandWeight(freqHz, p.lowFreqHz)
  const wHigh = highBandWeight(freqHz, p.highFreqHz)
  // 中频取剩余权重,下限截断到 0(两个 shelving 重叠时可能出现负值)
  const wMid = Math.max(0, 1 - wLow - wHigh)

  const total = wLow + wMid + wHigh
  if (total <= 0) return 0

  // 归一化,保证权重和为 1
  return (p.lowGainDb * wLow + p.midGainDb * wMid + p.highGainDb * wHigh) / total
}

/**
 * 计算 EQ 在给定频点上的线性增益。
 */
export function computeEqGainLinear(params: EqParams, freqHz: number): number {
  return Math.pow(10, computeEqGainDb(params, freqHz) / 20)
}

/**
 * 采样一条频响曲线(用于绘制 EQ 频响图)。
 *
 * @param params EQ 参数
 * @param sampleCount 采样点数
 * @param minHz 起始频率
 * @param maxHz 结束频率
 * @returns 频点与增益(dB)的成对数组,频率按对数分布
 */
export function sampleEqResponse(
  params: EqParams,
  sampleCount = 64,
  minHz = 20,
  maxHz = 20000,
): Array<{ freqHz: number; gainDb: number }> {
  const points: Array<{ freqHz: number; gainDb: number }> = []
  if (sampleCount <= 1) return points

  const logMin = Math.log(minHz)
  const logMax = Math.log(maxHz)
  for (let i = 0; i < sampleCount; i++) {
    const t = i / (sampleCount - 1)
    const freqHz = Math.exp(logMin + (logMax - logMin) * t)
    points.push({ freqHz, gainDb: computeEqGainDb(params, freqHz) })
  }
  return points
}
