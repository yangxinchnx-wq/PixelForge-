/**
 * Step 31.9 单元测试 — Sequence 模板/预设库。
 *
 * 覆盖:
 * - BT:    内置模板完整性(BUILTIN_TEMPLATES)
 * - INST:  模板实例化(instantiateTemplate)
 * - SER:   Sequence 序列化(serializeToTemplate)
 * - PERSIST: 自定义模板持久化(localStorage)
 * - VAL:   模板验证(validateTemplate)
 * - QUERY: 模板查询(getAllTemplates / findTemplateById)
 * - SI:    Store 集成(createSequenceFromTemplate / saveSequenceAsTemplate)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { createSequence } from './core/sequence'
import { TrackType } from './core/track'
import { seconds } from './core/time'
import {
  BUILTIN_TEMPLATES,
  instantiateTemplate,
  serializeToTemplate,
  loadCustomTemplates,
  saveCustomTemplates,
  addCustomTemplate,
  removeCustomTemplate,
  getAllTemplates,
  findTemplateById,
  validateTemplate,
  type SequenceTemplate,
} from './core/sequenceTemplate'
import { useProTimelineStore } from './store/timelineStore'

// ============================================================================
// localStorage mock
// ============================================================================

let storage: Record<string, string> = {}

beforeEach(() => {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
})

// ============================================================================
// BT: 内置模板
// ============================================================================

describe('BT: 内置模板完整性', () => {
  it('BT1: 内置模板数量 >= 5', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(5)
  })

  it('BT2: 每个内置模板字段完整', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.category).toBe('builtin')
      expect(t.width).toBeGreaterThan(0)
      expect(t.height).toBeGreaterThan(0)
      expect(t.fps).toBeGreaterThan(0)
      expect(t.durationSec).toBeGreaterThan(0)
      expect(t.tracks.length).toBeGreaterThan(0)
    }
  })

  it('BT3: 内置模板 ID 唯一', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('BT4: 内置模板包含横屏 1080p', () => {
    const hd = BUILTIN_TEMPLATES.find(
      (t) => t.width === 1920 && t.height === 1080 && t.fps === 30,
    )
    expect(hd).toBeDefined()
    expect(hd!.tracks.length).toBeGreaterThanOrEqual(2)
  })

  it('BT5: 内置模板包含竖屏', () => {
    const vertical = BUILTIN_TEMPLATES.find((t) => t.height > t.width)
    expect(vertical).toBeDefined()
    expect(vertical!.height).toBe(1920)
    expect(vertical!.width).toBe(1080)
  })

  it('BT6: 内置模板包含方形', () => {
    const square = BUILTIN_TEMPLATES.find((t) => t.width === t.height)
    expect(square).toBeDefined()
    expect(square!.width).toBe(square!.height)
  })

  it('BT7: 每个内置模板至少有 1 视频 + 1 音频轨道', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const hasVideo = t.tracks.some((tr) => tr.type === TrackType.VIDEO)
      const hasAudio = t.tracks.some((tr) => tr.type === TrackType.AUDIO)
      expect(hasVideo).toBe(true)
      expect(hasAudio).toBe(true)
    }
  })
})

// ============================================================================
// INST: 模板实例化
// ============================================================================

describe('INST: 模板实例化', () => {
  it('INST1: 实例化基础模板', () => {
    const template = BUILTIN_TEMPLATES[0]
    const seq = instantiateTemplate(template)
    expect(seq.id).toBeTruthy()
    expect(seq.name).toBe(template.name)
    expect(seq.width).toBe(template.width)
    expect(seq.height).toBe(template.height)
    expect(seq.fps).toBe(template.fps)
    expect(seq.tracks.length).toBe(template.tracks.length)
  })

  it('INST2: 实例化后轨道类型正确', () => {
    const template = BUILTIN_TEMPLATES[0]
    const seq = instantiateTemplate(template)
    for (let i = 0; i < template.tracks.length; i++) {
      expect(seq.tracks[i].type).toBe(template.tracks[i].type)
    }
  })

  it('INST3: 实例化后轨道无 Clip', () => {
    const template = BUILTIN_TEMPLATES[0]
    const seq = instantiateTemplate(template)
    for (const track of seq.tracks) {
      expect(track.clips.length).toBe(0)
    }
  })

  it('INST4: 实例化后每个轨道有唯一 ID', () => {
    const template = BUILTIN_TEMPLATES[0]
    const seq = instantiateTemplate(template)
    const ids = seq.tracks.map((t) => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('INST5: 实例化竖屏模板尺寸正确', () => {
    const vertical = BUILTIN_TEMPLATES.find((t) => t.height > t.width)!
    const seq = instantiateTemplate(vertical)
    expect(seq.width).toBe(1080)
    expect(seq.height).toBe(1920)
  })

  it('INST6: 实例化后 duration 正确(秒 → 微秒)', () => {
    const template = BUILTIN_TEMPLATES[0]
    const seq = instantiateTemplate(template)
    const durationSec = Number(seq.duration) / 1_000_000
    expect(durationSec).toBe(template.durationSec)
  })
})

// ============================================================================
// SER: Sequence 序列化
// ============================================================================

describe('SER: Sequence 序列化为模板', () => {
  it('SER1: 序列化基础 Sequence', () => {
    const seq = createSequence({ name: '测试序列', fps: 30, width: 1920, height: 1080 })
    const template = serializeToTemplate(seq, '我的模板')
    expect(template.name).toBe('我的模板')
    expect(template.category).toBe('custom')
    expect(template.width).toBe(1920)
    expect(template.height).toBe(1080)
    expect(template.fps).toBe(30)
  })

  it('SER2: 序列化提取轨道结构', () => {
    const seq = createSequence({ name: '测试' })
    const template = serializeToTemplate(seq, '模板')
    expect(template.tracks.length).toBe(seq.tracks.length)
    expect(template.tracks[0].type).toBe(seq.tracks[0].type)
  })

  it('SER3: 序列化时长转换正确(微秒 → 秒)', () => {
    const seq = createSequence({ duration: seconds(45) })
    const template = serializeToTemplate(seq, '模板')
    expect(template.durationSec).toBe(45)
  })

  it('SER4: 空名称时使用 Sequence 名称', () => {
    const seq = createSequence({ name: '源序列' })
    const template = serializeToTemplate(seq, '  ')
    expect(template.name).toBe('源序列')
  })

  it('SER5: 序列化不包含 Clip 数据', () => {
    const seq = createSequence({ name: '测试' })
    const template = serializeToTemplate(seq, '模板')
    // 模板 tracks 只有结构,无 clips 字段
    for (const t of template.tracks) {
      expect(t).not.toHaveProperty('clips')
    }
  })

  it('SER6: 自定义描述', () => {
    const seq = createSequence({ name: '源' })
    const template = serializeToTemplate(seq, '模板', '我的描述')
    expect(template.description).toBe('我的描述')
  })
})

// ============================================================================
// PERSIST: 自定义模板持久化
// ============================================================================

describe('PERSIST: 自定义模板持久化', () => {
  it('PERSIST1: 空存储返回空数组', () => {
    expect(loadCustomTemplates()).toEqual([])
  })

  it('PERSIST2: 添加自定义模板', () => {
    const template: SequenceTemplate = {
      id: 'custom-test-1',
      name: '测试模板',
      description: '测试',
      category: 'custom',
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 60,
      tracks: [{ type: TrackType.VIDEO }, { type: TrackType.AUDIO }],
    }
    const result = addCustomTemplate(template)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('custom-test-1')
    // 验证持久化
    const loaded = loadCustomTemplates()
    expect(loaded.length).toBe(1)
    expect(loaded[0].name).toBe('测试模板')
  })

  it('PERSIST3: 同名模板覆盖', () => {
    const t1: SequenceTemplate = {
      id: 'custom-1', name: '同名', description: 'v1', category: 'custom',
      width: 1920, height: 1080, fps: 30, durationSec: 60,
      tracks: [{ type: TrackType.VIDEO }],
    }
    const t2: SequenceTemplate = {
      id: 'custom-2', name: '同名', description: 'v2', category: 'custom',
      width: 1280, height: 720, fps: 24, durationSec: 30,
      tracks: [{ type: TrackType.VIDEO }],
    }
    addCustomTemplate(t1)
    addCustomTemplate(t2)
    const loaded = loadCustomTemplates()
    expect(loaded.length).toBe(1)
    expect(loaded[0].description).toBe('v2')
  })

  it('PERSIST4: 删除自定义模板', () => {
    const template: SequenceTemplate = {
      id: 'custom-del', name: '删除测试', description: 'test', category: 'custom',
      width: 1920, height: 1080, fps: 30, durationSec: 60,
      tracks: [{ type: TrackType.VIDEO }],
    }
    addCustomTemplate(template)
    expect(loadCustomTemplates().length).toBe(1)
    const result = removeCustomTemplate('custom-del')
    expect(result.length).toBe(0)
    expect(loadCustomTemplates().length).toBe(0)
  })

  it('PERSIST5: 保存数组到 localStorage', () => {
    const templates: SequenceTemplate[] = [
      {
        id: 'custom-a', name: 'A', description: 'a', category: 'custom',
        width: 1920, height: 1080, fps: 30, durationSec: 60,
        tracks: [{ type: TrackType.VIDEO }],
      },
      {
        id: 'custom-b', name: 'B', description: 'b', category: 'custom',
        width: 1080, height: 1920, fps: 30, durationSec: 30,
        tracks: [{ type: TrackType.VIDEO }],
      },
    ]
    saveCustomTemplates(templates)
    const loaded = loadCustomTemplates()
    expect(loaded.length).toBe(2)
    expect(loaded[0].id).toBe('custom-a')
    expect(loaded[1].id).toBe('custom-b')
  })

  it('PERSIST6: 损坏数据返回空数组', () => {
    storage['pf-sequence-templates'] = '{invalid json'
    expect(loadCustomTemplates()).toEqual([])
  })

  it('PERSIST7: 非数组数据返回空数组', () => {
    storage['pf-sequence-templates'] = '"not an array"'
    expect(loadCustomTemplates()).toEqual([])
  })
})

// ============================================================================
// VAL: 模板验证
// ============================================================================

describe('VAL: 模板验证', () => {
  function makeValid(): SequenceTemplate {
    return {
      id: 'test-val',
      name: '验证模板',
      description: 'test',
      category: 'custom',
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 60,
      tracks: [{ type: TrackType.VIDEO }],
    }
  }

  it('VAL1: 合法模板通过', () => {
    expect(validateTemplate(makeValid()).valid).toBe(true)
  })

  it('VAL2: 空 ID 失败', () => {
    const t = makeValid()
    t.id = ''
    const result = validateTemplate(t)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('ID')
  })

  it('VAL3: 空名称失败', () => {
    const t = makeValid()
    t.name = '  '
    const result = validateTemplate(t)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('名称')
  })

  it('VAL4: 无效分辨率失败', () => {
    const t = makeValid()
    t.width = 0
    const result = validateTemplate(t)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('分辨率')
  })

  it('VAL5: 无效帧率失败', () => {
    const t = makeValid()
    t.fps = 0
    const result = validateTemplate(t)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('帧率')
  })

  it('VAL6: 无效时长失败', () => {
    const t = makeValid()
    t.durationSec = -1
    const result = validateTemplate(t)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('时长')
  })

  it('VAL7: 空轨道列表失败', () => {
    const t = makeValid()
    t.tracks = []
    const result = validateTemplate(t)
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('轨道')
  })

  it('VAL8: 帧率 240 通过', () => {
    const t = makeValid()
    t.fps = 240
    expect(validateTemplate(t).valid).toBe(true)
  })

  it('VAL9: 帧率 241 失败', () => {
    const t = makeValid()
    t.fps = 241
    expect(validateTemplate(t).valid).toBe(false)
  })
})

// ============================================================================
// QUERY: 模板查询
// ============================================================================

describe('QUERY: 模板查询', () => {
  it('QUERY1: getAllTemplates 包含内置模板', () => {
    const all = getAllTemplates(false) // 不含自定义
    expect(all.length).toBe(BUILTIN_TEMPLATES.length)
  })

  it('QUERY2: getAllTemplates 含自定义', () => {
    const custom: SequenceTemplate = {
      id: 'custom-query', name: '查询测试', description: 'q', category: 'custom',
      width: 1920, height: 1080, fps: 30, durationSec: 60,
      tracks: [{ type: TrackType.VIDEO }],
    }
    addCustomTemplate(custom)
    const all = getAllTemplates(true)
    expect(all.length).toBe(BUILTIN_TEMPLATES.length + 1)
    expect(all.some((t) => t.id === 'custom-query')).toBe(true)
  })

  it('QUERY3: findTemplateById 找到内置', () => {
    const builtin = BUILTIN_TEMPLATES[0]
    const found = findTemplateById(builtin.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe(builtin.name)
  })

  it('QUERY4: findTemplateById 未找到返回 undefined', () => {
    const found = findTemplateById('nonexistent-id')
    expect(found).toBeUndefined()
  })

  it('QUERY5: findTemplateById 找到自定义', () => {
    const custom: SequenceTemplate = {
      id: 'custom-find', name: '查找', description: 'f', category: 'custom',
      width: 1920, height: 1080, fps: 30, durationSec: 60,
      tracks: [{ type: TrackType.VIDEO }],
    }
    addCustomTemplate(custom)
    const found = findTemplateById('custom-find')
    expect(found).toBeDefined()
    expect(found!.name).toBe('查找')
  })
})

// ============================================================================
// SI: Store 集成
// ============================================================================

describe('SI: Store 模板集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('SI1: createSequenceFromTemplate 创建新 Sequence', () => {
    const store = useProTimelineStore()
    store.reset()
    const initialCount = store.sequenceCount
    const template = BUILTIN_TEMPLATES[0]
    const newId = store.createSequenceFromTemplate(template)
    expect(newId).toBeTruthy()
    expect(store.sequenceCount).toBe(initialCount + 1)
    // 新 Sequence 存在
    const seq = store.findSequenceById(newId!)
    expect(seq).toBeTruthy()
    expect(seq!.width).toBe(template.width)
    expect(seq!.fps).toBe(template.fps)
    expect(seq!.tracks.length).toBe(template.tracks.length)
  })

  it('SI2: createSequenceFromTemplate 无效模板返回 null', () => {
    const store = useProTimelineStore()
    store.reset()
    const invalid: SequenceTemplate = {
      id: '', name: '', description: '', category: 'custom',
      width: 0, height: 0, fps: 0, durationSec: 0,
      tracks: [],
    }
    const result = store.createSequenceFromTemplate(invalid)
    expect(result).toBeNull()
  })

  it('SI3: saveSequenceAsTemplate 保存当前 Sequence', () => {
    const store = useProTimelineStore()
    store.reset()
    const seqId = store.activeSequenceId
    const saved = store.saveSequenceAsTemplate(seqId, '测试保存', '描述')
    expect(saved).toBeTruthy()
    expect(saved!.name).toBe('测试保存')
    expect(saved!.category).toBe('custom')
    // 持久化验证
    const custom = loadCustomTemplates()
    expect(custom.some((t) => t.id === saved!.id)).toBe(true)
  })

  it('SI4: saveSequenceAsTemplate 不存在的 Sequence 返回 null', () => {
    const store = useProTimelineStore()
    store.reset()
    const result = store.saveSequenceAsTemplate('nonexistent', 'name')
    expect(result).toBeNull()
  })

  it('SI5: saveSequenceAsTemplate 空名称返回 null', () => {
    const store = useProTimelineStore()
    store.reset()
    const seqId = store.activeSequenceId
    const result = store.saveSequenceAsTemplate(seqId, '  ')
    expect(result).toBeNull()
  })

  it('SI6: deleteCustomTemplate 删除自定义模板', () => {
    const store = useProTimelineStore()
    store.reset()
    // 先保存一个
    const seqId = store.activeSequenceId
    const saved = store.saveSequenceAsTemplate(seqId, '待删除')
    expect(saved).toBeTruthy()
    // 删除
    const result = store.deleteCustomTemplate(saved!.id)
    expect(result).toBe(true)
    // 确认已删除
    const found = findTemplateById(saved!.id)
    expect(found).toBeUndefined()
  })

  it('SI7: deleteCustomTemplate 内置模板不可删', () => {
    const store = useProTimelineStore()
    store.reset()
    const builtinId = BUILTIN_TEMPLATES[0].id
    const result = store.deleteCustomTemplate(builtinId)
    expect(result).toBe(false)
  })

  it('SI8: deleteCustomTemplate 不存在的 ID 返回 false', () => {
    const store = useProTimelineStore()
    store.reset()
    const result = store.deleteCustomTemplate('nonexistent')
    expect(result).toBe(false)
  })

  it('SI9: listTemplates 返回内置 + 自定义', () => {
    const store = useProTimelineStore()
    store.reset()
    // 无自定义时 = 内置数量
    const initial = store.listTemplates()
    expect(initial.length).toBe(BUILTIN_TEMPLATES.length)
    // 添加自定义
    const seqId = store.activeSequenceId
    store.saveSequenceAsTemplate(seqId, '列表测试')
    const after = store.listTemplates()
    expect(after.length).toBe(BUILTIN_TEMPLATES.length + 1)
  })

  it('SI10: createSequenceFromTemplate 支持撤销', () => {
    const store = useProTimelineStore()
    store.reset()
    const initialCount = store.sequenceCount
    const template = BUILTIN_TEMPLATES[0]
    store.createSequenceFromTemplate(template)
    expect(store.sequenceCount).toBe(initialCount + 1)
    // 撤销
    store.undo()
    expect(store.sequenceCount).toBe(initialCount)
    // 重做
    store.redo()
    expect(store.sequenceCount).toBe(initialCount + 1)
  })

  it('SI11: 从竖屏模板创建的 Sequence 尺寸正确', () => {
    const store = useProTimelineStore()
    store.reset()
    const vertical = BUILTIN_TEMPLATES.find((t) => t.height > t.width)!
    const newId = store.createSequenceFromTemplate(vertical)
    const seq = store.findSequenceById(newId!)
    expect(seq!.width).toBe(1080)
    expect(seq!.height).toBe(1920)
  })
})
