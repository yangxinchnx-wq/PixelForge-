/**
 * Clip(Step 31.1)— 时间轴片段模型。
 *
 * 核心概念:
 * - Asset: 原始媒体文件(视频/音频/图片),在 assetStore 中管理
 * - Clip:  Asset 在时间轴上的一个实例引用
 *
 * 同一个 Asset 可以被多个 Clip 引用(不同时间区间 / 不同源区间)。
 *
 * 时间模型:
 *   Asset:    |==== sourceStart ==== sourceEnd ====|
 *   Clip:               |==== duration ====|
 *   Timeline:  start →  |=================|  ← end
 *
 * - timelineStart: Clip 在时间轴上的起始位置
 * - duration:      Clip 在时间轴上的时长(= sourceEnd - sourceStart)
 * - sourceStart:   引用 Asset 的源起始时间
 * - sourceEnd:     引用 Asset 的源结束时间
 */

import type { Time } from './time'
import { ZERO, add, sub } from './time'
import type { TimeRange } from './range'
import { fromStartDuration, duration as rangeDuration } from './range'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * 片段类型(与 AssetType 对应)。
 */
export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'effect'

/**
 * 变换(位置 / 缩放 / 旋转 / 不透明度)。
 * 用于覆叠轨道上的 Clip 在画面中的定位。
 */
export interface ClipTransform {
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
}

/** 默认变换 */
export const DEFAULT_TRANSFORM: ClipTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
}

/**
 * Clip — 时间轴片段。
 *
 * @property id            唯一 ID
 * @property assetId       引用的 Asset ID
 * @property kind          片段类型
 * @property timelineStart 在时间轴上的起始时间(微秒)
 * @property duration      时长(微秒)= sourceEnd - sourceStart
 * @property sourceStart   Asset 源起始时间(微秒)
 * @property sourceEnd     Asset 源结束时间(微秒)
 * @property transform     画面变换(位置/缩放/旋转/不透明度)
 * @property speed         播放速度倍率(1.0 = 正常,2.0 = 2 倍速,0.5 = 慢放)
 * @property volume        音量(0-1,仅 audio/video 类型)
 * @property enabled       是否启用(false = 静音/隐藏)
 * @property locked        是否锁定(锁定后不可编辑)
 * @property label         显示名称(可选,默认用 asset 名)
 * @property effects       片段级特效列表(Effect ID 数组)
 * @property groupId       群组 ID(可选,同一 groupId 的 Clip 视为一个群组,Step 31.4)
 * @property sequenceId    引用的 Sequence ID(可选,用于嵌套 Sequence,Step 31.6)
 */
export interface Clip {
  id: string
  assetId: string
  kind: ClipKind
  timelineStart: Time
  duration: Time
  sourceStart: Time
  sourceEnd: Time
  transform: ClipTransform
  speed: number
  volume: number
  enabled: boolean
  locked: boolean
  label?: string
  effects: string[]
  groupId?: string
  sequenceId?: string
}

// ============================================================================
// 2. 构造
// ============================================================================

let clipIdCounter = 0

/** 生成唯一 Clip ID */
export function genClipId(): string {
  clipIdCounter++
  return `clip_${Date.now().toString(36)}_${clipIdCounter.toString(36)}`
}

/**
 * 创建 Clip。
 *
 * @param options 部分 Clip 属性(可选字段有默认值)
 *
 * @example
 *   const clip = createClip({
 *     assetId: 'asset_001',
 *     kind: 'video',
 *     timelineStart: seconds(0),
 *     sourceStart: seconds(30),
 *     sourceEnd: seconds(50),
 *   })
 *   // duration 自动 = sourceEnd - sourceStart = 20s
 */
export function createClip(options: {
  assetId: string
  kind: ClipKind
  timelineStart: Time
  sourceStart: Time
  sourceEnd: Time
  id?: string
  transform?: Partial<ClipTransform>
  speed?: number
  volume?: number
  enabled?: boolean
  locked?: boolean
  label?: string
  effects?: string[]
  sequenceId?: string
}): Clip {
  const {
    assetId,
    kind,
    timelineStart,
    sourceStart,
    sourceEnd,
    id,
    transform,
    speed = 1,
    volume = 1,
    enabled = true,
    locked = false,
    label,
    effects = [],
    sequenceId,
  } = options

  if (sourceEnd <= sourceStart) {
    throw new Error(`createClip: sourceEnd (${sourceEnd}) 必须大于 sourceStart (${sourceStart})`)
  }
  if (timelineStart < 0n) {
    throw new Error(`createClip: timelineStart 不能为负,收到 ${timelineStart}`)
  }

  const clipDuration = sub(sourceEnd, sourceStart)

  const clip: Clip = {
    id: id ?? genClipId(),
    assetId,
    kind,
    timelineStart,
    duration: clipDuration,
    sourceStart,
    sourceEnd,
    transform: { ...DEFAULT_TRANSFORM, ...transform },
    speed,
    volume,
    enabled,
    locked,
    label,
    effects,
  }
  if (sequenceId !== undefined) {
    clip.sequenceId = sequenceId
  }
  return clip
}

// ============================================================================
// 3. 时间区间查询
// ============================================================================

/** Clip 在时间轴上的区间 [timelineStart, timelineStart + duration) */
export function getTimelineRange(clip: Clip): TimeRange {
  return fromStartDuration(clip.timelineStart, clip.duration)
}

/** Clip 的结束时间 */
export function getClipEnd(clip: Clip): Time {
  return add(clip.timelineStart, clip.duration)
}

/** 时间点是否在 Clip 区间内 [start, end) */
export function isClipActiveAt(clip: Clip, time: Time): boolean {
  return time >= clip.timelineStart && time < getClipEnd(clip)
}

/** 时间点是否在 Clip 区间内 [start, end](闭区间,用于边界判断) */
export function isClipActiveAtInclusive(clip: Clip, time: Time): boolean {
  return time >= clip.timelineStart && time <= getClipEnd(clip)
}

// ============================================================================
// 4. 时间映射(时间轴 → 源)
// ============================================================================

/**
 * 把时间轴时间映射到 Asset 源时间。
 *
 * 公式: sourceTime = sourceStart + (timelineTime - timelineStart) * speed
 *
 * @param clip      Clip
 * @param timelineTime 时间轴时间
 * @returns Asset 源时间(若 timelineTime 不在 Clip 范围内,返回 null)
 *
 * @example
 *   // Clip: timelineStart=0, sourceStart=30s, speed=1
 *   // timelineTime=10s → sourceTime=40s
 *   mapToSource(clip, seconds(10))  // 40_000_000n
 */
export function mapToSource(clip: Clip, timelineTime: Time): Time | null {
  if (!isClipActiveAtInclusive(clip, timelineTime)) return null
  const offset = sub(timelineTime, clip.timelineStart)
  // 考虑速度:sourceOffset = offset * speed
  const sourceOffset = BigInt(Math.floor(Number(offset) * clip.speed))
  return add(clip.sourceStart, sourceOffset)
}

// ============================================================================
// 5. 克隆与修改
// ============================================================================

/** 深拷贝 Clip(新 ID) */
export function cloneClip(clip: Clip, newId?: string): Clip {
  return {
    ...clip,
    id: newId ?? genClipId(),
    transform: { ...clip.transform },
    effects: [...clip.effects],
  }
}

/**
 * 修改 Clip 的起始时间(平移)。
 *
 * @returns 新的 Clip(timelineStart 更新,duration 不变)
 */
export function moveClip(clip: Clip, newTimelineStart: Time): Clip {
  if (newTimelineStart < 0n) newTimelineStart = ZERO
  return { ...clip, timelineStart: newTimelineStart }
}

/**
 * 修剪 Clip 的左边界(起始时间)。
 *
 * 同时调整 timelineStart / sourceStart / duration。
 * 修剪量 delta 为正表示向右缩短,为负表示向左延长。
 *
 * @param clip   原 Clip
 * @param delta  修剪量(微秒,正=缩短左边界,负=延长左边界)
 * @returns 修剪后的 Clip
 */
export function trimClipLeft(clip: Clip, delta: Time): Clip {
  const newDuration = sub(clip.duration, delta)
  if (newDuration <= 0n) {
    throw new Error(`trimClipLeft: 修剪后时长必须 > 0,收到 ${newDuration}`)
  }
  const newTimelineStart = clip.timelineStart + delta
  const newSourceStart = clip.sourceStart + delta
  if (newTimelineStart < 0n) throw new Error('trimClipLeft: timelineStart 不能为负')
  if (newSourceStart < 0n) throw new Error('trimClipLeft: sourceStart 不能为负')
  return {
    ...clip,
    timelineStart: newTimelineStart,
    sourceStart: newSourceStart,
    duration: newDuration,
  }
}

/**
 * 修剪 Clip 的右边界(结束时间)。
 *
 * 修剪量 delta 为正表示缩短,为负表示延长。
 *
 * @param clip  原 Clip
 * @param delta 修剪量(微秒,正=缩短右边界,负=延长右边界)
 * @returns 修剪后的 Clip
 */
export function trimClipRight(clip: Clip, delta: Time): Clip {
  const newDuration = sub(clip.duration, delta)
  if (newDuration <= 0n) {
    throw new Error(`trimClipRight: 修剪后时长必须 > 0,收到 ${newDuration}`)
  }
  const newSourceEnd = clip.sourceEnd - delta
  if (newSourceEnd <= clip.sourceStart) {
    throw new Error('trimClipRight: sourceEnd 必须 > sourceStart')
  }
  return {
    ...clip,
    duration: newDuration,
    sourceEnd: newSourceEnd,
  }
}

// ============================================================================
// 6. 工具
// ============================================================================

/** 按 timelineStart 排序的比较器 */
export function compareClipByStart(a: Clip, b: Clip): number {
  if (a.timelineStart < b.timelineStart) return -1
  if (a.timelineStart > b.timelineStart) return 1
  return 0
}

/** 获取 Clip 的时长(便捷方法,= rangeDuration(getTimelineRange(clip))) */
export function getClipDuration(clip: Clip): Time {
  return rangeDuration(getTimelineRange(clip))
}

// ============================================================================
// 7. 属性 setter(Step 31.4 — 用于 Inspector 面板修改 + Command)
// ============================================================================

let groupIdCounter = 0

/** 生成唯一群组 ID */
export function genGroupId(): string {
  groupIdCounter++
  return `grp_${Date.now().toString(36)}_${groupIdCounter.toString(36)}`
}

/** 设置 Clip 的群组 ID(传 undefined 解除群组) */
export function setClipGroupId(clip: Clip, groupId?: string): Clip {
  const newClip = { ...clip }
  if (groupId === undefined) {
    delete newClip.groupId
  } else {
    newClip.groupId = groupId
  }
  return newClip
}

// ============================================================================
// 7. 嵌套 Sequence(Step 31.6)
// ============================================================================

/** 判断 Clip 是否为嵌套 Sequence 引用(而非普通 Asset 引用) */
export function isNestedSequenceClip(clip: Clip): boolean {
  return clip.sequenceId !== undefined && clip.sequenceId.length > 0
}

/**
 * 设置 Clip 引用的 Sequence ID(传 undefined 取消嵌套引用)。
 *
 * 注意:调用方需自行校验循环引用(setClipSequenceId 不做校验,
 * 因为循环检测需要 Project 上下文,见 nestedSequenceResolver)。
 */
export function setClipSequenceId(clip: Clip, sequenceId?: string): Clip {
  const newClip = { ...clip }
  if (sequenceId === undefined || sequenceId.length === 0) {
    delete newClip.sequenceId
  } else {
    newClip.sequenceId = sequenceId
  }
  return newClip
}

/** 设置 Clip 标签 */
export function setClipLabel(clip: Clip, label: string): Clip {
  return { ...clip, label: label.trim() || clip.label }
}

/** 设置 Clip 速度(同时调整 sourceEnd 保持 duration 不变) */
export function setClipSpeed(clip: Clip, speed: number): Clip {
  const clamped = Math.max(0.1, Math.min(10, speed))
  return { ...clip, speed: clamped }
}

/** 设置 Clip 音量(0-1) */
export function setClipVolume(clip: Clip, volume: number): Clip {
  return { ...clip, volume: Math.max(0, Math.min(1, volume)) }
}

/** 设置 Clip 启用状态 */
export function setClipEnabled(clip: Clip, enabled: boolean): Clip {
  return { ...clip, enabled }
}

/** 设置 Clip 锁定状态 */
export function setClipLocked(clip: Clip, locked: boolean): Clip {
  return { ...clip, locked }
}

/** 设置 Clip Transform(部分更新) */
export function setClipTransform(clip: Clip, transform: Partial<ClipTransform>): Clip {
  return { ...clip, transform: { ...clip.transform, ...transform } }
}

/** 设置 Clip 颜色(通过 label 字段存储,可选;若需要独立颜色可扩展) */
export function setClipColor(clip: Clip, color: string): Clip & { color?: string } {
  return { ...clip, color }
}
