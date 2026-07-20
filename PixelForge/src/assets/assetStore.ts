import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { Asset, AssetType } from './types'
import { textureCache } from './textureCache'

/**
 * Asset 资源库 store。
 *
 * 职责:
 * - 维护用户导入的所有资源项(items)
 * - 提供 add / remove / rename / getById 操作
 * - 提供 byType / totalCount 计算属性(供 UI 分组展示)
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
  const images = computed(() => items.value.filter((a) => a.type === 'image'))
  const textures = computed(() => items.value.filter((a) => a.type === 'texture'))

  /** 添加资源(若 id 已存在则忽略), 同时异步上传到 GPU 纹理缓存 */
  function add(asset: Asset): void {
    if (items.value.some((a) => a.id === asset.id)) return
    items.value.push(asset)
    // 异步上传到 GPU(textureCache 内部处理 device 未绑定时的降级)
    void textureCache.register(asset)
  }

  /** 批量添加 */
  function addMany(newItems: Asset[]): void {
    for (const item of newItems) add(item)
  }

  /** 按 ID 移除资源(同时释放 blob URL + GPU 纹理) */
  function remove(id: string): void {
    const idx = items.value.findIndex((a) => a.id === id)
    if (idx < 0) return
    const [removed] = items.value.splice(idx, 1)
    // 销毁 GPU 纹理
    textureCache.dispose(id)
    if (removed?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url)
    }
  }

  /** 按 ID 查找 */
  function getById(id: string): Asset | undefined {
    return items.value.find((a) => a.id === id)
  }

  /** 重命名 */
  function rename(id: string, name: string): void {
    const asset = getById(id)
    if (asset) asset.name = name
  }

  /** 按类型筛选 */
  function getByType(type: AssetType): Asset[] {
    return items.value.filter((a) => a.type === type)
  }

  /** 清空所有资源(释放 blob URL + GPU 纹理) */
  function clear(): void {
    textureCache.disposeAll()
    for (const item of items.value) {
      if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url)
    }
    items.value = []
  }

  return {
    items,
    totalCount,
    imageCount,
    textureCount,
    images,
    textures,
    add,
    addMany,
    remove,
    getById,
    rename,
    getByType,
    clear,
  }
})
