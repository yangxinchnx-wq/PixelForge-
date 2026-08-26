/**
 * Material Graph Generator(Step 28.21)— CreativeRequirement → MaterialGraph 自动生成器。
 *
 * 职责:
 * - 接收 CreativeRequirement(用户需求),输出 MaterialGraph(节点图)
 * - 把人类语言描述的 style / camera / motion 转换为节点参数
 * - 根据 subject 选择合适的预设,并根据风格参数覆盖
 *
 * 数据流:
 *   CreativeRequirement
 *     → mapRequirementToPresetParams(requirement)  [风格 → 预设参数]
 *     → getPresetsForSubject(subject)              [主题 → 预设列表]
 *     → buildPreset(presetKey, params)             [构建 MaterialGraph]
 *     → (可选) appendColorCorrect(graph, params)   [追加调色节点]
 *     → MaterialGraph
 *
 * 与 authoring/generator/renderIRGenerator.ts 的关系:
 * - renderIRGenerator:  CreativeRequirement → RenderIR(高层,opcode 级别)
 * - materialGraphGenerator: CreativeRequirement → MaterialGraph(底层,节点级别)
 *
 * 两套系统并行,用户可以选择走 RenderIR 路径(固定 shader)或 MaterialGraph 路径(自定义 WGSL)。
 */

import type { CreativeRequirement } from '@/authoring/clarifier/types'
import type { JsonLiteral } from '@/shared/types'
import type { MaterialGraph, MaterialEdge } from './types'
import { createNodeFromTemplate } from './shaderRegistry'
import {
  buildPreset,
  getPresetsForSubject,
  type MaterialPresetKey,
  type PresetParams,
} from './materialPresets'
import { mapColorToRgba } from '@/authoring/generator/parameterMapper'

// ============================================================================
// 1. 需求 → 预设参数映射
// ============================================================================

/**
 * 把 CreativeRequirement 的风格字段转换为 PresetParams。
 *
 * 映射规则:
 * - style.color → colorA(主色)
 * - style.tone → brightness / contrast / saturation
 * - style.lighting → 影响是否追加调色节点
 * - motion.speed → scale(噪声缩放)
 *
 * @param requirement 用户需求
 * @returns 预设参数(可部分填充)
 */
export function mapRequirementToPresetParams(
  requirement: CreativeRequirement,
): PresetParams {
  const params: PresetParams = {}
  const { style, motion } = requirement

  // —— 颜色映射 ——
  if (style?.color) {
    const rgba = mapColorToRgba(style.color)
    if (rgba) {
      params.colorA = rgba
    }
  }

  // —— 调性 → 亮度/对比度/饱和度 ——
  if (style?.tone) {
    switch (style.tone) {
      case 'cinematic':
        params.brightness = -0.1
        params.contrast = 1.3
        params.saturation = 0.85
        break
      case 'anime':
        params.brightness = 0.05
        params.contrast = 1.15
        params.saturation = 1.2
        break
      case 'oil-painting':
        params.brightness = -0.05
        params.contrast = 1.25
        params.saturation = 0.95
        break
      case 'cyberpunk':
        params.brightness = -0.15
        params.contrast = 1.45
        params.saturation = 1.3
        break
      case 'minimal':
        params.brightness = 0.0
        params.contrast = 1.05
        params.saturation = 0.7
        break
      case 'realistic':
        params.brightness = -0.02
        params.contrast = 1.18
        params.saturation = 1.0
        break
      case 'dreamy':
        params.brightness = 0.08
        params.contrast = 1.0
        params.saturation = 1.1
        break
      default:
        // 未知 tone 不映射
        break
    }
  }

  // —— 运动 → 噪声缩放 ——
  if (motion?.speed !== undefined) {
    if (motion.speed < 0.3) {
      // 慢镜头:纹理放大
      params.scale = 0.5
    } else if (motion.speed > 0.7) {
      // 快镜头:纹理细化
      params.scale = 2.0
    }
    // 中速不覆盖(使用预设默认值)
  }

  return params
}

// ============================================================================
// 2. 主题 → 预设选择
// ============================================================================

/**
 * 主题 → 主预设 key 映射。
 *
 * 选择最代表性的预设作为主材质。
 * 与 layerTemplates.ts 的 getTemplatesForSubject 对齐。
 */
const SUBJECT_TO_MAIN_PRESET: Record<string, MaterialPresetKey> = {
  '宇宙': 'nebula',
  '星空': 'starfield',
  '夜空': 'starfield',
  '星云': 'nebula',
  '银河': 'galaxy',
  '森林': 'cellular',
  '海洋': 'nebula',
  '城市': 'gradient_bg',
  '人物': 'gradient_bg',
  '抽象': 'cellular',
  '山水': 'gradient_bg',
  '电影': 'cinematic',
  'cinematic': 'cinematic',
}

/**
 * 根据主题选择主预设。
 *
 * 1. 精确匹配 SUBJECT_TO_MAIN_PRESET
 * 2. 模糊匹配(主题包含关键词)
 * 3. 回退到 getPresetsForSubject 的第一个
 * 4. 最终回退到 gradient_bg
 */
export function selectPresetForSubject(subject: string): MaterialPresetKey {
  // 1. 精确匹配
  if (SUBJECT_TO_MAIN_PRESET[subject]) {
    return SUBJECT_TO_MAIN_PRESET[subject]
  }

  // 2. 模糊匹配
  for (const [keyword, key] of Object.entries(SUBJECT_TO_MAIN_PRESET)) {
    if (subject.includes(keyword) || keyword.includes(subject)) {
      return key
    }
  }

  // 3. 回退到 getPresetsForSubject
  const presets = getPresetsForSubject(subject)
  if (presets.length > 0) {
    return presets[0] as MaterialPresetKey
  }

  // 4. 最终回退
  return 'gradient_bg'
}

// ============================================================================
// 3. 图操作工具
// ============================================================================

/** 生成确定性节点 ID */
let genCounter = 0
function genId(prefix: string): string {
  genCounter++
  return `gen_${prefix}_${genCounter.toString(36)}`
}

/** 生成确定性边 ID */
function makeEdgeId(from: string, fromPort: string, to: string, toPort: string): string {
  return `${from}:${fromPort}->${to}:${toPort}`
}

/**
 * 在图末尾追加 ColorCorrect 节点(在 OUTPUT 之前插入)。
 *
 * 如果图中已有 ColorCorrect 节点,则只更新参数。
 * 如果没有,则:
 * 1. 找到 OUTPUT 节点
 * 2. 找到 OUTPUT 的输入边
 * 3. 在 OUTPUT 前插入 ColorCorrect
 * 4. 重新连接边
 */
export function appendColorCorrect(
  graph: MaterialGraph,
  params: { brightness?: number; contrast?: number; saturation?: number },
): MaterialGraph {
  // 如果没有调色参数,直接返回原图
  if (
    params.brightness === undefined &&
    params.contrast === undefined &&
    params.saturation === undefined
  ) {
    return graph
  }

  // 检查是否已有 ColorCorrect 节点
  const existingCC = graph.nodes.find((n) => n.templateKey === 'color_correct')
  if (existingCC) {
    // 更新已有节点的参数
    const updatedNodes = graph.nodes.map((n) => {
      if (n.id === existingCC.id) {
        return {
          ...n,
          params: {
            ...n.params,
            ...(params.brightness !== undefined && { brightness: params.brightness as JsonLiteral }),
            ...(params.contrast !== undefined && { contrast: params.contrast as JsonLiteral }),
            ...(params.saturation !== undefined && { saturation: params.saturation as JsonLiteral }),
          },
        }
      }
      return n
    })
    return { ...graph, nodes: updatedNodes }
  }

  // 找到 OUTPUT 节点
  const outputNode = graph.nodes.find((n) => n.type === 'OUTPUT')
  if (!outputNode) return graph

  // 找到 OUTPUT 的输入边(color → output)
  const inputEdge = graph.edges.find((e) => e.to === outputNode.id && e.toPort === 'color')
  if (!inputEdge) return graph

  // 创建 ColorCorrect 节点
  const ccId = genId('cc')
  const ccNode = createNodeFromTemplate('color_correct', ccId, {
    x: outputNode.position.x - 260,
    y: outputNode.position.y,
  })
  if (!ccNode) return graph

  // 更新参数
  ccNode.params = {
    ...ccNode.params,
    ...(params.brightness !== undefined && { brightness: params.brightness as JsonLiteral }),
    ...(params.contrast !== undefined && { contrast: params.contrast as JsonLiteral }),
    ...(params.saturation !== undefined && { saturation: params.saturation as JsonLiteral }),
  }

  // 重新连接:上游 → CC → OUTPUT
  const newEdges: MaterialEdge[] = [
    // 原来的上游 → CC
    {
      id: makeEdgeId(inputEdge.from, inputEdge.fromPort, ccId, 'color'),
      from: inputEdge.from,
      fromPort: inputEdge.fromPort,
      to: ccId,
      toPort: 'color',
    },
    // CC → OUTPUT
    {
      id: makeEdgeId(ccId, 'result', outputNode.id, 'color'),
      from: ccId,
      fromPort: 'result',
      to: outputNode.id,
      toPort: 'color',
    },
  ]

  // 移除原来的边,添加新边
  const filteredEdges = graph.edges.filter((e) => e.id !== inputEdge.id)

  return {
    nodes: [...graph.nodes, ccNode],
    edges: [...filteredEdges, ...newEdges],
    canvas: { ...graph.canvas },
  }
}

// ============================================================================
// 4. 主生成函数
// ============================================================================

/**
 * 生成结果。
 */
export interface MaterialGenerationResult {
  /** 生成的 MaterialGraph */
  graph: MaterialGraph
  /** 使用的预设 key */
  presetKey: MaterialPresetKey
  /** 是否追加了调色节点 */
  hasColorCorrect: boolean
  /** 生成摘要(用于 UI 显示) */
  summary: string
}

/**
 * 从 CreativeRequirement 生成 MaterialGraph。
 *
 * 流程:
 * 1. mapRequirementToPresetParams: 风格 → 预设参数
 * 2. selectPresetForSubject: 主题 → 预设
 * 3. buildPreset: 构建 MaterialGraph
 * 4. appendColorCorrect: 追加调色节点(如果风格有 tone)
 *
 * @param requirement 用户需求(必须含 subject)
 * @returns 生成结果(含 MaterialGraph + 元信息)
 */
export function generateMaterialGraph(
  requirement: CreativeRequirement,
): MaterialGenerationResult {
  // 1. 风格 → 预设参数
  const presetParams = mapRequirementToPresetParams(requirement)

  // 2. 主题 → 预设
  const presetKey = selectPresetForSubject(requirement.subject)

  // 3. 构建预设图
  let graph = buildPreset(presetKey, presetParams)

  // 4. 追加调色节点(如果有 tone 参数)
  const ccParams: { brightness?: number; contrast?: number; saturation?: number } = {}
  if (presetParams.brightness !== undefined) ccParams.brightness = presetParams.brightness
  if (presetParams.contrast !== undefined) ccParams.contrast = presetParams.contrast
  if (presetParams.saturation !== undefined) ccParams.saturation = presetParams.saturation

  const hasCC = Object.keys(ccParams).length > 0
  if (hasCC) {
    // 如果预设本身已经有 ColorCorrect(如 cinematic / galaxy),appendColorCorrect 会更新参数而非追加
    graph = appendColorCorrect(graph, ccParams)
  }

  // 5. 生成摘要
  const nodeCount = graph.nodes.length
  const edgeCount = graph.edges.length
  const tone = requirement.style?.tone ?? '默认'
  const color = requirement.style?.color ?? '默认'
  const summary = `${presetKey} | ${nodeCount} 节点 ${edgeCount} 边 | 调性=${tone} 颜色=${color}`

  return {
    graph,
    presetKey,
    hasColorCorrect: hasCC || graph.nodes.some((n) => n.templateKey === 'color_correct'),
    summary,
  }
}

/**
 * 从自然语言文本快速生成 MaterialGraph。
 *
 * 简化接口:不做完整的需求澄清,直接从文本提取主题和风格。
 * 适用于快速预览 / UI "一键生成" 按钮。
 *
 * @param text 用户输入文本(如 "做一个蓝紫色的宇宙星空")
 * @returns 生成结果
 */
export function generateMaterialGraphFromText(
  text: string,
): MaterialGenerationResult {
  // 简单关键词提取(与 intentAnalyzer.ts 的逻辑对齐但不依赖它)
  const subject = extractSubject(text)
  const color = extractColor(text)
  const tone = extractTone(text)

  const requirement: CreativeRequirement = {
    subject,
    style: {
      ...(color && { color }),
      ...(tone && { tone }),
    },
    elements: [],
  }

  return generateMaterialGraph(requirement)
}

// ============================================================================
// 5. 关键词提取(简化版,不依赖 intentAnalyzer)
// ============================================================================

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  '宇宙': ['宇宙', '太空', 'space', 'cosmos'],
  '星空': ['星空', '星星', 'star', 'starfield'],
  '夜空': ['夜空', '夜晚', 'night'],
  '星云': ['星云', 'nebula'],
  '银河': ['银河', 'galaxy', 'milky'],
  '森林': ['森林', '树林', 'forest'],
  '海洋': ['海洋', '海', 'ocean', 'sea'],
  '城市': ['城市', '都市', 'city'],
  '人物': ['人物', '人像', 'portrait'],
  '抽象': ['抽象', 'abstract'],
  '山水': ['山水', '风景', 'landscape'],
  '电影': ['电影', 'cinematic', 'movie'],
}

function extractSubject(text: string): string {
  const lower = text.toLowerCase()
  for (const [subject, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return subject
    }
  }
  return '抽象'
}

const COLOR_KEYWORDS: Record<string, string[]> = {
  '蓝紫色': ['蓝紫', '蓝紫色'],
  '金黄色': ['金黄', '金黄色', '金色'],
  '红色': ['红色', '红'],
  '黑白': ['黑白', '灰度'],
  '粉色': ['粉色', '粉红'],
  '绿色': ['绿色', '绿'],
  '橙色': ['橙色', '橙'],
  '紫色': ['紫色', '紫'],
  '蓝色': ['蓝色', '蓝'],
  '暖色': ['暖色', '暖调'],
  '冷色': ['冷色', '冷调'],
}

function extractColor(text: string): string | undefined {
  for (const [color, keywords] of Object.entries(COLOR_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      return color
    }
  }
  return undefined
}

const TONE_KEYWORDS: Record<string, string[]> = {
  'cinematic': ['电影', 'cinematic', '电影感'],
  'anime': ['动漫', 'anime', '二次元'],
  'cyberpunk': ['赛博', 'cyberpunk', '霓虹'],
  'dreamy': ['梦幻', 'dreamy', '朦胧'],
  'minimal': ['极简', 'minimal', '简约'],
  'realistic': ['写实', 'realistic', '真实'],
  'oil-painting': ['油画', 'oil', '绘画'],
}

function extractTone(text: string): string | undefined {
  const lower = text.toLowerCase()
  for (const [tone, keywords] of Object.entries(TONE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return tone
    }
  }
  return undefined
}
