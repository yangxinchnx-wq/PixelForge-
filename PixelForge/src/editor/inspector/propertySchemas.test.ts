/**
 * propertySchemas 测试
 *
 * 测试覆盖：
 *   K1  SOLID_COLOR → 包含 Color 组 + Render 组
 *   K2  LINEAR_GRADIENT → 包含 Gradient 组 + Render 组
 *   K3  NOISE → 包含 Noise 组 + Render 组
 *   K4  CIRCLE_SHAPE → 包含 Circle 组 + Render 组
 *   K5  未知 opcode → 兜底只含 Render 组
 *   K6  Render 组始终包含 opcode/blendMode/visible 三个属性
 *   K7  blendMode 选项包含全部 6 种混合模式
 *   K8  opcode 字段为 readonly
 *   K9  SOLID_COLOR 的 color 属性 type 为 'color'
 *   K10 NOISE 的 scale 属性 type 为 'number' 且有 min/max/step
 *   K11 CIRCLE_SHAPE 的 radius 属性 type 为 'slider' 且有 min/max/step
 */

import { describe, it, expect } from 'vitest'

import { getGroupsForOpcode, getBlendModeOptions } from './propertySchemas'

describe('K. propertySchemas opcode→schema 映射', () => {
  it('K1 SOLID_COLOR → 包含 Color 组 + Render 组', () => {
    const groups = getGroupsForOpcode('SOLID_COLOR')
    expect(groups.length).toBe(2)
    expect(groups[0].name).toBe('Color')
    expect(groups[1].name).toBe('Render')
  })

  it('K2 LINEAR_GRADIENT → 包含 Gradient 组 + Render 组', () => {
    const groups = getGroupsForOpcode('LINEAR_GRADIENT')
    expect(groups.length).toBe(2)
    expect(groups[0].name).toBe('Gradient')
    expect(groups[1].name).toBe('Render')
  })

  it('K3 NOISE → 包含 Noise 组 + Render 组', () => {
    const groups = getGroupsForOpcode('NOISE')
    expect(groups.length).toBe(2)
    expect(groups[0].name).toBe('Noise')
    expect(groups[1].name).toBe('Render')
  })

  it('K4 CIRCLE_SHAPE → 包含 Circle 组 + Render 组', () => {
    const groups = getGroupsForOpcode('CIRCLE_SHAPE')
    expect(groups.length).toBe(2)
    expect(groups[0].name).toBe('Circle')
    expect(groups[1].name).toBe('Render')
  })

  it('K5 未知 opcode → 兜底只含 Render 组', () => {
    const groups = getGroupsForOpcode('UNKNOWN_OPCODE')
    expect(groups.length).toBe(1)
    expect(groups[0].name).toBe('Render')
  })

  it('K6 Render 组始终包含 opcode/blendMode/visible 三个属性', () => {
    const groups = getGroupsForOpcode('SOLID_COLOR')
    const renderGroup = groups.find((g) => g.name === 'Render')!
    const keys = renderGroup.properties.map((p) => p.key)
    expect(keys).toContain('__opcode__')
    expect(keys).toContain('__blendMode__')
    expect(keys).toContain('__visible__')
    expect(renderGroup.properties.length).toBe(3)
  })

  it('K7 blendMode 选项包含全部 6 种混合模式', () => {
    const options = getBlendModeOptions()
    expect(options.length).toBe(6)
    const values = options.map((o) => o.value)
    expect(values).toEqual(['normal', 'multiply', 'screen', 'overlay', 'add', 'subtract'])
  })

  it('K8 opcode 字段为 readonly', () => {
    const groups = getGroupsForOpcode('SOLID_COLOR')
    const renderGroup = groups.find((g) => g.name === 'Render')!
    const opcodeProp = renderGroup.properties.find((p) => p.key === '__opcode__')!
    expect(opcodeProp.readonly).toBe(true)
  })

  it('K9 SOLID_COLOR 的 color 属性 type 为 color', () => {
    const groups = getGroupsForOpcode('SOLID_COLOR')
    const colorGroup = groups.find((g) => g.name === 'Color')!
    const colorProp = colorGroup.properties.find((p) => p.key === 'color')!
    expect(colorProp.type).toBe('color')
  })

  it('K10 NOISE 的 scale 属性 type 为 number 且有 min/max/step', () => {
    const groups = getGroupsForOpcode('NOISE')
    const noiseGroup = groups.find((g) => g.name === 'Noise')!
    const scaleProp = noiseGroup.properties.find((p) => p.key === 'scale')!
    expect(scaleProp.type).toBe('number')
    expect(scaleProp.min).toBeDefined()
    expect(scaleProp.max).toBeDefined()
    expect(scaleProp.step).toBeDefined()
  })

  it('K11 CIRCLE_SHAPE 的 radius 属性 type 为 slider 且有 min/max/step', () => {
    const groups = getGroupsForOpcode('CIRCLE_SHAPE')
    const circleGroup = groups.find((g) => g.name === 'Circle')!
    const radiusProp = circleGroup.properties.find((p) => p.key === 'radius')!
    expect(radiusProp.type).toBe('slider')
    expect(radiusProp.min).toBeDefined()
    expect(radiusProp.max).toBeDefined()
    expect(radiusProp.step).toBeDefined()
  })
})
