/**
 * Project Export(Step 40.3)— 批量导出 + 项目清单 manifest。
 *
 * 职责:
 * - 把多个 PixelForgeProject 打包为带 manifest 的批量导出结构
 * - manifest.json 描述包内项目列表 + 校验和
 * - 提供"导出当前项目""导出多个项目"两种入口
 * - 浏览器模式:每个项目触发一次下载(不支持真实 ZIP,manifest 单独下载)
 * - Tauri 模式(预留):可写真实目录 + manifest.json
 *
 * 数据模型:
 *   ExportManifest:
 *     formatVersion    清单格式版本('1.0')
 *     exportedAt       导出时间戳(ms)
 *     projectCount     项目数量
 *     projects         项目元数据条目数组(不含内容)
 *       - id / name / version / fileName / fileSize / checksum
 *
 * 设计原则:
 * - 纯函数不可变操作
 * - 校验和使用 FNV-1a 32-bit(与 renderSignature 同算法,快速且足够)
 * - manifest 与项目文件分离(便于增量更新 + 部分恢复)
 * - 浏览器模式不依赖第三方 ZIP 库,逐个下载 + manifest 单独下载
 */
import type { PixelForgeProject, ProjectMetadata } from './types'
import { PROJECT_FILE_EXTENSION } from './types'
import { serializeProject } from './serializer'
import { validateProject } from './projectValidator'

// ============================================================================
// 类型定义
// ============================================================================

/** manifest 格式版本 */
export const MANIFEST_FORMAT_VERSION = '1.0'

/** manifest 中的项目条目(轻量元数据 + 文件信息) */
export interface ManifestProjectEntry {
  /** 项目 ID */
  id: string
  /** 项目显示名 */
  name: string
  /** 项目文件版本(对齐 metadata.version) */
  version: string
  /** 文件名(含扩展名,如 "Starry Night.pixelforge") */
  fileName: string
  /** 文件字节数(JSON 字符串长度) */
  fileSize: number
  /** FNV-1a 32-bit 校验和(8 位 hex) */
  checksum: string
  /** 项目创建时间戳(ms) */
  createdAt: number
  /** 项目最后更新时间戳(ms) */
  updatedAt: number
  /** 画布尺寸 */
  canvasSize: { width: number; height: number }
}

/** 导出清单(描述一次批量导出操作) */
export interface ExportManifest {
  /** 清单格式版本 */
  formatVersion: string
  /** 导出时间戳(ms) */
  exportedAt: number
  /** 项目数量 */
  projectCount: number
  /** 项目条目列表 */
  projects: ManifestProjectEntry[]
}

/** 单项目导出结果 */
export interface ProjectExportResult {
  /** 项目元数据(从 project.metadata 提取) */
  metadata: ProjectMetadata
  /** 序列化后的 JSON 字符串 */
  json: string
  /** 文件名(含扩展名) */
  fileName: string
  /** 文件字节数 */
  fileSize: number
  /** FNV-1a 32-bit 校验和 */
  checksum: string
  /** 校验结果(对 project 对象本身的结构校验) */
  validation: ReturnType<typeof validateProject>
}

/** 批量导出结果 */
export interface BatchExportResult {
  /** 清单 */
  manifest: ExportManifest
  /** 各项目的导出结果(按输入顺序) */
  items: ProjectExportResult[]
  /** 成功数量 */
  successCount: number
  /** 失败数量(校验失败的项目) */
  failureCount: number
}

// ============================================================================
// 单项目导出
// ============================================================================

/**
 * 准备单个项目导出(序列化 + 校验 + 生成元数据)。
 *
 * 注意:此函数不触发下载,只返回导出数据。下载由调用方决定
 * (浏览器模式调 triggerDownload,Tauri 模式调 fs.writeTextFile)。
 *
 * @param project  要导出的项目
 * @returns 导出结果(含 JSON / 文件名 / 校验和 / 校验结果)
 */
export function prepareProjectExport(project: PixelForgeProject): ProjectExportResult {
  const validation = validateProject(project)
  const json = serializeProject(project)
  const fileName = buildFileName(project.metadata.name)
  const fileSize = new Blob([json]).size
  const checksum = fnv1a32(json)

  return {
    metadata: { ...project.metadata },
    json,
    fileName,
    fileSize,
    checksum,
    validation,
  }
}

// ============================================================================
// 批量导出
// ============================================================================

/**
 * 准备批量导出(序列化 + 校验 + 生成 manifest)。
 *
 * @param projects  要导出的项目列表
 * @returns 批量导出结果(含 manifest + 各项目结果)
 */
export function prepareBatchExport(projects: PixelForgeProject[]): BatchExportResult {
  const items: ProjectExportResult[] = projects.map((p) => prepareProjectExport(p))
  const manifestProjects: ManifestProjectEntry[] = items.map((item) => ({
    id: item.metadata.id,
    name: item.metadata.name,
    version: item.metadata.version,
    fileName: item.fileName,
    fileSize: item.fileSize,
    checksum: item.checksum,
    createdAt: item.metadata.createdAt,
    updatedAt: item.metadata.updatedAt,
    canvasSize: { ...item.metadata.canvasSize },
  }))
  const manifest: ExportManifest = {
    formatVersion: MANIFEST_FORMAT_VERSION,
    exportedAt: Date.now(),
    projectCount: manifestProjects.length,
    projects: manifestProjects,
  }
  const successCount = items.filter((i) => i.validation.valid).length
  const failureCount = items.length - successCount
  return {
    manifest,
    items,
    successCount,
    failureCount,
  }
}

/**
 * 序列化 manifest 为 JSON 字符串。
 */
export function serializeManifest(manifest: ExportManifest): string {
  return JSON.stringify(manifest, null, 2)
}

/**
 * 反序列化 manifest(带容错)。
 *
 * - JSON 解析失败:返回 null
 * - 结构不符合:返回 null
 */
export function deserializeManifest(json: string): ExportManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.formatVersion !== 'string') return null
  if (typeof obj.exportedAt !== 'number') return null
  if (typeof obj.projectCount !== 'number') return null
  if (!Array.isArray(obj.projects)) return null
  // 不深入校验每个条目,只校验顶层
  return obj as unknown as ExportManifest
}

/**
 * 校验 manifest 完整性(项目数与 projectCount 一致)。
 */
export function validateManifest(manifest: ExportManifest): boolean {
  if (manifest.formatVersion !== MANIFEST_FORMAT_VERSION) return false
  if (manifest.projectCount !== manifest.projects.length) return false
  for (const p of manifest.projects) {
    if (typeof p.id !== 'string') return false
    if (typeof p.name !== 'string') return false
    if (typeof p.fileName !== 'string') return false
    if (typeof p.checksum !== 'string') return false
  }
  return true
}

// ============================================================================
// 浏览器下载触发
// ============================================================================

/**
 * 触发浏览器下载单个项目文件。
 *
 * @param json      项目 JSON 字符串
 * @param fileName  文件名(含扩展名)
 */
export function triggerDownload(json: string, fileName: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * 批量触发浏览器下载(逐个项目 + manifest)。
 *
 * 注意:浏览器会对连续的下载请求做拦截提示,因此每个下载间隔 200ms。
 *
 * @param result  批量导出结果
 * @param delayMs 每个下载之间的间隔(默认 200ms)
 */
export async function triggerBatchDownload(
  result: BatchExportResult,
  delayMs: number = 200,
): Promise<void> {
  for (const item of result.items) {
    triggerDownload(item.json, item.fileName)
    await sleep(delayMs)
  }
  // 最后下载 manifest
  const manifestJson = serializeManifest(result.manifest)
  triggerDownload(manifestJson, 'manifest.json')
}

// ============================================================================
// 拖拽导入辅助
// ============================================================================

/**
 * 从 DragEvent 提取 .pixelforge 文件列表。
 *
 * @param event 拖拽事件
 * @returns 文件列表(可能为空)
 */
export function extractDroppedFiles(event: DragEvent): File[] {
  if (!event.dataTransfer) return []
  const files = Array.from(event.dataTransfer.files)
  return files.filter((f) => f.name.endsWith(PROJECT_FILE_EXTENSION) || f.type === 'application/json')
}

/**
 * 检查拖拽事件是否包含可接受的项目文件。
 */
export function hasDroppableFiles(event: DragEvent): boolean {
  return extractDroppedFiles(event).length > 0
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成文件名(项目名 + 扩展名,清洗非法字符)。
 */
function buildFileName(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
  return safe.endsWith(PROJECT_FILE_EXTENSION)
    ? safe
    : safe + PROJECT_FILE_EXTENSION
}

/**
 * FNV-1a 32-bit 哈希(8 位 hex 字符串)。
 *
 * 与 renderSignature.ts 中的 fnv1a32 同算法,此处独立实现避免循环依赖。
 */
function fnv1a32(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * sleep 辅助(Promise + setTimeout)。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
