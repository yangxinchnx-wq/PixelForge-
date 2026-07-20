/**
 * 关键帧求值器测试
 *
 * 测试覆盖：
 *   I1  空关键帧列表返回 0
 *   I2  单个关键帧返回该帧的值
 *   I3  frame 在第一帧之前 → 返回第一帧的值
 *   I4  frame 在最后一帧之后 → 返回最后一帧的值
 *   I5  linear 缓动：线性插值
 *   I6  ease 缓动：smoothstep 插值
 *   I7  hold 缓动：保持左端点值
 *   I8  frame 恰好在关键帧上 → 返回该关键帧的值
 *   I9  多段插值（3+ 关键帧）
 *   I10 evaluateAllTracks 批量求值
 *   I11 关键帧未排序时正确排序后求值
 *   I12 frame 在两帧中点 → 线性插值 0.5
 */

import { describe, it, expect } from 'vitest'

import { evaluateTrack, evaluateAllTracks } from './evaluator'
import type { Keyframe, ParameterTrack } from './types'

// ============================================================================
// fixture
// ============================================================================

function makeKeyframe(
  frame: number,
  value: number,
  easing: Keyframe['easing'] = 'linear',
): Keyframe {
  return { id: `kf-${frame}-${Math.random().toString(36).slice(2, 6)}`, frame, value, easing }
}

function makeTrack(
  keyframes: Keyframe[],
  overrides: Partial<ParameterTrack> = {},
): ParameterTrack {
  return {
    id: 'track_test',
    label: '测试轨道',
    layerId: 'layer_test',
    parameter: 'radius',
    keyframes,
    ...overrides,
  }
}

// ============================================================================
// I. 基本求值
// ============================================================================

describe('I. evaluateTrack 基本求值', () => {
  it('I1 空关键帧列表返回 0', () => {
    const track = makeTrack([])
    expect(evaluateTrack(track, 50)).toBe(0)
  })

  it('I2 单个关键帧返回该帧的值', () => {
    const track = makeTrack([makeKeyframe(100, 0.7)])
    expect(evaluateTrack(track, 0)).toBe(0.7)
    expect(evaluateTrack(track, 100)).toBe(0.7)
    expect(evaluateTrack(track, 200)).toBe(0.7)
  })

  it('I3 frame 在第一帧之前 → 返回第一帧的值', () => {
    const track = makeTrack([
      makeKeyframe(50, 0.3),
      makeKeyframe(100, 0.8),
    ])
    expect(evaluateTrack(track, 0)).toBe(0.3)
    expect(evaluateTrack(track, 49)).toBe(0.3)
  })

  it('I4 frame 在最后一帧之后 → 返回最后一帧的值', () => {
    const track = makeTrack([
      makeKeyframe(50, 0.3),
      makeKeyframe(100, 0.8),
    ])
    expect(evaluateTrack(track, 100)).toBe(0.8)
    expect(evaluateTrack(track, 200)).toBe(0.8)
  })

  it('I5 linear 缓动：线性插值', () => {
    const track = makeTrack([
      makeKeyframe(0, 0.0, 'linear'),
      makeKeyframe(100, 1.0, 'linear'),
    ])
    // 中点
    expect(evaluateTrack(track, 50)).toBeCloseTo(0.5, 5)
    // 1/4 位置
    expect(evaluateTrack(track, 25)).toBeCloseTo(0.25, 5)
    // 3/4 位置
    expect(evaluateTrack(track, 75)).toBeCloseTo(0.75, 5)
  })

  it('I6 ease 缓动：smoothstep 插值', () => {
    const track = makeTrack([
      makeKeyframe(0, 0.0, 'ease'),
      makeKeyframe(100, 1.0, 'ease'),
    ])
    // smoothstep(0.5) = 0.5
    expect(evaluateTrack(track, 50)).toBeCloseTo(0.5, 5)
    // smoothstep(0.25) = 0.15625
    expect(evaluateTrack(track, 25)).toBeCloseTo(0.15625, 5)
    // smoothstep(0.75) = 0.84375
    expect(evaluateTrack(track, 75)).toBeCloseTo(0.84375, 5)
  })

  it('I7 hold 缓动：保持左端点值', () => {
    const track = makeTrack([
      makeKeyframe(0, 0.2, 'hold'),
      makeKeyframe(100, 0.8, 'hold'),
    ])
    // 在 [0, 100) 区间内，hold 返回左端点值 0.2
    expect(evaluateTrack(track, 0)).toBe(0.2)
    expect(evaluateTrack(track, 50)).toBe(0.2)
    expect(evaluateTrack(track, 99)).toBe(0.2)
    // 恰好在 100 → 返回右端点值
    expect(evaluateTrack(track, 100)).toBe(0.8)
  })

  it('I8 frame 恰好在关键帧上 → 返回该关键帧的值', () => {
    const track = makeTrack([
      makeKeyframe(0, 0.1),
      makeKeyframe(50, 0.5),
      makeKeyframe(100, 0.9),
    ])
    expect(evaluateTrack(track, 0)).toBe(0.1)
    expect(evaluateTrack(track, 50)).toBe(0.5)
    expect(evaluateTrack(track, 100)).toBe(0.9)
  })

  it('I9 多段插值（3+ 关键帧）', () => {
    const track = makeTrack([
      makeKeyframe(0, 0.0),
      makeKeyframe(50, 0.5),
      makeKeyframe(100, 1.0),
    ])
    // 第一段 [0, 50]: linear
    expect(evaluateTrack(track, 25)).toBeCloseTo(0.25, 5)
    // 第二段 [50, 100]: linear
    expect(evaluateTrack(track, 75)).toBeCloseTo(0.75, 5)
  })

  it('I10 evaluateAllTracks 批量求值', () => {
    const tracks: ParameterTrack[] = [
      makeTrack([makeKeyframe(0, 0.0), makeKeyframe(100, 1.0)], { id: 't1', parameter: 'radius' }),
      makeTrack([makeKeyframe(0, 0.5), makeKeyframe(100, 0.8)], { id: 't2', parameter: 'color' }),
    ]
    const results = evaluateAllTracks(tracks, 50)
    expect(results.length).toBe(2)
    expect(results[0].track.id).toBe('t1')
    expect(results[0].value).toBeCloseTo(0.5, 5)
    expect(results[1].track.id).toBe('t2')
    expect(results[1].value).toBeCloseTo(0.65, 5)
  })

  it('I11 关键帧未排序时正确排序后求值', () => {
    const track = makeTrack([
      makeKeyframe(100, 1.0),
      makeKeyframe(0, 0.0),
      makeKeyframe(50, 0.5),
    ])
    // 内部排序后 [0→0.0, 50→0.5, 100→1.0]
    expect(evaluateTrack(track, 25)).toBeCloseTo(0.25, 5)
    expect(evaluateTrack(track, 75)).toBeCloseTo(0.75, 5)
  })

  it('I12 frame 在两帧中点 → 线性插值 0.5', () => {
    const track = makeTrack([
      makeKeyframe(0, 0.0, 'linear'),
      makeKeyframe(100, 1.0, 'linear'),
    ])
    expect(evaluateTrack(track, 50)).toBeCloseTo(0.5, 5)
  })
})
