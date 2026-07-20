import { describe, it, expect } from 'vitest'
import { createSeed, DEFAULT_SEED } from '@/shared/seed'

describe('Deterministic Seed', () => {
  describe('createSeed', () => {
    it('相同输入应产生相同 seed', () => {
      expect(createSeed('星空背景')).toBe(createSeed('星空背景'))
    })

    it('不同输入应产生不同 seed', () => {
      expect(createSeed('星空背景')).not.toBe(createSeed('海洋背景'))
    })

    it('应返回无符号 32-bit 整数', () => {
      const seed = createSeed('test')
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(seed).toBeLessThanOrEqual(0xFFFFFFFF)
      expect(Number.isInteger(seed)).toBe(true)
    })

    it('空字符串应仍产生有效 seed', () => {
      const seed = createSeed('')
      expect(seed).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(seed)).toBe(true)
    })
  })

  describe('DEFAULT_SEED', () => {
    it('应为数字常量', () => {
      expect(typeof DEFAULT_SEED).toBe('number')
      expect(DEFAULT_SEED).toBe(42)
    })
  })
})
