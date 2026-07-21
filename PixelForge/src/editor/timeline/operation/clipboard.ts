/**
 * clipboard(Step 31.4)— 剪贴板数据模型。
 *
 * 设计:
 * - 单例式 clipboard(全局共享,跨 Sequence 也有效)
 * - 存储被复制的 Clip 快照 + 来源 trackId,粘贴时生成新 ID
 * - 粘贴位置 = 播放头位置,多个 clip 保持相对时间偏移
 *
 * 数据结构:
 *   ClipboardEntry[] = [
 *     { clipSnapshot, sourceTrackId, timelineOffsetFromFirst },
 *     ...
 *   ]
 *
 * 粘贴策略:
 *   - 第一个 clip 的 timelineStart = pasteAt
 *   - 其余 clip 的 timelineStart = pasteAt + timelineOffsetFromFirst
 *   - 粘贴到原 trackId 对应轨道(若不存在则粘贴到当前第一个轨道)
 *   - 生成新 clip ID + 新 sourceEnd(保持 duration)
 */
import type { Clip } from '../core/clip'
import { cloneClip, getClipEnd } from '../core/clip'
import type { Time } from '../core/time'
import { ZERO, add, sub } from '../core/time'

export interface ClipboardEntry {
  /** Clip 快照(原 ID,粘贴时会被替换) */
  clipSnapshot: Clip
  /** 来源 track ID(粘贴时尽量保持同 trackId) */
  sourceTrackId: string
  /** 相对第一个 clip 起始的偏移(微秒,>=0) */
  timelineOffsetFromFirst: Time
}

/** 全局剪贴板(模块单例) */
let clipboardEntries: ClipboardEntry[] = []
/** 复制时的最早起始时间(用于计算偏移) */
let clipboardFirstStart: Time = ZERO

/**
 * 复制 clips 到剪贴板。
 *
 * @param clips     要复制的 Clip 数组
 * @param trackIds  每个 clip 对应的 trackId(与 clips 同长)
 */
export function copyToClipboard(clips: Clip[], trackIds: string[]): void {
  if (clips.length === 0) {
    clipboardEntries = []
    clipboardFirstStart = ZERO
    return
  }

  // 找最早起始时间
  let firstStart = clips[0].timelineStart
  for (const c of clips) {
    if (c.timelineStart < firstStart) firstStart = c.timelineStart
  }
  clipboardFirstStart = firstStart

  clipboardEntries = clips.map((c, i) => ({
    clipSnapshot: cloneClip(c), // 深拷贝,保留原 ID
    sourceTrackId: trackIds[i],
    timelineOffsetFromFirst: sub(c.timelineStart, firstStart),
  }))
}

/** 剪贴板是否为空 */
export function isClipboardEmpty(): boolean {
  return clipboardEntries.length === 0
}

/** 获取剪贴板条目数 */
export function getClipboardSize(): number {
  return clipboardEntries.length
}

/** 清空剪贴板 */
export function clearClipboard(): void {
  clipboardEntries = []
  clipboardFirstStart = ZERO
}

/**
 * 从剪贴板粘贴:生成新 Clip 数组(新 ID),粘贴位置为 pasteAt。
 *
 * @param pasteAt 粘贴起始时间(通常为播放头位置)
 * @returns 新 Clip 数组 + 对应 trackId 数组;若剪贴板为空返回空数组
 */
export function pasteFromClipboard(
  pasteAt: Time,
): { clips: Clip[]; trackIds: string[] } {
  if (clipboardEntries.length === 0) {
    return { clips: [], trackIds: [] }
  }

  const newClips: Clip[] = []
  const newTrackIds: string[] = []

  for (const entry of clipboardEntries) {
    const newClip = cloneClip(entry.clipSnapshot) // 生成新 ID
    newClip.timelineStart = add(pasteAt, entry.timelineOffsetFromFirst)
    if (newClip.timelineStart < ZERO) newClip.timelineStart = ZERO
    newClips.push(newClip)
    newTrackIds.push(entry.sourceTrackId)
  }

  return { clips: newClips, trackIds: newTrackIds }
}

/**
 * 获取剪贴板中所有 clip 的总时间跨度(最早 start 到 最晚 end)。
 * 用于 UI 显示"已复制 3 个片段,跨度 5.2s"。
 */
export function getClipboardSpan(): Time {
  if (clipboardEntries.length === 0) return ZERO
  let maxEnd = ZERO
  for (const entry of clipboardEntries) {
    const end = getClipEnd(entry.clipSnapshot)
    if (end > maxEnd) maxEnd = end
  }
  return sub(maxEnd, clipboardFirstStart)
}
