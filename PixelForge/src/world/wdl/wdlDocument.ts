/**
 * PixelForge - World Description Language（骨架 §6 / §23 Phase F）
 *
 * WDL 是 L3 的中间层，描述世界语义。
 *
 * 与 RenderIR 严格分层（DM-2）：
 *   - WDL 描述世界（场景、角色、关系、时间轴引用）
 *   - RenderIR 描述 2D 渲染输入（图层、区域、效果）
 *   - Timeline/Revision 以外部 patch 作用于 RenderIR，不嵌入 WDL
 *
 * WDL 文档是只读的元数据容器，不直接驱动渲染。
 * 它通过引用 ID 关联 SceneGraph / Timeline / DirectorIntent。
 */

import type { JsonLiteral } from '@/shared/types'
import type { WDLDocument, WDLScene } from '../types'

// ============================================================================
// ID 生成
// ============================================================================

let wdlIdCounter = 0

function genId(prefix: string): string {
  wdlIdCounter++
  return `${prefix}_${Date.now().toString(36)}_${wdlIdCounter.toString(36)}`
}

// ============================================================================
// WDL 文档创建
// ============================================================================

/**
 * 创建空 WDL 文档。
 */
export function createWDLDocument(
  sceneName: string = 'Untitled Scene',
  sceneDescription: string = '',
): WDLDocument {
  return {
    id: genId('wdl'),
    version: '1.0.0',
    scene: {
      name: sceneName,
      description: sceneDescription,
      tags: [],
      params: {},
    },
  }
}

// ============================================================================
// 场景描述管理（immutable）
// ============================================================================

/**
 * 更新场景描述。
 */
export function updateScene(
  doc: WDLDocument,
  updates: Partial<WDLScene>,
): WDLDocument {
  return {
    ...doc,
    scene: { ...doc.scene, ...updates },
  }
}

/**
 * 添加场景标签。
 */
export function addTag(
  doc: WDLDocument,
  tag: string,
): WDLDocument {
  if (doc.scene.tags.includes(tag)) return doc
  return {
    ...doc,
    scene: { ...doc.scene, tags: [...doc.scene.tags, tag] },
  }
}

/**
 * 移除场景标签。
 */
export function removeTag(
  doc: WDLDocument,
  tag: string,
): WDLDocument {
  return {
    ...doc,
    scene: { ...doc.scene, tags: doc.scene.tags.filter((t) => t !== tag) },
  }
}

/**
 * 设置场景参数。
 */
export function setSceneParam(
  doc: WDLDocument,
  key: string,
  value: JsonLiteral,
): WDLDocument {
  return {
    ...doc,
    scene: {
      ...doc.scene,
      params: { ...doc.scene.params, [key]: value },
    },
  }
}

// ============================================================================
// 引用管理
// ============================================================================

/**
 * 设置 Timeline 引用。
 */
export function setTimelineRef(
  doc: WDLDocument,
  timelineId: string,
): WDLDocument {
  return { ...doc, timelineId }
}

/**
 * 设置 SceneGraph 引用。
 */
export function setSceneGraphRef(
  doc: WDLDocument,
  sceneGraphId: string,
): WDLDocument {
  return { ...doc, sceneGraphId }
}

/**
 * 设置 DirectorIntent 引用。
 */
export function setDirectorIntentRef(
  doc: WDLDocument,
  directorIntentId: string,
): WDLDocument {
  return { ...doc, directorIntentId }
}

/**
 * 清除 Timeline 引用。
 */
export function clearTimelineRef(doc: WDLDocument): WDLDocument {
  const { timelineId: _, ...rest } = doc
  return rest
}

/**
 * 清除 SceneGraph 引用。
 */
export function clearSceneGraphRef(doc: WDLDocument): WDLDocument {
  const { sceneGraphId: _, ...rest } = doc
  return rest
}

/**
 * 清除 DirectorIntent 引用。
 */
export function clearDirectorIntentRef(doc: WDLDocument): WDLDocument {
  const { directorIntentId: _, ...rest } = doc
  return rest
}

// ============================================================================
// 序列化 / 反序列化
// ============================================================================

/**
 * 将 WDL 文档序列化为 JSON 字符串。
 */
export function serializeWDL(doc: WDLDocument): string {
  return JSON.stringify(doc, null, 2)
}

/**
 * 从 JSON 字符串反序列化 WDL 文档。
 *
 * @throws {Error} JSON 解析失败或结构不合法时抛出
 */
export function deserializeWDL(json: string): WDLDocument {
  const obj = JSON.parse(json) as unknown

  if (!obj || typeof obj !== 'object') {
    throw new Error('WDL 反序列化失败：不是对象')
  }

  const doc = obj as Record<string, unknown>

  if (typeof doc.id !== 'string') {
    throw new Error('WDL 反序列化失败：id 不是字符串')
  }

  if (typeof doc.version !== 'string') {
    throw new Error('WDL 反序列化失败：version 不是字符串')
  }

  if (!doc.scene || typeof doc.scene !== 'object') {
    throw new Error('WDL 反序列化失败：scene 不是对象')
  }

  const scene = doc.scene as Record<string, unknown>
  if (typeof scene.name !== 'string') {
    throw new Error('WDL 反序列化失败：scene.name 不是字符串')
  }

  return doc as unknown as WDLDocument
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 重置 ID 生成器（用于测试隔离）。
 */
export function resetWDLIdCounter(): void {
  wdlIdCounter = 0
}
