/**
 * PixelForge - Scene Graph（骨架 §6 Phase F）
 *
 * 场景图描述场景中的实体及其空间关系。
 * 场景图是 L3 层的世界描述，不直接进入渲染层。
 *
 * 与 RenderIR 的关系（DM-2）：
 *   - SceneGraph 描述世界语义（角色、物体、空间关系）
 *   - RenderIR 描述 2D 渲染输入（图层、区域、效果）
 *   - SceneGraph 通过 Director 转换为 RenderIR 修改（ValuePatch）
 */

import type { JsonLiteral } from '@/shared/types'
import type { SceneGraph, SceneGraphNode, SceneTransform } from '../types'

// ============================================================================
// ID 生成
// ============================================================================

let sgIdCounter = 0

function genId(prefix: string): string {
  sgIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${sgIdCounter.toString(36)}`
}

// ============================================================================
// 场景图创建
// ============================================================================

/**
 * 创建空场景图。
 */
export function createSceneGraph(): SceneGraph {
  return {
    id: genId('scene_graph'),
    nodes: new Map(),
    rootId: null,
  }
}

/**
 * 创建场景图节点。
 */
export function createNode(
  name: string,
  type: string,
  parentId: string | null = null,
  properties: Record<string, JsonLiteral> = {},
): SceneGraphNode {
  return {
    id: genId('node'),
    name,
    type,
    parentId,
    childIds: [],
    transform: { x: 0.5, y: 0.5, rotation: 0, scaleX: 1, scaleY: 1 },
    properties,
  }
}

/**
 * 创建默认空间变换。
 */
export function createTransform(
  x: number = 0.5,
  y: number = 0.5,
  rotation: number = 0,
  scaleX: number = 1,
  scaleY: number = 1,
): SceneTransform {
  return { x, y, rotation, scaleX, scaleY }
}

// ============================================================================
// 节点管理（immutable）
// ============================================================================

/**
 * 添加节点到场景图。
 *
 * 如果指定了 parentId，自动建立父子关系。
 */
export function addNode(
  graph: SceneGraph,
  node: SceneGraphNode,
): SceneGraph {
  const nodes = new Map(graph.nodes)
  nodes.set(node.id, node)

  // 如果有父节点，更新父节点的 childIds
  if (node.parentId) {
    const parent = nodes.get(node.parentId)
    if (parent) {
      nodes.set(node.parentId, {
        ...parent,
        childIds: [...parent.childIds, node.id],
      })
    }
  }

  // 如果是第一个节点，设为根
  const rootId = graph.rootId ?? node.id

  return { ...graph, nodes, rootId }
}

/**
 * 从场景图移除节点（及其所有子节点）。
 */
export function removeNode(
  graph: SceneGraph,
  nodeId: string,
): SceneGraph {
  const nodes = new Map(graph.nodes)
  const node = nodes.get(nodeId)
  if (!node) return graph

  // 递归移除所有子节点
  const toRemove = collectDescendants(graph, nodeId)
  for (const id of toRemove) {
    nodes.delete(id)
  }

  // 从父节点的 childIds 中移除
  if (node.parentId) {
    const parent = nodes.get(node.parentId)
    if (parent) {
      nodes.set(node.parentId, {
        ...parent,
        childIds: parent.childIds.filter((id) => id !== nodeId),
      })
    }
  }

  // 如果移除的是根节点，选一个新的根
  let rootId = graph.rootId
  if (rootId === nodeId) {
    rootId = nodes.size > 0 ? nodes.keys().next().value ?? null : null
  }

  return { ...graph, nodes, rootId }
}

/**
 * 更新节点。
 */
export function updateNode(
  graph: SceneGraph,
  nodeId: string,
  updates: Partial<Omit<SceneGraphNode, 'id'>>,
): SceneGraph {
  const node = graph.nodes.get(nodeId)
  if (!node) return graph

  const nodes = new Map(graph.nodes)
  nodes.set(nodeId, { ...node, ...updates })

  return { ...graph, nodes }
}

/**
 * 更新节点变换。
 */
export function updateTransform(
  graph: SceneGraph,
  nodeId: string,
  transform: Partial<SceneTransform>,
): SceneGraph {
  const node = graph.nodes.get(nodeId)
  if (!node) return graph

  const nodes = new Map(graph.nodes)
  nodes.set(nodeId, {
    ...node,
    transform: { ...node.transform, ...transform },
  })

  return { ...graph, nodes }
}

// ============================================================================
// 查询函数
// ============================================================================

/**
 * 获取节点。
 */
export function getNode(
  graph: SceneGraph,
  nodeId: string,
): SceneGraphNode | undefined {
  return graph.nodes.get(nodeId)
}

/**
 * 获取子节点列表。
 */
export function getChildren(
  graph: SceneGraph,
  nodeId: string,
): SceneGraphNode[] {
  const node = graph.nodes.get(nodeId)
  if (!node) return []
  return node.childIds
    .map((id) => graph.nodes.get(id))
    .filter((n): n is SceneGraphNode => n !== undefined)
}

/**
 * 获取父节点。
 */
export function getParent(
  graph: SceneGraph,
  nodeId: string,
): SceneGraphNode | undefined {
  const node = graph.nodes.get(nodeId)
  if (!node || !node.parentId) return undefined
  return graph.nodes.get(node.parentId)
}

/**
 * 获取所有后代节点 ID（递归）。
 */
export function collectDescendants(
  graph: SceneGraph,
  nodeId: string,
): string[] {
  const result: string[] = [nodeId]
  const node = graph.nodes.get(nodeId)
  if (!node) return result

  for (const childId of node.childIds) {
    result.push(...collectDescendants(graph, childId))
  }

  return result
}

/**
 * 获取从根到指定节点的路径。
 */
export function getPath(
  graph: SceneGraph,
  nodeId: string,
): SceneGraphNode[] {
  const path: SceneGraphNode[] = []
  let current = graph.nodes.get(nodeId)

  while (current) {
    path.unshift(current)
    current = current.parentId ? graph.nodes.get(current.parentId) : undefined
  }

  return path
}

/**
 * 获取根节点。
 */
export function getRoot(graph: SceneGraph): SceneGraphNode | undefined {
  if (!graph.rootId) return undefined
  return graph.nodes.get(graph.rootId)
}

/**
 * 获取所有节点数量。
 */
export function getNodeCount(graph: SceneGraph): number {
  return graph.nodes.size
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 重置 ID 生成器（用于测试隔离）。
 */
export function resetSceneGraphIdCounter(): void {
  sgIdCounter = 0
}
