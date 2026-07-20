import { describe, it, expect } from 'vitest'
import {
  stableId,
  stableLayerId,
  stableRegionId,
  stableEffectId,
  uniqueId,
} from '@/shared/ids'

describe('稳定 ID 生成器', () => {
  describe('stableId', () => {
    it('相同输入应产生相同输出', () => {
      const id1 = stableId('rule_parser', 'solid_color_red')
      const id2 = stableId('rule_parser', 'solid_color_red')
      expect(id1).toBe(id2)
    })

    it('不同输入应产生不同输出', () => {
      const id1 = stableId('rule_parser', 'solid_color_red')
      const id2 = stableId('rule_parser', 'solid_color_blue')
      expect(id1).not.toBe(id2)
    })

    it('带前缀时输出应包含前缀', () => {
      const id = stableId('rule_parser', 'test', 'layer')
      expect(id).toMatch(/^layer_[0-9a-f]{8}$/)
    })

    it('不带前缀时输出应只有 hash', () => {
      const id = stableId('rule_parser', 'test')
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })

    it('空字符串输入应仍产生有效 hash', () => {
      const id = stableId('', '')
      expect(id).toMatch(/^[0-9a-f]{8}$/)
    })
  })

  describe('stableLayerId', () => {
    it('应生成 layer_ 前缀的 ID', () => {
      const id = stableLayerId('rule_parser', 'solid_color')
      expect(id).toMatch(/^layer_[0-9a-f]{8}$/)
    })

    it('相同输入应产生相同 ID', () => {
      expect(stableLayerId('rule_parser', 'test')).toBe(stableLayerId('rule_parser', 'test'))
    })
  })

  describe('stableRegionId', () => {
    it('应生成 region_ 前缀的 ID', () => {
      const id = stableRegionId('rule_parser', 'default')
      expect(id).toMatch(/^region_[0-9a-f]{8}$/)
    })
  })

  describe('stableEffectId', () => {
    it('应生成 effect_ 前缀的 ID', () => {
      const id = stableEffectId('rule_parser', 'blur')
      expect(id).toMatch(/^effect_[0-9a-f]{8}$/)
    })
  })

  describe('uniqueId', () => {
    it('应生成唯一 ID', () => {
      const id1 = uniqueId('patch')
      const id2 = uniqueId('patch')
      expect(id1).not.toBe(id2)
    })

    it('带前缀时应包含前缀', () => {
      const id = uniqueId('patch')
      expect(id).toMatch(/^patch_/)
    })
  })
})
