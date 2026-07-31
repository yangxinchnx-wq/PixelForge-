/**
 * PixelForge Video Encoder — WebCodecs 硬件加速视频编码器（重型模块）。
 *
 * 使用 WebCodecs VideoEncoder API 进行硬件加速编码，配合 mp4-muxer / webm-muxer 封装容器。
 * 本模块导入了 mp4-muxer / webm-muxer 重型依赖，应通过动态 import 按需加载。
 *
 * 轻量类型与常量已拆分至 videoEncoderTypes.ts，可在顶层静态导入。
 *
 * 链路：
 *   ImageBitmap → VideoFrame → VideoEncoder → EncodedVideoChunk → Muxer → Blob
 *
 * 支持格式：
 *   H.264  → MP4  (avc1.640028)
 *   HEVC   → MP4  (hvc1.1.6.L120.B0)
 *   AV1    → MP4  (av01.0.08M.08)
 *   VP9    → WebM (vp09.00.10.08)
 */

import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4ArrayBufferTarget } from 'mp4-muxer';
import { Muxer as WebMMuxer, ArrayBufferTarget as WebMArrayBufferTarget } from 'webm-muxer';
import {
  EXPORT_FORMATS,
  getQualityPreset,
  buildH264CodecString,
  type ExportFormatId,
  type ExportFormatInfo,
  type QualityLevel,
  type EncodeOptions,
} from './videoEncoderTypes';

// 重导出轻量成员，保持向后兼容
export type { ExportFormatId, ExportFormatInfo, QualityLevel, EncodeOptions } from './videoEncoderTypes';
export { EXPORT_FORMATS, QUALITY_PRESETS, getQualityPreset, detectCodecSupport, buildH264CodecString, downloadBlob } from './videoEncoderTypes';
export type { QualityPreset, CodecSupportResult } from './videoEncoderTypes';

// ─── 核心编码器 ──────────────────────────────────────────────

/**
 * 将图片序列编码为视频文件。
 *
 * 流程：
 *   1. 加载所有图片为 ImageBitmap
 *   2. 创建 VideoEncoder + Muxer
 *   3. 按帧率生成 VideoFrame 并编码
 *   4. flush 编码器 → finalize muxer → 返回 Blob
 *
 * @returns 编码后的视频 Blob
 */
export async function encodeImagesToVideo(options: EncodeOptions): Promise<Blob> {
  const {
    imageUrls,
    width,
    height,
    fps,
    perImageDuration,
    bitrate: baseBitrate,
    format,
    quality,
    onProgress,
  } = options;

  if (imageUrls.length === 0) {
    throw new Error('没有可导出的图片，请先在画布中导入或生成图片');
  }

  if (typeof VideoEncoder === 'undefined') {
    throw new Error('当前环境不支持 WebCodecs API，无法进行视频编码');
  }

  const formatInfo = EXPORT_FORMATS.find((f) => f.id === format);
  if (!formatInfo) {
    throw new Error(`不支持的导出格式: ${format}`);
  }

  const qualityPreset = getQualityPreset(quality);

  // ── 计算实际编码参数 ──
  const actualBitrate = Math.round(baseBitrate * qualityPreset.bitrateMultiplier);
  const keyframeInterval = Math.max(1, Math.round(fps * qualityPreset.keyframeIntervalSeconds));

  // 构建 codec 字符串（H.264 根据质量等级的 Profile/Level 组装）
  const codec = format === 'h264'
    ? buildH264CodecString(qualityPreset.h264Profile, qualityPreset.h264Level)
    : formatInfo.codec;

  // ── 1. 加载图片为 ImageBitmap ──
  onProgress?.(2);
  const bitmaps = await loadImagesAsBitmaps(imageUrls, width, height);
  onProgress?.(10);

  // ── 2. 计算总帧数 ──
  const framesPerImage = Math.max(1, Math.round(perImageDuration * fps));
  const totalFrames = bitmaps.length * framesPerImage;
  const frameDurationUs = Math.round(1_000_000 / fps); // 微秒

  // ── 3. 创建 Muxer ──
  let muxer: Mp4Muxer<Mp4ArrayBufferTarget> | WebMMuxer<WebMArrayBufferTarget>;
  let target: Mp4ArrayBufferTarget | WebMArrayBufferTarget;

  if (formatInfo.container === 'mp4') {
    target = new Mp4ArrayBufferTarget();
    muxer = new Mp4Muxer({
      target: target as Mp4ArrayBufferTarget,
      video: {
        codec: formatInfo.muxerCodec as 'avc' | 'hevc' | 'av1',
        width,
        height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });
  } else {
    target = new WebMArrayBufferTarget();
    muxer = new WebMMuxer({
      target: target as WebMArrayBufferTarget,
      video: {
        codec: 'V_VP9',
        width,
        height,
        frameRate: fps,
      },
    });
  }

  // ── 4. 创建 VideoEncoder ──
  let encodedChunks = 0;
  let lastReportedProgress = 10;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (formatInfo.container === 'mp4') {
        (muxer as Mp4Muxer<Mp4ArrayBufferTarget>).addVideoChunk(chunk, meta);
      } else {
        (muxer as WebMMuxer<WebMArrayBufferTarget>).addVideoChunk(chunk, meta);
      }
      encodedChunks++;
      const progress = 10 + Math.round((encodedChunks / totalFrames) * 80);
      if (progress > lastReportedProgress) {
        lastReportedProgress = progress;
        onProgress?.(progress);
      }
    },
    error: (err) => {
      console.error('[VideoEncoder] 编码错误:', err);
      throw err;
    },
  });

  // 配置编码器
  encoder.configure({
    codec,
    width,
    height,
    bitrate: actualBitrate,
    framerate: fps,
    keyInterval: keyframeInterval,
    latencyMode: qualityPreset.latencyMode,
  });

  // ── 5. 逐帧编码 ──
  for (let imgIdx = 0; imgIdx < bitmaps.length; imgIdx++) {
    const bitmap = bitmaps[imgIdx];
    for (let frameInImage = 0; frameInImage < framesPerImage; frameInImage++) {
      const globalFrame = imgIdx * framesPerImage + frameInImage;
      const timestamp = globalFrame * frameDurationUs;

      const frame = new VideoFrame(bitmap, {
        timestamp,
        duration: frameDurationUs,
      });

      // 关键帧：每张图片的第一帧
      const keyFrame = frameInImage === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();

      // 防止编码器队列堆积过多（控制内存）
      if (encoder.encodeQueueSize > 10) {
        await new Promise((r) => setTimeout(r, 1));
      }
    }
  }

  // ── 6. flush + finalize ──
  onProgress?.(92);
  await encoder.flush();
  encoder.close();

  onProgress?.(96);
  muxer.finalize();

  // ── 7. 释放 ImageBitmap 资源 ──
  for (const bmp of bitmaps) {
    bmp.close();
  }

  onProgress?.(100);

  // ── 8. 创建 Blob ──
  const mimeType = formatInfo.container === 'mp4' ? 'video/mp4' : 'video/webm';
  const buffer = target.buffer;
  return new Blob([buffer], { type: mimeType });
}

// ─── 图片加载工具 ────────────────────────────────────────────

/**
 * 加载图片 URL 列表为 ImageBitmap，并缩放到目标尺寸。
 *
 * @param urls 图片 URL 数组
 * @param targetWidth 目标宽度
 * @param targetHeight 目标高度
 */
async function loadImagesAsBitmaps(
  urls: string[],
  targetWidth: number,
  targetHeight: number,
): Promise<ImageBitmap[]> {
  const bitmaps: ImageBitmap[] = [];

  for (const url of urls) {
    const img = new Image();
    img.src = url;

    await img.decode();

    const bitmap = await createImageBitmap(img, {
      resizeWidth: targetWidth,
      resizeHeight: targetHeight,
      resizeQuality: 'high',
    });
    bitmaps.push(bitmap);
  }

  return bitmaps;
}
