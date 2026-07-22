/**
 * Asset Packaging(Step 35.7)— 打包导出 + 导入。
 *
 * 职责:
 * - 把资产 + 引用关系打包为可移植的 AssetPackage
 * - 支持序列化(JSON)和反序列化
 * - 支持版本号 + 校验
 *
 * 不职责:
 * - 不做实际文件 IO(由调用方负责)
 * - 不做二进制 payload 导出(只导出元数据 + payloadRef)
 */
import type { AssetRecord } from './assetRegistry'
import type { Reference } from './referenceGraph'

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 资产包(可序列化) */
export interface AssetPackage {
  /** 包格式版本 */
  formatVersion: 1
  /** 包名 */
  name: string
  /** 创建时间戳 */
  createdAt: number
  /** 资产列表(仅元数据 + payloadRef,不含实际 payload) */
  assets: AssetRecord[]
  /** 引用关系列表 */
  references: Reference[]
}

/** 导入结果 */
export interface ImportResult {
  /** 导入的资产数 */
  importedAssetCount: number
  /** 导入的引用数 */
  importedReferenceCount: number
  /** 跳过的资产数(已存在) */
  skippedAssetCount: number
  /** 错误列表 */
  errors: string[]
}

// ============================================================================
// 2. 导出
// ============================================================================

/**
 * 创建资产包。
 *
 * @param name 包名
 * @param assets 资产列表
 * @param references 引用关系列表
 */
export function createPackage(
  name: string,
  assets: AssetRecord[],
  references: Reference[],
): AssetPackage {
  return {
    formatVersion: 1,
    name,
    createdAt: Date.now(),
    assets: assets.map((a) => ({ ...a })),
    references: references.map((r) => ({ ...r })),
  }
}

/**
 * 序列化资产包为 JSON 字符串。
 *
 * @param pkg 资产包
 * @returns JSON 字符串
 */
export function serializePackage(pkg: AssetPackage): string {
  return JSON.stringify(pkg, null, 2)
}

// ============================================================================
// 3. 导入
// ============================================================================

/**
 * 反序列化 JSON 字符串为资产包。
 *
 * @param json JSON 字符串
 * @returns 资产包
 * @throws 若 JSON 无效或格式不兼容
 */
export function deserializePackage(json: string): AssetPackage {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    throw new Error(`JSON 解析失败: ${(e as Error).message}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('无效的资产包格式')
  }

  const obj = parsed as Partial<AssetPackage>
  if (obj.formatVersion !== 1) {
    throw new Error(`不支持的包格式版本: ${obj.formatVersion}`)
  }
  if (!Array.isArray(obj.assets)) {
    throw new Error('资产列表必须是数组')
  }
  if (!Array.isArray(obj.references)) {
    throw new Error('引用列表必须是数组')
  }

  return {
    formatVersion: 1,
    name: obj.name ?? '未命名',
    createdAt: obj.createdAt ?? Date.now(),
    assets: obj.assets as AssetRecord[],
    references: obj.references as Reference[],
  }
}

/**
 * 校验资产包完整性。
 *
 * @param pkg 资产包
 * @returns 错误列表(空数组表示通过)
 */
export function validatePackage(pkg: AssetPackage): string[] {
  const errors: string[] = []

  if (pkg.formatVersion !== 1) {
    errors.push(`格式版本必须为 1,实际为 ${pkg.formatVersion}`)
  }

  if (!pkg.name || pkg.name.trim() === '') {
    errors.push('包名不能为空')
  }

  // 检查引用关系中的资产 ID 是否都在资产列表中
  const assetIds = new Set(pkg.assets.map((a) => a.id))
  for (const ref of pkg.references) {
    if (!assetIds.has(ref.sourceId)) {
      errors.push(`引用 ${ref.id} 的 sourceId(${ref.sourceId})不在资产列表中`)
    }
    if (!assetIds.has(ref.targetId)) {
      errors.push(`引用 ${ref.id} 的 targetId(${ref.targetId})不在资产列表中`)
    }
  }

  // 检查资产 ID 唯一性
  const idCounts = new Map<string, number>()
  for (const asset of pkg.assets) {
    idCounts.set(asset.id, (idCounts.get(asset.id) ?? 0) + 1)
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push(`资产 ID 重复: ${id}(${count} 次)`)
    }
  }

  return errors
}

/**
 * 合并资产包到现有资产集合(返回新集合)。
 * 已存在的资产 ID 跳过,不覆盖。
 *
 * @param existingAssets 现有资产列表
 * @param existingReferences 现有引用列表
 * @param pkg 待导入的资产包
 * @returns 导入结果 + 新资产列表 + 新引用列表
 */
export function mergePackage(
  existingAssets: AssetRecord[],
  existingReferences: Reference[],
  pkg: AssetPackage,
): {
  result: ImportResult
  assets: AssetRecord[]
  references: Reference[]
} {
  const errors: string[] = []
  const existingIds = new Set(existingAssets.map((a) => a.id))
  const existingRefIds = new Set(existingReferences.map((r) => r.id))

  const newAssets: AssetRecord[] = []
  let skipped = 0
  for (const asset of pkg.assets) {
    if (existingIds.has(asset.id)) {
      skipped++
    } else {
      newAssets.push({ ...asset })
    }
  }

  const newRefs: Reference[] = []
  for (const ref of pkg.references) {
    if (existingRefIds.has(ref.id)) {
      // 跳过已存在的引用
    } else {
      newRefs.push({ ...ref })
    }
  }

  return {
    result: {
      importedAssetCount: newAssets.length,
      importedReferenceCount: newRefs.length,
      skippedAssetCount: skipped,
      errors,
    },
    assets: [...existingAssets, ...newAssets],
    references: [...existingReferences, ...newRefs],
  }
}

// ============================================================================
// 4. 过滤导出
// ============================================================================

/**
 * 按资产 ID 列表过滤导出(只导出指定资产 + 相关引用)。
 *
 * @param name 包名
 * @param assets 全部资产
 * @param references 全部引用
 * @param assetIds 要导出的资产 ID 列表
 * @returns 资产包
 */
export function createPackageWithIds(
  name: string,
  assets: AssetRecord[],
  references: Reference[],
  assetIds: string[],
): AssetPackage {
  const idSet = new Set(assetIds)
  const filteredAssets = assets.filter((a) => idSet.has(a.id))
  // 只保留 source 和 target 都在导出列表中的引用
  const filteredRefs = references.filter(
    (r) => idSet.has(r.sourceId) && idSet.has(r.targetId),
  )
  return createPackage(name, filteredAssets, filteredRefs)
}
