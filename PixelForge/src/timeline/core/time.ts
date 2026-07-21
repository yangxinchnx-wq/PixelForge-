/**
 * PixelForge Timeline Core — 微秒时间类型。
 *
 * 视频帧率（29.97 / 23.976 / 60fps）使用浮点数会产生精度误差，
 * 因此 Timeline 内部所有时间用 bigint 微秒表示。
 */

/** 微秒时间。1 秒 = 1,000,000 微秒。 */
export type Time = bigint;

/** 1 秒的微秒值。 */
export const SECOND = 1000000n;

/**
 * 把秒数转为 Time。
 *
 * @param value 秒数（支持小数，如 1.5）
 * @returns 微秒 Time
 *
 * @example
 * sec(10)    // 10000000n  表示 10 秒
 * sec(1.5)   // 1500000n   表示 1.5 秒
 */
export function sec(value: number): Time {
  return BigInt(Math.floor(value * Number(SECOND)));
}

/**
 * 帧号转 Time。
 *
 * @param frame 帧号（0-based）
 * @param fps 帧率（如 30 / 29.97 / 60）
 * @returns 对应的微秒 Time
 *
 * @example
 * frameToTime(30, 30)   // 1000000n  = 1 秒
 * frameToTime(60, 30)   // 2000000n  = 2 秒
 */
export function frameToTime(frame: number, fps: number): Time {
  return BigInt(Math.floor((frame * 1000000) / fps));
}

/**
 * Time 转帧号（向下取整）。
 *
 * @param time 微秒 Time
 * @param fps 帧率
 * @returns 帧号
 *
 * @example
 * timeToFrame(1000000n, 30)   // 1
 * timeToFrame(2000000n, 30)   // 2
 */
export function timeToFrame(time: Time, fps: number): number {
  return Math.floor(Number(time) / 1000000 * fps);
}
