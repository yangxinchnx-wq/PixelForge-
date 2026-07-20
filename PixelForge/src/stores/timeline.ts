import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { ParameterTrack } from '@/editor/timeline/types'

/**
 * 时间轴 store —— 编辑器交互层的核心状态。
 *
 * 维护:
 * - 当前播放头位置(currentFrame)
 * - 总帧数(totalFrames)与帧率(fps)
 * - 多条参数轨道(tracks),每条绑定到具体 layer.parameter
 *
 * 与 runtime store 的边界:
 * - timeline store 只管"编辑器视图状态"(播放头 / 关键帧)
 * - runtime store 管"渲染状态"(IR / GPU / 帧记录)
 * - player.ts 负责把 timeline 状态翻译成 ValuePatch 推给 runtime
 */

/** 生成简单唯一 id(不依赖 crypto.randomUUID,便于老旧环境/测试) */
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** blend_demo 场景的初始 4 条参数轨道(与 App.vue handleInit 切换的场景对齐) */
function createDefaultTracks(): ParameterTrack[] {
  return [
    {
      id: 'circle1-radius',
      label: '红圆半径',
      layerId: 'layer_blend_circle1',
      parameter: 'radius',
      keyframes: [
        { id: genId('kf'), frame: 0,   value: 0.30, easing: 'linear' },
        { id: genId('kf'), frame: 75,  value: 0.80, easing: 'ease' },
        { id: genId('kf'), frame: 150, value: 0.65, easing: 'linear' },
        { id: genId('kf'), frame: 225, value: 0.90, easing: 'ease' },
        { id: genId('kf'), frame: 299, value: 0.70, easing: 'linear' },
      ],
    },
    {
      id: 'circle2-radius',
      label: '蓝圆半径',
      layerId: 'layer_blend_circle2',
      parameter: 'radius',
      keyframes: [
        { id: genId('kf'), frame: 0,   value: 0.40, easing: 'linear' },
        { id: genId('kf'), frame: 90,  value: 0.60, easing: 'linear' },
        { id: genId('kf'), frame: 165, value: 0.75, easing: 'ease' },
        { id: genId('kf'), frame: 240, value: 0.55, easing: 'linear' },
        { id: genId('kf'), frame: 299, value: 0.65, easing: 'linear' },
      ],
    },
    {
      id: 'circle3-radius',
      label: '绿圆半径',
      layerId: 'layer_blend_circle3',
      parameter: 'radius',
      keyframes: [
        { id: genId('kf'), frame: 0,   value: 0.20, easing: 'linear' },
        { id: genId('kf'), frame: 75,  value: 0.50, easing: 'ease' },
        { id: genId('kf'), frame: 150, value: 0.80, easing: 'linear' },
        { id: genId('kf'), frame: 225, value: 0.60, easing: 'linear' },
        { id: genId('kf'), frame: 299, value: 0.90, easing: 'ease' },
      ],
    },
    {
      id: 'base-color',
      label: '底色明度',
      layerId: 'layer_blend_base',
      parameter: 'color',
      keyframes: [
        { id: genId('kf'), frame: 0,   value: 0.60, easing: 'linear' },
        { id: genId('kf'), frame: 75,  value: 0.85, easing: 'ease' },
        { id: genId('kf'), frame: 150, value: 0.70, easing: 'linear' },
        { id: genId('kf'), frame: 225, value: 0.95, easing: 'linear' },
        { id: genId('kf'), frame: 299, value: 0.80, easing: 'ease' },
      ],
    },
  ]
}

export const useTimelineStore = defineStore('timeline', () => {
  const currentFrame = ref(0)
  const totalFrames = ref(300)
  const fps = ref(60)
  const isPlaying = ref(false)
  const tracks = ref<ParameterTrack[]>(createDefaultTracks())

  /** 当前帧在轨道上的百分比位置(0-100),用于播放头定位 */
  const playheadPercent = computed(() => {
    if (totalFrames.value <= 0) return 0
    return (currentFrame.value / totalFrames.value) * 100
  })

  /** 拖动播放头到指定帧 */
  function seek(frame: number) {
    const clamped = Math.max(0, Math.min(totalFrames.value, Math.round(frame)))
    currentFrame.value = clamped
  }

  /** 跳到开头 */
  function jumpStart() {
    currentFrame.value = 0
  }

  /** 跳到结尾 */
  function jumpEnd() {
    currentFrame.value = totalFrames.value
  }

  /** 上一帧 */
  function stepBackward() {
    seek(currentFrame.value - 1)
  }

  /** 下一帧 */
  function stepForward() {
    seek(currentFrame.value + 1)
  }

  /** 播放 / 暂停切换 */
  function togglePlay() {
    isPlaying.value = !isPlaying.value
  }

  /** 设置播放状态 */
  function setPlaying(playing: boolean) {
    isPlaying.value = playing
  }

  /**
   * 在指定帧上添加关键帧(若该帧已存在则更新值)。
   * 返回新关键帧的 id(便于 UI 高亮)。
   */
  function addKeyframe(trackId: string, frame: number, value: number): string | null {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return null

    const existing = track.keyframes.find((k) => k.frame === frame)
    if (existing) {
      existing.value = value
      return existing.id
    }

    const id = genId('kf')
    track.keyframes.push({ id, frame, value, easing: 'linear' })
    // 保持按帧排序
    track.keyframes.sort((a, b) => a.frame - b.frame)
    return id
  }

  /** 更新关键帧位置(拖动时调用) */
  function updateKeyframe(trackId: string, keyframeId: string, frame: number, value: number) {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return
    const kf = track.keyframes.find((k) => k.id === keyframeId)
    if (!kf) return
    kf.frame = Math.max(0, Math.min(totalFrames.value, Math.round(frame)))
    kf.value = Math.max(0, Math.min(1, value))
    track.keyframes.sort((a, b) => a.frame - b.frame)
  }

  /** 删除关键帧 */
  function removeKeyframe(trackId: string, keyframeId: string) {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return
    const idx = track.keyframes.findIndex((k) => k.id === keyframeId)
    if (idx >= 0) track.keyframes.splice(idx, 1)
  }

  /** 重置某条轨道的关键帧(只保留起点) */
  function resetTrack(trackId: string) {
    const track = tracks.value.find((t) => t.id === trackId)
    if (!track) return
    const first = track.keyframes[0]
    track.keyframes = first
      ? [{ ...first, frame: 0 }]
      : [{ id: genId('kf'), frame: 0, value: 0.5, easing: 'linear' }]
  }

  return {
    currentFrame,
    totalFrames,
    fps,
    isPlaying,
    tracks,
    playheadPercent,
    seek,
    jumpStart,
    jumpEnd,
    stepBackward,
    stepForward,
    togglePlay,
    setPlaying,
    addKeyframe,
    updateKeyframe,
    removeKeyframe,
    resetTrack,
  }
})
