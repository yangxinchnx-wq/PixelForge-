/**
 * 节点能力注册表(Step 25.5)。
 *
 * 核心思想(用户 spec):AI 不能随便输出 RandomNode,必须从注册表选择。
 *
 * 注册表职责:
 * - 提供节点定义(type / opcodeName / inputs / outputs / defaultParams)
 * - 描述节点的语义角色(背景 / 主体 / 前景 / 调色 / 模糊 ...)
 * - 作为 AI Graph Generator 的「能力清单」
 *
 * 与 generator/layerTemplates.ts 的关系:
 * - layerTemplates: ScenePlan 用的模板(扁平 Layer 列表,无连接关系)
 * - nodeRegistry:   RenderGraph 用的节点(DAG,有输入输出端口)
 * 两者共享 5 个 opcode 和 5 个 effect type,但表达形式不同。
 *
 * 节点清单:
 *   REGION 节点(对应 Layer):
 *     - SolidColor / LinearGradient / Noise / CircleShape / ImageTexture
 *   EFFECT 节点(对应 Effect):
 *     - Blur / Bloom / ColorShift / Vignette / Mask
 *   COMPOSITE 节点(合并多输入到单 region):
 *     - Composite
 *   OUTPUT 节点(画布输出):
 *     - Output
 */

import type { JsonLiteral } from '@/shared/types'
import type { NodeType, Port } from './types'

/**
 * 节点定义(注册表中的静态描述)。
 *
 * - key:           注册表 key(如 'Noise' / 'Vignette' / 'Output')
 * - label:         中文标签(如 '噪声' / '晕影' / '输出')
 * - type:          节点类型(REGION/EFFECT/COMPOSITE/OUTPUT)
 * - opcodeName:    REGION 节点的 opcode 名 / EFFECT 节点的 effect type
 * - description:   描述(UI / 调试用)
 * - inputs:        输入端口列表
 * - outputs:       输出端口列表
 * - defaultParams: 默认参数(与 generator/layerTemplates 的 defaultParams 对齐)
 * - category:      UI 分类(用于 NodeToolbar 分组显示)
 */
export interface NodeDefinition {
  key: string
  label: string
  type: NodeType
  opcodeName?: string
  description: string
  inputs: Port[]
  outputs: Port[]
  defaultParams: Record<string, JsonLiteral>
  category: 'background' | 'shape' | 'effect' | 'composite' | 'output'
}

/** texture 输出端口(常用) */
const TEXTURE_OUT: Port = { id: 'output', name: 'texture', type: 'texture' }

/** texture 输入端口(常用,用于 EFFECT 节点) */
const TEXTURE_IN: Port = { id: 'input', name: 'source', type: 'texture' }

/**
 * 可选 texture 输入端口(用于 REGION 节点)。
 *
 * 语义:REGION 节点的 input 表示「下层背景」(用于图层堆叠)。
 * - 编译时:input 端口不影响 Layer 生成(REGION 节点独立渲染,通过 region.layerRefs 合并)
 * - 图结构上:允许 SolidColor → Noise → Vignette → Output 的链式表达
 * - 验证时:input 端口可有可无(不强制要求连接)
 */
const OPTIONAL_TEXTURE_IN: Port = { id: 'input', name: 'background', type: 'texture' }

/**
 * 节点注册表(以 key 索引)。
 *
 * 顺序:background → shape → effect → composite → output
 * 与 generator/layerTemplates 的 8 个模板保持参数一致,
 * 但拆分为「REGION 节点 + EFFECT 节点」两类。
 *
 * 端口设计:
 * - REGION 节点:有 1 个可选 input(下层背景)+ 1 个 output(自身纹理)
 * - EFFECT 节点:有 1 个必填 input(作用对象)+ 1 个 output(处理后纹理)
 * - COMPOSITE 节点:有多个 input(合并对象)+ 1 个 output
 * - OUTPUT 节点:有 1 个 input(最终结果),无 output
 */
export const NodeRegistry = {
  // —— REGION: 背景类 ——
  SolidColor: {
    key: 'SolidColor',
    label: '纯色背景',
    type: 'REGION',
    opcodeName: 'SOLID_COLOR',
    description: '单色铺底背景层',
    inputs: [OPTIONAL_TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      color: [0.05, 0.06, 0.12, 1] as JsonLiteral,
    },
    category: 'background',
  },

  LinearGradient: {
    key: 'LinearGradient',
    label: '渐变背景',
    type: 'REGION',
    opcodeName: 'LINEAR_GRADIENT',
    description: '线性渐变背景(对角双色)',
    inputs: [OPTIONAL_TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      from: [0, 0] as JsonLiteral,
      to: [1, 1] as JsonLiteral,
      colorA: [0.05, 0.06, 0.12, 1] as JsonLiteral,
      colorB: [0.18, 0.12, 0.32, 1] as JsonLiteral,
    },
    category: 'background',
  },

  // —— REGION: 形状类 ——
  Noise: {
    key: 'Noise',
    label: '噪声纹理',
    type: 'REGION',
    opcodeName: 'NOISE',
    description: '可配置噪声纹理(星云 / 星空 / 银河 / 粒子的基础)',
    inputs: [OPTIONAL_TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      scale: 24,
      amount: 0.7,
      colorA: [0.08, 0.11, 0.25, 1] as JsonLiteral,
      colorB: [0.74, 0.85, 0.98, 1] as JsonLiteral,
    },
    category: 'shape',
  },

  CircleShape: {
    key: 'CircleShape',
    label: '圆形',
    type: 'REGION',
    opcodeName: 'CIRCLE_SHAPE',
    description: '圆形主体(中心 / 半径 / 填充色)',
    inputs: [OPTIONAL_TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      center: [0.5, 0.5] as JsonLiteral,
      radius: 0.25,
      fill: [0.95, 0.85, 0.15, 1] as JsonLiteral,
      background: [0, 0, 0, 0] as JsonLiteral,
    },
    category: 'shape',
  },

  ImageTexture: {
    key: 'ImageTexture',
    label: '图像纹理',
    type: 'REGION',
    opcodeName: 'IMAGE_TEXTURE',
    description: '外部图像纹理(需配合 Asset 选用)',
    inputs: [OPTIONAL_TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      assetId: '' as JsonLiteral,
      region: [0, 0, 1, 1] as JsonLiteral,
    },
    category: 'shape',
  },

  // —— EFFECT: 调色类 ——
  Blur: {
    key: 'Blur',
    label: '模糊',
    type: 'EFFECT',
    opcodeName: 'blur',
    description: '高斯模糊(柔和效果)',
    inputs: [TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      radius: 0.005,
    },
    category: 'effect',
  },

  Bloom: {
    key: 'Bloom',
    label: '泛光',
    type: 'EFFECT',
    opcodeName: 'bloom',
    description: '亮度溢出泛光(梦幻效果)',
    inputs: [TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      threshold: 0.7,
      intensity: 0.5,
    },
    category: 'effect',
  },

  ColorShift: {
    key: 'ColorShift',
    label: '色彩偏移',
    type: 'EFFECT',
    opcodeName: 'color_shift',
    description: 'RGB 通道偏移(色差 / 抖动效果)',
    inputs: [TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      shift: 0.005,
    },
    category: 'effect',
  },

  Vignette: {
    key: 'Vignette',
    label: '晕影',
    type: 'EFFECT',
    opcodeName: 'vignette',
    description: '边缘暗化(电影感效果)',
    inputs: [TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      strength: 0.5,
    },
    category: 'effect',
  },

  Mask: {
    key: 'Mask',
    label: '遮罩',
    type: 'EFFECT',
    opcodeName: 'mask',
    description: '圆形遮罩(中心 / 半径)',
    inputs: [TEXTURE_IN],
    outputs: [TEXTURE_OUT],
    defaultParams: {
      centerX: 0.5,
      centerY: 0.5,
      radius: 0.4,
    },
    category: 'effect',
  },

  // —— COMPOSITE: 合并类 ——
  Composite: {
    key: 'Composite',
    label: '合成',
    type: 'COMPOSITE',
    description: '合并多个输入到同一 region(顺序敏感,前面在下层)',
    inputs: [
      { id: 'input_0', name: '底层', type: 'texture' },
      { id: 'input_1', name: '叠加 1', type: 'texture' },
      { id: 'input_2', name: '叠加 2', type: 'texture' },
    ],
    outputs: [TEXTURE_OUT],
    defaultParams: {},
    category: 'composite',
  },

  // —— OUTPUT: 输出类 ——
  Output: {
    key: 'Output',
    label: '输出',
    type: 'OUTPUT',
    description: '画布输出节点(每个 Graph 必须有且仅有 1 个)',
    inputs: [TEXTURE_IN],
    outputs: [],
    defaultParams: {},
    category: 'output',
  },
} as const satisfies Record<string, NodeDefinition>

/** 注册表 key 类型 */
export type NodeRegistryKey = keyof typeof NodeRegistry

/**
 * 根据 key 取节点定义(类型收紧)。
 * 不存在时抛错(避免运行时静默失败)。
 */
export function getNodeDefinition(key: NodeRegistryKey): NodeDefinition {
  const def = NodeRegistry[key]
  if (!def) {
    throw new Error(`未知节点 key: ${key}`)
  }
  return def
}

/**
 * 列出所有注册表 key。
 */
export function listNodeKeys(): NodeRegistryKey[] {
  return Object.keys(NodeRegistry) as NodeRegistryKey[]
}

/**
 * 按 category 分组列出节点 key(用于 NodeToolbar 分组显示)。
 */
export function listNodeKeysByCategory(): Record<string, NodeRegistryKey[]> {
  const groups: Record<string, NodeRegistryKey[]> = {}
  for (const [key, def] of Object.entries(NodeRegistry)) {
    if (!groups[def.category]) groups[def.category] = []
    groups[def.category].push(key as NodeRegistryKey)
  }
  return groups
}

/**
 * 根据 opcodeName 反查 REGION 节点 key(用于 GraphGenerator 从 Layer 反向构建节点)。
 */
export function findRegionNodeByOpcodeName(
  opcodeName: string,
): NodeRegistryKey | undefined {
  for (const [key, def] of Object.entries(NodeRegistry)) {
    if (def.type === 'REGION' && def.opcodeName === opcodeName) {
      return key as NodeRegistryKey
    }
  }
  return undefined
}

/**
 * 根据 effect type 反查 EFFECT 节点 key。
 */
export function findEffectNodeByType(
  effectType: string,
): NodeRegistryKey | undefined {
  for (const [key, def] of Object.entries(NodeRegistry)) {
    if (def.type === 'EFFECT' && def.opcodeName === effectType) {
      return key as NodeRegistryKey
    }
  }
  return undefined
}
