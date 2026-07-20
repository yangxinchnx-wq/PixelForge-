/**
 * Timeline Store(Step 29.2)— 时间轴动画系统 Pinia Store。
 *
 * 职责:
 * - 管理 Timeline 状态(duration / fps / currentTime / isPlaying / loop)
 * - 管理轨道列表(tracks)
 * - 提供 CRUD actions:addTrack / removeTrack / addKeyframe / removeKeyframe / updateKeyframe
 * - 提供 playback actions:play / pause / seek / setLoop / setSpeed
 * - 提供 evaluate()(求值当前时间的所有轨道)
 *
 * 与 stores/timeline.ts 的区别:
 * - stores/timeline:  基于 frame(整数),绑定 RenderIR.layers
 * - animation/timeline(本模块): 基于 time(秒),绑定 GraphNode + MaterialNode
 *
 * 设计:
 * - 与 graphStore / materialGraphStore 解耦(由调用方编排 binding)
 * - 不直接持有 GPUBuffer(由 uniformUpdater 管理)
 * - 不直接驱动 rAF(由调用方用 scheduler 驱动)
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { AnimationTrack, Keyframe, TargetKind } from './types'
import { DEFAULT_TIMELINE_DURATION, DEFAULT_TIMELINE_FPS, genAnimId } from './types'
import { createTrack } from './track'
import { createKeyframe } from './keyframe'
import { evaluateAllTracks } from './evaluator'
import type { ParamPatch } from './types'

// ============================================================================
// 1. Store 定义
// ============================================================================

export const useAnimationStore = defineStore('animation', () => {
  // —— State ——

  /** 总时长(秒) */
  const duration = ref(DEFAULT_TIMELINE_DURATION)
  /** 帧率 */
  const fps = ref(DEFAULT_TIMELINE_FPS)
  /** 当前时间(秒) */
  const currentTime = ref(0)
  /** 是否正在播放 */
  const isPlaying = ref(false)
  /** 是否循环 */
  const loop = ref(false)
  /** 播放速度倍率 */
  const speed = ref(1)
  /** 轨道列表 */
  const tracks = ref<AnimationTrack[]>([])
  /** 当前选中的轨道 id(用于 UI 高亮) */
  const selectedTrackId = ref<string | null>(null)

  // —— Getters ——

  /** 轨道数量 */
  const trackCount = computed(() => tracks.value.length)

  /** 启用的轨道数量 */
  const enabledTrackCount = computed(
    () => tracks.value.filter((t) => t.enabled).length,
  )

  /** 当前帧号(基于 fps 换算) */
  const currentFrame = computed(() => Math.round(currentTime.value * fps.value))

  /** 总帧数 */
  const totalFrames = computed(() => Math.round(duration.value * fps.value))

  /** 播放进度 [0, 1] */
  const progress = computed(() => {
    if (duration.value <= 0) return 0
    return Math.max(0, Math.min(1, currentTime.value / duration.value))
  })

  /** 当前选中的轨道 */
  const selectedTrack = computed(() =>
    tracks.value.find((t) => t.id === selectedTrackId.value) ?? null,
  )

  /** 关键帧总数 */
  const keyframeCount = computed(() =>
    tracks.value.reduce((sum, t) => sum + t.keyframes.length, 0),
  )

  // —— Track CRUD ——

  /**
   * 添加轨道。
   *
   * @param targetKind 目标类型(graph / material)
   * @param nodeId     绑定节点 id
   * @param property   绑定参数 key
   * @param label      显示名(可选)
   * @returns 新轨道的 id
   */
  function addTrack(
    targetKind: TargetKind,
    nodeId: string,
    property: string,
    label?: string,
  ): string {
    const track = createTrack(targetKind, nodeId, property, label)
    tracks.value.push(track)
    return track.id
  }

  /**
   * 添加完整轨道(已包含关键帧)。
   */
  function addTrackDirect(track: AnimationTrack): string {
    tracks.value.push(track)
    return track.id
  }

  /** 删除轨道 */
  function removeTrack(trackId: string): boolean {
    const idx = tracks.value.findIndex((t) => t.id === trackId)
    if (idx < 0) return false
    tracks.value.splice(idx, 1)
    if (selectedTrackId.value === trackId) {
      selectedTrackId.value = null
    }
    return true
  }

  /** 选中轨道 */
  function selectTrack(trackId: string | null): void {
    selectedTrackId.value = trackId
  }

  /** 启用 / 禁用轨道 */
  function setTrackEnabled(trackId: string, enabled: boolean): void {
    const track = tracks.value.find((t) => t.id === trackId)
    if (track) track.enabled = enabled
  }

  /** 重命名轨道 */
  function renameTrack(trackId: string, label: string): void {
    const track = tracks.value.find((t) => t.id === trackId)
    if (track) track.label = label
  }

  /** 设置轨道颜色 */
  function setTrackColor(trackId: string, color: string): void {
    const track = tracks.value.find((t) => t.id === trackId)
    if (track) track.color = color
  }

  /** 设置轨道模式 */
  function setTrackMode(
    trackId: string,
    mode: AnimationTrack['mode'],
  ): void {
    const track = tracks.value.find((t) => t.id === trackId)
    if (track) track.mode = mode
  }

  /** 设置轨道表达式 */
  function setTrackExpression(trackId: string, expression: string): void {
    const track = tracks.value.find((t) => t.id === trackId)
    if (track) track.expression = expression
  }

  // —— Keyframe CRUD ——

  /**
   * 在轨道上添加关键帧(若同时刻已存在则更新值)。
   *
   * @returns 新关键帧的 id,或 null(轨道不存在)
   */
  function addKeyframe(
    trackId: string,
    time: number,
    value: number,
    interpolation: Keyframe['interpolation'] = 'linear',
  ): string | null {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return null

    // 查找同时刻已有关键帧
    const existing = track.keyframes.find((k) => Math.abs(k.time - time) < 0.001)
    if (existing) {
      existing.value = value
      existing.interpolation = interpolation
      return existing.id
    }

    const kf = createKeyframe(time, value, interpolation)
    track.keyframes.push(kf)
    track.keyframes.sort((a, b) => a.time - b.time)
    return kf.id
  }

  /** 删除关键帧 */
  function removeKeyframe(trackId: string, keyframeId: string): boolean {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return false
    const idx = track.keyframes.findIndex((k) => k.id === keyframeId)
    if (idx < 0) return false
    track.keyframes.splice(idx, 1)
    return true
  }

  /** 更新关键帧 */
  function updateKeyframe(
    trackId: string,
    keyframeId: string,
    updates: Partial<Pick<Keyframe, 'time' | 'value' | 'interpolation' | 'cp1' | 'cp2'>>,
  ): boolean {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return false
    const kf = track.keyframes.find((k) => k.id === keyframeId)
    if (!kf) return false
    Object.assign(kf, updates)
    track.keyframes.sort((a, b) => a.time - b.time)
    return true
  }

  /** 清空轨道关键帧 */
  function clearKeyframes(trackId: string): boolean {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return false
    track.keyframes = []
    return true
  }

  // —— Playback ——

  /** 播放 */
  function play(): void {
    if (isPlaying.value) return
    // 若已到末尾且不循环,从头开始
    if (currentTime.value >= duration.value && !loop.value) {
      currentTime.value = 0
    }
    isPlaying.value = true
  }

  /** 暂停 */
  function pause(): void {
    isPlaying.value = false
  }

  /** 停止(回到开头) */
  function stop(): void {
    isPlaying.value = false
    currentTime.value = 0
  }

  /** 切换播放 / 暂停 */
  function togglePlay(): void {
    if (isPlaying.value) pause()
    else play()
  }

  /** 跳转到指定时间 */
  function seek(time: number): void {
    currentTime.value = Math.max(0, Math.min(duration.value, time))
  }

  /** 跳转到指定帧 */
  function seekFrame(frame: number): void {
    seek(frame / fps.value)
  }

  /** 跳到开头 */
  function jumpToStart(): void {
    currentTime.value = 0
  }

  /** 跳到末尾 */
  function jumpToEnd(): void {
    currentTime.value = duration.value
  }

  /** 上一帧 */
  function stepBackward(): void {
    seekFrame(currentFrame.value - 1)
  }

  /** 下一帧 */
  function stepForward(): void {
    seekFrame(currentFrame.value + 1)
  }

  // —— 配置 ——

  function setDuration(d: number): void {
    duration.value = Math.max(0, d)
    if (currentTime.value > duration.value) {
      currentTime.value = duration.value
    }
  }

  function setFps(f: number): void {
    fps.value = Math.max(1, f)
  }

  function setLoop(l: boolean): void {
    loop.value = l
  }

  function setSpeed(s: number): void {
    speed.value = Math.max(0, s)
  }

  /**
   * 由 scheduler 每帧调用:推进时间。
   *
   * @param dt 增量时间(秒)
   * @returns 是否推进了时间
   */
  function advanceTime(dt: number): boolean {
    if (!isPlaying.value) return false
    if (duration.value <= 0) return false

    currentTime.value += dt * speed.value

    if (currentTime.value >= duration.value) {
      if (loop.value) {
        currentTime.value = currentTime.value % duration.value
      } else {
        currentTime.value = duration.value
        isPlaying.value = false
      }
    }

    return true
  }

  // —— 求值 ——

  /**
   * 求值当前时间的所有轨道,输出 ParamPatch[]。
   */
  function evaluate(): ParamPatch[] {
    return evaluateAllTracks(tracks.value, currentTime.value)
  }

  // —— 导入 / 导出 ——

  /** 加载完整 Timeline 数据 */
  function loadTimeline(data: {
    duration?: number
    fps?: number
    loop?: boolean
    speed?: number
    tracks?: AnimationTrack[]
  }): void {
    if (data.duration !== undefined) duration.value = data.duration
    if (data.fps !== undefined) fps.value = data.fps
    if (data.loop !== undefined) loop.value = data.loop
    if (data.speed !== undefined) speed.value = data.speed
    if (data.tracks !== undefined) tracks.value = data.tracks.map((t) => ({ ...t }))
    currentTime.value = 0
    isPlaying.value = false
    selectedTrackId.value = null
  }

  /** 导出 Timeline 数据(深拷贝) */
  function exportTimeline(): {
    duration: number
    fps: number
    loop: boolean
    speed: number
    currentTime: number
    tracks: AnimationTrack[]
  } {
    return {
      duration: duration.value,
      fps: fps.value,
      loop: loop.value,
      speed: speed.value,
      currentTime: currentTime.value,
      tracks: tracks.value.map((t) => ({
        ...t,
        keyframes: t.keyframes.map((k) => ({ ...k })),
      })),
    }
  }

  /** 清空所有轨道 */
  function clearAll(): void {
    tracks.value = []
    selectedTrackId.value = null
    currentTime.value = 0
    isPlaying.value = false
  }

  // —— 生成 id(供 UI 使用)——
  function genId(prefix: string = 'anim'): string {
    return genAnimId(prefix)
  }

  return {
    // state
    duration,
    fps,
    currentTime,
    isPlaying,
    loop,
    speed,
    tracks,
    selectedTrackId,
    // getters
    trackCount,
    enabledTrackCount,
    currentFrame,
    totalFrames,
    progress,
    selectedTrack,
    keyframeCount,
    // track crud
    addTrack,
    addTrackDirect,
    removeTrack,
    selectTrack,
    setTrackEnabled,
    renameTrack,
    setTrackColor,
    setTrackMode,
    setTrackExpression,
    // keyframe crud
    addKeyframe,
    removeKeyframe,
    updateKeyframe,
    clearKeyframes,
    // playback
    play,
    pause,
    stop,
    togglePlay,
    seek,
    seekFrame,
    jumpToStart,
    jumpToEnd,
    stepBackward,
    stepForward,
    // config
    setDuration,
    setFps,
    setLoop,
    setSpeed,
    advanceTime,
    // evaluate
    evaluate,
    // io
    loadTimeline,
    exportTimeline,
    clearAll,
    genId,
  }
})
