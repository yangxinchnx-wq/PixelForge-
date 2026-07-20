/**
 * validateLLMOutput 单元测试
 */

import { describe, it, expect } from 'vitest'
import { validateLLMOutput } from '@/authoring/schema/schemas'
import type { LLMOutput } from '@/authoring/llm/types'

describe('validateLLMOutput', () => {
  // --------------------------------------------------------------------------
  // 合法输入
  // --------------------------------------------------------------------------

  describe('合法输入', () => {
    it('应通过完整合法的 LLMOutput', () => {
      const output: LLMOutput = {
        scene: '星空夜景',
        style: '写实',
        elements: [
          { type: 'background', description: '深蓝夜空', color: [10, 20, 60], layer: 0 },
          { type: 'starfield', description: '星星', color: [255, 255, 200], layer: 1 },
        ],
        dominantColors: [[10, 20, 60], [255, 255, 200]],
      }

      expect(() => validateLLMOutput(output)).not.toThrow()
    })

    it('应通过最小合法的 LLMOutput（无 style/dominantColors）', () => {
      const output: LLMOutput = {
        scene: 'test',
        elements: [{ type: 'background', layer: 0 }],
      }

      expect(() => validateLLMOutput(output)).not.toThrow()
    })

    it('应通过无 color 的 element', () => {
      const output: LLMOutput = {
        scene: 'test',
        elements: [{ type: 'noise', layer: 0, description: 'noise' }],
      }

      expect(() => validateLLMOutput(output)).not.toThrow()
    })

    it('应通过无 description 的 element', () => {
      const output: LLMOutput = {
        scene: 'test',
        elements: [{ type: 'background', color: [0, 0, 0], layer: 0 }],
      }

      expect(() => validateLLMOutput(output)).not.toThrow()
    })
  })

  // --------------------------------------------------------------------------
  // 非法输入
  // --------------------------------------------------------------------------

  describe('非法输入', () => {
    it('null 应抛出错误', () => {
      expect(() => validateLLMOutput(null)).toThrow('不是对象')
    })

    it('非对象应抛出错误', () => {
      expect(() => validateLLMOutput('string')).toThrow('不是对象')
      expect(() => validateLLMOutput(123)).toThrow('不是对象')
      expect(() => validateLLMOutput([])).toThrow('不是对象')
    })

    it('scene 不是字符串应抛出错误', () => {
      const output = { scene: 123, elements: [{ type: 'bg', layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('scene 不是非空字符串')
    })

    it('scene 为空字符串应抛出错误', () => {
      const output = { scene: '', elements: [{ type: 'bg', layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('scene 不是非空字符串')
    })

    it('elements 为空数组应抛出错误', () => {
      const output = { scene: 'test', elements: [] }
      expect(() => validateLLMOutput(output)).toThrow('elements 为空或非数组')
    })

    it('elements 不是数组应抛出错误', () => {
      const output = { scene: 'test', elements: 'not array' }
      expect(() => validateLLMOutput(output)).toThrow('elements 为空或非数组')
    })

    it('elements 超过 64 个应抛出错误', () => {
      const elements = Array.from({ length: 65 }, (_, i) => ({
        type: 'bg', layer: i,
      }))
      const output = { scene: 'test', elements }
      expect(() => validateLLMOutput(output)).toThrow('超过上限 64')
    })

    it('element.type 不是字符串应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 123, layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('type 不是非空字符串')
    })

    it('element.type 为空字符串应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: '', layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('type 不是非空字符串')
    })

    it('element.layer 不是整数应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', layer: 1.5 }] }
      expect(() => validateLLMOutput(output)).toThrow('layer 不是非负整数')
    })

    it('element.layer 为负数应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', layer: -1 }] }
      expect(() => validateLLMOutput(output)).toThrow('layer 不是非负整数')
    })

    it('element 不是对象应抛出错误', () => {
      const output = { scene: 'test', elements: ['not object'] }
      expect(() => validateLLMOutput(output)).toThrow('不是对象')
    })

    it('element.color 不是三元组应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', color: [1, 2], layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('不是 [r, g, b] 三元组')
    })

    it('element.color 值超出 0-255 应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', color: [300, 0, 0], layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('不是 0-255 范围的数字')
    })

    it('element.color 值为负数应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', color: [-1, 0, 0], layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('不是 0-255 范围的数字')
    })

    it('element.description 不是字符串应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', description: 123, layer: 0 }] }
      expect(() => validateLLMOutput(output)).toThrow('description 不是字符串')
    })

    it('dominantColors 不是数组应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', layer: 0 }], dominantColors: 'not array' }
      expect(() => validateLLMOutput(output)).toThrow('dominantColors 不是数组')
    })

    it('dominantColors 中的颜色不是三元组应抛出错误', () => {
      const output = { scene: 'test', elements: [{ type: 'bg', layer: 0 }], dominantColors: [[1, 2]] }
      expect(() => validateLLMOutput(output)).toThrow('不是 [r, g, b] 三元组')
    })
  })

  // --------------------------------------------------------------------------
  // 类型收窄
  // --------------------------------------------------------------------------

  describe('类型收窄', () => {
    it('校验通过后应收窄为 LLMOutput 类型', () => {
      const input: unknown = {
        scene: 'test',
        elements: [{ type: 'background', layer: 0, color: [0, 0, 0] }],
      }

      validateLLMOutput(input)
      // 如果通过，input 被收窄为 LLMOutput
      const output = input as LLMOutput
      expect(output.scene).toBe('test')
      expect(output.elements[0].type).toBe('background')
    })
  })
})
