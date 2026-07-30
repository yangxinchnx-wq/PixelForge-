/**
 * 统一存储调度层
 *
 * 三层架构：
 *   L1 内存 LRU  →  纳秒级读写，容量受 RAM 限制
 *   L2 OPFS     →  微秒级读写，GB 级容量，大块二进制
 *   L3 Redb     →  毫秒级读写，持久化元数据索引
 *
 * 读路径：L1 → L2 → L3（逐层回源）
 * 写路径：L1 即时写入 → L2 后台异步 → L3 元数据索引
 *
 * 命名空间约定：
 *   frames    : 渲染帧像素数据（RGBA Uint8Array）
 *   shaders   : WGSL 着色器源码（string）
 *   prompts   : 自然语言 prompt（string）
 *   ir        : RenderIR 快照（JSON string）
 *   metadata  : 项目元数据（JSON string）
 *   assets    : 资产元数据（JSON string）
 */

import {
  frameMemoryCache,
  textMemoryCache,
  MemoryCache,
  estimateSize,
} from './memoryCache'
import { opfsStore, OPFS_NAMESPACES, isOpfsAvailable } from './opfsStore'
import * as tauriDb from './tauriDb'

/** 数据类别，决定走哪条存储路径 */
export type StorageCategory =
  | 'frame' // 图片视频帧（大块二进制，走 L1+L2）
  | 'shader' // WGSL 代码（文本，走 L1+L2+L3）
  | 'prompt' // 自然语言（文本，走 L1+L2+L3）
  | 'ir' // RenderIR 快照（JSON，走 L1+L2+L3）
  | 'metadata' // 元数据（JSON，走 L1+L3）
  | 'asset' // 资产元数据（JSON，走 L1+L3）

/** L1 缓存键生成器 */
function l1Key(category: StorageCategory, id: string): string {
  return `${category}:${id}`
}

/** 根据类别选择 L1 缓存实例 */
function pickL1(category: StorageCategory): MemoryCache {
  switch (category) {
    case 'frame':
      return frameMemoryCache
    default:
      return textMemoryCache
  }
}

/** 根据类别选择 OPFS 命名空间 */
function pickNamespace(category: StorageCategory): string {
  switch (category) {
    case 'frame':
      return OPFS_NAMESPACES.FRAMES
    case 'shader':
      return OPFS_NAMESPACES.SHADERS
    case 'prompt':
      return OPFS_NAMESPACES.PROMPTS
    case 'ir':
      return OPFS_NAMESPACES.IR
    case 'metadata':
      return OPFS_NAMESPACES.IR // 复用 ir 命名空间，加 meta_ 前缀
    case 'asset':
      return OPFS_NAMESPACES.IR
    default:
      return OPFS_NAMESPACES.IR
  }
}

/** 根据类别生成 OPFS 文件名 */
function opfsFilename(category: StorageCategory, id: string): string {
  switch (category) {
    case 'frame':
      return `frame_${id}.rgba`
    case 'shader':
      return `shader_${id}.wgsl`
    case 'prompt':
      return `${id}.txt`
    case 'ir':
      return `${id}.json`
    case 'metadata':
      return `meta_${id}.txt`
    case 'asset':
      return `asset_${id}.json`
    default:
      return `${id}.bin`
  }
}

export interface UnifiedStoreStats {
  frameMemory: ReturnType<MemoryCache['stats']>
  textMemory: ReturnType<MemoryCache['stats']>
  opfsAvailable: boolean | null
}

/**
 * 统一存储 API
 *
 * 读路径：L1 → L2 → L3
 * 写路径：L1 同步写 → L2 异步写 → L3 异步索引
 */
export class UnifiedStore {
  // ===== 通用读 =====

  /**
   * 读取二进制数据（frame 类别专用）
   * 只走 L1 → L2，不进 L3
   */
  async readBinary(category: 'frame', id: string): Promise<Uint8Array | null> {
    const l1 = pickL1(category)
    const key = l1Key(category, id)
    // L1
    const cached = l1.get<Uint8Array>(key)
    if (cached) return cached
    // L2
    const ns = pickNamespace(category)
    const filename = opfsFilename(category, id)
    const bytes = await opfsStore.read(ns, filename)
    if (bytes) {
      // 回填 L1
      l1.set(key, bytes)
    }
    return bytes
  }

  /**
   * 读取文本数据
   * 走 L1 → L2 → L3（仅 shader/prompt/ir/metadata/asset 会查 L3）
   */
  async readText(category: Exclude<StorageCategory, 'frame'>, id: string): Promise<string | null> {
    const l1 = pickL1(category)
    const key = l1Key(category, id)
    // L1
    const cached = l1.get<string>(key)
    if (cached) return cached

    // L2（所有类别都查 L2）
    const ns = pickNamespace(category)
    const filename = opfsFilename(category, id)
    let text = await opfsStore.readText(ns, filename)

    // L3（仅持久化类别）
    if (text === null) {
      text = await this.readFromL3(category, id)
      if (text) {
        // L3 命中后回填 L2
        await opfsStore.writeText(ns, filename, text)
      }
    }

    if (text) {
      l1.set(key, text)
    }
    return text
  }

  /** 从 L3 读取 */
  private async readFromL3(category: StorageCategory, id: string): Promise<string | null> {
    switch (category) {
      case 'shader':
        return await tauriDb.getShader(id)
      case 'metadata':
        return await tauriDb.getMetadata(id)
      case 'ir': {
        const json = await tauriDb.getIR(parseInt(id, 10))
        return json
      }
      case 'prompt':
        // prompt 在 L3 按 timestamp 索引，需要全表扫描
        return null // 简化：prompt 优先走 L2，L3 只用作历史查询
      case 'asset':
        return null // asset 在 L3 是 JSON 元数据，不存原始文本
      default:
        return null
    }
  }

  // ===== 通用写 =====

  /**
   * 写入二进制数据
   * L1 同步写 + L2 异步写（不进 L3）
   */
  async writeBinary(category: 'frame', id: string, data: Uint8Array): Promise<void> {
    const l1 = pickL1(category)
    const key = l1Key(category, id)
    // L1 同步写
    l1.set(key, data)
    // L2 异步写（不 await，避免阻塞主线程）
    const ns = pickNamespace(category)
    const filename = opfsFilename(category, id)
    void opfsStore.write(ns, filename, data)
  }

  /**
   * 写入文本数据
   * L1 同步写 + L2 异步写 + L3 异步索引
   */
  async writeText(category: Exclude<StorageCategory, 'frame'>, id: string, text: string): Promise<void> {
    const l1 = pickL1(category)
    const key = l1Key(category, id)
    // L1 同步写
    l1.set(key, text)
    // L2 异步写
    const ns = pickNamespace(category)
    const filename = opfsFilename(category, id)
    void opfsStore.writeText(ns, filename, text)
    // L3 异步索引
    void this.writeToL3(category, id, text)
  }

  /** 写入 L3 */
  private async writeToL3(category: StorageCategory, id: string, text: string): Promise<void> {
    try {
      switch (category) {
        case 'shader':
          await tauriDb.saveShader(id, text)
          break
        case 'metadata':
          await tauriDb.setMetadata(id, text)
          break
        case 'ir':
          await tauriDb.saveIR(parseInt(id, 10), text)
          break
        case 'prompt':
          await tauriDb.addPrompt(parseInt(id, 10), text)
          break
        case 'asset':
          await tauriDb.saveAsset(id, text)
          break
        default:
          break
      }
    } catch (e) {
      console.warn(`[UnifiedStore] L3 写入失败 (${category}:${id})`, e)
    }
  }

  // ===== 专用 API =====

  /** 写入渲染帧像素数据（GPU 回读后调用） */
  async writeFrame(frameId: number, pixels: Uint8Array): Promise<void> {
    await this.writeBinary('frame', frameId.toString(), pixels)
  }

  /** 读取渲染帧像素数据（回放时调用） */
  async readFrame(frameId: number): Promise<Uint8Array | null> {
    return await this.readBinary('frame', frameId.toString())
  }

  /** 写入 AI 生成的 WGSL 代码（hash 作为 id，避免重复） */
  async writeShader(hash: string, code: string): Promise<void> {
    await this.writeText('shader', hash, code)
  }

  /** 读取 WGSL 代码 */
  async readShader(hash: string): Promise<string | null> {
    return await this.readText('shader', hash)
  }

  /** 写入用户 prompt（timestamp 作为 id） */
  async writePrompt(timestampMs: number, text: string): Promise<void> {
    await this.writeText('prompt', timestampMs.toString(), text)
  }

  /** 读取单条 prompt */
  async readPrompt(timestampMs: number): Promise<string | null> {
    return await this.readText('prompt', timestampMs.toString())
  }

  /** 列出全部 prompt 历史 */
  async listPrompts(): Promise<Array<{ timestampMs: number; text: string }>> {
    return await tauriDb.listPrompts()
  }

  /** 按时间范围查询 prompt */
  async queryPrompts(startMs: number, endMs: number): Promise<Array<{ timestampMs: number; text: string }>> {
    return await tauriDb.queryPrompts(startMs, endMs)
  }

  /** 写入 RenderIR 快照 */
  async writeIR(frameId: number, irJson: string): Promise<void> {
    await this.writeText('ir', frameId.toString(), irJson)
  }

  /** 读取 RenderIR 快照 */
  async readIR(frameId: number): Promise<string | null> {
    return await this.readText('ir', frameId.toString())
  }

  /** 写入项目元数据 */
  async writeMetadata(key: string, value: string): Promise<void> {
    await this.writeText('metadata', key, value)
  }

  /** 读取项目元数据 */
  async readMetadata(key: string): Promise<string | null> {
    return await this.readText('metadata', key)
  }

  /** 删除元数据 */
  async deleteMetadata(key: string): Promise<void> {
    const l1 = pickL1('metadata')
    l1.delete(l1Key('metadata', key))
    await tauriDb.deleteMetadata(key)
    await opfsStore.delete(pickNamespace('metadata'), opfsFilename('metadata', key))
  }

  /** 删除渲染帧像素数据 */
  async deleteFrame(frameId: number): Promise<void> {
    const l1 = pickL1('frame')
    l1.delete(l1Key('frame', frameId.toString()))
    await opfsStore.delete(pickNamespace('frame'), opfsFilename('frame', frameId.toString()))
  }

  /** 删除 WGSL 着色器 */
  async deleteShader(hash: string): Promise<void> {
    const l1 = pickL1('shader')
    l1.delete(l1Key('shader', hash))
    await opfsStore.delete(pickNamespace('shader'), opfsFilename('shader', hash))
    await tauriDb.deleteShader(hash)
  }

  /** 删除 RenderIR 快照 */
  async deleteIR(frameId: number): Promise<void> {
    const l1 = pickL1('ir')
    l1.delete(l1Key('ir', frameId.toString()))
    await opfsStore.delete(pickNamespace('ir'), opfsFilename('ir', frameId.toString()))
    await tauriDb.deleteIR(frameId)
  }

  /** 删除资产元数据 */
  async deleteAsset(assetId: string): Promise<void> {
    const l1 = pickL1('asset')
    l1.delete(l1Key('asset', assetId))
    await tauriDb.deleteAsset(assetId)
    await opfsStore.delete(pickNamespace('asset'), opfsFilename('asset', assetId))
  }

  /** 写入资产元数据 */
  async writeAsset(assetId: string, metaJson: string): Promise<void> {
    await this.writeText('asset', assetId, metaJson)
  }

  /** 读取资产元数据 */
  async readAsset(assetId: string): Promise<string | null> {
    return await this.readText('asset', assetId)
  }

  /** 列出全部资产元数据 */
  async listAssets(): Promise<Array<{ assetId: string; meta: unknown }>> {
    return await tauriDb.listAssets()
  }

  // ===== 维护 =====

  /** 清空所有层 */
  async clearAll(): Promise<void> {
    frameMemoryCache.clear()
    textMemoryCache.clear()
    await tauriDb.clearAll()
  }

  /** 清空指定类别（仅清 L1+L2，不影响 L3 索引） */
  async clearCategory(category: StorageCategory): Promise<void> {
    const l1 = pickL1(category)
    const ns = pickNamespace(category)
    // 清 L1 中该类别的所有条目
    const prefix = `${category}:`
    for (const key of l1.keys()) {
      if (key.startsWith(prefix)) {
        l1.delete(key)
      }
    }
    // 清 L2 命名空间
    await opfsStore.clear(ns)
  }

  /** 获取统计 */
  async stats(): Promise<UnifiedStoreStats> {
    return {
      frameMemory: frameMemoryCache.stats(),
      textMemory: textMemoryCache.stats(),
      opfsAvailable: await isOpfsAvailable(),
    }
  }

  /** 估算大小（公开 estimateSize） */
  static estimateSize = estimateSize
}

/** 全局单例 */
export const unifiedStore = new UnifiedStore()

/**
 * 初始化存储系统
 * 在应用启动时调用一次
 */
export async function initStorage(): Promise<void> {
  await opfsStore.ready()
  console.info('[Storage] 三层存储系统就绪')
  console.info('[Storage] L1 帧缓存:', frameMemoryCache.stats())
  console.info('[Storage] L1 文本缓存:', textMemoryCache.stats())
}
