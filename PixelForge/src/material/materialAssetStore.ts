/**
 * Material Asset Store — 材质资产管理的 Pinia Store。
 *
 * 职责:
 * - 管理材质资产列表（CRUD: create / read / update / delete）
 * - 为每个新材质生成全局唯一 ID（materialId.ts）
 * - 提供搜索、筛选、排序功能
 * - 集成导入/导出功能（materialExport.ts / materialImport.ts）
 * - 持久化到 localStorage（自动保存/恢复）
 *
 * 与 materialGraph.ts 的关系:
 * - materialGraph.ts: 管理单个 MaterialGraph 的编辑状态（节点/边/选中）
 * - materialAssetStore.ts: 管理材质资产库（多个 MaterialAsset 的列表）
 *
 * 数据流:
 *   用户创建材质 → store.createMaterial() → 生成 ID → 添加到列表
 *   用户编辑材质 → store.getMaterial(id) → 修改 → store.updateMaterial(id, changes)
 *   用户导出材质 → store.exportMaterial(id, format) → downloadBlob
 *   用户导入材质 → 文件 → importMaterial() → store.addMaterial(asset)
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

import type { MaterialAsset, MaterialCategory, MaterialExportFormat } from './materialAsset'
import { createMaterialAsset, touchMaterialAsset } from './materialAsset'
import { generateMaterialId, isValidMaterialId } from './materialId'
import {
  exportMaterial,
  exportResultToBlob,
  type MaterialExportResult,
} from './materialExport'
import {
  importMaterial,
  readFileAsText,
  countMaterialsInFile,
  type MaterialImportResult,
} from './materialImport'
import type { MaterialGraph } from './types'
import { buildPreset, listPresetKeys, getPreset } from './materialPresets'
import { renderMaterialThumbnail, renderMaterialThumbnailSync } from './materialPreview'

// ============================================================================
// 1. 常量
// ============================================================================

const STORAGE_KEY = 'pixelforge:materialAssets'
const STORAGE_VERSION = '1.2.0'

// ============================================================================
// 2. Store 定义
// ============================================================================

export const useMaterialAssetStore = defineStore('materialAsset', () => {
  // —— State ——
  const assets = ref<MaterialAsset[]>([])
  const selectedAssetId = ref<string | null>(null)
  const searchQuery = ref('')
  const filterCategory = ref<MaterialCategory | 'all'>('all')
  const sortBy = ref<'name' | 'createdAt' | 'modifiedAt'>('modifiedAt')
  const sortOrder = ref<'asc' | 'desc'>('desc')

  /** GPU 设备引用（由外部注入，用于 WebGPU 预览渲染） */
  let gpuDevice: GPUDevice | null = null

  /** 正在生成缩略图的材质 ID 集合 */
  const generatingThumbnails = ref<Set<string>>(new Set())

  // —— Getters ——

  /** 材质总数 */
  const assetCount = computed(() => assets.value.length)

  /** 当前选中的材质资产 */
  const selectedAsset = computed<MaterialAsset | null>(() => {
    if (!selectedAssetId.value) return null
    return assets.value.find((a) => a.id === selectedAssetId.value) ?? null
  })

  /** 按分类统计 */
  const categoryStats = computed(() => {
    const stats: Record<string, number> = {}
    for (const asset of assets.value) {
      stats[asset.category] = (stats[asset.category] ?? 0) + 1
    }
    return stats
  })

  /** 过滤 + 搜索 + 排序后的列表 */
  const filteredAssets = computed<MaterialAsset[]>(() => {
    let result = assets.value

    // 搜索
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase().trim()
      result = result.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }

    // 分类筛选
    if (filterCategory.value !== 'all') {
      result = result.filter((a) => a.category === filterCategory.value)
    }

    // 排序
    const sorted = [...result]
    sorted.sort((a, b) => {
      let cmp = 0
      switch (sortBy.value) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'createdAt':
          cmp = a.createdAt.localeCompare(b.createdAt)
          break
        case 'modifiedAt':
          cmp = a.modifiedAt.localeCompare(b.modifiedAt)
          break
      }
      return sortOrder.value === 'asc' ? cmp : -cmp
    })

    return sorted
  })

  // —— Actions: CRUD ——

  /**
   * 创建新材质资产。
   *
   * @param name 材质名称
   * @param options 可选参数（分类、标签、PBR 参数、MaterialGraph 等）
   * @returns 新创建的材质资产 ID
   */
  function createMaterial(
    name: string,
    options?: Partial<Omit<MaterialAsset, 'id' | 'createdAt' | 'modifiedAt'>>,
  ): string {
    const asset = createMaterialAsset(name, options)
    asset.id = generateMaterialId()
    // 立即生成同步 PBR 预览（快速显示，WebGPU 预览异步替换）
    asset.thumbnail = renderMaterialThumbnailSync(asset)
    assets.value = [...assets.value, asset]
    selectedAssetId.value = asset.id
    _persist()
    // 异步生成高质量预览（若有 MaterialGraph + GPU 设备）
    _generateThumbnailAsync(asset.id)
    return asset.id
  }

  /**
   * 从预设创建材质。
   *
   * @param presetKey 预设 key（如 'starfield' / 'nebula'）
   * @param name 可选自定义名称
   * @returns 新创建的材质资产 ID
   */
  function createMaterialFromPreset(presetKey: string, name?: string): string | null {
    const preset = getPreset(presetKey)
    if (!preset) {
      console.error(`[MaterialAssetStore] 未知预设: ${presetKey}`)
      return null
    }

    const graph: MaterialGraph = buildPreset(presetKey)
    const assetName = name ?? preset.label
    const id = createMaterial(assetName, {
      category: 'procedural',
      tags: preset.subjects,
      description: preset.description,
      graph,
    })
    return id
  }

  /**
   * 从导入结果添加材质。
   *
   * @param asset 导入的材质资产（ID 为空，由 store 生成）
   * @returns 新分配的 ID
   */
  function addImportedMaterial(asset: MaterialAsset): string {
    asset.id = generateMaterialId()
    // 生成预览
    asset.thumbnail = renderMaterialThumbnailSync(asset)
    assets.value = [...assets.value, asset]
    selectedAssetId.value = asset.id
    _persist()
    _generateThumbnailAsync(asset.id)
    return asset.id
  }

  /**
   * 更新材质资产。
   *
   * @param id 材质 ID
   * @param changes 要修改的字段
   */
  function updateMaterial(id: string, changes: Partial<MaterialAsset>): void {
    const asset = assets.value.find((a) => a.id === id)
    if (!asset) {
      console.warn(`[MaterialAssetStore] 更新失败: 未找到材质 ${id}`)
      return
    }
    // 不允许通过 changes 修改 ID 和创建时间
    const { id: _ignoredId, createdAt: _ignoredCreatedAt, ...safeChanges } = changes
    Object.assign(asset, safeChanges)
    touchMaterialAsset(asset)
    // PBR 参数或 graph 变化时重新生成缩略图
    if (safeChanges.pbr || safeChanges.graph) {
      asset.thumbnail = renderMaterialThumbnailSync(asset)
      _generateThumbnailAsync(id)
    }
    assets.value = [...assets.value] // 触发响应式
    _persist()
  }

  /**
   * 重命名材质。
   */
  function renameMaterial(id: string, name: string): void {
    updateMaterial(id, { name })
  }

  /**
   * 添加标签。
   */
  function addTag(id: string, tag: string): void {
    const asset = assets.value.find((a) => a.id === id)
    if (!asset) return
    if (!asset.tags.includes(tag)) {
      asset.tags = [...asset.tags, tag]
      touchMaterialAsset(asset)
      assets.value = [...assets.value]
      _persist()
    }
  }

  /**
   * 移除标签。
   */
  function removeTag(id: string, tag: string): void {
    const asset = assets.value.find((a) => a.id === id)
    if (!asset) return
    asset.tags = asset.tags.filter((t) => t !== tag)
    touchMaterialAsset(asset)
    assets.value = [...assets.value]
      _persist()
  }

  /**
   * 更新 PBR 参数。
   */
  function updatePBR(id: string, pbr: Partial<MaterialAsset['pbr']>): void {
    const asset = assets.value.find((a) => a.id === id)
    if (!asset) return
    asset.pbr = { ...asset.pbr, ...pbr }
    touchMaterialAsset(asset)
    // PBR 参数变化，重新生成 Canvas 2D 预览（同步即可）
    asset.thumbnail = renderMaterialThumbnailSync(asset)
    assets.value = [...assets.value]
    _persist()
  }

  /**
   * 删除材质。
   */
  function deleteMaterial(id: string): void {
    assets.value = assets.value.filter((a) => a.id !== id)
    if (selectedAssetId.value === id) {
      selectedAssetId.value = null
    }
    _persist()
  }

  /**
   * 复制材质（创建副本，生成新 ID）。
   */
  function duplicateMaterial(id: string): string | null {
    const original = assets.value.find((a) => a.id === id)
    if (!original) return null
    const copy: MaterialAsset = JSON.parse(JSON.stringify(original))
    copy.id = generateMaterialId()
    copy.name = `${original.name} (副本)`
    copy.createdAt = new Date().toISOString()
    copy.modifiedAt = copy.createdAt
    // 重新生成预览
    copy.thumbnail = renderMaterialThumbnailSync(copy)
    assets.value = [...assets.value, copy]
    selectedAssetId.value = copy.id
    _persist()
    _generateThumbnailAsync(copy.id)
    return copy.id
  }

  // —— Actions: 查询 ——

  /**
   * 根据 ID 获取材质。
   */
  function getMaterial(id: string): MaterialAsset | undefined {
    return assets.value.find((a) => a.id === id)
  }

  /**
   * 检查 ID 是否已存在。
   */
  function hasMaterial(id: string): boolean {
    return assets.value.some((a) => a.id === id)
  }

  // —— Actions: 选择 ——

  function selectMaterial(id: string | null): void {
    selectedAssetId.value = id
  }

  // —— Actions: 导出 ——

  /**
   * 生成材质的导出结果（不触发浏览器下载）。
   *
   * @param id 材质 ID
   * @param format 导出格式
   * @returns 导出结果（含文件名和内容），未找到材质时返回 null
   */
  function prepareMaterialExport(id: string, format: MaterialExportFormat): MaterialExportResult | null {
    const asset = assets.value.find((a) => a.id === id)
    if (!asset) {
      console.warn(`[MaterialAssetStore] 导出失败: 未找到材质 ${id}`)
      return null
    }
    return exportMaterial(asset, format)
  }

  /**
   * 导出材质到文件并触发浏览器下载。
   *
   * @param id 材质 ID
   * @param format 导出格式
   * @returns 导出结果（含文件名和内容）
   */
  function exportMaterialById(id: string, format: MaterialExportFormat): MaterialExportResult | null {
    const result = prepareMaterialExport(id, format)
    if (!result) return null

    // 触发浏览器下载（仅在浏览器环境中）
    if (typeof document !== 'undefined') {
      const blob = exportResultToBlob(result)
      _downloadBlob(blob, result.filename)
    }

    return result
  }

  /**
   * 导出全部材质为 .pfmat 格式的打包文件。
   */
  function exportAllMaterials(): void {
    if (assets.value.length === 0) return
    const packed = {
      format: 'pixelforge-material-pack',
      formatVersion: STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      count: assets.value.length,
      materials: assets.value,
    }
    const blob = new Blob([JSON.stringify(packed, null, 2)], { type: 'application/json' })
    _downloadBlob(blob, `pixelforge_materials_${Date.now()}.pfpack`)
  }

  // —— Actions: 导入 ——

  /**
   * 从文件导入材质。
   *
   * @param file 用户选择的文件
   * @returns 导入结果列表（一个文件可能包含多个材质）
   */
  async function importFromFile(file: File): Promise<MaterialImportResult[]> {
    const content = await readFileAsText(file)
    const count = countMaterialsInFile(content, file.name)
    const results: MaterialImportResult[] = []

    if (count <= 1) {
      const result = importMaterial(content, file.name, 0)
      if (result.ok && result.asset) {
        const id = addImportedMaterial(result.asset)
        result.asset.id = id
      }
      results.push(result)
    } else {
      // 批量导入
      for (let i = 0; i < count; i++) {
        const result = importMaterial(content, file.name, i)
        if (result.ok && result.asset) {
          const id = addImportedMaterial(result.asset)
          result.asset.id = id
        }
        results.push(result)
      }
    }

    return results
  }

  // —— Actions: 持久化 ——

  /**
   * 从 localStorage 恢复。
   */
  function loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed.version !== STORAGE_VERSION) {
        console.warn(`[MaterialAssetStore] 存储版本不匹配: ${parsed.version} vs ${STORAGE_VERSION}`)
        return
      }
      if (Array.isArray(parsed.assets)) {
        // 过滤掉 ID 无效的资产
        assets.value = parsed.assets.filter((a: MaterialAsset) =>
          isValidMaterialId(a.id) || a.id === '',
        )
      }
    } catch (e) {
      console.error('[MaterialAssetStore] 加载存储失败:', e)
    }
  }

  /**
   * 保存到 localStorage。
   */
  function _persist(): void {
    try {
      const data = {
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        assets: assets.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.error('[MaterialAssetStore] 保存存储失败:', e)
    }
  }

  /**
   * 触发浏览器下载（内部方法）。
   */
  function _downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  // —— Actions: 预览生成 ——

  /**
   * 异步生成高质量缩略图（WebGPU 渲染）。
   *
   * 仅在有 MaterialGraph 且 GPU 设备可用时执行。
   * 成功后替换同步生成的 Canvas 2D 预览。
   */
  async function _generateThumbnailAsync(id: string): Promise<void> {
    const asset = assets.value.find((a) => a.id === id)
    if (!asset || !asset.graph || !gpuDevice) return

    // 避免重复生成
    if (generatingThumbnails.value.has(id)) return
    generatingThumbnails.value = new Set(generatingThumbnails.value).add(id)

    try {
      const thumbnail = await renderMaterialThumbnail(asset, gpuDevice)
      if (thumbnail) {
        // 重新查找 asset（可能在异步过程中被删除）
        const current = assets.value.find((a) => a.id === id)
        if (current) {
          current.thumbnail = thumbnail
          assets.value = [...assets.value] // 触发响应式
          _persist()
        }
      }
    } catch (e) {
      console.error(`[MaterialAssetStore] 缩略图生成失败 (${id}):`, e)
    } finally {
      const next = new Set(generatingThumbnails.value)
      next.delete(id)
      generatingThumbnails.value = next
    }
  }

  /**
   * 为所有材质重新生成缩略图。
   */
  async function regenerateAllThumbnails(): Promise<void> {
    for (const asset of assets.value) {
      asset.thumbnail = renderMaterialThumbnailSync(asset)
      await _generateThumbnailAsync(asset.id)
    }
    assets.value = [...assets.value]
    _persist()
  }

  /**
   * 设置 GPU 设备（由 App.vue 在 WebGPU 初始化后注入）。
   */
  function setGpuDevice(device: GPUDevice | null): void {
    gpuDevice = device
    if (device) {
      // 设备可用时，为所有有 graph 的材质生成高质量预览
      for (const asset of assets.value) {
        if (asset.graph) {
          _generateThumbnailAsync(asset.id)
        }
      }
    }
  }

  /** 是否正在生成某个材质的缩略图 */
  function isGeneratingThumbnail(id: string): boolean {
    return generatingThumbnails.value.has(id)
  }

  // —— Actions: 初始化 ——

  /**
   * 初始化：从存储加载，如果没有材质则创建几个默认预设材质。
   */
  function init(): void {
    loadFromStorage()
    if (assets.value.length === 0) {
      // 创建几个默认材质
      const defaultPresets = listPresetKeys().slice(0, 4)
      for (const key of defaultPresets) {
        createMaterialFromPreset(key)
      }
      // 取消选中
      selectedAssetId.value = null
    } else {
      // 重新生成空缩略图（修复旧数据或之前 renderMaterialThumbnailSync 返回空的问题）
      for (const asset of assets.value) {
        if (!asset.thumbnail) {
          asset.thumbnail = renderMaterialThumbnailSync(asset)
        }
      }
      assets.value = [...assets.value] // 触发响应式
    }
  }

  // —— Watch: 自动持久化 ——
  watch(assets, () => _persist(), { deep: true })

  return {
    // state
    assets,
    selectedAssetId,
    searchQuery,
    filterCategory,
    sortBy,
    sortOrder,
    // getters
    assetCount,
    selectedAsset,
    categoryStats,
    filteredAssets,
    // crud
    createMaterial,
    createMaterialFromPreset,
    addImportedMaterial,
    updateMaterial,
    renameMaterial,
    addTag,
    removeTag,
    updatePBR,
    deleteMaterial,
    duplicateMaterial,
    // query
    getMaterial,
    hasMaterial,
    // selection
    selectMaterial,
    // export
    prepareMaterialExport,
    exportMaterialById,
    exportAllMaterials,
    // import
    importFromFile,
    // persistence
    loadFromStorage,
    init,
    // preview
    setGpuDevice,
    regenerateAllThumbnails,
    isGeneratingThumbnail,
  }
})
