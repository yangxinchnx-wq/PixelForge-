/**
 * PixelForge Timeline Core — Timeline Store。
 *
 * 状态管理：管理 Project / Sequence / Clip 的编辑状态。
 *
 * 结构：
 *   project:       当前工程
 *   activeSequence: 当前活动序列 ID
 *   selectedClip:   当前选中的 Clip ID
 *
 * 操作：
 *   addClip()     — 添加 Clip 到轨道
 *   removeClip()  — 删除 Clip
 *   moveClip()    — 移动 Clip 时间位置
 *   splitClip()   — 在指定时间点切割 Clip
 *
 * 集成 CommandStack 支持 Undo / Redo。
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { Project } from '../core/project';
import type { Sequence } from '../core/sequence';
import type { Clip } from '../core/clip';
import type { Time } from '../core/time';
import { defaultTransform } from '../core/transform';
import { CommandStack } from '../operation/commandStack';

/** 生成简单唯一 ID。 */
function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 查找 Clip 所在的轨道和 Clip 对象。
 * 返回 { track, clip, clipIndex } 或 null。
 */
function findClipInSequence(
  sequence: Sequence,
  clipId: string,
): { track: Sequence['tracks'][number]; clip: Clip; clipIndex: number } | null {
  for (const track of sequence.tracks) {
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) {
      return { track, clip: track.clips[clipIndex], clipIndex };
    }
  }
  return null;
}

export const useTimelineStore = defineStore('timeline-core', () => {
  // ---- 状态 ----
  const project = ref<Project | null>(null);
  const activeSequence = ref<string | null>(null);
  const selectedClip = ref<string | null>(null);

  /** CommandStack — 支持 Undo / Redo */
  const commandStack = new CommandStack();

  // ---- 计算属性 ----

  /** 当前活动序列对象。 */
  const activeSequenceObj = computed<Sequence | null>(() => {
    if (!project.value || !activeSequence.value) return null;
    return (
      project.value.sequences.find((s) => s.id === activeSequence.value) ?? null
    );
  });

  // ---- 操作 ----

  /**
   * 添加 Clip 到指定轨道。
   *
   * 流程：Media Asset → Create Clip → Insert Track → Timeline
   *
   * @param trackId      目标轨道 ID
   * @param assetId      关联素材 ID
   * @param time         Timeline 起始时间
   * @param duration     素材时长（同时作为 duration 和 sourceDuration）
   */
  function addClip(
    trackId: string,
    assetId: string,
    time: Time,
    duration: Time,
  ): string | null {
    const seq = activeSequenceObj.value;
    if (!seq) return null;

    const track = seq.tracks.find((t) => t.id === trackId);
    if (!track) return null;

    const clipId = createId('clip');
    const clip: Clip = {
      id: clipId,
      assetId,
      trackId,
      timelineStart: time,
      duration,
      sourceStart: 0n,
      sourceDuration: duration,
      transform: { ...defaultTransform },
      effects: [],
    };

    track.clips.push(clip);
    selectedClip.value = clipId;
    return clipId;
  }

  /**
   * 删除 Clip。
   *
   * @param clipId 要删除的 Clip ID
   */
  function removeClip(clipId: string): void {
    const seq = activeSequenceObj.value;
    if (!seq) return;

    const found = findClipInSequence(seq, clipId);
    if (!found) return;

    const { track, clipIndex } = found;
    track.clips.splice(clipIndex, 1);

    if (selectedClip.value === clipId) {
      selectedClip.value = null;
    }
  }

  /**
   * 移动 Clip 时间位置。
   *
   * @param clipId 要移动的 Clip ID
   * @param delta  时间偏移量（微秒 Time，正数向右，负数向左）
   */
  function moveClip(clipId: string, delta: Time): void {
    const seq = activeSequenceObj.value;
    if (!seq) return;

    const found = findClipInSequence(seq, clipId);
    if (!found) return;

    found.clip.timelineStart += delta;
  }

  /**
   * 在指定时间点切割 Clip（一个变两个）。
   *
   * 原：Clip A  [0 ──────────── 60]
   * 切在：30 秒
   * 生成：
   *   Clip A  [0 ──── 30]     duration = cutTime
   *   Clip B  [30 ──── 60]    sourceStart += cutTime, timelineStart += cutTime
   *
   * @param clipId 要切割的 Clip ID
   * @param time   切割时间点（Timeline 绝对时间）
   * @returns 新创建的右侧 Clip ID，或 null（切割点不在 Clip 范围内）
   */
  function splitClip(clipId: string, time: Time): string | null {
    const seq = activeSequenceObj.value;
    if (!seq) return null;

    const found = findClipInSequence(seq, clipId);
    if (!found) return null;

    const { track, clip } = found;

    // 切割点必须在 Clip 内部（不能在边界上）
    const cutTime = time - clip.timelineStart;
    if (cutTime <= 0n || cutTime >= clip.duration) return null;

    // 1. 复制 Clip（右侧）
    const newClip: Clip = {
      ...clip,
      id: createId('clip'),
      // 2. 修改右边：sourceStart += cutTime, timelineStart += cutTime
      sourceStart: clip.sourceStart + cutTime,
      timelineStart: clip.timelineStart + cutTime,
      duration: clip.duration - cutTime,
      sourceDuration: clip.sourceDuration - cutTime,
      transform: { ...clip.transform },
      effects: [...clip.effects],
    };

    // 3. 修改左边：duration = cutTime
    clip.duration = cutTime;
    clip.sourceDuration = cutTime;

    // 4. 插入 Track
    const insertIndex = track.clips.indexOf(clip) + 1;
    track.clips.splice(insertIndex, 0, newClip);

    return newClip.id;
  }

  // ---- 工程 / 序列管理 ----

  /**
   * 创建新工程。
   */
  function newProject(name: string): void {
    const now = Date.now();
    project.value = {
      id: createId('project'),
      name,
      sequences: [],
      created: now,
      modified: now,
    };
    activeSequence.value = null;
    selectedClip.value = null;
    commandStack.clear();
  }

  /**
   * 在当前工程中创建新序列并设为活动。
   */
  function createSequence(
    name: string,
    width: number,
    height: number,
    fps: number,
    duration: Time,
  ): string | null {
    if (!project.value) return null;

    const seqId = createId('seq');
    const sequence: Sequence = {
      id: seqId,
      name,
      width,
      height,
      fps,
      duration,
      tracks: [],
    };

    project.value.sequences.push(sequence);
    project.value.modified = Date.now();
    activeSequence.value = seqId;
    return seqId;
  }

  /**
   * 在当前序列中创建新轨道。
   */
  function addTrack(name: string, type: Sequence['tracks'][number]['type']): string | null {
    const seq = activeSequenceObj.value;
    if (!seq) return null;

    const trackId = createId('track');
    const index = seq.tracks.length;
    seq.tracks.push({
      id: trackId,
      name,
      type,
      index,
      clips: [],
      enabled: true,
      locked: false,
    });
    return trackId;
  }

  // ---- Undo / Redo ----

  function undo(): void {
    commandStack.undo();
  }

  function redo(): void {
    commandStack.redo();
  }

  return {
    // 状态
    project,
    activeSequence,
    selectedClip,
    activeSequenceObj,
    commandStack,
    // 操作
    addClip,
    removeClip,
    moveClip,
    splitClip,
    // 工程/序列管理
    newProject,
    createSequence,
    addTrack,
    // Undo / Redo
    undo,
    redo,
  };
});
