/**
 * Evaluator(Step 29.6)— 动画求值器。
 *
 * 职责:
 * - evaluateTrack:       求值单条轨道在指定时间的值(关键帧 / 表达式)
 * - evaluateAllTracks:   批量求值所有轨道,输出 ParamPatch[]
 * - evaluateExpression:  求值表达式(安全沙箱,仅暴露 Math + time)
 *
 * 与 editor/timeline/evaluator.ts 的区别:
 * - editor: 基于 frame(整数),仅 linear/ease/hold
 * - 本模块: 基于 time(秒,浮点),支持 linear/bezier/step + expression
 */

import type { AnimationTrack, ParamPatch } from './types'
import { interpolateKeyframes } from './curve'
import { findSurrounding } from './keyframe'

// ============================================================================
// 1. 关键帧轨道求值
// ============================================================================

/**
 * 求值单条轨道在指定时间的值。
 *
 * 边界:
 * - time 在第一个关键帧之前:返回第一个关键帧的值
 * - time 在最后一个关键帧之后:返回最后一个关键帧的值
 * - 空轨道:返回 null
 * - 禁用轨道:返回 null
 * - 表达式轨道:调用 evaluateExpression
 *
 * @param track 轨道
 * @param time  当前时间(秒)
 * @returns 插值后的值,或 null(轨道为空 / 禁用 / 表达式错误)
 */
export function evaluateTrack(track: AnimationTrack, time: number): number | null {
  if (!track.enabled) return null

  // 表达式模式
  if (track.mode === 'EXPRESSION') {
    try {
      return evaluateExpression(track.expression, time)
    } catch {
      return null
    }
  }

  // 关键帧模式
  const kfs = track.keyframes
  if (kfs.length === 0) return null
  if (kfs.length === 1) return kfs[0].value

  // time 在第一个之前
  if (time <= kfs[0].time) return kfs[0].value
  // time 在最后一个之后
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value

  // 找到区间 [k1, k2]
  const { k1, k2 } = findSurrounding(kfs, time)
  if (!k1 || !k2) {
    // 不应到达(边界已处理),防御性返回
    return kfs[kfs.length - 1].value
  }

  const span = k2.time - k1.time
  if (span <= 0) return k1.value

  const t = (time - k1.time) / span
  return interpolateKeyframes(k1, k2, t)
}

// ============================================================================
// 2. 批量求值
// ============================================================================

/**
 * 批量求值所有轨道,输出 ParamPatch 列表。
 *
 * 跳过空轨道 / 禁用轨道 / 求值失败的轨道。
 *
 * @param tracks 轨道列表
 * @param time   当前时间(秒)
 * @returns ParamPatch[](每个 patch 含 targetKind / nodeId / property / value)
 */
export function evaluateAllTracks(
  tracks: AnimationTrack[],
  time: number,
): ParamPatch[] {
  const patches: ParamPatch[] = []
  for (const track of tracks) {
    const value = evaluateTrack(track, time)
    if (value === null) continue
    if (!Number.isFinite(value)) continue
    patches.push({
      targetKind: track.targetKind,
      nodeId: track.nodeId,
      property: track.property,
      value,
    })
  }
  return patches
}

// ============================================================================
// 3. 表达式求值(安全沙箱)
// ============================================================================

/**
 * 表达式缓存(避免每次求值都编译函数)。
 *
 * Key: expression 代码
 * Value: 编译后的 (time: number) => number 函数
 */
const exprCache = new Map<string, ((time: number) => number) | null>()

/**
 * 求值表达式。
 *
 * 安全措施:
 * - 用 Function 构造器隔离(不访问闭包变量)
 * - 仅暴露 Math 对象 + time + 常用常量(PI / E)
 * - 表达式必须返回 number
 *
 * 支持的表达式示例:
 * - "sin(time) * 0.5"
 * - "time * 0.1"
 * - "Math.sin(time * 2) * Math.cos(time * 3)"
 * - "Math.PI * 2 * (time % 5) / 5"  // 5 秒一个周期
 *
 * @param code 表达式代码
 * @param time 当前时间(秒)
 * @returns 求值结果(number)
 * @throws 表达式语法错误 / 运行时错误 / 返回值非 number
 */
export function evaluateExpression(code: string, time: number): number {
  if (!code || code.trim() === '') {
    throw new Error('表达式为空')
  }

  // 查缓存
  let fn = exprCache.get(code)
  if (fn === undefined) {
    fn = compileExpression(code)
    exprCache.set(code, fn)
  }
  if (fn === null) {
    throw new Error('表达式编译失败')
  }

  const result = fn(time)
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error(`表达式返回值无效: ${result}`)
  }
  return result
}

/**
 * 编译表达式为函数。
 *
 * @returns 编译成功的函数,或 null(编译失败)
 */
function compileExpression(code: string): ((time: number) => number) | null {
  try {
    // 用 Function 构造器隔离作用域
    // 仅暴露 Math / time / PI / E
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'time',
      'Math',
      'PI',
      'E',
      `"use strict"; return (${code});`,
    ) as (time: number, math: typeof Math, pi: number, e: number) => number
    // 测试调用一次,确保无运行时错误
    const test = fn(0, Math, Math.PI, Math.E)
    if (typeof test !== 'number') return null
    return (t: number) => fn(t, Math, Math.PI, Math.E)
  } catch {
    return null
  }
}

/**
 * 清空表达式缓存(切换场景时调用)。
 */
export function clearExpressionCache(): void {
  exprCache.clear()
}

/**
 * 验证表达式语法(不执行)。
 *
 * @returns null 表示合法,否则返回错误信息
 */
export function validateExpression(code: string): string | null {
  if (!code || code.trim() === '') {
    return '表达式为空'
  }
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'time',
      'Math',
      'PI',
      'E',
      `"use strict"; return (${code});`,
    ) as (time: number, math: typeof Math, pi: number, e: number) => unknown
    const result = fn(0, Math, Math.PI, Math.E)
    if (typeof result !== 'number') {
      return `表达式返回值不是 number(实际: ${typeof result})`
    }
    return null
  } catch (e) {
    return (e as Error).message
  }
}
