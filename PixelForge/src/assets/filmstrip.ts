/**
 * 视频胶片帧（缩略图条）提取。
 *
 * 数据流:
 *   video URL(blob URL) → <video> seek 到 N 个等分时间点
 *     → canvas.drawImage 截帧 → dataURL 列表
 *     → 按 `${assetId}:${frameCount}` 缓存,同一 key 并发共享同一次提取
 *
 * 用途:
 *   时间轴视频片段的缩略图条(替代灰色占位块)。
 *   刷新页面后 blob URL 失效,由 assetStore.init() 从 OPFS 恢复出新的
 *   blob URL 后重新提取(缓存 key 不变,直接命中)。
 *
 * 单帧截取模式与 assetLoader.generateVideoThumbnail 一致:
 *   不挂载到 DOM,seek + drawImage + toDataURL。
 */

/** 单次 seek 超时(毫秒),越界/损坏片段不拖死提取流程 */
const SEEK_TIMEOUT_MS = 5000;

/** 元数据加载超时(毫秒) */
const METADATA_TIMEOUT_MS = 10000;

/** 单帧最大宽度(px),时间轴缩略图很小,160px 足够 */
const FRAME_MAX_WIDTH = 160;

/** 最大提取帧数,高缩放级别下限制成本 */
const MAX_FRAMES = 24;

/** 已提取的胶片帧: key = `${assetId}:${frameCount}` → dataURL 列表 */
const filmstripCache = new Map<string, string[]>();

/** 进行中的提取: key → Promise(并发去重,同一 key 只提取一次) */
const inFlight = new Map<string, Promise<string[]>>();

/**
 * 获取视频胶片帧(带缓存)。
 *
 * @param assetId 资产 ID(缓存 key)
 * @param videoUrl 视频 URL(blob URL)
 * @param frameCount 请求帧数,内部 clamp 到 [1, MAX_FRAMES]
 * @returns dataURL 列表;提取失败返回空数组(调用方回退占位块)
 */
export function getFilmstrip(assetId: string, videoUrl: string, frameCount: number): Promise<string[]> {
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(frameCount) || 1));
  const key = `${assetId}:${count}`;

  const cached = filmstripCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = extractFilmstrip(videoUrl, count)
    .then((frames) => {
      // 失败也缓存空结果,避免重复触发昂贵的失败提取
      filmstripCache.set(key, frames);
      return frames;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/** 清除胶片帧缓存(资产移除时调用;无参清空全部) */
export function clearFilmstripCache(assetId?: string): void {
  if (!assetId) {
    filmstripCache.clear();
    return;
  }
  const prefix = `${assetId}:`;
  for (const key of [...filmstripCache.keys()]) {
    if (key.startsWith(prefix)) filmstripCache.delete(key);
  }
}

/** seek 到指定时间并截帧,失败/超时返回 null */
function seekAndCapture(video: HTMLVideoElement, time: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: string | null) => {
      if (settled) return;
      settled = true;
      video.onseeked = null;
      video.onerror = null;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), SEEK_TIMEOUT_MS);

    video.onerror = () => finish(null);
    video.onseeked = () => {
      try {
        const sourceW = video.videoWidth || FRAME_MAX_WIDTH;
        const sourceH = video.videoHeight || FRAME_MAX_WIDTH;
        const scale = Math.min(1, FRAME_MAX_WIDTH / sourceW);
        const w = Math.max(1, Math.round(sourceW * scale));
        const h = Math.max(1, Math.round(sourceH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        finish(null);
      }
    };

    // clamp 到有效范围,避免 seek 越界导致浏览器行为不确定
    const duration = video.duration;
    const t = isFinite(duration) && duration > 0
      ? Math.min(Math.max(0, time), Math.max(0, duration - 0.05))
      : Math.max(0, time);
    video.currentTime = t;
  });
}

/** 串行提取 N 帧(同一 video 元素串行 seek,避免互相打断) */
async function extractFilmstrip(videoUrl: string, frameCount: number): Promise<string[]> {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('视频元数据加载超时')), METADATA_TIMEOUT_MS);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error('视频加载失败'));
      };
      video.src = videoUrl;
    });

    const duration = video.duration;
    if (!isFinite(duration) || duration <= 0) return [];

    const frames: string[] = [];
    for (let i = 0; i < frameCount; i++) {
      // 等间隔取每段中点,避开首尾黑帧
      const t = ((i + 0.5) / frameCount) * duration;
      const frame = await seekAndCapture(video, t);
      if (frame) frames.push(frame);
    }
    return frames;
  } finally {
    video.src = '';
    video.onloadedmetadata = null;
    video.onerror = null;
    video.onseeked = null;
  }
}
