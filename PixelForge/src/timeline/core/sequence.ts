/**
 * PixelForge Timeline Core — Sequence（序列）。
 *
 * Sequence 就是一条时间线，包含多条轨道。
 * 定义了输出分辨率、帧率和总时长。
 */

import type { Time } from './time';
import type { Track } from './track';

/** 序列（时间线）。 */
export interface Sequence {
  /** 稳定 ID */
  id: string;
  /** 序列名称 */
  name: string;
  /** 输出宽度（像素） */
  width: number;
  /** 输出高度（像素） */
  height: number;
  /** 帧率（如 30 / 29.97 / 60） */
  fps: number;
  /** 总时长（微秒 Time） */
  duration: Time;
  /** 轨道列表 */
  tracks: Track[];
}
