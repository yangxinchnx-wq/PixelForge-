/**
 * PixelForge Media Video — Mp4Demuxer（MP4 解封装器）。
 *
 * MP4 文件结构：
 *   Header → Metadata → Video Track → Audio Track → Samples
 *
 * 需要：MP4 → Encoded Video Packets → Decoder
 *
 * Decoder 不吃 MP4，它吃 EncodedVideoChunk。
 */

/** 解封装后的编码数据块。 */
export interface DemuxedChunk {
  /** 帧时间戳（微秒） */
  timestamp: number;
  /** 是否关键帧（I Frame） */
  isKeyFrame: boolean;
  /** 编码数据 */
  data: ArrayBuffer;
}

/** 关键帧位置信息（用于 Seek）。 */
export interface KeyFrameInfo {
  /** 帧号 */
  frame: number;
  /** 时间戳（微秒） */
  timestamp: number;
  /** 在文件中的字节偏移 */
  offset: number;
  /** 数据大小（字节） */
  size: number;
}

/**
 * Mp4Demuxer — MP4 文件解封装。
 *
 * 从 MP4 文件中提取 EncodedVideoChunk 供 VideoDecoder 使用。
 *
 * 注意：完整的 MP4 解析需要实现 ISO BMFF（ISO/IEC 14496-12）解析器。
 * 当前版本提供接口定义和简化实现框架。
 */
export class Mp4Demuxer {
  private fileData: ArrayBuffer | null = null;
  private keyFrames: KeyFrameInfo[] = [];

  /**
   * 加载 MP4 文件数据。
   *
   * @param data MP4 文件 ArrayBuffer
   */
  async load(data: ArrayBuffer): Promise<void> {
    this.fileData = data;
    // 实际实现需要解析 MP4 box 结构（ftyp/moov/mdat）
    // 提取 stbl（Sample Table Box）中的关键帧位置
    this.keyFrames = [];
  }

  /**
   * 获取视频编解码信息。
   *
   * @returns codec 字符串（如 "avc1.640028"）
   */
  getCodec(): string {
    // 实际实现需要从 stsd（Sample Description Box）读取
    return 'avc1.640028';
  }

  /**
   * 获取所有关键帧位置（用于 Seek）。
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
    // 实际实现需要从 mdat（Media Data Box）读取采样数据
    // 按 stbl 中的偏移和大小读取
    return [];
  }

  /**
   * 找到目标时间之前最近的关键帧。
   *
   * Seek 时不能从 0 开始解码，需要找到最近的 I Frame。
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
