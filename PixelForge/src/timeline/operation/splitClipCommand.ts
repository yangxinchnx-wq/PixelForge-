/**
 * PixelForge Timeline — SplitClipCommand。
 *
 * Blade 切割工具的命令：一个 Clip 切两个。
 *
 * 原：Clip A [0 ──────────── 60]
 * 切在：30 秒
 * 生成：
 *   Clip A [0 ──── 30]          duration = cutTime
 *   Clip B [30 ──── 60]         sourceStart += cutTime, timelineStart += cutTime
 *
 * 步骤：
 *   1. 复制 Clip
 *   2. 修改左边 clip.duration = cutTime
 *   3. 修改右边 newClip.sourceStart += cutTime, newClip.timelineStart += cutTime
 *   4. 插入 Track
 */

import type { Command } from './command';
import type { Clip } from '../core/clip';
import type { Track } from '../core/track';
import type { Time } from '../core/time';

/** 生成简单唯一 ID。 */
function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 切割 Clip 的命令。 */
export class SplitClipCommand implements Command {
  readonly clipId: string;
  private clip: Clip;
  private track: Track;
  /** 切割偏移量（相对于 clip.timelineStart） */
  private cutTime: Time;
  /** 原始 duration（undo 时恢复） */
  private originalDuration: Time;
  /** 原始 sourceDuration（undo 时恢复） */
  private originalSourceDuration: Time;
  /** 新创建的右侧 Clip（execute 后生成，undo 后置 null） */
  private newClip: Clip | null = null;

  /**
   * @param clip    要切割的 Clip 引用
   * @param track   所在轨道
   * @param cutTime 切割偏移量（相对于 clip.timelineStart）
   */
  constructor(clip: Clip, track: Track, cutTime: Time) {
    this.clip = clip;
    this.clipId = clip.id;
    this.track = track;
    this.cutTime = cutTime;
    this.originalDuration = clip.duration;
    this.originalSourceDuration = clip.sourceDuration;
  }

  execute(): void {
    // 1-2. 修改左边：duration = cutTime
    this.clip.duration = this.cutTime;
    this.clip.sourceDuration = this.cutTime;

    // 3. 创建右边
    this.newClip = {
      ...this.clip,
      id: createId('clip'),
      sourceStart: this.clip.sourceStart + this.cutTime,
      timelineStart: this.clip.timelineStart + this.cutTime,
      duration: this.originalDuration - this.cutTime,
      sourceDuration: this.originalSourceDuration - this.cutTime,
      transform: { ...this.clip.transform },
      effects: [...this.clip.effects],
    };

    // 4. 插入 Track
    this.track.clips.push(this.newClip);
  }

  undo(): void {
    // 恢复左边
    this.clip.duration = this.originalDuration;
    this.clip.sourceDuration = this.originalSourceDuration;

    // 移除右边
    if (this.newClip !== null) {
      const idx = this.track.clips.indexOf(this.newClip);
      if (idx >= 0) {
        this.track.clips.splice(idx, 1);
      }
      this.newClip = null;
    }
  }

  /** 获取新创建的右侧 Clip ID（execute 后可用）。 */
  getNewClipId(): string | null {
    return this.newClip?.id ?? null;
  }
}
