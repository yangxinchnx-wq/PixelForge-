import { describe, it, expect } from 'vitest'
import { parse } from '@/compiler/parser/ruleParser'
import { Opcode } from '@/shared/types'
import { validateStaticBoundary } from '@/compiler/ir/renderIR'
import type { ParsedIntent } from '@/authoring/types'
import { ParseError } from '@/authoring/types'

describe('ruleParser', () => {
  describe('基本转换', () => {
    it('应将单图层 ParsedIntent 转换为 RenderIR', () => {
      const intent: ParsedIntent = {
        layers: [{
          opcode: Opcode.SOLID_COLOR,
          params: { color: [0.9, 0.1, 0.1, 1] as unknown as ParsedIntent['layers'][0]['params']['color'] },
          blendMode: 'normal',
        }],
      }

      const ir = parse(intent)
      expect(ir.layers).toHaveLength(1)
      expect(ir.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      expect(ir.layers[0].id).toMatch(/^layer_[0-9a-f]{8}$/)
      expect(ir.layers[0].source).toBe('rule_parser')
      expect(ir.layers[0].visible).toBe(true)
      expect(ir.layers[0].blendMode).toBe('normal')
    })

    it('应将多图层 ParsedIntent 转换为 RenderIR', () => {
      const intent: ParsedIntent = {
        layers: [
          { opcode: Opcode.SOLID_COLOR, params: { color: [0.1, 0.2, 0.3, 1] as unknown as never }, blendMode: 'normal' },
          { opcode: Opcode.CIRCLE_SHAPE, params: { center: [0.5, 0.5] as unknown as never, radius: 0.3, fill: [1, 0, 0, 1] as unknown as never, background: [0, 0, 0, 0] as unknown as never }, blendMode: 'screen' },
        ],
      }

      const ir = parse(intent)
      expect(ir.layers).toHaveLength(2)
      expect(ir.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      expect(ir.layers[1].opcode).toBe(Opcode.CIRCLE_SHAPE)
      expect(ir.layers[1].blendMode).toBe('screen')
    })
  })

  describe('稳定 ID', () => {
    it('相同 intent 应生成相同 ID', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }

      const ir1 = parse(intent)
      const ir2 = parse(intent)
      expect(ir1.layers[0].id).toBe(ir2.layers[0].id)
    })

    it('不同 params 应生成不同 ID', () => {
      const intent1: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }
      const intent2: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [0, 0, 1, 1] as unknown as never } }],
      }

      const ir1 = parse(intent1)
      const ir2 = parse(intent2)
      expect(ir1.layers[0].id).not.toBe(ir2.layers[0].id)
    })
  })

  describe('source 和 paramOwnership', () => {
    it('所有图层 source 应为 rule_parser', () => {
      const intent: ParsedIntent = {
        layers: [
          { opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } },
          { opcode: Opcode.NOISE, params: { scale: 24, amount: 0.8 } },
        ],
      }

      const ir = parse(intent)
      expect(ir.layers.every((l) => l.source === 'rule_parser')).toBe(true)
    })

    it('所有参数 paramOwnership 应为 l2_parser', () => {
      const intent: ParsedIntent = {
        layers: [{
          opcode: Opcode.CIRCLE_SHAPE,
          params: { center: [0.5, 0.5] as unknown as never, radius: 0.3, fill: [1, 0, 0, 1] as unknown as never, background: [0, 0, 0, 0] as unknown as never },
        }],
      }

      const ir = parse(intent)
      const ownership = ir.layers[0].paramOwnership
      expect(ownership.center).toBe('l2_parser')
      expect(ownership.radius).toBe('l2_parser')
      expect(ownership.fill).toBe('l2_parser')
      expect(ownership.background).toBe('l2_parser')
    })
  })

  describe('默认区域', () => {
    it('应创建覆盖全画布的默认区域', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }

      const ir = parse(intent)
      expect(ir.regions).toHaveLength(1)
      expect(ir.regions[0].bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
      expect(ir.regions[0].layerRefs).toEqual([ir.layers[0].id])
      expect(ir.regions[0].source).toBe('rule_parser')
    })

    it('默认区域应包含所有图层 ID', () => {
      const intent: ParsedIntent = {
        layers: [
          { opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } },
          { opcode: Opcode.NOISE, params: { scale: 24, amount: 0.8 } },
          { opcode: Opcode.CIRCLE_SHAPE, params: { center: [0.5, 0.5] as unknown as never, radius: 0.3, fill: [1, 1, 0, 1] as unknown as never, background: [0, 0, 0, 0] as unknown as never } },
        ],
      }

      const ir = parse(intent)
      expect(ir.regions[0].layerRefs).toHaveLength(3)
      expect(ir.regions[0].layerRefs).toContain(ir.layers[0].id)
      expect(ir.regions[0].layerRefs).toContain(ir.layers[1].id)
      expect(ir.regions[0].layerRefs).toContain(ir.layers[2].id)
    })
  })

  describe('画布尺寸', () => {
    it('未指定 canvas 时应使用默认尺寸', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }

      const ir = parse(intent)
      expect(ir.canvas.width).toBe(1024)
      expect(ir.canvas.height).toBe(768)
    })

    it('指定 canvas 时应使用指定尺寸', () => {
      const intent: ParsedIntent = {
        canvas: { width: 512, height: 512 },
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }

      const ir = parse(intent)
      expect(ir.canvas.width).toBe(512)
      expect(ir.canvas.height).toBe(512)
    })
  })

  describe('compileHints', () => {
    it('应设置 preferredProfile 为 region', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }

      const ir = parse(intent)
      expect(ir.compileHints.preferredProfile).toBe('region')
    })
  })

  describe('效果转换', () => {
    it('应正确转换效果', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
        effects: [{
          type: 'blur',
          params: { radius: 0.005 },
          targetLayer: 'test',
        }],
      }

      const ir = parse(intent)
      expect(ir.effects).toHaveLength(1)
      expect(ir.effects[0].type).toBe('blur')
      expect(ir.effects[0].params.radius).toBe(0.005)
      expect(ir.effects[0].targetLayer).toBe('test')
      expect(ir.effects[0].id).toMatch(/^effect_[0-9a-f]{8}$/)
    })
  })

  describe('静态边界校验', () => {
    it('生成的 IR 应通过静态边界校验', () => {
      const intent: ParsedIntent = {
        layers: [
          { opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } },
          { opcode: Opcode.LINEAR_GRADIENT, params: { from: [0, 0] as unknown as never, to: [1, 1] as unknown as never, colorA: [0.1, 0.2, 0.9, 1] as unknown as never, colorB: [0.9, 0.3, 0.6, 1] as unknown as never } },
        ],
        effects: [{ type: 'blur', params: { radius: 0.01 } }],
      }

      const ir = parse(intent)
      const violations = validateStaticBoundary(ir)
      expect(violations).toHaveLength(0)
    })
  })

  describe('错误处理', () => {
    it('空 layers 应抛出 ParseError', () => {
      const intent: ParsedIntent = {
        layers: [],
      }

      expect(() => parse(intent)).toThrow(ParseError)
    })

    it('超过 64 个图层应抛出 ParseError', () => {
      const layers = Array.from({ length: 65 }, () => ({
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] as unknown as never },
      }))
      const intent: ParsedIntent = { layers }

      expect(() => parse(intent)).toThrow(ParseError)
    })
  })
})
