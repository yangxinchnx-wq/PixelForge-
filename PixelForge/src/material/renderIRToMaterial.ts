/**
 * RenderIR → MaterialGraph 桥接(Step 28.22)— 把 RenderIR Layer 转换为 MaterialGraph。
 *
 * 职责:
 * - 接收 RenderIR(高层 IR),输出 MaterialGraph(底层节点图)
 * - 每种 Opcode 映射到对应的节点组合
 * - 多个 Layer 通过 BLEND 节点合成
 *
 * 映射规则:
 *   SOLID_COLOR     → COLOR → OUTPUT
 *   LINEAR_GRADIENT → UV + COLOR(colorA) + COLOR(colorB) + BLEND → OUTPUT
 *   NOISE           → UV + NOISE + COLOR + OUTPUT
 *   CIRCLE_SHAPE    → UV + COLOR(fill) → OUTPUT
 *   IMAGE_TEXTURE   → UV + TEXTURE → OUTPUT
 *
 * 多 Layer 合成:
 *   Layer[0] → Graph[0]
 *   Layer[1] → Graph[1]
 *   合并:Graph[0] + Graph[1] → BLEND(a=Graph[0], b=Graph[1], t=0.5) → OUTPUT
 *   (链式合成,最后一个 Layer 在最上层)
 *
 * 与 materialGraphGenerator.ts 的区别:
 * - materialGraphGenerator: CreativeRequirement → MaterialGraph(从需求生成)
 * - renderIRToMaterial:     RenderIR → MaterialGraph(从已有 IR 转换)
 *
 * 使用场景:
 * - 用户在 Graph Editor 中编辑了 RenderGraph → 编译为 RenderIR → 转为 MaterialGraph
 * - LLM 生成 RenderIR → 用户想看对应的 MaterialGraph 版本
 * - 从 RenderIR 路径切换到 MaterialGraph 路径
 */

import { Opcode, type JsonLiteral } from '@/shared/types'
import type { Layer, RenderIR } from '@/compiler/ir/renderIR'
import type { MaterialEdge, MaterialGraph, MaterialNode } from './types'
import { DEFAULT_MATERIAL_CANVAS } from './types'
import { createNodeFromTemplate } from './shaderRegistry'

// ============================================================================
// 1. 工具函数
// ============================================================================

let bridgeCounter = 0

function genId(prefix: string): string {
  bridgeCounter++
  return `bridge_${prefix}_${bridgeCounter.toString(36)}`
}

function makeEdgeId(from: string, fromPort: string, to: string, toPort: string): string {
  return `${from}:${fromPort}->${to}:${toPort}`
}

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

function connect(from: string, fromPort: string, to: string, toPort: string): MaterialEdge {
  return {
    id: makeEdgeId(from, fromPort, to, toPort),
    from,
    fromPort,
    to,
    toPort,
  }
}

/**
 * 从 params 中提取 RGBA 数组。
 * 支持字段名:color / fill / colorA / colorB
 */
function extractRGBA(
  params: Record<string, JsonLiteral>,
  ...keys: string[]
): [number, number, number, number] | null {
  for (const key of keys) {
    const val = params[key]
    if (Array.isArray(val) && val.length >= 3) {
      return [
        Number(val[0]) || 0,
        Number(val[1]) || 0,
        Number(val[2]) || 0,
        val.length >= 4 ? Number(val[3]) ?? 1 : 1,
      ]
    }
  }
  return null
}

// ============================================================================
// 2. 单 Layer → 节点子图
// ============================================================================

/**
 * 单 Layer 转换结果。
 * - nodes: 该 Layer 对应的节点列表(不含 OUTPUT)
 * - edges: 内部连接
 * - outputNodeId: 该子图的输出节点 id(连接到下游 BLEND 或 OUTPUT)
 * - outputPortId: 输出端口 id
 */
interface LayerConversion {
  nodes: MaterialNode[]
  edges: MaterialEdge[]
  outputNodeId: string
  outputPortId: string
}

/**
 * 把单个 RenderIR Layer 转换为 MaterialGraph 子图。
 *
 * @param layer RenderIR Layer
 * @param offsetX 画布 X 偏移(用于多 Layer 布局)
 * @param offsetY 画布 Y 偏移
 * @returns 转换结果(节点 + 边 + 输出引用)
 */
function convertLayerToSubGraph(
  layer: Layer,
  offsetX: number,
  offsetY: number,
): LayerConversion {
  const nodes: MaterialNode[] = []
  const edges: MaterialEdge[] = []

  switch (layer.opcode) {
    case Opcode.SOLID_COLOR: {
      // COLOR → (OUTPUT 或 BLEND)
      const rgba = extractRGBA(layer.params, 'color') ?? [0.5, 0.5, 0.5, 1]
      const colorId = genId('color')
      const colorNode = makeNode('color', colorId, { x: offsetX, y: offsetY }, {
        r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3],
      })
      if (colorNode) {
        nodes.push(colorNode)
        return { nodes, edges, outputNodeId: colorId, outputPortId: 'color' }
      }
      break
    }

    case Opcode.LINEAR_GRADIENT: {
      // UV + COLOR(colorA) + COLOR(colorB) + BLEND → (OUTPUT 或 BLEND)
      const uvId = genId('uv')
      const colorAId = genId('colorA')
      const colorBId = genId('colorB')
      const blendId = genId('blend')

      const uv = makeNode('uv', uvId, { x: offsetX, y: offsetY })
      const rgbaA = extractRGBA(layer.params, 'colorA', 'color') ?? [0, 0, 0.5, 1]
      const rgbaB = extractRGBA(layer.params, 'colorB') ?? [0.5, 0.5, 1, 1]
      const colorA = makeNode('color', colorAId, { x: offsetX + 260, y: offsetY - 80 }, {
        r: rgbaA[0], g: rgbaA[1], b: rgbaA[2], a: rgbaA[3],
      })
      const colorB = makeNode('color', colorBId, { x: offsetX + 260, y: offsetY + 80 }, {
        r: rgbaB[0], g: rgbaB[1], b: rgbaB[2], a: rgbaB[3],
      })
      const blend = makeNode('blend', blendId, { x: offsetX + 520, y: offsetY })

      if (uv && colorA && colorB && blend) {
        nodes.push(uv, colorA, colorB, blend)
        // UV → blend.t(用 UV 的某个分量作为混合系数,简化处理)
        edges.push(
          connect(uvId, 'uv', blendId, 't'),
          connect(colorAId, 'color', blendId, 'a'),
          connect(colorBId, 'color', blendId, 'b'),
        )
        return { nodes, edges, outputNodeId: blendId, outputPortId: 'result' }
      }
      break
    }

    case Opcode.NOISE: {
      // UV + NOISE + COLOR → (OUTPUT 或 BLEND)
      const uvId = genId('uv')
      const noiseId = genId('noise')
      const colorId = genId('color')

      const scale = Number(layer.params.scale ?? 16)
      const uv = makeNode('uv', uvId, { x: offsetX, y: offsetY })
      const noise = makeNode('noise', noiseId, { x: offsetX + 260, y: offsetY }, { scale })
      const rgba = extractRGBA(layer.params, 'colorB', 'colorA', 'color') ?? [1, 1, 1, 1]
      const color = makeNode('color', colorId, { x: offsetX + 520, y: offsetY }, {
        r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3],
      })

      if (uv && noise && color) {
        nodes.push(uv, noise, color)
        edges.push(connect(uvId, 'uv', noiseId, 'uv'))
        // 注意:Noise 输出 float,Color 输出 vec4,这里不直接连接
        // COLOR 节点作为输出源(简化:噪声仅作为视觉参考,实际颜色由 COLOR 提供)
        return { nodes, edges, outputNodeId: colorId, outputPortId: 'color' }
      }
      break
    }

    case Opcode.CIRCLE_SHAPE: {
      // UV + COLOR(fill) → (OUTPUT 或 BLEND)
      const uvId = genId('uv')
      const colorId = genId('color')
      const uv = makeNode('uv', uvId, { x: offsetX, y: offsetY })
      const rgba = extractRGBA(layer.params, 'fill', 'color') ?? [1, 1, 0, 1]
      const color = makeNode('color', colorId, { x: offsetX + 260, y: offsetY }, {
        r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3],
      })

      if (uv && color) {
        nodes.push(uv, color)
        return { nodes, edges, outputNodeId: colorId, outputPortId: 'color' }
      }
      break
    }

    case Opcode.IMAGE_TEXTURE: {
      // UV + TEXTURE → (OUTPUT 或 BLEND)
      const uvId = genId('uv')
      const texId = genId('tex')
      const uv = makeNode('uv', uvId, { x: offsetX, y: offsetY })
      const tex = makeNode('texture', texId, { x: offsetX + 260, y: offsetY })

      if (uv && tex) {
        nodes.push(uv, tex)
        edges.push(connect(uvId, 'uv', texId, 'uv'))
        return { nodes, edges, outputNodeId: texId, outputPortId: 'color' }
      }
      break
    }

    default: {
      // 未知 opcode:回退到纯色
      const colorId = genId('color_fallback')
      const color = makeNode('color', colorId, { x: offsetX, y: offsetY }, {
        r: 0.5, g: 0.5, b: 0.5, a: 1,
      })
      if (color) {
        nodes.push(color)
        return { nodes, edges, outputNodeId: colorId, outputPortId: 'color' }
      }
      break
    }
  }

  // 最终回退
  const fallbackId = genId('fallback')
  const fallback = makeNode('color', fallbackId, { x: offsetX, y: offsetY })
  if (fallback) {
    nodes.push(fallback)
    return { nodes, edges, outputNodeId: fallbackId, outputPortId: 'color' }
  }

  // 理论上不会走到这里
  return { nodes, edges, outputNodeId: '', outputPortId: '' }
}

// ============================================================================
// 3. 多 Layer 合成
// ============================================================================

/**
 * 把多个 Layer 转换结果合成为单个 MaterialGraph。
 *
 * 策略:
 * - 1 个 Layer:直接 → OUTPUT
 * - 2+ 个 Layer:链式 BLEND 合成
 *   Layer[0] ──┐
 *              BLEND[0] ──┐
 *   Layer[1] ──┘          BLEND[1] ──→ OUTPUT
 *              Layer[2] ──┘
 *   (每个 BLEND 的 t=0.5,表示 50/50 混合)
 */
function mergeSubGraphs(
  subGraphs: LayerConversion[],
  canvasWidth: number,
  canvasHeight: number,
): MaterialGraph {
  const allNodes: MaterialNode[] = []
  const allEdges: MaterialEdge[] = []

  // 收集所有节点和边
  for (const sg of subGraphs) {
    allNodes.push(...sg.nodes)
    allEdges.push(...sg.edges)
  }

  if (subGraphs.length === 0) {
    // 空图:创建默认 COLOR → OUTPUT
    const colorId = genId('default_color')
    const outputId = genId('output')
    const color = makeNode('color', colorId, { x: 200, y: 200 })
    const output = makeNode('output', outputId, { x: 460, y: 200 })
    if (color && output) {
      allNodes.push(color, output)
      allEdges.push(connect(colorId, 'color', outputId, 'color'))
    }
    return { nodes: allNodes, edges: allEdges, canvas: { width: canvasWidth, height: canvasHeight } }
  }

  if (subGraphs.length === 1) {
    // 单 Layer:直接 → OUTPUT
    const sg = subGraphs[0]
    const outputId = genId('output')
    const outputX = Math.max(...sg.nodes.map((n) => n.position.x)) + 260
    const outputY = sg.nodes[0]?.position.y ?? 200
    const output = makeNode('output', outputId, { x: outputX, y: outputY })
    if (output) {
      allNodes.push(output)
      allEdges.push(connect(sg.outputNodeId, sg.outputPortId, outputId, 'color'))
    }
    return { nodes: allNodes, edges: allEdges, canvas: { width: canvasWidth, height: canvasHeight } }
  }

  // 多 Layer:链式 BLEND
  let prevOutputNode = subGraphs[0].outputNodeId
  let prevOutputPort = subGraphs[0].outputPortId

  for (let i = 1; i < subGraphs.length; i++) {
    const sg = subGraphs[i]
    const blendId = genId(`blend_${i}`)
    const blendX = Math.max(
      ...allNodes.filter((n) => n.id === prevOutputNode || n.id === sg.outputNodeId).map((n) => n.position.x),
    ) + 260
    const blendY = 200 + i * 60
    const blend = makeNode('blend', blendId, { x: blendX, y: blendY })

    if (blend) {
      allNodes.push(blend)
      // prevOutput → blend.a
      allEdges.push(connect(prevOutputNode, prevOutputPort, blendId, 'a'))
      // current layer → blend.b
      allEdges.push(connect(sg.outputNodeId, sg.outputPortId, blendId, 'b'))
      // 混合系数 t 默认 0.5(不连接,使用默认值)
      prevOutputNode = blendId
      prevOutputPort = 'result'
    }
  }

  // 最终 → OUTPUT
  const outputId = genId('output')
  const outputX = Math.max(...allNodes.map((n) => n.position.x)) + 260
  const output = makeNode('output', outputId, { x: outputX, y: 200 })
  if (output) {
    allNodes.push(output)
    allEdges.push(connect(prevOutputNode, prevOutputPort, outputId, 'color'))
  }

  return { nodes: allNodes, edges: allEdges, canvas: { width: canvasWidth, height: canvasHeight } }
}

// ============================================================================
// 4. 主转换函数
// ============================================================================

/**
 * 转换结果。
 */
export interface RenderIRToMaterialResult {
  /** 生成的 MaterialGraph */
  graph: MaterialGraph
  /** 转换的 Layer 数量 */
  layerCount: number
  /** 跳过的 Layer 数(不可见或未知 opcode) */
  skippedCount: number
  /** 是否使用了 BLEND 合成 */
  hasBlend: boolean
  /** 摘要 */
  summary: string
}

/**
 * 把 RenderIR 转换为 MaterialGraph。
 *
 * @param ir RenderIR(必须含 layers)
 * @returns 转换结果
 */
export function renderIRToMaterialGraph(ir: RenderIR): RenderIRToMaterialResult {
  // 过滤可见 Layer
  const visibleLayers = ir.layers.filter((l) => l.visible)
  const skippedCount = ir.layers.length - visibleLayers.length

  // 转换每个 Layer 为子图
  const subGraphs: LayerConversion[] = []
  for (let i = 0; i < visibleLayers.length; i++) {
    const layer = visibleLayers[i]
    const offsetY = 100 + i * 200
    const sg = convertLayerToSubGraph(layer, 80, offsetY)
    if (sg.nodes.length > 0) {
      subGraphs.push(sg)
    }
  }

  // 合成
  const graph = mergeSubGraphs(
    subGraphs,
    ir.canvas.width ?? DEFAULT_MATERIAL_CANVAS.width,
    ir.canvas.height ?? DEFAULT_MATERIAL_CANVAS.height,
  )

  const hasBlend = graph.nodes.some((n) => n.templateKey === 'blend')
  const summary = `${visibleLayers.length} 图层 → ${graph.nodes.length} 节点 ${graph.edges.length} 边${hasBlend ? '(含混合)' : ''}`

  return {
    graph,
    layerCount: visibleLayers.length,
    skippedCount,
    hasBlend,
    summary,
  }
}

/**
 * 把单个 RenderIR Layer 转换为 MaterialGraph(简化接口)。
 *
 * 适用于只需要转换单个 Layer 的场景。
 */
export function layerToMaterialGraph(layer: Layer): MaterialGraph {
  const sg = convertLayerToSubGraph(layer, 80, 200)
  return mergeSubGraphs([sg], DEFAULT_MATERIAL_CANVAS.width, DEFAULT_MATERIAL_CANVAS.height)
}
