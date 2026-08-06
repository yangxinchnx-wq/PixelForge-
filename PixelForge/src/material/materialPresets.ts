/**
 * Material Graph 预设库(Step 28.20)— 常见材质效果的完整 MaterialGraph 预设。
 *
 * 职责:
 * - 提供预构建的 MaterialGraph,覆盖常见视觉效果(星空 / 星云 / 渐变 / 细胞 / 混合 / 调色)
 * - 每个 preset 是一个完整的 MaterialGraph(nodes + edges + canvas)
 * - 支持参数覆盖(由 materialGraphGenerator 调用时注入风格参数)
 *
 * 与 layerTemplates.ts 的关系:
 * - layerTemplates.ts: 高层 RenderIR 模板(opcode 级别,SOLID_COLOR / NOISE 等)
 * - materialPresets.ts: 底层 MaterialGraph 预设(节点级别,UV → Noise → Color → Output)
 *
 * 与 shaderRegistry.ts 的关系:
 * - shaderRegistry.ts 定义单个节点(12 种)
 * - materialPresets.ts 组合多个节点为完整图
 *
 * 设计原则:
 * - 预设图中的节点 ID 使用确定性前缀(如 'preset_uv'),保证同一预设多次实例化结构一致
 * - 边 ID 确定性生成(便于去重和调试)
 * - 预设参数可被覆盖(颜色 / scale / octaves 等)
 */

import type { JsonLiteral } from '@/shared/types'
import type { MaterialEdge, MaterialGraph, MaterialNode } from './types'
import { DEFAULT_MATERIAL_CANVAS } from './types'
import { createNodeFromTemplate } from './shaderRegistry'

// ============================================================================
// 1. 预设定义
// ============================================================================

/**
 * 预设参数覆盖类型。
 * 每个预设可以接受不同的参数覆盖(由 generator 传入)。
 */
export interface PresetParams {
  /** 主色 RGBA [0-1] */
  colorA?: [number, number, number, number]
  /** 辅色 RGBA [0-1] */
  colorB?: [number, number, number, number]
  /** 噪声/纹理缩放 */
  scale?: number
  /** 噪声强度/阈值 */
  amount?: number
  /** FBM 八度数 */
  octaves?: number
  /** 亮度 (-0.5 ~ 0.5) */
  brightness?: number
  /** 对比度 (0.5 ~ 2.0) */
  contrast?: number
  /** 饱和度 (0.0 ~ 2.0) */
  saturation?: number
  /** 混合系数 (0.0 ~ 1.0) */
  blendFactor?: number
}

/**
 * 预设定义。
 */
export interface MaterialPreset {
  /** 预设 key(如 'starfield') */
  key: string
  /** 中文标签 */
  label: string
  /** 描述 */
  description: string
  /** 适用的主题(如 '宇宙' / '抽象') */
  subjects: string[]
  /** 创建 MaterialGraph */
  build: (params?: PresetParams) => MaterialGraph
}

// ============================================================================
// 2. 工具函数
// ============================================================================

/** 确定性节点 ID 生成 */
function nodeId(preset: string, role: string): string {
  return `${preset}_${role}`
}

/** 确定性边 ID 生成 */
function edgeId(from: string, fromPort: string, to: string, toPort: string): string {
  return `${from}:${fromPort}->${to}:${toPort}`
}

/** 创建节点并注入参数 */
function makeNode(
  templateKey: string,
  id: string,
  position: { x: number; y: number },
  paramOverrides?: Record<string, JsonLiteral>,
): MaterialNode | null {
  const node = createNodeFromTemplate(templateKey, id, position)
  if (!node) return null
  if (paramOverrides) {
    node.params = { ...node.params, ...paramOverrides }
  }
  return node
}

/** 连接两个节点 */
function connect(
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
): MaterialEdge {
  return {
    id: edgeId(from, fromPort, to, toPort),
    from,
    fromPort,
    to,
    toPort,
  }
}

// ============================================================================
// 3. 预设实现
// ============================================================================

/**
 * 星空预设:UV → Noise(scale=32) → Blend(dark, white, t=noise) → Output
 *
 * 效果:密集星点,白色高光在深色背景上闪烁
 * 噪声值作为混合系数,在深色背景和亮色之间插值,产生星点效果
 */
const STARFIELD_PRESET: MaterialPreset = {
  key: 'starfield',
  label: '星空',
  description: '密集星点(高尺度噪声 + 白色高光)',
  subjects: ['宇宙', '星空', '夜空'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('starfield', 'uv'), { x: 80, y: 200 })
    const noise = makeNode('noise', nodeId('starfield', 'noise'), { x: 340, y: 150 }, {
      scale: p.scale ?? 32,
    })
    const colorA = makeNode('color', nodeId('starfield', 'colorA'), { x: 340, y: 350 }, {
      r: p.colorA?.[0] ?? 0.02,
      g: p.colorA?.[1] ?? 0.02,
      b: p.colorA?.[2] ?? 0.05,
      a: p.colorA?.[3] ?? 1.0,
    })
    const colorB = makeNode('color', nodeId('starfield', 'colorB'), { x: 340, y: 500 }, {
      r: p.colorB?.[0] ?? 1.0,
      g: p.colorB?.[1] ?? 1.0,
      b: p.colorB?.[2] ?? 1.0,
      a: p.colorB?.[3] ?? 1.0,
    })
    const blend = makeNode('blend', nodeId('starfield', 'blend'), { x: 620, y: 300 })
    const output = makeNode('output', nodeId('starfield', 'output'), { x: 880, y: 300 })

    const nodes = [uv, noise, colorA, colorB, blend, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', noise!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(noise!.id, 'value', blend!.id, 't'),
      connect(blend!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 星云预设:UV → FBM(scale=8, octaves=4) → Blend(dark, purple, t=fbm) → Output
 *
 * 效果:柔和云雾状结构,分形噪声在深色太空和紫色星云之间插值
 */
const NEBULA_PRESET: MaterialPreset = {
  key: 'nebula',
  label: '星云',
  description: '柔和云雾状结构(分形噪声 + 低饱和)',
  subjects: ['宇宙', '星云', '云雾'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('nebula', 'uv'), { x: 80, y: 200 })
    const fbm = makeNode('fbm', nodeId('nebula', 'fbm'), { x: 340, y: 150 }, {
      scale: p.scale ?? 8,
      octaves: p.octaves ?? 4,
      lacunarity: 2.0,
      gain: 0.5,
    })
    const colorA = makeNode('color', nodeId('nebula', 'colorA'), { x: 340, y: 350 }, {
      r: 0.02,
      g: 0.01,
      b: 0.05,
      a: 1.0,
    })
    const colorB = makeNode('color', nodeId('nebula', 'colorB'), { x: 340, y: 500 }, {
      r: p.colorA?.[0] ?? 0.25,
      g: p.colorA?.[1] ?? 0.08,
      b: p.colorA?.[2] ?? 0.45,
      a: p.colorA?.[3] ?? 1.0,
    })
    const blend = makeNode('blend', nodeId('nebula', 'blend'), { x: 620, y: 300 })
    const output = makeNode('output', nodeId('nebula', 'output'), { x: 880, y: 300 })

    const nodes = [uv, fbm, colorA, colorB, blend, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', fbm!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(fbm!.id, 'value', blend!.id, 't'),
      connect(blend!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 渐变背景预设:UV → Color(主色) → Output
 *
 * 效果:纯色背景(简化版,未来可扩展为真正的渐变节点)
 */
const GRADIENT_PRESET: MaterialPreset = {
  key: 'gradient_bg',
  label: '渐变背景',
  description: '单色背景铺底',
  subjects: ['背景', '底色', '纯色'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const color = makeNode('color', nodeId('gradient', 'color'), { x: 340, y: 200 }, {
      r: p.colorA?.[0] ?? 0.05,
      g: p.colorA?.[1] ?? 0.06,
      b: p.colorA?.[2] ?? 0.12,
      a: p.colorA?.[3] ?? 1.0,
    })
    const output = makeNode('output', nodeId('gradient', 'output'), { x: 600, y: 200 })

    const nodes = [color, output].filter((n): n is MaterialNode => n !== null)
    const edges = [connect(color!.id, 'color', output!.id, 'color')]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 细胞纹理预设:UV → Voronoi(scale=5) → Blend(dark, highlight, t=voronoi.x) → Output
 *
 * 效果:细胞状图案,Voronoi cellId 在深色和亮色之间插值,产生有机分割
 * 注:Voronoi 输出 vec2(cellId, distance),编译器自动 cast vec2→float 取 .x(cellId)
 */
const CELLULAR_PRESET: MaterialPreset = {
  key: 'cellular',
  label: '细胞纹理',
  description: '细胞噪声(Voronoi 图,有机分割)',
  subjects: ['抽象', '细胞', '有机'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('cellular', 'uv'), { x: 80, y: 200 })
    const voronoi = makeNode('voronoi', nodeId('cellular', 'voronoi'), { x: 340, y: 150 }, {
      scale: p.scale ?? 5.0,
    })
    const colorA = makeNode('color', nodeId('cellular', 'colorA'), { x: 340, y: 350 }, {
      r: 0.05,
      g: 0.08,
      b: 0.15,
      a: 1.0,
    })
    const colorB = makeNode('color', nodeId('cellular', 'colorB'), { x: 340, y: 500 }, {
      r: p.colorA?.[0] ?? 0.3,
      g: p.colorA?.[1] ?? 0.5,
      b: p.colorA?.[2] ?? 0.8,
      a: p.colorA?.[3] ?? 1.0,
    })
    const blend = makeNode('blend', nodeId('cellular', 'blend'), { x: 620, y: 300 })
    const output = makeNode('output', nodeId('cellular', 'output'), { x: 880, y: 300 })

    const nodes = [uv, voronoi, colorA, colorB, blend, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', voronoi!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(voronoi!.id, 'result', blend!.id, 't'),
      connect(blend!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 混合效果预设:UV → Noise + UV → Color → Blend → Output
 *
 * 效果:噪声纹理与纯色混合,产生过渡效果
 */
const BLEND_PRESET: MaterialPreset = {
  key: 'blend_effect',
  label: '混合效果',
  description: '噪声与颜色混合(渐变过渡)',
  subjects: ['混合', '过渡', '渐变'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('blend', 'uv'), { x: 80, y: 150 })
    const noise = makeNode('noise', nodeId('blend', 'noise'), { x: 340, y: 100 }, {
      scale: p.scale ?? 12,
    })
    const colorA = makeNode('color', nodeId('blend', 'colorA'), { x: 340, y: 300 }, {
      r: p.colorA?.[0] ?? 0.1,
      g: p.colorA?.[1] ?? 0.2,
      b: p.colorA?.[2] ?? 0.5,
      a: p.colorA?.[3] ?? 1.0,
    })
    const colorB = makeNode('color', nodeId('blend', 'colorB'), { x: 340, y: 450 }, {
      r: p.colorB?.[0] ?? 0.9,
      g: p.colorB?.[1] ?? 0.8,
      b: p.colorB?.[2] ?? 0.3,
      a: p.colorB?.[3] ?? 1.0,
    })
    // 用 colorA 作为 blend 的 a 输入,colorB 作为 b 输入
    // noise 输出 float → blend 的 t 输入(混合系数)
    const blend = makeNode('blend', nodeId('blend', 'blend'), { x: 620, y: 250 })
    const output = makeNode('output', nodeId('blend', 'output'), { x: 880, y: 250 })

    const nodes = [uv, noise, colorA, colorB, blend, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', noise!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(noise!.id, 'value', blend!.id, 't'),
      connect(blend!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 电影调色预设:UV → Noise → Blend(dark, bright, t=noise) → ColorCorrect → Output
 *
 * 效果:程序化纹理(噪声混合双色) + 亮度/对比度/饱和度调整,模拟电影感
 */
const CINEMATIC_PRESET: MaterialPreset = {
  key: 'cinematic',
  label: '电影调色',
  description: '程序化纹理 + 亮度/对比度/饱和度调整',
  subjects: ['电影', '调色', 'cinematic'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('cinematic', 'uv'), { x: 80, y: 200 })
    const noise = makeNode('noise', nodeId('cinematic', 'noise'), { x: 340, y: 150 }, {
      scale: p.scale ?? 16,
    })
    const colorA = makeNode('color', nodeId('cinematic', 'colorA'), { x: 340, y: 350 }, {
      r: 0.05,
      g: 0.02,
      b: 0.08,
      a: 1.0,
    })
    const colorB = makeNode('color', nodeId('cinematic', 'colorB'), { x: 340, y: 500 }, {
      r: p.colorA?.[0] ?? 0.4,
      g: p.colorA?.[1] ?? 0.15,
      b: p.colorA?.[2] ?? 0.55,
      a: p.colorA?.[3] ?? 1.0,
    })
    const blend = makeNode('blend', nodeId('cinematic', 'blend'), { x: 620, y: 300 })
    const colorCorrect = makeNode(
      'color_correct',
      nodeId('cinematic', 'cc'),
      { x: 860, y: 300 },
      {
        brightness: p.brightness ?? -0.1,
        contrast: p.contrast ?? 1.3,
        saturation: p.saturation ?? 0.85,
      },
    )
    const output = makeNode('output', nodeId('cinematic', 'output'), { x: 1120, y: 300 })

    const nodes = [uv, noise, colorA, colorB, blend, colorCorrect, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', noise!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(noise!.id, 'value', blend!.id, 't'),
      connect(blend!.id, 'result', colorCorrect!.id, 'color'),
      connect(colorCorrect!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 银河预设:UV → FBM(scale=18) → Blend(dark, bright, t=fbm) → ColorCorrect → Output
 *
 * 效果:漩涡状银河结构,分形噪声在深色和亮色之间插值 + 高对比调色
 */
const GALAXY_PRESET: MaterialPreset = {
  key: 'galaxy',
  label: '银河',
  description: '漩涡状银河结构(中尺度分形噪声 + 双色高对比)',
  subjects: ['宇宙', '银河', '漩涡'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('galaxy', 'uv'), { x: 80, y: 200 })
    const fbm = makeNode('fbm', nodeId('galaxy', 'fbm'), { x: 340, y: 150 }, {
      scale: p.scale ?? 18,
      octaves: p.octaves ?? 5,
      lacunarity: 2.0,
      gain: 0.5,
    })
    const colorA = makeNode('color', nodeId('galaxy', 'colorA'), { x: 340, y: 350 }, {
      r: 0.02,
      g: 0.01,
      b: 0.05,
      a: 1.0,
    })
    const colorB = makeNode('color', nodeId('galaxy', 'colorB'), { x: 340, y: 500 }, {
      r: p.colorA?.[0] ?? 0.35,
      g: p.colorA?.[1] ?? 0.12,
      b: p.colorA?.[2] ?? 0.55,
      a: p.colorA?.[3] ?? 1.0,
    })
    const blend = makeNode('blend', nodeId('galaxy', 'blend'), { x: 620, y: 300 })
    const colorCorrect = makeNode(
      'color_correct',
      nodeId('galaxy', 'cc'),
      { x: 860, y: 300 },
      {
        brightness: p.brightness ?? 0.0,
        contrast: p.contrast ?? 1.4,
        saturation: p.saturation ?? 1.1,
      },
    )
    const output = makeNode('output', nodeId('galaxy', 'output'), { x: 1120, y: 300 })

    const nodes = [uv, fbm, colorA, colorB, blend, colorCorrect, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', fbm!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(fbm!.id, 'value', blend!.id, 't'),
      connect(blend!.id, 'result', colorCorrect!.id, 'color'),
      connect(colorCorrect!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

/**
 * 星尘预设:UV → Noise(scale=48) → Blend(dark, warm, t=noise) → Output
 *
 * 效果:稀疏点状粒子,高尺度噪声在深色背景和暖色之间插值,增加画面颗粒感
 */
const DUST_PRESET: MaterialPreset = {
  key: 'dust',
  label: '星尘',
  description: '稀疏点状粒子(高尺度噪声 + 低强度)',
  subjects: ['宇宙', '粒子', '尘埃'],
  build(params?: PresetParams): MaterialGraph {
    const p = params ?? {}
    const uv = makeNode('uv', nodeId('dust', 'uv'), { x: 80, y: 200 })
    const noise = makeNode('noise', nodeId('dust', 'noise'), { x: 340, y: 150 }, {
      scale: p.scale ?? 48,
    })
    const colorA = makeNode('color', nodeId('dust', 'colorA'), { x: 340, y: 350 }, {
      r: 0.02,
      g: 0.02,
      b: 0.03,
      a: 1.0,
    })
    const colorB = makeNode('color', nodeId('dust', 'colorB'), { x: 340, y: 500 }, {
      r: p.colorB?.[0] ?? 0.6,
      g: p.colorB?.[1] ?? 0.55,
      b: p.colorB?.[2] ?? 0.45,
      a: p.colorB?.[3] ?? 1.0,
    })
    const blend = makeNode('blend', nodeId('dust', 'blend'), { x: 620, y: 300 })
    const output = makeNode('output', nodeId('dust', 'output'), { x: 880, y: 300 })

    const nodes = [uv, noise, colorA, colorB, blend, output].filter(
      (n): n is MaterialNode => n !== null,
    )
    const edges = [
      connect(uv!.id, 'uv', noise!.id, 'uv'),
      connect(colorA!.id, 'color', blend!.id, 'a'),
      connect(colorB!.id, 'color', blend!.id, 'b'),
      connect(noise!.id, 'value', blend!.id, 't'),
      connect(blend!.id, 'result', output!.id, 'color'),
    ]

    return { nodes, edges, canvas: { ...DEFAULT_MATERIAL_CANVAS } }
  },
}

// ============================================================================
// 4. 预设注册表
// ============================================================================

/**
 * 全部预设(按 key 索引)。
 */
const PRESETS: Record<string, MaterialPreset> = {
  starfield: STARFIELD_PRESET,
  nebula: NEBULA_PRESET,
  gradient_bg: GRADIENT_PRESET,
  cellular: CELLULAR_PRESET,
  blend_effect: BLEND_PRESET,
  cinematic: CINEMATIC_PRESET,
  galaxy: GALAXY_PRESET,
  dust: DUST_PRESET,
}

export type MaterialPresetKey = keyof typeof PRESETS

/**
 * 获取预设定义。
 */
export function getPreset(key: string): MaterialPreset | undefined {
  return PRESETS[key]
}

/**
 * 列出所有预设 key。
 */
export function listPresetKeys(): string[] {
  return Object.keys(PRESETS)
}

/**
 * 根据主题获取推荐预设列表(顺序即为生成顺序)。
 *
 * 与 layerTemplates.ts 的 getTemplatesForSubject 对齐。
 */
export function getPresetsForSubject(subject: string): string[] {
  // 精确匹配
  const matched = Object.values(PRESETS).filter((p) =>
    p.subjects.some((s) => s === subject),
  )
  if (matched.length > 0) {
    return matched.map((p) => p.key)
  }

  // 模糊匹配(包含关系)
  const fuzzy = Object.values(PRESETS).filter((p) =>
    p.subjects.some((s) => subject.includes(s) || s.includes(subject)),
  )
  if (fuzzy.length > 0) {
    return fuzzy.map((p) => p.key)
  }

  // 默认回退:渐变背景
  return ['gradient_bg']
}

/**
 * 实例化预设(构建 MaterialGraph)。
 *
 * @param key    预设 key
 * @param params 参数覆盖
 * @returns 完整 MaterialGraph
 */
export function buildPreset(
  key: MaterialPresetKey | string,
  params?: PresetParams,
): MaterialGraph {
  const preset = PRESETS[key]
  if (!preset) {
    throw new Error(`未知材质预设: ${key}`)
  }
  return preset.build(params)
}
