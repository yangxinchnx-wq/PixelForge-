/**
 * Director Conversation + Timeline Tests(Step 36.3 + 36.4)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { LLMOutput } from '@/authoring/llm/types'

import {
  createConversation,
  addUserMessage,
  addDirectorMessage,
  clearConversation,
  serializeConversation,
  buildConversationSystemPrompt,
  converse,
  extractAnimationParams,
  createTrackFromAnimation,
  createTimelineFromAnimations,
  generateTimelineFromLLM,
  resetConversationIdCounter,
} from './directorConversation'
import { parseEnhancedIntent, resetDirectorIdCounter } from './directorEnhanced'
import type { DirectorDecision } from '../types'
import { Opcode } from '@/shared/types'

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

function mockLLMResponse(output: LLMOutput) {
  return {
    content: '{}',
    parsed: output,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    model: 'test',
    latencyMs: 100,
    cached: false,
  }
}

describe('Director Conversation + Timeline', () => {
  beforeEach(() => {
    resetDirectorIdCounter()
    resetConversationIdCounter()
    mockedCallLLM.mockReset()
  })
  afterEach(() => vi.restoreAllMocks())

  // ========================================================================
  // 会话管理
  // ========================================================================
  describe('会话管理', () => {
    it('S01: createConversation 应创建空会话', () => {
      const s = createConversation()
      expect(s.id).toBeDefined()
      expect(s.messages).toHaveLength(0)
      expect(s.appliedPatches).toHaveLength(0)
    })

    it('S02: addUserMessage 应添加用户消息', () => {
      let s = createConversation()
      const intent = parseEnhancedIntent('创建星空', null)
      s = addUserMessage(s, intent)
      expect(s.messages).toHaveLength(1)
      expect(s.messages[0].role).toBe('user')
      expect(s.messages[0].content).toBe('创建星空')
      expect(s.messages[0].intent).toBe(intent)
    })

    it('S03: addDirectorMessage 应添加 Director 消息并累积 patches', () => {
      let s = createConversation()
      const decision: DirectorDecision = {
        intentId: 'test',
        patches: [
          { targetEntity: 'layer', targetId: 'L1', paramKey: 'color', value: [1, 0, 0, 1] },
        ],
        reasoning: '生成 1 个修改',
      }
      s = addDirectorMessage(s, decision)
      expect(s.messages).toHaveLength(1)
      expect(s.messages[0].role).toBe('director')
      expect(s.appliedPatches).toHaveLength(1)
    })

    it('S04: 多轮添加应累积消息和 patches', () => {
      let s = createConversation()
      const intent1 = parseEnhancedIntent('创建星空', null)
      s = addUserMessage(s, intent1)
      s = addDirectorMessage(s, { intentId: 'i1', patches: [{ targetEntity: 'layer', targetId: 'L1', paramKey: 'color', value: [1, 0, 0, 1] }], reasoning: 'r1' })
      const intent2 = parseEnhancedIntent('再亮一点', null)
      s = addUserMessage(s, intent2)
      s = addDirectorMessage(s, { intentId: 'i2', patches: [{ targetEntity: 'layer', targetId: 'L1', paramKey: 'intensity', value: 0.9 }], reasoning: 'r2' })
      expect(s.messages).toHaveLength(4)
      expect(s.appliedPatches).toHaveLength(2)
    })

    it('S05: clearConversation 应清空历史', () => {
      let s = createConversation()
      s = addUserMessage(s, parseEnhancedIntent('test', null))
      s = addDirectorMessage(s, { intentId: 'i', patches: [], reasoning: 'r' })
      s = clearConversation(s)
      expect(s.messages).toHaveLength(0)
      expect(s.appliedPatches).toHaveLength(0)
    })
  })

  // ========================================================================
  // 对话历史序列化
  // ========================================================================
  describe('对话历史序列化', () => {
    it('H01: 空会话应返回空字符串', () => {
      const s = createConversation()
      expect(serializeConversation(s)).toBe('')
    })

    it('H02: 应正确序列化对话历史', () => {
      let s = createConversation()
      s = addUserMessage(s, parseEnhancedIntent('创建星空', null))
      s = addDirectorMessage(s, { intentId: 'i1', patches: [], reasoning: '生成 3 个图层' })
      s = addUserMessage(s, parseEnhancedIntent('再亮一点', null))
      const text = serializeConversation(s)
      expect(text).toContain('对话历史')
      expect(text).toContain('[用户] 创建星空')
      expect(text).toContain('[Director] 生成 3 个图层')
      expect(text).toContain('[用户] 再亮一点')
      expect(text).toContain('对话历史结束')
    })

    it('H03: buildConversationSystemPrompt 应包含历史和上下文', () => {
      let s = createConversation()
      s = addUserMessage(s, parseEnhancedIntent('创建星空', null))
      s = addDirectorMessage(s, { intentId: 'i1', patches: [], reasoning: '已创建' })

      const prompt = buildConversationSystemPrompt(s, 'modify', createMockIR())
      expect(prompt).toContain('AI Director')
      expect(prompt).toContain('对话历史')
      expect(prompt).toContain('迭代修改')
    })

    it('H04: 无历史时应退回基础提示词', () => {
      const s = createConversation()
      const prompt = buildConversationSystemPrompt(s, 'create', null)
      expect(prompt).toContain('AI Director')
      expect(prompt).not.toContain('对话历史')
    })
  })

  // ========================================================================
  // converse(多轮对话决策)
  // ========================================================================
  describe('converse', () => {
    it('C01: 首轮对话应添加用户+Director 消息', async () => {
      mockedCallLLM.mockResolvedValueOnce(mockLLMResponse({
        scene: '星空',
        elements: [{ type: 'starfield', color: [255, 255, 200], layer: 0, description: '星星' }],
      }))

      const session = createConversation()
      const updated = await converse(session, '创建星空', null, null, { disableCache: true })

      expect(updated.messages).toHaveLength(2)
      expect(updated.messages[0].role).toBe('user')
      expect(updated.messages[1].role).toBe('director')
      expect(updated.appliedPatches.length).toBeGreaterThan(0)
    })

    it('C02: 第二轮对话应看到历史', async () => {
      mockedCallLLM.mockResolvedValueOnce(mockLLMResponse({
        scene: '星空',
        elements: [{ type: 'starfield', color: [255, 255, 200], layer: 0, description: '星星' }],
      }))
      mockedCallLLM.mockResolvedValueOnce(mockLLMResponse({
        scene: '更亮',
        elements: [{ type: 'starfield', color: [255, 255, 255], layer: 0, description: '更亮的星星' }],
      }))

      let session = createConversation()
      session = await converse(session, '创建星空', null, null, { disableCache: true })
      session = await converse(session, '再亮一点', null, null, { disableCache: true })

      expect(session.messages).toHaveLength(4)
      expect(session.appliedPatches.length).toBeGreaterThanOrEqual(2)
    })

    it('C03: LLM 失败时应返回空决策但保留用户消息', async () => {
      mockedCallLLM.mockRejectedValueOnce(new Error('network'))

      const session = createConversation()
      const updated = await converse(session, 'test', null, null, { disableCache: true })

      expect(updated.messages).toHaveLength(2)
      expect(updated.messages[1].role).toBe('director')
      expect(updated.messages[1].decision!.patches).toHaveLength(0)
      expect(updated.messages[1].decision!.reasoning).toContain('失败')
    })

    it('C04: modify 模式应使用引用图层', async () => {
      const ir = createMockIR()
      mockedCallLLM.mockResolvedValueOnce(mockLLMResponse({
        scene: '修改',
        elements: [{ type: 'background', color: [0, 0, 255], layer: 0, description: '蓝色' }],
      }))

      const session = createConversation()
      const updated = await converse(session, '把第一个图层改成蓝色', ir, null, { disableCache: true })

      const patches = updated.messages[1].decision!.patches
      expect(patches[0].targetId).toBe('layer_01')
    })
  })

  // ========================================================================
  // Timeline 自动生成
  // ========================================================================
  describe('Timeline 自动生成', () => {
    it('T01: extractAnimationParams 应提取动画参数', () => {
      const output: LLMOutput = {
        scene: '颜色动画',
        elements: [{
          type: 'background',
          color: [255, 0, 0],
          layer: 0,
          description: '红色到蓝色',
          params: { animateFrom: [255, 0, 0], animateTo: [0, 0, 255], duration: 2.0 },
        }],
      }
      const anims = extractAnimationParams(output, null)
      expect(anims).toHaveLength(1)
      expect(anims[0].from).toEqual([255, 0, 0])
      expect(anims[0].to).toEqual([0, 0, 255])
      expect(anims[0].duration).toBe(2.0)
      expect(anims[0].paramKey).toBe('color')
    })

    it('T02: 无动画参数时应返回空数组', () => {
      const output: LLMOutput = {
        scene: 'test',
        elements: [{ type: 'background', color: [0, 0, 0], layer: 0, description: 't' }],
      }
      expect(extractAnimationParams(output, null)).toHaveLength(0)
    })

    it('T03: createTrackFromAnimation 应生成 2 个关键帧', () => {
      const anim = { from: [1, 0, 0], to: [0, 0, 1], duration: 3.0, paramKey: 'color', targetId: 'layer_01' }
      const track = createTrackFromAnimation(anim, 0)
      expect(track.keyframes).toHaveLength(2)
      expect(track.keyframes[0].time).toBe(0)
      expect(track.keyframes[1].time).toBe(3.0)
      expect(track.keyframes[0].interpolation).toBe('linear')
      expect(track.targetId).toBe('layer_01')
      expect(track.paramKey).toBe('color')
    })

    it('T04: createTimelineFromAnimations 应生成完整时间轴', () => {
      const anims = [
        { from: [1, 0, 0], to: [0, 0, 1], duration: 2.0, paramKey: 'color', targetId: 'L1' },
        { from: 0.5, to: 0.9, duration: 3.0, paramKey: 'intensity', targetId: 'L2' },
      ]
      const tl = createTimelineFromAnimations(anims)
      expect(tl.tracks).toHaveLength(2)
      expect(tl.duration).toBe(3.0) // 取最大 duration
      expect(tl.fps).toBe(60)
      expect(tl.loop).toBe(true)
    })

    it('T05: generateTimelineFromLLM 应从 LLM 输出生成时间轴', () => {
      const output: LLMOutput = {
        scene: '动画',
        elements: [{
          type: 'background',
          color: [255, 0, 0],
          layer: 0,
          description: '动画',
          params: { animateFrom: [255, 0, 0], animateTo: [0, 0, 255], duration: 1.5 },
        }],
      }
      const tl = generateTimelineFromLLM(output, null)
      expect(tl).not.toBeNull()
      expect(tl!.tracks).toHaveLength(1)
      expect(tl!.tracks[0].keyframes[1].time).toBe(1.5)
    })

    it('T06: 无动画参数时 generateTimelineFromLLM 应返回 null', () => {
      const output: LLMOutput = {
        scene: 'test',
        elements: [{ type: 'background', color: [0, 0, 0], layer: 0, description: 't' }],
      }
      expect(generateTimelineFromLLM(output, null)).toBeNull()
    })

    it('T07: 应使用 IR 中的实际图层 ID', () => {
      const ir = createMockIR()
      const output: LLMOutput = {
        scene: '动画',
        elements: [{
          type: 'background',
          color: [255, 0, 0],
          layer: 1,
          description: '动画',
          params: { animateFrom: 0.5, animateTo: 0.9, duration: 2.0 },
        }],
      }
      const anims = extractAnimationParams(output, ir)
      expect(anims[0].targetId).toBe('layer_02')
    })

    it('T08: 多个动画参数应生成多个轨道', () => {
      const output: LLMOutput = {
        scene: '多重动画',
        elements: [
          { type: 'background', color: [255, 0, 0], layer: 0, description: 'a', params: { animateFrom: [255, 0, 0], animateTo: [0, 0, 255], duration: 2.0 } },
          { type: 'noise', color: [128, 128, 128], layer: 1, description: 'b', params: { animateFrom: 0.3, animateTo: 0.8, duration: 3.0 } },
        ],
      }
      const tl = generateTimelineFromLLM(output, null)
      expect(tl!.tracks).toHaveLength(2)
      expect(tl!.duration).toBe(3.0)
    })
  })
})
