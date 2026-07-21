/**
 * ProTimelineStore(Step 31.1)— 专业时间轴 Pinia Store。
 *
 * 职责:
 * - 持有 Project / Sequence 状态(Vue 响应式)
 * - 集成 CommandHistory(undo/redo)
 * - 集成 CachedTimelineResolver(活跃 Clip 查询)
 * - 播放头控制(currentTime / playing / seek)
 * - 提供 Command 执行入口(通过 history)
 *
 * 与 stores/timeline.ts 的区别:
 * - stores/timeline.ts: frame-based 简单时间线(用于 AI 生成预览)
 * - 本 store: bigint 微秒精度专业时间线(用于视频编辑)
 *
 * 用法:
 *   const store = useProTimelineStore()
 *   store.init(createProject('我的项目'))
 *   store.addClip(trackId, clip)
 *   store.undo()
 *   const activeClips = store.resolveActiveClips()
 */

import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'

import type { Project } from '../core/project'
import { createProject, getActiveSequence, replaceSequence } from '../core/project'
import type { Sequence } from '../core/sequence'
import type { Clip } from '../core/clip'
import { TrackType } from '../core/track'
import type { Time } from '../core/time'
import { ZERO, seconds, clamp, timeToFrame, frames } from '../core/time'
import { CachedTimelineResolver, type TimelineResolveResult } from '../resolver/timelineResolver'
import { CommandHistory } from '../operation/history'
import type { Command, MutableSequenceState, MutableProjectState } from '../operation/command'
import {
  AddClipCommand,
  DeleteClipCommand,
  MoveClipCommand,
  TrimClipCommand,
  CutClipCommand,
  RippleDeleteCommand,
} from '../operation/commands'
import {
  ReorderTrackCommand,
  ResizeTrackCommand,
  SetTrackColorCommand,
  RenameTrackCommand,
  DeleteTrackCommand,
  DuplicateTrackCommand,
} from '../operation/trackCommands'
import {
  MultiDeleteClipCommand,
  MultiMoveClipCommand,
  PasteClipCommand,
  DuplicateClipCommand,
  GroupClipsCommand,
  UngroupClipsCommand,
  UpdateClipPropertyCommand,
  type ClipboardEntry,
} from '../operation/multiClipCommands'
import {
  AddSequenceCommand,
  RemoveSequenceCommand,
  DuplicateSequenceCommand,
  RenameSequenceCommand,
  SwitchSequenceCommand,
  SetSequencePropertiesCommand,
} from '../operation/sequenceCommands'
import {
  MoveClipCrossSequenceCommand,
  CopyClipCrossSequenceCommand,
  findCompatibleTrack,
  clampClipStartToSequence,
  type MoveClipCrossSequenceParams,
  type CopyClipCrossSequenceParams,
} from '../operation/crossSequenceCommands'
import {
  alignPlayheadOnSwitch,
  snapToFrameBoundary,
  type PlayheadAlignMode,
} from '../resolver/sequenceAlignment'
import {
  SequenceBreadcrumb,
  type BreadcrumbEntry,
} from '../resolver/sequenceBreadcrumb'
import {
  instantiateTemplate,
  serializeToTemplate,
  addCustomTemplate,
  removeCustomTemplate,
  getAllTemplates,
  findTemplateById,
  validateTemplate,
  type SequenceTemplate,
} from '../core/sequenceTemplate'
import {
  NestedSequenceResolver,
  resolveActiveSequenceClips,
  type ResolvedClip,
} from '../resolver/nestedSequenceResolver'
import {
  copyToClipboard,
  isClipboardEmpty,
  getClipboardSize,
  clearClipboard,
} from '../operation/clipboard'
import type { ClipTransform } from '../core/clip'

// ============================================================================
// 1. Store 定义
// ============================================================================

export const useProTimelineStore = defineStore('proTimeline', () => {
  // —— 状态 ——
  const project = ref<Project>(createProject())
  const currentTime = ref<Time>(ZERO)
  const playing = ref(false)
  const playbackRate = ref(1)

  // Resolver(shallowRef 避免深层响应式开销)
  const resolver = shallowRef<CachedTimelineResolver | null>(null)

  // CommandHistory(非响应式)
  let history: CommandHistory = new CommandHistory()
  const historyVersion = ref(0) // 用于触发响应式更新

  // —— MutableSequenceState(供 Command 使用) ——
  const mutableState: MutableSequenceState = {
    get sequence(): Sequence {
      const seq = getActiveSequence(project.value)
      if (!seq) throw new Error('No active sequence')
      return seq
    },
    set sequence(seq: Sequence) {
      project.value = replaceSequence(project.value, seq)
    },
    notify: () => {
      // 触发 resolver 重建
      const seq = getActiveSequence(project.value)
      if (seq) {
        if (resolver.value) {
          resolver.value.setSequence(seq)
        } else {
          resolver.value = new CachedTimelineResolver(seq)
        }
      }
      // 触发响应式更新
      historyVersion.value++
    },
  }

  // —— MutableProjectState(供 Sequence 级 Command 使用,Step 31.6)——
  const mutableProjectState: MutableProjectState = {
    get project(): Project {
      return project.value
    },
    set project(proj: Project) {
      project.value = proj
    },
    notify: () => {
      // 触发 resolver 重建(活跃 Sequence 可能已变)
      const seq = getActiveSequence(project.value)
      if (seq) {
        if (resolver.value) {
          resolver.value.setSequence(seq)
        } else {
          resolver.value = new CachedTimelineResolver(seq)
        }
      }
      // Step 31.7: 切换 Sequence 时按 playheadAlignMode 对齐播放头
      // (SwitchSequenceCommand 在 execute 前会调用 notify 前,activeSequenceId 已更新)
      // 这里检测是否发生切换:比对 currentTime 与新 Sequence 时长
      // 若 currentTime 超出新 Sequence 时长,钳制;若模式为 restart,重置
      if (playheadAlignMode.value === 'restart') {
        currentTime.value = ZERO
      } else if (seq) {
        // preserve / snap-to-frame
        const targetDuration = seq.duration
        if (currentTime.value > targetDuration) {
          currentTime.value = targetDuration
        }
        if (playheadAlignMode.value === 'snap-to-frame') {
          currentTime.value = snapToFrameBoundary(currentTime.value, seq)
        }
      }
      historyVersion.value++
    },
  }

  // —— 播放头对齐模式(Step 31.7)——
  const playheadAlignMode = ref<PlayheadAlignMode>('preserve')

  // —— 嵌套 Sequence 编辑历史栈(Step 31.8)——
  const breadcrumb = new SequenceBreadcrumb()
  /** 面包屑版本(触发响应式更新) */
  const breadcrumbVersion = ref(0)
  /** 面包屑 computed */
  const breadcrumbEntries = computed<BreadcrumbEntry[]>(() => {
    breadcrumbVersion.value // 依赖响应式
    return breadcrumb.entries
  })
  const isNestedEditing = computed(() => {
    breadcrumbVersion.value // 依赖响应式,确保 breadcrumb 变化时重新计算
    return breadcrumb.isNested
  })
  const nestedDepth = computed(() => {
    breadcrumbVersion.value
    return breadcrumb.depth
  })

  // —— 计算属性 ——

  /** 当前激活的 Sequence */
  const activeSequence = computed(() => getActiveSequence(project.value))

  /** 当前激活的 Sequence ID(Step 31.6) */
  const activeSequenceId = computed(() => project.value.activeSequenceId)

  /** 所有 Sequence 列表(Step 31.6) */
  const sequences = computed(() => project.value.sequences)

  /** Sequence 数量(Step 31.6) */
  const sequenceCount = computed(() => project.value.sequences.length)

  /** Sequence 时长 */
  const duration = computed(() => {
    const seq = activeSequence.value
    return seq ? seq.duration : ZERO
  })

  /** 帧率 */
  const fps = computed(() => activeSequence.value?.fps ?? 30)

  /** 当前帧号 */
  const currentFrame = computed(() => timeToFrame(currentTime.value, fps.value))

  /** 总帧数 */
  const totalFrames = computed(() => timeToFrame(duration.value, fps.value))

  /** 是否可撤销 */
  const canUndo = computed(() => history.canUndo())

  /** 是否可重做 */
  const canRedo = computed(() => history.canRedo())

  /** undo 栈大小 */
  const undoCount = computed(() => history.undoCount)

  /** redo 栈大小 */
  const redoCount = computed(() => history.redoCount)

  // —— Actions ——

  /** 初始化 / 加载项目 */
  function init(proj: Project): void {
    project.value = proj
    currentTime.value = ZERO
    playing.value = false
    history.clear()
    const seq = getActiveSequence(proj)
    resolver.value = seq ? new CachedTimelineResolver(seq) : null
    // Step 31.8: 同步面包屑
    breadcrumb.syncFromProject(proj)
    breadcrumbVersion.value++
  }

  /** 重置为默认项目 */
  function reset(): void {
    init(createProject('未命名项目'))
  }

  /** 执行命令(通过 history) */
  function executeCommand(cmd: Command): void {
    history.execute(cmd)
    historyVersion.value++
  }

  /** 撤销 */
  function undo(): void {
    history.undo()
    historyVersion.value++
  }

  /** 重做 */
  function redo(): void {
    history.redo()
    historyVersion.value++
  }

  // —— Clip 操作(便捷封装) ——

  /** 添加 Clip */
  function addClip(trackId: string, clip: Clip): void {
    executeCommand(new AddClipCommand(mutableState, trackId, clip))
  }

  /** 删除 Clip */
  function deleteClip(trackId: string, clipId: string): void {
    executeCommand(new DeleteClipCommand(mutableState, trackId, clipId))
  }

  /** 移动 Clip */
  function moveClip(trackId: string, clipId: string, newStart: Time): void {
    executeCommand(new MoveClipCommand(mutableState, trackId, clipId, newStart))
  }

  /** 修剪 Clip */
  function trimClip(trackId: string, clipId: string, side: 'left' | 'right', delta: Time): void {
    executeCommand(new TrimClipCommand(mutableState, trackId, clipId, side, delta))
  }

  /** 切割 Clip(在当前播放头位置或指定时间) */
  function cutClip(trackId: string, clipId: string, cutTime?: Time): void {
    executeCommand(new CutClipCommand(mutableState, trackId, clipId, cutTime ?? currentTime.value))
  }

  /** 涟漪删除 */
  function rippleDelete(trackId: string, clipId: string): void {
    executeCommand(new RippleDeleteCommand(mutableState, trackId, clipId))
  }

  // —— Track 操作(Step 31.3 多轨道编辑增强) ——

  /** 拖拽改变轨道顺序(把 fromId 轨道移动到 toId 轨道之前) */
  function reorderTrack(fromId: string, toId: string): void {
    executeCommand(new ReorderTrackCommand(mutableState, fromId, toId))
  }

  /** 调整轨道高度 */
  function resizeTrack(trackId: string, newHeight: number): void {
    executeCommand(new ResizeTrackCommand(mutableState, trackId, newHeight))
  }

  /** 设置轨道颜色 */
  function setTrackColor(trackId: string, color: string): void {
    executeCommand(new SetTrackColorCommand(mutableState, trackId, color))
  }

  /** 重命名轨道 */
  function renameTrack(trackId: string, newName: string): void {
    executeCommand(new RenameTrackCommand(mutableState, trackId, newName))
  }

  /** 删除整条轨道(含其上所有 Clip) */
  function deleteTrack(trackId: string): void {
    executeCommand(new DeleteTrackCommand(mutableState, trackId))
  }

  /** 复制轨道(深拷贝,新轨道插入到原轨道之后) */
  function duplicateTrack(trackId: string): void {
    executeCommand(new DuplicateTrackCommand(mutableState, trackId))
  }

  // —— Clip 多选 / 复制粘贴 / 群组 / 属性(Step 31.4) ——

  /** 当前剪贴板快照(供 PasteClipCommand 使用) */
  let clipboardSnapshot: ClipboardEntry[] = []

  /** 复制 clips 到剪贴板 */
  function copyClips(clips: { clip: import('../core/clip').Clip; trackId: string }[]): void {
    const cs = clips.map((c) => c.clip)
    const tids = clips.map((c) => c.trackId)
    copyToClipboard(cs, tids)
    // 保存快照供 PasteClipCommand 使用
    if (cs.length === 0) {
      clipboardSnapshot = []
      return
    }
    // 复制快照(与 clipboard 模块保持一致)
    let firstStart = cs[0].timelineStart
    for (const c of cs) if (c.timelineStart < firstStart) firstStart = c.timelineStart
    clipboardSnapshot = cs.map((c, i) => ({
      clipSnapshot: { ...c, transform: { ...c.transform }, effects: [...c.effects] },
      sourceTrackId: tids[i],
      timelineOffsetFromFirst: c.timelineStart - firstStart,
    }))
  }

  /** 剪贴板是否为空 */
  function isClipClipboardEmpty(): boolean {
    return isClipboardEmpty()
  }

  /** 获取剪贴板大小 */
  function getClipClipboardSize(): number {
    return getClipboardSize()
  }

  /** 清空剪贴板 */
  function clearClipClipboard(): void {
    clearClipboard()
    clipboardSnapshot = []
  }

  /**
   * 粘贴剪贴板内容到指定时间。
   *
   * @param pasteAt 粘贴起始时间(通常为播放头位置)
   * @returns 新创建的 clip ID 数组(用于 UI 高亮)
   */
  function pasteClips(pasteAt: import('../core/time').Time): string[] {
    if (clipboardSnapshot.length === 0) return []
    const cmd = new PasteClipCommand(mutableState, pasteAt, clipboardSnapshot)
    executeCommand(cmd)
    // 返回新创建的 clip ID(PasteClipCommand 内部已记录)
    // 简化:粘贴后重新查找刚添加的 clip(末尾几个)
    // 这里直接访问 cmd.createdClips
    return cmd.createdClips.map((c) => c.clipId)
  }

  /** 批量删除 clip(多选) */
  function deleteClips(clipIds: string[]): void {
    if (clipIds.length === 0) return
    executeCommand(new MultiDeleteClipCommand(mutableState, clipIds))
  }

  /**
   * 批量平移 clip(多选拖拽)。
   *
   * @param clipIds  要移动的 clip ID 数组
   * @param deltaUs  位移(微秒,正=向右,负=向左)
   */
  function moveClips(clipIds: string[], deltaUs: import('../core/time').Time): void {
    if (clipIds.length === 0) return
    executeCommand(new MultiMoveClipCommand(mutableState, clipIds, deltaUs))
  }

  /** 原位复制 clip(粘贴到原 clip 之后,新 ID) */
  function duplicateClips(clipIds: string[]): void {
    if (clipIds.length === 0) return
    executeCommand(new DuplicateClipCommand(mutableState, clipIds))
  }

  /** 群组化多个 clip(同一 groupId) */
  function groupClips(clipIds: string[]): string | null {
    if (clipIds.length < 2) return null
    const cmd = new GroupClipsCommand(mutableState, clipIds)
    executeCommand(cmd)
    return cmd.getGroupId()
  }

  /** 解组(按 groupId 清除群组关系) */
  function ungroupClips(groupId: string): void {
    if (!groupId) return
    executeCommand(new UngroupClipsCommand(mutableState, groupId))
  }

  /** 修改 clip 属性(用于 Inspector 面板) */
  function updateClipProperty(
    clipId: string,
    propertyName: 'label' | 'speed' | 'volume' | 'enabled' | 'locked' | 'transform',
    newValue: string | number | boolean | Partial<ClipTransform>,
  ): void {
    executeCommand(new UpdateClipPropertyCommand(mutableState, clipId, propertyName, newValue))
  }

  /** 查找 clip 所属 trackId */
  function findClipTrackId(clipId: string): string | null {
    const seq = project.value.sequences.find((s) => s.id === project.value.activeSequenceId)
    if (!seq) return null
    for (const track of seq.tracks) {
      if (track.clips.some((c) => c.id === clipId)) return track.id
    }
    return null
  }

  /** 根据 clipId 数组获取 (clip, trackId) 数组 */
  function getClipsByIds(clipIds: string[]): { clip: import('../core/clip').Clip; trackId: string }[] {
    const seq = project.value.sequences.find((s) => s.id === project.value.activeSequenceId)
    if (!seq) return []
    const result: { clip: import('../core/clip').Clip; trackId: string }[] = []
    for (const track of seq.tracks) {
      for (const clip of track.clips) {
        if (clipIds.includes(clip.id)) {
          result.push({ clip, trackId: track.id })
        }
      }
    }
    return result
  }

  // —— 播放控制 ——

  /** 播放 */
  function play(): void {
    playing.value = true
  }

  /** 暂停 */
  function pause(): void {
    playing.value = false
  }

  /** 切换播放/暂停 */
  function togglePlayback(): void {
    playing.value = !playing.value
  }

  /** 停止(暂停 + 回到起点) */
  function stop(): void {
    playing.value = false
    currentTime.value = ZERO
  }

  /** 跳转到指定时间 */
  function seek(time: Time): void {
    const dur = duration.value
    currentTime.value = clamp(time, ZERO, dur)
  }

  /** 跳转到指定帧 */
  function seekFrame(frame: number): void {
    seek(frames(Math.max(0, frame), fps.value))
  }

  /** 推进时间(播放循环调用) */
  function advanceTime(deltaSeconds: number): void {
    if (!playing.value) return
    const delta = seconds(deltaSeconds * playbackRate.value)
    const newTime = currentTime.value + delta
    if (newTime >= duration.value) {
      // 到达末尾:停止或循环
      currentTime.value = duration.value
      playing.value = false
    } else {
      currentTime.value = newTime
    }
  }

  // —— 解析 ——

  /** 解析当前时间的活跃 Clip */
  function resolveActiveClips(): TimelineResolveResult | null {
    if (!resolver.value) return null
    // 读取 historyVersion 触发依赖收集(让 computed 重新计算)
    void historyVersion.value
    return resolver.value.resolve(currentTime.value)
  }

  /** 获取轨道列表 */
  const tracks = computed(() => activeSequence.value?.tracks ?? [])

  /** 获取 VIDEO 轨道 */
  const videoTracks = computed(() =>
    tracks.value.filter((t) => t.type === TrackType.VIDEO),
  )

  /** 获取 AUDIO 轨道 */
  const audioTracks = computed(() =>
    tracks.value.filter((t) => t.type === TrackType.AUDIO),
  )

  /** 获取当前活跃的 Clip(所有轨道) */
  const activeClips = computed(() => {
    const result = resolveActiveClips()
    return result?.allActiveClips ?? []
  })

  // —— Sequence 级 Actions(Step 31.6)——

  /** 添加新 Sequence(可指定 Sequence,默认创建新的) */
  function addSequence(seq?: Sequence): string {
    const cmd = new AddSequenceCommand(mutableProjectState, seq)
    history.execute(cmd)
    return cmd.sequenceId
  }

  /** 删除 Sequence(不允许删除最后一个) */
  function removeSequence(sequenceId: string): void {
    const cmd = new RemoveSequenceCommand(mutableProjectState, sequenceId)
    history.execute(cmd)
  }

  /** 复制 Sequence(深拷贝,新 ID + " 副本" 后缀) */
  function duplicateSequence(sourceId: string): string | null {
    const cmd = new DuplicateSequenceCommand(mutableProjectState, sourceId)
    history.execute(cmd)
    return cmd.duplicatedId
  }

  /** 重命名 Sequence */
  function renameSequence(sequenceId: string, name: string): void {
    const cmd = new RenameSequenceCommand(mutableProjectState, sequenceId, name)
    history.execute(cmd)
  }

  /** 切换活跃 Sequence */
  function switchSequence(targetId: string): void {
    const cmd = new SwitchSequenceCommand(mutableProjectState, targetId)
    history.execute(cmd)
  }

  /** 修改 Sequence 属性(fps / width / height / duration) */
  function setSequenceProperties(
    sequenceId: string,
    props: Partial<Pick<Sequence, 'fps' | 'width' | 'height' | 'duration'>>,
  ): void {
    const cmd = new SetSequencePropertiesCommand(mutableProjectState, sequenceId, props)
    history.execute(cmd)
  }

  /** 按 ID 查找 Sequence */
  function findSequenceById(sequenceId: string): Sequence | null {
    return project.value.sequences.find((s) => s.id === sequenceId) ?? null
  }

  /** 检测嵌套引用是否安全(不会形成循环) */
  function isNestedReferenceSafe(parentSeqId: string, nestedSeqId: string): boolean {
    const resolver = new NestedSequenceResolver(project.value)
    return resolver.isNestedReferenceSafe(parentSeqId, nestedSeqId)
  }

  /** 展开活跃 Sequence 的所有 Clip(含嵌套引用) */
  function resolveNestedClips(): ResolvedClip[] {
    return resolveActiveSequenceClips(project.value)
  }

  /** 查找引用了指定 Sequence 的所有 Sequence */
  function findReferencingSequences(targetSeqId: string): string[] {
    const resolver = new NestedSequenceResolver(project.value)
    return resolver.findReferencingSequences(targetSeqId)
  }

  // —— Sequence 模板/预设库(Step 31.9)——

  /**
   * 从模板创建新 Sequence(加入 Project,不自动切换)。
   *
   * @param template 模板定义
   * @returns 新 Sequence ID,失败返回 null
   */
  function createSequenceFromTemplate(template: SequenceTemplate): string | null {
    const validation = validateTemplate(template)
    if (!validation.valid) return null
    const seq = instantiateTemplate(template)
    return addSequence(seq)
  }

  /**
   * 将现有 Sequence 保存为自定义模板(持久化到 localStorage)。
   *
   * @param sequenceId  源 Sequence ID
   * @param name        模板名称
   * @param description 模板描述(可选)
   * @returns 保存的模板对象,失败返回 null
   */
  function saveSequenceAsTemplate(
    sequenceId: string,
    name: string,
    description?: string,
  ): SequenceTemplate | null {
    const seq = findSequenceById(sequenceId)
    if (!seq) return null
    if (!name.trim()) return null
    const template = serializeToTemplate(seq, name, description)
    addCustomTemplate(template)
    return template
  }

  /**
   * 删除自定义模板(仅限 category='custom')。
   *
   * @param templateId 模板 ID
   * @returns 是否删除成功(内置模板不可删)
   */
  function deleteCustomTemplate(templateId: string): boolean {
    const template = findTemplateById(templateId)
    if (!template || template.category !== 'custom') return false
    removeCustomTemplate(templateId)
    return true
  }

  /** 获取所有可用模板(内置 + 自定义) */
  function listTemplates(): SequenceTemplate[] {
    return getAllTemplates()
  }

  // —— 跨 Sequence 操作(Step 31.7)——

  /**
   * 把 Clip 从当前 Sequence 移动到另一个 Sequence 的指定 Track。
   *
   * @param clipId              要移动的 Clip ID
   * @param targetSequenceId    目标 Sequence ID
   * @param targetTrackId       目标 Track ID(可选,若不指定自动选择兼容 Track)
   * @param newTimelineStart    新 timelineStart(可选)
   * @returns 新 Clip ID(移动后 ID 不变),失败返回 null
   */
  function moveClipToSequence(
    clipId: string,
    targetSequenceId: string,
    targetTrackId?: string,
    newTimelineStart?: Time,
  ): string | null {
    // 查找 Clip 当前所在 Sequence
    let sourceSequenceId: string | null = null
    let clipKind: Clip['kind'] | null = null
    for (const seq of project.value.sequences) {
      for (const track of seq.tracks) {
        const found = track.clips.find((c) => c.id === clipId)
        if (found) {
          sourceSequenceId = seq.id
          clipKind = found.kind
          break
        }
      }
      if (sourceSequenceId) break
    }
    if (!sourceSequenceId || !clipKind) return null

    // 解析目标 Track
    const targetSeq = project.value.sequences.find((s) => s.id === targetSequenceId)
    if (!targetSeq) return null

    let resolvedTargetTrackId = targetTrackId
    if (!resolvedTargetTrackId) {
      resolvedTargetTrackId = findCompatibleTrack(targetSeq, clipKind) ?? undefined
    }
    if (!resolvedTargetTrackId) return null

    // 钳制 newTimelineStart 到目标 Sequence 时长
    let resolvedStart = newTimelineStart
    if (resolvedStart !== undefined) {
      // 找到 Clip 的 duration
      let clipDuration: Time | null = null
      for (const seq of project.value.sequences) {
        for (const track of seq.tracks) {
          const found = track.clips.find((c) => c.id === clipId)
          if (found) {
            clipDuration = found.duration
            break
          }
        }
      }
      if (clipDuration) {
        resolvedStart = clampClipStartToSequence(resolvedStart, clipDuration, targetSeq.duration)
      }
    }

    const params: MoveClipCrossSequenceParams = {
      sourceSequenceId,
      clipId,
      targetSequenceId,
      targetTrackId: resolvedTargetTrackId,
      newTimelineStart: resolvedStart,
    }
    const cmd = new MoveClipCrossSequenceCommand(mutableProjectState, params)
    history.execute(cmd)
    return clipId
  }

  /**
   * 把 Clip 从当前 Sequence 复制到另一个 Sequence 的指定 Track(深拷贝,新 ID)。
   *
   * @returns 新 Clip ID,失败返回 null
   */
  function copyClipToSequence(
    clipId: string,
    targetSequenceId: string,
    targetTrackId?: string,
    newTimelineStart?: Time,
  ): string | null {
    let sourceSequenceId: string | null = null
    let clipKind: Clip['kind'] | null = null
    for (const seq of project.value.sequences) {
      for (const track of seq.tracks) {
        const found = track.clips.find((c) => c.id === clipId)
        if (found) {
          sourceSequenceId = seq.id
          clipKind = found.kind
          break
        }
      }
      if (sourceSequenceId) break
    }
    if (!sourceSequenceId || !clipKind) return null

    const targetSeq = project.value.sequences.find((s) => s.id === targetSequenceId)
    if (!targetSeq) return null

    let resolvedTargetTrackId = targetTrackId
    if (!resolvedTargetTrackId) {
      resolvedTargetTrackId = findCompatibleTrack(targetSeq, clipKind) ?? undefined
    }
    if (!resolvedTargetTrackId) return null

    const params: CopyClipCrossSequenceParams = {
      sourceSequenceId,
      clipId,
      targetSequenceId,
      targetTrackId: resolvedTargetTrackId,
      newTimelineStart,
    }
    const cmd = new CopyClipCrossSequenceCommand(mutableProjectState, params)
    history.execute(cmd)
    return cmd.newClipId
  }

  /** 设置播放头对齐模式(切换 Sequence 时如何处理播放头) */
  function setPlayheadAlignMode(mode: PlayheadAlignMode): void {
    playheadAlignMode.value = mode
  }

  /** 手动调用播放头对齐(用于外部切换时) */
  function alignPlayhead(mode?: PlayheadAlignMode): void {
    const seq = activeSequence.value
    if (!seq) return
    const m = mode ?? playheadAlignMode.value
    currentTime.value = alignPlayheadOnSwitch(currentTime.value, seq, m)
  }

  // —— 嵌套 Sequence 编辑(Step 31.8)——

  /**
   * 进入嵌套 Sequence 编辑模式(双击嵌套 Clip 时调用)。
   *
   * 流程:
   * 1. 校验 Clip 是否为嵌套引用(sequenceId 存在)
   * 2. 校验目标 Sequence 存在
   * 3. breadcrumb.enter 记录历史
   * 4. switchSequence 切换到子 Sequence
   *
   * @param clipId 被双击的 Clip ID(必须含 sequenceId)
   * @returns 是否成功进入
   */
  function enterNestedSequence(clipId: string): boolean {
    // 在所有 Sequence 中查找该 Clip
    let foundClip: Clip | null = null
    let foundSeqId: string | null = null
    for (const seq of project.value.sequences) {
      for (const track of seq.tracks) {
        const c = track.clips.find((cl) => cl.id === clipId)
        if (c) {
          foundClip = c
          foundSeqId = seq.id
          break
        }
      }
      if (foundClip) break
    }
    if (!foundClip || !foundSeqId) return false
    if (!foundClip.sequenceId) return false

    const childSeq = project.value.sequences.find((s) => s.id === foundClip!.sequenceId)
    if (!childSeq) return false

    // 初始化根层(若栈空)
    if (breadcrumb.currentSequenceId === null) {
      breadcrumb.initRoot(foundSeqId, activeSequence.value?.name ?? foundSeqId)
    }

    // 进入子 Sequence
    try {
      breadcrumb.enter(childSeq.id, foundSeqId, clipId, childSeq.name)
    } catch {
      return false
    }
    // 切换活跃 Sequence(不入 history,因为是导航)
    // 直接修改 project.activeSequenceId(通过 setActiveSequence)
    project.value = { ...project.value, activeSequenceId: childSeq.id, updatedAt: Date.now() }
    // 触发 resolver 重建 + 播放头对齐
    mutableProjectState.notify()
    breadcrumbVersion.value++
    return true
  }

  /**
   * 退出嵌套编辑,回到上一层。
   *
   * @returns 是否成功退出(已在根层返回 false)
   */
  function exitNestedSequence(): boolean {
    const parentId = breadcrumb.exit()
    if (parentId === null) return false
    // 切换回父 Sequence
    project.value = { ...project.value, activeSequenceId: parentId, updatedAt: Date.now() }
    mutableProjectState.notify()
    breadcrumbVersion.value++
    return true
  }

  /**
   * 跳转到面包屑中的指定层。
   *
   * @param level 目标层(0 = 根)
   * @returns 是否成功
   */
  function jumpToBreadcrumbLevel(level: number): boolean {
    const targetId = breadcrumb.jumpTo(level)
    if (targetId === null) return false
    project.value = { ...project.value, activeSequenceId: targetId, updatedAt: Date.now() }
    mutableProjectState.notify()
    breadcrumbVersion.value++
    return true
  }

  /** 从 Project 重建面包屑(用于 store init / reset 后) */
  function syncBreadcrumb(): void {
    breadcrumb.syncFromProject(project.value)
    breadcrumbVersion.value++
  }

  return {
    // 状态
    project,
    currentTime,
    playing,
    playbackRate,
    historyVersion,

    // 计算属性
    activeSequence,
    activeSequenceId,
    sequences,
    sequenceCount,
    duration,
    fps,
    currentFrame,
    totalFrames,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    tracks,
    videoTracks,
    audioTracks,
    activeClips,

    // Actions
    init,
    reset,
    executeCommand,
    undo,
    redo,
    addClip,
    deleteClip,
    moveClip,
    trimClip,
    cutClip,
    rippleDelete,
    // Track 操作(Step 31.3)
    reorderTrack,
    resizeTrack,
    setTrackColor,
    renameTrack,
    deleteTrack,
    duplicateTrack,
    // Clip 多选 / 复制粘贴 / 群组 / 属性(Step 31.4)
    copyClips,
    pasteClips,
    deleteClips,
    moveClips,
    duplicateClips,
    groupClips,
    ungroupClips,
    updateClipProperty,
    findClipTrackId,
    getClipsByIds,
    isClipClipboardEmpty,
    getClipClipboardSize,
    clearClipClipboard,
    // Sequence 级操作(Step 31.6)
    addSequence,
    removeSequence,
    duplicateSequence,
    renameSequence,
    switchSequence,
    setSequenceProperties,
    findSequenceById,
    isNestedReferenceSafe,
    resolveNestedClips,
    findReferencingSequences,
    // Sequence 模板/预设库(Step 31.9)
    createSequenceFromTemplate,
    saveSequenceAsTemplate,
    deleteCustomTemplate,
    listTemplates,
    // 跨 Sequence 操作(Step 31.7)
    moveClipToSequence,
    copyClipToSequence,
    setPlayheadAlignMode,
    alignPlayhead,
    playheadAlignMode,
    // 嵌套 Sequence 编辑(Step 31.8)
    enterNestedSequence,
    exitNestedSequence,
    jumpToBreadcrumbLevel,
    syncBreadcrumb,
    breadcrumbEntries,
    isNestedEditing,
    nestedDepth,
    play,
    pause,
    togglePlayback,
    stop,
    seek,
    seekFrame,
    advanceTime,
    resolveActiveClips,
  }
})
