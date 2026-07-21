/**
 * PixelForge Timeline Core — Track（轨道）。
 *
 * 轨道是 Clip 的容器，按类型分组（视频 / 音频 / 文字 / 效果）。
 * 渲染顺序：index 大的在上面（后渲染 = 覆盖在上面）。
 */

import type { Clip } from './clip';

/** 轨道类型。 */
export enum TrackType {
  VIDEO = 'video',
  AUDIO = 'audio',
  TEXT = 'text',
  EFFECT = 'effect',
}

/** 轨道。 */
export interface Track {
  /** 稳定 ID */
  id: string;
  /** 轨道名称（如 "Video 1"） */
  name: string;
  /** 轨道类型 */
  type: TrackType;
  /** 轨道索引（大的在上面） */
  index: number;
  /** 轨道上的 Clip 列表 */
  clips: Clip[];
  /** 是否启用 */
  enabled: boolean;
  /** 是否锁定 */
  locked: boolean;
}
