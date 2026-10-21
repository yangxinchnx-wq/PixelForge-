/**
 * 动态压缩器(Step 41.2)— 参数模型 + 增益衰减计算纯函数。
 *
 * 职责:
 * - 定义压缩器参数模型与默认值
 * - 计算给定输入电平下的增益衰减量(含软拐点)
 * - 计算 attack / release 的时间常数系数
 *
 * 纯函数,零 Web Audio / DOM 依赖。运行时层用 DynamicsCompressorNode
 * 承载同样的语义。
 *
 * 数据流:
 *   输入电平(dB)
 *     ↓ computeGainReductionDb
 *   增益衰减量(dB,≤ 0)
 *     ↓ 叠加到输出
 *   压缩后电平
 */

// ============================================================================
// 1. 参数模型
// ============================================================================

/** 压缩器参数 */
export type CompressorParams = {
  /** 阈值(dB),超过此电平开始压缩 */
  thresholdDb: number
  /** 压缩比,1 表示不压缩,∞ 表示限幅 */
  ratio: number
  /** 启动时间(毫秒) */
  attackMs: number
  /** 释放时间(毫秒) */
  releaseMs: number
  /** 软拐点宽度(dB),0 表示硬拐点 */
  kneeDb: number
}

/** 压缩器默认参数(通用人声/乐器设定) */
export const DEFAULT_COMPRESSOR_PARAMS: CompressorParams = {
  thresholdDb: -18,
  ratio: 4,
  attackMs: 10,
  releaseMs: 250,
  kneeDb: 6,
}

// ============================================================================
// 2. 参数校验
// ============================================================================

/**
 * 把压缩器参数限制在合法范围内。
 */
export function clampCompressorParams(params: CompressorParams): CompressorParams {
  const clamp = (v: number, min: number, max: number, fallback: number): number => {
    if (Number.isNaN(v)) return fallback
    return Math.min(max, Math.max(min, v))
  }

  return {
    thresholdDb: clamp(params.thresholdDb, -60, 0, DEFAULT_COMPRESSOR_PARAMS.thresholdDb),
    ratio: clamp(params.ratio, 1, 20, DEFAULT_COMPRESSOR_PARAMS.ratio),
    attackMs: clamp(params.attackMs, 0.1, 200, DEFAULT_COMPRESSOR_PARAMS.attackMs),
    releaseMs: clamp(params.releaseMs, 10, 2000, DEFAULT_COMPRESSOR_PARAMS.releaseMs),
    kneeDb: clamp(params.kneeDb, 0, 24, DEFAULT_COMPRESSOR_PARAMS.kneeDb),
  }
}

// ============================================================================
// 3. 增益衰减
// ============================================================================

/**
 * 计算增益衰减量(dB)。
 *
 * 硬拐点(knee = 0):
 *   输入低于阈值时不压缩;高于阈值时按
 *   `-(input - threshold) × (1 - 1/ratio)` 衰减。
 *
 * 软拐点(knee > 0):
 *   在 `[threshold - knee/2, threshold + knee/2]` 区间内用二次曲线平滑过渡,
 *   避免压缩器在阈值附近产生"呼吸"式的突变。
 *
 * @param inputDb 输入电平(dB)
 * @param params 压缩器参数(会被 clamp)
 * @returns 增益衰减量,恒 ≤ 0
 *
 * @example
 * // 阈值 -18dB、比值 4、硬拐点,输入 -10dB
 * // 超出 8dB → 衰减 8 × (1 - 1/4) = 6dB
 * computeGainReductionDb(-10, { ...DEFAULT_COMPRESSOR_PARAMS, kneeDb: 0 })
 */
export function computeGainReductionDb(inputDb: number, params: CompressorParams): number {
  if (Number.isNaN(inputDb)) return 0

  const p = clampCompressorParams(params)
  const slope = 1 - 1 / p.ratio

  // 比值为 1 时不做任何压缩
  if (p.ratio <= 1) return 0

  // 硬拐点
  if (p.kneeDb <= 0) {
    if (inputDb <= p.thresholdDb) return 0
    return -(inputDb - p.thresholdDb) * slope
  }

  const lower = p.thresholdDb - p.kneeDb / 2
  const upper = p.thresholdDb + p.kneeDb / 2

  // 拐点以下:不压缩
  if (inputDb <= lower) return 0

  // 拐点以上:与硬拐点一致
  if (inputDb >= upper) {
    return -(inputDb - p.thresholdDb) * slope
  }

  // 拐点区间:二次平滑过渡,保证在 upper 处与硬拐点解连续
  const x = inputDb - lower
  return -(slope * x * x) / (2 * p.kneeDb)
}

/**
 * 计算压缩后的输出电平(dB)。
 */
export function computeCompressorOutputDb(inputDb: number, params: CompressorParams): number {
  return inputDb + computeGainReductionDb(inputDb, params)
}

/**
 * 计算自动补偿增益(dB)。
 *
 * 压缩会整体拉低响度,补偿增益把峰值拉回目标电平,便于 A/B 对比时感知一致。
 *
 * @param params 压缩器参数
 * @param targetDb 期望的目标峰值(dB),默认 0
 */
export function computeMakeupGainDb(
  params: CompressorParams,
  targetDb: number = 0,
): number {
  const p = clampCompressorParams(params)
  if (p.ratio <= 1) return 0

  // 以"目标电平被压缩后损失多少"作为补偿量
  const reduction = computeGainReductionDb(targetDb, p)
  return -reduction
}

// ============================================================================
// 4. 时间常数
// ============================================================================

/**
 * 计算单极点平滑系数。
 *
 * 用于运行时层把 attack / release 的毫秒值转换为每个采样点的递推系数:
 * `coef = exp(-1 / (timeMs × 0.001 × sampleRate))`
 *
 * @param timeMs 时间常数(毫秒)
 * @param sampleRate 采样率
 * @returns 平滑系数(0 ~ 1),越小表示跟随越快
 */
export function computeEnvelopeCoef(timeMs: number, sampleRate: number): number {
  if (Number.isNaN(timeMs) || timeMs <= 0) return 0
  if (Number.isNaN(sampleRate) || sampleRate <= 0) return 0
  const samples = timeMs * 0.001 * sampleRate
  return Math.exp(-1 / samples)
}

/**
 * 同时给出 attack 与 release 的平滑系数。
 */
export function computeEnvelopeCoefs(
  params: CompressorParams,
  sampleRate: number,
): { attack: number; release: number } {
  const p = clampCompressorParams(params)
  return {
    attack: computeEnvelopeCoef(p.attackMs, sampleRate),
    release: computeEnvelopeCoef(p.releaseMs, sampleRate),
  }
}
