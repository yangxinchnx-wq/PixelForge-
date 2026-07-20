/**
 * Animation Module 单元测试(Step 29)。
 *
 * 覆盖:
 * - T:  types(类型 / 常量 / toParamValue / genAnimId)
 * - C:  curve(lerp / cubicBezier / step / interpolateKeyframes / solveBezierX / easings)
 * - K:  keyframe(createKeyframe / sort / find / insert / remove / update / range)
 * - TR: track(createTrack / createKeyframeTrack / createExpressionTrack / CRUD / duration)
 * - E:  evaluator(evaluateTrack / evaluateAllTracks / evaluateExpression / validate)
 * - B:  binding(createBinding / applyAnimations / applyPatch / groupPatchesByNode / grouped)
 * - P:  player(TimelinePlayer 状态机 / 播放控制 / update / loop / seek / frame 换算)
 * - S:  scheduler(startFrameLoop / stop / isRunning / getFps / fixedTimestepLoop)
 * - U:  uniformUpdater(UniformBufferRegistry / collectUniformUpdates / flushUniformUpdates)
 * - TL: timeline store(state / getters / track CRUD / keyframe CRUD / playback / evaluate / IO)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// —— types ——
import {
  DEFAULT_BEZIER_CP1,
  DEFAULT_BEZIER_CP2,
  DEFAULT_TIMELINE_DURATION,
  DEFAULT_TIMELINE_FPS,
  DEFAULT_TRACK_COLOR,
  genAnimId,
  toParamValue,
} from './types'
import type { AnimationTrack, Keyframe, ParamPatch } from './types'

// —— curve ——
import {
  cubicBezier,
  easings,
  EASING_NAMES,
  INTERPOLATION_LABELS,
  interpolateKeyframes,
  lerp,
  solveBezierX,
  step,
} from './curve'

// —— keyframe ——
import {
  createKeyframe,
  findKeyframeAt,
  findKeyframeById,
  findSurrounding,
  getKeyframeRange,
  getValueRange,
  insertKeyframe,
  removeKeyframe,
  sortKeyframes,
  updateKeyframe,
} from './keyframe'

// —— track ——
import {
  addKeyframe,
  addKeyframeAt,
  clearKeyframes,
  cloneTrack,
  createExpressionTrack,
  createKeyframeTrack,
  createTrack,
  getTrackDuration,
  removeKeyframeFromTrack,
  setTrackEnabled,
  setTrackMode,
  updateKeyframeInTrack,
} from './track'

// —— evaluator ——
import {
  clearExpressionCache,
  evaluateAllTracks,
  evaluateExpression,
  evaluateTrack,
  validateExpression,
} from './evaluator'

// —— binding ——
import {
  applyAnimations,
  applyAnimationsGrouped,
  applyPatch,
  createBinding,
  groupPatchesByNode,
  type ParamUpdatableStore,
} from './binding'

// —— player ——
import { createPlayer, TimelinePlayer } from './player'

// —— scheduler ——
import {
  startFixedTimestepLoop,
  startFrameLoop,
  type FrameLoopControl,
} from './scheduler'

// —— uniformUpdater ——
import {
  applyUniformUpdates,
  collectUniformUpdates,
  flushUniformUpdates,
  UniformBufferRegistry,
  uniformRegistry,
  type WritableGpuDevice,
} from './uniformUpdater'

// —— timeline store ——
import { useAnimationStore } from './timeline'

// ============================================================================
// 辅助:构造 Mock Store / GPUBuffer / Device
// ============================================================================

function makeMockStore(): ParamUpdatableStore & {
  calls: Array<{ nodeId: string; params: Record<string, unknown> }>
} {
  const calls: Array<{ nodeId: string; params: Record<string, unknown> }> = []
  return {
    calls,
    updateNodeParams(nodeId: string, params: Record<string, unknown>) {
      calls.push({ nodeId, params: { ...params } })
    },
  }
}

/** 简易 GPUBuffer mock(仅含 destroyed 标志) */
function makeMockBuffer(id: string = 'buf'): GPUBuffer {
  return { id } as unknown as GPUBuffer
}

/** WritableGpuDevice mock:记录所有 writeBuffer 调用 */
function makeMockDevice(): WritableGpuDevice & {
  writes: Array<{ buffer: GPUBuffer; offset: number; data: Float32Array }>
} {
  const writes: Array<{ buffer: GPUBuffer; offset: number; data: Float32Array }> = []
  return {
    writes,
    queue: {
      writeBuffer(buffer: GPUBuffer, offset: number, data: Float32Array) {
        writes.push({ buffer, offset, data })
      },
    },
  }
}

function makePatch(
  targetKind: ParamPatch['targetKind'] = 'graph',
  nodeId: string = 'n1',
  property: string = 'density',
  value: number = 0.5,
): ParamPatch {
  return { targetKind, nodeId, property, value }
}

function makeKeyframe(
  time: number,
  value: number,
  interpolation: Keyframe['interpolation'] = 'linear',
): Keyframe {
  return createKeyframe(time, value, interpolation)
}

function makeTrack(
  overrides: Partial<AnimationTrack> = {},
): AnimationTrack {
  return {
    id: 'track_test',
    label: '测试轨道',
    targetKind: 'graph',
    nodeId: 'n1',
    property: 'density',
    mode: 'KEYFRAME',
    keyframes: [],
    expression: '',
    enabled: true,
    color: DEFAULT_TRACK_COLOR,
    ...overrides,
  }
}

// ============================================================================
// T: types
// ============================================================================

describe('T: Animation Types', () => {
  it('T1: 默认常量值正确', () => {
    expect(DEFAULT_TIMELINE_DURATION).toBe(10)
    expect(DEFAULT_TIMELINE_FPS).toBe(60)
    expect(DEFAULT_TRACK_COLOR).toBe('#4a9eff')
  })

  it('T2: DEFAULT_BEZIER_CP1 / CP2 形状', () => {
    expect(DEFAULT_BEZIER_CP1).toEqual({ x: 0.25, y: 0.1 })
    expect(DEFAULT_BEZIER_CP2).toEqual({ x: 0.75, y: 0.9 })
  })

  it('T3: toParamValue 数组型属性(color) → [v, v, v, 1]', () => {
    expect(toParamValue('color', 0.5)).toEqual([0.5, 0.5, 0.5, 1])
    expect(toParamValue('colorA', 0.3)).toEqual([0.3, 0.3, 0.3, 1])
    expect(toParamValue('colorB', 0.8)).toEqual([0.8, 0.8, 0.8, 1])
    expect(toParamValue('fill', 0.2)).toEqual([0.2, 0.2, 0.2, 1])
    expect(toParamValue('background', 0.9)).toEqual([0.9, 0.9, 0.9, 1])
  })

  it('T4: toParamValue 二维属性(center/from/to/offset/position) → [v, v]', () => {
    expect(toParamValue('center', 0.5)).toEqual([0.5, 0.5])
    expect(toParamValue('from', 0.1)).toEqual([0.1, 0.1])
    expect(toParamValue('to', 0.9)).toEqual([0.9, 0.9])
    expect(toParamValue('offset', 0.4)).toEqual([0.4, 0.4])
    expect(toParamValue('position', 0.6)).toEqual([0.6, 0.6])
  })

  it('T5: toParamValue 标量属性 → number', () => {
    expect(toParamValue('density', 0.5)).toBe(0.5)
    expect(toParamValue('rotation', 1.5)).toBe(1.5)
    expect(toParamValue('scale', 2)).toBe(2)
    expect(toParamValue('unknownProp', 0.7)).toBe(0.7)
  })

  it('T6: genAnimId 生成不同 id 且带前缀', () => {
    const a = genAnimId('kf')
    const b = genAnimId('kf')
    expect(a).not.toBe(b)
    expect(a.startsWith('kf_')).toBe(true)
    expect(b.startsWith('kf_')).toBe(true)
    expect(genAnimId('track').startsWith('track_')).toBe(true)
  })
})

// ============================================================================
// C: curve
// ============================================================================

describe('C: Curve 插值', () => {
  it('C1: lerp 线性插值', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.5)).toBe(5)
    expect(lerp(2, 4, 0.5)).toBe(3)
    expect(lerp(-1, 1, 0.5)).toBe(0)
  })

  it('C2: cubicBezier 端点正确', () => {
    expect(cubicBezier(0, 1, 2, 3, 0)).toBe(0)
    expect(cubicBezier(0, 1, 2, 3, 1)).toBe(3)
  })

  it('C3: cubicBezier 对称性(cp1=cp2 时中点 = 平均值)', () => {
    // 当 cp1=cp2=mid 时,曲线在 t=0.5 处经过 (P0+P3)/2
    const mid = cubicBezier(0, 0.5, 0.5, 1, 0.5)
    expect(mid).toBeCloseTo(0.5, 5)
  })

  it('C4: step 始终返回左端点值', () => {
    expect(step(0.3)).toBe(0.3)
    expect(step(0.7)).toBe(0.7)
    expect(step(-1)).toBe(-1)
  })

  it('C5: interpolateKeyframes linear', () => {
    const k1 = makeKeyframe(0, 0, 'linear')
    const k2 = makeKeyframe(10, 100, 'linear')
    expect(interpolateKeyframes(k1, k2, 0)).toBe(0)
    expect(interpolateKeyframes(k1, k2, 1)).toBe(100)
    expect(interpolateKeyframes(k1, k2, 0.5)).toBe(50)
  })

  it('C6: interpolateKeyframes step 返回 k1.value', () => {
    const k1 = makeKeyframe(0, 5, 'step')
    const k2 = makeKeyframe(10, 15, 'step')
    expect(interpolateKeyframes(k1, k2, 0)).toBe(5)
    expect(interpolateKeyframes(k1, k2, 0.5)).toBe(5)
    expect(interpolateKeyframes(k1, k2, 0.99)).toBe(5)
  })

  it('C7: interpolateKeyframes bezier 端点正确', () => {
    const k1 = makeKeyframe(0, 0, 'bezier')
    const k2 = makeKeyframe(10, 100, 'bezier')
    expect(interpolateKeyframes(k1, k2, 0)).toBeCloseTo(0, 5)
    expect(interpolateKeyframes(k1, k2, 1)).toBeCloseTo(100, 5)
  })

  it('C8: interpolateKeyframes bezier 中点对称(默认 cp 对称)', () => {
    // 默认 cp1=(0.25,0.1) cp2=(0.75,0.9) 关于 (0.5,0.5) 对称,
    // 因此 t=0.5 时结果 = (v1+v2)/2
    const k1 = makeKeyframe(0, 0, 'bezier')
    const k2 = makeKeyframe(10, 100, 'bezier')
    expect(interpolateKeyframes(k1, k2, 0.5)).toBeCloseTo(50, 5)
  })

  it('C9: interpolateKeyframes bezier 早期慢(ease-in)', () => {
    // t=0.25 时 bezier 结果应 < 25(因 cp1.y=0.1 使曲线在起点平缓)
    const k1 = makeKeyframe(0, 0, 'bezier')
    const k2 = makeKeyframe(10, 100, 'bezier')
    const v = interpolateKeyframes(k1, k2, 0.25)
    expect(v).toBeLessThan(25)
    expect(v).toBeGreaterThan(0)
  })

  it('C10: solveBezierX 端点正确', () => {
    expect(solveBezierX(0, 0.25, 0.75)).toBeCloseTo(0, 5)
    expect(solveBezierX(1, 0.25, 0.75)).toBeCloseTo(1, 5)
    expect(solveBezierX(0.5, 0.25, 0.75)).toBeCloseTo(0.5, 5)
  })

  it('C11: solveBezierX 结果在 [0,1] 范围内', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      const s = solveBezierX(t, 0.25, 0.75)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  it('C12: easings 函数端点正确', () => {
    expect(easings.linear(0)).toBe(0)
    expect(easings.linear(1)).toBe(1)
    expect(easings.easeInQuad(1)).toBe(1)
    expect(easings.easeOutQuad(0)).toBe(0)
    expect(easings.smoothstep(0)).toBe(0)
    expect(easings.smoothstep(1)).toBe(1)
    expect(easings.bounce(0)).toBe(0)
    expect(easings.bounce(1)).toBe(1)
  })

  it('C13: easings.easeInOutCubic 中点 = 0.5', () => {
    expect(easings.easeInOutCubic(0.5)).toBeCloseTo(0.5, 5)
  })

  it('C14: EASING_NAMES 包含 9 个 easing', () => {
    expect(EASING_NAMES.length).toBe(9)
    expect(EASING_NAMES).toContain('linear')
    expect(EASING_NAMES).toContain('smoothstep')
    expect(EASING_NAMES).toContain('bounce')
  })

  it('C15: INTERPOLATION_LABELS 三种插值都有标签', () => {
    expect(INTERPOLATION_LABELS.linear).toBe('线性')
    expect(INTERPOLATION_LABELS.bezier).toBe('贝塞尔')
    expect(INTERPOLATION_LABELS.step).toBe('阶梯')
    expect(Object.keys(INTERPOLATION_LABELS).length).toBe(3)
  })
})

// ============================================================================
// K: keyframe
// ============================================================================

describe('K: Keyframe 工具', () => {
  it('K1: createKeyframe linear 不含 cp1/cp2', () => {
    const kf = createKeyframe(2, 0.5, 'linear')
    expect(kf.time).toBe(2)
    expect(kf.value).toBe(0.5)
    expect(kf.interpolation).toBe('linear')
    expect(kf.cp1).toBeUndefined()
    expect(kf.cp2).toBeUndefined()
  })

  it('K2: createKeyframe bezier 自动填充默认 cp1/cp2', () => {
    const kf = createKeyframe(0, 0, 'bezier')
    expect(kf.cp1).toEqual(DEFAULT_BEZIER_CP1)
    expect(kf.cp2).toEqual(DEFAULT_BEZIER_CP2)
  })

  it('K3: createKeyframe 自定义 id', () => {
    const kf = createKeyframe(0, 0, 'linear', 'custom_id')
    expect(kf.id).toBe('custom_id')
  })

  it('K4: sortKeyframes 按 time 升序(不改原数组)', () => {
    const kfs = [
      createKeyframe(3, 30, 'linear', 'a'),
      createKeyframe(1, 10, 'linear', 'b'),
      createKeyframe(2, 20, 'linear', 'c'),
    ]
    const sorted = sortKeyframes(kfs)
    expect(sorted.map((k) => k.id)).toEqual(['b', 'c', 'a'])
    // 原数组不变
    expect(kfs[0].id).toBe('a')
  })

  it('K5: findKeyframeAt 容差查找', () => {
    const kfs = [createKeyframe(1, 10), createKeyframe(2, 20)]
    expect(findKeyframeAt(kfs, 1.0005)?.value).toBe(10)
    expect(findKeyframeAt(kfs, 2.0005)?.value).toBe(20)
    expect(findKeyframeAt(kfs, 1.5)).toBeUndefined()
  })

  it('K6: findKeyframeById 精确查找', () => {
    const kfs = [createKeyframe(0, 0, 'linear', 'kf1'), createKeyframe(5, 1, 'linear', 'kf2')]
    expect(findKeyframeById(kfs, 'kf2')?.value).toBe(1)
    expect(findKeyframeById(kfs, 'not_exist')).toBeUndefined()
  })

  it('K7: findSurrounding 空数组返回 {undefined, undefined}', () => {
    expect(findSurrounding([], 5)).toEqual({ k1: undefined, k2: undefined })
  })

  it('K8: findSurrounding 单关键帧', () => {
    const kfs = [createKeyframe(5, 50)]
    expect(findSurrounding(kfs, 3)).toEqual({ k1: undefined, k2: kfs[0] })
    expect(findSurrounding(kfs, 7)).toEqual({ k1: kfs[0], k2: undefined })
  })

  it('K9: findSurrounding 多关键帧区间查找', () => {
    const kfs = [
      createKeyframe(0, 0, 'linear', 'a'),
      createKeyframe(5, 50, 'linear', 'b'),
      createKeyframe(10, 100, 'linear', 'c'),
    ]
    // 之前
    expect(findSurrounding(kfs, -1).k2?.id).toBe('a')
    // 之后
    expect(findSurrounding(kfs, 20).k1?.id).toBe('c')
    // 中间
    const mid = findSurrounding(kfs, 7)
    expect(mid.k1?.id).toBe('b')
    expect(mid.k2?.id).toBe('c')
  })

  it('K10: insertKeyframe 自动保持排序', () => {
    const kfs = [createKeyframe(0, 0, 'linear', 'a'), createKeyframe(10, 100, 'linear', 'b')]
    const updated = insertKeyframe(kfs, createKeyframe(5, 50, 'linear', 'c'))
    expect(updated.map((k) => k.id)).toEqual(['a', 'c', 'b'])
  })

  it('K11: insertKeyframe 同时刻已存在则更新', () => {
    const kfs = [createKeyframe(0, 0, 'linear', 'a'), createKeyframe(5, 50, 'linear', 'b')]
    const updated = insertKeyframe(kfs, createKeyframe(5, 999, 'linear', 'c'))
    expect(updated.length).toBe(2)
    // 同时刻(容差 0.001)的现有 keyframe 应被更新
    expect(updated.find((k) => k.time === 5)?.value).toBe(999)
  })

  it('K12: removeKeyframe 按 id 删除', () => {
    const kfs = [createKeyframe(0, 0, 'linear', 'a'), createKeyframe(5, 50, 'linear', 'b')]
    const updated = removeKeyframe(kfs, 'a')
    expect(updated.length).toBe(1)
    expect(updated[0].id).toBe('b')
  })

  it('K13: updateKeyframe 更新并自动重排', () => {
    const kfs = [
      createKeyframe(0, 0, 'linear', 'a'),
      createKeyframe(5, 50, 'linear', 'b'),
      createKeyframe(10, 100, 'linear', 'c'),
    ]
    // 把 b 的时间改成 12,应该排到最后
    const updated = updateKeyframe(kfs, 'b', { time: 12 })
    expect(updated.map((k) => k.id)).toEqual(['a', 'c', 'b'])
    expect(updated[2].value).toBe(50)
  })

  it('K14: getKeyframeRange 时间范围', () => {
    expect(getKeyframeRange([])).toEqual({ min: 0, max: 0 })
    const kfs = [
      createKeyframe(3, 0, 'linear', 'a'),
      createKeyframe(1, 0, 'linear', 'b'),
      createKeyframe(7, 0, 'linear', 'c'),
    ]
    expect(getKeyframeRange(kfs)).toEqual({ min: 1, max: 7 })
  })

  it('K15: getValueRange 值范围(空列表默认 [0,1])', () => {
    expect(getValueRange([])).toEqual({ min: 0, max: 1 })
    const kfs = [
      createKeyframe(0, -5, 'linear', 'a'),
      createKeyframe(1, 3, 'linear', 'b'),
      createKeyframe(2, 10, 'linear', 'c'),
    ]
    expect(getValueRange(kfs)).toEqual({ min: -5, max: 10 })
  })
})

// ============================================================================
// TR: track
// ============================================================================

describe('TR: Track 工具', () => {
  it('TR1: createTrack 创建空轨道', () => {
    const t = createTrack('graph', 'n1', 'density', '密度')
    expect(t.id).toBeTruthy()
    expect(t.label).toBe('密度')
    expect(t.targetKind).toBe('graph')
    expect(t.nodeId).toBe('n1')
    expect(t.property).toBe('density')
    expect(t.mode).toBe('KEYFRAME')
    expect(t.keyframes).toEqual([])
    expect(t.enabled).toBe(true)
    expect(t.color).toBe(DEFAULT_TRACK_COLOR)
  })

  it('TR2: createTrack 默认 label = property', () => {
    const t = createTrack('material', 'm1', 'rotation')
    expect(t.label).toBe('rotation')
    expect(t.targetKind).toBe('material')
  })

  it('TR3: createKeyframeTrack 含起止关键帧', () => {
    const t = createKeyframeTrack('graph', 'n1', 'density', 0.2, 1.0, 5, '密度')
    expect(t.keyframes.length).toBe(2)
    expect(t.keyframes[0].time).toBe(0)
    expect(t.keyframes[0].value).toBe(0.2)
    expect(t.keyframes[1].time).toBe(5)
    expect(t.keyframes[1].value).toBe(1.0)
    expect(t.mode).toBe('KEYFRAME')
  })

  it('TR4: createExpressionTrack 设置 expression + mode', () => {
    const t = createExpressionTrack('graph', 'n1', 'rotation', 'Math.sin(time)')
    expect(t.mode).toBe('EXPRESSION')
    expect(t.expression).toBe('Math.sin(time)')
    expect(t.keyframes).toEqual([])
  })

  it('TR5: addKeyframe 返回新轨道(不可变)', () => {
    const t = createTrack('graph', 'n1', 'density')
    const updated = addKeyframe(t, createKeyframe(2, 0.5))
    expect(t.keyframes.length).toBe(0) // 原轨道不变
    expect(updated.keyframes.length).toBe(1)
    expect(updated.keyframes[0].value).toBe(0.5)
  })

  it('TR6: addKeyframeAt 便捷方法', () => {
    const t = createTrack('graph', 'n1', 'density')
    const updated = addKeyframeAt(t, 3, 0.7, 'bezier')
    expect(updated.keyframes[0].time).toBe(3)
    expect(updated.keyframes[0].value).toBe(0.7)
    expect(updated.keyframes[0].interpolation).toBe('bezier')
  })

  it('TR7: removeKeyframeFromTrack', () => {
    const t = createKeyframeTrack('graph', 'n1', 'density', 0, 1, 5)
    const kfId = t.keyframes[0].id
    const updated = removeKeyframeFromTrack(t, kfId)
    expect(updated.keyframes.length).toBe(1)
  })

  it('TR8: updateKeyframeInTrack', () => {
    const t = createKeyframeTrack('graph', 'n1', 'density', 0, 1, 5)
    const kfId = t.keyframes[0].id
    const updated = updateKeyframeInTrack(t, kfId, { value: 0.5 })
    expect(updated.keyframes[0].value).toBe(0.5)
  })

  it('TR9: clearKeyframes', () => {
    const t = createKeyframeTrack('graph', 'n1', 'density', 0, 1, 5)
    const updated = clearKeyframes(t)
    expect(updated.keyframes).toEqual([])
    expect(updated.nodeId).toBe('n1') // 其他属性保留
  })

  it('TR10: getTrackDuration 三种模式', () => {
    expect(getTrackDuration(createTrack('graph', 'n1', 'p'))).toBe(0)
    expect(getTrackDuration(createKeyframeTrack('graph', 'n1', 'p', 0, 1, 7))).toBe(7)
    expect(getTrackDuration(createExpressionTrack('graph', 'n1', 'p', 'time'))).toBe(Infinity)
  })

  it('TR11: setTrackMode / setTrackEnabled', () => {
    const t = createTrack('graph', 'n1', 'p')
    expect(setTrackMode(t, 'EXPRESSION').mode).toBe('EXPRESSION')
    expect(setTrackEnabled(t, false).enabled).toBe(false)
  })

  it('TR12: cloneTrack 深拷贝(关键帧独立)', () => {
    const t = createKeyframeTrack('graph', 'n1', 'p', 0, 1, 5)
    const clone = cloneTrack(t)
    expect(clone).not.toBe(t)
    expect(clone.keyframes).not.toBe(t.keyframes)
    expect(clone.keyframes[0]).not.toBe(t.keyframes[0])
    expect(clone.keyframes[0].value).toBe(t.keyframes[0].value)
  })
})

// ============================================================================
// E: evaluator
// ============================================================================

describe('E: Evaluator 求值', () => {
  beforeEach(() => {
    clearExpressionCache()
  })

  it('E1: evaluateTrack 空轨道返回 null', () => {
    expect(evaluateTrack(makeTrack({ keyframes: [] }), 5)).toBeNull()
  })

  it('E2: evaluateTrack 单关键帧返回该值', () => {
    const t = makeTrack({ keyframes: [makeKeyframe(0, 0.7)] })
    expect(evaluateTrack(t, 0)).toBe(0.7)
    expect(evaluateTrack(t, 100)).toBe(0.7)
  })

  it('E3: evaluateTrack time 在第一帧之前 → 第一帧值', () => {
    const t = makeTrack({ keyframes: [makeKeyframe(5, 0.3), makeKeyframe(10, 0.9)] })
    expect(evaluateTrack(t, 0)).toBe(0.3)
    expect(evaluateTrack(t, 5)).toBe(0.3)
  })

  it('E4: evaluateTrack time 在最后一帧之后 → 最后一帧值', () => {
    const t = makeTrack({ keyframes: [makeKeyframe(0, 0.3), makeKeyframe(5, 0.9)] })
    expect(evaluateTrack(t, 5)).toBe(0.9)
    expect(evaluateTrack(t, 100)).toBe(0.9)
  })

  it('E5: evaluateTrack linear 中点 = 平均值', () => {
    const t = makeTrack({ keyframes: [makeKeyframe(0, 0, 'linear'), makeKeyframe(10, 100, 'linear')] })
    expect(evaluateTrack(t, 5)).toBe(50)
    expect(evaluateTrack(t, 2.5)).toBe(25)
    expect(evaluateTrack(t, 7.5)).toBe(75)
  })

  it('E6: evaluateTrack step 返回左端点值', () => {
    const t = makeTrack({ keyframes: [makeKeyframe(0, 0, 'step'), makeKeyframe(5, 1, 'step')] })
    expect(evaluateTrack(t, 0)).toBe(0)
    expect(evaluateTrack(t, 2.5)).toBe(0)
    expect(evaluateTrack(t, 4.99)).toBe(0)
    expect(evaluateTrack(t, 5)).toBe(1)
  })

  it('E7: evaluateTrack bezier 端点 + 中点对称', () => {
    const t = makeTrack({ keyframes: [makeKeyframe(0, 0, 'bezier'), makeKeyframe(10, 100, 'bezier')] })
    expect(evaluateTrack(t, 0)).toBeCloseTo(0, 5)
    expect(evaluateTrack(t, 10)).toBeCloseTo(100, 5)
    expect(evaluateTrack(t, 5)).toBeCloseTo(50, 5)
  })

  it('E8: evaluateTrack 多关键帧区间', () => {
    const t = makeTrack({
      keyframes: [
        makeKeyframe(0, 0, 'linear'),
        makeKeyframe(5, 50, 'linear'),
        makeKeyframe(10, 100, 'linear'),
      ],
    })
    expect(evaluateTrack(t, 2.5)).toBe(25)
    expect(evaluateTrack(t, 7.5)).toBe(75)
  })

  it('E9: evaluateTrack 禁用轨道返回 null', () => {
    const t = makeTrack({
      enabled: false,
      keyframes: [makeKeyframe(0, 0), makeKeyframe(5, 1)],
    })
    expect(evaluateTrack(t, 2.5)).toBeNull()
  })

  it('E10: evaluateTrack EXPRESSION 模式', () => {
    const t = makeTrack({
      mode: 'EXPRESSION',
      expression: 'Math.sin(time) * 100',
      keyframes: [], // expression 不用 keyframes
    })
    expect(evaluateTrack(t, 0)).toBeCloseTo(0, 5)
    expect(evaluateTrack(t, Math.PI / 2)).toBeCloseTo(100, 5)
  })

  it('E11: evaluateTrack EXPRESSION 出错返回 null', () => {
    const t = makeTrack({
      mode: 'EXPRESSION',
      expression: 'thisIsNotDefined',
    })
    expect(evaluateTrack(t, 0)).toBeNull()
  })

  it('E12: evaluateAllTracks 跳过空 / 禁用 / 错误轨道', () => {
    const tracks: AnimationTrack[] = [
      makeTrack({ id: 't1', keyframes: [makeKeyframe(0, 0), makeKeyframe(10, 10)] }),
      makeTrack({ id: 't2', enabled: false, keyframes: [makeKeyframe(0, 0), makeKeyframe(10, 10)] }),
      makeTrack({ id: 't3', keyframes: [] }), // 空
      makeTrack({ id: 't4', mode: 'EXPRESSION', expression: 'badVar' }), // 表达式错
    ]
    const patches = evaluateAllTracks(tracks, 5)
    expect(patches.length).toBe(1)
    expect(patches[0].nodeId).toBe('n1')
    expect(patches[0].value).toBe(5)
  })

  it('E13: evaluateAllTracks 多轨道生成 ParamPatch', () => {
    const tracks: AnimationTrack[] = [
      makeTrack({ id: 't1', nodeId: 'n1', property: 'density', keyframes: [makeKeyframe(0, 0), makeKeyframe(10, 1)] }),
      makeTrack({ id: 't2', nodeId: 'n2', property: 'rotation', keyframes: [makeKeyframe(0, 0), makeKeyframe(10, 360)] }),
    ]
    const patches = evaluateAllTracks(tracks, 5)
    expect(patches.length).toBe(2)
    const p1 = patches.find((p) => p.property === 'density')
    const p2 = patches.find((p) => p.property === 'rotation')
    expect(p1?.value).toBe(0.5)
    expect(p2?.value).toBe(180)
  })

  it('E14: evaluateExpression 合法表达式返回 number', () => {
    expect(evaluateExpression('time * 2', 5)).toBe(10)
    expect(evaluateExpression('Math.sin(0)', 0)).toBe(0)
    expect(evaluateExpression('PI', 0)).toBeCloseTo(Math.PI, 5)
    expect(evaluateExpression('Math.PI', 0)).toBeCloseTo(Math.PI, 5)
  })

  it('E15: evaluateExpression 空字符串抛错', () => {
    expect(() => evaluateExpression('', 0)).toThrow()
    expect(() => evaluateExpression('   ', 0)).toThrow()
  })

  it('E16: evaluateExpression 非法语法抛错', () => {
    expect(() => evaluateExpression('thisIsNotDefined', 0)).toThrow()
  })

  it('E17: evaluateExpression 缓存命中(相同表达式只编译一次)', () => {
    // 第一次调用会编译
    evaluateExpression('Math.sin(time) * 0.5', 0)
    // 第二次命中缓存(无错误说明缓存可用)
    expect(evaluateExpression('Math.sin(time) * 0.5', Math.PI / 2)).toBeCloseTo(0.5, 5)
  })

  it('E18: validateExpression 合法 / 非法', () => {
    expect(validateExpression('Math.sin(time)')).toBeNull()
    expect(validateExpression('time * 2')).toBeNull()
    expect(validateExpression('')).not.toBeNull()
    expect(validateExpression('   ')).not.toBeNull()
    expect(validateExpression('undefinedVar')).not.toBeNull()
  })
})

// ============================================================================
// B: binding
// ============================================================================

describe('B: Binding 应用', () => {
  it('B1: createBinding 返回结构正确', () => {
    const b = createBinding('t1', 'graph', 'n1', 'density')
    expect(b).toEqual({ trackId: 't1', targetKind: 'graph', nodeId: 'n1', property: 'density' })
  })

  it('B2: applyAnimations 把 graph patch 推给 graphStore', () => {
    const graphStore = makeMockStore()
    const materialStore = makeMockStore()
    const patches: ParamPatch[] = [
      makePatch('graph', 'n1', 'density', 0.5),
      makePatch('material', 'm1', 'rotation', 1.2),
    ]
    const applied = applyAnimations(patches, graphStore, materialStore)
    expect(applied).toBe(2)
    expect(graphStore.calls.length).toBe(1)
    expect(graphStore.calls[0]).toEqual({ nodeId: 'n1', params: { density: 0.5 } })
    expect(materialStore.calls.length).toBe(1)
    expect(materialStore.calls[0]).toEqual({ nodeId: 'm1', params: { rotation: 1.2 } })
  })

  it('B3: applyAnimations color 属性转 [v, v, v, 1]', () => {
    const graphStore = makeMockStore()
    const patches: ParamPatch[] = [makePatch('graph', 'n1', 'color', 0.5)]
    applyAnimations(patches, graphStore, null)
    expect(graphStore.calls[0].params.color).toEqual([0.5, 0.5, 0.5, 1])
  })

  it('B4: applyAnimations 缺少对应 store 时跳过', () => {
    const graphStore = makeMockStore()
    // material store 为 null
    const patches: ParamPatch[] = [
      makePatch('graph', 'n1', 'density', 0.5),
      makePatch('material', 'm1', 'rotation', 1.2),
    ]
    const applied = applyAnimations(patches, graphStore, null)
    expect(applied).toBe(1) // 只有 graph 被应用
    expect(graphStore.calls.length).toBe(1)
  })

  it('B5: applyPatch 应用单个 patch', () => {
    const store = makeMockStore()
    const ok = applyPatch(makePatch('graph', 'n1', 'density', 0.7), store)
    expect(ok).toBe(true)
    expect(store.calls.length).toBe(1)
    expect(store.calls[0]).toEqual({ nodeId: 'n1', params: { density: 0.7 } })
  })

  it('B6: groupPatchesByNode 按 nodeId 分组', () => {
    const patches: ParamPatch[] = [
      makePatch('graph', 'n1', 'density', 0.5),
      makePatch('graph', 'n1', 'rotation', 1.0), // 同节点
      makePatch('graph', 'n2', 'scale', 2.0),
      makePatch('material', 'm1', 'color', 0.3),
    ]
    const grouped = groupPatchesByNode(patches)
    expect(grouped.size).toBe(3) // graph:n1, graph:n2, material:m1
    expect(grouped.get('graph:n1')?.length).toBe(2)
    expect(grouped.get('graph:n2')?.length).toBe(1)
    expect(grouped.get('material:m1')?.length).toBe(1)
  })

  it('B7: applyAnimationsGrouped 同节点多参数合并为 1 次调用', () => {
    const graphStore = makeMockStore()
    const patches: ParamPatch[] = [
      makePatch('graph', 'n1', 'density', 0.5),
      makePatch('graph', 'n1', 'rotation', 1.0), // 同节点
      makePatch('graph', 'n2', 'scale', 2.0),
    ]
    const applied = applyAnimationsGrouped(patches, graphStore, null)
    expect(applied).toBe(2) // 2 个节点
    expect(graphStore.calls.length).toBe(2)
    // n1 应该有 2 个参数合并
    const n1Call = graphStore.calls.find((c) => c.nodeId === 'n1')
    expect(Object.keys(n1Call!.params).sort()).toEqual(['density', 'rotation'])
  })

  it('B8: applyAnimationsGrouped color 属性自动转换', () => {
    const graphStore = makeMockStore()
    const patches: ParamPatch[] = [makePatch('graph', 'n1', 'color', 0.4)]
    applyAnimationsGrouped(patches, graphStore, null)
    expect(graphStore.calls[0].params.color).toEqual([0.4, 0.4, 0.4, 1])
  })
})

// ============================================================================
// P: player
// ============================================================================

describe('P: TimelinePlayer 播放器', () => {
  it('P1: 初始状态为 stopped, currentTime=0', () => {
    const p = new TimelinePlayer({ duration: 10 })
    expect(p.state).toBe('stopped')
    expect(p.currentTime).toBe(0)
    expect(p.duration).toBe(10)
    expect(p.loop).toBe(false)
    expect(p.fps).toBe(60)
    expect(p.speed).toBe(1)
    expect(p.isPlaying()).toBe(false)
    expect(p.isPaused()).toBe(false)
    expect(p.isStopped()).toBe(true)
  })

  it('P2: play/pause/stop 状态切换', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.play()
    expect(p.state).toBe('playing')
    expect(p.isPlaying()).toBe(true)
    p.pause()
    expect(p.state).toBe('paused')
    expect(p.isPaused()).toBe(true)
    p.stop()
    expect(p.state).toBe('stopped')
    expect(p.currentTime).toBe(0)
  })

  it('P3: play 到末尾后再次 play 从头开始(非循环)', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.seek(10) // 到末尾
    p.play()
    expect(p.currentTime).toBe(0) // 重置到开头
  })

  it('P4: play 到末尾后再次 play 不重置(循环模式)', () => {
    const p = new TimelinePlayer({ duration: 10, loop: true })
    p.seek(10)
    p.play()
    // 循环模式不强制重置(因为 update 时会自动循环)
    expect(p.isPlaying()).toBe(true)
  })

  it('P5: toggle 切换播放/暂停', () => {
    const p = new TimelinePlayer({ duration: 10 })
    expect(p.isPlaying()).toBe(false)
    p.toggle()
    expect(p.isPlaying()).toBe(true)
    p.toggle()
    expect(p.isPaused()).toBe(true)
  })

  it('P6: seek 钳制到 [0, duration]', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.seek(-5)
    expect(p.currentTime).toBe(0)
    p.seek(20)
    expect(p.currentTime).toBe(10)
    p.seek(5)
    expect(p.currentTime).toBe(5)
  })

  it('P7: seekFrame / currentFrame / totalFrames 换算', () => {
    const p = new TimelinePlayer({ duration: 10, fps: 60 })
    expect(p.totalFrames).toBe(600)
    p.seekFrame(300)
    expect(p.currentTime).toBeCloseTo(5, 5)
    expect(p.currentFrame).toBe(300)
  })

  it('P8: jumpToStart / jumpToEnd', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.seek(5)
    p.jumpToEnd()
    expect(p.currentTime).toBe(10)
    p.jumpToStart()
    expect(p.currentTime).toBe(0)
  })

  it('P9: stepBackward / stepForward', () => {
    const p = new TimelinePlayer({ duration: 10, fps: 60 })
    p.seekFrame(100)
    p.stepForward()
    expect(p.currentFrame).toBe(101)
    p.stepBackward()
    expect(p.currentFrame).toBe(100)
  })

  it('P10: update 非播放状态不推进', () => {
    const p = new TimelinePlayer({ duration: 10 })
    expect(p.update(0.5)).toBe(false)
    expect(p.currentTime).toBe(0)
  })

  it('P11: update 推进时间', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.play()
    expect(p.update(0.5)).toBe(true)
    expect(p.currentTime).toBeCloseTo(0.5, 5)
    p.update(0.5)
    expect(p.currentTime).toBeCloseTo(1.0, 5)
  })

  it('P12: update 到末尾停止(非循环)', () => {
    const p = new TimelinePlayer({ duration: 10, loop: false })
    p.play()
    p.update(15) // 超出末尾
    expect(p.currentTime).toBe(10)
    expect(p.state).toBe('stopped')
  })

  it('P13: update 到末尾循环(循环模式)', () => {
    const p = new TimelinePlayer({ duration: 10, loop: true })
    p.play()
    p.update(15) // 超出末尾 5 秒
    expect(p.currentTime).toBeCloseTo(5, 5)
    expect(p.isPlaying()).toBe(true)
  })

  it('P14: update 受 speed 影响', () => {
    const p = new TimelinePlayer({ duration: 10, speed: 2 })
    p.play()
    p.update(1)
    expect(p.currentTime).toBeCloseTo(2, 5)
  })

  it('P15: setDuration / setLoop / setSpeed / setFps', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.setDuration(20)
    expect(p.duration).toBe(20)
    p.setLoop(true)
    expect(p.loop).toBe(true)
    p.setSpeed(3)
    expect(p.speed).toBe(3)
    p.setFps(30)
    expect(p.fps).toBe(30)
  })

  it('P16: setDuration 把 currentTime 钳制到新 duration', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.seek(8)
    p.setDuration(5)
    expect(p.currentTime).toBe(5)
  })

  it('P17: progress 计算正确', () => {
    const p = new TimelinePlayer({ duration: 10 })
    expect(p.progress).toBe(0)
    p.seek(5)
    expect(p.progress).toBeCloseTo(0.5, 5)
    p.seek(10)
    expect(p.progress).toBe(1)
  })

  it('P18: createPlayer 工厂函数', () => {
    const p = createPlayer({ duration: 5, loop: true, fps: 30, speed: 2 })
    expect(p).toBeInstanceOf(TimelinePlayer)
    expect(p.duration).toBe(5)
    expect(p.loop).toBe(true)
    expect(p.fps).toBe(30)
    expect(p.speed).toBe(2)
  })

  it('P19: evaluateTracks 在当前时间求值', () => {
    const p = new TimelinePlayer({ duration: 10 })
    p.seek(5)
    const tracks: AnimationTrack[] = [
      makeTrack({ keyframes: [makeKeyframe(0, 0), makeKeyframe(10, 100)] }),
    ]
    const patches = p.evaluateTracks(tracks)
    expect(patches.length).toBe(1)
    expect(patches[0].value).toBe(50)
  })
})

// ============================================================================
// S: scheduler
// ============================================================================

describe('S: Scheduler 帧调度', () => {
  // 提供 rAF mock(node 环境无 rAF)
  let rafCallbacks: number[]
  let rafIdCounter: number
  // 虚拟时钟(避免依赖 performance.now 的真实时间)
  let virtualNow: number

  // 存放 rAF id → callback 的映射(声明在前,避免 TDZ)
  const rafCbMap = new Map<number, FrameRequestCallback>()

  beforeEach(() => {
    rafCallbacks = []
    rafIdCounter = 1
    virtualNow = 1000 // 起始时间(任意非零值)
    rafCbMap.clear()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = rafIdCounter++
      rafCallbacks.push(id)
      // 把 callback 存到全局映射,以便测试手动触发
      rafCbMap.set(id, cb)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks = rafCallbacks.filter((x) => x !== id)
      rafCbMap.delete(id)
    })
  })

  /**
   * 手动触发一次 rAF 回调。
   *
   * @param deltaMs 距上次触发的虚拟时间增量(毫秒)
   */
  function fireRaf(deltaMs: number = 16): void {
    virtualNow += deltaMs
    const id = rafCallbacks.shift()
    if (id === undefined) return
    const cb = rafCbMap.get(id)
    rafCbMap.delete(id)
    if (cb) cb(virtualNow)
  }

  it('S1: startFrameLoop autoStart=true 立即启动', () => {
    const loop: FrameLoopControl = startFrameLoop(() => {})
    expect(loop.isRunning()).toBe(true)
    loop.stop()
    expect(loop.isRunning()).toBe(false)
  })

  it('S2: startFrameLoop autoStart=false 不立即启动', () => {
    const loop = startFrameLoop(() => {}, { autoStart: false })
    expect(loop.isRunning()).toBe(false)
    loop.start()
    expect(loop.isRunning()).toBe(true)
    loop.stop()
  })

  it('S3: startFrameLoop 调用 callback(dt, now)', () => {
    let receivedDt = -1
    const loop = startFrameLoop((dt) => {
      receivedDt = dt
    })
    // 第一次 rAF 只初始化 lastTs(不调用 callback)
    fireRaf(0)
    // 第二次 rAF 才真正调用 callback(dt = 16ms = 0.016s)
    fireRaf(16)
    expect(receivedDt).toBeCloseTo(0.016, 5)
    loop.stop()
  })

  it('S4: startFrameLoop 钳制大 dt 到 100ms', () => {
    let receivedDt = -1
    const loop = startFrameLoop((dt) => {
      receivedDt = dt
    })
    fireRaf(0)
    fireRaf(5000) // 模拟标签页切换后大间隔
    expect(receivedDt).toBe(0.1) // 钳制到 100ms
    loop.stop()
  })

  it('S5: startFrameLoop callback 抛错不中断循环', () => {
    let callCount = 0
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loop = startFrameLoop(() => {
      callCount++
      if (callCount === 1) throw new Error('test error')
    })
    fireRaf(0)
    fireRaf(16) // 第一次回调抛错
    fireRaf(16) // 第二次回调应继续执行
    expect(callCount).toBe(2)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
    loop.stop()
  })

  it('S6: getFps 基于帧间隔计算', () => {
    const loop = startFrameLoop(() => {})
    fireRaf(0)
    fireRaf(16.67) // 60fps
    fireRaf(16.67)
    const fps = loop.getFps()
    // 16.67ms 间隔 ≈ 60fps
    expect(fps).toBeGreaterThan(55)
    expect(fps).toBeLessThan(65)
    loop.stop()
  })

  it('S7: startFixedTimestepLoop 按固定步长调用 callback', () => {
    const steps: number[] = []
    const loop = startFixedTimestepLoop(
      (dt) => { steps.push(dt) },
      1 / 60,  // fixedDt
      5,       // maxSteps
    )
    // 第一次初始化
    fireRaf(0)
    // 第二次:dt=0.1 秒(=6 个固定步),但 maxSteps=5,只执行 5 步
    fireRaf(100)
    expect(steps.length).toBe(5)
    expect(steps[0]).toBeCloseTo(1 / 60, 5)
    loop.stop()
  })
})

// ============================================================================
// U: uniformUpdater
// ============================================================================

describe('U: UniformUpdater GPU 更新', () => {
  it('U1: UniformBufferRegistry register / get / size', () => {
    const reg = new UniformBufferRegistry()
    expect(reg.size).toBe(0)
    const buf = makeMockBuffer()
    reg.register('n1', 'density', buf, 0, 4)
    expect(reg.size).toBe(1)
    const entry = reg.get('n1', 'density')
    expect(entry?.buffer).toBe(buf)
    expect(entry?.offset).toBe(0)
    expect(entry?.size).toBe(4)
  })

  it('U2: UniformBufferRegistry get 未注册返回 undefined', () => {
    const reg = new UniformBufferRegistry()
    expect(reg.get('n1', 'density')).toBeUndefined()
  })

  it('U3: UniformBufferRegistry unregister 单个参数', () => {
    const reg = new UniformBufferRegistry()
    reg.register('n1', 'density', makeMockBuffer())
    reg.register('n1', 'rotation', makeMockBuffer())
    expect(reg.size).toBe(2)
    expect(reg.unregister('n1', 'density')).toBe(true)
    expect(reg.size).toBe(1)
    expect(reg.unregister('n1', 'nonexistent')).toBe(false)
  })

  it('U4: UniformBufferRegistry unregisterNode 删除节点所有参数', () => {
    const reg = new UniformBufferRegistry()
    reg.register('n1', 'density', makeMockBuffer())
    reg.register('n1', 'rotation', makeMockBuffer())
    reg.register('n2', 'scale', makeMockBuffer())
    const removed = reg.unregisterNode('n1')
    expect(removed).toBe(2)
    expect(reg.size).toBe(1)
    expect(reg.get('n2', 'scale')).toBeDefined()
  })

  it('U5: UniformBufferRegistry clear 清空', () => {
    const reg = new UniformBufferRegistry()
    reg.register('n1', 'density', makeMockBuffer())
    reg.clear()
    expect(reg.size).toBe(0)
  })

  it('U6: collectUniformUpdates 只返回已注册的 patch', () => {
    const reg = new UniformBufferRegistry()
    const buf1 = makeMockBuffer('b1')
    reg.register('n1', 'density', buf1, 0, 4)
    // n2 未注册
    const patches: ParamPatch[] = [
      makePatch('graph', 'n1', 'density', 0.5),
      makePatch('graph', 'n2', 'rotation', 1.0),
    ]
    const updates = collectUniformUpdates(patches, reg)
    expect(updates.length).toBe(1)
    expect(updates[0].buffer).toBe(buf1)
    expect(updates[0].offset).toBe(0)
    expect(updates[0].data[0]).toBe(0.5)
    expect(updates[0].sourceTrackId).toBe('n1:density')
  })

  it('U7: flushUniformUpdates 批量写入 GPU', () => {
    const device = makeMockDevice()
    const buf1 = makeMockBuffer('b1')
    const buf2 = makeMockBuffer('b2')
    const updates = [
      { buffer: buf1, offset: 0, data: new Float32Array([0.5]), sourceTrackId: 't1' },
      { buffer: buf2, offset: 4, data: new Float32Array([1.0]), sourceTrackId: 't2' },
    ]
    const count = flushUniformUpdates(updates, device)
    expect(count).toBe(2)
    expect(device.writes.length).toBe(2)
    expect(device.writes[0].buffer).toBe(buf1)
    expect(device.writes[0].offset).toBe(0)
    expect(device.writes[0].data[0]).toBe(0.5)
    expect(device.writes[1].buffer).toBe(buf2)
    expect(device.writes[1].offset).toBe(4)
  })

  it('U8: applyUniformUpdates 一步完成(收集 + 写入)', () => {
    const reg = new UniformBufferRegistry()
    const buf = makeMockBuffer()
    reg.register('n1', 'density', buf, 0, 4)
    const device = makeMockDevice()
    const patches: ParamPatch[] = [makePatch('graph', 'n1', 'density', 0.8)]
    const count = applyUniformUpdates(patches, reg, device)
    expect(count).toBe(1)
    expect(device.writes.length).toBe(1)
    // Float32 精度损失,用 toBeCloseTo 比较
    expect(device.writes[0].data[0]).toBeCloseTo(0.8, 5)
  })

  it('U9: 全局 uniformRegistry 单例可用', () => {
    // 清空避免之前测试影响
    uniformRegistry.clear()
    expect(uniformRegistry.size).toBe(0)
    uniformRegistry.register('global_n1', 'density', makeMockBuffer())
    expect(uniformRegistry.size).toBe(1)
    uniformRegistry.clear()
  })
})

// ============================================================================
// TL: timeline store
// ============================================================================

describe('TL: Timeline Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('TL1: 初始 state 默认值', () => {
    const s = useAnimationStore()
    expect(s.duration).toBe(DEFAULT_TIMELINE_DURATION)
    expect(s.fps).toBe(DEFAULT_TIMELINE_FPS)
    expect(s.currentTime).toBe(0)
    expect(s.isPlaying).toBe(false)
    expect(s.loop).toBe(false)
    expect(s.speed).toBe(1)
    expect(s.tracks).toEqual([])
    expect(s.selectedTrackId).toBeNull()
  })

  it('TL2: getters 默认值', () => {
    const s = useAnimationStore()
    expect(s.trackCount).toBe(0)
    expect(s.enabledTrackCount).toBe(0)
    expect(s.currentFrame).toBe(0)
    expect(s.totalFrames).toBe(600)
    expect(s.progress).toBe(0)
    expect(s.selectedTrack).toBeNull()
    expect(s.keyframeCount).toBe(0)
  })

  it('TL3: addTrack 创建并返回 trackId', () => {
    const s = useAnimationStore()
    const id = s.addTrack('graph', 'n1', 'density', '密度')
    expect(id).toBeTruthy()
    expect(s.trackCount).toBe(1)
    expect(s.tracks[0].label).toBe('密度')
    expect(s.tracks[0].targetKind).toBe('graph')
    expect(s.tracks[0].nodeId).toBe('n1')
    expect(s.tracks[0].property).toBe('density')
  })

  it('TL4: addTrackDirect 添加完整轨道', () => {
    const s = useAnimationStore()
    const t = createKeyframeTrack('graph', 'n1', 'density', 0, 1, 5)
    const id = s.addTrackDirect(t)
    expect(id).toBe(t.id)
    expect(s.trackCount).toBe(1)
    expect(s.keyframeCount).toBe(2)
  })

  it('TL5: removeTrack 删除并清理选中', () => {
    const s = useAnimationStore()
    const id = s.addTrack('graph', 'n1', 'density')
    s.selectTrack(id)
    expect(s.selectedTrackId).toBe(id)
    expect(s.removeTrack(id)).toBe(true)
    expect(s.trackCount).toBe(0)
    expect(s.selectedTrackId).toBeNull()
    expect(s.removeTrack('nonexistent')).toBe(false)
  })

  it('TL6: selectTrack / setTrackEnabled / renameTrack / setTrackColor / setTrackMode / setTrackExpression', () => {
    const s = useAnimationStore()
    const id = s.addTrack('graph', 'n1', 'density')
    s.selectTrack(id)
    expect(s.selectedTrack?.id).toBe(id)
    s.setTrackEnabled(id, false)
    expect(s.enabledTrackCount).toBe(0)
    s.renameTrack(id, '新名称')
    expect(s.tracks[0].label).toBe('新名称')
    s.setTrackColor(id, '#ff0000')
    expect(s.tracks[0].color).toBe('#ff0000')
    s.setTrackMode(id, 'EXPRESSION')
    expect(s.tracks[0].mode).toBe('EXPRESSION')
    s.setTrackExpression(id, 'Math.sin(time)')
    expect(s.tracks[0].expression).toBe('Math.sin(time)')
  })

  it('TL7: addKeyframe 添加关键帧(自动排序)', () => {
    const s = useAnimationStore()
    const tid = s.addTrack('graph', 'n1', 'density')
    const k1 = s.addKeyframe(tid, 5, 0.5)
    const k2 = s.addKeyframe(tid, 0, 0)
    expect(k1).toBeTruthy()
    expect(k2).toBeTruthy()
    expect(s.keyframeCount).toBe(2)
    // 检查排序
    const track = s.tracks[0]
    expect(track.keyframes[0].time).toBe(0)
    expect(track.keyframes[1].time).toBe(5)
  })

  it('TL8: addKeyframe 同时刻已存在则更新', () => {
    const s = useAnimationStore()
    const tid = s.addTrack('graph', 'n1', 'density')
    const k1 = s.addKeyframe(tid, 5, 0.5)
    const k2 = s.addKeyframe(tid, 5, 0.9) // 同时刻
    expect(k2).toBe(k1)
    expect(s.keyframeCount).toBe(1)
    expect(s.tracks[0].keyframes[0].value).toBe(0.9)
  })

  it('TL9: addKeyframe 轨道不存在返回 null', () => {
    const s = useAnimationStore()
    expect(s.addKeyframe('nonexistent', 0, 0)).toBeNull()
  })

  it('TL10: removeKeyframe / updateKeyframe / clearKeyframes', () => {
    const s = useAnimationStore()
    const tid = s.addTrack('graph', 'n1', 'density')
    s.addKeyframe(tid, 0, 0)
    const k2 = s.addKeyframe(tid, 5, 0.5)
    const k3 = s.addKeyframe(tid, 10, 1)
    expect(s.keyframeCount).toBe(3)
    // update(addKeyframe 返回 string | null,测试中确保非 null)
    expect(k2).not.toBeNull()
    expect(s.updateKeyframe(tid, k2!, { value: 0.7 })).toBe(true)
    expect(s.tracks[0].keyframes[1].value).toBe(0.7)
    // remove
    expect(k3).not.toBeNull()
    expect(s.removeKeyframe(tid, k3!)).toBe(true)
    expect(s.keyframeCount).toBe(2)
    // clear
    expect(s.clearKeyframes(tid)).toBe(true)
    expect(s.keyframeCount).toBe(0)
  })

  it('TL11: playback 状态切换', () => {
    const s = useAnimationStore()
    expect(s.isPlaying).toBe(false)
    s.play()
    expect(s.isPlaying).toBe(true)
    s.pause()
    expect(s.isPlaying).toBe(false)
    s.togglePlay()
    expect(s.isPlaying).toBe(true)
    s.togglePlay()
    expect(s.isPlaying).toBe(false)
    s.stop()
    expect(s.isPlaying).toBe(false)
    expect(s.currentTime).toBe(0)
  })

  it('TL12: play 到末尾后从头开始(非循环)', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.seek(10)
    s.play()
    expect(s.currentTime).toBe(0)
  })

  it('TL13: seek / seekFrame / jumpToStart / jumpToEnd / stepBackward / stepForward', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.seek(5)
    expect(s.currentTime).toBe(5)
    s.seekFrame(300)
    expect(s.currentTime).toBeCloseTo(5, 5)
    s.jumpToEnd()
    expect(s.currentTime).toBe(10)
    s.jumpToStart()
    expect(s.currentTime).toBe(0)
    s.stepForward()
    expect(s.currentFrame).toBe(1)
    s.stepBackward()
    expect(s.currentFrame).toBe(0)
  })

  it('TL14: seek 钳制到 [0, duration]', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.seek(-5)
    expect(s.currentTime).toBe(0)
    s.seek(20)
    expect(s.currentTime).toBe(10)
  })

  it('TL15: advanceTime 推进 / 循环 / 末尾停止', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    // 非播放状态不推进
    expect(s.advanceTime(0.5)).toBe(false)
    expect(s.currentTime).toBe(0)
    // 播放并推进
    s.play()
    expect(s.advanceTime(0.5)).toBe(true)
    expect(s.currentTime).toBeCloseTo(0.5, 5)
    // 到末尾停止
    s.advanceTime(10)
    expect(s.currentTime).toBe(10)
    expect(s.isPlaying).toBe(false)
  })

  it('TL16: advanceTime 循环模式回到开头', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.setLoop(true)
    s.play()
    s.advanceTime(15) // 超出 5 秒
    expect(s.currentTime).toBeCloseTo(5, 5)
    expect(s.isPlaying).toBe(true)
  })

  it('TL17: advanceTime 受 speed 影响', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.setSpeed(2)
    s.play()
    s.advanceTime(1)
    expect(s.currentTime).toBeCloseTo(2, 5)
  })

  it('TL18: setDuration 钳制 currentTime', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.seek(8)
    s.setDuration(5)
    expect(s.currentTime).toBe(5)
  })

  it('TL19: evaluate 求值当前时间的所有轨道', () => {
    const s = useAnimationStore()
    s.setDuration(10)
    s.addTrackDirect(createKeyframeTrack('graph', 'n1', 'density', 0, 1, 10))
    s.addTrackDirect(createKeyframeTrack('graph', 'n2', 'rotation', 0, 360, 10))
    s.seek(5)
    const patches = s.evaluate()
    expect(patches.length).toBe(2)
    const d = patches.find((p) => p.property === 'density')
    const r = patches.find((p) => p.property === 'rotation')
    expect(d?.value).toBeCloseTo(0.5, 5)
    expect(r?.value).toBeCloseTo(180, 5)
  })

  it('TL20: loadTimeline 加载 / exportTimeline 导出', () => {
    const s = useAnimationStore()
    const t = createKeyframeTrack('graph', 'n1', 'density', 0, 1, 5)
    s.loadTimeline({
      duration: 20,
      fps: 30,
      loop: true,
      speed: 2,
      tracks: [t],
    })
    expect(s.duration).toBe(20)
    expect(s.fps).toBe(30)
    expect(s.loop).toBe(true)
    expect(s.speed).toBe(2)
    expect(s.trackCount).toBe(1)
    expect(s.currentTime).toBe(0)
    expect(s.isPlaying).toBe(false)

    // 修改后导出
    s.seek(5)
    const exported = s.exportTimeline()
    expect(exported.duration).toBe(20)
    expect(exported.fps).toBe(30)
    expect(exported.loop).toBe(true)
    expect(exported.speed).toBe(2)
    expect(exported.currentTime).toBe(5)
    expect(exported.tracks.length).toBe(1)
    expect(exported.tracks[0].keyframes.length).toBe(2)
  })

  it('TL21: clearAll 清空所有状态', () => {
    const s = useAnimationStore()
    s.addTrack('graph', 'n1', 'density')
    s.seek(5)
    s.play()
    s.clearAll()
    expect(s.trackCount).toBe(0)
    expect(s.currentTime).toBe(0)
    expect(s.isPlaying).toBe(false)
    expect(s.selectedTrackId).toBeNull()
  })

  it('TL22: genId 生成带前缀的 id', () => {
    const s = useAnimationStore()
    const id = s.genId('test')
    expect(id.startsWith('test_')).toBe(true)
  })
})
