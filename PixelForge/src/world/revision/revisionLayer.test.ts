/**
 * Revision Layer 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRevisionLayer,
  createEntry,
  addEntry,
  removeEntry,
  updateEntry,
  toValuePatches,
  detectConflicts,
  applyOwnership,
  resetRevisionIdCounter,
} from './revisionLayer'
import type { ParamOwnership, ParameterOwner } from '@/shared/types'

describe('revisionLayer', () => {
  beforeEach(() => {
    resetRevisionIdCounter()
  })

  describe('创建', () => {
    it('createRevisionLayer 应创建空 Revision Layer', () => {
      const layer = createRevisionLayer()
      expect(layer.entries).toHaveLength(0)
      expect(layer.enabled).toBe(true)
      expect(layer.version).toBe(1)
    })

    it('createEntry 应创建覆盖条目', () => {
      const entry = createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '测试')
      expect(entry.targetEntity).toBe('layer')
      expect(entry.targetId).toBe('L1')
      expect(entry.paramKey).toBe('color')
      expect(entry.value).toEqual([1, 0, 0, 1])
      expect(entry.reason).toBe('测试')
    })
  })

  describe('Entry 管理', () => {
    it('addEntry 应添加条目并递增 version', () => {
      let layer = createRevisionLayer()
      const entry = createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '测试')
      layer = addEntry(layer, entry)
      expect(layer.entries).toHaveLength(1)
      expect(layer.version).toBe(2)
    })

    it('addEntry 相同 target 应替换而非添加', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '第一'))
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [0, 1, 0, 1], '第二'))
      expect(layer.entries).toHaveLength(1)
      expect(layer.entries[0].value).toEqual([0, 1, 0, 1])
    })

    it('removeEntry 应移除条目', () => {
      let layer = createRevisionLayer()
      const entry = createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '测试')
      layer = addEntry(layer, entry)
      layer = removeEntry(layer, entry.id)
      expect(layer.entries).toHaveLength(0)
    })

    it('updateEntry 应更新条目', () => {
      let layer = createRevisionLayer()
      const entry = createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '测试')
      layer = addEntry(layer, entry)
      layer = updateEntry(layer, entry.id, { value: [0, 0, 1, 1] })
      expect(layer.entries[0].value).toEqual([0, 0, 1, 1])
    })
  })

  describe('toValuePatches', () => {
    it('应将条目转换为 ValuePatch', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '红'))
      layer = addEntry(layer, createEntry('layer', 'L2', 'radius', 0.5, '大圆'))

      const patches = toValuePatches(layer)
      expect(patches).toHaveLength(2)
      expect(patches[0].source).toBe('l3_revision')
      expect(patches[0].tier).toBe('value')
      expect(patches[0].targetId).toBe('L1')
      expect(patches[0].paramKey).toBe('color')
    })

    it('禁用的 Layer 应返回空数组', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '红'))
      layer = { ...layer, enabled: false }
      expect(toValuePatches(layer)).toHaveLength(0)
    })
  })

  describe('detectConflicts', () => {
    it('与 l2_user 冲突应需要确认', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '修改'))

      const ownership = new Map<string, ParamOwnership>([
        ['L1', { color: 'l2_user' as ParameterOwner }],
      ])

      const result = detectConflicts(layer, ownership)
      expect(result.hasConflict).toBe(true)
      expect(result.conflicts).toHaveLength(1)
      expect(result.conflicts[0].needsConfirmation).toBe(true)
      expect(result.conflicts[0].currentOwner).toBe('l2_user')
    })

    it('与 l3_timeline 不冲突（l3_revision 优先级更高）', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '修改'))

      const ownership = new Map<string, ParamOwnership>([
        ['L1', { color: 'l3_timeline' as ParameterOwner }],
      ])

      const result = detectConflicts(layer, ownership)
      expect(result.hasConflict).toBe(false)
    })

    it('无 ownership 信息不冲突', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '修改'))

      const ownership = new Map<string, ParamOwnership>()
      const result = detectConflicts(layer, ownership)
      expect(result.hasConflict).toBe(false)
    })
  })

  describe('applyOwnership', () => {
    it('应将覆盖参数的 owner 改为 l3_revision', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '修改'))

      const ownership = new Map<string, ParamOwnership>([
        ['L1', { color: 'l3_timeline' as ParameterOwner }],
      ])

      const result = applyOwnership(layer, ownership)
      expect(result.get('L1')!.color).toBe('l3_revision')
    })

    it('l2_user 不可被覆盖', () => {
      let layer = createRevisionLayer()
      layer = addEntry(layer, createEntry('layer', 'L1', 'color', [1, 0, 0, 1], '修改'))

      const ownership = new Map<string, ParamOwnership>([
        ['L1', { color: 'l2_user' as ParameterOwner }],
      ])

      const result = applyOwnership(layer, ownership)
      expect(result.get('L1')!.color).toBe('l2_user')
    })
  })
})
