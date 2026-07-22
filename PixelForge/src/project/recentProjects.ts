/**
 * Recent Projects(Step 40.3)— 最近项目记录与最近文件列表。
 *
 * 职责:
 * - 维护最近打开的项目列表(LRU 淘汰,默认最多 10 条)
 * - 持久化到 localStorage(键名 'pixelforge:recent-projects')
 * - 提供增删改查:记录打开、移除单条、清空、按 id 查询
 * - 提供 Pinia Store(响应式触发)
 *
 * 数据模型:
 *   RecentProjectEntry:
 *     id          项目唯一 ID(对齐 ProjectMetadata.id)
 *     name        项目显示名
 *     filePath    文件路径(浏览器模式为空,Tauri 模式为绝对路径)
 *     fileSize    文件字节数(可选)
 *     openedAt    最近一次打开时间戳(ms)
 *     createdAt   项目创建时间戳(ms,从 metadata 带过来)
 *     canvasSize  画布尺寸(用于列表预览,无图可显示尺寸)
 *
 * 设计原则:
 * - 纯函数不可变操作(返回新数组,不修改入参)
 * - 工厂 + CRUD + 查询分离,便于测试
 * - localStorage 存 JSON 字符串,读写容错(损坏数据自动清空)
 * - LRU 淘汰:同 id 重复打开会更新 openedAt 并移到列表顶部,不重复加入
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

// ============================================================================
// 类型定义
// ============================================================================

/** 最近项目条目(轻量元数据,不含 RenderIR / Timeline 等内容) */
export interface RecentProjectEntry {
  /** 项目唯一 ID(对齐 ProjectMetadata.id) */
  id: string
  /** 项目显示名 */
  name: string
  /** 文件路径(浏览器模式为空字符串,Tauri 模式为绝对路径) */
  filePath: string
  /** 文件字节数(可选,浏览器模式可能拿不到) */
  fileSize?: number
  /** 最近一次打开时间戳(ms) */
  openedAt: number
  /** 项目创建时间戳(ms,从 metadata 带过来) */
  createdAt: number
  /** 画布尺寸(用于列表预览) */
  canvasSize: { width: number; height: number }
}

/** LRU 淘汰上限 */
export const MAX_RECENT_PROJECTS = 10

/** localStorage 键名 */
export const RECENT_PROJECTS_STORAGE_KEY = 'pixelforge:recent-projects'

// ============================================================================
// 纯函数:CRUD + 查询
// ============================================================================

/**
 * 创建空最近项目列表(工厂)。
 */
export function createRecentList(): RecentProjectEntry[] {
  return []
}

/**
 * 添加或更新最近项目(LRU):
 * - 若 id 已存在:更新条目并移到列表顶部
 * - 若 id 不存在:插入到列表顶部
 * - 超过 maxItems 时淘汰列表末尾的最老条目
 *
 * @param list    当前列表(不可变,返回新数组)
 * @param entry   要添加/更新的条目
 * @param maxItems 最大长度(默认 10)
 * @returns 新列表
 */
export function addRecent(
  list: RecentProjectEntry[],
  entry: RecentProjectEntry,
  maxItems: number = MAX_RECENT_PROJECTS,
): RecentProjectEntry[] {
  const filtered = list.filter((item) => item.id !== entry.id)
  const next = [entry, ...filtered]
  return next.slice(0, maxItems)
}

/**
 * 移除指定 id 的最近项目。
 *
 * @param list 当前列表
 * @param id   要移除的项目 ID
 * @returns 新列表
 */
export function removeRecent(
  list: RecentProjectEntry[],
  id: string,
): RecentProjectEntry[] {
  return list.filter((item) => item.id !== id)
}

/**
 * 清空所有最近项目。
 */
export function clearRecent(): RecentProjectEntry[] {
  return []
}

/**
 * 按 id 查询最近项目。
 *
 * @returns 找到的条目,未找到返回 undefined
 */
export function findRecent(
  list: RecentProjectEntry[],
  id: string,
): RecentProjectEntry | undefined {
  return list.find((item) => item.id === id)
}

/**
 * 按项目名搜索(模糊匹配,大小写不敏感)。
 */
export function searchRecent(
  list: RecentProjectEntry[],
  query: string,
): RecentProjectEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return [...list]
  return list.filter((item) => item.name.toLowerCase().includes(q))
}

/**
 * 按打开时间排序(最近的在前,默认 list 已是 LRU 顺序,此函数用于校验/重排)。
 */
export function sortByOpenedAt(
  list: RecentProjectEntry[],
): RecentProjectEntry[] {
  return [...list].sort((a, b) => b.openedAt - a.openedAt)
}

// ============================================================================
// 持久化(localStorage)
// ============================================================================

/**
 * 序列化最近项目列表为 JSON 字符串。
 */
export function serializeRecentList(list: RecentProjectEntry[]): string {
  return JSON.stringify(list, null, 2)
}

/**
 * 从 JSON 字符串反序列化最近项目列表(带容错)。
 *
 * - JSON 解析失败:返回空列表
 * - 结构不符合:返回空列表
 * - 单条条目字段缺失:跳过该条目
 */
export function deserializeRecentList(json: string): RecentProjectEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const result: RecentProjectEntry[] = []
  for (const item of parsed) {
    const entry = sanitizeEntry(item)
    if (entry) result.push(entry)
  }
  return result
}

/**
 * 校验并清洗单条条目(跳过字段缺失或类型错误的条目)。
 */
function sanitizeEntry(value: unknown): RecentProjectEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string') return null
  if (typeof obj.name !== 'string') return null
  if (typeof obj.filePath !== 'string') return null
  if (typeof obj.openedAt !== 'number') return null
  if (typeof obj.createdAt !== 'number') return null
  const canvasSize = obj.canvasSize as Record<string, unknown> | undefined
  if (!canvasSize || typeof canvasSize.width !== 'number' || typeof canvasSize.height !== 'number') {
    return null
  }
  return {
    id: obj.id,
    name: obj.name,
    filePath: obj.filePath,
    fileSize: typeof obj.fileSize === 'number' ? obj.fileSize : undefined,
    openedAt: obj.openedAt,
    createdAt: obj.createdAt,
    canvasSize: { width: canvasSize.width, height: canvasSize.height },
  }
}

/**
 * 从 localStorage 加载最近项目列表。
 *
 * - 键不存在 / 值为空:返回空列表
 * - 读取异常:返回空列表
 */
export function loadRecentFromStorage(
  key: string = RECENT_PROJECTS_STORAGE_KEY,
): RecentProjectEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const json = localStorage.getItem(key)
    if (!json) return []
    return deserializeRecentList(json)
  } catch {
    return []
  }
}

/**
 * 保存最近项目列表到 localStorage。
 *
 * @returns 是否保存成功
 */
export function saveRecentToStorage(
  list: RecentProjectEntry[],
  key: string = RECENT_PROJECTS_STORAGE_KEY,
): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    const json = serializeRecentList(list)
    localStorage.setItem(key, json)
    return true
  } catch {
    return false
  }
}

/**
 * 清空 localStorage 中的最近项目记录。
 */
export function clearRecentStorage(
  key: string = RECENT_PROJECTS_STORAGE_KEY,
): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(key)
  } catch {
    // 忽略
  }
}

// ============================================================================
// Pinia Store
// ============================================================================

/**
 * 最近项目 Pinia Store。
 *
 * 数据流:
 *   App 启动 → store.init() → loadRecentFromStorage
 *   打开项目 → store.recordOpen(entry) → addRecent + saveRecentToStorage
 *   用户删除 → store.removeEntry(id) → removeRecent + saveRecentToStorage
 *   用户清空 → store.clearAll() → clearRecent + clearRecentStorage
 */
export const useRecentProjectsStore = defineStore('recent-projects', () => {
  const list = ref<RecentProjectEntry[]>([])

  /** 列表长度 */
  const count = computed(() => list.value.length)
  /** 是否为空 */
  const isEmpty = computed(() => list.value.length === 0)
  /** 第一个(最近打开的)条目 */
  const latest = computed(() => list.value[0] ?? null)

  /**
   * 初始化:从 localStorage 加载(应在 App.vue setup 中调用一次)。
   */
  function init(): void {
    list.value = loadRecentFromStorage()
  }

  /**
   * 记录项目打开(LRU 更新 + 持久化)。
   */
  function recordOpen(entry: RecentProjectEntry): void {
    list.value = addRecent(list.value, entry)
    saveRecentToStorage(list.value)
  }

  /**
   * 移除单条记录。
   */
  function removeEntry(id: string): void {
    list.value = removeRecent(list.value, id)
    saveRecentToStorage(list.value)
  }

  /**
   * 清空所有记录。
   */
  function clearAll(): void {
    list.value = clearRecent()
    clearRecentStorage()
  }

  /**
   * 按 id 查询。
   */
  function findById(id: string): RecentProjectEntry | undefined {
    return findRecent(list.value, id)
  }

  /**
   * 按项目名搜索。
   */
  function search(query: string): RecentProjectEntry[] {
    return searchRecent(list.value, query)
  }

  return {
    list,
    count,
    isEmpty,
    latest,
    init,
    recordOpen,
    removeEntry,
    clearAll,
    findById,
    search,
  }
})
