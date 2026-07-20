/**
 * Time(Step 31.1)— 专业视频时间系统。
 *
 * 核心设计:
 * - 使用 bigint 微秒(microsecond)作为内部时间单位
 * - 1 秒 = 1_000_000 ticks(微秒)
 * - 避免 float 累积误差导致的丢帧 / 音画不同步
 *
 * 帧转换:
 * - frameToTime(frame, fps):  帧号 → 微秒(整数除法,无漂移)
 * - timeToFrame(time, fps):   微秒 → 帧号(四舍五入)
 *
 * 用法:
 *   const t = seconds(5)              // 5_000_000n
 *   const f = frames(150, 30)        // 5_000_000n
 *   const frame = timeToFrame(t, 30) // 150
 */

// ============================================================================
// 1. 类型与常量
// ============================================================================

/**
 * 时间类型(bigint 微秒)。
 *
 * 为什么用 bigint:
 * - number 在 2^53 后丢失精度(约 104 天 @ 微秒精度)
 * - bigint 无上限,适合长时间线
 * - 整数运算无浮点误差
 */
export type Time = bigint

/** 1 秒 = 1_000_000 微秒 */
export const SECOND: Time = 1_000_000n

/** 1 毫秒 = 1_000 微秒 */
export const MILLI: Time = 1_000n

/** 零时间 */
export const ZERO: Time = 0n

// ============================================================================
// 2. 构造函数(从秒 / 毫秒 / 帧)
// ============================================================================

/**
 * 从秒构造 Time(向下取整到微秒)。
 *
 * @param s 秒(浮点)
 * @returns 微秒时间
 *
 * @example
 *   seconds(5)       // 5_000_000n
 *   seconds(3.5)     // 3_500_000n
 *   seconds(0.033)   // 33_000n(约 1 帧 @ 30fps)
 */
export function seconds(s: number): Time {
  return BigInt(Math.floor(s * Number(SECOND)))
}

/**
 * 从毫秒构造 Time。
 *
 * @param ms 毫秒(浮点)
 * @returns 微秒时间
 */
export function millis(ms: number): Time {
  return BigInt(Math.floor(ms * Number(MILLI)))
}

/**
 * 从帧号构造 Time(精确,无漂移)。
 *
 * 使用整数除法: time = frame * 1_000_000 / fps
 * 保证 frame 0 → 0, frame fps → 1_000_000(整秒)
 *
 * @param frame 帧号(从 0 开始)
 * @param fps   帧率(24/25/30/60 等)
 * @returns 微秒时间
 *
 * @example
 *   frames(0, 30)    // 0n
 *   frames(30, 30)   // 1_000_000n(1 秒)
 *   frames(60, 30)   // 2_000_000n(2 秒)
 *   frames(1, 30)    // 33_333n(1/30 秒)
 */
export function frames(frame: number, fps: number): Time {
  if (fps <= 0) throw new Error(`frames: fps 必须为正数,收到 ${fps}`)
  if (frame < 0) throw new Error(`frames: frame 不能为负,收到 ${frame}`)
  return (BigInt(frame) * SECOND) / BigInt(fps)
}

// ============================================================================
// 3. 转换函数(到秒 / 毫秒 / 帧)
// ============================================================================

/**
 * Time → 秒(浮点)。
 *
 * 注意:浮点转换可能有精度损失,仅用于显示 / UI。
 * 内部计算始终用 bigint。
 */
export function toSeconds(time: Time): number {
  return Number(time) / Number(SECOND)
}

/**
 * Time → 毫秒(浮点)。
 */
export function toMillis(time: Time): number {
  return Number(time) / Number(MILLI)
}

/**
 * Time → 帧号(四舍五入到最近帧)。
 *
 * @param time 微秒时间
 * @param fps  帧率
 * @returns 帧号(整数)
 *
 * @example
 *   timeToFrame(1_000_000n, 30)   // 30
 *   timeToFrame(500_000n, 30)     // 15
 *   timeToFrame(33_333n, 30)      // 1
 */
export function timeToFrame(time: Time, fps: number): number {
  if (fps <= 0) throw new Error(`timeToFrame: fps 必须为正数,收到 ${fps}`)
  // 四舍五入: time * fps / 1_000_000
  const numerator = time * BigInt(fps)
  const quotient = numerator / SECOND
  const remainder = numerator % SECOND
  // 四舍五入:余数 >= SECOND/2 则进位
  if (remainder * 2n >= SECOND) {
    return Number(quotient) + 1
  }
  return Number(quotient)
}

// ============================================================================
// 4. 运算工具
// ============================================================================

/** 加法 */
export function add(a: Time, b: Time): Time {
  return a + b
}

/** 减法(结果 >= 0) */
export function sub(a: Time, b: Time): Time {
  const r = a - b
  return r < 0n ? 0n : r
}

/** 乘以标量 */
export function mul(a: Time, factor: number): Time {
  if (factor < 0) throw new Error(`mul: factor 不能为负,收到 ${factor}`)
  return BigInt(Math.floor(Number(a) * factor))
}

/** 除以标量 */
export function div(a: Time, divisor: number): Time {
  if (divisor <= 0) throw new Error(`div: divisor 必须为正数,收到 ${divisor}`)
  return a / BigInt(divisor)
}

/** 取最小值 */
export function min(a: Time, b: Time): Time {
  return a < b ? a : b
}

/** 取最大值 */
export function max(a: Time, b: Time): Time {
  return a > b ? a : b
}

/** 比较:a < b */
export function lt(a: Time, b: Time): boolean {
  return a < b
}

/** 比较:a > b */
export function gt(a: Time, b: Time): boolean {
  return a > b
}

/** 比较:a == b */
export function eq(a: Time, b: Time): boolean {
  return a === b
}

/** 钳制:min <= time <= max */
export function clamp(time: Time, lo: Time, hi: Time): Time {
  if (time < lo) return lo
  if (time > hi) return hi
  return time
}

// ============================================================================
// 5. 格式化(用于 UI 显示)
// ============================================================================

/**
 * 格式化为 HH:MM:SS.mmm 字符串。
 *
 * @example
 *   formatTime(0n)                 // "00:00:00.000"
 *   formatTime(1_000_000n)         // "00:00:01.000"
 *   formatTime(3_661_500_000n)     // "01:01:01.500"
 */
export function formatTime(time: Time): string {
  const totalMs = Number(time) / Number(MILLI)
  const h = Math.floor(totalMs / 3_600_000)
  const m = Math.floor((totalMs % 3_600_000) / 60_000)
  const s = Math.floor((totalMs % 60_000) / 1_000)
  const ms = Math.floor(totalMs % 1_000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/**
 * 格式化为 HH:MM:SS:FF(帧号,用于视频编辑器显示)。
 *
 * @param time 微秒时间
 * @param fps  帧率
 *
 * @example
 *   formatTimecode(1_000_000n, 30)    // "00:00:01:00"
 *   formatTimecode(1_033_333n, 30)    // "00:00:01:01"
 */
export function formatTimecode(time: Time, fps: number): string {
  const totalFrames = timeToFrame(time, fps)
  const fpsInt = Math.floor(fps)
  const totalSeconds = Math.floor(totalFrames / fpsInt)
  const h = Math.floor(totalSeconds / 3_600)
  const m = Math.floor((totalSeconds % 3_600) / 60)
  const s = totalSeconds % 60
  const f = totalFrames % fpsInt
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}
