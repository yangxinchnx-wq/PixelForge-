import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { Asset, AssetType } from './types'
import { textureCache } from './textureCache'
import {
  persistAssetBinary,
  upsertAssetIndex,
  assetToIndexEntry,
  deleteAssetFile,
  removeAssetFromIndex,
  restoreAllAssets,
  saveAssetIndex,
} from './assetPersistence'

/**
 * Asset 资源库 store。
 *
 * 职责:
 * - 维护用户导入的所有资源项(items)
 * - 提供 add / remove / rename / getById 操作
 * - 提供 byType / totalCount 计算属性(供 UI 分组展示)
 * - 持久化：add 时异步写入 OPFS，remove 时删除 OPFS 文件，init 时从 OPFS 恢复
 *
 * 不职责:
 * - 文件 IO(由 assetLoader 负责)
 * - GPU 纹理上传(由 textureCache 负责)
 * - Layer 转换(由 assetToLayer 负责)
 */
export const useAssetStore = defineStore('assets', () => {
  const items = ref<Asset[]>([])

  const totalCount = computed(() => items.value.length)
  const imageCount = computed(() => items.value.filter((a) => a.type === 'image').length)
  const textureCount = computed(() => items.value.filter((a) => a.type === 'texture').length)
  const videoCount = computed(() => items.value.filter((a) => a.type === 'video').length)
  const images = computed(() => items.value.filter((a) => a.type === 'image'))
  const textures = computed(() => items.value.filter((a) => a.type === 'texture'))
  const videos = computed(() => items.value.filter((a) => a.type === 'video'))

  /** 是否正在从 OPFS 恢复资产 */
  const isRestoring = ref(false)

  /**
   * 添加资源(若 id 已存在则忽略)。
   *
   * 图片/纹理异步上传到 GPU 纹理缓存。
   * 同时异步将二进制数据持久化到 OPFS（不阻塞 UI）。
   */
  function add(asset: Asset): void {
    if (items.value.some((a) => a.id === asset.id)) return
    items.value.push(asset)
    // 仅图片/纹理类型上传到 GPU 纹理缓存,视频由 <video> 元素直接播放
    if (asset.type === 'image' || asset.type === 'texture') {
      void textureCache.register(asset)
    }
    // 异步持久化到 OPFS（不阻塞 UI）
    void persistAsset(asset)
  }

  /** 批量添加 */
  function addMany(newItems: Asset[]): void {
    for (const item of newItems) add(item)
  }

  /**
   * 异步将资产二进制持久化到 OPFS。
   * 写入完成后更新 asset.opfsPath 并更新索引。
   */
  async function persistAsset(asset: Asset): Promise<void> {
    // 如果已有 opfsPath，说明已经持久化过（从 OPFS 恢复的）
    if (asset.opfsPath) {
      // 仍需更新索引（确保索引中有此条目）
      void upsertAssetIndex(assetToIndexEntry(asset))
      return
    }

    const opfsPath = await persistAssetBinary(asset)
    if (opfsPath) {
      asset.opfsPath = opfsPath
      // 更新索引
      void upsertAssetIndex(assetToIndexEntry(asset))
    }
  }

  /**
   * 按 ID 移除资源(同时释放 blob URL + GPU 纹理 + OPFS 文件)
   */
  function remove(id: string): void {
    const idx = items.value.findIndex((a) => a.id === id)
    if (idx < 0) return
    const [removed] = items.value.splice(idx, 1)
    // 销毁 GPU 纹理
    textureCache.dispose(id)
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url)
    }
    // 异步删除 OPFS 文件 + 索引条目
    if (removed?.opfsPath) {
      void deleteAssetFile(removed.opfsPath)
      void removeAssetFromIndex(id)
    }
  }

  /** 按 ID 查找 */
  function getById(id: string): Asset | undefined {
    return items.value.find((a) => a.id === id)
  }

  /** 重命名 */
  function rename(id: string, name: string): void {
    const asset = getById(id)
    if (asset) {
      asset.name = name
      // 更新索引
      if (asset.opfsPath) {
        void upsertAssetIndex(assetToIndexEntry(asset))
      }
    }
  }

  /** 按类型筛选 */
  function getByType(type: AssetType): Asset[] {
    return items.value.filter((a) => a.type === type)
  }

  /**
   * 清空所有资源(释放 blob URL + GPU 纹理 + OPFS 文件)
   * 注意：此操作不可撤销，会删除 OPFS 中的所有资产文件和索引
   */
  function clear(): void {
    textureCache.disposeAll()
    const toDelete = [...items.value]
    items.value = []
    // 异步删除所有 OPFS 文件 + 索引
    void (async () => {
      for (const item of toDelete) {
        if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url)
        if (item.opfsPath) {
          await deleteAssetFile(item.opfsPath)
        }
      }
      await saveAssetIndex([])
    })()
  }

  /**
   * 从 OPFS 恢复全部资产。
   *
   * 在应用启动时调用（App.vue onMounted）。
   * 读取 OPFS 中的 index.json，逐个恢复二进制为 blob URL，
   * 然后添加到 store 中（GPU 纹理缓存也会自动注册）。
   */
  async function init(): Promise<void> {
    if (isRestoring.value) return
    isRestoring.value = true

    try {
      const restored = await restoreAllAssets()
      if (restored.length === 0) {
        console.log('[AssetStore] OPFS 中无已持久化的资产')
        return
      }

      // 添加到 store（不触发再次持久化，因为已有 opfsPath）
      for (const asset of restored) {
        if (items.value.some((a) => a.id === asset.id)) continue
        items.value.push(asset)
        // 图片/纹理上传到 GPU 纹理缓存
        if (asset.type === 'image' || asset.type === 'texture') {
          void textureCache.register(asset)
        }
      }

      console.log(`[AssetStore] 从 OPFS 恢复了 ${restored.length} 个资产`)
    } catch (e) {
      console.error('[AssetStore] 从 OPFS 恢复资产失败:', e)
    } finally {
      isRestoring.value = false
    }
  }

  return {
    items,
    totalCount,
    imageCount,
    textureCount,
    videoCount,
    images,
    textures,
    videos,
    isRestoring,
    add,
    addMany,
    remove,
    getById,
    rename,
    getByType,
    clear,
    init,
  }
})
