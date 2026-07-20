/**
 * toPatchValue 测试
 *
 * 测试覆盖：
 *   J1  数组型 paramKey（color/colorA/colorB/fill/background）→ [v, v, v, 1]
 *   J2  二分量 paramKey（center/from/to）→ [v, v]
 *   J3  标量 paramKey（radius/amount/scale 等）→ number
 *   J4  未知 paramKey → 标量 number
 *   J5  边界值 0 和 1
 */

import { describe, it, expect } from 'vitest'

import { toPatchValue } from './types'

describe('J. toPatchValue 参数值转换', () => {
  it('J1 数组型 paramKey（color）→ [v, v, v, 1]', () => {
    expect(toPatchValue('color', 0.5)).toEqual([0.5, 0.5, 0.5, 1])
    expect(toPatchValue('colorA', 0.3)).toEqual([0.3, 0.3, 0.3, 1])
    expect(toPatchValue('colorB', 0.8)).toEqual([0.8, 0.8, 0.8, 1])
    expect(toPatchValue('fill', 0.2)).toEqual([0.2, 0.2, 0.2, 1])
    expect(toPatchValue('background', 0.9)).toEqual([0.9, 0.9, 0.9, 1])
  })

  it('J2 二分量 paramKey（center/from/to）→ [v, v]', () => {
    expect(toPatchValue('center', 0.5)).toEqual([0.5, 0.5])
    expect(toPatchValue('from', 0.1)).toEqual([0.1, 0.1])
    expect(toPatchValue('to', 0.9)).toEqual([0.9, 0.9])
  })

  it('J3 标量 paramKey（radius）→ number', () => {
    expect(toPatchValue('radius', 0.5)).toBe(0.5)
    expect(toPatchValue('amount', 0.7)).toBe(0.7)
    expect(toPatchValue('scale', 24)).toBe(24)
  })

  it('J4 未知 paramKey → 标量 number', () => {
    expect(toPatchValue('unknown_param', 0.42)).toBe(0.42)
    expect(toPatchValue('opacity', 0.5)).toBe(0.5)
  })

  it('J5 边界值 0 和 1', () => {
    expect(toPatchValue('color', 0)).toEqual([0, 0, 0, 1])
    expect(toPatchValue('color', 1)).toEqual([1, 1, 1, 1])
    expect(toPatchValue('radius', 0)).toBe(0)
    expect(toPatchValue('radius', 1)).toBe(1)
    expect(toPatchValue('center', 0)).toEqual([0, 0])
    expect(toPatchValue('center', 1)).toEqual([1, 1])
  })
})
