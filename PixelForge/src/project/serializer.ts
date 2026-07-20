import type { RenderIR } from '@/compiler/ir/renderIR'
import type { HistoryEntry } from '@/stores/history'
import type { useRuntimeStore } from '@/stores/runtime'
import type { useTimelineStore } from '@/stores/timeline'

import {
  PROJECT_FILE_VERSION,
  type HistoryEntrySnapshot,
  type PixelForgeProject,
  type ProjectMetadata,
  type TimelineSnapshot,
} from './types'

type RuntimeStore = ReturnType<typeof useRuntimeStore>
type TimelineStore = ReturnType<typeof useTimelineStore>

/**
 * 项目序列化器 —— 把 runtime + timeline + history 的当前状态打包成 PixelForgeProject。
 *
 * 数据流:
 *   runtime.currentIr + timeline.tracks + history.undoStack
 *           ↓
 *   createProjectSnapshot(name, runtime, timeline, history?)
 *           ↓
 *   PixelForgeProject
 *           ↓
 *   serializeProject(project)  → JSON 字符串
 *           ↓
 *   fileSystem.saveProjectToFile()  → 下载 .pixelforge 文件
 *
 * 反向:
 *   fileSystem.loadProjectFromFile()
 *           ↓
 *   deserializeProject(json)  → PixelForgeProject
 *           ↓
 *   projectStore.openProject(project, runtime, timeline, history)  → 还原 store
 */

/**
 * 从当前 store 状态创建项目快照。
 *
 * @param name      项目名(用户输入或文件名)
 * @param runtime   runtime store 实例
 * @param timeline  timeline store 实例
 * @param history   可选,history store 实例(传入则保存 undo 栈)
 * @param baseOn    可选,基于已有 metadata 升级(保留 id / createdAt)
 */
export function createProjectSnapshot(
  name: string,
  runtime: RuntimeStore,
  timeline: TimelineStore,
  history?: { undoStack: HistoryEntry[] },
  baseOn?: ProjectMetadata,
): PixelForgeProject {
  const now = Date.now()
  const ir = cloneIr(runtime.currentIr)
  const timelineSnapshot = cloneTimeline(timeline)
  const historySnapshot = history ? cloneHistory(history.undoStack) : undefined

  const metadata: ProjectMetadata = baseOn
    ? {
        ...baseOn,
        name,
        updatedAt: now,
      }
    : {
        id: genId(),
        name,
        version: PROJECT_FILE_VERSION,
        createdAt: now,
        updatedAt: now,
        scenario: String(runtime.currentScenario),
        canvasSize: { ...ir.canvas },
      }

  return {
    metadata,
    renderIR: ir,
    timeline: timelineSnapshot,
    history: historySnapshot,
  }
}

/** 把项目序列化为 JSON 字符串(2 空格缩进,便于调试 / diff) */
export function serializeProject(project: PixelForgeProject): string {
  return JSON.stringify(project, null, 2)
}

/** 从 JSON 字符串反序列化项目(带基本结构校验) */
export function deserializeProject(json: string): PixelForgeProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    throw new Error(`项目文件 JSON 解析失败: ${(e as Error).message}`)
  }

  assertProjectShape(parsed)
  return parsed as PixelForgeProject
}

/** 校验反序列化结果是否符合项目文件 shape(只校验顶层字段存在性) */
function assertProjectShape(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    throw new Error('项目文件根必须是对象')
  }
  const obj = value as Record<string, unknown>
  if (typeof obj.metadata !== 'object' || obj.metadata === null) {
    throw new Error('项目文件缺少 metadata 字段')
  }
  if (typeof obj.renderIR !== 'object' || obj.renderIR === null) {
    throw new Error('项目文件缺少 renderIR 字段')
  }
  if (typeof obj.timeline !== 'object' || obj.timeline === null) {
    throw new Error('项目文件缺少 timeline 字段')
  }
  const meta = obj.metadata as Record<string, unknown>
  if (typeof meta.id !== 'string' || typeof meta.name !== 'string') {
    throw new Error('项目 metadata 缺少 id / name')
  }
}

// —— 内部 clone 辅助(避免直接 structuredClone 在某些环境不可用) ——

function cloneIr(ir: RenderIR): RenderIR {
  return JSON.parse(JSON.stringify(ir)) as RenderIR
}

function cloneTimeline(timeline: TimelineStore): TimelineSnapshot {
  const snapshot: TimelineSnapshot = {
    currentFrame: timeline.currentFrame,
    totalFrames: timeline.totalFrames,
    fps: timeline.fps,
    tracks: JSON.parse(JSON.stringify(timeline.tracks)) as TimelineSnapshot['tracks'],
  }
  return snapshot
}

function cloneHistory(stack: HistoryEntry[]): HistoryEntrySnapshot[] {
  // 序列化时剥离 lastTouched(运行时合并窗口字段,无需持久化)
  return stack.map((entry) => ({
    id: entry.id,
    description: entry.description,
    timestamp: entry.timestamp,
    targetId: entry.targetId,
    paramKey: entry.paramKey,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
  }))
}

/** 生成项目 ID(UUIDv4,浏览器 crypto 不可用时回退到时间戳随机) */
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `pf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
