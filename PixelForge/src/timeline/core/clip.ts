/**
 * PixelForge Timeline Core — Clip（片段）。
 *
 * Clip 不是视频文件本身，而是「一个媒体在时间轴中的引用」。
 *
 * 双时间系统：
 *   - timelineStart / duration：Timeline 世界的位置和时长
 *   - sourceStart / sourceDuration：Source（原素材）世界的起始和时长
 *
 * 剪辑的本质是改变两个世界的映射关系：
 *   用户截取原视频 50-60 秒，放到时间轴 10 秒位置
 *   → timelineStart=10s, sourceStart=50s, duration=10s
 */

import type { Time } from './time';
import type { Transform } from './transform';

/** Clip：媒体在时间轴中的引用。 */
export interface Clip {
  /** 稳定 ID */
  id: string;
  /** 关联的素材 ID */
  assetId: string;
  /** 所在轨道 ID */
  trackId: string;
  /** Timeline 世界的起始时间 */
  timelineStart: Time;
  /** Timeline 世界的时长 */
  duration: Time;
  /** Source（原素材）世界的起始时间 */
  sourceStart: Time;
  /** Source 世界的可用时长 */
  sourceDuration: Time;
  /** 空间变换 */
  transform: Transform;
  /** 绑定的效果 ID 列表 */
  effects: string[];
}
