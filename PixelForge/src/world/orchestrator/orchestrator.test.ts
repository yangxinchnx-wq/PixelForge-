/**
 * L3 Orchestrator 集成层单元测试
 *
 * 测试覆盖：
 *   - TimelinePlayer：播放/暂停/停止/跳转/tick/循环
 *   - RevisionApplier：冲突检测/应用/强制覆盖
 *   - DirectorApplier：mock LLM 决策/预览/应用
 *   - L3Orchestrator：端到端编排
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

import { Opcode } from '@/shared/types'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type { AnyPatch, PatchEngineState, PatchApplyResult } from '@/compiler/ir/patch'

import { createTimelinePlayer } from './timelinePlayer'
import type { TimelinePlayer } from './timelinePlayer'
import { createRevisionApplier } from './revisionApplier'
import { createDirectorApplier } from './directorApplier'
import { createL3Orchestrator } from './l3Orchestrator'
import type { PatchEngineLike } from './types'

import { createTimeline, createTrack, createKeyframe, addTrack, addKeyframe } from '../timeline/timelineManager'
import { createRevisionLayer, createEntry, addEntry } from '../revision/revisionLayer'
import type { TimelineContent } from '../types'

// Mock callLLM for Director tests
vi.mock('@/authoring/llm/callLLM', () => ({
  callLLM: vi.fn(),
}))
import { callLLM } from '@/authoring/llm/callLLM'
const mockedCallLLM = vi.mocked(callLLM)

// ============================================================================
// fixture
// ============================================================================

function createBaseIR(): RenderIR {
  return {
    canvas: { width: 1920, height: 1080 },
    layers: [
      {
        id: 'layer_1',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] },
        source: 'system_default',
        sourceRef: undefined,
        paramOwnership: {},
        visible: true,
      } as RenderIR['layers'][number],
      {
        id: 'layer_2',
        opcode: Opcode.SOLID_COLOR,
        params: { color: [0, 0, 1, 1], radius: 0.5 },
        source: 'system_default',
        sourceRef: undefined,
        paramOwnership: {},
        visible: true,
      } as RenderIR['layers'][number],
    ],
    regions: [
      {
        id: 'region_1',
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        layerRefs: ['layer_1', 'layer_2'],
        source: 'system_default',
      },
    ],
    effects: [],
    compileHints: { preferredProfile: 'region' },
  }
}

function createTestTimeline(): TimelineContent {
  let tl = createTimeline(2, 30, false)
  const track = createTrack('color', 'layer', 'layer_1', 'color')
  tl = addTrack(tl, track)
  tl = addKeyframe(tl, track.id, createKeyframe(0, [1, 0, 0, 1], 'linear'))
  tl = addKeyframe(tl, track.id, createKeyframe(2, [0, 1, 0, 1], 'linear'))
  return tl
}

// ============================================================================
// MockPatchEngine — 用于测试的轻量级 PatchEngine mock
// ============================================================================

function createMockEngine(ir: RenderIR): PatchEngineLike {
  let currentIr = ir
  let state: PatchEngineState = 'idle'
  let queue: AnyPatch[] = []

  return {
    beginFrame() {
      if (state === 'queued') throw new Error('already in queued state')
      queue = []
      state = 'queued'
    },
    apply(patch: AnyPatch) {
      if (state !== 'queued') throw new Error('not in queued state')
      queue.push(patch)
    },
    endFrame(): PatchApplyResult {
      if (state !== 'queued') throw new Error('not in queued state')
      state = 'committed'
      return { success: true, appliedCount: queue.length, violations: [] }
    },
    rollback() {
      queue = []
      state = 'idle'
    },
    getState() {
      return state
    },
    getQueuedPatches() {
      return queue
    },
    getIR() {
      return currentIr
    },
  }
}

// ============================================================================
// TimelinePlayer 测试
// ============================================================================

describe('TimelinePlayer', () => {
  let engine: PatchEngineLike
  let player: TimelinePlayer

  beforeEach(() => {
    engine = createMockEngine(createBaseIR())
    player = createTimelinePlayer(engine, 1.0, false)
  })

  it('load 应加载时间轴并重置状态', () => {
    const tl = createTestTimeline()
    player.load(tl)
    expect(player.getTimeline()).toBe(tl)
    expect(player.getCurrentTime()).toBe(0)
    expect(player.isPlaying()).toBe(false)
  })

  it('play/pause 应切换播放状态', () => {
    player.load(createTestTimeline())
    expect(player.isPlaying()).toBe(false)
    player.play()
    expect(player.isPlaying()).toBe(true)
    player.pause()
    expect(player.isPlaying()).toBe(false)
  })

  it('stop 应重置 currentTime 到 0', () => {
    player.load(createTestTimeline())
    player.play()
    player.seek(1.5)
    player.stop()
    expect(player.getCurrentTime()).toBe(0)
    expect(player.isPlaying()).toBe(false)
  })

  it('seek 应跳转到指定时间', () => {
    player.load(createTestTimeline())
    player.seek(1.0)
    expect(player.getCurrentTime()).toBe(1.0)
  })

  it('seek 应 clamp 到 [0, duration]', () => {
    player.load(createTestTimeline())
    player.seek(-1)
    expect(player.getCurrentTime()).toBe(0)
    player.seek(100)
    expect(player.getCurrentTime()).toBe(2) // duration = 2
  })

  it('tick 未播放时应返回空帧', () => {
    player.load(createTestTimeline())
    const result = player.tick(0.016)
    expect(result.hasPatches).toBe(false)
    expect(result.appliedCount).toBe(0)
    expect(result.success).toBe(true)
  })

  it('tick 播放时应推进时间并生成 patch', () => {
    player.load(createTestTimeline())
    player.play()
    const result = player.tick(1.0) // 到 t=1.0
    expect(result.currentTime).toBe(1.0)
    expect(result.hasPatches).toBe(true)
    expect(result.success).toBe(true)
    expect(result.appliedCount).toBeGreaterThan(0)
  })

  it('tick 到达末尾无循环时应停止播放', () => {
    player.load(createTestTimeline())
    player.play()
    player.tick(3.0) // 超过 duration=2
    expect(player.isPlaying()).toBe(false)
    expect(player.getCurrentTime()).toBe(2)
  })

  it('tick 循环时应重置时间继续播放', () => {
    player.load(createTestTimeline())
    // 创建带循环的 player
    const loopingPlayer = createTimelinePlayer(engine, 1.0, true)
    loopingPlayer.load(createTestTimeline())
    loopingPlayer.play()
    loopingPlayer.tick(3.0) // 超过 duration=2
    expect(loopingPlayer.isPlaying()).toBe(true)
    expect(loopingPlayer.getCurrentTime()).toBe(1.0) // 3 % 2 = 1
  })

  it('unload 应清除时间轴', () => {
    player.load(createTestTimeline())
    player.unload()
    expect(player.getTimeline()).toBeNull()
    expect(player.getCurrentTime()).toBe(0)
  })
})

// ============================================================================
// RevisionApplier 测试
// ============================================================================

describe('RevisionApplier', () => {
  let engine: PatchEngineLike

  beforeEach(() => {
    engine = createMockEngine(createBaseIR())
  })

  it('checkConflicts 无冲突时应返回 needsConfirmation=false', () => {
    const applier = createRevisionApplier(engine)
    let layer = createRevisionLayer()
    layer = addEntry(layer, createEntry('layer', 'layer_1', 'color', [0, 1, 0, 1], '测试'))
    const result = applier.checkConflicts(layer)
    expect(result.needsConfirmation).toBe(false)
    expect(result.conflicts).toHaveLength(0)
  })

  it('checkConflicts 与 l2_user 冲突时应返回 needsConfirmation=true', () => {
    // 构造一个 layer_1 有 l2_user owner 的 IR
    const ir = createBaseIR()
    ir.layers[0].paramOwnership = { color: 'l2_user' }
    const engineWithOwnership = createMockEngine(ir)

    const applier = createRevisionApplier(engineWithOwnership)
    let layer = createRevisionLayer()
    layer = addEntry(layer, createEntry('layer', 'layer_1', 'color', [0, 1, 0, 1], '测试'))
    const result = applier.checkConflicts(layer)
    expect(result.needsConfirmation).toBe(true)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].targetId).toBe('layer_1')
    expect(result.conflicts[0].paramKey).toBe('color')
    expect(result.conflicts[0].currentOwner).toBe('l2_user')
  })

  it('apply 无冲突时应成功应用', () => {
    const applier = createRevisionApplier(engine)
    let layer = createRevisionLayer()
    layer = addEntry(layer, createEntry('layer', 'layer_1', 'color', [0, 1, 0, 1], '测试'))
    const result = applier.apply(layer)
    expect(result.success).toBe(true)
    expect(result.needsConfirmation).toBe(false)
  })

  it('apply 有冲突且未强制时应返回 needsConfirmation', () => {
    const ir = createBaseIR()
    ir.layers[0].paramOwnership = { color: 'l2_user' }
    const engineWithOwnership = createMockEngine(ir)

    const applier = createRevisionApplier(engineWithOwnership)
    let layer = createRevisionLayer()
    layer = addEntry(layer, createEntry('layer', 'layer_1', 'color', [0, 1, 0, 1], '测试'))
    const result = applier.apply(layer, false)
    expect(result.success).toBe(false)
    expect(result.needsConfirmation).toBe(true)
  })

  it('apply force=true 时应强制应用（忽略 l2_user 否决权）', () => {
    const ir = createBaseIR()
    ir.layers[0].paramOwnership = { color: 'l2_user' }
    const engineWithOwnership = createMockEngine(ir)

    const applier = createRevisionApplier(engineWithOwnership)
    let layer = createRevisionLayer()
    layer = addEntry(layer, createEntry('layer', 'layer_1', 'color', [0, 1, 0, 1], '测试'))
    const result = applier.apply(layer, true)
    expect(result.success).toBe(true)
  })

  it('apply 空 Layer 应返回成功但 0 patch', () => {
    const applier = createRevisionApplier(engine)
    const layer = createRevisionLayer()
    const result = applier.apply(layer)
    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(0)
  })
})

// ============================================================================
// DirectorApplier 测试
// ============================================================================

describe('DirectorApplier', () => {
  let engine: PatchEngineLike

  beforeEach(() => {
    engine = createMockEngine(createBaseIR())
    mockedCallLLM.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applyFromPrompt LLM 成功时应应用 patch', async () => {
    mockedCallLLM.mockResolvedValueOnce({
      content: '{}',
      parsed: {
        scene: '测试',
        elements: [
          { type: 'background', color: [10, 20, 60], layer: 0, description: '夜空' },
        ],
      },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'test',
      latencyMs: 100,
      cached: false,
    })

    const applier = createDirectorApplier(engine)
    const result = await applier.applyFromPrompt('夜空', {
      providerConfig: null,
      disableCache: true,
    })

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBeGreaterThan(0)
  })

  it('applyFromPrompt 预览模式不应应用 patch', async () => {
    mockedCallLLM.mockResolvedValueOnce({
      content: '{}',
      parsed: {
        scene: '测试',
        elements: [
          { type: 'background', color: [10, 20, 60], layer: 0, description: '夜空' },
        ],
      },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'test',
      latencyMs: 100,
      cached: false,
    })

    const applier = createDirectorApplier(engine)
    const result = await applier.applyFromPrompt('夜空', {
      providerConfig: null,
      disableCache: true,
      preview: true,
    })

    expect(result.success).toBe(true)
    expect(result.appliedCount).toBe(0)
    expect(result.reasoning).toContain('预览')
  })

  it('applyFromPrompt LLM 失败应返回空决策', async () => {
    mockedCallLLM.mockRejectedValueOnce(new Error('network error'))

    const applier = createDirectorApplier(engine)
    const result = await applier.applyFromPrompt('test', {
      providerConfig: null,
      disableCache: true,
    })

    expect(result.success).toBe(true) // 空决策也是成功
    expect(result.appliedCount).toBe(0)
  })
})

// ============================================================================
// L3Orchestrator 端到端测试
// ============================================================================

describe('L3Orchestrator', () => {
  let engine: PatchEngineLike

  beforeEach(() => {
    engine = createMockEngine(createBaseIR())
    mockedCallLLM.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('应串联 Timeline 播放', () => {
    const orchestrator = createL3Orchestrator(engine)
    orchestrator.loadTimeline(createTestTimeline())
    orchestrator.playTimeline()
    expect(orchestrator.isTimelinePlaying()).toBe(true)

    const result = orchestrator.tick(1.0)
    expect(result.currentTime).toBe(1.0)
    expect(result.hasPatches).toBe(true)
  })

  it('应串联 Revision 应用', () => {
    const orchestrator = createL3Orchestrator(engine)
    let layer = createRevisionLayer()
    layer = addEntry(layer, createEntry('layer', 'layer_1', 'color', [0, 1, 0, 1], '测试'))

    const conflicts = orchestrator.checkRevisionConflicts(layer)
    expect(conflicts.needsConfirmation).toBe(false)

    const result = orchestrator.applyRevision(layer)
    expect(result.success).toBe(true)
  })

  it('应串联 Director 应用', async () => {
    mockedCallLLM.mockResolvedValueOnce({
      content: '{}',
      parsed: {
        scene: '测试',
        elements: [
          { type: 'background', color: [10, 20, 60], layer: 0, description: '夜空' },
        ],
      },
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'test',
      latencyMs: 100,
      cached: false,
    })

    const orchestrator = createL3Orchestrator(engine)
    const result = await orchestrator.applyDirectorFromPrompt('夜空', {
      providerConfig: null,
      disableCache: true,
    })

    expect(result.success).toBe(true)
  })

  it('tick 未加载时间轴时应返回空帧', () => {
    const orchestrator = createL3Orchestrator(engine)
    const result = orchestrator.tick(0.016)
    expect(result.hasPatches).toBe(false)
    expect(result.success).toBe(true)
  })

  it('getTimelinePlayer/getRevisionApplier/getDirectorApplier 应返回子模块', () => {
    const orchestrator = createL3Orchestrator(engine)
    expect(orchestrator.getTimelinePlayer()).toBeDefined()
    expect(orchestrator.getRevisionApplier()).toBeDefined()
    expect(orchestrator.getDirectorApplier()).toBeDefined()
  })
})
