/**
 * Director Context Engine Tests(Step 36.1)— 上下文序列化测试。
 */
import { describe, it, expect } from 'vitest'

import type { RenderIR } from '@/compiler/ir/renderIR'
import type { TimelineContent } from '@/world/types'
import { Opcode } from '@/shared/types'

import {
  buildDirectorContext,
  buildCreateModeContext,
  buildModifyModeContext,
} from './directorContext'

// ============================================================================
// 测试数据工厂
// ============================================================================

function createMockIR(overrides: Partial<RenderIR> = {}): RenderIR {
  return {
    canvas: { width: 1920, height: 1080 },
    layers: [
      {
        id: 'layer_01',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
        blendMode: 'normal',
      },
      {
        id: 'layer_02',
        opcode: Opcode.LINEAR_GRADIENT,
        params: { color: [0, 0, 1, 1], color2: [1, 1, 0, 1], angle: 90 },
        source: 'system_default',
        paramOwnership: {},
        visible: true,
      },
      {
        id: 'layer_03',
        opcode: Opcode.NOISE,
        params: { scale: 0.5, intensity: 0.8 },
        source: 'system_default',
        paramOwnership: {},
        visible: false,
      },
    ],
    regions: [
      {
        id: 'region_01',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        layerRefs: ['layer_01', 'layer_02'],
        source: 'system_default',
      },
    ],
    effects: [
      {
        id: 'eff_01',
        type: 'vignette',
        params: { intensity: 0.6 },
        targetLayer: 'layer_01',
      },
    ],
    compileHints: {
      preferredProfile: 'region',
    },
    ...overrides,
  }
}

function createMockTimeline(): TimelineContent {
  return {
    id: 'tl_01',
    tracks: [
      {
        id: 'track_01',
        name: '颜色动画',
        targetEntity: 'layer',
        targetId: 'layer_01',
        paramKey: 'color',
        keyframes: [
          { id: 'kf_01', time: 0, value: [1, 0, 0, 1], interpolation: 'linear' },
          { id: 'kf_02', time: 2, value: [0, 1, 0, 1], interpolation: 'linear' },
        ],
        enabled: true,
      },
    ],
    duration: 5,
    loop: true,
    fps: 60,
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('Director Context Engine', () => {
  describe('buildDirectorContext', () => {
    it('DC01: null IR 应返回空白上下文', () => {
      const ctx = buildDirectorContext(null)
      expect(ctx.summary).toContain('空白')
      expect(ctx.layerCount).toBe(0)
      expect(ctx.effectCount).toBe(0)
      expect(ctx.hasTimeline).toBe(false)
      expect(ctx.modifiableParams).toHaveLength(0)
    })

    it('DC02: 应正确序列化画布尺寸', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.canvasSize).toEqual({ width: 1920, height: 1080 })
      expect(ctx.summary).toContain('1920×1080')
    })

    it('DC03: 应正确统计图层数和可见图层数', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.layerCount).toBe(3)
      expect(ctx.summary).toContain('图层数: 3')
      expect(ctx.summary).toContain('可见: 2')
    })

    it('DC04: 应序列化每个图层的信息', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.summary).toContain('layer_01')
      expect(ctx.summary).toContain('SOLID_COLOR')
      expect(ctx.summary).toContain('纯色填充')
      expect(ctx.summary).toContain('layer_03')
      expect(ctx.summary).toContain('visible=false')
    })

    it('DC05: 应序列化效果信息', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.effectCount).toBe(1)
      expect(ctx.summary).toContain('eff_01')
      expect(ctx.summary).toContain('vignette')
      expect(ctx.summary).toContain('intensity=0.600')
    })

    it('DC06: 无效果时应正确显示', () => {
      const ir = createMockIR({ effects: [] })
      const ctx = buildDirectorContext(ir)
      expect(ctx.effectCount).toBe(0)
      expect(ctx.summary).toContain('效果数: 0')
    })

    it('DC07: 无时间轴时应显示未加载', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir, null)
      expect(ctx.hasTimeline).toBe(false)
      expect(ctx.summary).toContain('时间轴: 未加载')
    })

    it('DC08: 有时间轴时应显示详情', () => {
      const ir = createMockIR()
      const tl = createMockTimeline()
      const ctx = buildDirectorContext(ir, tl)
      expect(ctx.hasTimeline).toBe(true)
      expect(ctx.summary).toContain('已加载')
      expect(ctx.summary).toContain('轨道数: 1')
      expect(ctx.summary).toContain('5.0s')
      expect(ctx.summary).toContain('FPS: 60')
    })

    it('DC09: 应提取图层可修改参数', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      const layer01Params = ctx.modifiableParams.filter((p) => p.targetId === 'layer_01')
      expect(layer01Params).toHaveLength(1)
      expect(layer01Params[0].paramKey).toBe('color')
      expect(layer01Params[0].description).toContain('主颜色')
    })

    it('DC10: 应提取效果可修改参数', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      const effParams = ctx.modifiableParams.filter((p) => p.targetEntity === 'effect')
      expect(effParams).toHaveLength(1)
      expect(effParams[0].paramKey).toBe('intensity')
      expect(effParams[0].description).toContain('强度')
    })

    it('DC11: 应正确格式化数组参数值', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.summary).toContain('color=[1,0,0,1]')
    })

    it('DC12: 应正确格式化浮点数', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.summary).toContain('scale=0.500')
      expect(ctx.summary).toContain('intensity=0.800')
    })

    it('DC13: 应包含 blendMode 信息', () => {
      const ir = createMockIR()
      const ctx = buildDirectorContext(ir)
      expect(ctx.summary).toContain('blendMode=normal')
    })
  })

  describe('buildCreateModeContext', () => {
    it('CC01: 应包含基础摘要和创建引导', () => {
      const ir = createMockIR()
      const ctx = buildCreateModeContext(ir)
      expect(ctx).toContain('当前画面状态')
      expect(ctx).toContain('创建新的视觉内容')
    })

    it('CC02: null IR 也应正常工作', () => {
      const ctx = buildCreateModeContext(null)
      expect(ctx).toContain('空白')
      expect(ctx).toContain('创建')
    })
  })

  describe('buildModifyModeContext', () => {
    it('MC01: 应包含可修改参数列表', () => {
      const ir = createMockIR()
      const ctx = buildModifyModeContext(ir)
      expect(ctx).toContain('可修改的参数')
      expect(ctx).toContain('主颜色')
      expect(ctx).toContain('当前值')
    })

    it('MC02: 应列出所有可修改参数', () => {
      const ir = createMockIR()
      const ctx = buildModifyModeContext(ir)
      // 3 个图层(layer_01: 1 param, layer_02: 3 params, layer_03: 2 params) + 1 个效果(1 param) = 7
      // 实际: color(1) + color,color2,angle(3) + scale,intensity(2) + intensity(1) = 7
      expect(ctx).toContain('1.')
      expect(ctx).toContain('7.')
    })

    it('MC03: 应包含修改引导', () => {
      const ir = createMockIR()
      const ctx = buildModifyModeContext(ir)
      expect(ctx).toContain('DirectorPatch')
      expect(ctx).toContain('调整这些参数')
    })
  })
})
