/**
 * WDL ↔ ProTimeline 绑定 Tests(Step 38.6)
 *
 * 测试策略:
 * - 绑定 CRUD:addBinding / removeBinding / getBindingsForClip / getBindingsForLayer
 * - 属性提取:getClipPropertyValue(从 Clip 提取 speed/volume/transform.*)
 * - 值转换:computeParamValue(scale + offset)
 * - 补丁计算:computePatches(活跃 Clip + 绑定 → 参数补丁列表)
 * - 属性元数据:BINDABLE_PROPERTIES / getPropertyMetadata
 */
import { describe, it, expect } from 'vitest'
import {
  createBindingRegistry,
  addBinding,
  removeBinding,
  getBindingsForClip,
  getBindingsForLayer,
  getAllBindings,
  clearBindings,
  getClipPropertyValue,
  computeParamValue,
  computePatches,
  BINDABLE_PROPERTIES,
  getPropertyMetadata,
  type ClipBindableProperty,
  type ClipWdlBinding,
} from './wdlTimelineBinding'
import type { Clip } from '@/editor/timeline/core/clip'

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建测试用 Clip */
function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    kind: 'video',
    timelineStart: 0n,
    duration: 1000000n,
    sourceStart: 0n,
    sourceEnd: 1000000n,
    transform: { x: 100, y: 50, scale: 1.5, rotation: 30, opacity: 0.8 },
    speed: 1.0,
    volume: 0.7,
    enabled: true,
    locked: false,
    effects: [],
    ...overrides,
  }
}

/** 创建测试用绑定 */
function makeBinding(overrides: Partial<Omit<ClipWdlBinding, 'id'>> = {}): Omit<ClipWdlBinding, 'id'> {
  return {
    clipId: 'clip_1',
    clipProperty: 'speed',
    layerId: 'layer_0',
    paramKey: 'intensity',
    ...overrides,
  }
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL ↔ ProTimeline 绑定', () => {
  // ==========================================================================
  // 绑定 CRUD
  // ==========================================================================
  describe('绑定 CRUD', () => {
    it('B01: createBindingRegistry 应返回空注册表', () => {
      const reg = createBindingRegistry()
      expect(reg.bindings).toHaveLength(0)
    })

    it('B02: addBinding 应添加绑定并返回 ID', () => {
      const reg = createBindingRegistry()
      const id = addBinding(reg, makeBinding())
      expect(id).toBe('clip_1.speed')
      expect(reg.bindings).toHaveLength(1)
    })

    it('B03: 同 clipId + clipProperty 应覆盖旧绑定(幂等)', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ layerId: 'layer_a' }))
      addBinding(reg, makeBinding({ layerId: 'layer_b' }))
      expect(reg.bindings).toHaveLength(1)
      expect(reg.bindings[0].layerId).toBe('layer_b')
    })

    it('B04: 不同 clipProperty 应共存', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipProperty: 'speed', paramKey: 'intensity' }))
      addBinding(reg, makeBinding({ clipProperty: 'volume', paramKey: 'opacity' }))
      expect(reg.bindings).toHaveLength(2)
    })

    it('B05: removeBinding 应移除指定绑定', () => {
      const reg = createBindingRegistry()
      const id = addBinding(reg, makeBinding())
      removeBinding(reg, id)
      expect(reg.bindings).toHaveLength(0)
    })

    it('B06: removeBinding 不存在的 ID 应无操作', () => {
      const reg = createBindingRegistry()
      removeBinding(reg, 'nonexistent')
      expect(reg.bindings).toHaveLength(0)
    })

    it('B07: getBindingsForClip 应返回该 Clip 的所有绑定', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipId: 'c1', clipProperty: 'speed' }))
      addBinding(reg, makeBinding({ clipId: 'c1', clipProperty: 'volume' }))
      addBinding(reg, makeBinding({ clipId: 'c2', clipProperty: 'speed' }))
      expect(getBindingsForClip(reg, 'c1')).toHaveLength(2)
      expect(getBindingsForClip(reg, 'c2')).toHaveLength(1)
    })

    it('B08: getBindingsForLayer 应返回该 Layer 的所有绑定', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipId: 'c1', clipProperty: 'speed', layerId: 'l1', paramKey: 'intensity' }))
      addBinding(reg, makeBinding({ clipId: 'c1', clipProperty: 'volume', layerId: 'l1', paramKey: 'opacity' }))
      addBinding(reg, makeBinding({ clipId: 'c2', clipProperty: 'speed', layerId: 'l2', paramKey: 'scale' }))
      expect(getBindingsForLayer(reg, 'l1')).toHaveLength(2)
      expect(getBindingsForLayer(reg, 'l2')).toHaveLength(1)
    })

    it('B09: getAllBindings 应返回所有绑定的副本', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipProperty: 'speed' }))
      addBinding(reg, makeBinding({ clipProperty: 'volume' }))
      const all = getAllBindings(reg)
      expect(all).toHaveLength(2)
      // 修改副本不应影响原注册表
      all.push({ ...makeBinding(), id: 'fake', clipProperty: 'transform.x' })
      expect(reg.bindings).toHaveLength(2)
    })

    it('B10: clearBindings 应清空注册表', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding())
      addBinding(reg, makeBinding({ clipProperty: 'volume' }))
      clearBindings(reg)
      expect(reg.bindings).toHaveLength(0)
    })

    it('B11: 绑定应保留 scale 和 offset', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ scale: 2, offset: 0.5 }))
      expect(reg.bindings[0].scale).toBe(2)
      expect(reg.bindings[0].offset).toBe(0.5)
    })
  })

  // ==========================================================================
  // 属性提取
  // ==========================================================================
  describe('getClipPropertyValue', () => {
    it('P01: 应提取 speed', () => {
      const clip = makeClip({ speed: 2.5 })
      expect(getClipPropertyValue(clip, 'speed')).toBe(2.5)
    })

    it('P02: 应提取 volume', () => {
      const clip = makeClip({ volume: 0.3 })
      expect(getClipPropertyValue(clip, 'volume')).toBe(0.3)
    })

    it('P03: 应提取 transform.x', () => {
      const clip = makeClip({ transform: { x: 200, y: 0, scale: 1, rotation: 0, opacity: 1 } })
      expect(getClipPropertyValue(clip, 'transform.x')).toBe(200)
    })

    it('P04: 应提取 transform.scale', () => {
      const clip = makeClip({ transform: { x: 0, y: 0, scale: 3.5, rotation: 0, opacity: 1 } })
      expect(getClipPropertyValue(clip, 'transform.scale')).toBe(3.5)
    })

    it('P05: 应提取 transform.rotation', () => {
      const clip = makeClip({ transform: { x: 0, y: 0, scale: 1, rotation: 45, opacity: 1 } })
      expect(getClipPropertyValue(clip, 'transform.rotation')).toBe(45)
    })

    it('P06: 应提取 transform.opacity', () => {
      const clip = makeClip({ transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.6 } })
      expect(getClipPropertyValue(clip, 'transform.opacity')).toBe(0.6)
    })
  })

  // ==========================================================================
  // 值转换
  // ==========================================================================
  describe('computeParamValue', () => {
    it('V01: 无 scale 和 offset 应返回原值', () => {
      const binding: ClipWdlBinding = {
        id: 'test',
        clipId: 'c1',
        clipProperty: 'speed',
        layerId: 'l1',
        paramKey: 'intensity',
      }
      expect(computeParamValue(0.8, binding)).toBe(0.8)
    })

    it('V02: 有 scale 应乘以 scale', () => {
      const binding: ClipWdlBinding = {
        id: 'test',
        clipId: 'c1',
        clipProperty: 'speed',
        layerId: 'l1',
        paramKey: 'intensity',
        scale: 2,
      }
      expect(computeParamValue(0.5, binding)).toBe(1.0)
    })

    it('V03: 有 offset 应加 offset', () => {
      const binding: ClipWdlBinding = {
        id: 'test',
        clipId: 'c1',
        clipProperty: 'speed',
        layerId: 'l1',
        paramKey: 'intensity',
        offset: 0.3,
      }
      expect(computeParamValue(0.5, binding)).toBe(0.8)
    })

    it('V04: 同时有 scale 和 offset 应先乘后加', () => {
      const binding: ClipWdlBinding = {
        id: 'test',
        clipId: 'c1',
        clipProperty: 'speed',
        layerId: 'l1',
        paramKey: 'intensity',
        scale: 2,
        offset: 0.1,
      }
      // 0.5 * 2 + 0.1 = 1.1
      expect(computeParamValue(0.5, binding)).toBe(1.1)
    })

    it('V05: scale 为 0 应返回 offset', () => {
      const binding: ClipWdlBinding = {
        id: 'test',
        clipId: 'c1',
        clipProperty: 'speed',
        layerId: 'l1',
        paramKey: 'intensity',
        scale: 0,
        offset: 0.5,
      }
      expect(computeParamValue(100, binding)).toBe(0.5)
    })
  })

  // ==========================================================================
  // 补丁计算
  // ==========================================================================
  describe('computePatches', () => {
    it('C01: 活跃 Clip 有绑定应生成补丁', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({
        clipId: 'c1',
        clipProperty: 'speed',
        layerId: 'l1',
        paramKey: 'intensity',
      }))
      const clips = [makeClip({ id: 'c1', speed: 2.0 })]
      const patches = computePatches(clips, reg)
      expect(patches).toHaveLength(1)
      expect(patches[0].layerId).toBe('l1')
      expect(patches[0].paramKey).toBe('intensity')
      expect(patches[0].value).toBe(2.0)
    })

    it('C02: 非活跃 Clip 的绑定应被跳过', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipId: 'c1' }))
      addBinding(reg, makeBinding({ clipId: 'c2', clipProperty: 'volume' }))
      const clips = [makeClip({ id: 'c1' })]
      const patches = computePatches(clips, reg)
      expect(patches).toHaveLength(1)
      expect(patches[0].layerId).toBe('layer_0')
    })

    it('C03: 多个绑定应生成多个补丁', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipProperty: 'speed', paramKey: 'intensity' }))
      addBinding(reg, makeBinding({ clipProperty: 'volume', paramKey: 'opacity' }))
      addBinding(reg, makeBinding({ clipProperty: 'transform.scale', paramKey: 'scale' }))
      const clips = [makeClip()]
      const patches = computePatches(clips, reg)
      expect(patches).toHaveLength(3)
    })

    it('C04: 补丁值应应用 scale 和 offset', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({
        clipProperty: 'speed',
        paramKey: 'intensity',
        scale: 0.5,
        offset: 0.1,
      }))
      const clips = [makeClip({ speed: 2.0 })]
      const patches = computePatches(clips, reg)
      // 2.0 * 0.5 + 0.1 = 1.1
      expect(patches[0].value).toBeCloseTo(1.1)
    })

    it('C05: 空活跃 Clip 列表应返回空补丁', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding())
      const patches = computePatches([], reg)
      expect(patches).toHaveLength(0)
    })

    it('C06: 空注册表应返回空补丁', () => {
      const reg = createBindingRegistry()
      const clips = [makeClip()]
      const patches = computePatches(clips, reg)
      expect(patches).toHaveLength(0)
    })

    it('C07: 多 Clip 多绑定应正确匹配', () => {
      const reg = createBindingRegistry()
      addBinding(reg, makeBinding({ clipId: 'c1', clipProperty: 'speed', layerId: 'l1', paramKey: 'k1' }))
      addBinding(reg, makeBinding({ clipId: 'c2', clipProperty: 'volume', layerId: 'l2', paramKey: 'k2' }))
      const clips = [
        makeClip({ id: 'c1', speed: 1.5 }),
        makeClip({ id: 'c2', volume: 0.4 }),
      ]
      const patches = computePatches(clips, reg)
      expect(patches).toHaveLength(2)
      const p1 = patches.find((p) => p.layerId === 'l1')
      const p2 = patches.find((p) => p.layerId === 'l2')
      expect(p1?.value).toBe(1.5)
      expect(p2?.value).toBe(0.4)
    })
  })

  // ==========================================================================
  // 属性元数据
  // ==========================================================================
  describe('属性元数据', () => {
    it('M01: BINDABLE_PROPERTIES 应有 7 个属性', () => {
      expect(BINDABLE_PROPERTIES).toHaveLength(7)
    })

    it('M02: 每个属性应有 label/group/min/max/defaultValue', () => {
      for (const p of BINDABLE_PROPERTIES) {
        expect(p.label.length).toBeGreaterThan(0)
        expect(p.group.length).toBeGreaterThan(0)
        expect(typeof p.min).toBe('number')
        expect(typeof p.max).toBe('number')
        expect(typeof p.defaultValue).toBe('number')
      }
    })

    it('M03: getPropertyMetadata 应返回正确元数据', () => {
      const meta = getPropertyMetadata('speed')
      expect(meta).toBeDefined()
      expect(meta!.label).toBe('速度')
      expect(meta!.group).toBe('基础')
    })

    it('M04: getPropertyMetadata 不存在的属性应返回 undefined', () => {
      const meta = getPropertyMetadata('nonexistent' as ClipBindableProperty)
      expect(meta).toBeUndefined()
    })

    it('M05: transform 属性应在"变换"分组', () => {
      const meta = getPropertyMetadata('transform.x')
      expect(meta!.group).toBe('变换')
    })
  })
})
