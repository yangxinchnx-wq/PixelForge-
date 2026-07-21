/**
 * PixelForge Media Video — PixelVideoDecoder（视频解码器）。
 *
 * 使用 WebCodecs VideoDecoder API 进行硬件加速解码。
 *
 * 链路：
 *   EncodedVideoChunk → VideoDecoder → VideoFrame
 *
 * 配置 Decoder：
 *   decoder.configure({ codec: "avc1.640028", codedWidth: 1920, codedHeight: 1080 })
 *
 * 解码：
 *   decoder.decode(new EncodedVideoChunk({ type: "key", timestamp: 0, data }))
 *
 * 输出：
 *   VideoFrame { timestamp, codedWidth, codedHeight }
 */

import { FrameCache } from '../cache/frameCache';

/** 解码器配置。 */
export interface DecoderConfig {
  /** 编解码器字符串（如 "avc1.640028" / "vp09" / "av01"） */
  codec: string;
  /** 编码宽度 */
  codedWidth: number;
  /** 编码高度 */
  codedHeight: number;
}

/**
 * PixelVideoDecoder — WebCodecs 视频解码器封装。
 *
 * 当 GPU 解码完成时调用 output(frame) 回调。
 */
export class PixelVideoDecoder {
  private decoder: VideoDecoder | null = null;
  private cache: FrameCache;
  private frameCallback: ((frame: VideoFrame) => void) | null = null;

  constructor() {
    this.cache = new FrameCache(120);

    if (typeof VideoDecoder !== 'undefined') {
      this.decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          this.handleFrame(frame);
        },
        error: (err: DOMException) => {
          console.error('[VideoDecoder] 解码错误:', err);
        },
      });
    }
  }

  /**
   * 配置解码器。
   *
   * @param config 编解码器配置
   */
  configure(config: DecoderConfig): void {
    if (!this.decoder) {
      console.warn('[VideoDecoder] 当前环境不支持 WebCodecs');
      return;
    }
    this.decoder.configure({
      codec: config.codec,
      codedWidth: config.codedWidth,
      codedHeight: config.codedHeight,
    });
  }

  /**
   * 解码一个编码块。
   *
   * @param timestamp 帧时间戳（微秒）
   * @param data      编码数据
   * @param isKeyFrame 是否关键帧
   */
  decode(timestamp: number, data: ArrayBuffer, isKeyFrame: boolean): void {
    if (!this.decoder) return;

    const chunk = new EncodedVideoChunk({
      type: isKeyFrame ? 'key' : 'delta',
      timestamp,
      data,
    });

    this.decoder.decode(chunk);
  }

  /**
   * 设置帧输出回调。
   *
   * @param callback 接收解码后的 VideoFrame
   */
  setFrameCallback(callback: (frame: VideoFrame) => void): void {
    this.frameCallback = callback;
  }

  /**
   * 内部帧输出处理。
   *
   * @param frame 解码后的 VideoFrame
   */
  private handleFrame(frame: VideoFrame): void {
    // 计算帧号
    const fps = 30; // 实际应从 asset 获取
    const frameNumber = Math.floor(frame.timestamp / 1000000 * fps);
    this.cache.set(frameNumber, frame);

    // 通知回调
    this.frameCallback?.(frame);
  }

  /**
   * 获取缓存的帧。
   *
   * @param frameNumber 帧号
   * @returns VideoFrame，或 undefined
   */
  getCachedFrame(frameNumber: number): VideoFrame | null | undefined {
    return this.cache.get(frameNumber);
  }

  /**
   * Seek 到指定时间。
   *
   * 不能从 0 开始解码，需要找最近 I Frame：
   *   Target Frame → Find KeyFrame → Decode Forward → Return Frame
   *
   * @param time 目标时间（微秒）
   */
  seek(time: number): void {
    if (!this.decoder) return;
    this.decoder.reset();
    // 实际实现需要配合 Demuxer 找到最近关键帧，然后解码到目标帧
    // time 参数由 Demuxer.findNearestKeyFrame 使用
    void time;
  }

  /** 释放资源。 */
  destroy(): void {
    this.cache.clear();
    if (this.decoder) {
      this.decoder.close();
      this.decoder = null;
    }
  }
}
