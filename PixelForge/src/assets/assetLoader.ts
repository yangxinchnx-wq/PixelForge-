import type { Asset, LoadImageOptions } from './types'

/**
 * 资源加载器。
 *
 * 职责:
 * - 图片:把 File 转成 Asset(blob URL + 尺寸 + 缩略图)
 * - 视频:把 File 转成 Asset(blob URL + 尺寸 + 时长 + 帧率)
 * - 处理解码失败 / 格式不支持等错误
 */

const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']
const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']

/**
 * 加载单个图片文件为 Asset。
 *
 * @param file 用户选择的图片文件
 * @param options 加载选项(是否生成缩略图等)
 * @throws 文件类型不支持 / 解码失败
 */
export async function loadImage(file: File, options: LoadImageOptions = {}): Promise<Asset> {
  const { generateThumbnail = true, thumbnailMaxWidth = 160 } = options

  if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`不支持的图片类型: ${file.type}(支持 PNG/JPEG/WebP/GIF/BMP)`)
  }

  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url

  try {
    await img.decode()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw new Error(`图片解码失败: ${(e as Error).message}`)
  }

  const thumbnail = generateThumbnail
    ? await generateThumbnailDataUrl(img, thumbnailMaxWidth)
    : undefined

  return {
    id: genId(),
    name: file.name,
    type: 'image',
    url,
    width: img.naturalWidth,
    height: img.naturalHeight,
    size: file.size,
    createdAt: Date.now(),
    thumbnail,
    mimeType: file.type,
  }
}

/**
 * 批量加载多个图片文件。
 * 单个文件失败不会中断整体,失败的文件会收集到 errors 数组返回。
 */
export async function loadImages(
  files: File[],
  options: LoadImageOptions = {},
): Promise<{ assets: Asset[]; errors: Array<{ file: string; error: string }> }> {
  const assets: Asset[] = []
  const errors: Array<{ file: string; error: string }> = []

  for (const file of files) {
    try {
      const asset = await loadImage(file, options)
      assets.push(asset)
    } catch (e) {
      errors.push({ file: file.name, error: (e as Error).message })
    }
  }

  return { assets, errors }
}

/**
 * 生成缩略图 dataURL(用于持久化展示,不依赖 blob URL)。
 *
 * @param img 已解码的 HTMLImageElement
 * @param maxWidth 缩略图最大宽度(等比缩放)
 */
async function generateThumbnailDataUrl(
  img: HTMLImageElement,
  maxWidth: number,
): Promise<string | undefined> {
  try {
    const naturalWidth = img.naturalWidth
    const naturalHeight = img.naturalHeight
    if (naturalWidth <= 0 || naturalHeight <= 0) return undefined

    const scale = Math.min(1, maxWidth / naturalWidth)
    const thumbWidth = Math.max(1, Math.round(naturalWidth * scale))
    const thumbHeight = Math.max(1, Math.round(naturalHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = thumbWidth
    canvas.height = thumbHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    // 缩略图生成失败不阻断主流程
    return undefined
  }
}

/** 生成资源 ID(UUIDv4,浏览器 crypto 不可用时回退) */
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ============================================================================
// 视频加载
// ============================================================================

/**
 * 加载单个视频文件为 Asset。
 *
 * 数据流:
 *   URL.createObjectURL(file) → blob URL
 *   <video>.onloadedmetadata → 获取尺寸 / 时长
 *   生成缩略图(截取第一帧)
 *   返回 Asset(type='video')
 *
 * @param file 用户选择的视频文件
 * @throws 文件类型不支持 / 元数据读取失败
 */
export async function loadVideo(file: File): Promise<Asset> {
  if (!SUPPORTED_VIDEO_TYPES.includes(file.type)) {
    throw new Error(`不支持的视频类型: ${file.type}(支持 MP4/WebM/OGG/QuickTime)`)
  }

  const url = URL.createObjectURL(file)

  const meta = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      })
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`视频元数据读取失败: ${file.name}`))
    }

    // 超时保护(10秒)
    setTimeout(() => {
      reject(new Error(`视频加载超时: ${file.name}`))
    }, 10000)

    video.src = url
  })

  // 生成视频缩略图(截取第一帧)
  const thumbnail = await generateVideoThumbnail(url).catch(() => undefined)

  return {
    id: genId(),
    name: file.name,
    type: 'video',
    url,
    width: meta.width,
    height: meta.height,
    size: file.size,
    createdAt: Date.now(),
    thumbnail,
    mimeType: file.type,
    duration: meta.duration,
    fps: 30, // 默认 30fps,精确值需 Demuxer
    codec: 'avc1',
    frameCount: Math.round(meta.duration * 30),
  }
}

/**
 * 生成视频缩略图(截取第一帧)。
 *
 * @param videoUrl 视频 blob URL
 * @returns 缩略图 dataURL
 */
async function generateVideoThumbnail(videoUrl: string): Promise<string | undefined> {
  try {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.crossOrigin = 'anonymous'

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('缩略图元数据加载失败'))
      video.src = videoUrl
    })

    // seek 到 0.1 秒(避免黑屏)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
    })

    const maxWidth = 160
    const scale = Math.min(1, maxWidth / video.videoWidth)
    const thumbWidth = Math.max(1, Math.round(video.videoWidth * scale))
    const thumbHeight = Math.max(1, Math.round(video.videoHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = thumbWidth
    canvas.height = thumbHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight)
    return canvas.toDataURL('image/jpeg', 0.7)
  } catch {
    return undefined
  }
}
