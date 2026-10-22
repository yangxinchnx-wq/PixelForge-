/**
 * 精确帧率单元测试 — FrameRate / parseFrameRate / 帧时间精确计算。
 *
 * 覆盖:
 * - FR1-FR6: 解析(整数 / 有理数 / NTSC 别名 / 非法输入)与工具函数
 * - FR7-FR8: NTSC 帧率下帧时间与总帧数的精确性(对比浮点 fps 的误差)
 * - FR9: exactFps 配置校验
 */

import { describe, it, expect } from 'vitest'

import { seconds } from './timelineTypes'
import {
  FRAME_RATES,
  computeTotalFrames,
  frameIndexToTime,
  frameRateToNumber,
  parseFrameRate,
  parseFrameRateFromLabel,
  resolveFrameRate,
  validateRenderConfig,
  type RenderConfig,
} from './renderConfig'

function makeConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
  return {
    outputWidth: 1920,
    outputHeight: 1080,
    fps: 30,
    format: 'png-sequence',
    quality: 'standard',
    startTime: seconds(0),
    endTime: seconds(2),
    outputName: 'frame-rate-test',
    alpha: false,
    bitrateKbps: 0,
    ...overrides,
  }
}

describe('精确帧率:解析', () => {
  it('FR1: 整数帧率', () => {
    expect(parseFrameRate('30')).toEqual({ frameRate: { num: 30, den: 1 } })
    expect(parseFrameRate(' 24 ')).toEqual({ frameRate: { num: 24, den: 1 } })
  })

  it('FR2: 有理数帧率', () => {
    expect(parseFrameRate('30000/1001')).toEqual({ frameRate: { num: 30000, den: 1001 } })
    expect(parseFrameRate('30000 / 1001')).toEqual({ frameRate: { num: 30000, den: 1001 } })
    expect(parseFrameRate('24000/1001')).toEqual({ frameRate: { num: 24000, den: 1001 } })
  })

  it('FR3: NTSC 小数别名映射到精确有理数', () => {
    expect(parseFrameRate('29.97')).toEqual({ frameRate: { num: 30000, den: 1001 } })
    expect(parseFrameRate('23.976')).toEqual({ frameRate: { num: 24000, den: 1001 } })
    expect(parseFrameRate('59.94')).toEqual({ frameRate: { num: 60000, den: 1001 } })
  })

  it('FR4: 拒绝非标准小数与非法输入', () => {
    for (const input of ['29.5', '0', '241', '30000/0', '0/1001', '', 'abc', '-30']) {
      const result = parseFrameRate(input)
      expect('error' in result, `应拒绝: "${input}"`).toBe(true)
    }
  })

  it('FR5: 从界面标签解析——29.97 不再被截断为 29', () => {
    expect(parseFrameRateFromLabel('29.97 fps')).toEqual({ num: 30000, den: 1001 })
    expect(parseFrameRateFromLabel('30 fps')).toEqual({ num: 30, den: 1 })
    expect(parseFrameRateFromLabel('30000/1001 fps')).toEqual({ num: 30000, den: 1001 })
    expect(parseFrameRateFromLabel('未知')).toEqual({ num: 30, den: 1 })
  })

  it('FR6: frameRateToNumber 与 resolveFrameRate', () => {
    expect(frameRateToNumber({ num: 30000, den: 1001 })).toBeCloseTo(29.97002997, 8)
    expect(frameRateToNumber({ num: 30, den: 1 })).toBe(30)
    // 未设置 exactFps 时按整数帧率处理
    expect(resolveFrameRate(makeConfig({ fps: 25 }))).toEqual({ num: 25, den: 1 })
    // exactFps 优先于 fps
    expect(resolveFrameRate(makeConfig({ fps: 29.97, exactFps: FRAME_RATES.ntsc30 }))).toEqual({
      num: 30000,
      den: 1001,
    })
  })
})

describe('精确帧率:帧时间与总帧数', () => {
  it('FR7: 第 30000 帧在 NTSC 30 下应恰好是 1001 秒', () => {
    const exact = makeConfig({ fps: 29.97, exactFps: FRAME_RATES.ntsc30 })
    expect(frameIndexToTime(exact, 30000)).toBe(seconds(1001))

    // 同一帧号下，浮点 fps 会漂移约 1001μs（逐帧误差累积）
    const floatOnly = makeConfig({ fps: 29.97 })
    const driftUs = Number(frameIndexToTime(floatOnly, 30000) - seconds(1001))
    expect(driftUs).toBeGreaterThan(900)
  })

  it('FR8: 1 小时 @ NTSC 30 应出 107893 帧（浮点 29.97 会少算 1 帧）', () => {
    const exact = makeConfig({
      fps: 29.97,
      exactFps: FRAME_RATES.ntsc30,
      endTime: seconds(3600),
    })
    expect(computeTotalFrames(exact)).toBe(107893)

    const floatOnly = makeConfig({ fps: 29.97, endTime: seconds(3600) })
    expect(computeTotalFrames(floatOnly)).toBe(107892)
  })

  it('FR9: exactFps 配置校验', () => {
    expect(validateRenderConfig(makeConfig({ exactFps: FRAME_RATES.ntsc30 })).valid).toBe(true)
    expect(validateRenderConfig(makeConfig({ exactFps: { num: 0, den: 1001 } })).valid).toBe(false)
    expect(validateRenderConfig(makeConfig({ exactFps: { num: 30000, den: 0 } })).valid).toBe(false)
    expect(validateRenderConfig(makeConfig({ exactFps: { num: 300000, den: 1001 } })).valid).toBe(false)
  })

  it('FR10: 整数帧率行为与旧实现一致', () => {
    const config = makeConfig({ fps: 30, startTime: seconds(0) })
    expect(frameIndexToTime(config, 0)).toBe(0n)
    expect(frameIndexToTime(config, 1)).toBe(33_333n)
    expect(frameIndexToTime(config, 30)).toBe(1_000_000n)
  })
})
