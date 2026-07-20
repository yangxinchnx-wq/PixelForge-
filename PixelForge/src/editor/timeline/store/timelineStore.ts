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
import type { Command, MutableSequenceState } from '../operation/command'
import {
  AddClipCommand,
  DeleteClipCommand,
  MoveClipCommand,
  TrimClipCommand,
  CutClipCommand,
  RippleDeleteCommand,
} from '../operation/commands'

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

  // —— 计算属性 ——

  /** 当前激活的 Sequence */
  const activeSequence = computed(() => getActiveSequence(project.value))

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

  return {
    // 状态
    project,
    currentTime,
    playing,
    playbackRate,
    historyVersion,

    // 计算属性
    activeSequence,
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
