import type { RenderIR } from '@/compiler/ir/renderIR'
import type { ParameterTrack } from '@/editor/timeline/types'

/**
 * PixelForge 项目文件类型定义。
 *
 * 项目文件结构(类 Photoshop .psd / AE .aep):
 *   MyStar.pixelforge   (JSON 单文件,后续可改 zip 容器分离 assets)
 *     {
 *       metadata: { id, name, version, createdAt, updatedAt, scenario },
 *       renderIR: { canvas, layers, regions, effects, compileHints },
 *       timeline: { currentFrame, totalFrames, fps, tracks },
 *       history:  HistoryEntry[]   // 可选,便于跨会话恢复 undo 栈
 *     }
 *
 * 设计原则:
 * - metadata 与内容分离(便于增量保存 / 自动保存)
 * - renderIR / timeline 字段直接复用对应 store 的 state shape
 * - history 是可选的(自动保存可省略以减小文件体积)
 */

/** 项目元数据(独立于渲染内容,便于列表展示) */
export interface ProjectMetadata {
  /** 项目唯一 ID(UUIDv4) */
  id: string
  /** 项目显示名(如 "Starry Night") */
  name: string
  /** 文件格式版本(用于未来向后兼容) */
  version: string
  /** 创建时间戳(ms) */
  createdAt: number
  /** 最后更新时间戳(ms) */
  updatedAt: number
  /** 创建时基于的 demo 场景(用于溯源,如 'blend_demo') */
  scenario: string
  /** 画布尺寸(冗余存一份,便于列表预览不读 renderIR) */
  canvasSize: { width: number; height: number }
}

/** 时间轴快照(与 timeline store state shape 一致) */
export interface TimelineSnapshot {
  currentFrame: number
  totalFrames: number
  fps: number
  tracks: ParameterTrack[]
}

/** 历史栈条目快照(序列化用,去掉 lastTouched 等运行时字段) */
export interface HistoryEntrySnapshot {
  id: string
  description: string
  timestamp: number
  targetId: string
  paramKey: string
  oldValue: unknown
  newValue: unknown
}

/** 完整项目文件 */
export interface PixelForgeProject {
  metadata: ProjectMetadata
  renderIR: RenderIR
  timeline: TimelineSnapshot
  /** 可选:历史栈快照(用于跨会话恢复 undo/redo) */
  history?: HistoryEntrySnapshot[]
}

/** 当前文件格式版本 */
export const PROJECT_FILE_VERSION = '0.1.0'

/** 项目文件扩展名 */
export const PROJECT_FILE_EXTENSION = '.pixelforge'

/** 默认自动保存间隔(ms) */
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 10_000
