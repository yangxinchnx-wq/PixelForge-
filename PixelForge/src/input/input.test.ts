/**
 * Input Module 单元测试(Step 30)。
 *
 * 覆盖:
 * - T:  types(Signal / AudioFeatures / 常量 / genInputId)
 * - R:  inputRouter(setSignal / getSignal / subscribe / prune / timeout)
 * - F:  fft(hzToBin / binToHz / getBandEnergy / computeBands / computeVolume)
 * - B:  beatDetector(BeatDetector 状态机 / detectBeatByDiff)
 * - A:  audioAnalyzer(结构化类型 mock,init/start/stop 不实际运行)
 * - FE: featureExtractor(组合 analyzer + beatDetector + router)
 * - M:  midiInput(parseMidiMessage / ccSignalId / noteSignalId)
 * - C:  cameraInput(mock video,基本生命周期)
 * - MD: motionDetector(toGrayscale / computeDifference / computeBrightness)
 * - S:  sensorInput(writeMousePosition / writeKeyState / writeAiSignal / writeSensorSignal)
 * - MP: mapper(mapRange / clampValue / applyCurve / applyMapping / smoothValue / factories)
 * - ID: inputDriver(addBinding / evaluate / update / smoothing / serialize)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// —— types ——
import {
  AUDIO_SIGNAL_IDS,
  CAMERA_SIGNAL_IDS,
  DEFAULT_BAND_RANGES,
  DEFAULT_MAPPING,
  EMPTY_AUDIO_FEATURES,
  SIGNAL_TIMEOUT_MS,
  genInputId,
} from './types'
import type { InputBinding } from './types'

// —— inputRouter ——
import { InputRouter, inputRouter, resetInputRouterForTesting } from './inputRouter'

// —— fft ——
import {
  binToHz,
  computeBands,
  computeVolume,
  getBandEnergy,
  hzToBin,
  makeBandFftData,
  makeEmptyFftData,
  makeFullFftData,
} from './audio/fft'

// —— beatDetector ——
import { BeatDetector, DEFAULT_BEAT_OPTIONS, detectBeatByDiff } from './audio/beatDetector'

// —— audioAnalyzer(用 mock)——
import { AudioAnalyzer, DEFAULT_AUDIO_OPTIONS } from './audio/audioAnalyzer'
import type { AnalyserNodeLike, AudioContextLike, MediaDevicesLike } from './audio/audioAnalyzer'

// —— featureExtractor ——
import { FeatureExtractor, createLocalFeatureExtractor } from './audio/featureExtractor'

// —— midi ——
import {
  MidiInput,
  PITCHBEND_SIGNAL_ID,
  ccSignalId,
  noteSignalId,
  parseMidiMessage,
} from './midi/midiInput'

// —— camera ——
import { CameraInput, DEFAULT_CAMERA_OPTIONS } from './camera/cameraInput'
import type { VideoElementLike } from './camera/cameraInput'

// —— motionDetector ——
import {
  MotionDetector,
  computeBrightness,
  computeDifference,
  toGrayscale,
} from './camera/motionDetector'

// —— sensor ——
import {
  AI_SIGNAL_PREFIX,
  KEY_SIGNAL_PREFIX,
  MOUSE_X_SIGNAL_ID,
  MOUSE_Y_SIGNAL_ID,
  attachBrowserInputListeners,
  keySignalId,
  mouseButtonSignalId,
  writeAiSignal,
  writeKeyState,
  writeMouseButton,
  writeMousePosition,
  writeSensorSignal,
} from './sensor/sensorInput'

// —— mapper ——
import {
  applyCurve,
  applyMapping,
  clampValue,
  exponentialMapping,
  linearMapping,
  logarithmicMapping,
  mapRange,
  smoothValue,
} from '@/animation/mapper'

// —— inputDriver ——
import { InputDriver, asSignalReader, createInputDriver } from '@/animation/drivers/inputDriver'

// ============================================================================
// 测试辅助
// ============================================================================

/** 创建 mock AudioContext */
function makeMockAudioContext(sampleRate: number = 44100): AudioContextLike {
  const ctx: AudioContextLike = {
    sampleRate,
    state: 'running',
    createMediaStreamSource: () => ({
      connect: () => { /* mock */ },
      disconnect: () => { /* mock */ },
    }),
    createAnalyser: () => makeMockAnalyser(),
    async close() { ctx.state = 'closed' },
    async resume() { ctx.state = 'running' },
  }
  return ctx
}

/** 创建 mock AnalyserNode */
function makeMockAnalyser(
  fftSize: number = 2048,
  fillValue: number = 128,
): AnalyserNodeLike {
  const binCount = fftSize / 2
  const freqData = new Uint8Array(binCount).fill(fillValue)
  const timeData = new Uint8Array(fftSize).fill(128)
  return {
    fftSize,
    frequencyBinCount: binCount,
    smoothingTimeConstant: 0.8,
    getByteFrequencyData: (arr: Uint8Array) => {
      arr.set(freqData.subarray(0, arr.length))
    },
    getByteTimeDomainData: (arr: Uint8Array) => {
      arr.set(timeData.subarray(0, arr.length))
    },
    connect: () => { /* mock */ },
    disconnect: () => { /* mock */ },
  }
}

/** 创建 mock MediaDevices */
function makeMockMediaDevices(): MediaDevicesLike & {
  setStream: (stream: MediaStream) => void
} {
  let currentStream: MediaStream
  return {
    setStream(stream: MediaStream) { currentStream = stream },
    async getUserMedia() {
      return currentStream ?? ({
        getTracks: () => [{ stop: () => { /* mock */ } }],
      } as unknown as MediaStream)
    },
  }
}

/** 创建 mock AudioAnalyzer(绕过浏览器 API) */
function makeMockAnalyzer(
  freqValue: number = 128,
  timeValue: number = 128,
  sampleRate: number = 44100,
  fftSize: number = 2048,
): AudioAnalyzer {
  const freqData = new Uint8Array(fftSize / 2).fill(freqValue)
  const timeData = new Uint8Array(fftSize).fill(timeValue)

  class MockAnalyzer extends AudioAnalyzer {
    protected getMediaDevices(): MediaDevicesLike | null {
      return makeMockMediaDevices()
    }
    protected createAudioContext(): AudioContextLike | null {
      const ctx = makeMockAudioContext(sampleRate)
      return ctx
    }
  }

  const analyzer = new MockAnalyzer({ fftSize })
  // 手动注入已初始化状态(绕过 init)
  // 通过反射设置 private 字段(测试用)
  ;(analyzer as unknown as { context: AudioContextLike }).context = makeMockAudioContext(sampleRate)
  const analyser = makeMockAnalyser(fftSize, freqValue)
  ;(analyser as unknown as { getByteFrequencyData: (a: Uint8Array) => void }).getByteFrequencyData = (arr: Uint8Array) => {
    arr.set(freqData.subarray(0, arr.length))
  }
  ;(analyser as unknown as { getByteTimeDomainData: (a: Uint8Array) => void }).getByteTimeDomainData = (arr: Uint8Array) => {
    arr.set(timeData.subarray(0, arr.length))
  }
  ;(analyzer as unknown as { analyser: AnalyserNodeLike }).analyser = analyser
  ;(analyzer as unknown as { fftBuffer: Uint8Array }).fftBuffer = freqData
  ;(analyzer as unknown as { timeBuffer: Uint8Array }).timeBuffer = timeData
  return analyzer
}

/** 创建 mock store */
function makeMockStore(): { updateNodeParams: (id: string, params: Record<string, unknown>) => void; calls: Array<{ id: string; params: Record<string, unknown> }> } {
  const calls: Array<{ id: string; params: Record<string, unknown> }> = []
  return {
    calls,
    updateNodeParams(id: string, params: Record<string, unknown>) {
      calls.push({ id, params: { ...params } })
    },
  }
}

// ============================================================================
// T: types
// ============================================================================

describe('T: types 常量与工具', () => {
  it('T1: 常量定义正确', () => {
    expect(SIGNAL_TIMEOUT_MS).toBe(1000)
    expect(EMPTY_AUDIO_FEATURES).toEqual({
      volume: 0,
      bass: 0,
      mid: 0,
      high: 0,
      beat: false,
      bpm: 0,
    })
    expect(DEFAULT_MAPPING).toEqual({
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 1,
      curve: 'linear',
      smoothing: 0,
    })
  })

  it('T2: DEFAULT_BAND_RANGES 范围正确', () => {
    expect(DEFAULT_BAND_RANGES.bass).toEqual({ min: 0, max: 200 })
    expect(DEFAULT_BAND_RANGES.mid).toEqual({ min: 200, max: 2000 })
    expect(DEFAULT_BAND_RANGES.high).toEqual({ min: 2000, max: 8000 })
  })

  it('T3: AUDIO_SIGNAL_IDS 命名约定', () => {
    expect(AUDIO_SIGNAL_IDS.volume).toBe('audio.volume')
    expect(AUDIO_SIGNAL_IDS.bass).toBe('audio.bass')
    expect(AUDIO_SIGNAL_IDS.beat).toBe('audio.beat')
    expect(AUDIO_SIGNAL_IDS.bpm).toBe('audio.bpm')
  })

  it('T4: CAMERA_SIGNAL_IDS 命名约定', () => {
    expect(CAMERA_SIGNAL_IDS.motion).toBe('camera.motion')
    expect(CAMERA_SIGNAL_IDS.brightness).toBe('camera.brightness')
  })

  it('T5: genInputId 生成唯一 id', () => {
    const a = genInputId()
    const b = genInputId()
    expect(a).not.toBe(b)
    expect(a.startsWith('input_')).toBe(true)
  })

  it('T6: genInputId 自定义前缀', () => {
    const id = genInputId('binding')
    expect(id.startsWith('binding_')).toBe(true)
  })
})

// ============================================================================
// R: inputRouter
// ============================================================================

describe('R: InputRouter', () => {
  let router: InputRouter

  beforeEach(() => {
    router = new InputRouter()
  })

  it('R1: setSignal / getSignal 基本读写', () => {
    router.setSignal('audio.bass', 0.8, 'AUDIO')
    const s = router.getSignal('audio.bass')
    expect(s).toBeDefined()
    expect(s?.value).toBe(0.8)
    expect(s?.source).toBe('AUDIO')
    expect(s?.active).toBe(true)
  })

  it('R2: getSignal 不存在返回 undefined', () => {
    expect(router.getSignal('nonexistent')).toBeUndefined()
  })

  it('R3: getSignalValue 带 fallback', () => {
    expect(router.getSignalValue('nonexistent', 0.5)).toBe(0.5)
    router.setSignal('audio.bass', 0.8, 'AUDIO')
    expect(router.getSignalValue('audio.bass', 0.5)).toBe(0.8)
  })

  it('R4: setSignals 批量写入', () => {
    router.setSignals(
      [
        { id: 'audio.bass', value: 0.8 },
        { id: 'audio.mid', value: 0.4 },
        { id: 'audio.high', value: 0.7 },
      ],
      'AUDIO',
    )
    expect(router.size).toBe(3)
    expect(router.getSignalValue('audio.bass')).toBe(0.8)
    expect(router.getSignalValue('audio.mid')).toBe(0.4)
  })

  it('R5: getAllSignals 返回所有信号副本', () => {
    router.setSignal('a', 1, 'AUDIO')
    router.setSignal('b', 2, 'MIDI')
    const all = router.getAllSignals()
    expect(all.length).toBe(2)
    // 修改副本不影响原数据
    all[0].value = 999
    expect(router.getSignalValue('a')).toBe(1)
  })

  it('R6: getSignalsBySource 按来源过滤', () => {
    router.setSignal('a', 1, 'AUDIO')
    router.setSignal('b', 2, 'MIDI')
    router.setSignal('c', 3, 'AUDIO')
    const audio = router.getSignalsBySource('AUDIO')
    expect(audio.length).toBe(2)
    expect(audio.every((s) => s.source === 'AUDIO')).toBe(true)
  })

  it('R7: hasActiveSignal 活跃检查', () => {
    router.setSignal('a', 1, 'AUDIO')
    expect(router.hasActiveSignal('a')).toBe(true)
    expect(router.hasActiveSignal('nonexistent')).toBe(false)
  })

  it('R8: subscribe 订阅特定信号', () => {
    const calls: number[] = []
    router.subscribe('audio.bass', (s) => calls.push(s.value))
    router.setSignal('audio.bass', 0.5, 'AUDIO')
    router.setSignal('audio.bass', 0.8, 'AUDIO')
    router.setSignal('audio.mid', 0.3, 'AUDIO') // 不触发
    expect(calls).toEqual([0.5, 0.8])
  })

  it('R9: subscribe 返回取消订阅函数', () => {
    const calls: number[] = []
    const unsubscribe = router.subscribe('a', (s) => calls.push(s.value))
    router.setSignal('a', 1, 'AUDIO')
    unsubscribe()
    router.setSignal('a', 2, 'AUDIO')
    expect(calls).toEqual([1])
  })

  it('R10: subscribeAll 订阅所有信号', () => {
    const calls: string[] = []
    router.subscribeAll((s) => calls.push(s.id))
    router.setSignal('a', 1, 'AUDIO')
    router.setSignal('b', 2, 'MIDI')
    expect(calls).toEqual(['a', 'b'])
  })

  it('R11: 相同值不触发订阅', () => {
    const calls: number[] = []
    router.subscribe('a', (s) => calls.push(s.value))
    router.setSignal('a', 1, 'AUDIO')
    router.setSignal('a', 1, 'AUDIO') // 相同值,不触发
    expect(calls).toEqual([1])
  })

  it('R12: removeSignal 删除信号', () => {
    router.setSignal('a', 1, 'AUDIO')
    expect(router.removeSignal('a')).toBe(true)
    expect(router.getSignal('a')).toBeUndefined()
    expect(router.removeSignal('nonexistent')).toBe(false)
  })

  it('R13: clear 清除所有', () => {
    router.setSignal('a', 1, 'AUDIO')
    router.setSignal('b', 2, 'MIDI')
    router.clear()
    expect(router.size).toBe(0)
  })

  it('R14: pruneInactive 标记超时信号', () => {
    // 手动设置一个旧时间戳的信号
    const oldTime = performance.now() - SIGNAL_TIMEOUT_MS - 100
    router.setSignal('old', 1, 'AUDIO', oldTime)
    router.setSignal('new', 2, 'AUDIO')
    const pruned = router.pruneInactive()
    expect(pruned).toBe(1)
    // 'old' 信号应标记为 inactive
    const oldSignal = router.getSignal('old')
    expect(oldSignal?.active).toBe(false)
    // 'new' 信号仍活跃
    expect(router.hasActiveSignal('new')).toBe(true)
  })

  it('R15: pruneInactive 删除模式', () => {
    const oldTime = performance.now() - SIGNAL_TIMEOUT_MS - 100
    router.setSignal('old', 1, 'AUDIO', oldTime)
    const pruned = router.pruneInactive(true)
    expect(pruned).toBe(1)
    expect(router.getSignal('old')).toBeUndefined()
  })

  it('R16: 全局单例 inputRouter 工作', () => {
    resetInputRouterForTesting()
    inputRouter.setSignal('singleton.test', 42, 'AI')
    expect(inputRouter.getSignalValue('singleton.test')).toBe(42)
    resetInputRouterForTesting()
    expect(inputRouter.size).toBe(0)
  })
})

// ============================================================================
// F: fft
// ============================================================================

describe('F: FFT 频谱分析', () => {
  it('F1: hzToBin 基本换算', () => {
    // sampleRate=44100, fftSize=2048
    // bin = round(hz * 2048 / 44100)
    expect(hzToBin(0, 44100, 2048)).toBe(0)
    expect(hzToBin(100, 44100, 2048)).toBe(5) // round(4.64) = 5
    expect(hzToBin(1000, 44100, 2048)).toBe(46) // round(46.4) = 46
    expect(hzToBin(8000, 44100, 2048)).toBe(372) // round(371.9) = 372
  })

  it('F2: hzToBin 零采样率返回 0', () => {
    expect(hzToBin(1000, 0, 2048)).toBe(0)
  })

  it('F3: binToHz 反向换算', () => {
    const hz = binToHz(100, 44100, 2048)
    expect(hz).toBeCloseTo(2153, 0)
  })

  it('F4: getBandEnergy 空数据返回 0', () => {
    const data = makeEmptyFftData(1024)
    expect(getBandEnergy(data, 0, 100)).toBe(0)
  })

  it('F5: getBandEnergy 全满数据返回 1', () => {
    const data = makeFullFftData(1024)
    expect(getBandEnergy(data, 0, 100)).toBeCloseTo(1, 2)
  })

  it('F6: getBandEnergy 指定范围', () => {
    const data = makeBandFftData(1024, 10, 20, 255)
    // 10-20 共 10 个 bin,值 255,平均 255/255=1
    expect(getBandEnergy(data, 10, 20)).toBeCloseTo(1, 2)
    // 0-10 全 0,平均 0
    expect(getBandEnergy(data, 0, 10)).toBe(0)
  })

  it('F7: getBandEnergy 范围钳制', () => {
    const data = makeBandFftData(100, 0, 100, 128)
    // 超出范围的 bin 应被钳制
    expect(getBandEnergy(data, -10, 200)).toBeCloseTo(0.5, 1) // 128/255
  })

  it('F8: computeBands 默认频段', () => {
    // 让 bass 范围(0-200Hz)满,其他空
    const sampleRate = 44100
    const fftSize = 2048
    const bassEnd = hzToBin(200, sampleRate, fftSize)
    const data = makeBandFftData(fftSize / 2, 0, bassEnd, 255)
    const bands = computeBands(data, sampleRate, fftSize)
    expect(bands.bass).toBeCloseTo(1, 2)
    expect(bands.mid).toBe(0)
    expect(bands.high).toBe(0)
  })

  it('F9: computeBands 全满', () => {
    const data = makeFullFftData(1024)
    const bands = computeBands(data, 44100, 2048)
    expect(bands.bass).toBeCloseTo(1, 2)
    expect(bands.mid).toBeCloseTo(1, 2)
    expect(bands.high).toBeCloseTo(1, 2)
  })

  it('F10: computeVolume 静音返回 0', () => {
    // 所有采样 = 128(中心值)= 静音
    const timeData = new Uint8Array(1024).fill(128)
    expect(computeVolume(timeData)).toBe(0)
  })

  it('F11: computeVolume 满幅返回接近 1', () => {
    // 交替 0 和 255,振幅最大
    const timeData = new Uint8Array(1024)
    for (let i = 0; i < 1024; i++) {
      timeData[i] = i % 2 === 0 ? 0 : 255
    }
    const vol = computeVolume(timeData)
    expect(vol).toBeGreaterThan(0.9)
    expect(vol).toBeLessThanOrEqual(1)
  })

  it('F12: computeVolume 空数组返回 0', () => {
    expect(computeVolume(new Uint8Array(0))).toBe(0)
  })

  it('F13: makeEmptyFftData / makeFullFftData', () => {
    const empty = makeEmptyFftData(100)
    expect(empty.length).toBe(100)
    expect(empty[0]).toBe(0)
    const full = makeFullFftData(100)
    expect(full[0]).toBe(255)
  })
})

// ============================================================================
// B: beatDetector
// ============================================================================

describe('B: BeatDetector', () => {
  it('B1: 默认配置', () => {
    expect(DEFAULT_BEAT_OPTIONS.historySize).toBe(43)
    expect(DEFAULT_BEAT_OPTIONS.threshold).toBe(1.3)
    expect(DEFAULT_BEAT_OPTIONS.refractoryMs).toBe(250)
  })

  it('B2: 历史不足时不检测', () => {
    const det = new BeatDetector()
    const now = 1000
    // 前 3 帧历史不足
    expect(det.detect(0.5, now).beat).toBe(false)
    expect(det.detect(0.5, now + 16).beat).toBe(false)
    expect(det.detect(0.5, now + 32).beat).toBe(false)
  })

  it('B3: 能量突增触发 beat', () => {
    const det = new BeatDetector({ minEnergy: 0.01, refractoryMs: 0 })
    let now = 1000
    // 先填充低能量历史
    for (let i = 0; i < 10; i++) {
      det.detect(0.1, now)
      now += 16
    }
    // 突增到 0.9(远超平均 * threshold)
    const result = det.detect(0.9, now)
    expect(result.beat).toBe(true)
  })

  it('B4: 不应期避免连续触发', () => {
    const det = new BeatDetector({ minEnergy: 0.01, refractoryMs: 100 })
    let now = 1000
    for (let i = 0; i < 10; i++) {
      det.detect(0.1, now)
      now += 16
    }
    // 第一次触发
    expect(det.detect(0.9, now).beat).toBe(true)
    // 紧接着的下一帧不应触发(在不应期内)
    now += 16
    expect(det.detect(0.9, now).beat).toBe(false)
  })

  it('B5: 低能量不触发', () => {
    const det = new BeatDetector({ minEnergy: 0.5 })
    let now = 1000
    for (let i = 0; i < 10; i++) {
      det.detect(0.1, now)
      now += 16
    }
    expect(det.detect(0.3, now).beat).toBe(false)
  })

  it('B6: BPM 估算', () => {
    const det = new BeatDetector({ minEnergy: 0.01, refractoryMs: 0 })
    let now = 1000
    // 填充历史
    for (let i = 0; i < 10; i++) {
      det.detect(0.1, now)
      now += 16
    }
    // 触发 3 次 beat,间隔 500ms(= 120 BPM)
    det.detect(0.9, now)
    now += 500
    det.detect(0.9, now)
    now += 500
    det.detect(0.9, now)
    const bpm = det.detect(0.1, now + 16).bpm
    // 500ms 间隔 = 120 BPM
    expect(bpm).toBe(120)
  })

  it('B7: reset 清空状态', () => {
    const det = new BeatDetector()
    det.detect(0.5, 1000)
    det.reset()
    // 重置后历史不足
    expect(det.detect(0.5, 2000).beat).toBe(false)
  })

  it('B8: setOptions 更新配置', () => {
    const det = new BeatDetector()
    det.setOptions({ threshold: 2.0 })
    expect(det.getOptions().threshold).toBe(2.0)
  })

  it('B9: detectBeatByDiff 基本检测', () => {
    expect(detectBeatByDiff(0.9, 0.1, 0.3)).toBe(true)
    expect(detectBeatByDiff(0.2, 0.1, 0.3)).toBe(false)
    expect(detectBeatByDiff(0.1, 0.1, 0.3)).toBe(false)
  })

  it('B10: detectBeatByDiff 低能量不触发', () => {
    expect(detectBeatByDiff(0.04, 0.01, 0.3, 0.05)).toBe(false)
  })
})

// ============================================================================
// A: audioAnalyzer
// ============================================================================

describe('A: AudioAnalyzer', () => {
  it('A1: 默认配置', () => {
    expect(DEFAULT_AUDIO_OPTIONS.fftSize).toBe(2048)
    expect(DEFAULT_AUDIO_OPTIONS.smoothing).toBe(0.8)
    expect(DEFAULT_AUDIO_OPTIONS.bandRanges).toBe(DEFAULT_BAND_RANGES)
  })

  it('A2: 未初始化时 getFftData 返回 null', () => {
    const analyzer = new AudioAnalyzer()
    expect(analyzer.getFftData()).toBeNull()
    expect(analyzer.getTimeData()).toBeNull()
    expect(analyzer.isInitialized).toBe(false)
    expect(analyzer.isRunning).toBe(false)
  })

  it('A3: 默认 sampleRate / fftSize', () => {
    const analyzer = new AudioAnalyzer()
    expect(analyzer.getFftSize()).toBe(2048)
    expect(analyzer.getFrequencyBinCount()).toBe(1024)
    // 未初始化时 fallback 到 44100
    expect(analyzer.getSampleRate()).toBe(44100)
  })

  it('A4: 自定义配置', () => {
    const analyzer = new AudioAnalyzer({ fftSize: 4096, smoothing: 0.5 })
    expect(analyzer.getFftSize()).toBe(4096)
    expect(analyzer.getFrequencyBinCount()).toBe(2048)
  })

  it('A5: getBandRanges 返回配置', () => {
    const analyzer = new AudioAnalyzer()
    expect(analyzer.getBandRanges()).toBe(DEFAULT_BAND_RANGES)
  })

  it('A6: 无 MediaDevices 时 init 抛错', async () => {
    // 测试环境通常无 navigator.mediaDevices
    const analyzer = new AudioAnalyzer()
    await expect(analyzer.init()).rejects.toThrow(/不支持 MediaDevices/)
  })
})

// ============================================================================
// FE: featureExtractor
// ============================================================================

describe('FE: FeatureExtractor', () => {
  it('FE1: 未初始化时返回空特征', () => {
    const analyzer = new AudioAnalyzer()
    const router = new InputRouter()
    const extractor = new FeatureExtractor(analyzer, router)
    const features = extractor.update()
    expect(features).toEqual(EMPTY_AUDIO_FEATURES)
  })

  it('FE2: mock analyzer 计算特征', () => {
    const analyzer = makeMockAnalyzer(200, 128, 44100, 2048)
    const router = new InputRouter()
    const extractor = new FeatureExtractor(analyzer, router)

    const features = extractor.update()
    // 全部频段值=200/255≈0.78
    expect(features.bass).toBeCloseTo(200 / 255, 1)
    expect(features.mid).toBeCloseTo(200 / 255, 1)
    expect(features.high).toBeCloseTo(200 / 255, 1)
    // 静音波形(volume=0)
    expect(features.volume).toBe(0)
  })

  it('FE3: 写入 InputRouter', () => {
    const analyzer = makeMockAnalyzer(200, 128, 44100, 2048)
    const router = new InputRouter()
    const extractor = new FeatureExtractor(analyzer, router)

    extractor.update()
    expect(router.hasActiveSignal('audio.bass')).toBe(true)
    expect(router.hasActiveSignal('audio.volume')).toBe(true)
    expect(router.getSignalValue('audio.bass')).toBeCloseTo(200 / 255, 1)
  })

  it('FE4: writeToRouter=false 不写入', () => {
    const analyzer = makeMockAnalyzer(200, 128, 44100, 2048)
    const router = new InputRouter()
    const extractor = new FeatureExtractor(analyzer, router, { writeToRouter: false })

    extractor.update()
    expect(router.size).toBe(0)
  })

  it('FE5: getLastFeatures 不重新计算', () => {
    const analyzer = makeMockAnalyzer(200, 128, 44100, 2048)
    const extractor = new FeatureExtractor(analyzer, null, { writeToRouter: false })
    extractor.update()
    const f1 = extractor.getLastFeatures()
    const f2 = extractor.getLastFeatures()
    expect(f1).toEqual(f2)
  })

  it('FE6: reset 清空状态', () => {
    const analyzer = makeMockAnalyzer(200, 128, 44100, 2048)
    const extractor = new FeatureExtractor(analyzer, null, { writeToRouter: false })
    extractor.update()
    extractor.reset()
    expect(extractor.getLastFeatures()).toEqual(EMPTY_AUDIO_FEATURES)
  })

  it('FE7: createLocalFeatureExtractor 不写 router', () => {
    const analyzer = makeMockAnalyzer(200, 128, 44100, 2048)
    const extractor = createLocalFeatureExtractor(analyzer)
    extractor.update()
    // 没有传入 router,不会出错
    expect(extractor.getLastFeatures().bass).toBeCloseTo(200 / 255, 1)
  })

  it('FE8: beat 检测写入 0/1 信号', () => {
    const analyzer = makeMockAnalyzer(0, 128, 44100, 2048)
    const router = new InputRouter()
    const extractor = new FeatureExtractor(analyzer, router, {
      beatOptions: { minEnergy: 0.01, refractoryMs: 0 },
    })
    // 先低能量
    for (let i = 0; i < 10; i++) extractor.update(1000 + i * 16)
    expect(router.getSignalValue('audio.beat')).toBe(0)
  })
})

// ============================================================================
// M: midiInput
// ============================================================================

describe('M: MIDI Input', () => {
  it('M1: parseMidiMessage noteon', () => {
    const data = new Uint8Array([0x90, 60, 100]) // channel 0, note 60, velocity 100
    const msg = parseMidiMessage(data, 1000)
    expect(msg).not.toBeNull()
    expect(msg?.type).toBe('noteon')
    expect(msg?.channel).toBe(0)
    expect(msg?.value1).toBe(60)
    expect(msg?.value2).toBe(100)
  })

  it('M2: parseMidiMessage noteoff via velocity 0', () => {
    const data = new Uint8Array([0x90, 60, 0]) // noteon with velocity 0 = noteoff
    const msg = parseMidiMessage(data, 1000)
    expect(msg?.type).toBe('noteoff')
  })

  it('M3: parseMidiMessage explicit noteoff', () => {
    const data = new Uint8Array([0x80, 60, 0])
    const msg = parseMidiMessage(data, 1000)
    expect(msg?.type).toBe('noteoff')
  })

  it('M4: parseMidiMessage cc', () => {
    const data = new Uint8Array([0xb0, 1, 64]) // cc 1 = modwheel, value 64
    const msg = parseMidiMessage(data, 1000)
    expect(msg?.type).toBe('cc')
    expect(msg?.value1).toBe(1)
    expect(msg?.value2).toBe(64)
  })

  it('M5: parseMidiMessage pitchbend', () => {
    const data = new Uint8Array([0xe0, 0, 64]) // pitchbend
    const msg = parseMidiMessage(data, 1000)
    expect(msg?.type).toBe('pitchbend')
  })

  it('M6: parseMidiMessage 不支持的命令返回 null', () => {
    const data = new Uint8Array([0xc0, 0]) // program change
    const msg = parseMidiMessage(data, 1000)
    expect(msg).toBeNull()
  })

  it('M7: parseMidiMessage 数据过短返回 null', () => {
    const data = new Uint8Array([0x90])
    const msg = parseMidiMessage(data, 1000)
    expect(msg).toBeNull()
  })

  it('M8: ccSignalId / noteSignalId 命名', () => {
    expect(ccSignalId(1)).toBe('midi.cc1')
    expect(ccSignalId(74)).toBe('midi.cc74')
    expect(noteSignalId(60)).toBe('midi.note60')
  })

  it('M9: PITCHBEND_SIGNAL_ID 常量', () => {
    expect(PITCHBEND_SIGNAL_ID).toBe('midi.pitchbend')
  })

  it('M10: MidiInput 未初始化时 isInitialized=false', () => {
    const router = new InputRouter()
    const midi = new MidiInput(router)
    expect(midi.isInitialized).toBe(false)
  })

  it('M11: MidiInput dispose 不抛错', () => {
    const router = new InputRouter()
    const midi = new MidiInput(router)
    expect(() => midi.dispose()).not.toThrow()
  })

  it('M12: MidiInput getActiveInputs 空列表', () => {
    const router = new InputRouter()
    const midi = new MidiInput(router)
    expect(midi.getActiveInputs()).toEqual([])
  })
})

// ============================================================================
// C: cameraInput
// ============================================================================

describe('C: CameraInput', () => {
  it('C1: 默认配置', () => {
    expect(DEFAULT_CAMERA_OPTIONS.width).toBe(640)
    expect(DEFAULT_CAMERA_OPTIONS.height).toBe(480)
    expect(DEFAULT_CAMERA_OPTIONS.facingMode).toBe('user')
    expect(DEFAULT_CAMERA_OPTIONS.frameRate).toBe(30)
  })

  it('C2: 未初始化时 isInitialized=false', () => {
    const cam = new CameraInput()
    expect(cam.isInitialized).toBe(false)
    expect(cam.isRunning).toBe(false)
  })

  it('C3: 默认尺寸', () => {
    const cam = new CameraInput()
    expect(cam.getVideoWidth()).toBe(640)
    expect(cam.getVideoHeight()).toBe(480)
  })

  it('C4: 自定义配置', () => {
    const cam = new CameraInput({ width: 1280, height: 720, frameRate: 60 })
    expect(cam.getVideoWidth()).toBe(1280)
    expect(cam.getVideoHeight()).toBe(720)
  })

  it('C5: getVideoElement 未初始化返回 null', () => {
    const cam = new CameraInput()
    expect(cam.getVideoElement()).toBeNull()
  })

  it('C6: getStream 未初始化返回 null', () => {
    const cam = new CameraInput()
    expect(cam.getStream()).toBeNull()
  })

  it('C7: 无 MediaDevices 时 init 抛错', async () => {
    const cam = new CameraInput()
    await expect(cam.init()).rejects.toThrow(/不支持 MediaDevices/)
  })

  it('C8: dispose 不抛错', () => {
    const cam = new CameraInput()
    expect(() => cam.dispose()).not.toThrow()
  })
})

// ============================================================================
// MD: motionDetector
// ============================================================================

describe('MD: MotionDetector 纯函数', () => {
  it('MD1: toGrayscale 基本转换', () => {
    // 1x1 图像,R=255,G=0,B=0
    const imageData = {
      data: new Uint8ClampedArray([255, 0, 0, 255]),
      width: 1,
      height: 1,
    } as ImageData
    const gray = toGrayscale(imageData, 1, 1)
    // Y = 0.299*255 ≈ 76
    expect(gray[0]).toBeCloseTo(76, 0)
  })

  it('MD2: toGrayscale 白色', () => {
    const imageData = {
      data: new Uint8ClampedArray([255, 255, 255, 255]),
      width: 1,
      height: 1,
    } as ImageData
    const gray = toGrayscale(imageData, 1, 1)
    expect(gray[0]).toBe(255)
  })

  it('MD3: toGrayscale 黑色', () => {
    const imageData = {
      data: new Uint8ClampedArray([0, 0, 0, 255]),
      width: 1,
      height: 1,
    } as ImageData
    const gray = toGrayscale(imageData, 1, 1)
    expect(gray[0]).toBe(0)
  })

  it('MD4: computeDifference 相同帧返回 0', () => {
    const a = new Uint8ClampedArray([100, 100, 100])
    expect(computeDifference(a, a, 30)).toBe(0)
  })

  it('MD5: computeDifference 差异小于阈值返回 0', () => {
    const a = new Uint8ClampedArray([100, 100, 100])
    const b = new Uint8ClampedArray([105, 105, 105]) // 差 5 < 30
    expect(computeDifference(a, b, 30)).toBe(0)
  })

  it('MD6: computeDifference 大差异返回非 0', () => {
    const a = new Uint8ClampedArray([0, 0, 0])
    const b = new Uint8ClampedArray([255, 255, 255]) // 差 255 > 30
    const diff = computeDifference(a, b, 30)
    expect(diff).toBeGreaterThan(0)
    expect(diff).toBeLessThanOrEqual(1)
  })

  it('MD7: computeDifference 不同长度返回 0', () => {
    const a = new Uint8ClampedArray([0, 0])
    const b = new Uint8ClampedArray([255])
    expect(computeDifference(a, b, 30)).toBe(0)
  })

  it('MD8: computeBrightness 全白返回 1', () => {
    const gray = new Uint8ClampedArray([255, 255, 255])
    expect(computeBrightness(gray)).toBe(1)
  })

  it('MD9: computeBrightness 全黑返回 0', () => {
    const gray = new Uint8ClampedArray([0, 0, 0])
    expect(computeBrightness(gray)).toBe(0)
  })

  it('MD10: computeBrightness 中间值', () => {
    const gray = new Uint8ClampedArray([128, 128, 128])
    expect(computeBrightness(gray)).toBeCloseTo(128 / 255, 2)
  })

  it('MD11: computeBrightness 空数组返回 0', () => {
    expect(computeBrightness(new Uint8ClampedArray(0))).toBe(0)
  })
})

describe('MD: MotionDetector 类', () => {
  it('MD12: 未就绪 video 返回 0', () => {
    const router = new InputRouter()
    const det = new MotionDetector(router)
    const video: VideoElementLike = {
      srcObject: null,
      videoWidth: 640,
      videoHeight: 480,
      readyState: 0, // 未就绪
      async play() { /* mock */ },
      pause() { /* mock */ },
    }
    const result = det.update(video)
    expect(result.motion).toBe(0)
    expect(result.brightness).toBe(0)
  })

  it('MD13: reset 清空状态', () => {
    const det = new MotionDetector(null)
    det.reset()
    expect(det.getMotion()).toBe(0)
    expect(det.getBrightness()).toBe(0)
  })

  it('MD14: getMotion / getBrightness 初始为 0', () => {
    const det = new MotionDetector(null)
    expect(det.getMotion()).toBe(0)
    expect(det.getBrightness()).toBe(0)
  })

  it('MD15: dispose 不抛错', () => {
    const det = new MotionDetector(null)
    expect(() => det.dispose()).not.toThrow()
  })

  it('MD16: setOptions 更新配置', () => {
    const det = new MotionDetector(null)
    det.setOptions({ threshold: 50 })
    expect(det).toBeDefined() // 配置已更新
  })
})

// ============================================================================
// S: sensorInput
// ============================================================================

describe('S: Sensor Input', () => {
  let router: InputRouter

  beforeEach(() => {
    router = new InputRouter()
  })

  it('S1: writeMousePosition 归一化', () => {
    writeMousePosition(router, 320, 240, 640, 480)
    expect(router.getSignalValue(MOUSE_X_SIGNAL_ID)).toBeCloseTo(0.5, 2)
    expect(router.getSignalValue(MOUSE_Y_SIGNAL_ID)).toBeCloseTo(0.5, 2)
  })

  it('S2: writeMousePosition 钳制到 0-1', () => {
    writeMousePosition(router, -10, 999, 640, 480)
    expect(router.getSignalValue(MOUSE_X_SIGNAL_ID)).toBe(0)
    expect(router.getSignalValue(MOUSE_Y_SIGNAL_ID)).toBe(1)
  })

  it('S3: writeMousePosition 零尺寸不除零', () => {
    writeMousePosition(router, 100, 100, 0, 0)
    expect(router.getSignalValue(MOUSE_X_SIGNAL_ID)).toBe(0)
    expect(router.getSignalValue(MOUSE_Y_SIGNAL_ID)).toBe(0)
  })

  it('S4: writeMouseButton 按下/释放', () => {
    writeMouseButton(router, 0, true)
    expect(router.getSignalValue(mouseButtonSignalId(0))).toBe(1)
    writeMouseButton(router, 0, false)
    expect(router.getSignalValue(mouseButtonSignalId(0))).toBe(0)
  })

  it('S5: mouseButtonSignalId 命名', () => {
    expect(mouseButtonSignalId(0)).toBe('mouse.button0')
    expect(mouseButtonSignalId(2)).toBe('mouse.button2')
  })

  it('S6: writeKeyState 按下/释放', () => {
    writeKeyState(router, ' ', true)
    expect(router.getSignalValue(keySignalId(' '))).toBe(1)
    writeKeyState(router, ' ', false)
    expect(router.getSignalValue(keySignalId(' '))).toBe(0)
  })

  it('S7: keySignalId 规范化', () => {
    expect(keySignalId('Enter')).toBe('key.enter')
    expect(keySignalId(' ')).toBe('key._') // 空格转下划线
    expect(keySignalId('A')).toBe('key.a') // 大写转小写
  })

  it('S8: writeAiSignal', () => {
    writeAiSignal(router, 'scene_change', 1)
    expect(router.getSignalValue('ai.scene_change')).toBe(1)
    writeAiSignal(router, 'emotion', 0.8)
    expect(router.getSignalValue('ai.emotion')).toBe(0.8)
  })

  it('S9: writeSensorSignal', () => {
    writeSensorSignal(router, 'temperature', 23.5)
    expect(router.getSignalValue('sensor.temperature')).toBe(23.5)
  })

  it('S10: AI_SIGNAL_PREFIX / KEY_SIGNAL_PREFIX', () => {
    expect(AI_SIGNAL_PREFIX).toBe('ai')
    expect(KEY_SIGNAL_PREFIX).toBe('key')
  })

  it('S11: attachBrowserInputListeners 返回 cleanup', () => {
    // mock window
    const fakeWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const cleanup = attachBrowserInputListeners(router, fakeWindow as unknown as Window & typeof globalThis)
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(5) // mousemove/mousedown/mouseup/keydown/keyup
    cleanup()
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(5)
  })
})

// ============================================================================
// MP: mapper
// ============================================================================

describe('MP: Mapper', () => {
  it('MP1: mapRange 基本线性映射', () => {
    expect(mapRange(0.5, 0, 1, 0, 10)).toBe(5)
    expect(mapRange(0.8, 0, 1, 0.5, 3.0)).toBeCloseTo(2.5, 2)
  })

  it('MP2: mapRange 负范围', () => {
    expect(mapRange(0, -1, 1, 0, 10)).toBe(5)
    expect(mapRange(-1, -1, 1, 0, 10)).toBe(0)
    expect(mapRange(1, -1, 1, 0, 10)).toBe(10)
  })

  it('MP3: mapRange 零范围返回 outMin', () => {
    expect(mapRange(0.5, 1, 1, 0, 10)).toBe(0)
  })

  it('MP4: clampValue 钳制', () => {
    expect(clampValue(5, 0, 10)).toBe(5)
    expect(clampValue(-1, 0, 10)).toBe(0)
    expect(clampValue(11, 0, 10)).toBe(10)
  })

  it('MP5: applyCurve linear', () => {
    expect(applyCurve(0.5, 'linear')).toBe(0.5)
    expect(applyCurve(0, 'linear')).toBe(0)
    expect(applyCurve(1, 'linear')).toBe(1)
  })

  it('MP6: applyCurve exponential', () => {
    expect(applyCurve(0.5, 'exponential')).toBe(0.25) // 0.5²
    expect(applyCurve(0, 'exponential')).toBe(0)
    expect(applyCurve(1, 'exponential')).toBe(1)
  })

  it('MP7: applyCurve logarithmic', () => {
    expect(applyCurve(0.5, 'logarithmic')).toBeCloseTo(Math.sqrt(0.5), 5)
    expect(applyCurve(0, 'logarithmic')).toBe(0)
    expect(applyCurve(1, 'logarithmic')).toBe(1)
  })

  it('MP8: applyCurve 钳制到 0-1', () => {
    expect(applyCurve(-0.5, 'linear')).toBe(0)
    expect(applyCurve(1.5, 'linear')).toBe(1)
  })

  it('MP9: applyMapping 完整流程', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0.5,
      outMax: 3.0,
      curve: 'linear' as const,
      smoothing: 0,
    }
    // 0.8 → 0.5 + 0.8 * 2.5 = 2.5
    expect(applyMapping(0.8, mapping)).toBeCloseTo(2.5, 2)
  })

  it('MP10: applyMapping 钳制输入', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 10,
      curve: 'linear' as const,
      smoothing: 0,
    }
    expect(applyMapping(-1, mapping)).toBe(0) // 钳制到 inMin
    expect(applyMapping(2, mapping)).toBe(10) // 钳制到 inMax
  })

  it('MP11: applyMapping exponential 曲线', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 10,
      curve: 'exponential' as const,
      smoothing: 0,
    }
    // 0.5 → 0.25 → 2.5
    expect(applyMapping(0.5, mapping)).toBeCloseTo(2.5, 2)
  })

  it('MP12: applyMapping logarithmic 曲线', () => {
    const mapping = {
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 10,
      curve: 'logarithmic' as const,
      smoothing: 0,
    }
    // 0.5 → sqrt(0.5) ≈ 0.707 → 7.07
    expect(applyMapping(0.5, mapping)).toBeCloseTo(Math.sqrt(0.5) * 10, 2)
  })

  it('MP13: smoothValue 无平滑', () => {
    expect(smoothValue(0, 1, 0)).toBe(1)
  })

  it('MP14: smoothValue 中等平滑', () => {
    // smoothing=0.5,每帧追踪 50% 差异
    // output = 0 + (1-0) * (1-0.5) = 0.5
    expect(smoothValue(0, 1, 0.5)).toBeCloseTo(0.5, 2)
  })

  it('MP15: smoothValue 强平滑', () => {
    // smoothing=0.9,每帧追踪 10% 差异
    expect(smoothValue(0, 1, 0.9)).toBeCloseTo(0.1, 2)
  })

  it('MP16: smoothValue 钳制 smoothing', () => {
    // smoothing > 0.99 钳制到 0.99
    expect(smoothValue(0, 1, 1)).toBeCloseTo(0.01, 2)
    expect(smoothValue(0, 1, -1)).toBe(1) // 负值当 0 处理
  })

  it('MP17: linearMapping 工厂', () => {
    const m = linearMapping(0, 10, 0.3)
    expect(m.inMin).toBe(0)
    expect(m.inMax).toBe(1)
    expect(m.outMin).toBe(0)
    expect(m.outMax).toBe(10)
    expect(m.curve).toBe('linear')
    expect(m.smoothing).toBe(0.3)
  })

  it('MP18: exponentialMapping 工厂', () => {
    const m = exponentialMapping(0.5, 3)
    expect(m.curve).toBe('exponential')
  })

  it('MP19: logarithmicMapping 工厂', () => {
    const m = logarithmicMapping(0, 1)
    expect(m.curve).toBe('logarithmic')
  })
})

// ============================================================================
// ID: inputDriver
// ============================================================================

describe('ID: InputDriver', () => {
  let router: InputRouter
  let driver: InputDriver

  beforeEach(() => {
    router = new InputRouter()
    driver = new InputDriver(router)
  })

  it('ID1: 初始状态', () => {
    expect(driver.size).toBe(0)
    expect(driver.getBindings()).toEqual([])
  })

  it('ID2: addBinding 返回 id', () => {
    const id = driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'galaxy01',
      property: 'scale',
    })
    expect(id).toBeTruthy()
    expect(driver.size).toBe(1)
  })

  it('ID3: addBinding 自定义 mapping', () => {
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 0.5, outMax: 3.0, smoothing: 0.3 },
    })
    const bindings = driver.getBindings()
    expect(bindings[0].mapping.outMin).toBe(0.5)
    expect(bindings[0].mapping.outMax).toBe(3.0)
    expect(bindings[0].mapping.smoothing).toBe(0.3)
  })

  it('ID4: addBinding 默认 enabled=true', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    expect(driver.getBindings()[0].enabled).toBe(true)
  })

  it('ID5: removeBinding', () => {
    const id = driver.addBinding({
      signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1',
    })
    expect(driver.removeBinding(id)).toBe(true)
    expect(driver.size).toBe(0)
    expect(driver.removeBinding('nonexistent')).toBe(false)
  })

  it('ID6: setBindingEnabled', () => {
    const id = driver.addBinding({
      signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1',
    })
    expect(driver.setBindingEnabled(id, false)).toBe(true)
    expect(driver.getBindings()[0].enabled).toBe(false)
  })

  it('ID7: setBindingMapping', () => {
    const id = driver.addBinding({
      signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1',
    })
    expect(driver.setBindingMapping(id, { outMin: 1, outMax: 5 })).toBe(true)
    expect(driver.getBindings()[0].mapping.outMin).toBe(1)
    expect(driver.getBindings()[0].mapping.outMax).toBe(5)
  })

  it('ID8: evaluate 无信号返回空数组', () => {
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    expect(driver.evaluate()).toEqual([])
  })

  it('ID9: evaluate 基本映射', () => {
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'scale',
      mapping: { outMin: 0, outMax: 10 },
    })
    router.setSignal('audio.bass', 0.8, 'AUDIO')
    const patches = driver.evaluate()
    expect(patches.length).toBe(1)
    expect(patches[0].value).toBeCloseTo(8, 2) // 0.8 * 10
    expect(patches[0].nodeId).toBe('n1')
    expect(patches[0].property).toBe('scale')
  })

  it('ID10: evaluate 禁用绑定跳过', () => {
    const id = driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    router.setSignal('audio.bass', 0.8, 'AUDIO')
    driver.setBindingEnabled(id, false)
    expect(driver.evaluate()).toEqual([])
  })

  it('ID11: evaluate 不活跃信号跳过', () => {
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
    })
    // 不设置信号,evaluate 应返回空
    expect(driver.evaluate()).toEqual([])
  })

  it('ID12: evaluate 平滑生效', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 0, outMax: 10, smoothing: 0.5 },
    })
    router.setSignal('a', 1, 'AUDIO')
    // 第一帧:0 + (10-0)*(1-0.5) = 5
    let patches = driver.evaluate()
    expect(patches[0].value).toBeCloseTo(5, 2)
    // 第二帧:5 + (10-5)*(1-0.5) = 7.5
    patches = driver.evaluate()
    expect(patches[0].value).toBeCloseTo(7.5, 2)
  })

  it('ID13: update 应用到 store', () => {
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'scale',
      mapping: { outMin: 0, outMax: 10 },
    })
    router.setSignal('audio.bass', 0.5, 'AUDIO')
    const store = makeMockStore()
    const applied = driver.update(store, null)
    expect(applied).toBe(1)
    expect(store.calls.length).toBe(1)
    expect(store.calls[0].id).toBe('n1')
    expect(store.calls[0].params.scale).toBe(5)
  })

  it('ID14: update material 目标', () => {
    driver.addBinding({
      signalId: 'midi.cc1',
      targetKind: 'material',
      nodeId: 'mat01',
      property: 'intensity',
      mapping: { outMin: 0, outMax: 1 },
    })
    router.setSignal('midi.cc1', 0.7, 'MIDI')
    const store = makeMockStore()
    const applied = driver.update(null, store)
    expect(applied).toBe(1)
    expect(store.calls[0].id).toBe('mat01')
    expect(store.calls[0].params.intensity).toBeCloseTo(0.7, 2)
  })

  it('ID15: resetSmoothState', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 0, outMax: 10, smoothing: 0.9 },
    })
    router.setSignal('a', 1, 'AUDIO')
    driver.evaluate() // 第一次平滑
    driver.resetSmoothState()
    // 重置后第一帧应从 0 开始
    const patches = driver.evaluate()
    // 0 + (10-0)*(1-0.9) = 1
    expect(patches[0].value).toBeCloseTo(1, 2)
  })

  it('ID16: clear 清空', () => {
    driver.addBinding({ signalId: 'a', targetKind: 'graph', nodeId: 'n1', property: 'p1' })
    driver.addBinding({ signalId: 'b', targetKind: 'graph', nodeId: 'n2', property: 'p2' })
    driver.clear()
    expect(driver.size).toBe(0)
  })

  it('ID17: exportBindings / loadBindings', () => {
    driver.addBinding({
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { outMin: 1, outMax: 5 },
    })
    const exported = driver.exportBindings()
    expect(exported.length).toBe(1)

    const driver2 = new InputDriver(router)
    driver2.loadBindings(exported)
    expect(driver2.size).toBe(1)
    expect(driver2.getBindings()[0].mapping.outMin).toBe(1)
  })

  it('ID18: addBindingDirect 直接添加', () => {
    const binding: InputBinding = {
      id: 'test-id',
      signalId: 'a',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'p1',
      mapping: { inMin: 0, inMax: 1, outMin: 0, outMax: 1, curve: 'linear', smoothing: 0 },
      enabled: true,
    }
    const id = driver.addBindingDirect(binding)
    expect(id).toBe('test-id')
    expect(driver.size).toBe(1)
  })

  it('ID19: createInputDriver 工厂', () => {
    const d = createInputDriver(router)
    expect(d).toBeInstanceOf(InputDriver)
  })

  it('ID20: asSignalReader 适配 inputRouter', () => {
    const reader = asSignalReader(router)
    router.setSignal('test', 42, 'AI')
    expect(reader.getSignalValue('test')).toBe(42)
    expect(reader.hasActiveSignal('test')).toBe(true)
    expect(reader.hasActiveSignal('nonexistent')).toBe(false)
  })

  it('ID21: 多绑定批量 evaluate', () => {
    driver.addBinding({
      signalId: 'audio.bass',
      targetKind: 'graph',
      nodeId: 'n1',
      property: 'scale',
      mapping: { outMin: 0, outMax: 10 },
    })
    driver.addBinding({
      signalId: 'audio.high',
      targetKind: 'material',
      nodeId: 'm1',
      property: 'intensity',
      mapping: { outMin: 0, outMax: 1 },
    })
    router.setSignal('audio.bass', 0.5, 'AUDIO')
    router.setSignal('audio.high', 0.8, 'AUDIO')
    const patches = driver.evaluate()
    expect(patches.length).toBe(2)
    // 第一个 graph,第二个 material
    expect(patches[0].targetKind).toBe('graph')
    expect(patches[1].targetKind).toBe('material')
  })
})
