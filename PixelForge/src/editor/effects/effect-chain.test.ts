/**
 * Step 34 单元测试 — 视频效果链(Effect Chain)。
 *
 * 覆盖:
 * - EC:   效果创建与默认参数(createEffect / getDefaultParams)
 * - CH:   效果链操作(append / insert / remove / move / enable / update)
 * - Q:    查询(find / getEnabled / groupByCategory / count)
 * - V:    参数验证(validateEffectParams / validateEffectChain)
 * - P:    预设(BUILTIN_PRESETS / applyPreset)
 * - M:    元数据(getEffectDisplayName / getCategoryDisplayName / getEffectCategory)
 * - S:    Store 集成(effectChainStore actions)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import {
  createEffect,
  createEffectChain,
  appendEffect,
  insertEffect,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  updateEffectParams,
  renameEffect,
  setEffectCollapsed,
  findEffect,
  getEnabledEffects,
  getEffectCount,
  getEnabledCount,
  groupByCategory,
  validateEffectParams,
  validateEffectChain,
  getEffectDisplayName,
  getCategoryDisplayName,
  getEffectCategory,
  getDefaultParams,
  BUILTIN_PRESETS,
  findPresetById,
  applyPreset,
  genEffectId,
} from './effectChain'
import { useEffectChainStore } from './effectChainStore'

// ============================================================================
// EC: 效果创建与默认参数
// ============================================================================

describe('EC: 效果创建', () => {
  it('EC1: createEffect 创建基础效果', () => {
    const e = createEffect('brightness_contrast')
    expect(e.id).toBeTruthy()
    expect(e.type).toBe('brightness_contrast')
    expect(e.category).toBe('color')
    expect(e.enabled).toBe(true)
    expect(e.collapsed).toBe(false)
  })

  it('EC2: createEffect 默认名称为中文显示名', () => {
    const e = createEffect('gaussian_blur')
    expect(e.name).toBe('高斯模糊')
  })

  it('EC3: createEffect enabled=false', () => {
    const e = createEffect('vignette', false)
    expect(e.enabled).toBe(false)
  })

  it('EC4: getDefaultParams 亮度对比度', () => {
    const p = getDefaultParams('brightness_contrast')
    expect(p.brightness_contrast).toBeDefined()
    expect(p.brightness_contrast!.brightness).toBe(0)
    expect(p.brightness_contrast!.contrast).toBe(0)
  })

  it('EC5: getDefaultParams 色阶', () => {
    const p = getDefaultParams('levels')
    expect(p.levels).toBeDefined()
    expect(p.levels!.gamma).toBe(1.0)
  })

  it('EC6: getDefaultParams 模糊', () => {
    const p = getDefaultParams('gaussian_blur')
    expect(p.gaussian_blur).toBeDefined()
    expect(p.gaussian_blur!.radius).toBe(5)
  })

  it('EC7: getDefaultParams 变换', () => {
    const p = getDefaultParams('transform')
    expect(p.transform).toBeDefined()
    expect(p.transform!.scale).toBe(1)
    expect(p.transform!.anchorX).toBe(0.5)
  })

  it('EC8: getDefaultParams 混合模式', () => {
    const p = getDefaultParams('blend_mode')
    expect(p.blend_mode).toBeDefined()
    expect(p.blend_mode!.mode).toBe('normal')
    expect(p.blend_mode!.opacity).toBe(1)
  })

  it('EC9: getDefaultParams 返回深拷贝', () => {
    const p1 = getDefaultParams('vignette')
    p1.vignette!.amount = 999
    const p2 = getDefaultParams('vignette')
    expect(p2.vignette!.amount).not.toBe(999)
  })

  it('EC10: genEffectId 唯一性', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(genEffectId())
    }
    expect(ids.size).toBe(100)
  })

  it('EC11: createEffectChain 空链', () => {
    const chain = createEffectChain('clip-1')
    expect(chain.clipId).toBe('clip-1')
    expect(chain.effects).toEqual([])
  })
})

// ============================================================================
// CH: 效果链操作
// ============================================================================

describe('CH: 效果链操作', () => {
  it('CH1: appendEffect 添加到链尾', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(chain, e1)
    c = appendEffect(c, e2)
    expect(c.effects.length).toBe(2)
    expect(c.effects[0].id).toBe(e1.id)
    expect(c.effects[1].id).toBe(e2.id)
  })

  it('CH2: insertEffect 指定位置插入', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    const e3 = createEffect('noise')
    let c = appendEffect(chain, e1)
    c = appendEffect(c, e3)
    c = insertEffect(c, 1, e2)
    expect(c.effects[1].id).toBe(e2.id)
    expect(c.effects[2].id).toBe(e3.id)
  })

  it('CH3: insertEffect 索引越界 clamp', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(chain, e1)
    // 索引 100 超出长度,应 clamp 到末尾
    c = insertEffect(c, 100, e2)
    expect(c.effects.length).toBe(2)
    expect(c.effects[1].id).toBe(e2.id)
  })

  it('CH4: insertEffect 负索引 clamp 到 0', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(chain, e1)
    c = insertEffect(c, -5, e2)
    expect(c.effects[0].id).toBe(e2.id)
  })

  it('CH5: removeEffect 按 ID 删除', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(chain, e1)
    c = appendEffect(c, e2)
    c = removeEffect(c, e1.id)
    expect(c.effects.length).toBe(1)
    expect(c.effects[0].id).toBe(e2.id)
  })

  it('CH6: removeEffect 不存在 ID 无变化', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    let c = appendEffect(chain, e1)
    c = removeEffect(c, 'nonexistent')
    expect(c.effects.length).toBe(1)
  })

  it('CH7: moveEffect 上移', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    const e3 = createEffect('noise')
    let c = appendEffect(appendEffect(appendEffect(chain, e1), e2), e3)
    c = moveEffect(c, e2.id, 'up')
    expect(c.effects[0].id).toBe(e2.id)
    expect(c.effects[1].id).toBe(e1.id)
  })

  it('CH8: moveEffect 下移', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(appendEffect(chain, e1), e2)
    c = moveEffect(c, e1.id, 'down')
    expect(c.effects[0].id).toBe(e2.id)
    expect(c.effects[1].id).toBe(e1.id)
  })

  it('CH9: moveEffect 上移边界(已在顶部)', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(appendEffect(chain, e1), e2)
    c = moveEffect(c, e1.id, 'up')
    expect(c.effects[0].id).toBe(e1.id)
  })

  it('CH10: moveEffect 下移边界(已在底部)', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    let c = appendEffect(appendEffect(chain, e1), e2)
    c = moveEffect(c, e2.id, 'down')
    expect(c.effects[1].id).toBe(e2.id)
  })

  it('CH11: moveEffect 不存在 ID 返回原链', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const c = appendEffect(chain, e1)
    const c2 = moveEffect(c, 'nonexistent', 'up')
    expect(c2).toBe(c)
  })

  it('CH12: setEffectEnabled 禁用', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    let c = appendEffect(chain, e1)
    c = setEffectEnabled(c, e1.id, false)
    expect(c.effects[0].enabled).toBe(false)
  })

  it('CH13: setEffectEnabled 启用', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast', false)
    let c = appendEffect(chain, e1)
    c = setEffectEnabled(c, e1.id, true)
    expect(c.effects[0].enabled).toBe(true)
  })

  it('CH14: updateEffectParams 合并参数', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    let c = appendEffect(chain, e1)
    c = updateEffectParams(c, e1.id, {
      brightness_contrast: { brightness: 50, contrast: -30 },
    })
    expect(c.effects[0].params.brightness_contrast!.brightness).toBe(50)
    expect(c.effects[0].params.brightness_contrast!.contrast).toBe(-30)
  })

  it('CH15: renameEffect', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    let c = appendEffect(chain, e1)
    c = renameEffect(c, e1.id, '自定义亮度')
    expect(c.effects[0].name).toBe('自定义亮度')
  })

  it('CH16: setEffectCollapsed', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    let c = appendEffect(chain, e1)
    c = setEffectCollapsed(c, e1.id, true)
    expect(c.effects[0].collapsed).toBe(true)
  })

  it('CH17: 操作不可变(原链不变)', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const c = appendEffect(chain, e1)
    expect(chain.effects.length).toBe(0)
    expect(c.effects.length).toBe(1)
  })
})

// ============================================================================
// Q: 查询函数
// ============================================================================

describe('Q: 查询函数', () => {
  it('Q1: findEffect 找到', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const c = appendEffect(chain, e1)
    const found = findEffect(c, e1.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(e1.id)
  })

  it('Q2: findEffect 未找到', () => {
    const chain = createEffectChain('c1')
    const found = findEffect(chain, 'nonexistent')
    expect(found).toBeUndefined()
  })

  it('Q3: getEnabledEffects 过滤禁用', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast', true)
    const e2 = createEffect('vignette', false)
    const e3 = createEffect('noise', true)
    let c = appendEffect(appendEffect(appendEffect(chain, e1), e2), e3)
    const enabled = getEnabledEffects(c)
    expect(enabled.length).toBe(2)
    expect(enabled[0].id).toBe(e1.id)
    expect(enabled[1].id).toBe(e3.id)
  })

  it('Q4: getEffectCount', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    const e2 = createEffect('vignette')
    const c = appendEffect(appendEffect(chain, e1), e2)
    expect(getEffectCount(c)).toBe(2)
  })

  it('Q5: getEnabledCount', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast', true)
    const e2 = createEffect('vignette', false)
    const c = appendEffect(appendEffect(chain, e1), e2)
    expect(getEnabledCount(c)).toBe(1)
  })

  it('Q6: groupByCategory 分组', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast') // color
    const e2 = createEffect('gaussian_blur')       // blur
    const e3 = createEffect('vignette')             // stylize
    const e4 = createEffect('color_temperature')    // color
    let c = appendEffect(chain, e1)
    c = appendEffect(c, e2)
    c = appendEffect(c, e3)
    c = appendEffect(c, e4)
    const groups = groupByCategory(c)
    expect(groups.color.length).toBe(2)
    expect(groups.blur.length).toBe(1)
    expect(groups.stylize.length).toBe(1)
    expect(groups.transform.length).toBe(0)
    expect(groups.composite.length).toBe(0)
  })
})

// ============================================================================
// V: 参数验证
// ============================================================================

describe('V: 参数验证', () => {
  it('V1: validateEffectParams clamp 亮度', () => {
    const e = createEffect('brightness_contrast')
    e.params.brightness_contrast!.brightness = 200
    e.params.brightness_contrast!.contrast = -150
    const v = validateEffectParams(e)
    expect(v.params.brightness_contrast!.brightness).toBe(100)
    expect(v.params.brightness_contrast!.contrast).toBe(-100)
  })

  it('V2: validateEffectParams clamp 色相', () => {
    const e = createEffect('hue_saturation')
    e.params.hue_saturation!.hue = 360
    const v = validateEffectParams(e)
    expect(v.params.hue_saturation!.hue).toBe(180)
  })

  it('V3: validateEffectParams clamp 模糊半径', () => {
    const e = createEffect('gaussian_blur')
    e.params.gaussian_blur!.radius = -10
    const v = validateEffectParams(e)
    expect(v.params.gaussian_blur!.radius).toBe(0)
  })

  it('V4: validateEffectParams clamp 变换缩放', () => {
    const e = createEffect('transform')
    e.params.transform!.scale = 0
    const v = validateEffectParams(e)
    expect(v.params.transform!.scale).toBe(0.01)
  })

  it('V5: validateEffectParams clamp 裁剪', () => {
    const e = createEffect('crop')
    e.params.crop!.left = -0.5
    e.params.crop!.right = 2.0
    const v = validateEffectParams(e)
    expect(v.params.crop!.left).toBe(0)
    expect(v.params.crop!.right).toBe(1)
  })

  it('V6: validateEffectParams clamp 混合模式透明度', () => {
    const e = createEffect('blend_mode')
    e.params.blend_mode!.opacity = 1.5
    const v = validateEffectParams(e)
    expect(v.params.blend_mode!.opacity).toBe(1)
  })

  it('V7: validateEffectChain 合法链', () => {
    const chain = createEffectChain('c1')
    const e = createEffect('brightness_contrast')
    const c = appendEffect(chain, e)
    const r = validateEffectChain(c)
    expect(r.valid).toBe(true)
  })

  it('V8: validateEffectChain 空 Clip ID', () => {
    const chain = createEffectChain('')
    const r = validateEffectChain(chain)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('Clip ID')
  })

  it('V9: validateEffectChain 重复 ID', () => {
    const chain = createEffectChain('c1')
    const e1 = createEffect('brightness_contrast')
    // 手动构造重复 ID
    const e2: typeof e1 = { ...createEffect('vignette'), id: e1.id }
    let c = appendEffect(chain, e1)
    c = appendEffect(c, e2)
    const r = validateEffectChain(c)
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('重复')
  })
})

// ============================================================================
// P: 预设
// ============================================================================

describe('P: 效果预设', () => {
  it('P1: 内置预设数量 >= 3', () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(3)
  })

  it('P2: 每个预设字段完整', () => {
    for (const p of BUILTIN_PRESETS) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.description).toBeTruthy()
      expect(p.effects.length).toBeGreaterThan(0)
    }
  })

  it('P3: 内置预设 ID 唯一', () => {
    const ids = BUILTIN_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('P4: findPresetById 找到', () => {
    const preset = BUILTIN_PRESETS[0]
    const found = findPresetById(preset.id)
    expect(found).toBeDefined()
    expect(found!.name).toBe(preset.name)
  })

  it('P5: findPresetById 未找到', () => {
    expect(findPresetById('nonexistent')).toBeUndefined()
  })

  it('P6: applyPreset 追加效果到链', () => {
    const chain = createEffectChain('c1')
    const preset = BUILTIN_PRESETS[0]
    const c = applyPreset(chain, preset)
    expect(c.effects.length).toBe(preset.effects.length)
  })

  it('P7: applyPreset 生成新 ID 避免冲突', () => {
    const chain = createEffectChain('c1')
    const preset = BUILTIN_PRESETS[0]
    const c = applyPreset(chain, preset)
    for (let i = 0; i < preset.effects.length; i++) {
      expect(c.effects[i].id).not.toBe(preset.effects[i].id)
    }
  })

  it('P8: applyPreset 深拷贝参数', () => {
    const chain = createEffectChain('c1')
    const preset = BUILTIN_PRESETS[0]
    const c = applyPreset(chain, preset)
    // 修改应用后的参数不影响原预设
    c.effects[0].params = {}
    const c2 = applyPreset(chain, preset)
    expect(c2.effects[0].params).toBeDefined()
  })

  it('P9: applyPreset 保留已有效果', () => {
    const chain = createEffectChain('c1')
    const existing = createEffect('noise')
    const c1 = appendEffect(chain, existing)
    const preset = BUILTIN_PRESETS[0]
    const c2 = applyPreset(c1, preset)
    expect(c2.effects.length).toBe(1 + preset.effects.length)
    expect(c2.effects[0].id).toBe(existing.id)
  })
})

// ============================================================================
// M: 元数据
// ============================================================================

describe('M: 元数据', () => {
  it('M1: getEffectDisplayName 亮度对比度', () => {
    expect(getEffectDisplayName('brightness_contrast')).toBe('亮度对比度')
  })

  it('M2: getEffectDisplayName 高斯模糊', () => {
    expect(getEffectDisplayName('gaussian_blur')).toBe('高斯模糊')
  })

  it('M3: getCategoryDisplayName 色彩校正', () => {
    expect(getCategoryDisplayName('color')).toBe('色彩校正')
  })

  it('M4: getCategoryDisplayName 合成', () => {
    expect(getCategoryDisplayName('composite')).toBe('合成')
  })

  it('M5: getEffectCategory 亮度对比度属于 color', () => {
    expect(getEffectCategory('brightness_contrast')).toBe('color')
  })

  it('M6: getEffectCategory 高斯模糊属于 blur', () => {
    expect(getEffectCategory('gaussian_blur')).toBe('blur')
  })

  it('M7: getEffectCategory 键控属于 composite', () => {
    expect(getEffectCategory('keyer')).toBe('composite')
  })
})

// ============================================================================
// S: Store 集成
// ============================================================================

describe('S: Store 集成', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('S1: Store 初始状态', () => {
    const store = useEffectChainStore()
    expect(store.currentClipId).toBeNull()
    expect(store.currentChain).toBeNull()
    expect(store.currentEffects).toEqual([])
    expect(store.currentEffectCount).toBe(0)
  })

  it('S2: setCurrentClip 设置当前 Clip', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    expect(store.currentClipId).toBe('clip-1')
  })

  it('S3: addEffect 创建链并添加', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e = store.addEffect('brightness_contrast')
    expect(e).not.toBeNull()
    expect(store.currentEffectCount).toBe(1)
    expect(store.currentEffects[0].type).toBe('brightness_contrast')
  })

  it('S4: addEffect 无当前 Clip 返回 null', () => {
    const store = useEffectChainStore()
    const e = store.addEffect('brightness_contrast')
    expect(e).toBeNull()
  })

  it('S5: deleteEffect', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e = store.addEffect('brightness_contrast')
    store.deleteEffect(e!.id)
    expect(store.currentEffectCount).toBe(0)
  })

  it('S6: moveEffectOrder 上移', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e1 = store.addEffect('brightness_contrast')
    const e2 = store.addEffect('vignette')
    store.moveEffectOrder(e2!.id, 'up')
    expect(store.currentEffects[0].id).toBe(e2!.id)
    expect(store.currentEffects[1].id).toBe(e1!.id)
  })

  it('S7: toggleEffect 切换启用', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e = store.addEffect('brightness_contrast')
    expect(e!.enabled).toBe(true)
    store.toggleEffect(e!.id)
    expect(store.currentEffects[0].enabled).toBe(false)
    store.toggleEffect(e!.id)
    expect(store.currentEffects[0].enabled).toBe(true)
  })

  it('S8: setEffectParams 更新参数', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e = store.addEffect('brightness_contrast')
    store.setEffectParams(e!.id, {
      brightness_contrast: { brightness: 50, contrast: 20 },
    })
    expect(store.currentEffects[0].params.brightness_contrast!.brightness).toBe(50)
  })

  it('S9: toggleCollapsed', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e = store.addEffect('brightness_contrast')
    expect(e!.collapsed).toBe(false)
    store.toggleCollapsed(e!.id)
    expect(store.currentEffects[0].collapsed).toBe(true)
  })

  it('S10: applyPresetToCurrent', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const preset = BUILTIN_PRESETS[0]
    store.applyPresetToCurrent(preset.id)
    expect(store.currentEffectCount).toBe(preset.effects.length)
  })

  it('S11: clearAllEffects', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    store.addEffect('brightness_contrast')
    store.addEffect('vignette')
    expect(store.currentEffectCount).toBe(2)
    store.clearAllEffects()
    expect(store.currentEffectCount).toBe(0)
  })

  it('S12: removeChain 删除链', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    store.addEffect('brightness_contrast')
    store.removeChain('clip-1')
    expect(store.getChain('clip-1')).toBeNull()
    expect(store.currentClipId).toBeNull()
  })

  it('S13: 多 Clip 链独立', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-a')
    store.addEffect('brightness_contrast')
    store.setCurrentClip('clip-b')
    store.addEffect('vignette')
    store.addEffect('noise')
    // 切回 clip-a
    store.setCurrentClip('clip-a')
    expect(store.currentEffectCount).toBe(1)
    expect(store.currentEffects[0].type).toBe('brightness_contrast')
    // 切到 clip-b
    store.setCurrentClip('clip-b')
    expect(store.currentEffectCount).toBe(2)
  })

  it('S14: currentEnabledEffects 过滤', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e1 = store.addEffect('brightness_contrast')
    store.addEffect('vignette')
    store.toggleEffect(e1!.id)
    expect(store.currentEnabledCount).toBe(1)
    expect(store.currentEnabledEffects[0].type).toBe('vignette')
  })

  it('S15: reset 重置', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    store.addEffect('brightness_contrast')
    store.reset()
    expect(store.currentClipId).toBeNull()
    expect(store.chains.size).toBe(0)
  })

  it('S16: setEffectName', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    const e = store.addEffect('brightness_contrast')
    store.setEffectName(e!.id, '我的亮度')
    expect(store.currentEffects[0].name).toBe('我的亮度')
  })

  it('S17: presets computed 返回内置预设', () => {
    const store = useEffectChainStore()
    expect(store.presets.length).toBe(BUILTIN_PRESETS.length)
  })

  it('S18: currentGrouped 分组', () => {
    const store = useEffectChainStore()
    store.setCurrentClip('clip-1')
    store.addEffect('brightness_contrast')
    store.addEffect('gaussian_blur')
    store.addEffect('vignette')
    const grouped = store.currentGrouped
    expect(grouped.color.length).toBe(1)
    expect(grouped.blur.length).toBe(1)
    expect(grouped.stylize.length).toBe(1)
  })
})
