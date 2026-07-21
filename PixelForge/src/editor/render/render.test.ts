/**
 * Step 32 单元测试 — 渲染导出模块。
 *
 * 覆盖:
 * - RC: RenderConfig(配置创建 / 预设 / 验证 / 帧序列计算)
 * - RP: RenderPipeline(状态机 / 进度 / 暂停 / 取消 / 失败)
 * - RS: RenderStore(Pinia 集成 / startRender / cancelRender / 进度)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createSequence } from '../timeline/core/sequence'
import { seconds } from '../timeline/core/time'
import {
  RENDER_PRESETS,
  createRenderConfigFromSequence,
  createRenderConfigFromPreset,
  validateRenderConfig,
  computeTotalFrames,
  frameIndexToTime,
  generateFrameTimes,
  type RenderConfig,
} from './renderConfig'
import {
  RenderPipeline,
  createMockFrameRenderer,
  createMockFrameExporter,
  type FrameRenderer,
} from './renderPipeline'
import { useRenderStore } from './renderStore'

// ============================================================================
// 辅助:创建测试用 Sequence
// ============================================================================

function makeTestSequence() {
  return createSequence({
    name: '渲染测试',
    fps: 30,
    width: 1920,
    height: 1080,
    duration: seconds(2), // 2 秒
  })
}

function makeTestConfig(overrides?: Partial<RenderConfig>): RenderConfig {
  const seq = makeTestSequence()
  return {
    ...createRenderConfigFromSequence(seq),
    ...overrides,
  }
}

// ============================================================================
// RC: RenderConfig
// ============================================================================

describe('RC: RenderConfig', () => {
  it('RC1: createRenderConfigFromSequence 匹配 Sequence 参数', () => {
    const seq = makeTestSequence()
    const config = createRenderConfigFromSequence(seq)
    expect(config.outputWidth).toBe(1920)
    expect(config.outputHeight).toBe(1080)
    expect(config.fps).toBe(30)
    expect(config.format).toBe('png-sequence')
    expect(config.startTime).toBe(0n)
    expect(config.endTime).toBe(seq.duration)
  })

  it('RC2: createRenderConfigFromPreset 合并预设 + Sequence', () => {
    const seq = makeTestSequence()
    const preset = RENDER_PRESETS.find((p) => p.id === 'preset-4k-png')!
    const config = createRenderConfigFromPreset(preset, seq)
    expect(config.outputWidth).toBe(3840)
    expect(config.outputHeight).toBe(2160)
    expect(config.fps).toBe(60)
    expect(config.endTime).toBe(seq.duration)
  })

  it('RC3: RENDER_PRESETS 至少 5 个预设', () => {
    expect(RENDER_PRESETS.length).toBeGreaterThanOrEqual(5)
  })

  it('RC4: 预设 ID 唯一', () => {
    const ids = RENDER_PRESETS.map((p) => p.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('RC5: validateRenderConfig 合法配置通过', () => {
    const config = makeTestConfig()
    expect(validateRenderConfig(config).valid).toBe(true)
  })

  it('RC6: validateRenderConfig 无效分辨率失败', () => {
    const config = makeTestConfig({ outputWidth: 0 })
    const result = validateRenderConfig(config)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('分辨率')
  })

  it('RC7: validateRenderConfig 超过 8K 失败', () => {
    const config = makeTestConfig({ outputWidth: 8000, outputHeight: 4320 })
    const result = validateRenderConfig(config)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('8K')
  })

  it('RC8: validateRenderConfig 无效帧率失败', () => {
    const config = makeTestConfig({ fps: 0 })
    const result = validateRenderConfig(config)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('帧率')
  })

  it('RC9: validateRenderConfig endTime <= startTime 失败', () => {
    const config = makeTestConfig({ startTime: seconds(5), endTime: seconds(3) })
    const result = validateRenderConfig(config)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('结束时间')
  })

  it('RC10: validateRenderConfig 视频格式需要 bitrate', () => {
    const config = makeTestConfig({ format: 'webm', bitrateKbps: 0 })
    const result = validateRenderConfig(config)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('比特率')
  })

  it('RC11: validateRenderConfig 空文件名失败', () => {
    const config = makeTestConfig({ outputName: '  ' })
    const result = validateRenderConfig(config)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('文件名')
  })

  it('RC12: computeTotalFrames 计算正确', () => {
    const config = makeTestConfig({ fps: 30, startTime: seconds(0), endTime: seconds(2) })
    // 2 秒 × 30fps = 60 帧
    expect(computeTotalFrames(config)).toBe(60)
  })

  it('RC13: computeTotalFrames 自定义区间', () => {
    const config = makeTestConfig({ fps: 25, startTime: seconds(1), endTime: seconds(3) })
    // 2 秒 × 25fps = 50 帧
    expect(computeTotalFrames(config)).toBe(50)
  })

  it('RC14: frameIndexToTime 计算正确', () => {
    const config = makeTestConfig({ fps: 30, startTime: seconds(0) })
    // 第 0 帧 = 0s,第 1 帧 = 1/30s ≈ 33333μs,第 30 帧 = 1s
    expect(frameIndexToTime(config, 0)).toBe(0n)
    expect(frameIndexToTime(config, 30)).toBe(1_000_000n)
  })

  it('RC15: frameIndexToTime 带起始偏移', () => {
    const config = makeTestConfig({ fps: 30, startTime: seconds(2) })
    // 第 0 帧 = 2s,第 30 帧 = 3s
    expect(frameIndexToTime(config, 0)).toBe(2_000_000n)
    expect(frameIndexToTime(config, 30)).toBe(3_000_000n)
  })

  it('RC16: generateFrameTimes 长度正确', () => {
    const config = makeTestConfig({ fps: 10, startTime: seconds(0), endTime: seconds(2) })
    const times = generateFrameTimes(config)
    expect(times.length).toBe(20) // 2s × 10fps
  })

  it('RC17: generateFrameTimes 时间递增', () => {
    const config = makeTestConfig({ fps: 10, startTime: seconds(0), endTime: seconds(1) })
    const times = generateFrameTimes(config)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1])
    }
  })
})

// ============================================================================
// RP: RenderPipeline
// ============================================================================

describe('RP: RenderPipeline', () => {
  it('RP1: 构造时状态为 idle', () => {
    const config = makeTestConfig({ endTime: seconds(0.1) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    expect(pipeline.job.status).toBe('idle')
    expect(pipeline.isRendering).toBe(false)
    expect(pipeline.isCompleted).toBe(false)
  })

  it('RP2: 构造时计算总帧数', () => {
    const config = makeTestConfig({ fps: 30, startTime: seconds(0), endTime: seconds(1) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    expect(pipeline.job.totalFrames).toBe(30)
  })

  it('RP3: 无效配置抛错', () => {
    const invalid = makeTestConfig({ outputWidth: 0 })
    expect(() => new RenderPipeline('seq1', invalid, createMockFrameRenderer())).toThrow()
  })

  it('RP4: start 完成后状态为 completed', async () => {
    const config = makeTestConfig({ fps: 10, startTime: seconds(0), endTime: seconds(0.5) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    const job = await pipeline.start()
    expect(job.status).toBe('completed')
    expect(pipeline.isCompleted).toBe(true)
    expect(job.completedFrames).toBe(5) // 0.5s × 10fps
    expect(job.totalFrames).toBe(5)
  })

  it('RP5: 进度百分比正确', async () => {
    const config = makeTestConfig({ fps: 10, startTime: seconds(0), endTime: seconds(1) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    let lastProgress = 0
    pipeline.onProgress = () => {
      lastProgress = pipeline.progress
    }
    await pipeline.start()
    expect(lastProgress).toBe(100)
  })

  it('RP6: onProgress 每帧触发', async () => {
    const config = makeTestConfig({ fps: 10, startTime: seconds(0), endTime: seconds(1) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    let progressCount = 0
    pipeline.onProgress = () => {
      progressCount++
    }
    await pipeline.start()
    expect(progressCount).toBe(10) // 10 帧
  })

  it('RP7: onComplete 完成时触发', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(0.4) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    let completed = false
    pipeline.onComplete = () => {
      completed = true
    }
    await pipeline.start()
    expect(completed).toBe(true)
  })

  it('RP8: cancel 取消渲染', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(2) })
    // 用延迟渲染器让取消有机会触发
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 5))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    const pipeline = new RenderPipeline('seq1', config, slowRenderer)
    let cancelled = false
    pipeline.onCancel = () => {
      cancelled = true
    }
    const promise = pipeline.start()
    // 等一帧后取消
    await new Promise((r) => setTimeout(r, 10))
    pipeline.cancel()
    await promise
    expect(cancelled).toBe(true)
    expect(pipeline.isCancelled).toBe(true)
  })

  it('RP9: pause + resume 暂停恢复', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(1) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 5))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    const pipeline = new RenderPipeline('seq1', config, slowRenderer)
    const promise = pipeline.start()
    // 等一帧后暂停
    await new Promise((r) => setTimeout(r, 10))
    pipeline.pause()
    expect(pipeline.isPaused).toBe(true)
    // 等一会确认暂停
    await new Promise((r) => setTimeout(r, 20))
    const pausedFrame = pipeline.job.completedFrames
    // 恢复
    pipeline.resume()
    await promise
    expect(pipeline.isCompleted).toBe(true)
    expect(pipeline.job.completedFrames).toBeGreaterThan(pausedFrame)
  })

  it('RP10: 帧渲染器抛错时状态为 failed', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(1) })
    const errorRenderer: FrameRenderer = async () => {
      throw new Error('渲染失败')
    }
    const pipeline = new RenderPipeline('seq1', config, errorRenderer)
    let errored = false
    pipeline.onError = () => {
      errored = true
    }
    const job = await pipeline.start()
    expect(job.status).toBe('failed')
    expect(errored).toBe(true)
    expect(job.error).toBe('渲染失败')
  })

  it('RP11: frameExporter 被调用并收集输出文件', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(0.4) })
    const pipeline = new RenderPipeline(
      'seq1',
      config,
      createMockFrameRenderer(),
      createMockFrameExporter(),
    )
    const job = await pipeline.start()
    expect(job.outputFiles.length).toBe(2) // 0.4s × 5fps = 2 帧
    expect(job.outputFiles[0]).toContain('.png')
    expect(job.outputFiles[0]).toContain('000000')
  })

  it('RP12: 重复 start 抛错', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(0.2) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    pipeline.start() // 不 await
    await expect(pipeline.start()).rejects.toThrow()
    await pipeline.start().catch(() => {}) // 等待第一个完成
  })

  it('RP13: progress 属性实时更新', async () => {
    const config = makeTestConfig({ fps: 10, startTime: seconds(0), endTime: seconds(1) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 2))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    const pipeline = new RenderPipeline('seq1', config, slowRenderer)
    const progressValues: number[] = []
    pipeline.onProgress = () => {
      progressValues.push(pipeline.progress)
    }
    await pipeline.start()
    // 进度应递增
    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThanOrEqual(progressValues[i - 1])
    }
    expect(progressValues[progressValues.length - 1]).toBe(100)
  })

  it('RP14: start 后 startedAt 已设置', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(0.2) })
    const pipeline = new RenderPipeline('seq1', config, createMockFrameRenderer())
    expect(pipeline.job.startedAt).toBeNull()
    await pipeline.start()
    expect(pipeline.job.startedAt).not.toBeNull()
    expect(pipeline.job.finishedAt).not.toBeNull()
  })

  it('RP15: currentFrame 跟踪当前帧', async () => {
    const config = makeTestConfig({ fps: 5, startTime: seconds(0), endTime: seconds(1) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 5))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    const pipeline = new RenderPipeline('seq1', config, slowRenderer)
    const frames: number[] = []
    pipeline.onProgress = () => {
      frames.push(pipeline.job.currentFrame)
    }
    await pipeline.start()
    // currentFrame 应从 0 递增到 4
    expect(frames[0]).toBe(0)
    expect(frames[frames.length - 1]).toBe(4)
  })
})

// ============================================================================
// RS: RenderStore
// ============================================================================

describe('RS: RenderStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('RS1: 初始状态为 idle', () => {
    const store = useRenderStore()
    expect(store.hasJob).toBe(false)
    expect(store.status).toBe('idle')
    expect(store.progress).toBe(0)
  })

  it('RS2: createDefaultConfig 从 Sequence 创建配置', () => {
    const store = useRenderStore()
    const seq = makeTestSequence()
    const config = store.createDefaultConfig(seq)
    expect(config.outputWidth).toBe(1920)
    expect(config.fps).toBe(30)
  })

  it('RS3: startRender 启动渲染任务', () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(0.2) })
    const result = store.startRender('seq1', config, createMockFrameRenderer())
    expect(result).toBe(true)
    expect(store.hasJob).toBe(true)
    expect(store.status).toBe('rendering')
  })

  it('RS4: startRender 无效配置返回 false', () => {
    const store = useRenderStore()
    const invalid = makeTestConfig({ outputWidth: 0 })
    const result = store.startRender('seq1', invalid, createMockFrameRenderer())
    expect(result).toBe(false)
    expect(store.hasJob).toBe(false)
  })

  it('RS5: startRender 重复启动返回 false', () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(2) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 10))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    store.startRender('seq1', config, slowRenderer)
    // 尝试再次启动
    const result = store.startRender('seq1', config, createMockFrameRenderer())
    expect(result).toBe(false)
    // 清理
    store.cancelRender()
  })

  it('RS6: 渲染完成后状态为 completed', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 10, endTime: seconds(0.3) })
    store.startRender('seq1', config, createMockFrameRenderer())
    // 等待完成
    await new Promise((r) => setTimeout(r, 200))
    expect(store.isCompleted).toBe(true)
    expect(store.progress).toBe(100)
    expect(store.completedFrames).toBe(3)
  })

  it('RS7: cancelRender 取消渲染', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(2) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 10))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    store.startRender('seq1', config, slowRenderer)
    await new Promise((r) => setTimeout(r, 20))
    store.cancelRender()
    await new Promise((r) => setTimeout(r, 100))
    expect(store.isCancelled).toBe(true)
  })

  it('RS8: pauseRender + resumeRender', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(1) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 10))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    store.startRender('seq1', config, slowRenderer)
    await new Promise((r) => setTimeout(r, 20))
    store.pauseRender()
    expect(store.isPaused).toBe(true)
    expect(store.canResume).toBe(true)
    // 等一会
    await new Promise((r) => setTimeout(r, 50))
    const pausedFrames = store.completedFrames
    // 恢复
    store.resumeRender()
    await new Promise((r) => setTimeout(r, 200))
    expect(store.isCompleted).toBe(true)
    expect(store.completedFrames).toBeGreaterThan(pausedFrames)
  })

  it('RS9: canPause / canCancel 状态正确', () => {
    const store = useRenderStore()
    expect(store.canPause).toBe(false)
    expect(store.canCancel).toBe(false)
    const config = makeTestConfig({ fps: 5, endTime: seconds(2) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 10))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    store.startRender('seq1', config, slowRenderer)
    expect(store.canPause).toBe(true)
    expect(store.canCancel).toBe(true)
    store.cancelRender()
  })

  it('RS10: clearJob 清除已完成任务', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 10, endTime: seconds(0.2) })
    store.startRender('seq1', config, createMockFrameRenderer())
    await new Promise((r) => setTimeout(r, 200))
    expect(store.isCompleted).toBe(true)
    store.clearJob()
    expect(store.hasJob).toBe(false)
    expect(store.status).toBe('idle')
  })

  it('RS11: clearJob 不能清除渲染中任务', () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(2) })
    const slowRenderer: FrameRenderer = async (frameIndex, time) => {
      await new Promise((r) => setTimeout(r, 10))
      return { frameIndex, time, data: new Uint8Array(0) }
    }
    store.startRender('seq1', config, slowRenderer)
    store.clearJob() // 不应清除
    expect(store.hasJob).toBe(true)
    store.cancelRender()
  })

  it('RS12: outputFiles 渲染后填充', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(0.4) })
    store.startRender(
      'seq1',
      config,
      createMockFrameRenderer(),
      createMockFrameExporter(),
    )
    await new Promise((r) => setTimeout(r, 200))
    expect(store.isCompleted).toBe(true)
    expect(store.outputFiles.length).toBe(2) // 0.4s × 5fps = 2 帧
  })

  it('RS13: error 在失败时填充', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 5, endTime: seconds(0.4) })
    const errorRenderer: FrameRenderer = async () => {
      throw new Error('测试错误')
    }
    store.startRender('seq1', config, errorRenderer)
    await new Promise((r) => setTimeout(r, 200))
    expect(store.isFailed).toBe(true)
    expect(store.error).toBe('测试错误')
  })

  it('RS14: totalFrames / currentFrame computed 正确', async () => {
    const store = useRenderStore()
    const config = makeTestConfig({ fps: 10, endTime: seconds(1) })
    store.startRender('seq1', config, createMockFrameRenderer())
    expect(store.totalFrames).toBe(10)
    await new Promise((r) => setTimeout(r, 300))
    expect(store.isCompleted).toBe(true)
    expect(store.completedFrames).toBe(10)
  })
})
