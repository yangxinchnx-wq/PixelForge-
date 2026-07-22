/**
 * Asset Registry Core(Step 35.1)— 资产注册表核心模块。
 *
 * 职责:
 * - 定义全局资产类型系统(AssetKind × AssetCategory)
 * - 定义资产元数据(AssetMetadata / AssetRecord)
 * - 提供注册表纯函数操作(create/register/unregister/rename/update/tag/version)
 * - 提供查询纯函数(byId/byKind/byCategory/byTag/search)
 * - 提供验证纯函数(validateAssetRecord)
 *
 * 不职责:
 * - 不管理依赖关系(Step 35.2 Reference Graph)
 * - 不做内容哈希去重(Step 35.4 Content Hash)
 * - 不做懒加载(Step 35.5 Lazy Loading)
 * - 不做 UI(Step 35.6 Asset Browser)
 *
 * 与现有 src/assets/ 的关系:
 * - src/assets/ 只支持 image/texture,是 Phase 1-5 遗留模块
 * - 本模块是 Asset Genome 的核心,覆盖全项目所有资产类型
 * - 旧 Asset 可通过 assetFromLegacy 转换为 AssetRecord
 *
 * 数据流:
 *   用户导入/创建资产
 *     → createAssetRecord(kind, name, ...)
 *     → registerAsset(registry, record)
 *     → Store 触发响应式更新
 *     → UI 展示 / 查询 / 引用
 */
import { uniqueId } from '@/shared/ids'

// ============================================================================
// 1. 类型定义 — 资产种类(AssetKind)
// ============================================================================

/**
 * 资产种类枚举 — 覆盖 PixelForge 全项目所有资产类型。
 *
 * 分组(按 AssetCategory):
 * - media:    image / texture / audio / video
 * - shader:   material / shader / graph
 * - scene:    sequence / template / clip
 * - config:   effectChain / animation / renderConfig / preset
 */
export type AssetKind =
  // —— media 媒体资源 ——
  | 'image'
  | 'texture'
  | 'audio'
  | 'video'
  // —— shader 着色器资源 ——
  | 'material'
  | 'shader'
  | 'graph'
  // —— scene 场景资源 ——
  | 'sequence'
  | 'template'
  | 'clip'
  // —— config 配置资源 ——
  | 'effectChain'
  | 'animation'
  | 'renderConfig'
  | 'preset'

/** 资产大类(更高层分组,用于 UI 分类展示) */
export type AssetCategory = 'media' | 'shader' | 'scene' | 'config'

/** 资产来源 */
export type AssetSource = 'builtin' | 'user' | 'imported'

// ============================================================================
// 2. 类型定义 — 元数据与记录
// ============================================================================

/** 资产元数据(不含 payload,用于注册表索引) */
export interface AssetMetadata {
  /** 唯一 ID(前缀 + 时间戳 + 随机) */
  id: string
  /** 资产种类 */
  kind: AssetKind
  /** 大类(由 kind 推导,冗余存储便于查询) */
  category: AssetCategory
  /** 显示名(可重命名) */
  name: string
  /** 来源 */
  source: AssetSource
  /** 版本号(从 1 开始,每次 bumpVersion +1) */
  version: number
  /** 标签集合(用于分类与搜索) */
  tags: string[]
  /** 描述(可选) */
  description?: string
  /** 创建时间戳 */
  createdAt: number
  /** 最后更新时间戳 */
  updatedAt: number
  /** 内容哈希(Step 35.4 填充,用于去重) */
  contentHash?: string
  /** 大小(字节,可选 — 非所有资产都有大小) */
  size?: number
  /** 缩略图 dataURL(可选,用于 UI 展示) */
  thumbnail?: string
}

/**
 * 资产记录 — 注册表中的完整条目。
 *
 * payloadRef 是对外部 payload 的引用(如 blob URL / Store 内对象引用),
 * 注册表本身不存储 payload 内容,只存储元数据 + 引用。
 */
export interface AssetRecord extends AssetMetadata {
  /** payload 引用(如 blob URL / Store 内对象 ID / 外部资源 URL) */
  payloadRef?: string
}

/** 资产注册表(Map<id, AssetRecord>) */
export type AssetRegistry = Map<string, AssetRecord>

// ============================================================================
// 3. 常量映射 — kind ↔ category ↔ 显示名
// ============================================================================

/** AssetKind → AssetCategory 映射 */
export const CATEGORY_OF_KIND: Record<AssetKind, AssetCategory> = {
  image: 'media',
  texture: 'media',
  audio: 'media',
  video: 'media',
  material: 'shader',
  shader: 'shader',
  graph: 'shader',
  sequence: 'scene',
  template: 'scene',
  clip: 'scene',
  effectChain: 'config',
  animation: 'config',
  renderConfig: 'config',
  preset: 'config',
}

/** AssetKind → 中文显示名映射 */
export const KIND_DISPLAY_NAME: Record<AssetKind, string> = {
  image: '图片',
  texture: '纹理',
  audio: '音频',
  video: '视频',
  material: '材质',
  shader: '着色器',
  graph: '节点图',
  sequence: '序列',
  template: '模板',
  clip: '片段',
  effectChain: '效果链',
  animation: '动画',
  renderConfig: '渲染配置',
  preset: '预设',
}

/** AssetCategory → 中文显示名映射 */
export const CATEGORY_DISPLAY_NAME: Record<AssetCategory, string> = {
  media: '媒体',
  shader: '着色器',
  scene: '场景',
  config: '配置',
}

/** 所有 AssetKind 列表 */
export const ALL_ASSET_KINDS: AssetKind[] = Object.keys(CATEGORY_OF_KIND) as AssetKind[]

/** 所有 AssetCategory 列表 */
export const ALL_ASSET_CATEGORIES: AssetCategory[] = ['media', 'shader', 'scene', 'config']

// ============================================================================
// 4. ID 生成
// ============================================================================

/** AssetKind → ID 前缀映射 */
const KIND_ID_PREFIX: Record<AssetKind, string> = {
  image: 'img',
  texture: 'tex',
  audio: 'aud',
  video: 'vid',
  material: 'mat',
  shader: 'shd',
  graph: 'grp',
  sequence: 'seq',
  template: 'tpl',
  clip: 'clp',
  effectChain: 'efx',
  animation: 'ani',
  renderConfig: 'rnd',
  preset: 'pre',
}

/**
 * 生成资产 ID。
 * 格式: `${prefix}_${timestamp36}${random36}`
 *
 * @param kind 资产种类(决定前缀)
 */
export function genAssetId(kind: AssetKind): string {
  return uniqueId(KIND_ID_PREFIX[kind])
}

// ============================================================================
// 5. 工厂函数 — 创建资产记录
// ============================================================================

/** 创建资产记录的参数 */
export interface CreateAssetRecordOptions {
  /** 资产种类(必填) */
  kind: AssetKind
  /** 显示名(必填) */
  name: string
  /** 来源(默认 'user') */
  source?: AssetSource
  /** 标签(默认 []) */
  tags?: string[]
  /** 描述 */
  description?: string
  /** payload 引用 */
  payloadRef?: string
  /** 大小(字节) */
  size?: number
  /** 缩略图 dataURL */
  thumbnail?: string
  /** 内容哈希(Step 35.4) */
  contentHash?: string
  /** 自定义 ID(测试用,默认自动生成) */
  id?: string
  /** 自定义创建时间(测试用,默认 Date.now()) */
  createdAt?: number
}

/**
 * 创建资产记录(纯工厂函数)。
 *
 * @param options 创建参数
 * @returns 新的 AssetRecord(version=1, createdAt=updatedAt=now)
 */
export function createAssetRecord(options: CreateAssetRecordOptions): AssetRecord {
  const {
    kind,
    name,
    source = 'user',
    tags = [],
    description,
    payloadRef,
    size,
    thumbnail,
    contentHash,
    id,
    createdAt,
  } = options

  const now = createdAt ?? Date.now()
  const recordId = id ?? genAssetId(kind)

  return {
    id: recordId,
    kind,
    category: CATEGORY_OF_KIND[kind],
    name,
    source,
    version: 1,
    tags: [...tags],
    description,
    createdAt: now,
    updatedAt: now,
    contentHash,
    size,
    thumbnail,
    payloadRef,
  }
}

// ============================================================================
// 6. 注册表纯函数 — CRUD 操作
// ============================================================================

/**
 * 创建空注册表。
 */
export function createRegistry(): AssetRegistry {
  return new Map()
}

/**
 * 注册资产(若 id 已存在则拒绝)。
 *
 * @param registry 原注册表
 * @param record 资产记录
 * @returns 新注册表(不可变)
 * @throws 若 id 已存在
 */
export function registerAsset(registry: AssetRegistry, record: AssetRecord): AssetRegistry {
  if (registry.has(record.id)) {
    throw new Error(`资产 ID 已存在: ${record.id}`)
  }
  const next = new Map(registry)
  next.set(record.id, record)
  return next
}

/**
 * 批量注册资产(已存在的 id 跳过,不抛错)。
 *
 * @param registry 原注册表
 * @param records 资产记录列表
 * @returns 新注册表
 */
export function registerManyAssets(
  registry: AssetRegistry,
  records: AssetRecord[],
): AssetRegistry {
  const next = new Map(registry)
  for (const record of records) {
    if (!next.has(record.id)) {
      next.set(record.id, record)
    }
  }
  return next
}

/**
 * 注销资产(若 id 不存在则忽略)。
 *
 * @param registry 原注册表
 * @param id 资产 ID
 * @returns 新注册表
 */
export function unregisterAsset(registry: AssetRegistry, id: string): AssetRegistry {
  if (!registry.has(id)) return registry
  const next = new Map(registry)
  next.delete(id)
  return next
}

/**
 * 重命名资产。
 *
 * @param registry 原注册表
 * @param id 资产 ID
 * @param newName 新名称
 * @returns 新注册表(若 id 不存在则返回原注册表)
 */
export function renameAsset(registry: AssetRegistry, id: string, newName: string): AssetRegistry {
  const record = registry.get(id)
  if (!record) return registry
  const next = new Map(registry)
  next.set(id, { ...record, name: newName, updatedAt: Date.now() })
  return next
}

/**
 * 更新资产元数据(patch 模式,只更新提供的字段)。
 * 注意:id / kind / category / createdAt 不可更新。
 *
 * @param registry 原注册表
 * @param id 资产 ID
 * @param patch 更新字段(payloadRef 属于 AssetRecord 而非 AssetMetadata)
 * @returns 新注册表
 */
export function updateAssetMetadata(
  registry: AssetRegistry,
  id: string,
  patch: Partial<Pick<AssetRecord, 'name' | 'description' | 'source' | 'size' | 'thumbnail' | 'payloadRef' | 'contentHash'>>,
): AssetRegistry {
  const record = registry.get(id)
  if (!record) return registry
  const next = new Map(registry)
  const { name, description, source, size, thumbnail, payloadRef, contentHash } = patch
  next.set(id, {
    ...record,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(thumbnail !== undefined ? { thumbnail } : {}),
    ...(payloadRef !== undefined ? { payloadRef } : {}),
    ...(contentHash !== undefined ? { contentHash } : {}),
    updatedAt: Date.now(),
  })
  return next
}

/**
 * 添加标签(若已存在则忽略)。
 *
 * @param registry 原注册表
 * @param id 资产 ID
 * @param tag 标签
 * @returns 新注册表
 */
export function addTag(registry: AssetRegistry, id: string, tag: string): AssetRegistry {
  const record = registry.get(id)
  if (!record) return registry
  if (record.tags.includes(tag)) return registry
  const next = new Map(registry)
  next.set(id, { ...record, tags: [...record.tags, tag], updatedAt: Date.now() })
  return next
}

/**
 * 移除标签(若不存在则忽略)。
 *
 * @param registry 原注册表
 * @param id 资产 ID
 * @param tag 标签
 * @returns 新注册表
 */
export function removeTag(registry: AssetRegistry, id: string, tag: string): AssetRegistry {
  const record = registry.get(id)
  if (!record) return registry
  if (!record.tags.includes(tag)) return registry
  const next = new Map(registry)
  next.set(id, {
    ...record,
    tags: record.tags.filter((t) => t !== tag),
    updatedAt: Date.now(),
  })
  return next
}

/**
 * 版本号 +1。
 *
 * @param registry 原注册表
 * @param id 资产 ID
 * @returns 新注册表
 */
export function bumpVersion(registry: AssetRegistry, id: string): AssetRegistry {
  const record = registry.get(id)
  if (!record) return registry
  const next = new Map(registry)
  next.set(id, {
    ...record,
    version: record.version + 1,
    updatedAt: Date.now(),
  })
  return next
}

/**
 * 清空注册表。
 *
 * @param registry 原注册表
 * @returns 空注册表
 */
export function clearRegistry(registry: AssetRegistry): AssetRegistry {
  if (registry.size === 0) return registry
  return new Map()
}

// ============================================================================
// 7. 查询纯函数
// ============================================================================

/**
 * 按 ID 查找资产。
 *
 * @param registry 注册表
 * @param id 资产 ID
 * @returns 资产记录(未找到返回 undefined)
 */
export function getAssetById(registry: AssetRegistry, id: string): AssetRecord | undefined {
  return registry.get(id)
}

/**
 * 获取所有资产列表。
 */
export function getAllAssets(registry: AssetRegistry): AssetRecord[] {
  return Array.from(registry.values())
}

/**
 * 获取资产总数。
 */
export function getAssetCount(registry: AssetRegistry): number {
  return registry.size
}

/**
 * 按种类筛选资产。
 */
export function getAssetsByKind(registry: AssetRegistry, kind: AssetKind): AssetRecord[] {
  const result: AssetRecord[] = []
  for (const record of registry.values()) {
    if (record.kind === kind) result.push(record)
  }
  return result
}

/**
 * 按大类筛选资产。
 */
export function getAssetsByCategory(
  registry: AssetRegistry,
  category: AssetCategory,
): AssetRecord[] {
  const result: AssetRecord[] = []
  for (const record of registry.values()) {
    if (record.category === category) result.push(record)
  }
  return result
}

/**
 * 按标签筛选资产(包含任一标签即匹配)。
 *
 * @param registry 注册表
 * @param tags 标签列表(OR 语义)
 */
export function getAssetsByTag(registry: AssetRegistry, tags: string[]): AssetRecord[] {
  if (tags.length === 0) return []
  const tagSet = new Set(tags)
  const result: AssetRecord[] = []
  for (const record of registry.values()) {
    if (record.tags.some((t) => tagSet.has(t))) result.push(record)
  }
  return result
}

/**
 * 按来源筛选资产。
 */
export function getAssetsBySource(
  registry: AssetRegistry,
  source: AssetSource,
): AssetRecord[] {
  const result: AssetRecord[] = []
  for (const record of registry.values()) {
    if (record.source === source) result.push(record)
  }
  return result
}

/**
 * 文本搜索(名称 + 描述 + 标签,大小写不敏感)。
 *
 * @param registry 注册表
 * @param query 搜索关键词
 */
export function searchAssets(registry: AssetRegistry, query: string): AssetRecord[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const result: AssetRecord[] = []
  for (const record of registry.values()) {
    const nameMatch = record.name.toLowerCase().includes(q)
    const descMatch = record.description?.toLowerCase().includes(q) ?? false
    const tagMatch = record.tags.some((t) => t.toLowerCase().includes(q))
    if (nameMatch || descMatch || tagMatch) result.push(record)
  }
  return result
}

/**
 * 检查资产是否存在。
 */
export function hasAsset(registry: AssetRegistry, id: string): boolean {
  return registry.has(id)
}

/**
 * 按大类分组资产(返回 Record<category, AssetRecord[]>)。
 */
export function groupByCategory(
  registry: AssetRegistry,
): Record<AssetCategory, AssetRecord[]> {
  const result: Record<AssetCategory, AssetRecord[]> = {
    media: [],
    shader: [],
    scene: [],
    config: [],
  }
  for (const record of registry.values()) {
    result[record.category].push(record)
  }
  return result
}

/**
 * 按种类分组资产(返回 Record<kind, AssetRecord[]>)。
 */
export function groupByKind(
  registry: AssetRegistry,
): Partial<Record<AssetKind, AssetRecord[]>> {
  const result: Partial<Record<AssetKind, AssetRecord[]>> = {}
  for (const record of registry.values()) {
    if (!result[record.kind]) result[record.kind] = []
    result[record.kind]!.push(record)
  }
  return result
}

// ============================================================================
// 8. 验证纯函数
// ============================================================================

/** 验证错误类型 */
export type AssetValidationError =
  | { code: 'EMPTY_ID'; message: string }
  | { code: 'EMPTY_NAME'; message: string }
  | { code: 'INVALID_KIND'; message: string }
  | { code: 'INVALID_CATEGORY'; message: string }
  | { code: 'CATEGORY_MISMATCH'; message: string }
  | { code: 'INVALID_VERSION'; message: string }
  | { code: 'INVALID_TIMESTAMP'; message: string }
  | { code: 'INVALID_SOURCE'; message: string }

/**
 * 验证资产记录结构完整性。
 *
 * @param record 资产记录
 * @returns 错误列表(空数组表示通过)
 */
export function validateAssetRecord(record: AssetRecord): AssetValidationError[] {
  const errors: AssetValidationError[] = []

  if (!record.id || record.id.trim() === '') {
    errors.push({ code: 'EMPTY_ID', message: '资产 ID 不能为空' })
  }

  if (!record.name || record.name.trim() === '') {
    errors.push({ code: 'EMPTY_NAME', message: '资产名称不能为空' })
  }

  if (!ALL_ASSET_KINDS.includes(record.kind)) {
    errors.push({ code: 'INVALID_KIND', message: `无效的资产种类: ${record.kind}` })
  }

  if (!ALL_ASSET_CATEGORIES.includes(record.category)) {
    errors.push({ code: 'INVALID_CATEGORY', message: `无效的资产大类: ${record.category}` })
  }

  // kind 与 category 一致性
  if (ALL_ASSET_KINDS.includes(record.kind) && CATEGORY_OF_KIND[record.kind] !== record.category) {
    errors.push({
      code: 'CATEGORY_MISMATCH',
      message: `种类 ${record.kind} 应属大类 ${CATEGORY_OF_KIND[record.kind]},实际为 ${record.category}`,
    })
  }

  if (!Number.isInteger(record.version) || record.version < 1) {
    errors.push({ code: 'INVALID_VERSION', message: `版本号必须为正整数,实际为 ${record.version}` })
  }

  if (!Number.isFinite(record.createdAt) || record.createdAt <= 0) {
    errors.push({ code: 'INVALID_TIMESTAMP', message: '创建时间戳无效' })
  }

  if (!Number.isFinite(record.updatedAt) || record.updatedAt <= 0) {
    errors.push({ code: 'INVALID_TIMESTAMP', message: '更新时间戳无效' })
  }

  if (!['builtin', 'user', 'imported'].includes(record.source)) {
    errors.push({ code: 'INVALID_SOURCE', message: `无效的资产来源: ${record.source}` })
  }

  return errors
}

/**
 * 验证注册表整体结构完整性。
 *
 * @param registry 注册表
 * @returns 错误列表(空数组表示通过)
 */
export function validateRegistry(registry: AssetRegistry): AssetValidationError[] {
  const errors: AssetValidationError[] = []
  for (const record of registry.values()) {
    errors.push(...validateAssetRecord(record))
  }
  return errors
}

// ============================================================================
// 9. 兼容性辅助 — 旧 Asset 转换
// ============================================================================

/**
 * 旧版 Asset(src/assets/types.ts)转换为 AssetRecord。
 * 用于 Asset Genome 与 Phase 1-5 资产系统的兼容。
 *
 * @param legacy 旧版 Asset
 * @returns AssetRecord
 */
export function assetFromLegacy(legacy: {
  id: string
  name: string
  type: string
  url: string
  size: number
  createdAt: number
  thumbnail?: string
  mimeType: string
}): AssetRecord {
  // 旧 type 只有 'image' | 'texture',直接映射
  const kind: AssetKind = legacy.type === 'texture' ? 'texture' : 'image'
  return {
    id: legacy.id,
    kind,
    category: CATEGORY_OF_KIND[kind],
    name: legacy.name,
    source: 'imported',
    version: 1,
    tags: [],
    createdAt: legacy.createdAt,
    updatedAt: legacy.createdAt,
    size: legacy.size,
    thumbnail: legacy.thumbnail,
    payloadRef: legacy.url,
  }
}
