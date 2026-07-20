import { describe, it, expect } from 'vitest'
import { validateParsedIntent, validateRenderIR, SCHEMA_IDS } from '@/authoring/schema/schemas'
import { Opcode } from '@/shared/types'
import type { ParsedIntent } from '@/authoring/types'
import { createPhaseADemoIR } from '@/compiler/region/demoIR'
import { ParseError } from '@/authoring/types'

describe('Schema 校验', () => {
  describe('validateParsedIntent', () => {
    it('合法 intent 应通过校验', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }
      expect(() => validateParsedIntent(intent)).not.toThrow()
    })

    it('空 layers 应抛出错误', () => {
      const intent: ParsedIntent = { layers: [] }
      expect(() => validateParsedIntent(intent)).toThrow(ParseError)
    })

    it('BLEND opcode 应被拒绝', () => {
      const intent: ParsedIntent = {
        layers: [{ opcode: Opcode.BLEND, params: {} }],
      }
      expect(() => validateParsedIntent(intent)).toThrow(ParseError)
    })

    it('超过 64 个图层应抛出错误', () => {
      const layers = Array.from({ length: 65 }, () => ({
        opcode: Opcode.SOLID_COLOR,
        params: { color: [1, 0, 0, 1] as unknown as never },
      }))
      const intent: ParsedIntent = { layers }
      expect(() => validateParsedIntent(intent)).toThrow(ParseError)
    })

    it('无效 canvas 尺寸应抛出错误', () => {
      const intent: ParsedIntent = {
        canvas: { width: -1, height: 100 },
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }
      expect(() => validateParsedIntent(intent)).toThrow(ParseError)
    })

    it('canvas 尺寸过大应抛出错误', () => {
      const intent: ParsedIntent = {
        canvas: { width: 99999, height: 100 },
        layers: [{ opcode: Opcode.SOLID_COLOR, params: { color: [1, 0, 0, 1] as unknown as never } }],
      }
      expect(() => validateParsedIntent(intent)).toThrow(ParseError)
    })
  })

  describe('validateRenderIR', () => {
    it('合法 RenderIR 应通过校验', () => {
      const ir = createPhaseADemoIR('gradient')
      expect(() => validateRenderIR(ir)).not.toThrow()
    })

    it('多图层 IR 应通过校验', () => {
      const ir = createPhaseADemoIR('multi_layer')
      expect(() => validateRenderIR(ir)).not.toThrow()
    })

    it('效果演示 IR 应通过校验', () => {
      const ir = createPhaseADemoIR('effect_demo')
      expect(() => validateRenderIR(ir)).not.toThrow()
    })
  })

  describe('SCHEMA_IDS', () => {
    it('应包含正确的 schema 标识', () => {
      expect(SCHEMA_IDS.PARSED_INTENT).toBe('pixelforge.parsedIntent.v1')
      expect(SCHEMA_IDS.RENDER_IR).toBe('pixelforge.renderIR.v1')
      expect(SCHEMA_IDS.PATCH).toBe('pixelforge.patch.v1')
      expect(SCHEMA_IDS.COMPILE_RESULT).toBe('pixelforge.compileResult.v1')
    })
  })
})
