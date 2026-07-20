/**
 * AI 场景规划器类型定义(Step 24)。
 *
 * 与 prompt/ 和 clarifier/ 的职责区分:
 * - prompt/:       自由文本 prompt → Layer[](关键词快速生成,追加式)
 * - clarifier/:    自由文本 prompt → CreativeRequirement(意图 + 缺失追问)
 * - generator/:    CreativeRequirement → ScenePlan → RenderIR(完整场景结构)
 *
 * 数据流:
 *   CreativeRequirement
 *     → createScenePlan(requirement)              [挑选模板 + 合并参数]
 *     → ScenePlan { layers, global }
 *     → generateRenderIR(plan)                     [转 Layer[] + Region + Effect]
 *     → RenderIR
 *     → runtimeStore.setRenderIR(ir) → GPU 重渲染
 *
 * 设计原则:
 * - AI 不自由生成 GPU 指令,而是从已有 LayerTemplate 中选择
 * - 模板的 opcodeName 必须是 5 个受支持 opcode 之一
 *   (SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE / IMAGE_TEXTURE)
 * - role 用于标识图层在场景中的语义角色(背景 / 主体 / 前景 / 叠加)
 */

import type { JsonLiteral } from '@/shared/types'

/**
 * 图层在场景中的语义角色。
 * - 'background': 背景层(通常是 SOLID_COLOR / LINEAR_GRADIENT)
 * - 'main':       主体层(场景核心元素,如星云 / 银河)
 * - 'foreground': 前景层(装饰元素,如星尘 / 粒子)
 * - 'overlay':    叠加层(特殊效果,如光晕 / 色块)
 */
export type LayerRole = 'background' | 'main' | 'foreground' | 'overlay'

/**
 * ScenePlan 中的单图层(模板选择 + 参数填充后的中间形态)。
 *
 * - name:        图层可读名(如 '星云' / '银河' / '星尘')
 * - opcodeName:  opcode 字符串名(与 Opcode enum 对齐,如 'NOISE' / 'SOLID_COLOR')
 * - role:        语义角色(决定渲染顺序:background → main → foreground → overlay)
 * - params:      已合并好的参数(模板默认 + 风格/镜头/运动映射)
 *
 * 注意:opcodeName 必须是受支持值,renderIRGenerator 会做名称→enum 映射,
 *       非法名称会抛错(避免运行时静默失败)。
 */
export interface SceneLayer {
  name: string
  opcodeName: string
  role: LayerRole
  params: Record<string, JsonLiteral>
}

/**
 * 场景规划(ScenePlan):一组 SceneLayer + 全局参数。
 *
 * - layers:     按 role 排序的图层列表(background 在前,overlay 在后)
 * - global:     全局参数(duration 秒 / fps)
 *
 * global 不直接进 RenderIR(RenderIR 不含时间字段,见 §4.1.0),
 * 而是用于:
 *   - 提示 timeline store 设置 totalFrames = duration * fps
 *   - 提示 player 设置 fps
 */
export interface ScenePlan {
  layers: SceneLayer[]
  global: {
    duration: number  // 秒
    fps: number
  }
}

/**
 * 生成 RenderIR 时的可选配置。
 *
 * - canvasWidth / canvasHeight: 画布尺寸(默认 1920×1080)
 * - duration / fps:              时长与帧率(默认 10 秒 / 60 fps)
 * - createRegion:                是否创建覆盖全画布的默认 region(默认 true)
 * - createEffects:               是否根据 style 自动生成 Effect(默认 true)
 */
export interface GeneratorOptions {
  canvasWidth?: number
  canvasHeight?: number
  duration?: number
  fps?: number
  createRegion?: boolean
  createEffects?: boolean
}

/** 受支持的 opcode 名称集合(renderIRGenerator 做名称→enum 映射时用) */
export const SUPPORTED_OPCODE_NAMES = [
  'SOLID_COLOR',
  'LINEAR_GRADIENT',
  'NOISE',
  'CIRCLE_SHAPE',
  'IMAGE_TEXTURE',
] as const

export type SupportedOpcodeName = (typeof SUPPORTED_OPCODE_NAMES)[number]
