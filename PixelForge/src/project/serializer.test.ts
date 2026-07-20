import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { createPhaseADemoIR } from '@/compiler/region/demoIR'
import { useHistoryStore } from '@/stores/history'
import { useTimelineStore } from '@/stores/timeline'

import { deserializeProject, serializeProject, createProjectSnapshot } from './serializer'
import type { PixelForgeProject } from './types'

// —— 模拟 runtime store 的最小接口(createProjectSnapshot 只用到 currentIr / currentScenario) ——
function createMockRuntime(currentIr: ReturnType<typeof createPhaseADemoIR>) {
  return {
    currentIr,
    currentScenario: 'blend_demo' as const,
  }
}

describe('project serializer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('createProjectSnapshot', () => {
    it('从 store 状态创建快照,包含完整 metadata', () => {
      const timeline = useTimelineStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      const project = createProjectSnapshot('Test Project', runtime as never, timeline)

      expect(project.metadata.name).toBe('Test Project')
      expect(project.metadata.id).toBeTruthy()
      expect(project.metadata.version).toBe('0.1.0')
      expect(project.metadata.createdAt).toBeGreaterThan(0)
      expect(project.metadata.updatedAt).toBe(project.metadata.createdAt)
      expect(project.metadata.scenario).toBe('blend_demo')
      expect(project.metadata.canvasSize).toEqual({ width: 1024, height: 768 })
    })

    it('快照中的 renderIR 是深拷贝(不共享引用)', () => {
      const timeline = useTimelineStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      const project = createProjectSnapshot('Test', runtime as never, timeline)
      // 修改快照不影响原 IR
      project.renderIR.layers[0].id = 'modified'
      expect(ir.layers[0].id).not.toBe('modified')
    })

    it('快照中的 timeline.tracks 是深拷贝', () => {
      const timeline = useTimelineStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      const project = createProjectSnapshot('Test', runtime as never, timeline)
      const originalTrackId = timeline.tracks[0].id
      project.timeline.tracks[0].id = 'modified'
      expect(timeline.tracks[0].id).toBe(originalTrackId)
    })

    it('传入 history 时,历史栈被序列化', () => {
      const timeline = useTimelineStore()
      const history = useHistoryStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      history.pushEntry({
        id: 'p1',
        description: 'a.x -> 1',
        targetId: 'a',
        paramKey: 'x',
        oldValue: 0,
        newValue: 1,
      })

      const project = createProjectSnapshot('Test', runtime as never, timeline, history)
      expect(project.history).toBeDefined()
      expect(project.history).toHaveLength(1)
      expect(project.history?.[0].id).toBe('p1')
    })

    it('不传 history 时,history 字段为 undefined', () => {
      const timeline = useTimelineStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      const project = createProjectSnapshot('Test', runtime as never, timeline)
      expect(project.history).toBeUndefined()
    })

    it('baseOn 参数:保留 id / createdAt,更新 name / updatedAt', () => {
      const timeline = useTimelineStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      const baseMeta = {
        id: 'original-id',
        name: 'Old Name',
        version: '0.1.0',
        createdAt: 1000,
        updatedAt: 1000,
        scenario: 'blend_demo',
        canvasSize: { width: 1024, height: 768 },
      }
      const project = createProjectSnapshot('New Name', runtime as never, timeline, undefined, baseMeta)
      expect(project.metadata.id).toBe('original-id')
      expect(project.metadata.createdAt).toBe(1000)
      expect(project.metadata.name).toBe('New Name')
      expect(project.metadata.updatedAt).toBeGreaterThan(1000)
    })
  })

  describe('serializeProject / deserializeProject', () => {
    it('序列化 → 反序列化 往返一致', () => {
      const timeline = useTimelineStore()
      const ir = createPhaseADemoIR('blend_demo')
      const runtime = createMockRuntime(ir)

      const original = createProjectSnapshot('Round Trip', runtime as never, timeline)
      const json = serializeProject(original)
      const restored = deserializeProject(json)

      expect(restored.metadata.name).toBe(original.metadata.name)
      expect(restored.metadata.id).toBe(original.metadata.id)
      expect(restored.renderIR.canvas).toEqual(original.renderIR.canvas)
      expect(restored.renderIR.layers).toHaveLength(original.renderIR.layers.length)
      expect(restored.timeline.currentFrame).toBe(original.timeline.currentFrame)
      expect(restored.timeline.tracks).toHaveLength(original.timeline.tracks.length)
    })

    it('deserializeProject:非法 JSON 抛错', () => {
      expect(() => deserializeProject('not json {')).toThrow(/JSON 解析失败/)
    })

    it('deserializeProject:非对象根抛错', () => {
      expect(() => deserializeProject('123')).toThrow(/根必须是对象/)
    })

    it('deserializeProject:缺 metadata 抛错', () => {
      const bad = JSON.stringify({ renderIR: {}, timeline: {} })
      expect(() => deserializeProject(bad)).toThrow(/缺少 metadata/)
    })

    it('deserializeProject:缺 renderIR 抛错', () => {
      const bad = JSON.stringify({
        metadata: { id: 'x', name: 'x' },
        timeline: {},
      })
      expect(() => deserializeProject(bad)).toThrow(/缺少 renderIR/)
    })

    it('deserializeProject:metadata 缺 id 抛错', () => {
      const bad = JSON.stringify({
        metadata: { name: 'x' },
        renderIR: {},
        timeline: {},
      })
      expect(() => deserializeProject(bad)).toThrow(/缺少 id \/ name/)
    })

    it('serializeProject:输出 2 空格缩进', () => {
      const project: PixelForgeProject = {
        metadata: {
          id: 'test',
          name: 'Test',
          version: '0.1.0',
          createdAt: 0,
          updatedAt: 0,
          scenario: 'blend_demo',
          canvasSize: { width: 1024, height: 768 },
        },
        renderIR: createPhaseADemoIR('blend_demo'),
        timeline: {
          currentFrame: 0,
          totalFrames: 300,
          fps: 60,
          tracks: [],
        },
      }
      const json = serializeProject(project)
      // 2 空格缩进会包含 '  "'(2 个空格 + 引号)
      expect(json).toContain('\n  "')
      expect(json).not.toContain('\n    "metadata"') // 4 空格缩进会失败
    })
  })
})
