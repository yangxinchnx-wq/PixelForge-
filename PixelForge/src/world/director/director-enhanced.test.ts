/**
 * Enhanced Director Tests(Step 36.2)— 增强意图解析 + 上下文感知测试。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { RenderIR } from '@/compiler/ir/renderIR'
import {
  parseEnhancedIntent,
  buildContextAwareSystemPrompt,
  decideWithContext,
  resetDirectorIdCounter,
} from './directorEnhanced'
import { Opcode } from '@/shared/types'

// Mock callLLM
vi.mock('@/authoring/llm/callLLM', () => ({
  callLLM: vi.fn(),
}))
import { callLLM } from '@/authoring/llm/callLLM'
const mockedCallLLM = vi.mocked(callLLM)

function createMockIR(): RenderIR {
  return {
    canvas: { width: 1920, height: 1080 },
    layers: [
      { id: 'layer_01', opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] }, source: 'system_default', paramOwnership: {}, visible: true },
      { id: 'layer_02', opcode: Opcode.NOISE, params: { scale: 0.5, intensity: 0.8 }, source: 'system_default', paramOwnership: {}, visible: true },
    ],
    regions: [{ id: 'r1', bounds: { x: 0, y: 0, width: 1, height: 1 }, layerRefs: ['layer_01'], source: 'system_default' }],
    effects: [],
    compileHints: { preferredProfile: 'region' },
  }
}

describe('Enhanced Director', () => {
  beforeEach(() => {
    resetDirectorIdCounter()
    mockedCallLLM.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  // ========================================================================
  // parseEnhancedIntent
  // ========================================================================
  describe('parseEnhancedIntent', () => {
    it('EI01: create 模式 — "创建一个星空"', () => {
      const intent = parseEnhancedIntent('创建一个星空', null)
      expect(intent.mode).toBe('create')
      expect(intent.keywords.length).toBeGreaterThan(0)
    })

    it('EI02: modify 模式 — "调整颜色再亮一点"', () => {
      const intent = parseEnhancedIntent('调整颜色再亮一点', null)
      expect(intent.mode).toBe('modify')
    })

    it('EI03: animate 模式 — "添加旋转动画"', () => {
      const intent = parseEnhancedIntent('添加旋转动画', null)
      expect(intent.mode).toBe('animate')
    })

    it('EI04: analyze 模式 — "分析一下当前画面"', () => {
      const intent = parseEnhancedIntent('分析一下当前画面', null)
      expect(intent.mode).toBe('analyze')
    })

    it('EI05: English create — "make a gradient"', () => {
      const intent = parseEnhancedIntent('make a gradient', null)
      expect(intent.mode).toBe('create')
    })

    it('EI06: English modify — "change the color to blue"', () => {
      const intent = parseEnhancedIntent('change the color to blue', null)
      expect(intent.mode).toBe('modify')
    })

    it('EI07: 应提取关键词', () => {
      const intent = parseEnhancedIntent('创建一个蓝色星空背景', null)
      expect(intent.keywords.length).toBeGreaterThan(0)
      // 正则匹配 2-4 字中文词组
      expect(intent.keywords.some((k) => k.includes('创建'))).toBe(true)
      expect(intent.keywords.some((k) => k.includes('蓝'))).toBe(true)
      expect(intent.keywords.some((k) => k.includes('星空'))).toBe(true)
    })

    it('EI08: 应检测直接引用的图层 ID', () => {
      const ir = createMockIR()
      const intent = parseEnhancedIntent('修改 layer_02 的颜色', ir)
      expect(intent.referencedLayerIds).toContain('layer_02')
    })

    it('EI09: 应检测序数引用 — "第一个图层"', () => {
      const ir = createMockIR()
      const intent = parseEnhancedIntent('把第一个图层改成蓝色', ir)
      expect(intent.referencedLayerIds).toContain('layer_01')
    })

    it('EI10: 应检测序数引用 — "第二个图层"', () => {
      const ir = createMockIR()
      const intent = parseEnhancedIntent('把第二个图层改成蓝色', ir)
      expect(intent.referencedLayerIds).toContain('layer_02')
    })

    it('EI11: 无 IR 时 referencedLayerIds 为空', () => {
      const intent = parseEnhancedIntent('修改第一个图层', null)
      expect(intent.referencedLayerIds).toHaveLength(0)
    })

    it('EI12: 应继承基础意图字段', () => {
      const intent = parseEnhancedIntent('营造氛围', null)
      expect(intent.id).toBeDefined()
      expect(intent.prompt).toBe('营造氛围')
      expect(intent.type).toBe('mood')
      expect(intent.confidence).toBe(0.5)
    })
  })

  // ========================================================================
  // buildContextAwareSystemPrompt
  // ========================================================================
  describe('buildContextAwareSystemPrompt', () => {
    it('SP01: create 模式应包含当前状态和创建引导', () => {
      const ir = createMockIR()
      const prompt = buildContextAwareSystemPrompt('create', ir)
      expect(prompt).toContain('AI Director')
      expect(prompt).toContain('Current State')
      expect(prompt).toContain('CREATE')
      expect(prompt).toContain('layer_01')
    })

    it('SP02: modify 模式应包含可修改参数列表', () => {
      const ir = createMockIR()
      const prompt = buildContextAwareSystemPrompt('modify', ir)
      expect(prompt).toContain('MODIFY')
      expect(prompt).toContain('可修改的参数')
    })

    it('SP03: animate 模式应包含动画引导', () => {
      const ir = createMockIR()
      const prompt = buildContextAwareSystemPrompt('animate', ir)
      expect(prompt).toContain('ANIMATION')
      expect(prompt).toContain('animateFrom')
      expect(prompt).toContain('animateTo')
    })

    it('SP04: analyze 模式应包含分析引导', () => {
      const ir = createMockIR()
      const prompt = buildContextAwareSystemPrompt('analyze', ir)
      expect(prompt).toContain('ANALYZE')
    })

    it('SP05: null IR 时应正常工作', () => {
      const prompt = buildContextAwareSystemPrompt('create', null)
      expect(prompt).toContain('空白')
    })

    it('SP06: 应包含输出格式说明', () => {
      const prompt = buildContextAwareSystemPrompt('create', null)
      expect(prompt).toContain('JSON')
      expect(prompt).toContain('elements')
    })
  })

  // ========================================================================
  // decideWithContext
  // ========================================================================
  describe('decideWithContext', () => {
    it('DC01: LLM 成功时应返回带模式信息的决策', async () => {
      mockedCallLLM.mockResolvedValueOnce({
        content: '{}',
        parsed: {
          scene: '蓝色背景',
          elements: [
            { type: 'background', color: [0, 0, 255], layer: 0, description: '蓝色' },
          ],
        },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: 'test',
        latencyMs: 100,
        cached: false,
      })

      const intent = parseEnhancedIntent('创建蓝色背景', null)
      const decision = await decideWithContext(intent, null, null, { disableCache: true })

      expect(decision.intentId).toBe(intent.id)
      expect(decision.patches.length).toBeGreaterThan(0)
      expect(decision.reasoning).toContain('create')
    })

    it('DC02: modify 模式应使用引用图层 ID', async () => {
      const ir = createMockIR()
      mockedCallLLM.mockResolvedValueOnce({
        content: '{}',
        parsed: {
          scene: '修改颜色',
          elements: [
            { type: 'background', color: [255, 0, 0], layer: 0, description: '红色' },
          ],
        },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: 'test',
        latencyMs: 100,
        cached: false,
      })

      const intent = parseEnhancedIntent('把第一个图层改成红色', ir)
      expect(intent.mode).toBe('modify')
      expect(intent.referencedLayerIds).toContain('layer_01')

      const decision = await decideWithContext(intent, ir, null, { disableCache: true })
      expect(decision.patches[0].targetId).toBe('layer_01')
    })

    it('DC03: 有 IR 时应使用实际图层 ID', async () => {
      const ir = createMockIR()
      mockedCallLLM.mockResolvedValueOnce({
        content: '{}',
        parsed: {
          scene: 'test',
          elements: [
            { type: 'background', color: [0, 255, 0], layer: 1, description: '绿色' },
          ],
        },
        usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        model: 'test',
        latencyMs: 50,
        cached: false,
      })

      const intent = parseEnhancedIntent('创建内容', ir)
      const decision = await decideWithContext(intent, ir, null, { disableCache: true })
      // layer index 1 → ir.layers[1].id = layer_02
      expect(decision.patches[0].targetId).toBe('layer_02')
    })

    it('DC04: LLM 返回非 JSON 应返回空决策', async () => {
      mockedCallLLM.mockResolvedValueOnce({
        content: 'not json',
        parsed: null,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: 'test',
        latencyMs: 100,
        cached: false,
      })

      const intent = parseEnhancedIntent('test', null)
      const decision = await decideWithContext(intent, null, null, { disableCache: true })
      expect(decision.patches).toHaveLength(0)
      expect(decision.reasoning).toContain('不是合法 JSON')
    })

    it('DC05: LLM 失败应返回空决策', async () => {
      mockedCallLLM.mockRejectedValueOnce(new Error('network error'))

      const intent = parseEnhancedIntent('test', null)
      const decision = await decideWithContext(intent, null, null, { disableCache: true })
      expect(decision.patches).toHaveLength(0)
      expect(decision.reasoning).toContain('决策失败')
    })

    it('DC06: animate 模式应跳过动画提示字段', async () => {
      const ir = createMockIR()
      mockedCallLLM.mockResolvedValueOnce({
        content: '{}',
        parsed: {
          scene: '颜色动画',
          elements: [
            {
              type: 'background',
              color: [255, 0, 0],
              layer: 0,
              description: '红色到蓝色',
              params: { animateFrom: [255, 0, 0], animateTo: [0, 0, 255], duration: 2.0 },
            },
          ],
        },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: 'test',
        latencyMs: 100,
        cached: false,
      })

      const intent = parseEnhancedIntent('添加颜色动画', ir)
      expect(intent.mode).toBe('animate')

      const decision = await decideWithContext(intent, ir, null, { disableCache: true })
      // animateFrom/animateTo/duration 不应出现在 patches 中
      const paramKeys = decision.patches.map((p) => p.paramKey)
      expect(paramKeys).not.toContain('animateFrom')
      expect(paramKeys).not.toContain('animateTo')
      expect(paramKeys).not.toContain('duration')
    })
  })
})
