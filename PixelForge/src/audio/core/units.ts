/**
 * 音频单位换算(Step 41.1)— dB / 线性互转、增益应用、等功率声像。
 *
 * 职责:
 * - 提供音频数学的基础换算函数
 * - 全部为纯函数,零 Web Audio / DOM 依赖,可直接单测
 *
 * 数据流:
 *   用户调参(dB / 声像)
 *     ↓ dbToLinear / panToGainPair
 *   线性增益
 *     ↓ runtime.audioGraph
 *   GainNode / StereoPannerNode
 *
 * 约定:
 * - dB 为功率比时系数是 10,为幅度比时系数是 20;本模块全部按幅度处理,统一用 20
 * - 静音阈值为 -60dB,低于该值的增益视为 0(避免 10^-60 这类极小值参与运算)
 */

// ============================================================================
// 1. 常量
// ============================================================================

/** 静音阈值(dB):低于此值的增益按 0 处理 */
export const SILENCE_DB = -60

/** 增益下限(dB) */
export const GAIN_DB_MIN = -60

/** 增益上限(dB) */
export const GAIN_DB_MAX = 12

// ============================================================================
// 2. dB ↔ 线性
// ============================================================================

/**
 * dB 转线性增益(幅度比)。
 *
 * @param db 分贝值,负无穷表示完全静音
 * @returns 线性增益(0 ~ +∞)
 *
 * @example
 * dbToLinear(0)   // 1
 * dbToLinear(6)   // ≈ 1.995
 * dbToLinear(-6)  // ≈ 0.501
 */
export function dbToLinear(db: number): number {
  if (Number.isNaN(db)) return 0
  if (db === Number.NEGATIVE_INFINITY) return 0
  if (db <= SILENCE_DB) return 0
  return Math.pow(10, db / 20)
}

/**
 * 线性增益转 dB。
 *
 * @param linear 线性增益
 * @returns 分贝值;linear <= 0 时返回负无穷
 */
export function linearToDb(linear: number): number {
  if (Number.isNaN(linear) || linear <= 0) return Number.NEGATIVE_INFINITY
  return 20 * Math.log10(linear)
}

// ============================================================================
// 3. 增益与限幅
// ============================================================================

/**
 * 把数值限制在指定区间内。
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 把增益限制在合法 dB 区间 [GAIN_DB_MIN, GAIN_DB_MAX]。
 */
export function clampGainDb(db: number): number {
  if (Number.isNaN(db)) return GAIN_DB_MIN
  if (db === Number.NEGATIVE_INFINITY) return GAIN_DB_MIN
  return clamp(db, GAIN_DB_MIN, GAIN_DB_MAX)
}

/**
 * 把声像限制在合法区间 [-1, 1]。
 */
export function clampPan(pan: number): number {
  if (Number.isNaN(pan)) return 0
  return clamp(pan, -1, 1)
}

/**
 * 叠加增益(dB 域相加,等价于线性域相乘)。
 *
 * @param baseDb 原始增益
 * @param deltaDb 叠加的增量
 * @returns 叠加后并 clamp 的增益
 */
export function applyGainDb(baseDb: number, deltaDb: number): number {
  return clampGainDb(baseDb + deltaDb)
}

/**
 * 对线性采样值应用 dB 增益。
 */
export function applyGainToSample(sample: number, gainDb: number): number {
  return sample * dbToLinear(gainDb)
}

// ============================================================================
// 4. 声像
// ============================================================================

/**
 * 立体声声像增益对(等功率律)。
 *
 * 等功率律保证 pan 从 -1 扫到 +1 时总功率恒定,不会出现中间位置音量下陷
 * (线性律在中间位置会有 -6dB 的功率损失)。
 *
 * @param pan 声像,-1 左 ~ 0 中 ~ +1 右,越界值会被 clamp
 * @returns 左右声道线性增益
 *
 * @example
 * panToGainPair(-1)  // { left: 1, right: 0 }
 * panToGainPair(0)   // { left: ≈0.707, right: ≈0.707 }
 * panToGainPair(1)   // { left: 0, right: 1 }
 */
export function panToGainPair(pan: number): { left: number; right: number } {
  const p = clampPan(pan)
  // 把 pan 从 [-1,1] 映射到角度 [0, π/2]
  const angle = ((p + 1) * Math.PI) / 4
  return {
    left: Math.cos(angle),
    right: Math.sin(angle),
  }
}

/**
 * 线性律声像(供对比与 A/B 测试使用)。
 *
 * 中间位置左右各 0.5,相加为 1,即中心位置相比两侧有约 6dB 的幅度损失,
 * 一般不用于正式混音。保留此函数以便测试验证等功率律的优势。
 *
 * @example
 * panToGainPairLinear(0)  // { left: 0.5, right: 0.5 }
 */
export function panToGainPairLinear(pan: number): { left: number; right: number } {
  const p = clampPan(pan)
  return {
    left: (1 - p) / 2,
    right: (1 + p) / 2,
  }
}

// ============================================================================
// 5. 归一化
// ============================================================================

/**
 * 把线性幅度归一化为 0~1 的电平值(用于电平表显示)。
 *
 * 超出 1.0 的部分会被截断,同时由调用方判断是否削波。
 */
export function normalizeAmplitude(amplitude: number): number {
  if (Number.isNaN(amplitude)) return 0
  return clamp(Math.abs(amplitude), 0, 1)
}
