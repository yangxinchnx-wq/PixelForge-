/**
 * Sequence 模板/预设库(Step 31.9)— 预定义 Sequence 配置 + 自定义预设。
 *
 * 设计:
 * - 模板描述 Sequence 的"骨架":分辨率、帧率、时长、轨道结构
 * - 内置模板覆盖常见视频/动画场景(横屏/竖屏/方形/4K 等)
 * - 用户可将当前 Sequence "另存为模板"(保存到 localStorage)
 * - 实例化模板 = 生成完整 Sequence 对象(新 ID),可直接 addSequence
 *
 * 与 createSequence 的区别:
 * - createSequence:硬编码 1V+1A 两条空轨
 * - 模板:可自定义任意数量/类型的轨道
 *
 * 数据流:
 *   模板选择 → instantiateTemplate → Sequence → store.addSequence → AddSequenceCommand
 *   当前 Sequence → serializeToTemplate → SequenceTemplate → localStorage(自定义预设)
 */

import type { Sequence } from './sequence'
import { createSequence } from './sequence'
import type { Track } from './track'
import { TrackType, createTrack } from './track'
import { seconds } from './time'

// ============================================================================
// 1. 类型定义
// ============================================================================

/**
 * 轨道模板:描述一条轨道的结构(不含 Clip)。
 */
export interface TrackTemplate {
  /** 轨道类型 */
  type: TrackType
  /** 轨道名称(可选,默认按类型自动命名) */
  name?: string
  /** 轨道颜色(可选,默认按类型取色) */
  color?: string
  /** 轨道高度(可选,默认按类型) */
  height?: number
}

/**
 * Sequence 模板:可被实例化为完整 Sequence 的预设配置。
 */
export interface SequenceTemplate {
  /** 模板唯一 ID(内置模板用 'builtin-xxx',自定义用 'custom-xxx') */
  id: string
  /** 模板显示名称 */
  name: string
  /** 模板描述(用途说明) */
  description: string
  /** 模板分类(内置:'builtin',自定义:'custom') */
  category: 'builtin' | 'custom'
  /** 画面宽度(像素) */
  width: number
  /** 画面高度(像素) */
  height: number
  /** 帧率 */
  fps: number
  /** 默认时长(秒) */
  durationSec: number
  /** 轨道结构(从上到下) */
  tracks: TrackTemplate[]
  /** 创建时间戳(自定义模板) */
  createdAt?: number
  /** 图标标识(用于 UI 显示,内置模板用) */
  icon?: string
}

// ============================================================================
// 2. 内置模板
// ============================================================================

/**
 * 内置模板库 — 覆盖常见视频/动画场景。
 *
 * 分类:
 * - 横屏:1920×1080 30fps, 3840×2160 60fps
 * - 竖屏:1080×1920 30fps(短视频)
 * - 方形:1080×1080 30fps(社交媒体)
 * - 动画:1920×1080 24fps(传统动画)
 */
export const BUILTIN_TEMPLATES: SequenceTemplate[] = [
  {
    id: 'builtin-hd-1080p-30',
    name: '高清横屏 1080p',
    description: '1920×1080,30fps,标准高清视频。2 视频 + 2 音频 + 1 文字轨道。',
    category: 'builtin',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 60,
    icon: 'landscape',
    tracks: [
      { type: TrackType.VIDEO, name: '主视频' },
      { type: TrackType.VIDEO, name: '叠加视频' },
      { type: TrackType.TEXT, name: '字幕' },
      { type: TrackType.AUDIO, name: '配音' },
      { type: TrackType.AUDIO, name: '背景音乐' },
    ],
  },
  {
    id: 'builtin-4k-2160p-60',
    name: '4K 超清横屏',
    description: '3840×2160,60fps,高帧率 4K 视频。3 视频 + 1 特效 + 2 音频轨道。',
    category: 'builtin',
    width: 3840,
    height: 2160,
    fps: 60,
    durationSec: 120,
    icon: 'landscape',
    tracks: [
      { type: TrackType.VIDEO, name: '主视频' },
      { type: TrackType.VIDEO, name: '叠加视频' },
      { type: TrackType.VIDEO, name: '画中画' },
      { type: TrackType.EFFECT, name: '特效' },
      { type: TrackType.AUDIO, name: '配音' },
      { type: TrackType.AUDIO, name: '背景音乐' },
    ],
  },
  {
    id: 'builtin-vertical-1080x1920',
    name: '竖屏短视频',
    description: '1080×1920,30fps,抖音/快手竖屏格式。1 视频 + 1 文字 + 1 音频轨道。',
    category: 'builtin',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 30,
    icon: 'portrait',
    tracks: [
      { type: TrackType.VIDEO, name: '主视频' },
      { type: TrackType.TEXT, name: '字幕' },
      { type: TrackType.AUDIO, name: '原声' },
    ],
  },
  {
    id: 'builtin-square-1080',
    name: '方形社交媒体',
    description: '1080×1080,30fps,Instagram/微博方形格式。1 视频 + 1 文字 + 1 音频轨道。',
    category: 'builtin',
    width: 1080,
    height: 1080,
    fps: 30,
    durationSec: 45,
    icon: 'square',
    tracks: [
      { type: TrackType.VIDEO, name: '主视频' },
      { type: TrackType.TEXT, name: '字幕' },
      { type: TrackType.AUDIO, name: '背景音乐' },
    ],
  },
  {
    id: 'builtin-animation-24fps',
    name: '传统动画 24fps',
    description: '1920×1080,24fps,传统手绘动画帧率。3 视频 + 1 特效 + 1 音频轨道。',
    category: 'builtin',
    width: 1920,
    height: 1080,
    fps: 24,
    durationSec: 90,
    icon: 'landscape',
    tracks: [
      { type: TrackType.VIDEO, name: '背景层' },
      { type: TrackType.VIDEO, name: '角色层' },
      { type: TrackType.VIDEO, name: '前景层' },
      { type: TrackType.EFFECT, name: '特效' },
      { type: TrackType.AUDIO, name: '音效' },
    ],
  },
  {
    id: 'builtin-minimal',
    name: '极简项目',
    description: '1920×1080,30fps,最小配置。1 视频 + 1 音频轨道。',
    category: 'builtin',
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 30,
    icon: 'landscape',
    tracks: [
      { type: TrackType.VIDEO, name: '视频' },
      { type: TrackType.AUDIO, name: '音频' },
    ],
  },
]

// ============================================================================
// 3. 模板实例化
// ============================================================================

/**
 * 从模板实例化一个完整的 Sequence 对象。
 *
 * 流程:
 * 1. 根据 width/height/fps/duration 调用 createSequence 创建基础 Sequence
 * 2. 清空默认轨道,按模板 tracks 重新构建
 * 3. 返回完整 Sequence(新 ID,不含 Clip)
 *
 * @param template 模板定义
 * @returns 新的 Sequence 对象
 */
export function instantiateTemplate(template: SequenceTemplate): Sequence {
  // 先用 createSequence 创建基础结构(设置 fps/width/height/duration)
  const baseSeq = createSequence({
    name: template.name,
    fps: template.fps,
    width: template.width,
    height: template.height,
    duration: seconds(template.durationSec),
  })

  // 清空默认轨道,按模板重建
  const tracks: Track[] = template.tracks.map((tt, index) => {
    return createTrack(tt.type, index, tt.name, tt.color)
  })

  return {
    ...baseSeq,
    tracks,
    updatedAt: Date.now(),
  }
}

// ============================================================================
// 4. Sequence → 模板序列化
// ============================================================================

/**
 * 将现有 Sequence 序列化为模板(用于"另存为模板")。
 *
 * 只提取结构信息(分辨率/帧率/时长/轨道类型),不包含 Clip。
 *
 * @param seq       源 Sequence
 * @param name      模板名称
 * @param description 模板描述(可选)
 * @returns 模板对象(category = 'custom')
 */
export function serializeToTemplate(
  seq: Sequence,
  name: string,
  description?: string,
): SequenceTemplate {
  const durationSec = Number(seq.duration) / 1_000_000 // 微秒 → 秒

  return {
    id: `custom-${Date.now().toString(36)}`,
    name: name.trim() || seq.name,
    description: description?.trim() || `从「${seq.name}」保存的自定义模板`,
    category: 'custom',
    width: seq.width,
    height: seq.height,
    fps: seq.fps,
    durationSec: Math.round(durationSec * 100) / 100, // 保留 2 位小数
    tracks: seq.tracks.map((t) => ({
      type: t.type,
      name: t.name,
      color: t.color,
      height: t.height,
    })),
    createdAt: Date.now(),
  }
}

// ============================================================================
// 5. 自定义模板持久化(localStorage)
// ============================================================================

const STORAGE_KEY = 'pf-sequence-templates'

/**
 * 加载自定义模板列表(从 localStorage)。
 *
 * @returns 自定义模板数组(失败返回空数组)
 */
export function loadCustomTemplates(): SequenceTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t) => t && t.id && t.name && t.category === 'custom')
  } catch {
    return []
  }
}

/**
 * 保存自定义模板列表到 localStorage。
 *
 * @param templates 自定义模板数组
 */
export function saveCustomTemplates(templates: SequenceTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch {
    // localStorage 不可用(隐私模式等),静默失败
  }
}

/**
 * 添加一个自定义模板(持久化)。
 *
 * @param template 要添加的模板
 * @returns 更新后的自定义模板列表
 */
export function addCustomTemplate(template: SequenceTemplate): SequenceTemplate[] {
  const existing = loadCustomTemplates()
  // 同名模板覆盖(按 name 去重)
  const filtered = existing.filter((t) => t.name !== template.name)
  const updated = [...filtered, template]
  saveCustomTemplates(updated)
  return updated
}

/**
 * 删除自定义模板(持久化)。
 *
 * @param templateId 模板 ID
 * @returns 更新后的自定义模板列表
 */
export function removeCustomTemplate(templateId: string): SequenceTemplate[] {
  const existing = loadCustomTemplates()
  const updated = existing.filter((t) => t.id !== templateId)
  saveCustomTemplates(updated)
  return updated
}

// ============================================================================
// 6. 模板查询辅助
// ============================================================================

/**
 * 获取所有模板(内置 + 自定义)。
 *
 * @param includeCustom 是否包含自定义模板(默认 true,从 localStorage 读取)
 * @returns 模板数组
 */
export function getAllTemplates(includeCustom = true): SequenceTemplate[] {
  const custom = includeCustom ? loadCustomTemplates() : []
  return [...BUILTIN_TEMPLATES, ...custom]
}

/**
 * 按 ID 查找模板。
 *
 * @param templateId 模板 ID
 * @returns 模板对象,未找到返回 undefined
 */
export function findTemplateById(templateId: string): SequenceTemplate | undefined {
  return getAllTemplates().find((t) => t.id === templateId)
}

/**
 * 验证模板结构完整性。
 *
 * @param template 待验证模板
 * @returns { valid, reason? }
 */
export function validateTemplate(template: SequenceTemplate): {
  valid: boolean
  reason?: string
} {
  if (!template.id || template.id.length === 0) {
    return { valid: false, reason: '模板 ID 不能为空' }
  }
  if (!template.name || template.name.trim().length === 0) {
    return { valid: false, reason: '模板名称不能为空' }
  }
  if (template.width <= 0 || template.height <= 0) {
    return { valid: false, reason: `分辨率无效: ${template.width}×${template.height}` }
  }
  if (template.fps <= 0 || template.fps > 240) {
    return { valid: false, reason: `帧率无效: ${template.fps}` }
  }
  if (template.durationSec <= 0) {
    return { valid: false, reason: `时长无效: ${template.durationSec}s` }
  }
  if (!template.tracks || template.tracks.length === 0) {
    return { valid: false, reason: '至少需要 1 条轨道' }
  }
  return { valid: true }
}
