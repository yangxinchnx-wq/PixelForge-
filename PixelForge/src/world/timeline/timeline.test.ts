/**
 * Timeline 求值器 + 管理器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  interpolateKeyframes,
  evaluateTrack,
  evaluateTimeline,
} from './evaluator'
import {
  createTimeline,
  createTrack,
  createKeyframe,
  addTrack,
  addKeyframe,
  removeTrack,
  updateTrack,
  removeKeyframe,
  updateKeyframe,
  getTimelineDuration,
  normalizeTimeline,
  resetTimelineIdCounter,
} from './timelineManager'
import type { TimelineContent, TimelineTrack, TimelineKeyframe } from '../types'

describe('interpolateKeyframes', () => {
  const k1: TimelineKeyframe = {
    id: 'kf1', time: 0, value: 0, interpolation: 'linear',
  }
  const k2: TimelineKeyframe = {
    id: 'kf2', time: 1, value: 100, interpolation: 'linear',
  }

  it('linear 插值应在两端之间', () => {
    expect(interpolateKeyframes(0.5, k1, k2)).toBe(50)
  })

  it('t=0 应返回前一帧值', () => {
    expect(interpolateKeyframes(0, k1, k2)).toBe(0)
  })

  it('t=1 应返回后一帧值', () => {
    expect(interpolateKeyframes(1, k1, k2)).toBe(100)
  })

  it('step 插值应保持前一帧值', () => {
    const stepK1 = { ...k1, interpolation: 'step' as const }
    expect(interpolateKeyframes(0.99, stepK1, k2)).toBe(0)
  })

  it('hold 插值应保持前一帧值', () => {
    const holdK1 = { ...k1, interpolation: 'hold' as const }
    expect(interpolateKeyframes(0.99, holdK1, k2)).toBe(0)
  })

  it('数组值应逐元素插值', () => {
    const ka: TimelineKeyframe = {
      id: 'a', time: 0, value: [0, 0, 0, 1], interpolation: 'linear',
    }
    const kb: TimelineKeyframe = {
      id: 'b', time: 1, value: [100, 200, 50, 1], interpolation: 'linear',
    }
    const result = interpolateKeyframes(0.5, ka, kb)
    expect(result).toEqual([50, 100, 25, 1])
  })

  it('时间相等时应返回后一帧值', () => {
    const kSame: TimelineKeyframe = {
      id: 'same', time: 0, value: 42, interpolation: 'linear',
    }
    expect(interpolateKeyframes(0, k1, kSame)).toBe(42)
  })

  it('bezier 插值无控制点时应退化为线性', () => {
    const bezK1: TimelineKeyframe = {
      id: 'bez1', time: 0, value: 0, interpolation: 'bezier',
    }
    expect(interpolateKeyframes(0.5, bezK1, k2)).toBe(50)
  })

  it('bezier 插值有控制点时应使用贝塞尔曲线', () => {
    const bezK1: TimelineKeyframe = {
      id: 'bez1', time: 0, value: 0, interpolation: 'bezier',
      bezierControl: { cp1: [0.3, 100], cp2: [0.7, 100] },
    }
    // u=0.5 时贝塞尔曲线值应接近 75（由控制点拉高）
    const result = interpolateKeyframes(0.5, bezK1, k2)
    expect(typeof result).toBe('number')
    expect(result as number).toBeGreaterThan(50)
    expect(result as number).toBeLessThan(100)
  })
})

describe('evaluateTrack', () => {
  const track: TimelineTrack = {
    id: 'track1',
    name: 'opacity',
    targetEntity: 'layer',
    targetId: 'layer_0',
    paramKey: 'opacity',
    keyframes: [
      { id: 'kf1', time: 0, value: 1.0, interpolation: 'linear' },
      { id: 'kf2', time: 2, value: 0.0, interpolation: 'linear' },
    ],
    enabled: true,
  }

  it('应在第一帧之前返回第一帧值', () => {
    expect(evaluateTrack(track, -1)).toBe(1.0)
  })

  it('应在最后一帧之后返回最后一帧值', () => {
    expect(evaluateTrack(track, 5)).toBe(0.0)
  })

  it('应在两帧之间插值', () => {
    expect(evaluateTrack(track, 1)).toBe(0.5)
  })

  it('禁用轨道应返回 null', () => {
    const disabled = { ...track, enabled: false }
    expect(evaluateTrack(disabled, 1)).toBeNull()
  })

  it('空关键帧应返回 null', () => {
    const empty = { ...track, keyframes: [] }
    expect(evaluateTrack(empty, 1)).toBeNull()
  })

  it('多个关键帧应正确二分查找', () => {
    const multi: TimelineTrack = {
      ...track,
      keyframes: [
        { id: 'k1', time: 0, value: 0, interpolation: 'linear' },
        { id: 'k2', time: 1, value: 10, interpolation: 'linear' },
        { id: 'k3', time: 2, value: 20, interpolation: 'linear' },
        { id: 'k4', time: 3, value: 30, interpolation: 'linear' },
        { id: 'k5', time: 4, value: 40, interpolation: 'linear' },
      ],
    }
    expect(evaluateTrack(multi, 2.5)).toBe(25)
  })
})

describe('evaluateTimeline', () => {
  it('应生成所有启用轨道的 ValuePatch', () => {
    const timeline: TimelineContent = {
      id: 'tl1',
      duration: 5,
      loop: false,
      fps: 30,
      tracks: [
        {
          id: 't1', name: 'opacity', targetEntity: 'layer', targetId: 'L1',
          paramKey: 'opacity', enabled: true,
          keyframes: [
            { id: 'k1', time: 0, value: 1.0, interpolation: 'linear' },
            { id: 'k2', time: 2, value: 0.5, interpolation: 'linear' },
          ],
        },
        {
          id: 't2', name: 'radius', targetEntity: 'layer', targetId: 'L2',
          paramKey: 'radius', enabled: true,
          keyframes: [
            { id: 'k3', time: 0, value: 0.3, interpolation: 'linear' },
            { id: 'k4', time: 2, value: 0.6, interpolation: 'linear' },
          ],
        },
      ],
    }

    const result = evaluateTimeline(timeline, 1)

    expect(result.currentTime).toBe(1)
    expect(result.patches).toHaveLength(2)
    expect(result.patches[0].source).toBe('l3_timeline')
    expect(result.patches[0].tier).toBe('value')
    expect(result.patches[0].targetId).toBe('L1')
    expect(result.patches[0].value).toBe(0.75)
    expect(result.patches[1].targetId).toBe('L2')
    expect(result.patches[1].value).toBeCloseTo(0.45, 10)
    expect(result.skippedTracks).toHaveLength(0)
  })

  it('禁用的轨道应跳过', () => {
    const timeline: TimelineContent = {
      id: 'tl1', duration: 5, loop: false, fps: 30,
      tracks: [
        {
          id: 't1', name: 'opacity', targetEntity: 'layer', targetId: 'L1',
          paramKey: 'opacity', enabled: false,
          keyframes: [{ id: 'k1', time: 0, value: 1.0, interpolation: 'linear' }],
        },
      ],
    }

    const result = evaluateTimeline(timeline, 0)
    expect(result.patches).toHaveLength(0)
    expect(result.skippedTracks).toEqual(['t1'])
  })
})

describe('timelineManager', () => {
  beforeEach(() => {
    resetTimelineIdCounter()
  })

  it('createTimeline 应创建空时间轴', () => {
    const tl = createTimeline(10, 30, true)
    expect(tl.tracks).toHaveLength(0)
    expect(tl.duration).toBe(10)
    expect(tl.fps).toBe(30)
    expect(tl.loop).toBe(true)
  })

  it('addTrack + addKeyframe 应正确添加', () => {
    let tl = createTimeline()
    const track = createTrack('opacity', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    expect(tl.tracks).toHaveLength(1)

    const kf = createKeyframe(0, 1.0, 'linear')
    tl = addKeyframe(tl, track.id, kf)
    expect(tl.tracks[0].keyframes).toHaveLength(1)
    expect(tl.tracks[0].keyframes[0].time).toBe(0)
  })

  it('addKeyframe 应按 time 排序', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)

    tl = addKeyframe(tl, track.id, createKeyframe(2, 0.5))
    tl = addKeyframe(tl, track.id, createKeyframe(0, 1.0))
    tl = addKeyframe(tl, track.id, createKeyframe(1, 0.75))

    expect(tl.tracks[0].keyframes.map((k) => k.time)).toEqual([0, 1, 2])
  })

  it('removeTrack 应移除轨道', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    tl = removeTrack(tl, track.id)
    expect(tl.tracks).toHaveLength(0)
  })

  it('updateTrack 应更新轨道属性', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    tl = updateTrack(tl, track.id, { enabled: false, name: 'updated' })
    expect(tl.tracks[0].enabled).toBe(false)
    expect(tl.tracks[0].name).toBe('updated')
  })

  it('removeKeyframe 应移除关键帧', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    const kf = createKeyframe(0, 1.0)
    tl = addKeyframe(tl, track.id, kf)
    tl = removeKeyframe(tl, track.id, kf.id)
    expect(tl.tracks[0].keyframes).toHaveLength(0)
  })

  it('updateKeyframe 应更新关键帧', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    const kf = createKeyframe(0, 1.0)
    tl = addKeyframe(tl, track.id, kf)
    tl = updateKeyframe(tl, track.id, kf.id, { value: 0.5 })
    expect(tl.tracks[0].keyframes[0].value).toBe(0.5)
  })

  it('updateKeyframe 更新 time 应重新排序', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    const kf1 = createKeyframe(0, 1.0)
    const kf2 = createKeyframe(1, 0.5)
    tl = addKeyframe(tl, track.id, kf1)
    tl = addKeyframe(tl, track.id, kf2)
    tl = updateKeyframe(tl, track.id, kf2.id, { time: -1 })
    expect(tl.tracks[0].keyframes.map((k) => k.time)).toEqual([-1, 0])
  })

  it('getTimelineDuration 应返回最大关键帧时间', () => {
    let tl = createTimeline()
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    tl = addKeyframe(tl, track.id, createKeyframe(3, 1.0))
    tl = addKeyframe(tl, track.id, createKeyframe(7, 0.5))
    expect(getTimelineDuration(tl)).toBe(7)
  })

  it('normalizeTimeline 应更新 duration', () => {
    let tl = createTimeline(5)
    const track = createTrack('test', 'layer', 'L1', 'opacity')
    tl = addTrack(tl, track)
    tl = addKeyframe(tl, track.id, createKeyframe(10, 1.0))
    tl = normalizeTimeline(tl)
    expect(tl.duration).toBe(10)
  })
})
