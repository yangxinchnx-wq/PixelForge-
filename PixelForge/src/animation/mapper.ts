/**
 * Mapper(Step 30.13)— 值映射工具。
 *
 * 职责:
 * - mapRange:      线性映射(value 从 [inMin, inMax] → [outMin, outMax])
 * - applyMapping:  按 ControlMapping 配置映射(支持 linear / exponential / logarithmic 曲线)
 * - smoothValue:   指数平滑(避免抖动)
 * - clampValue:    钳制到范围
 *
 * 数据流:
 *   Signal.value(0-1)
 *     ↓ applyMapping(mapping)
 *   输出值(outMin-outMax)
 *     ↓ binding
 *   node.params[property]
 */

import type { ControlMapping, MappingCurve } from '@/input/types'

// ============================================================================
// 1. 基础映射函数
// ============================================================================

/**
 * 线性范围映射。
 *
 * @param value  输入值
 * @param inMin  输入范围下限
 * @param inMax  输入范围上限
 * @param outMin 输出范围下限
 * @param outMax 输出范围上限
 * @returns 映射后的值(不钳制)
 *
 * @example
 *   mapRange(0.5, 0, 1, 0, 10) // → 5
 *   mapRange(0.8, 0, 1, 0.5, 3.0) // → 2.5
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin
  const t = (value - inMin) / (inMax - inMin)
  return outMin + t * (outMax - outMin)
}

/**
 * 钳制到范围。
 */
export function clampValue(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

// ============================================================================
// 2. 曲线变换
// ============================================================================

/**
 * 应用曲线变换(归一化输入 0-1 → 0-1)。
 *
 * - linear:       y = x(直线)
 * - exponential:  y = x²(慢起步,快结尾,适合触发类参数)
 * - logarithmic:  y = sqrt(x)(快起步,慢结尾,适合音量等感知参数)
 *
 * @param t     归一化输入(0-1)
 * @param curve 曲线类型
 */
export function applyCurve(t: number, curve: MappingCurve): number {
  // 钳制到 0-1
  const x = clampValue(t, 0, 1)
  switch (curve) {
    case 'exponential':
      return x * x
    case 'logarithmic':
      return Math.sqrt(x)
    case 'linear':
    default:
      return x
  }
}

// ============================================================================
// 3. 完整映射(应用 ControlMapping)
// ============================================================================

/**
 * 按 ControlMapping 配置映射值。
 *
 * 步骤:
 * 1. 输入值钳制到 [inMin, inMax]
 * 2. 归一化到 0-1
 * 3. 应用曲线变换
 * 4. 映射到 [outMin, outMax]
 *
 * @param value   输入值(通常 0-1,但可任意)
 * @param mapping 映射配置
 * @returns 映射后的值
 */
export function applyMapping(value: number, mapping: ControlMapping): number {
  // 1. 钳制到输入范围
  const clampedIn = clampValue(value, mapping.inMin, mapping.inMax)
  // 2. 归一化到 0-1
  const t = mapRange(clampedIn, mapping.inMin, mapping.inMax, 0, 1)
  // 3. 应用曲线
  const curved = applyCurve(t, mapping.curve)
  // 4. 映射到输出范围
  return mapRange(curved, 0, 1, mapping.outMin, mapping.outMax)
}

// ============================================================================
// 4. 平滑(指数平滑)
// ============================================================================

/**
 * 指数平滑(避免信号抖动)。
 *
 * 公式: output = output + (input - output) * (1 - smoothing)
 *
 * - smoothing=0:  无平滑(直接用 input)
 * - smoothing=0.5: 中等平滑(每帧追踪 50% 的差异)
 * - smoothing=0.9: 强平滑(每帧追踪 10% 的差异,适合慢响应)
 *
 * @param current   当前输出值(上一次的结果)
 * @param target    目标值(本次输入)
 * @param smoothing 平滑系数(0-1)
 * @returns 平滑后的值
 */
export function smoothValue(
  current: number,
  target: number,
  smoothing: number,
): number {
  // 钳制 smoothing 到 0-0.99(避免完全冻结)
  const s = clampValue(smoothing, 0, 0.99)
  return current + (target - current) * (1 - s)
}

// ============================================================================
// 5. 便捷工厂
// ============================================================================

/**
 * 创建线性映射(0-1 → outMin-outMax)。
 */
export function linearMapping(
  outMin: number,
  outMax: number,
  smoothing: number = 0,
): ControlMapping {
  return {
    inMin: 0,
    inMax: 1,
    outMin,
    outMax,
    curve: 'linear',
    smoothing,
  }
}

/**
 * 创建指数映射(适合触发类参数,如 beat → 爆发)。
 */
export function exponentialMapping(
  outMin: number,
  outMax: number,
  smoothing: number = 0,
): ControlMapping {
  return {
    inMin: 0,
    inMax: 1,
    outMin,
    outMax,
    curve: 'exponential',
    smoothing,
  }
}

/**
 * 创建对数映射(适合感知类参数,如音量 → 亮度)。
 */
export function logarithmicMapping(
  outMin: number,
  outMax: number,
  smoothing: number = 0,
): ControlMapping {
  return {
    inMin: 0,
    inMax: 1,
    outMin,
    outMax,
    curve: 'logarithmic',
    smoothing,
  }
}
