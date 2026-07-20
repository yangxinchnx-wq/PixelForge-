/**
 * PixelForge - L3 World Authoring 核心类型定义（骨架 §6 Phase F）
 *
 * 本文件定义 L3 层的核心类型，供 timeline / revision / director / sceneGraph / wdl 共享。
 *
 * L3 的 5 个接入点（骨架 §6.2）：
 *   1. 语义元素 ID 稳定机制 → shared/ids.ts（Phase A 已实现）
 *   2. Render IR 的外部 patch 接口 → compiler/ir/patch.ts（Phase B 已实现）
 *   3. CompileContext.worldMetadata → shared/types.ts（Phase A 已预留）
 *   4. Layer/Region 的来源追踪 → shared/types.ts SourceKind（Phase A 已预留）
 *   5. ParameterOwnership 边界 → shared/types.ts ParameterOwner（Phase A 已预留）
 *
 * Phase F 数据流（骨架 §7.2）：
 *   [L3 Timeline / Director]
 *        ↓  Patch
 *   [L1] patchEngine
 *        ↓  修改 RenderIR
 *   [L1] regionCompiler (partial recompile)
 *        ↓
 *   [L0] partial upload
 *        ↓
 *      画面
 */

import type { JsonLiteral } from '@/shared/types'
import type { ValuePatch } from '@/compiler/ir/patch'

// ============================================================================
// 1. TimelineKeyframe — 时间轴关键帧
// ============================================================================

/**
 * 时间轴关键帧。
 *
 * 关键帧定义了某个时间点上某个参数的值。
 * 两个关键帧之间通过插值函数过渡。
 *
 * 关键帧驱动的参数 owner = 'l3_timeline'（骨架 §4.1.5）。
 */
export interface TimelineKeyframe {
  /** 稳定 ID */
  id: string
  /** 时间戳（秒，非负浮点） */
  time: number
  /** 关键帧值（JsonLiteral，通常是 number 或 [number, number, number, number]） */
  value: JsonLiteral
  /** 插值模式（到下一关键帧的过渡方式） */
  interpolation: KeyframeInterpolation
  /** 贝塞尔控制点（仅 interpolation='bezier' 时使用） */
  bezierControl?: { cp1: [number, number]; cp2: [number, number] }
}

/**
 * 关键帧插值模式。
 *
 * - linear：线性插值
 * - bezier：三次贝塞尔曲线（需 bezierControl）
 * - step：阶梯函数（保持前一帧值直到下一帧）
 * - hold：保持前一帧值（与 step 相同，语义别名）
 */
export type KeyframeInterpolation = 'linear' | 'bezier' | 'step' | 'hold'

// ============================================================================
// 2. TimelineTrack — 时间轴轨道
// ============================================================================

/**
 * 时间轴轨道。
 *
 * 每条轨道绑定一个目标参数（layerId + paramKey）。
 * 轨道内的关键帧按时间排序。
 *
 * 求值时，根据当前时间在关键帧间插值，生成 ValuePatch。
 */
export interface TimelineTrack {
  /** 稳定 ID */
  id: string
  /** 轨道名称（用于 UI 显示） */
  name: string
  /** 目标实体类型（目前仅支持 layer） */
  targetEntity: 'layer' | 'effect'
  /** 目标实体 ID */
  targetId: string
  /** 目标参数路径（点分嵌套，如 'color' / 'radius' / 'noise.scale'） */
  paramKey: string
  /** 关键帧列表（按 time 升序） */
  keyframes: TimelineKeyframe[]
  /** 轨道是否启用 */
  enabled: boolean
}

// ============================================================================
// 3. TimelineContent — 完整时间轴内容
// ============================================================================

/**
 * 完整时间轴内容。
 *
 * 包含多条轨道，每条轨道独立求值。
 * 整体时长由所有关键帧的最大 time 决定。
 */
export interface TimelineContent {
  /** 稳定 ID（存入 WorldMetadata.timelineId） */
  id: string
  /** 轨道列表 */
  tracks: TimelineTrack[]
  /** 总时长（秒） */
  duration: number
  /** 是否循环播放 */
  loop: boolean
  /** FPS（帧率，用于预览） */
  fps: number
}

// ============================================================================
// 4. RevisionEntry — Revision Layer 条目
// ============================================================================

/**
 * Revision Layer 中的单个覆盖条目。
 *
 * Revision Layer 是一个参数覆盖层，可以覆盖任意 owner 的参数值。
 * owner = 'l3_revision' 的参数优先级最高（但可被 l2_user 否决）。
 */
export interface RevisionEntry {
  /** 稳定 ID */
  id: string
  /** 目标实体类型 */
  targetEntity: 'layer' | 'effect'
  /** 目标实体 ID */
  targetId: string
  /** 目标参数路径 */
  paramKey: string
  /** 覆盖值 */
  value: JsonLiteral
  /** 覆盖原因（用于日志和 UI） */
  reason: string
  /** 创建时间戳 */
  createdAt: number
}

// ============================================================================
// 5. RevisionLayer — 完整 Revision Layer
// ============================================================================

/**
 * Revision Layer：参数覆盖层。
 *
 * 一个 Revision Layer 包含多条 RevisionEntry，可批量应用为 ValuePatch。
 *
 * 应用规则（骨架 §4.1.5）：
 *   - l3_revision 优先级最高（但可被 l2_user 否决）
 *   - 与 l2_user 冲突时触发 needs_confirmation
 */
export interface RevisionLayer {
  /** 稳定 ID（存入 WorldMetadata） */
  id: string
  /** 覆盖条目列表 */
  entries: RevisionEntry[]
  /** 是否启用 */
  enabled: boolean
  /** 版本号（每次修改递增） */
  version: number
}

// ============================================================================
// 6. DirectorIntent — AI Director 意图
// ============================================================================

/**
 * AI Director 意图。
 *
 * AI Director 解析用户高层意图，生成参数决策。
 * owner = 'l3_director' 的参数由 AI Director 驱动。
 */
export interface DirectorIntent {
  /** 稳定 ID（存入 WorldMetadata.directorIntentId） */
  id: string
  /** 原始用户 prompt */
  prompt: string
  /** 意图类型（如 'mood' / 'pacing' / 'tone' / 'color_shift'） */
  type: string
  /** 意图参数 */
  params: Record<string, JsonLiteral>
  /** 置信度（0-1） */
  confidence: number
}

// ============================================================================
// 7. DirectorDecision — AI Director 决策结果
// ============================================================================

/**
 * AI Director 决策结果。
 *
 * 包含一组参数修改建议（ValuePatch 格式）和可选的 Timeline 生成。
 */
export interface DirectorDecision {
  /** 关联的意图 ID */
  intentId: string
  /** 参数修改建议（source = 'l3_director'） */
  patches: DirectorPatch[]
  /** 可选：生成的 Timeline */
  timeline?: TimelineContent
  /** 决策原因（用于 UI 展示） */
  reasoning: string
}

/**
 * Director 生成的参数 patch。
 *
 * 与标准 ValuePatch 的区别：source 固定为 'l3_director'。
 */
export interface DirectorPatch {
  /** 目标实体类型 */
  targetEntity: 'layer' | 'effect'
  /** 目标实体 ID */
  targetId: string
  /** 目标参数路径 */
  paramKey: string
  /** 新值 */
  value: JsonLiteral
}

// ============================================================================
// 8. SceneGraphNode — 场景图节点
// ============================================================================

/**
 * 场景图节点。
 *
 * 描述场景中的实体（角色、物体、光源等）及其空间关系。
 * 场景图是 L3 层的世界描述，不直接进入渲染层。
 */
export interface SceneGraphNode {
  /** 稳定 ID */
  id: string
  /** 节点名称 */
  name: string
  /** 节点类型（如 'character' / 'object' / 'light' / 'camera'） */
  type: string
  /** 父节点 ID（根节点为 null） */
  parentId: string | null
  /** 子节点 ID 列表 */
  childIds: string[]
  /** 空间变换 */
  transform: SceneTransform
  /** 附加属性（JsonLiteral） */
  properties: Record<string, JsonLiteral>
}

/**
 * 空间变换（2D）。
 */
export interface SceneTransform {
  /** X 位置（归一化 0-1） */
  x: number
  /** Y 位置（归一化 0-1） */
  y: number
  /** 旋转角度（度） */
  rotation: number
  /** X 缩放 */
  scaleX: number
  /** Y 缩放 */
  scaleY: number
}

// ============================================================================
// 9. SceneGraph — 完整场景图
// ============================================================================

/**
 * 完整场景图。
 *
 * 节点以 Map 存储，通过 parentId/childIds 维护层级关系。
 */
export interface SceneGraph {
  /** 稳定 ID（存入 WorldMetadata.sceneGraphId） */
  id: string
  /** 节点映射（id → node） */
  nodes: Map<string, SceneGraphNode>
  /** 根节点 ID */
  rootId: string | null
}

// ============================================================================
// 10. WDLDocument — World Description Language 文档
// ============================================================================

/**
 * WDL 文档。
 *
 * WDL 是 L3 的中间层，描述世界语义。
 * 与 RenderIR 严格分层（DM-2）：WDL 描述世界，RenderIR 描述 2D 渲染输入。
 */
export interface WDLDocument {
  /** 稳定 ID */
  id: string
  /** 文档版本 */
  version: string
  /** 场景描述 */
  scene: WDLScene
  /** 时间轴引用 */
  timelineId?: string
  /** 场景图引用 */
  sceneGraphId?: string
  /** Director 意图引用 */
  directorIntentId?: string
}

/**
 * WDL 场景描述。
 */
export interface WDLScene {
  /** 场景名称 */
  name: string
  /** 场景描述（自然语言） */
  description: string
  /** 场景标签 */
  tags: string[]
  /** 场景参数 */
  params: Record<string, JsonLiteral>
}

// ============================================================================
// 11. 辅助类型
// ============================================================================

/**
 * 时间轴求值结果。
 *
 * 给定时间点，求值所有轨道，生成一组 ValuePatch。
 */
export interface TimelineEvaluationResult {
  /** 当前时间（秒） */
  currentTime: number
  /** 生成的 ValuePatch 列表（source = 'l3_timeline'） */
  patches: ValuePatch[]
  /** 跳过的轨道（enabled=false 或无关键帧） */
  skippedTracks: string[]
}

/**
 * ParameterOwner 优先级（骨架 §4.1.5）。
 *
 * 优先级从高到低：
 *   l3_revision > l2_user > l3_timeline > l3_director > l2_parser > system_default
 *
 * 注意：l3_revision 优先级最高，但可被 l2_user 否决（通过 needs_confirmation）。
 */
export const OWNER_PRIORITY: Record<string, number> = {
  l3_revision: 100,
  l2_user: 90,
  l3_timeline: 70,
  l3_director: 70,
  l2_parser: 50,
  system_default: 10,
}

/**
 * 比较两个 ParameterOwner 的优先级。
 *
 * @returns 正数表示 a 优先级更高，负数表示 b 更高，0 表示相等
 */
export function compareOwnerPriority(a: string, b: string): number {
  return (OWNER_PRIORITY[a] ?? 0) - (OWNER_PRIORITY[b] ?? 0)
}
