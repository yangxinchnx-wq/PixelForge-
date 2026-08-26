/**
 * Asset 持久化模块 — 基于 OPFS 的大容量图片/视频存储。
 *
 * 解决问题：
 *   - 之前 assetStore 仅内存态，刷新即丢
 *   - localStorage 容量限制 5-10MB，无法存几百 GB 图片/视频
 *   - OPFS 容量可达磁盘上限，适合大文件持久化
 *
 * 存储结构：
 *   OPFS/assets/
 *     ├── index.json          ← 资产元数据索引（所有 Asset 的可序列化字段）
 *     ├── asset_<id>.png      ← 图片原始二进制
 *     ├── asset_<id>.mp4      ← 视频原始二进制
 *     └── asset_<id>.dat      ← dataURL 转码后的二进制（AI 生成的图片）
 *
 * 生命周期：
 *   导入图片/视频 → persistAsset() → 写二进制 + 更新索引
 *   应用启动     → loadAssetIndex() → 读索引 → 重建 blob URL
 *   删除资产     → deleteAssetFile() → 删二进制 + 更新索引
 */

import { opfsStore, OPFS_NAMESPACES } from '@/storage/opfsStore'
import type { Asset, AssetIndexEntry } from './types'

// ============================================================================
// 常量
// ============================================================================

const ASSETS_NS = OPFS_NAMESPACES.ASSETS
const INDEX_FILENAME = 'index.json'

/** MIME → 文件扩展名映射 */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogg',
  'video/quicktime': 'mov',
}

// ============================================================================
// 工具函数
// ============================================================================

/** 从 MIME 类型推断文件扩展名 */
function mimeToExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'dat'
}

/** 生成 OPFS 文件名 */
export function generateOpfsPath(id: string, mimeType: string): string {
  const ext = mimeToExt(mimeType)
  return `asset_${id}.${ext}`
}

/**
 * 将 dataURL 转为 Uint8Array。
 * dataURL 格式: data:<mime>;base64,<data>
 */
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }
  return bytes
}

/**
 * 将 Blob 转为 Uint8Array。
 */
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

// ============================================================================
// 持久化：写入
// ============================================================================

/**
 * 将 Asset 的二进制数据持久化到 OPFS。
 *
 * 支持三种输入源：
 *   1. Blob URL (blob:...) → fetch → Blob → bytes
 *   2. dataURL (data:...)  → atob → bytes
 *   3. http(s) URL          → fetch → Blob → bytes
 *
 * 写入完成后返回 opfsPath，调用方应将其设置到 asset.opfsPath。
 *
 * @param asset 要持久化的资产（必须含 url 和 mimeType）
 * @returns opfsPath（OPFS 中的文件名），失败返回 null
 */
export async function persistAssetBinary(asset: Asset): Promise<string | null> {
  const opfsPath = generateOpfsPath(asset.id, asset.mimeType)

  try {
    let bytes: Uint8Array

    if (asset.url.startsWith('data:')) {
      // dataURL → bytes
      bytes = dataUrlToBytes(asset.url)
    } else if (asset.url.startsWith('blob:')) {
      // blob URL → fetch → Blob → bytes
      const response = await fetch(asset.url)
      const blob = await response.blob()
      bytes = await blobToBytes(blob)
    } else if (asset.url.startsWith('http://') || asset.url.startsWith('https://')) {
      // http URL → fetch → Blob → bytes
      const response = await fetch(asset.url)
      const blob = await response.blob()
      bytes = await blobToBytes(blob)
    } else {
      console.warn('[AssetPersistence] 无法识别的 URL 格式:', asset.url.slice(0, 50))
      return null
    }

    await opfsStore.write(ASSETS_NS, opfsPath, bytes)
    console.log(`[AssetPersistence] 已写入 OPFS: ${opfsPath} (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB)`)
    return opfsPath
  } catch (e) {
    console.error('[AssetPersistence] 写入 OPFS 失败:', asset.id, e)
    return null
  }
}

// ============================================================================
// 持久化：读取 / 恢复
// ============================================================================

/**
 * 从 OPFS 读取资产二进制，生成新的 blob URL。
 *
 * 应用启动时调用，恢复刷新前的资产。
 *
 * @param opfsPath OPFS 中的文件名
 * @param mimeType 资产的 MIME 类型（用于 blob 构造）
 * @returns 新的 blob URL，失败返回 null
 */
export async function loadAssetBlobUrl(opfsPath: string, mimeType: string): Promise<string | null> {
  try {
    const bytes = await opfsStore.read(ASSETS_NS, opfsPath)
    if (!bytes) {
      console.warn(`[AssetPersistence] OPFS 文件不存在: ${opfsPath}`)
      return null
    }
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    return url
  } catch (e) {
    console.error('[AssetPersistence] 从 OPFS 读取失败:', opfsPath, e)
    return null
  }
}

// ============================================================================
// 索引管理
// ============================================================================

/**
 * 将 Asset 转为可序列化的索引条目。
 * 去掉 blob URL（刷新后失效），保留 opfsPath。
 */
export function assetToIndexEntry(asset: Asset): AssetIndexEntry {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    createdAt: asset.createdAt,
    thumbnail: asset.thumbnail,
    mimeType: asset.mimeType,
    opfsPath: asset.opfsPath ?? generateOpfsPath(asset.id, asset.mimeType),
    duration: asset.duration,
    fps: asset.fps,
    codec: asset.codec,
    frameCount: asset.frameCount,
  }
}

/**
 * 将索引条目转回 Asset（url 为空，需调用 loadAssetBlobUrl 填充）。
 */
export function indexEntryToAsset(entry: AssetIndexEntry): Asset {
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    url: '', // 需要异步恢复
    width: entry.width,
    height: entry.height,
    size: entry.size,
    createdAt: entry.createdAt,
    thumbnail: entry.thumbnail,
    mimeType: entry.mimeType,
    opfsPath: entry.opfsPath,
    duration: entry.duration,
    fps: entry.fps,
    codec: entry.codec,
    frameCount: entry.frameCount,
  }
}

/**
 * 读取 OPFS 中的资产索引文件。
 *
 * @returns 索引条目数组，不存在时返回空数组
 */
export async function loadAssetIndex(): Promise<AssetIndexEntry[]> {
  try {
    const text = await opfsStore.readText(ASSETS_NS, INDEX_FILENAME)
    if (!text) return []
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      console.warn('[AssetPersistence] 索引格式异常，非数组')
      return []
    }
    return parsed as AssetIndexEntry[]
  } catch (e) {
    console.error('[AssetPersistence] 读取索引失败:', e)
    return []
  }
}

/**
 * 将资产索引写入 OPFS。
 *
 * @param entries 索引条目数组
 */
export async function saveAssetIndex(entries: AssetIndexEntry[]): Promise<void> {
  try {
    const text = JSON.stringify(entries)
    await opfsStore.writeText(ASSETS_NS, INDEX_FILENAME, text)
  } catch (e) {
    console.error('[AssetPersistence] 写入索引失败:', e)
  }
}

/**
 * 向索引中添加/更新单个条目（增量更新）。
 */
export async function upsertAssetIndex(entry: AssetIndexEntry): Promise<void> {
  const index = await loadAssetIndex()
  const existing = index.findIndex((e) => e.id === entry.id)
  if (existing >= 0) {
    index[existing] = entry
  } else {
    index.push(entry)
  }
  await saveAssetIndex(index)
}

// ============================================================================
// 持久化：删除
// ============================================================================

/**
 * 从 OPFS 删除资产的二进制文件。
 *
 * @param opfsPath OPFS 中的文件名
 */
export async function deleteAssetFile(opfsPath: string): Promise<void> {
  try {
    await opfsStore.delete(ASSETS_NS, opfsPath)
  } catch (e) {
    console.error('[AssetPersistence] 删除 OPFS 文件失败:', opfsPath, e)
  }
}

/**
 * 从索引中移除条目。
 */
export async function removeAssetFromIndex(id: string): Promise<void> {
  const index = await loadAssetIndex()
  const filtered = index.filter((e) => e.id !== id)
  if (filtered.length !== index.length) {
    await saveAssetIndex(filtered)
  }
}

// ============================================================================
// 完整恢复流程
// ============================================================================

/**
 * 从 OPFS 恢复全部资产。
 *
 * 流程：
 *   1. 读取 index.json
 *   2. 对每个条目，从 OPFS 读取二进制 → 生成 blob URL
 *   3. 返回完整的 Asset[]（可直接 addMany 到 store）
 *
 * @returns 恢复的 Asset 数组（url 已填充 blob URL）
 */
export async function restoreAllAssets(): Promise<Asset[]> {
  const entries = await loadAssetIndex()
  if (entries.length === 0) {
    return []
  }

  console.log(`[AssetPersistence] 从 OPFS 恢复 ${entries.length} 个资产`)

  const assets: Asset[] = []
  for (const entry of entries) {
    const blobUrl = await loadAssetBlobUrl(entry.opfsPath, entry.mimeType)
    if (blobUrl) {
      const asset = indexEntryToAsset(entry)
      asset.url = blobUrl
      assets.push(asset)
    } else {
      console.warn(`[AssetPersistence] 资产 ${entry.id} (${entry.name}) 二进制恢复失败，跳过`)
    }
  }

  console.log(`[AssetPersistence] 成功恢复 ${assets.length}/${entries.length} 个资产`)
  return assets
}
