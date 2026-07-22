/**
 * PixelForge - WDL 模板库(Step 38.5)
 *
 * 职责:
 * - 提供开箱即用的 WDL 场景预设模板
 * - 按类别分组(自然 / 都市 / 抽象 / 极简)
 * - 支持模板检索 / 按标签筛选 / 按类别列出
 * - 每个模板都是合法可编译的 WDL 源码
 *
 * 用法:
 *   import { WDL_TEMPLATES, getTemplatesByCategory, searchTemplates } from '@/world/wdl/wdlTemplates'
 *   const starry = WDL_TEMPLATES.find(t => t.id === 'starry-night')
 *   editor.setValue(starry.source)
 */
import { validateSource } from './wdlValidator'

// ============================================================================
// 1. 类型定义
// ============================================================================

/** 模板类别 */
export type TemplateCategory = 'nature' | 'urban' | 'abstract' | 'minimal'

/** WDL 模板 */
export interface WDLTemplate {
  /** 唯一 ID */
  id: string
  /** 显示名称 */
  name: string
  /** 类别 */
  category: TemplateCategory
  /** 简短描述 */
  description: string
  /** 标签(用于检索) */
  tags: string[]
  /** WDL 源码 */
  source: string
  /** 缩略图色调(用于 UI 占位,格式 [r, g, b]) */
  thumbnailColor: [number, number, number]
}

// ============================================================================
// 2. 模板定义
// ============================================================================

export const WDL_TEMPLATES: WDLTemplate[] = [
  // —— 自然 ——
  {
    id: 'starry-night',
    name: '星空夜景',
    category: 'nature',
    description: '深蓝夜空 + 噪声星点 + 暗角效果',
    tags: ['夜空', '星空', '噪声', '暗角', '深蓝'],
    thumbnailColor: [0.02, 0.04, 0.12],
    source: `scene "星空夜景" {
  canvas: 1920x1080

  layer "background" {
    opcode: SOLID_COLOR
    color: [0.02, 0.04, 0.12, 1.0]
    blendMode: normal
  }

  layer "stars" {
    opcode: NOISE
    scale: 0.8
    intensity: 0.9
    seed: 42
    blendMode: add
  }

  effect "vignette" {
    type: vignette
    target: "background"
    intensity: 0.6
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["background", "stars"]
  }
}`,
  },
  {
    id: 'sunset-gradient',
    name: '日落渐变',
    category: 'nature',
    description: '橙红到深紫的垂直渐变天空',
    tags: ['日落', '渐变', '暖色', '天空'],
    thumbnailColor: [0.9, 0.3, 0.1],
    source: `scene "日落渐变" {
  canvas: 1920x1080

  layer "sky" {
    opcode: LINEAR_GRADIENT
    color: [0.95, 0.4, 0.1, 1.0]
    color2: [0.3, 0.05, 0.4, 1.0]
    angle: 90
    blendMode: normal
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["sky"]
  }
}`,
  },
  {
    id: 'ocean-waves',
    name: '海洋波纹',
    category: 'nature',
    description: '深蓝噪声波纹 + 模糊效果',
    tags: ['海洋', '波纹', '蓝色', '模糊'],
    thumbnailColor: [0.05, 0.2, 0.5],
    source: `scene "海洋波纹" {
  canvas: 1920x1080

  layer "water" {
    opcode: NOISE
    scale: 0.3
    intensity: 0.7
    seed: 7
    color: [0.05, 0.2, 0.5, 1.0]
    blendMode: normal
  }

  effect "blur" {
    type: blur
    target: "water"
    radius: 2
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["water"]
  }
}`,
  },

  // —— 都市 ——
  {
    id: 'neon-city',
    name: '霓虹都市',
    category: 'urban',
    description: '赛博朋克风格紫红霓虹 + 故障效果',
    tags: ['霓虹', '赛博朋克', '紫色', '故障', '都市'],
    thumbnailColor: [0.8, 0.1, 0.8],
    source: `scene "霓虹都市" {
  canvas: 1920x1080

  layer "bg" {
    opcode: SOLID_COLOR
    color: [0.05, 0.0, 0.1, 1.0]
    blendMode: normal
  }

  layer "neon" {
    opcode: LINEAR_GRADIENT
    color: [0.8, 0.1, 0.8, 1.0]
    color2: [0.1, 0.8, 0.9, 1.0]
    angle: 45
    blendMode: add
  }

  effect "glitch" {
    type: vignette
    target: "neon"
    intensity: 0.4
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg", "neon"]
  }
}`,
  },
  {
    id: 'city-rain',
    name: '雨夜城市',
    category: 'urban',
    description: '深灰背景 + 噪声雨滴 + 蓝色调',
    tags: ['雨夜', '城市', '灰色', '雨滴'],
    thumbnailColor: [0.2, 0.2, 0.25],
    source: `scene "雨夜城市" {
  canvas: 1920x1080

  layer "skyline" {
    opcode: SOLID_COLOR
    color: [0.15, 0.15, 0.2, 1.0]
    blendMode: normal
  }

  layer "rain" {
    opcode: NOISE
    scale: 0.95
    intensity: 0.3
    seed: 123
    color: [0.4, 0.5, 0.7, 1.0]
    blendMode: add
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["skyline", "rain"]
  }
}`,
  },

  // —— 抽象 ——
  {
    id: 'plasma-flow',
    name: '等离子流',
    category: 'abstract',
    description: '彩色噪声流动 + 高强度混合',
    tags: ['等离子', '流动', '彩色', '抽象'],
    thumbnailColor: [0.6, 0.2, 0.9],
    source: `scene "等离子流" {
  canvas: 1920x1080

  layer "flow" {
    opcode: NOISE
    scale: 0.5
    intensity: 1.0
    seed: 99
    blendMode: add
  }

  layer "glow" {
    opcode: CIRCLE_SHAPE
    color: [0.6, 0.2, 0.9, 0.5]
    radius: 0.3
    blendMode: add
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["flow", "glow"]
  }
}`,
  },
  {
    id: 'color-burst',
    name: '色彩迸发',
    category: 'abstract',
    description: '多色渐变叠加 + 圆形扩散',
    tags: ['色彩', '迸发', '渐变', '圆形'],
    thumbnailColor: [0.9, 0.5, 0.1],
    source: `scene "色彩迸发" {
  canvas: 1920x1080

  layer "base" {
    opcode: LINEAR_GRADIENT
    color: [0.9, 0.2, 0.3, 1.0]
    color2: [0.1, 0.5, 0.9, 1.0]
    angle: 135
    blendMode: normal
  }

  layer "burst" {
    opcode: CIRCLE_SHAPE
    color: [1.0, 0.8, 0.2, 0.7]
    radius: 0.4
    blendMode: add
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["base", "burst"]
  }
}`,
  },

  // —— 极简 ——
  {
    id: 'solid-red',
    name: '纯色测试',
    category: 'minimal',
    description: '单层纯红色,用于测试基础渲染',
    tags: ['纯色', '测试', '红色', '极简'],
    thumbnailColor: [1.0, 0.0, 0.0],
    source: `scene "纯色测试" {
  canvas: 1920x1080

  layer "bg" {
    opcode: SOLID_COLOR
    color: [1, 0, 0, 1]
    blendMode: normal
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg"]
  }
}`,
  },
  {
    id: 'blank',
    name: '空白场景',
    category: 'minimal',
    description: '空场景骨架,从零开始构建',
    tags: ['空白', '骨架', '极简'],
    thumbnailColor: [0.1, 0.1, 0.1],
    source: `scene "空白场景" {
  canvas: 1920x1080

  layer "layer1" {
    opcode: SOLID_COLOR
    color: [0.5, 0.5, 0.5, 1.0]
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["layer1"]
  }
}`,
  },
]

// ============================================================================
// 3. 查询函数
// ============================================================================

/**
 * 按类别获取模板。
 *
 * @param category 模板类别
 * @returns 该类别下所有模板
 */
export function getTemplatesByCategory(category: TemplateCategory): WDLTemplate[] {
  return WDL_TEMPLATES.filter((t) => t.category === category)
}

/**
 * 按 ID 获取模板。
 *
 * @param id 模板 ID
 * @returns 模板或 undefined
 */
export function getTemplateById(id: string): WDLTemplate | undefined {
  return WDL_TEMPLATES.find((t) => t.id === id)
}

/**
 * 按关键词搜索模板(在 name / description / tags 中匹配)。
 *
 * @param keyword 搜索关键词(空字符串返回全部)
 * @returns 匹配的模板列表
 */
export function searchTemplates(keyword: string): WDLTemplate[] {
  if (!keyword || keyword.trim().length === 0) {
    return [...WDL_TEMPLATES]
  }
  const kw = keyword.trim().toLowerCase()
  return WDL_TEMPLATES.filter((t) => {
    return (
      t.name.toLowerCase().includes(kw) ||
      t.description.toLowerCase().includes(kw) ||
      t.tags.some((tag) => tag.toLowerCase().includes(kw))
    )
  })
}

/**
 * 获取所有类别。
 *
 * @returns 类别列表(含每个类别的模板数)
 */
export function getCategories(): { category: TemplateCategory; count: number; label: string }[] {
  const labels: Record<TemplateCategory, string> = {
    nature: '自然',
    urban: '都市',
    abstract: '抽象',
    minimal: '极简',
  }
  return (Object.keys(labels) as TemplateCategory[]).map((category) => ({
    category,
    count: WDL_TEMPLATES.filter((t) => t.category === category).length,
    label: labels[category],
  }))
}

// ============================================================================
// 4. 模板校验(确保所有模板都是合法 WDL)
// ============================================================================

/**
 * 校验所有模板是否为合法 WDL(开发时用)。
 *
 * @returns 无效模板列表(id + 错误消息)
 */
export function validateAllTemplates(): { id: string; name: string; errors: string[] }[] {
  const invalid: { id: string; name: string; errors: string[] }[] = []
  for (const tmpl of WDL_TEMPLATES) {
    const report = validateSource(tmpl.source)
    if (!report.valid) {
      invalid.push({
        id: tmpl.id,
        name: tmpl.name,
        errors: report.errors.map((e) => e.message),
      })
    }
  }
  return invalid
}
