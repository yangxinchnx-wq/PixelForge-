/**
 * World 核心类型单元测试
 */

import { describe, it, expect } from 'vitest'
import { OWNER_PRIORITY, compareOwnerPriority } from './types'

describe('world/types', () => {
  describe('OWNER_PRIORITY', () => {
    it('l3_revision 应为最高优先级', () => {
      expect(OWNER_PRIORITY['l3_revision']).toBe(100)
    })

    it('l2_user 应为第二高优先级', () => {
      expect(OWNER_PRIORITY['l2_user']).toBe(90)
    })

    it('system_default 应为最低优先级', () => {
      expect(OWNER_PRIORITY['system_default']).toBe(10)
    })
  })

  describe('compareOwnerPriority', () => {
    it('l3_revision > l2_user', () => {
      expect(compareOwnerPriority('l3_revision', 'l2_user')).toBeGreaterThan(0)
    })

    it('l2_user > l3_timeline', () => {
      expect(compareOwnerPriority('l2_user', 'l3_timeline')).toBeGreaterThan(0)
    })

    it('l3_timeline > l2_parser', () => {
      expect(compareOwnerPriority('l3_timeline', 'l2_parser')).toBeGreaterThan(0)
    })

    it('l2_parser > system_default', () => {
      expect(compareOwnerPriority('l2_parser', 'system_default')).toBeGreaterThan(0)
    })

    it('相同 owner 应返回 0', () => {
      expect(compareOwnerPriority('l2_user', 'l2_user')).toBe(0)
    })

    it('未知 owner 应返回 0', () => {
      expect(compareOwnerPriority('unknown', 'l2_user')).toBeLessThan(0)
    })
  })
})
