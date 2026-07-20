/**
 * Curve(Step 29.5)— 插值曲线函数。
 *
 * 实现 spec §5 的三种插值:
 * - linear:  线性插值 a + (b-a)*t
 * - bezier:  三次贝塞尔(用归一化控制点近似 ease-in-out)
 * - step:    阶梯函数(保持左端点值)
 *
 * 还提供常用 easing 函数(ease-in / ease-out / ease-in-out / bounce),
 * 供表达式动画和 UI 曲线选择器使用。
 */

import type { Interpolation, Keyframe } from './types'
import { DEFAULT_BEZIER_CP1, DEFAULT_BEZIER_CP2 } from './types'

// ============================================================================
// 1. 基础插值
// ============================================================================

/**
 * 线性插值。
 *
 * @param a 起点值
 * @param b 终点值
 * @param t 归一化时间 [0, 1]
 * @returns a + (b - a) * t
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * 三次贝塞尔曲线(4 个控制点)。
 *
 * 公式(与 spec §5 对齐):
 *   B(t) = (1-t)³·P0 + 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3
 *
 * @param p0 起点
 * @param p1 控制点 1
 * @param p2 控制点 2
 * @param p3 终点
 * @param t  归一化时间 [0, 1]
 */
export function cubicBezier(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  return uu * u * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + tt * t * p3
}

/**
 * 阶梯函数:始终返回左端点值。
 */
export function step(a: number): number {
  return a
}

// ============================================================================
// 2. 按关键帧插值类型选择插值方法
// ============================================================================

/**
 * 在两个关键帧之间插值。
 *
 * - linear:  线性
 * - bezier:  用 cp1/cp2 的 y 坐标作为贝塞尔控制点值,
 *            x 坐标用于求 t(通过牛顿迭代法求解 x(t)=time 的 t)
 * - step:    返回 k1.value
 *
 * @param k1  前一个关键帧
 * @param k2  后一个关键帧
 * @param t   归一化时间 [0, 1](0=k1, 1=k2)
 * @returns   插值后的值
 */
export function interpolateKeyframes(k1: Keyframe, k2: Keyframe, t: number): number {
  switch (k1.interpolation) {
    case 'step':
      return k1.value

    case 'bezier': {
      // cp1/cp2 归一化坐标 [0,1]x[0,1]
      // x 控制时间映射,y 控制值映射
      const cp1 = k1.cp1 ?? DEFAULT_BEZIER_CP1
      const cp2 = k2.cp2 ?? DEFAULT_BEZIER_CP2

      // 求解 x(s) = t 的 s(即找到贝塞尔曲线上 x 坐标等于 t 的点)
      // x(s) = 3(1-s)²s·cp1.x + 3(1-s)s²·cp2.x + s³
      const s = solveBezierX(t, cp1.x, cp2.x)

      // 用 s 求值 y(s),再映射到 [k1.value, k2.value]
      const yNorm = cubicBezier(0, cp1.y, cp2.y, 1, s)
      return lerp(k1.value, k2.value, yNorm)
    }

    case 'linear':
    default:
      return lerp(k1.value, k2.value, t)
  }
}

/**
 * 用牛顿迭代法求解贝塞尔曲线 x(s) = targetX 的 s 值。
 *
 * 三次贝塞尔 x 分量:
 *   x(s) = 3(1-s)²s·cp1x + 3(1-s)s²·cp2x + s³
 *
 * 牛顿迭代:
 *   s_{n+1} = s_n - (x(s_n) - targetX) / x'(s_n)
 *
 * @param targetX 目标 x 值 [0, 1]
 * @param cp1x    控制点 1 的 x
 * @param cp2x    控制点 2 的 x
 * @param iter    迭代次数(默认 8,精度足够)
 * @returns s ∈ [0, 1]
 */
export function solveBezierX(
  targetX: number,
  cp1x: number,
  cp2x: number,
  iter: number = 8,
): number {
  let s = targetX  // 初始猜测
  for (let i = 0; i < iter; i++) {
    const xVal = cubicBezier(0, cp1x, cp2x, 1, s)
    const xDeriv = bezierDerivativeX(s, cp1x, cp2x)
    if (Math.abs(xDeriv) < 1e-6) break
    s = s - (xVal - targetX) / xDeriv
    s = Math.max(0, Math.min(1, s))  // 钳制
  }
  return s
}

/**
 * 贝塞尔 x 分量的导数(用于牛顿迭代)。
 *
 * x'(s) = 3(1-s)²·cp1x + 6(1-s)s·(cp2x - cp1x) + 3s²·(1 - cp2x)
 */
function bezierDerivativeX(s: number, cp1x: number, cp2x: number): number {
  const u = 1 - s
  return 3 * u * u * cp1x + 6 * u * s * (cp2x - cp1x) + 3 * s * s * (1 - cp2x)
}

// ============================================================================
// 3. 常用 Easing 函数(供表达式动画使用)
// ============================================================================

export const easings = {
  linear: (t: number) => t,

  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  /** smoothstep(与 editor/timeline/evaluator.ts 的 ease 一致) */
  smoothstep: (t: number) => t * t * (3 - 2 * t),

  /** 弹跳效果 */
  bounce: (t: number) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
} as const

/** Easing 函数名(供 UI 选择器) */
export type EasingName = keyof typeof easings

/** 所有 easing 名称(有序) */
export const EASING_NAMES = Object.keys(easings) as EasingName[]

// ============================================================================
// 4. 把 Interpolation 转成可读标签(供 UI)
// ============================================================================

export const INTERPOLATION_LABELS: Record<Interpolation, string> = {
  linear: '线性',
  bezier: '贝塞尔',
  step: '阶梯',
}
