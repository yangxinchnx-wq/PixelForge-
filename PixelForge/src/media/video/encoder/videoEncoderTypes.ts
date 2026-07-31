/**
 * PixelForge Video Encoder — 类型与常量定义（轻量模块）。
 *
 * 本文件不导入 mp4-muxer / webm-muxer 等重型依赖，
 * 可被任意模块安全地在顶层静态导入。
 *
 * 重型编码函数（encodeImagesToVideo）仍在 videoEncoder.ts 中，
 * 使用动态 import 按需加载。
 */

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
