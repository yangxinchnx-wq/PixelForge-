/**
 * 图层模板库(Step 24.3)。
 *
 * 核心思想:AI 不自由生成 GPU 指令,而是从已有 LayerTemplate 中选择。
 *
 * 模板职责:
 * - 提供可读名(name)、opcode 名、语义角色(role)、默认参数(defaultParams)
 * - 描述(description)用于 UI 显示与调试
 *
 * 当前 Phase B 支持的 opcode(与 Opcode enum 对齐):
 *   SOLID_COLOR / LINEAR_GRADIENT / NOISE / CIRCLE_SHAPE / IMAGE_TEXTURE
 *
 * 模板清单(按主题分类):
 *   背景类:    SOLID_BG / GRADIENT_BG
 *   宇宙类:    STAR_FIELD / NEBULA / GALAXY / PARTICLE
 *   抽象类:    ORB / DUST
 *
 * 注:用户原始 Step 24 spec 提到的 SPIRAL/PARTICLE opcode 当前不存在,
 *     这里用 NOISE + 不同参数配置模拟(SPIRAL → 高密度小尺度, PARTICLE → 稀疏点状)。
 *     未来若新增 SPIRAL/PARTICLE opcode,只需更新 OPCODE_NAME_MAP 与对应模板即可。
 */

import type { JsonLiteral } from '@/shared/types'
import type { LayerRole, SceneLayer } from './types'

/**
 * 单个图层模板的定义。
 * - name:          模板可读名(如 'STAR_FIELD')
 * - label:         中文标签(如 '星空',用于 SceneLayer.name)
 * - opcodeName:    opcode 字符串名(必须为 SUPPORTED_OPCODE_NAMES 之一)
 * - role:          语义角色
 * - description:   描述(UI / 调试用)
 * - defaultParams: 默认参数(会被 parameterMapper 的输出覆盖)
 */
export interface LayerTemplate {
  name: string
  label: string
  opcodeName: string
  role: LayerRole
  description: string
  defaultParams: Record<string, JsonLiteral>
}

/**
 * 模板表(以模板名为 key)。
 *
 * 顺序遵循「背景 → 主体 → 前景 → 叠加」,
 * 但实际场景图层顺序由 planner 根据主题重排,getTemplatesForSubject 返回的顺序即为生成顺序。
 */
export const LayerTemplates = {
  // —— 背景类 ——
  SOLID_BG: {
    name: 'SOLID_BG',
    label: '纯色背景',
    opcodeName: 'SOLID_COLOR',
    role: 'background',
    description: '单色铺底,作为最底层背景',
    defaultParams: {
      color: [0.05, 0.06, 0.12, 1] as JsonLiteral,
    },
  },

  GRADIENT_BG: {
    name: 'GRADIENT_BG',
    label: '渐变背景',
    opcodeName: 'LINEAR_GRADIENT',
    role: 'background',
    description: '线性渐变背景(从一角到另一角)',
    defaultParams: {
      from: [0, 0] as JsonLiteral,
      to: [1, 1] as JsonLiteral,
      colorA: [0.05, 0.06, 0.12, 1] as JsonLiteral,
      colorB: [0.18, 0.12, 0.32, 1] as JsonLiteral,
    },
  },

  // —— 宇宙类 ——
  STAR_FIELD: {
    name: 'STAR_FIELD',
    label: '星空',
    opcodeName: 'NOISE',
    role: 'main',
    description: '密集星点(高尺度噪声 + 白色高光)',
    defaultParams: {
      scale: 32,
      amount: 0.85,
      colorA: [0.08, 0.11, 0.25, 1] as JsonLiteral,
      colorB: [1, 1, 1, 1] as JsonLiteral,
    },
  },

  NEBULA: {
    name: 'NEBULA',
    label: '星云',
    opcodeName: 'NOISE',
    role: 'main',
    description: '柔和云雾状结构(大尺度噪声 + 低饱和)',
    defaultParams: {
      scale: 8,
      amount: 0.55,
      colorA: [0.18, 0.08, 0.35, 1] as JsonLiteral,
      colorB: [0.42, 0.18, 0.62, 1] as JsonLiteral,
    },
  },

  GALAXY: {
    name: 'GALAXY',
    label: '银河',
    opcodeName: 'NOISE',
    role: 'main',
    description: '漩涡状银河结构(中尺度噪声 + 双色高对比)',
    defaultParams: {
      scale: 18,
      amount: 0.65,
      colorA: [0.3, 0.1, 0.5, 1] as JsonLiteral,
      colorB: [0.95, 0.85, 0.3, 1] as JsonLiteral,
    },
  },

  PARTICLE: {
    name: 'PARTICLE',
    label: '星尘',
    opcodeName: 'NOISE',
    role: 'foreground',
    description: '稀疏点状粒子(高尺度噪声 + 低强度)',
    defaultParams: {
      scale: 48,
      amount: 0.35,
      colorA: [0, 0, 0, 0] as JsonLiteral,
      colorB: [1, 0.95, 0.7, 1] as JsonLiteral,
    },
  },

  // —— 抽象类 ——
  ORB: {
    name: 'ORB',
    label: '光球',
    opcodeName: 'CIRCLE_SHAPE',
    role: 'main',
    description: '圆形主体(中心 + 半径 + 填充色)',
    defaultParams: {
      center: [0.5, 0.5] as JsonLiteral,
      radius: 0.25,
      fill: [0.95, 0.85, 0.15, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
  },

  DUST: {
    name: 'DUST',
    label: '尘埃',
    opcodeName: 'NOISE',
    role: 'foreground',
    description: '低强度弥散噪点(增加画面颗粒感)',
    defaultParams: {
      scale: 64,
      amount: 0.18,
      colorA: [0, 0, 0, 0] as JsonLiteral,
      colorB: [0.6, 0.55, 0.45, 1] as JsonLiteral,
    },
  },
} as const satisfies Record<string, LayerTemplate>

/** 模板名集合 */
export type LayerTemplateKey = keyof typeof LayerTemplates

/**
 * 根据 key 取模板(类型收紧)。
 * 不存在时抛错(避免运行时静默失败)。
 */
export function getTemplate(key: LayerTemplateKey): LayerTemplate {
  const tpl = LayerTemplates[key]
  if (!tpl) {
    throw new Error(`未知模板名: ${key}`)
  }
  return tpl
}

/**
 * 列出所有模板 key(用于 UI 展示 / 调试)。
 */
export function listTemplateKeys(): LayerTemplateKey[] {
  return Object.keys(LayerTemplates) as LayerTemplateKey[]
}

/**
 * 主题 → 推荐模板列表(顺序即为生成顺序,background 在前)。
 *
 * 主题与现有 intentAnalyzer.ts 的 SUBJECT_KEYWORDS 对齐:
 *   宇宙 / 森林 / 海洋 / 城市 / 人物 / 抽象 / 山水
 *
 * 未知主题回退到 ['GRADIENT_BG'](最小可渲染场景)。
 */
export function getTemplatesForSubject(subject: string): LayerTemplateKey[] {
  switch (subject) {
    case '宇宙':
      return ['GRADIENT_BG', 'NEBULA', 'STAR_FIELD', 'GALAXY', 'PARTICLE']
    case '森林':
      return ['GRADIENT_BG', 'DUST']
    case '海洋':
      return ['GRADIENT_BG', 'DUST']
    case '城市':
      return ['SOLID_BG', 'DUST']
    case '人物':
      return ['GRADIENT_BG', 'ORB']
    case '抽象':
      return ['GRADIENT_BG', 'ORB', 'DUST']
    case '山水':
      return ['GRADIENT_BG', 'DUST']
    default:
      return ['GRADIENT_BG']
  }
}

/**
 * 把 LayerTemplate 实例化为 SceneLayer(深拷贝 defaultParams,避免共享引用)。
 *
 * @param key     模板 key
 * @param params  覆盖参数(由 parameterMapper 生成,会合并到 defaultParams 上)
 * @returns SceneLayer(可进入 RenderIR 生成流程)
 */
export function instantiateTemplate(
  key: LayerTemplateKey,
  params?: Record<string, JsonLiteral>,
): SceneLayer {
  const tpl = getTemplate(key)
  const merged: Record<string, JsonLiteral> = { ...tpl.defaultParams }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      merged[k] = v
    }
  }
  return {
    name: tpl.label,
    opcodeName: tpl.opcodeName,
    role: tpl.role,
    params: merged,
  }
}
