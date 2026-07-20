import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { RenderIR } from '@/compiler/ir/renderIR'
import type { useRuntimeStore } from '@/stores/runtime'
import type { useTimelineStore } from '@/stores/timeline'
import type { useHistoryStore } from '@/stores/history'

import { createProjectSnapshot } from './serializer'
import {
  clearLocalStorageAutosave,
  loadProjectFromLocalStorage,
  saveProjectToLocalStorage,
} from './fileSystem'
import type { PixelForgeProject, ProjectMetadata, TimelineSnapshot } from './types'

type RuntimeStore = ReturnType<typeof useRuntimeStore>
type TimelineStore = ReturnType<typeof useTimelineStore>
type HistoryStore = ReturnType<typeof useHistoryStore>

const AUTOSAVE_KEY = 'pixelforge:autosave'

/**
 * 项目 store —— 管理"当前打开的工程文件"。
 *
 * 职责:
 * - 维护 current project metadata(项目名 / id / 时间戳)
 * - 提供 openProject / newProject / saveCurrent 等动作
 * - 协调 runtime / timeline / history store 之间的状态恢复
 *
 * 不职责:
 * - 文件 IO(由 fileSystem 模块负责)
 * - 自动保存定时器(由 autosave 模块负责)
 *
 * 数据流:
 *   newProject(name)           → 创建空 metadata,标记 dirty
 *   openProject(project)       → 还原 runtime.currentIr / timeline / history
 *   saveCurrent()              → createProjectSnapshot + saveProjectToFile
 *   markDirty()                → 编辑入口调用,标记需保存
 *   loadAutosave()             → 启动时尝试从 localStorage 恢复
 */
export const useProjectStore = defineStore('project', () => {
  /** 当前项目的 metadata(无项目时为 null) */
  const current = ref<ProjectMetadata | null>(null)
  /** 是否有未保存的修改 */
  const dirty = ref(false)
  /** 最近一次自动保存时间戳(用于 UI 显示) */
  const lastAutosaveAt = ref<number | null>(null)
  /** 最近一次错误信息(打开 / 保存失败时) */
  const lastError = ref<string | null>(null)

  const hasProject = computed(() => current.value !== null)
  const projectName = computed(() => current.value?.name ?? '未命名项目')
  const projectId = computed(() => current.value?.id ?? null)

  /**
   * 新建项目(不立即写入 runtime,需调用方配合 setScenario / 重置 IR)。
   */
  function newProject(name: string): ProjectMetadata {
    const now = Date.now()
    const meta: ProjectMetadata = {
      id: genId(),
      name: name || '未命名项目',
      version: '0.1.0',
      createdAt: now,
      updatedAt: now,
      scenario: 'blend_demo',
      canvasSize: { width: 1024, height: 768 },
    }
    current.value = meta
    dirty.value = false
    lastError.value = null
    clearLocalStorageAutosave(AUTOSAVE_KEY)
    return meta
  }

  /**
   * 打开已有项目:还原 runtime / timeline / history 三个 store 的状态。
   *
   * @param project  反序列化后的 PixelForgeProject
   * @param runtime  runtime store 实例
   * @param timeline timeline store 实例
   * @param history  history store 实例(可选)
   */
  function openProject(
    project: PixelForgeProject,
    runtime: RuntimeStore,
    timeline: TimelineStore,
    history?: HistoryStore,
  ): void {
    try {
      // 1. 还原 runtime.currentIR(直接替换,不走 setScenario 避免触发 demoIR 重生成)
      runtime.currentIr = cloneIr(project.renderIR)
      void runtime.renderCurrentIR()

      // 2. 还原 timeline
      applyTimelineSnapshot(timeline, project.timeline)

      // 3. 还原 history(若有快照)
      if (history && project.history) {
        // 直接替换 undoStack(走 store 内部 ref,不走 pushEntry 避免合并)
        // 重建 lastTouched 字段(运行时合并窗口用,序列化时不存)
        const restored = project.history.map((entry) => ({
          ...entry,
          lastTouched: entry.timestamp,
        }))
        history.undoStack.splice(0, history.undoStack.length, ...restored)
        history.redoStack.splice(0, history.redoStack.length)
      } else if (history) {
        // 无 history 快照,清空(老历史不适用)
        history.clear()
      }

      // 4. 更新 metadata
      current.value = { ...project.metadata }
      dirty.value = false
      lastError.value = null
    } catch (e) {
      lastError.value = `打开项目失败: ${(e as Error).message}`
      throw e
    }
  }

  /**
   * 保存当前项目(返回项目快照,由调用方决定是 saveProjectToFile 还是 autosave)。
   */
  function snapshotCurrent(
    runtime: RuntimeStore,
    timeline: TimelineStore,
    history?: HistoryStore,
  ): PixelForgeProject | null {
    if (!current.value) return null
    const project = createProjectSnapshot(
      current.value.name,
      runtime,
      timeline,
      history,
      current.value,
    )
    return project
  }

  /**
   * 自动保存到 localStorage(轻量,失败不抛错)。
   */
  function autosave(
    runtime: RuntimeStore,
    timeline: TimelineStore,
    history?: HistoryStore,
  ): boolean {
    if (!current.value) return false
    const project = snapshotCurrent(runtime, timeline, history)
    if (!project) return false
    const ok = saveProjectToLocalStorage(project, AUTOSAVE_KEY)
    if (ok) {
      lastAutosaveAt.value = Date.now()
      dirty.value = false
    }
    return ok
  }

  /**
   * 启动时尝试从 localStorage 恢复自动保存的项目。
   *
   * @returns 是否有可恢复的自动保存
   */
  function loadAutosave(): PixelForgeProject | null {
    return loadProjectFromLocalStorage(AUTOSAVE_KEY)
  }

  /** 标记当前项目有未保存的修改(编辑入口调用) */
  function markDirty(): void {
    if (current.value) dirty.value = true
  }

  /** 关闭当前项目(不保存) */
  function closeProject(): void {
    current.value = null
    dirty.value = false
    lastAutosaveAt.value = null
    lastError.value = null
    clearLocalStorageAutosave(AUTOSAVE_KEY)
  }

  return {
    current,
    dirty,
    lastAutosaveAt,
    lastError,
    hasProject,
    projectName,
    projectId,
    newProject,
    openProject,
    snapshotCurrent,
    autosave,
    loadAutosave,
    markDirty,
    closeProject,
  }
})

// —— 内部辅助 ——

function cloneIr(ir: RenderIR): RenderIR {
  return JSON.parse(JSON.stringify(ir)) as RenderIR
}

function applyTimelineSnapshot(timeline: TimelineStore, snapshot: TimelineSnapshot): void {
  timeline.totalFrames = snapshot.totalFrames
  timeline.fps = snapshot.fps
  timeline.seek(snapshot.currentFrame)
  // 替换 tracks(用 splice 保持响应式)
  timeline.tracks.splice(0, timeline.tracks.length, ...snapshot.tracks)
}

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `pf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
