/**
 * SceneGraph 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSceneGraph,
  createNode,
  createTransform,
  addNode,
  removeNode,
  updateNode,
  updateTransform,
  getNode,
  getChildren,
  getParent,
  collectDescendants,
  getPath,
  getRoot,
  getNodeCount,
  resetSceneGraphIdCounter,
} from './sceneGraph'
import type { SceneGraph } from '../types'

describe('sceneGraph', () => {
  beforeEach(() => {
    resetSceneGraphIdCounter()
  })

  describe('创建', () => {
    it('createSceneGraph 应创建空场景图', () => {
      const sg = createSceneGraph()
      expect(sg.nodes.size).toBe(0)
      expect(sg.rootId).toBeNull()
    })

    it('createNode 应创建节点', () => {
      const node = createNode('root', 'group')
      expect(node.name).toBe('root')
      expect(node.type).toBe('group')
      expect(node.parentId).toBeNull()
      expect(node.childIds).toHaveLength(0)
      expect(node.transform.x).toBe(0.5)
    })

    it('createTransform 应创建变换', () => {
      const t = createTransform(0.3, 0.4, 45, 2, 0.5)
      expect(t).toEqual({ x: 0.3, y: 0.4, rotation: 45, scaleX: 2, scaleY: 0.5 })
    })
  })

  describe('节点管理', () => {
    it('addNode 应添加节点并设为根', () => {
      let sg = createSceneGraph()
      const node = createNode('root', 'group')
      sg = addNode(sg, node)
      expect(sg.nodes.size).toBe(1)
      expect(sg.rootId).toBe(node.id)
    })

    it('addNode 应建立父子关系', () => {
      let sg = createSceneGraph()
      const parent = createNode('parent', 'group')
      sg = addNode(sg, parent)
      const child = createNode('child', 'object', parent.id)
      sg = addNode(sg, child)

      expect(sg.nodes.get(parent.id)!.childIds).toContain(child.id)
      expect(sg.nodes.get(child.id)!.parentId).toBe(parent.id)
    })

    it('removeNode 应移除节点及其子节点', () => {
      let sg = createSceneGraph()
      const parent = createNode('parent', 'group')
      sg = addNode(sg, parent)
      const child = createNode('child', 'object', parent.id)
      sg = addNode(sg, child)
      const grandchild = createNode('grandchild', 'object', child.id)
      sg = addNode(sg, grandchild)

      sg = removeNode(sg, parent.id)
      expect(sg.nodes.size).toBe(0)
    })

    it('removeNode 应从父节点 childIds 中移除', () => {
      let sg = createSceneGraph()
      const parent = createNode('parent', 'group')
      sg = addNode(sg, parent)
      const child = createNode('child', 'object', parent.id)
      sg = addNode(sg, child)

      sg = removeNode(sg, child.id)
      expect(sg.nodes.get(parent.id)!.childIds).not.toContain(child.id)
    })

    it('updateNode 应更新节点属性', () => {
      let sg = createSceneGraph()
      const node = createNode('root', 'group')
      sg = addNode(sg, node)
      sg = updateNode(sg, node.id, { name: 'updated' })
      expect(sg.nodes.get(node.id)!.name).toBe('updated')
    })

    it('updateTransform 应更新变换', () => {
      let sg = createSceneGraph()
      const node = createNode('root', 'group')
      sg = addNode(sg, node)
      sg = updateTransform(sg, node.id, { x: 0.3, rotation: 90 })
      expect(sg.nodes.get(node.id)!.transform.x).toBe(0.3)
      expect(sg.nodes.get(node.id)!.transform.rotation).toBe(90)
    })
  })

  describe('查询', () => {
    function buildTestGraph(): SceneGraph {
      let sg = createSceneGraph()
      const root = createNode('root', 'group')
      sg = addNode(sg, root)
      const child1 = createNode('child1', 'object', root.id)
      sg = addNode(sg, child1)
      const child2 = createNode('child2', 'object', root.id)
      sg = addNode(sg, child2)
      const grandchild = createNode('grandchild', 'object', child1.id)
      sg = addNode(sg, grandchild)
      return sg
    }

    it('getNode 应返回节点', () => {
      const sg = buildTestGraph()
      const root = getRoot(sg)!
      expect(getNode(sg, root.id)).toBeDefined()
    })

    it('getChildren 应返回子节点列表', () => {
      const sg = buildTestGraph()
      const root = getRoot(sg)!
      const children = getChildren(sg, root.id)
      expect(children).toHaveLength(2)
      expect(children.map((n) => n.name)).toContain('child1')
      expect(children.map((n) => n.name)).toContain('child2')
    })

    it('getParent 应返回父节点', () => {
      const sg = buildTestGraph()
      const root = getRoot(sg)!
      const children = getChildren(sg, root.id)
      expect(getParent(sg, children[0].id)?.id).toBe(root.id)
    })

    it('collectDescendants 应递归收集所有后代', () => {
      const sg = buildTestGraph()
      const root = getRoot(sg)!
      const descendants = collectDescendants(sg, root.id)
      expect(descendants).toHaveLength(4) // root + 2 children + 1 grandchild
    })

    it('getPath 应返回从根到节点的路径', () => {
      const sg = buildTestGraph()
      const root = getRoot(sg)!
      const child1 = getChildren(sg, root.id).find((n) => n.name === 'child1')!
      const grandchild = getChildren(sg, child1.id)[0]

      const path = getPath(sg, grandchild.id)
      expect(path).toHaveLength(3)
      expect(path[0].name).toBe('root')
      expect(path[1].name).toBe('child1')
      expect(path[2].name).toBe('grandchild')
    })

    it('getRoot 应返回根节点', () => {
      const sg = buildTestGraph()
      expect(getRoot(sg)?.name).toBe('root')
    })

    it('getNodeCount 应返回节点总数', () => {
      const sg = buildTestGraph()
      expect(getNodeCount(sg)).toBe(4)
    })
  })
})
