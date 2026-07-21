/**
 * PixelForge Media Video — VideoMetadata（视频元数据）。
 *
 * 扩展 MediaAsset 为 VideoAsset，包含视频特有的元数据。
 *
 * 流程：
 *   File → arrayBuffer → Demux → 提取元数据 → VideoAsset
 *
 * 例如：
 *   导入 camera.mp4 → 解析 → { width:3840, height:2160, fps:60, codec:"H264", duration:120, frameCount:7200 }
 */

/** 视频素材。 */
export interface VideoAsset {
  /** 稳定 ID */
  id: string;
  /** 素材类型 */
  type: 'video';
  /** 文件 URL */
  url: string;
  /** 视频宽度（像素） */
  width: number;
  /** 视频高度（像素） */
  height: number;
  /** 帧率（如 30 / 29.97 / 60） */
  fps: number;
  /** 总时长（秒） */
  duration: number;
  /** 编码格式（如 "avc1.640028" / "vp09" / "av01"） */
  codec: string;
  /** 总帧数 */
  frameCount: number;
}

/**
 * 从 File 对象探测视频元数据。
 *
 * 读取文件 → 进入 Demux → 提取元数据。
 *
 * 注意：此函数是异步的，实际实现需要 Demuxer 配合。
 * 当前版本通过创建临时 <video> 元素快速探测基本元数据。
 *
 * @param file 视频文件
 * @returns VideoAsset 元数据
 */
export async function probeVideoMetadata(
  file: File,
): Promise<VideoAsset> {
  const url = URL.createObjectURL(file);

  return new Promise<VideoAsset>((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    video.onloadedmetadata = () => {
      const fps = estimateFps(video);
      const duration = video.duration;
      const frameCount = Math.round(duration * fps);

      const asset: VideoAsset = {
        id: `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'video',
        url,
        width: video.videoWidth,
        height: video.videoHeight,
        fps,
        duration,
        codec: 'avc1', // 实际 codec 需要从 Demuxer 获取
        frameCount,
      };
      resolve(asset);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`无法读取视频元数据: ${file.name}`));
    };

    video.src = url;
  });
}

/**
 * 估算帧率。
 *
 * requestVideoFrameCallback 在支持的浏览器中可以精确测量帧率。
 * 不支持时回退到 30fps。
 */
function estimateFps(_video: HTMLVideoElement): number {
  // 常见帧率优先级：60 > 30 > 29.97
  // 简化实现：默认 30fps，实际项目应通过 Demuxer 读取精确 fps
  return 30;
}
