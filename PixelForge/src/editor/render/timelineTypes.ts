/**
 * 本地类型存根 — 替代已删除的 ../timeline/core/sequence 和 ../timeline/core/time。
 *
 * Time: bigint 微秒时间戳（来自 Core Timeline 的 bigint 精度设计）。
 * Sequence: 时间轴序列（含分辨率、帧率、时长）。
 */

/** 微秒时间戳（bigint） */
export type Time = bigint

/** 将秒数转换为 Time */
export function seconds(s: number): Time {
  return BigInt(Math.round(s * 1_000_000)) as Time
}

/** 将毫秒数转换为 Time */
export function millis(ms: number): Time {
  return BigInt(Math.round(ms * 1000))
}

/** 将 Time 转换为秒数 */
export function toSeconds(t: Time): number {
  return Number(t) / 1_000_000
}

/** 时间轴序列 */
export interface Sequence {
  id: string
  name: string
  width: number
  height: number
  fps: number
  duration: Time
}

/** 创建 Sequence */
export function createSequence(options: {
  id?: string
  name?: string
  width?: number
  height?: number
  fps?: number
  duration?: Time
}): Sequence {
  return {
    id: options.id ?? `seq-${Date.now().toString(36)}`,
    name: options.name ?? '未命名序列',
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? 30,
    duration: options.duration ?? seconds(0),
  }
}
