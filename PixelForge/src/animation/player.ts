/**
 * Player(Step 29.7)— 时间轴播放器。
 *
 * 职责:
 * - 管理播放状态(playing / currentTime / loop)
 * - 每帧推进 currentTime(由 scheduler 驱动)
 * - 到达末尾时停止或循环
 * - 提供 seek / play / pause / stop / toggle 接口
 *
 * 与 editor/timeline/player.ts 的区别:
 * - editor/player: 基于 frame(整数),耦合 timelineStore + runtimeStore
 * - player(本模块): 基于 time(秒,浮点),纯播放逻辑,不依赖 store
 *   (由调用方组合 player + scheduler + binding + stores)
 *
 * 用法:
 *   const player = new TimelinePlayer({ duration: 10, loop: false })
 *   const loop = startFrameLoop((dt) => {
 *     player.update(dt)
 *     if (player.isPlaying()) {
 *       const patches = evaluateAllTracks(tracks, player.currentTime)
 *       applyAnimations(patches, graphStore, materialStore)
 *     }
 *   })
 *   player.play()
 */

import type { ParamPatch, Timeline } from './types'
import { evaluateAllTracks } from './evaluator'

// ============================================================================
// 1. Player 配置
// ============================================================================

export interface TimelinePlayerOptions {
  duration: number
  loop?: boolean
  fps?: number
  /** 播放速度倍率(1=正常,2=2倍速,0.5=慢放) */
  speed?: number
}

// ============================================================================
// 2. Player 状态
// ============================================================================

export type PlayerState = 'stopped' | 'playing' | 'paused'

// ============================================================================
// 3. TimelinePlayer 类
// ============================================================================

/**
 * 时间轴播放器(纯逻辑,不依赖 rAF / store)。
 *
 * 调用方需要:
 * 1. 用 scheduler.startFrameLoop 驱动 player.update(dt)
 * 2. 在 update 后读取 player.currentTime 并应用动画
 */
export class TimelinePlayer {
  /** 当前时间(秒) */
  currentTime = 0
  /** 播放状态 */
  state: PlayerState = 'stopped'
  /** 总时长(秒) */
  duration: number
  /** 是否循环 */
  loop: boolean
  /** 帧率(仅用于计算 frame,不影响实际播放) */
  fps: number
  /** 播放速度倍率 */
  speed: number

  constructor(options: TimelinePlayerOptions) {
    this.duration = options.duration
    this.loop = options.loop ?? false
    this.fps = options.fps ?? 60
    this.speed = options.speed ?? 1
  }

  // —— 状态查询 ——

  /** 是否正在播放 */
  isPlaying(): boolean {
    return this.state === 'playing'
  }

  /** 是否暂停 */
  isPaused(): boolean {
    return this.state === 'paused'
  }

  /** 是否停止 */
  isStopped(): boolean {
    return this.state === 'stopped'
  }

  /** 当前帧号(基于 fps 换算) */
  get currentFrame(): number {
    return Math.round(this.currentTime * this.fps)
  }

  /** 总帧数 */
  get totalFrames(): number {
    return Math.round(this.duration * this.fps)
  }

  /** 播放进度 [0, 1] */
  get progress(): number {
    if (this.duration <= 0) return 0
    return Math.max(0, Math.min(1, this.currentTime / this.duration))
  }

  // —— 播放控制 ——

  /** 开始播放(从当前位置) */
  play(): void {
    if (this.state === 'playing') return
    // 若已到末尾且不循环,从头开始
    if (this.currentTime >= this.duration && !this.loop) {
      this.currentTime = 0
    }
    this.state = 'playing'
  }

  /** 暂停播放 */
  pause(): void {
    if (this.state !== 'playing') return
    this.state = 'paused'
  }

  /** 停止播放(回到开头) */
  stop(): void {
    this.state = 'stopped'
    this.currentTime = 0
  }

  /** 切换播放 / 暂停 */
  toggle(): void {
    if (this.state === 'playing') {
      this.pause()
    } else {
      this.play()
    }
  }

  /** 跳转到指定时间 */
  seek(time: number): void {
    this.currentTime = Math.max(0, Math.min(this.duration, time))
  }

  /** 跳转到指定帧 */
  seekFrame(frame: number): void {
    this.seek(frame / this.fps)
  }

  /** 跳到开头 */
  jumpToStart(): void {
    this.currentTime = 0
  }

  /** 跳到末尾 */
  jumpToEnd(): void {
    this.currentTime = this.duration
  }

  /** 上一帧 */
  stepBackward(): void {
    this.seekFrame(this.currentFrame - 1)
  }

  /** 下一帧 */
  stepForward(): void {
    this.seekFrame(this.currentFrame + 1)
  }

  // —— 配置 ——

  /** 设置总时长 */
  setDuration(duration: number): void {
    this.duration = Math.max(0, duration)
    if (this.currentTime > this.duration) {
      this.currentTime = this.duration
    }
  }

  /** 设置循环 */
  setLoop(loop: boolean): void {
    this.loop = loop
  }

  /** 设置速度 */
  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed)
  }

  /** 设置帧率 */
  setFps(fps: number): void {
    this.fps = Math.max(1, fps)
  }

  // —— 每帧更新 ——

  /**
   * 推进时间(由 scheduler 每帧调用)。
   *
   * - 若 playing,currentTime += dt * speed
   * - 到达末尾时:loop=true 则回到开头继续;loop=false 则停止
   * - 非播放状态不推进
   *
   * @param dt 增量时间(秒)
   * @returns 是否推进了时间(playing=true 时返回 true)
   */
  update(dt: number): boolean {
    if (this.state !== 'playing') return false
    if (this.duration <= 0) return false

    this.currentTime += dt * this.speed

    if (this.currentTime >= this.duration) {
      if (this.loop) {
        // 循环:回到开头(保留溢出时间,使循环连续)
        this.currentTime = this.currentTime % this.duration
      } else {
        // 不循环:停到末尾
        this.currentTime = this.duration
        this.state = 'stopped'
      }
    }

    return true
  }

  // —— 便捷:求值轨道 ——

  /**
   * 求值所有轨道在当前时间的值。
   *
   * @param tracks 轨道列表
   * @returns ParamPatch[](空轨道 / 禁用轨道被跳过)
   */
  evaluateTracks(tracks: Timeline['tracks']): ParamPatch[] {
    return evaluateAllTracks(tracks, this.currentTime)
  }
}

// ============================================================================
// 4. 工厂函数
// ============================================================================

/**
 * 创建时间轴播放器。
 */
export function createPlayer(options: TimelinePlayerOptions): TimelinePlayer {
  return new TimelinePlayer(options)
}
