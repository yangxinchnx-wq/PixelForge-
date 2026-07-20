/**
 * WDL Document 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createWDLDocument,
  updateScene,
  addTag,
  removeTag,
  setSceneParam,
  setTimelineRef,
  setSceneGraphRef,
  setDirectorIntentRef,
  serializeWDL,
  deserializeWDL,
  resetWDLIdCounter,
} from './wdlDocument'
describe('wdlDocument', () => {
  beforeEach(() => {
    resetWDLIdCounter()
  })

  describe('创建', () => {
    it('createWDLDocument 应创建空文档', () => {
      const doc = createWDLDocument('测试场景', '描述')
      expect(doc.version).toBe('1.0.0')
      expect(doc.scene.name).toBe('测试场景')
      expect(doc.scene.description).toBe('描述')
      expect(doc.scene.tags).toHaveLength(0)
      expect(doc.scene.params).toEqual({})
    })

    it('createWDLDocument 应有默认值', () => {
      const doc = createWDLDocument()
      expect(doc.scene.name).toBe('Untitled Scene')
      expect(doc.scene.description).toBe('')
    })
  })

  describe('场景管理', () => {
    it('updateScene 应更新场景描述', () => {
      const doc = createWDLDocument()
      const updated = updateScene(doc, { name: '新名称', description: '新描述' })
      expect(updated.scene.name).toBe('新名称')
      expect(updated.scene.description).toBe('新描述')
    })

    it('addTag 应添加标签', () => {
      let doc = createWDLDocument()
      doc = addTag(doc, '夜景')
      doc = addTag(doc, '冬季')
      expect(doc.scene.tags).toHaveLength(2)
      expect(doc.scene.tags).toContain('夜景')
    })

    it('addTag 重复标签不应添加', () => {
      let doc = createWDLDocument()
      doc = addTag(doc, '夜景')
      doc = addTag(doc, '夜景')
      expect(doc.scene.tags).toHaveLength(1)
    })

    it('removeTag 应移除标签', () => {
      let doc = createWDLDocument()
      doc = addTag(doc, '夜景')
      doc = addTag(doc, '冬季')
      doc = removeTag(doc, '夜景')
      expect(doc.scene.tags).toHaveLength(1)
      expect(doc.scene.tags).not.toContain('夜景')
    })

    it('setSceneParam 应设置场景参数', () => {
      let doc = createWDLDocument()
      doc = setSceneParam(doc, 'mood', '孤独')
      doc = setSceneParam(doc, 'brightness', 0.3)
      expect(doc.scene.params.mood).toBe('孤独')
      expect(doc.scene.params.brightness).toBe(0.3)
    })
  })

  describe('引用管理', () => {
    it('setTimelineRef 应设置 Timeline 引用', () => {
      const doc = createWDLDocument()
      const updated = setTimelineRef(doc, 'tl_123')
      expect(updated.timelineId).toBe('tl_123')
    })

    it('setSceneGraphRef 应设置 SceneGraph 引用', () => {
      const doc = createWDLDocument()
      const updated = setSceneGraphRef(doc, 'sg_456')
      expect(updated.sceneGraphId).toBe('sg_456')
    })

    it('setDirectorIntentRef 应设置 DirectorIntent 引用', () => {
      const doc = createWDLDocument()
      const updated = setDirectorIntentRef(doc, 'intent_789')
      expect(updated.directorIntentId).toBe('intent_789')
    })
  })

  describe('序列化', () => {
    it('serializeWDL 应输出 JSON 字符串', () => {
      const doc = createWDLDocument('测试', '描述')
      const json = serializeWDL(doc)
      expect(typeof json).toBe('string')
      const parsed = JSON.parse(json)
      expect(parsed.scene.name).toBe('测试')
    })

    it('deserializeWDL 应从 JSON 恢复', () => {
      const doc = createWDLDocument('测试', '描述')
      const json = serializeWDL(doc)
      const restored = deserializeWDL(json)
      expect(restored.scene.name).toBe('测试')
      expect(restored.scene.description).toBe('描述')
    })

    it('deserializeWDL 非法 JSON 应抛出错误', () => {
      expect(() => deserializeWDL('not json')).toThrow()
    })

    it('deserializeWDL 非 object 应抛出错误', () => {
      expect(() => deserializeWDL('"string"')).toThrow('不是对象')
    })

    it('deserializeWDL 缺少 id 应抛出错误', () => {
      expect(() => deserializeWDL('{"version":"1.0.0","scene":{"name":"x"}}')).toThrow('id')
    })

    it('deserializeWDL 缺少 scene 应抛出错误', () => {
      expect(() => deserializeWDL('{"id":"x","version":"1.0.0"}')).toThrow('scene')
    })
  })
})
