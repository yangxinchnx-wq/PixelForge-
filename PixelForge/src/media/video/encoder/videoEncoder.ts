/**
 * PixelForge Video Encoder — WebCodecs 硬件加速视频编码器。
 *
 * 使用 WebCodecs VideoEncoder API 进行硬件加速编码，配合 mp4-muxer / webm-muxer 封装容器。
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

// ─── 格式定义 ────────────────────────────────────────────────

export type ExportFormatId = 'h264' | 'hevc' | 'av1' | 'vp9';

export interface ExportFormatInfo {
  id: ExportFormatId;
  label: string;
  /** WebCodecs 编码器 codec 字符串 */
  codec: string;
  /** 容器类型 */
  container: 'mp4' | 'webm';
  /** 文件扩展名 */
  ext: string;
  /** muxer 中使用的 codec 标识 */
  muxerCodec: 'avc' | 'hevc' | 'av1' | 'vp9';
}

/** 所有支持的导出格式 */
export const EXPORT_FORMATS: ExportFormatInfo[] = [
  {
    id: 'h264',
    label: 'H.264 (MP4)',
    codec: 'avc1.640028',
    container: 'mp4',
    ext: 'mp4',
    muxerCodec: 'avc',
  },
  {
    id: 'hevc',
    label: 'HEVC / H.265 (MP4)',
    codec: 'hvc1.1.6.L120.B0',
    container: 'mp4',
    ext: 'mp4',
    muxerCodec: 'hevc',
  },
  {
    id: 'av1',
    label: 'AV1 (MP4)',
    codec: 'av01.0.08M.08',
    container: 'mp4',
    ext: 'mp4',
    muxerCodec: 'av1',
  },
  {
    id: 'vp9',
    label: 'VP9 (WebM)',
    codec: 'vp09.00.10.08',
    container: 'webm',
    ext: 'webm',
    muxerCodec: 'vp9',
  },
];

// ─── 质量等级定义 ────────────────────────────────────────────

export type QualityLevel = 'max' | 'high' | 'medium' | 'low';

export interface QualityPreset {
  id: QualityLevel;
  label: string;
  /** 鼠标悬停说明 */
  tooltip: string;
  /** 码率倍率（乘以用户设定的基础码率） */
  bitrateMultiplier: number;
  /** 编码器延迟模式 */
  latencyMode: 'quality' | 'normal' | 'realtime';
  /** 关键帧间隔的秒数（与 fps 相乘得到帧数） */
  keyframeIntervalSeconds: number;
  /** H.264 专用：Profile 名 */
  h264Profile: string;
  /** H.264 专用：Level */
  h264Level: string;
}

/**
 * 质量等级预设。
 *
 * 最高：极限画质，榨干格式极限能力。码率 ×1.5，quality 模式，每秒一个关键帧，High 5.2
 * 高：  高画质，质量优先。码率 ×1.0，quality 模式，每 2 秒一个关键帧，High 4.1
 * 中：  速度与画质平衡。码率 ×0.6，normal 模式，每 3 秒一个关键帧，Main 4.0
 * 低：  极速编码，舍弃画质只追速度。码率 ×0.3，realtime 模式，每 5 秒一个关键帧，Baseline 4.0
 */
export const QUALITY_PRESETS: QualityPreset[] = [
  {
    id: 'max',
    label: '最高',
    tooltip: '极限画质：码率 ×1.5，质量优先模式，每秒一个关键帧，H.264 High Profile Level 5.2。文件最大，编码最慢，画质极致',
    bitrateMultiplier: 1.5,
    latencyMode: 'quality',
    keyframeIntervalSeconds: 1,
    h264Profile: 'High',
    h264Level: '5.2',
  },
  {
    id: 'high',
    label: '高',
    tooltip: '高画质：码率 ×1.0，质量优先模式，每 2 秒一个关键帧，H.264 High Profile Level 4.1。推荐设置',
    bitrateMultiplier: 1.0,
    latencyMode: 'quality',
    keyframeIntervalSeconds: 2,
    h264Profile: 'High',
    h264Level: '4.1',
  },
  {
    id: 'medium',
    label: '中',
    tooltip: '平衡模式：码率 ×0.6，标准延迟模式，每 3 秒一个关键帧，H.264 Main Profile Level 4.0。速度更快，画质可接受',
    bitrateMultiplier: 0.6,
    latencyMode: 'normal',
    keyframeIntervalSeconds: 3,
    h264Profile: 'Main',
    h264Level: '4.0',
  },
  {
    id: 'low',
    label: '低',
    tooltip: '极速模式：码率 ×0.3，实时延迟模式，每 5 秒一个关键帧，H.264 Baseline Profile Level 4.0。编码最快，画质最低',
    bitrateMultiplier: 0.3,
    latencyMode: 'realtime',
    keyframeIntervalSeconds: 5,
    h264Profile: 'Baseline',
    h264Level: '4.0',
  },
];

/** 根据质量等级获取预设 */
export function getQualityPreset(level: QualityLevel): QualityPreset {
  return QUALITY_PRESETS.find((p) => p.id === level) ?? QUALITY_PRESETS[1];
}

// ─── 硬件能力检测 ────────────────────────────────────────────

export interface CodecSupportResult {
  formatId: ExportFormatId;
  supported: boolean;
}

/**
 * 检测当前设备对各编码格式的硬件支持情况。
 *
 * 使用 VideoEncoder.isConfigSupported() 进行运行时检测。
 * 对于不支持 WebCodecs 的环境，所有格式返回 false。
 *
 * @param width  视频宽度
 * @param height 视频高度
 * @param bitrate 目标码率（bps）
 */
export async function detectCodecSupport(
  width: number,
  height: number,
  bitrate: number,
): Promise<Map<ExportFormatId, boolean>> {
  const result = new Map<ExportFormatId, boolean>();

  if (typeof VideoEncoder === 'undefined') {
    for (const fmt of EXPORT_FORMATS) {
      result.set(fmt.id, false);
    }
    return result;
  }

  const checks = EXPORT_FORMATS.map(async (fmt) => {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: fmt.codec,
        width,
        height,
        bitrate,
        framerate: 30,
      });
      result.set(fmt.id, support.supported === true);
    } catch {
      result.set(fmt.id, false);
    }
  });

  await Promise.all(checks);
  return result;
}

// ─── 编码参数 ────────────────────────────────────────────────

export interface EncodeOptions {
  /** 图片 URL 列表（blob URL 或 dataURL） */
  imageUrls: string[];
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
  /** 帧率 */
  fps: number;
  /** 每张图片展示时长（秒） */
  perImageDuration: number;
  /** 基础码率（bps），实际码率会根据质量等级乘以倍率 */
  bitrate: number;
  /** 编码格式 */
  format: ExportFormatId;
  /** 质量等级 */
  quality: QualityLevel;
  /** 进度回调（0~100） */
  onProgress?: (percent: number) => void;
}

// ─── H.264 Profile/Level → codec 字符串 ─────────────────────

/**
 * 根据 profile 和 level 生成 H.264 codec 字符串。
 *
 * @example buildH264CodecString('High', '4.1') → 'avc1.640029'
 */
export function buildH264CodecString(profile: string, level: string): string {
  const profileMap: Record<string, string> = {
    Baseline: '42',
    Main: '4D',
    High: '64',
  };
  const levelMap: Record<string, string> = {
    '4.0': '28',
    '4.1': '29',
    '4.2': '2A',
    '5.0': '32',
    '5.1': '33',
    '5.2': '34',
  };
  const p = profileMap[profile] ?? '64'; // 默认 High
  const l = levelMap[level] ?? '28';     // 默认 4.0
  return `avc1.${p}00${l}`;
}

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

// ─── 下载工具 ────────────────────────────────────────────────

/**
 * 触发浏览器下载 Blob。
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
