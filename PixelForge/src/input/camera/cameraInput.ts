/**
 * Camera Input(Step 30.15)— 摄像头采集。
 *
 * 职责:
 * - init():  申请摄像头权限,创建 video element + MediaStream
 * - start(): 启动采集
 * - stop():  停止采集
 * - getVideoElement(): 获取 video 元素(用于 motion detection / texture 上传)
 *
 * 与 spec §15 对齐:
 *   navigator.mediaDevices.getUserMedia({ video: true })
 *     ↓
 *   MediaStream → video.srcObject
 *     ↓
 *   video.play()
 *     ↓
 *   每帧:video.currentTime → canvas → ImageData / GPUTexture
 *
 * 设计:
 * - 不直接做 motion detection(由 motionDetector.ts 负责)
 * - 不直接上传 GPU texture(由 material/runtime 负责)
 * - 只负责采集 video stream
 */

// ============================================================================
// 1. 结构化类型(避免直接依赖 DOM,便于测试)
// ============================================================================

/**
 * MediaDevices 最小接口(与 audioAnalyzer.ts 一致)。
 */
export interface MediaDevicesLike {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
}

/**
 * VideoElement 最小接口(结构化类型)。
 */
export interface VideoElementLike {
  srcObject: MediaStream | null
  readonly videoWidth: number
  readonly videoHeight: number
  readyState: number
  play: () => Promise<void>
  pause: () => void
}

// ============================================================================
// 2. 配置
// ============================================================================

/**
 * CameraInput 配置。
 *
 * - width:    期望宽度(默认 640)
 * - height:   期望高度(默认 480)
 * - facingMode: 摄像头方向('user' 前置 / 'environment' 后置)
 * - frameRate: 期望帧率
 */
export interface CameraInputOptions {
  width: number
  height: number
  facingMode: 'user' | 'environment' | 'left' | 'right'
  frameRate: number
}

export const DEFAULT_CAMERA_OPTIONS: CameraInputOptions = {
  width: 640,
  height: 480,
  facingMode: 'user',
  frameRate: 30,
}

// ============================================================================
// 3. CameraInput 类
// ============================================================================

/**
 * 摄像头采集器。
 *
 * 用法:
 *   const cam = new CameraInput()
 *   await cam.init()
 *   cam.start()
 *   // 每帧:
 *   const video = cam.getVideoElement()
 *   if (video && video.readyState >= 2) {
 *     // 绘制到 canvas 做 motion detection
 *   }
 */
export class CameraInput {
  private options: CameraInputOptions
  private stream: MediaStream | null = null
  private video: VideoElementLike | null = null
  private started: boolean = false

  constructor(options: Partial<CameraInputOptions> = {}) {
    this.options = { ...DEFAULT_CAMERA_OPTIONS, ...options }
  }

  /**
   * 初始化:申请摄像头权限,创建 video 元素。
   *
   * @throws 若浏览器不支持 / 用户拒绝授权
   */
  async init(): Promise<void> {
    if (this.stream) return // 已初始化

    const mediaDevices = this.getMediaDevices()
    if (!mediaDevices) {
      throw new Error('浏览器不支持 MediaDevices API')
    }

    this.stream = await mediaDevices.getUserMedia({
      video: {
        width: { ideal: this.options.width },
        height: { ideal: this.options.height },
        facingMode: this.options.facingMode,
        frameRate: { ideal: this.options.frameRate },
      },
      audio: false,
    })

    this.video = this.createVideoElement()
    this.video.srcObject = this.stream
  }

  /**
   * 启动采集:播放 video。
   */
  async start(): Promise<void> {
    if (!this.video) {
      throw new Error('CameraInput 未初始化,请先调用 init()')
    }
    await this.video.play()
    this.started = true
  }

  /**
   * 停止采集(停止所有 track,但不释放 video,便于重启)。
   */
  stop(): void {
    this.started = false
    if (this.video) {
      try {
        this.video.pause()
      } catch {
        // ignore
      }
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
    }
  }

  /**
   * 完全销毁(释放所有资源)。
   */
  dispose(): void {
    this.stop()
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    this.stream = null
  }

  // —— 数据读取 ——

  /**
   * 获取 video 元素(用于 motion detection / texture 上传)。
   *
   * @returns video 元素,或 null(未初始化)
   */
  getVideoElement(): VideoElementLike | null {
    return this.video
  }

  /** 获取当前流(用于直接上传 GPU texture) */
  getStream(): MediaStream | null {
    return this.stream
  }

  /** 视频宽度 */
  getVideoWidth(): number {
    return this.video?.videoWidth ?? this.options.width
  }

  /** 视频高度 */
  getVideoHeight(): number {
    return this.video?.videoHeight ?? this.options.height
  }

  /** 是否已初始化 */
  get isInitialized(): boolean {
    return this.stream !== null && this.video !== null
  }

  /** 是否正在播放 */
  get isRunning(): boolean {
    return this.started && (this.video?.readyState ?? 0) >= 2
  }

  // —— 浏览器 API 注入点 ——

  /**
   * 获取 MediaDevices(可被子类 / 测试覆盖)。
   */
  protected getMediaDevices(): MediaDevicesLike | null {
    if (typeof navigator === 'undefined') return null
    if (!navigator.mediaDevices) return null
    return navigator.mediaDevices
  }

  /**
   * 创建 video 元素(可被子类 / 测试覆盖)。
   */
  protected createVideoElement(): VideoElementLike {
    if (typeof document === 'undefined') {
      // 测试环境:返回 mock
      return {
        srcObject: null,
        videoWidth: this.options.width,
        videoHeight: this.options.height,
        readyState: 0,
        async play() { /* mock */ },
        pause() { /* mock */ },
      }
    }
    const video = document.createElement('video')
    video.autoplay = true
    video.playsInline = true
    video.muted = true
    return video as unknown as VideoElementLike
  }
}
