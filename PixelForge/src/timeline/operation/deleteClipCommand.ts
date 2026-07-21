/**
 * PixelForge Timeline — DeleteClipCommand + RippleDeleteCommand。
 *
 * 普通删除：
 *   A B C → 删除 B → A   C（C 不动）
 *
 * Ripple Delete：
 *   A B C → 删除 B → A C（C 自动前移）
 *
 * 实现（Ripple）：
 *   找到 clipsAfterDeleted
 *   循环：clip.start -= duration
 */

import type { Command } from './command';
import type { Clip } from '../core/clip';
import type { Track } from '../core/track';
import type { Time } from '../core/time';

/** 普通删除 Clip 的命令。 */
export class DeleteClipCommand implements Command {
  readonly clipId: string;
  private clip: Clip;
  private track: Track;
  /** 删除前在 track.clips 中的索引（undo 时恢复到原位置） */
  private clipIndex: number = -1;

  /**
   * @param clip  要删除的 Clip 引用
   * @param track 所在轨道
   */
  constructor(clip: Clip, track: Track) {
    this.clip = clip;
    this.clipId = clip.id;
    this.track = track;
  }

  execute(): void {
    this.clipIndex = this.track.clips.indexOf(this.clip);
    if (this.clipIndex >= 0) {
      this.track.clips.splice(this.clipIndex, 1);
    }
  }

  undo(): void {
    if (this.clipIndex >= 0) {
      this.track.clips.splice(this.clipIndex, 0, this.clip);
    }
  }
}

/**
 * Ripple Delete 命令。
 *
 * 删除指定 Clip 后，同一轨道中位于被删除 Clip 之后的所有 Clip
 * 自动前移，填补空隙。
 *
 * A B C → 删除 B → A C（C 自动前移 B 的 duration）
 *
 * 实现：
 *   找到 clipsAfterDeleted
 *   循环：clip.timelineStart -= duration
 */
export class RippleDeleteCommand implements Command {
  readonly clipId: string;
  private clip: Clip;
  private track: Track;
  /** 被删除 Clip 的时长（Ripple 前移量） */
  private rippleDelta: Time;
  /** 被影响的后续 Clip 及其原始 timelineStart（undo 时恢复） */
  private affectedClips: { clip: Clip; originalStart: Time }[] = [];
  /** 删除前在 track.clips 中的索引 */
  private clipIndex: number = -1;

  /**
   * @param clip  要删除的 Clip 引用
   * @param track 所在轨道
   */
  constructor(clip: Clip, track: Track) {
    this.clip = clip;
    this.clipId = clip.id;
    this.track = track;
    this.rippleDelta = clip.duration;
  }

  execute(): void {
    // 1. 记录被删除 Clip 的索引
    this.clipIndex = this.track.clips.indexOf(this.clip);
    if (this.clipIndex < 0) return;

    const deletedEnd = this.clip.timelineStart + this.clip.duration;

    // 2. 找到同轨道中 timelineStart >= deletedEnd 的所有 Clip（后方 Clip）
    this.affectedClips = [];
    for (const c of this.track.clips) {
      if (c.id !== this.clip.id && c.timelineStart >= deletedEnd) {
        this.affectedClips.push({ clip: c, originalStart: c.timelineStart });
      }
    }

    // 3. 删除 Clip
    this.track.clips.splice(this.clipIndex, 1);

    // 4. 后方 Clip 前移
    for (const { clip: c } of this.affectedClips) {
      c.timelineStart -= this.rippleDelta;
    }
  }

  undo(): void {
    // 1. 恢复后方 Clip 的原始位置
    for (const { clip, originalStart } of this.affectedClips) {
      clip.timelineStart = originalStart;
    }

    // 2. 恢复被删除的 Clip 到原位置
    if (this.clipIndex >= 0) {
      this.track.clips.splice(this.clipIndex, 0, this.clip);
    }

    this.affectedClips = [];
  }
}
