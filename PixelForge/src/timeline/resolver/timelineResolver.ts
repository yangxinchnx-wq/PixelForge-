/**
 * PixelForge Timeline Core — Timeline Resolver。
 *
 * 作用：给定时间，返回当前需要渲染的内容。
 *
 * 输入：time = 12 秒
 * 输出：[VideoClip01, TextClip, AudioClip]
 *
 * 利用 TimelineIndex（Interval Tree）实现 O(log n) 查询，
 * 避免每帧遍历所有 Clip。
 */

import type { Clip } from '../core/clip';
import type { Sequence } from '../core/sequence';
import type { Track } from '../core/track';
import { TrackType } from '../core/track';
import type { Time } from '../core/time';
import { TimelineIndex } from './timelineIndex';

/** 解析结果：当前时间需要渲染的 Clip，按轨道类型分组。 */
export interface ResolvedFrame {
  /** 视频轨道上活跃的 Clip（按 index 从小到大排序，底轨在前） */
  videoLayers: Clip[];
  /** 音频轨道上活跃的 Clip */
  audioLayers: Clip[];
  /** 效果轨道上活跃的 Clip 的 effects 列表 */
  effects: string[];
}

/**
 * 解析指定时间点的活跃 Clip。
 *
 * 遍历所有启用的轨道，利用 Interval Tree 快速查询每个轨道在该时间点
 * 活跃的 Clip，然后按轨道类型分类。
 *
 * @param sequence 当前序列
 * @param time 查询时间点（微秒 Time）
 * @returns 按轨道类型分组的活跃 Clip
 */
export function resolve(sequence: Sequence, time: Time): ResolvedFrame {
  const videoLayers: Clip[] = [];
  const audioLayers: Clip[] = [];
  const effects: string[] = [];

  for (const track of sequence.tracks) {
    if (!track.enabled) continue;

    const activeClips = queryTrackClips(track, time);

    for (const clip of activeClips) {
      switch (track.type) {
        case TrackType.VIDEO:
          videoLayers.push(clip);
          break;
        case TrackType.AUDIO:
          audioLayers.push(clip);
          break;
        case TrackType.EFFECT:
          effects.push(...clip.effects);
          break;
        // TEXT 轨道的 Clip 归入 videoLayers（文字也渲染到画面）
        case TrackType.TEXT:
          videoLayers.push(clip);
          break;
      }
    }
  }

  // 视频/文字轨道按 index 从小到大排序（底轨在前，后渲染的覆盖在上面）
  videoLayers.sort((a, b) => {
    const trackA = sequence.tracks.find((t) => t.id === a.trackId);
    const trackB = sequence.tracks.find((t) => t.id === b.trackId);
    return (trackA?.index ?? 0) - (trackB?.index ?? 0);
  });

  return { videoLayers, audioLayers, effects };
}

/**
 * 查询单个轨道在指定时间点活跃的 Clip。
 *
 * 为该轨道构建 Interval Tree 索引，然后查询。
 */
function queryTrackClips(track: Track, time: Time): Clip[] {
  if (track.clips.length === 0) return [];

  const index = new TimelineIndex();
  index.build(track.clips);
  return index.query(time);
}
