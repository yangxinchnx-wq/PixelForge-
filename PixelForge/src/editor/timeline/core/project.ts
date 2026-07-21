/**
 * Project(Step 31.1)— 项目模型。
 *
 * Project 是顶层容器,包含多个 Sequence + Asset 引用 + 元数据。
 *
 * 层级:
 *   Project
 *   └── Sequence[]
 *       └── Track[]
 *           └── Clip[]
 *               └── → Asset(引用)
 */

import type { Sequence } from './sequence'
import { createSequence } from './sequence'

// ============================================================================
// 1. 类型
// ============================================================================

/**
 * Asset — 媒体资源引用。
 *
 * Asset 是原始文件的引用(路径 + 元数据),不含像素数据。
 * Clip 通过 assetId 引用 Asset。
 *
 * @property id       唯一 ID
 * @property name     文件名
 * @property path     文件路径(blob URL / object URL / 远程 URL)
 * @property kind     资源类型(video / audio / image)
 * @property duration 时长(微秒,image 类型为 0 或单帧时长)
 * @property width    视频宽度(像素,audio 为 0)
 * @property height   视频高度(像素,audio 为 0)
 * @property fps      原始帧率(video 类型,其他为 0)
 */
export interface Asset {
  id: string
  name: string
  path: string
  kind: 'video' | 'audio' | 'image'
  duration: bigint
  width: number
  height: number
  fps: number
}

/**
 * Project — 顶层项目。
 *
 * @property id          唯一 ID
 * @property name        项目名称
 * @property sequences   序列列表(至少 1 个)
 * @property activeSequenceId 当前激活的 Sequence ID
 * @property assets      媒体资源列表
 * @property createdAt   创建时间
 * @property updatedAt   更新时间
 */
export interface Project {
  id: string
  name: string
  sequences: Sequence[]
  activeSequenceId: string
  assets: Asset[]
  createdAt: number
  updatedAt: number
}

// ============================================================================
// 2. 构造
// ============================================================================

let projectIdCounter = 0
let assetIdCounter = 0

/** 生成唯一 Project ID */
export function genProjectId(): string {
  projectIdCounter++
  return `proj_${projectIdCounter.toString(36)}`
}

/** 生成唯一 Asset ID */
export function genAssetId(): string {
  assetIdCounter++
  return `asset_${assetIdCounter.toString(36)}`
}

/**
 * 创建 Project(包含一个默认 Sequence)。
 *
 * @param name 项目名称
 */
export function createProject(name: string = '未命名项目'): Project {
  const now = Date.now()
  const seq = createSequence()
  return {
    id: genProjectId(),
    name,
    sequences: [seq],
    activeSequenceId: seq.id,
    assets: [],
    createdAt: now,
    updatedAt: now,
  }
}

// ============================================================================
// 3. Asset 管理
// ============================================================================

/**
 * 添加 Asset 到项目。
 */
export function addAsset(project: Project, asset: Asset): Project {
  return {
    ...project,
    assets: [...project.assets, asset],
    updatedAt: Date.now(),
  }
}

/**
 * 按 ID 查找 Asset。
 */
export function findAsset(project: Project, assetId: string): Asset | null {
  return project.assets.find((a) => a.id === assetId) ?? null
}

// ============================================================================
// 4. Sequence 管理
// ============================================================================

/**
 * 添加 Sequence 到项目。
 */
export function addSequence(project: Project, sequence: Sequence): Project {
  return {
    ...project,
    sequences: [...project.sequences, sequence],
    updatedAt: Date.now(),
  }
}

/**
 * 获取当前激活的 Sequence。
 */
export function getActiveSequence(project: Project): Sequence | null {
  return project.sequences.find((s) => s.id === project.activeSequenceId) ?? null
}

/**
 * 设置激活 Sequence。
 */
export function setActiveSequence(project: Project, sequenceId: string): Project {
  return {
    ...project,
    activeSequenceId: sequenceId,
    updatedAt: Date.now(),
  }
}

/**
 * 替换 Sequence(用于 Track / Clip 修改)。
 */
export function replaceSequence(project: Project, newSeq: Sequence): Project {
  return {
    ...project,
    sequences: project.sequences.map((s) => (s.id === newSeq.id ? newSeq : s)),
    updatedAt: Date.now(),
  }
}

// ============================================================================
// 5. Sequence CRUD(Step 31.6)
// ============================================================================

/**
 * 按 ID 查找 Sequence。
 */
export function findSequence(project: Project, sequenceId: string): Sequence | null {
  return project.sequences.find((s) => s.id === sequenceId) ?? null
}

/**
 * 重命名 Sequence。
 */
export function renameSequence(project: Project, sequenceId: string, name: string): Project {
  const trimmed = name.trim()
  if (!trimmed) return project
  return {
    ...project,
    sequences: project.sequences.map((s) =>
      s.id === sequenceId ? { ...s, name: trimmed, updatedAt: Date.now() } : s,
    ),
    updatedAt: Date.now(),
  }
}

/**
 * 删除 Sequence。
 *
 * 规则:
 * - 不允许删除最后一个 Sequence(至少保留 1 个)
 * - 若删除的是 activeSequence,自动切换到第一个剩余 Sequence
 * - 不清理其他 Sequence 中对该 Sequence 的嵌套引用(由调用方决定)
 *
 * @returns 新的 Project(若拒绝删除,返回原 Project)
 */
export function removeSequence(project: Project, sequenceId: string): Project {
  if (project.sequences.length <= 1) return project
  const exists = project.sequences.some((s) => s.id === sequenceId)
  if (!exists) return project

  const newSequences = project.sequences.filter((s) => s.id !== sequenceId)
  let newActiveId = project.activeSequenceId
  if (project.activeSequenceId === sequenceId) {
    newActiveId = newSequences[0].id
  }

  return {
    ...project,
    sequences: newSequences,
    activeSequenceId: newActiveId,
    updatedAt: Date.now(),
  }
}

/**
 * 修改 Sequence 属性(fps / width / height / duration)。
 *
 * @param project    原 Project
 * @param sequenceId 目标 Sequence ID
 * @param props      要修改的属性(部分字段)
 */
export function setSequenceProperties(
  project: Project,
  sequenceId: string,
  props: Partial<Pick<Sequence, 'fps' | 'width' | 'height' | 'duration'>>,
): Project {
  return {
    ...project,
    sequences: project.sequences.map((s) =>
      s.id === sequenceId ? { ...s, ...props, updatedAt: Date.now() } : s,
    ),
    updatedAt: Date.now(),
  }
}

/**
 * 统计 Project 中所有 Sequence 的 Clip 总数。
 */
export function getTotalClipCountInProject(project: Project): number {
  let count = 0
  for (const seq of project.sequences) {
    for (const track of seq.tracks) {
      count += track.clips.length
    }
  }
  return count
}
