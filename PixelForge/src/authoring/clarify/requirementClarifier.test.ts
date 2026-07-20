import { describe, it, expect } from 'vitest'
import { clarify } from '@/authoring/clarify/requirementClarifier'
import { Opcode } from '@/shared/types'

describe('RequirementClarifier', () => {
  describe('纯色背景解析', () => {
    it('应解析"纯色：红色"为 SOLID_COLOR 图层', async () => {
      const result = await clarify('纯色：红色')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers).toHaveLength(1)
      expect(result.intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      const color = result.intent.layers[0].params.color as number[]
      expect(color).toHaveLength(4)
      // 红色预设 ≈ [0.9, 0.15, 0.15, 1]
      expect(color[0]).toBeGreaterThan(0.8)
      expect(color[1]).toBeLessThan(0.3)
    })

    it('应解析"纯色背景：蓝色"', async () => {
      const result = await clarify('纯色背景：蓝色')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return
      expect(result.intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
    })

    it('应解析"背景：黑色"', async () => {
      const result = await clarify('背景：黑色')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return
      expect(result.intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      const color = result.intent.layers[0].params.color as number[]
      expect(color[0]).toBe(0)
      expect(color[1]).toBe(0)
      expect(color[2]).toBe(0)
    })
  })

  describe('渐变解析', () => {
    it('应解析"渐变：从红到蓝，垂直方向"', async () => {
      const result = await clarify('渐变：从红到蓝，垂直方向')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers[0].opcode).toBe(Opcode.LINEAR_GRADIENT)
      const params = result.intent.layers[0].params
      expect(params.colorA).toBeDefined()
      expect(params.colorB).toBeDefined()
      expect(params.from).toBeDefined()
      expect(params.to).toBeDefined()

      // 垂直方向 = from [0,0] to [0,1]
      const from = params.from as number[]
      const to = params.to as number[]
      expect(from[0]).toBe(0)
      expect(to[0]).toBe(0)
      expect(to[1]).toBe(1)
    })

    it('无方向时应使用默认对角渐变', async () => {
      const result = await clarify('渐变：从红到蓝')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      const from = result.intent.layers[0].params.from as number[]
      const to = result.intent.layers[0].params.to as number[]
      expect(from).toEqual([0, 0])
      expect(to).toEqual([1, 1])
    })
  })

  describe('圆形解析', () => {
    it('应解析"圆形：中心(0.5,0.5)，半径0.3，红色"', async () => {
      const result = await clarify('圆形：中心(0.5,0.5)，半径0.3，红色')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers[0].opcode).toBe(Opcode.CIRCLE_SHAPE)
      const params = result.intent.layers[0].params
      expect(params.center).toEqual([0.5, 0.5])
      expect(params.radius).toBe(0.3)
      expect(params.fill).toBeDefined()
      expect(params.background).toBeDefined()
    })

    it('无中心坐标时应使用默认 (0.5, 0.5)', async () => {
      const result = await clarify('圆形：半径0.25，蓝色')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      const center = result.intent.layers[0].params.center as number[]
      expect(center).toEqual([0.5, 0.5])
    })
  })

  describe('噪声解析', () => {
    it('应解析"噪声：缩放24，强度0.8"', async () => {
      const result = await clarify('噪声：缩放24，强度0.8')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers[0].opcode).toBe(Opcode.NOISE)
      expect(result.intent.layers[0].params.scale).toBe(24)
      expect(result.intent.layers[0].params.amount).toBe(0.8)
    })

    it('无参数时应使用默认值', async () => {
      // "噪声" 不带冒号可能匹配不上,用 "噪声：默认"
      const result2 = await clarify('噪声：默认')
      expect(result2.status).toBe('auto_resolved')
      if (result2.status !== 'auto_resolved') return

      expect(result2.intent.layers[0].params.scale).toBe(24)
    })
  })

  describe('多图层解析', () => {
    it('应解析多行 prompt 为多个图层', async () => {
      const prompt = '纯色：蓝色\n渐变：从红到绿，水平方向\n圆形：中心(0.3,0.7)，半径0.15，黄色'
      const result = await clarify(prompt)
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers).toHaveLength(3)
      expect(result.intent.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      expect(result.intent.layers[1].opcode).toBe(Opcode.LINEAR_GRADIENT)
      expect(result.intent.layers[2].opcode).toBe(Opcode.CIRCLE_SHAPE)
    })

    it('应支持分号分隔', async () => {
      const prompt = '纯色：红色；圆形：半径0.3，蓝色'
      const result = await clarify(prompt)
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers).toHaveLength(2)
    })

    it('应支持 + 号分隔', async () => {
      const prompt = '纯色：红色 + 圆形：半径0.3，蓝色'
      const result = await clarify(prompt)
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.layers).toHaveLength(2)
    })
  })

  describe('效果解析', () => {
    it('应解析"模糊：半径0.005"', async () => {
      const result = await clarify('纯色：红色\n模糊：半径0.005')
      expect(result.status).toBe('auto_resolved')
      if (result.status !== 'auto_resolved') return

      expect(result.intent.effects).toBeDefined()
      expect(result.intent.effects).toHaveLength(1)
      expect(result.intent.effects![0].type).toBe('blur')
      expect(result.intent.effects![0].params.radius).toBe(0.005)
    })
  })

  describe('拒绝场景', () => {
    it('空 prompt 应被拒绝', async () => {
      const result = await clarify('')
      expect(result.status).toBe('rejected')
    })

    it('纯空白 prompt 应被拒绝', async () => {
      const result = await clarify('   ')
      expect(result.status).toBe('rejected')
    })

    it('无法识别的 prompt 应被拒绝', async () => {
      const result = await clarify('asdfghjkl')
      expect(result.status).toBe('rejected')
    })
  })

  describe('needs_confirmation', () => {
    it('部分识别时应返回 needs_confirmation', async () => {
      const prompt = '纯色：红色\n无法识别的段'
      const result = await clarify(prompt)
      expect(result.status).toBe('needs_confirmation')
      if (result.status !== 'needs_confirmation') return

      expect(result.questions.length).toBeGreaterThan(0)
      expect(result.intent.layers).toHaveLength(1)
    })
  })

  describe('rawPrompt 保留', () => {
    it('应在 intent 中保留原始 prompt', async () => {
      const prompt = '纯色：红色'
      const result = await clarify(prompt)
      if (result.status !== 'auto_resolved') return
      expect(result.intent.rawPrompt).toBe(prompt)
    })
  })
})
