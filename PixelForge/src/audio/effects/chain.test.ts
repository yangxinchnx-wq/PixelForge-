import { describe, expect, it } from 'vitest'

import {
  AUDIO_EFFECT_PARAM_SPECS,
  appendAudioEffect,
  createAudioEffect,
  createAudioEffectChain,
  deserializeAudioEffectChain,
  findAudioEffect,
  genAudioEffectId,
  getAudioEffectCount,
  getAudioEffectLabel,
  getDefaultAudioEffectParams,
  getEnabledAudioEffectCount,
  getEnabledAudioEffects,
  insertAudioEffect,
  moveAudioEffect,
  removeAudioEffect,
  serializeAudioEffectChain,
  setAudioEffectEnabled,
  updateAudioEffectParams,
  validateAudioEffectChain,
  validateAudioEffectParams,
} from '@/audio/effects/chain'
import type { AudioEffectNode, AudioEffectType } from '@/audio/core/types'

const ALL_TYPES: AudioEffectType[] = ['eq', 'compressor', 'reverb', 'gain']

// ============================================================================
// 参数规范表测试
// ============================================================================

describe('AUDIO_EFFECT_PARAM_SPECS', () => {
  it('四种效果都应有参数规范', () => {
    for (const type of ALL_TYPES) {
      expect(AUDIO_EFFECT_PARAM_SPECS[type]).toBeDefined()
      expect(AUDIO_EFFECT_PARAM_SPECS[type].length).toBeGreaterThan(0)
    }
  })

  it('每条规范的默认值都应落在自身区间内', () => {
    for (const type of ALL_TYPES) {
      for (const spec of AUDIO_EFFECT_PARAM_SPECS[type]) {
        expect(spec.default).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default).toBeLessThanOrEqual(spec.max)
      }
    }
  })

  it('参数键不应重复', () => {
    for (const type of ALL_TYPES) {
      const keys = AUDIO_EFFECT_PARAM_SPECS[type].map((s) => s.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('getDefaultAudioEffectParams', () => {
  it('应返回规范表中的全部默认值', () => {
    for (const type of ALL_TYPES) {
      const params = getDefaultAudioEffectParams(type)
      for (const spec of AUDIO_EFFECT_PARAM_SPECS[type]) {
        expect(params[spec.key]).toBe(spec.default)
      }
    }
  })

  it('未知类型应返回空对象', () => {
    expect(getDefaultAudioEffectParams('unknown' as AudioEffectType)).toEqual({})
  })
})

describe('getAudioEffectLabel', () => {
  it('四种效果都应有中文显示名', () => {
    for (const type of ALL_TYPES) {
      expect(getAudioEffectLabel(type)).toBeTruthy()
    }
  })
})

// ============================================================================
// 构造测试
// ============================================================================

describe('genAudioEffectId', () => {
  it('应产生不重复的 id', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) ids.add(genAudioEffectId())
    expect(ids.size).toBe(100)
  })

  it('应带有统一前缀', () => {
    expect(genAudioEffectId().startsWith('afx-')).toBe(true)
  })
})

describe('createAudioEffect', () => {
  it('应创建启用状态的效果', () => {
    const e = createAudioEffect('eq')
    expect(e.enabled).toBe(true)
  })

  it('未指定参数时应使用默认值', () => {
    const e = createAudioEffect('compressor')
    expect(e.params.thresholdDb).toBe(-18)
    expect(e.params.ratio).toBe(4)
  })

  it('部分指定参数应覆盖默认值', () => {
    const e = createAudioEffect('eq', { lowGainDb: 6 })
    expect(e.params.lowGainDb).toBe(6)
    expect(e.params.midGainDb).toBe(0)
  })

  it('越界参数应被 clamp', () => {
    const e = createAudioEffect('eq', { lowGainDb: 100 })
    expect(e.params.lowGainDb).toBe(24)
  })

  it('应自动分配 id', () => {
    expect(createAudioEffect('gain').id).toBeTruthy()
  })
})

describe('createAudioEffectChain', () => {
  it('应返回空数组', () => {
    expect(createAudioEffectChain()).toEqual([])
  })
})

// ============================================================================
// 链操作测试
// ============================================================================

describe('appendAudioEffect', () => {
  it('应追加到链尾', () => {
    const e1 = createAudioEffect('eq')
    const e2 = createAudioEffect('gain')
    const chain = appendAudioEffect(appendAudioEffect([], e1), e2)
    expect(chain.map((e) => e.id)).toEqual([e1.id, e2.id])
  })

  it('不应修改原链', () => {
    const e1 = createAudioEffect('eq')
    const original: AudioEffectNode[] = []
    const next = appendAudioEffect(original, e1)
    expect(original).toHaveLength(0)
    expect(next).toHaveLength(1)
  })
})

describe('insertAudioEffect', () => {
  it('应在指定位置插入', () => {
    const e1 = createAudioEffect('eq')
    const e2 = createAudioEffect('gain')
    const e3 = createAudioEffect('reverb')
    let chain = appendAudioEffect(appendAudioEffect([], e1), e2)
    chain = insertAudioEffect(chain, e3, 1)
    expect(chain.map((e) => e.id)).toEqual([e1.id, e3.id, e2.id])
  })

  it('越界索引应被钳制', () => {
    const e1 = createAudioEffect('eq')
    const e2 = createAudioEffect('gain')
    const chain = appendAudioEffect([e1], e2)
    expect(insertAudioEffect(chain, createAudioEffect('reverb'), 99)).toHaveLength(3)
    expect(insertAudioEffect(chain, createAudioEffect('reverb'), -5)[0].type).toBe('reverb')
  })
})

describe('removeAudioEffect', () => {
  it('应按 id 移除', () => {
    const e1 = createAudioEffect('eq')
    const e2 = createAudioEffect('gain')
    const chain = appendAudioEffect(appendAudioEffect([], e1), e2)
    expect(removeAudioEffect(chain, e1.id).map((e) => e.id)).toEqual([e2.id])
  })

  it('id 不存在时应原样返回', () => {
    const chain = [createAudioEffect('eq')]
    expect(removeAudioEffect(chain, 'nope')).toHaveLength(1)
  })
})

describe('moveAudioEffect', () => {
  it('应移动到新位置', () => {
    const a = createAudioEffect('eq')
    const b = createAudioEffect('gain')
    const c = createAudioEffect('reverb')
    const chain = [a, b, c]
    expect(moveAudioEffect(chain, a.id, 2).map((e) => e.id)).toEqual([b.id, c.id, a.id])
  })

  it('向前移动时应正确重排', () => {
    const a = createAudioEffect('eq')
    const b = createAudioEffect('gain')
    const c = createAudioEffect('reverb')
    const chain = [a, b, c]
    expect(moveAudioEffect(chain, c.id, 0).map((e) => e.id)).toEqual([c.id, a.id, b.id])
  })

  it('长度应保持不变', () => {
    const chain = [createAudioEffect('eq'), createAudioEffect('gain')]
    expect(moveAudioEffect(chain, chain[0].id, 1)).toHaveLength(2)
  })

  it('id 不存在时应原样返回', () => {
    const chain = [createAudioEffect('eq')]
    expect(moveAudioEffect(chain, 'nope', 0)).toEqual(chain)
  })
})

describe('setAudioEffectEnabled', () => {
  it('应切换启用状态', () => {
    const e = createAudioEffect('eq')
    const chain = setAudioEffectEnabled([e], e.id, false)
    expect(chain[0].enabled).toBe(false)
  })

  it('不应影响其他效果', () => {
    const a = createAudioEffect('eq')
    const b = createAudioEffect('gain')
    const chain = setAudioEffectEnabled([a, b], a.id, false)
    expect(chain[0].enabled).toBe(false)
    expect(chain[1].enabled).toBe(true)
  })
})

describe('updateAudioEffectParams', () => {
  it('应更新指定参数', () => {
    const e = createAudioEffect('eq')
    const chain = updateAudioEffectParams([e], e.id, { lowGainDb: 8 })
    expect(chain[0].params.lowGainDb).toBe(8)
  })

  it('应 clamp 越界值', () => {
    const e = createAudioEffect('eq')
    const chain = updateAudioEffectParams([e], e.id, { lowGainDb: 999 })
    expect(chain[0].params.lowGainDb).toBe(24)
  })

  it('应忽略未知键', () => {
    const e = createAudioEffect('eq')
    const chain = updateAudioEffectParams([e], e.id, { bogusKey: 5 })
    expect(chain[0].params.bogusKey).toBeUndefined()
  })

  it('应应用跨参数约束(分频点有序)', () => {
    const e = createAudioEffect('eq')
    const chain = updateAudioEffectParams([e], e.id, { lowFreqHz: 8000, highFreqHz: 200 })
    expect(chain[0].params.highFreqHz).toBeGreaterThan(chain[0].params.lowFreqHz)
  })

  it('不应修改原链', () => {
    const e = createAudioEffect('eq')
    const original = [e]
    updateAudioEffectParams(original, e.id, { lowGainDb: 12 })
    expect(original[0].params.lowGainDb).toBe(0)
  })
})

// ============================================================================
// 查询测试
// ============================================================================

describe('findAudioEffect', () => {
  it('应能按 id 找到', () => {
    const e = createAudioEffect('eq')
    expect(findAudioEffect([e], e.id)?.id).toBe(e.id)
  })

  it('找不到时应返回 undefined', () => {
    expect(findAudioEffect([createAudioEffect('eq')], 'nope')).toBeUndefined()
  })
})

describe('getEnabledAudioEffects', () => {
  it('应只返回启用的效果并保持顺序', () => {
    const a = createAudioEffect('eq')
    const b = createAudioEffect('gain')
    const c = createAudioEffect('reverb')
    let chain = [a, b, c]
    chain = setAudioEffectEnabled(chain, b.id, false)
    expect(getEnabledAudioEffects(chain).map((e) => e.id)).toEqual([a.id, c.id])
  })
})

describe('计数', () => {
  it('应正确统计总数与启用数', () => {
    const a = createAudioEffect('eq')
    const b = createAudioEffect('gain')
    const chain = setAudioEffectEnabled([a, b], b.id, false)
    expect(getAudioEffectCount(chain)).toBe(2)
    expect(getEnabledAudioEffectCount(chain)).toBe(1)
  })
})

// ============================================================================
// 校验测试
// ============================================================================

describe('validateAudioEffectParams', () => {
  it('应补齐缺失参数', () => {
    const partial: AudioEffectNode = { id: 'x', type: 'reverb', enabled: true, params: {} }
    const fixed = validateAudioEffectParams(partial)
    expect(Object.keys(fixed.params).length).toBe(
      AUDIO_EFFECT_PARAM_SPECS.reverb.length,
    )
  })

  it('应丢弃规范表之外的键', () => {
    const dirty: AudioEffectNode = {
      id: 'x',
      type: 'eq',
      enabled: true,
      params: { lowGainDb: 3, junk: 99 },
    }
    expect(validateAudioEffectParams(dirty).params.junk).toBeUndefined()
  })

  it('应 clamp 越界参数', () => {
    const dirty: AudioEffectNode = {
      id: 'x',
      type: 'compressor',
      enabled: true,
      params: { ...getDefaultAudioEffectParams('compressor'), ratio: 999 },
    }
    expect(validateAudioEffectParams(dirty).params.ratio).toBe(20)
  })
})

describe('validateAudioEffectChain', () => {
  it('合法链应无问题', () => {
    const chain = [createAudioEffect('eq'), createAudioEffect('gain')]
    const result = validateAudioEffectChain(chain)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('应检测重复 id', () => {
    const e = createAudioEffect('eq')
    const result = validateAudioEffectChain([e, { ...e }])
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('重复'))).toBe(true)
  })

  it('应报告被修正的越界参数', () => {
    const e = { ...createAudioEffect('eq'), params: { ...getDefaultAudioEffectParams('eq'), lowGainDb: 999 } }
    const result = validateAudioEffectChain([e])
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.includes('越界'))).toBe(true)
  })

  it('修正后的链应合法', () => {
    const e = { ...createAudioEffect('eq'), params: { ...getDefaultAudioEffectParams('eq'), lowGainDb: 999 } }
    const result = validateAudioEffectChain([e])
    expect(result.chain[0].params.lowGainDb).toBe(24)
  })

  it('应检测未知效果类型', () => {
    const bogus = { id: 'x', type: 'bogus', enabled: true, params: {} } as unknown as AudioEffectNode
    const result = validateAudioEffectChain([bogus])
    expect(result.issues.some((i) => i.includes('未知'))).toBe(true)
  })
})

// ============================================================================
// 序列化测试
// ============================================================================

describe('serialize / deserialize', () => {
  it('round-trip 应保持结构与参数一致', () => {
    let chain = [createAudioEffect('eq', { lowGainDb: 6 }), createAudioEffect('reverb')]
    chain = setAudioEffectEnabled(chain, chain[0].id, false)

    const json = serializeAudioEffectChain(chain)
    const restored = deserializeAudioEffectChain(json)

    expect(restored).toHaveLength(2)
    expect(restored[0].type).toBe('eq')
    expect(restored[0].params.lowGainDb).toBe(6)
    expect(restored[0].enabled).toBe(false)
    expect(restored[1].type).toBe('reverb')
  })

  it('序列化所有效果类型都应 round-trip 成功', () => {
    const chain = ALL_TYPES.map((t) => createAudioEffect(t))
    const restored = deserializeAudioEffectChain(serializeAudioEffectChain(chain))
    expect(restored.map((e) => e.type)).toEqual(ALL_TYPES)
  })

  it('空链 round-trip 应为空', () => {
    expect(deserializeAudioEffectChain(serializeAudioEffectChain([]))).toEqual([])
  })

  it('非法 JSON 应返回空链而不是抛异常', () => {
    expect(deserializeAudioEffectChain('{ not json')).toEqual([])
  })

  it('非数组 JSON 应返回空链', () => {
    expect(deserializeAudioEffectChain('{"a":1}')).toEqual([])
  })

  it('空字符串应返回空链', () => {
    expect(deserializeAudioEffectChain('')).toEqual([])
  })

  it('应跳过结构非法的节点', () => {
    const json = JSON.stringify([{ id: 'ok', type: 'eq', enabled: true, params: {} }, { bad: true }])
    const restored = deserializeAudioEffectChain(json)
    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('ok')
  })

  it('应跳过未知类型的节点', () => {
    const json = JSON.stringify([{ id: 'x', type: 'bogus', enabled: true, params: {} }])
    expect(deserializeAudioEffectChain(json)).toHaveLength(0)
  })

  it('反序列化后参数应被 clamp', () => {
    const json = JSON.stringify([
      { id: 'x', type: 'eq', enabled: true, params: { ...getDefaultAudioEffectParams('eq'), lowGainDb: 999 } },
    ])
    expect(deserializeAudioEffectChain(json)[0].params.lowGainDb).toBe(24)
  })
})
