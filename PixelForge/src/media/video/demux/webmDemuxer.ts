/**
 * PixelForge Media Video — WebmDemuxer（WebM 解封装器）。
 *
 * WebM 文件结构基于 EBML（Extensible Binary Meta Language）。
 *
 * 结构：
 *   EBML Header → Segment → Tracks → Clusters → Blocks
 *
 * 需要：WebM → Encoded Video Packets → Decoder
 */

import type { DemuxedChunk, KeyFrameInfo } from './mp4Demuxer';

/**
 * WebmDemuxer — WebM 文件解封装。
 *
 * 从 WebM 文件中提取 EncodedVideoChunk 供 VideoDecoder 使用。
 * WebM 使用 VP9 / AV1 / VP8 编码。
 */
export class WebmDemuxer {
  private fileData: ArrayBuffer | null = null;
  private keyFrames: KeyFrameInfo[] = [];

  /**
   * 加载 WebM 文件数据。
   *
   * @param data WebM 文件 ArrayBuffer
   */
  async load(data: ArrayBuffer): Promise<void> {
    this.fileData = data;
    // 实际实现需要解析 EBML 结构
    // 提取 Cluster 中的关键帧（Block Flags 中标记）
    this.keyFrames = [];
  }

  /**
   * 获取视频编解码信息。
   *
   * @returns codec 字符串（如 "vp09.00.10.08" 或 "av01.0.05M.08"）
   */
  getCodec(): string {
    return 'vp09.00.10.08';
  }

  /**
   * 获取所有关键帧位置。
   */
  getKeyFrames(): KeyFrameInfo[] {
    return this.keyFrames;
  }

  /**
   * 读取指定范围内的编码块。
   *
   * @param startTime 开始时间（微秒）
   * @param endTime   结束时间（微秒）
   * @returns 编码块列表
   */
  readChunks(_startTime: number, _endTime: number): DemuxedChunk[] {
    if (!this.fileData) return [];
    // 实际实现需要从 Cluster → Block 中读取
    return [];
  }

  /**
   * 找到目标时间之前最近的关键帧。
   *
   * @param time 目标时间（微秒）
   * @returns 最近的关键帧信息，或 null
   */
  findNearestKeyFrame(time: number): KeyFrameInfo | null {
    let nearest: KeyFrameInfo | null = null;
    for (const kf of this.keyFrames) {
      if (kf.timestamp <= time) {
        nearest = kf;
      } else {
        break;
      }
    }
    return nearest;
  }
}
