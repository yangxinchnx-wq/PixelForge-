/**
 * PixelForge - WDL ↔ Graph 双向同步(Step 38.4)
 *
 * 职责:
 * - wdlToGraph: WDL AST(SceneNode)→ RenderGraph(DAG)
 * - graphToWdl: RenderGraph → WDL 源码字符串
 * - 双向同步:让 WDL 文本编辑器和节点图编辑器互转,改一边另一边可重建
 *
 * 映射规则:
 *   WDL scene          → RenderGraph.canvas
 *   WDL layer "name"   → GraphNode(type=REGION, opcodeName=layer.opcode)
 *   WDL effect "name"  → GraphNode(type=EFFECT, opcodeName=effect.type)
 *   WDL region "name"  → edges(layer → region 的 layerRefs 顺序连接)
 *   WDL 无对应         → GraphNode(type=OUTPUT)自动追加
 *
 * 局限性(表达力差异):
 *   - WDL 无 COMPOSITE 节点概念,Graph 的 COMPOSITE 节点在转 WDL 时被忽略
 *   - WDL 的 region.bounds 在 Graph 中无直接对应(Region 布局信息丢失)
 *   - Graph 的 edge 端口信息在 WDL 中不体现(WDL 只用 layer 顺序)
 */
import type { SceneNode } from './wdlParser'
import type { RenderGraph, GraphNode, GraphEdge, NodeType, Port } from '@/graph/types'
import { parse } from './wdlParser'
import type { JsonLiteral } from '@/shared/types'

// ============================================================================
// 1. 常量
// ============================================================================

/** 标准 OUTPUT 节点 ID */
const OUTPUT_NODE_ID = 'output_0'

/** 标准 OUTPUT 节点端口 */
const OUTPUT_INPUT_PORT: Port = { id: 'input', name: 'input', type: 'texture' }

/** 标准节点输出端口 */
const TEXTURE_OUTPUT_PORT: Port = { id: 'output', name: 'texture', type: 'texture' }

/** 标准节点输入端口 */
const TEXTURE_INPUT_PORT: Port = { id: 'input', name: 'input', type: 'texture' }

/** 节点间距(用于自动布局) */
const NODE_SPACING_X = 250

// ============================================================================
// 2. WDL → Graph
// ============================================================================

/**
 * 将 WDL AST 转换为 RenderGraph。
 *
 * @param ast WDL AST(SceneNode)
 * @returns RenderGraph(含 nodes + edges + canvas)
 */
export function wdlToGraph(ast: SceneNode): RenderGraph {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // canvas
  const canvas = ast.canvas ?? { width: 1920, height: 1080 }

  // —— layer → REGION 节点 ——
  const layerIdToNodeId = new Map<string, string>()
  ast.layers.forEach((layerNode, index) => {
    const nodeId = `layer_${index}_${layerNode.name}`
    layerIdToNodeId.set(layerNode.name, nodeId)

    // 提取 opcode(必须有)
    const opcodeParam = layerNode.params.find((p) => p.key === 'opcode')
    const opcodeName = opcodeParam?.value.kind === 'ident' || opcodeParam?.value.kind === 'string'
      ? opcodeParam.value.value
      : 'SOLID_COLOR'

    // 提取 params(排除 opcode/blendMode/visible)
    const params: Record<string, JsonLiteral> = {}
    for (const p of layerNode.params) {
      if (p.key === 'opcode' || p.key === 'blendMode' || p.key === 'visible') continue
      params[p.key] = valueNodeToJsonLiteral(p.value)
    }

    nodes.push({
      id: nodeId,
      type: 'REGION' as NodeType,
      name: layerNode.name,
      position: { x: 100 + index * NODE_SPACING_X, y: 200 },
      inputs: [TEXTURE_INPUT_PORT],
      outputs: [TEXTURE_OUTPUT_PORT],
      params,
      opcodeName,
    })
  })

  // —— effect → EFFECT 节点 ——
  const effectIdToNodeId = new Map<string, string>()
  ast.effects.forEach((effectNode, index) => {
    const nodeId = `effect_${index}_${effectNode.name}`
    effectIdToNodeId.set(effectNode.name, nodeId)

    // 提取 type(必须有)
    const typeParam = effectNode.params.find((p) => p.key === 'type')
    const effectType = typeParam?.value.kind === 'ident' || typeParam?.value.kind === 'string'
      ? typeParam.value.value
      : 'blur'

    // 提取 params(排除 type/target/targetRegion)
    const params: Record<string, JsonLiteral> = {}
    for (const p of effectNode.params) {
      if (p.key === 'type' || p.key === 'target' || p.key === 'targetRegion') continue
      params[p.key] = valueNodeToJsonLiteral(p.value)
    }

    nodes.push({
      id: nodeId,
      type: 'EFFECT' as NodeType,
      name: effectNode.name,
      position: { x: 100 + (ast.layers.length + index) * NODE_SPACING_X, y: 200 },
      inputs: [TEXTURE_INPUT_PORT],
      outputs: [TEXTURE_OUTPUT_PORT],
      params,
      opcodeName: effectType,
    })

    // 如果 effect 有 target,创建 edge: targetLayer → effect
    const targetParam = effectNode.params.find((p) => p.key === 'target')
    if (targetParam) {
      const targetLayerName = targetParam.value.kind === 'string' || targetParam.value.kind === 'ident'
        ? targetParam.value.value
        : null
      if (targetLayerName) {
        const fromNodeId = layerIdToNodeId.get(targetLayerName)
        if (fromNodeId) {
          edges.push(makeEdge(fromNodeId, 'output', nodeId, 'input'))
        }
      }
    }
  })

  // —— region → edges(layerRefs 顺序连接)——
  for (const regionNode of ast.regions) {
    const layersParam = regionNode.params.find((p) => p.key === 'layers')
    if (!layersParam || layersParam.value.kind !== 'array') continue

    const layerNames: string[] = []
    for (const elem of layersParam.value.elements) {
      if (elem.kind === 'string' || elem.kind === 'ident') {
        layerNames.push(elem.value)
      }
    }

    // 链式连接:layer[0] → layer[1] → ... → layer[n-1]
    for (let i = 0; i < layerNames.length - 1; i++) {
      const fromId = layerIdToNodeId.get(layerNames[i])
      const toId = layerIdToNodeId.get(layerNames[i + 1])
      if (fromId && toId) {
        edges.push(makeEdge(fromId, 'output', toId, 'input'))
      }
    }
  }

  // —— 追加 OUTPUT 节点 ——
  nodes.push({
    id: OUTPUT_NODE_ID,
    type: 'OUTPUT' as NodeType,
    name: '输出',
    position: { x: 100 + nodes.length * NODE_SPACING_X, y: 200 },
    inputs: [OUTPUT_INPUT_PORT],
    outputs: [],
    params: {},
  })

  // 最后一个 layer → OUTPUT
  if (ast.layers.length > 0) {
    const lastLayer = ast.layers[ast.layers.length - 1]
    const lastNodeId = layerIdToNodeId.get(lastLayer.name)
    if (lastNodeId) {
      edges.push(makeEdge(lastNodeId, 'output', OUTPUT_NODE_ID, 'input'))
    }
  }

  return { nodes, edges, canvas }
}

/**
 * 将 WDL 源码一站式转换为 RenderGraph。
 *
 * 内部:Lexer → Parser → wdlToGraph
 */
export function wdlSourceToGraph(source: string): RenderGraph {
  const ast = parse(source)
  return wdlToGraph(ast)
}

// ============================================================================
// 3. Graph → WDL
// ============================================================================

/**
 * 将 RenderGraph 转换为 WDL 源码字符串。
 *
 * @param graph RenderGraph
 * @returns WDL 源码
 */
export function graphToWdl(graph: RenderGraph): string {
  const lines: string[] = []
  const canvas = graph.canvas ?? { width: 1920, height: 1080 }

  // 场景名(从 canvas 推导)
  lines.push(`scene "graph_scene" {`)
  lines.push(`  canvas: ${canvas.width}x${canvas.height}`)
  lines.push('')

  // 按拓扑序处理 REGION 节点(layer)
  const regionNodes = graph.nodes.filter((n) => n.type === 'REGION')
  const effectNodes = graph.nodes.filter((n) => n.type === 'EFFECT')

  // 构建 edge 查找:from → [to]
  const edgeMap = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const targets = edgeMap.get(edge.from) ?? []
    targets.push(edge.to)
    edgeMap.set(edge.from, targets)
  }

  // 构建反向 edge 查找:to → [from]
  const reverseEdgeMap = new Map<string, string[]>()
  for (const edge of graph.edges) {
    const sources = reverseEdgeMap.get(edge.to) ?? []
    sources.push(edge.from)
    reverseEdgeMap.set(edge.to, sources)
  }

  // nodeId → layer name 映射(用于 effect target 引用)
  const nodeIdToName = new Map<string, string>()
  for (const node of [...regionNodes, ...effectNodes]) {
    nodeIdToName.set(node.id, node.name)
  }

  // —— layer 块 ——
  for (const node of regionNodes) {
    lines.push(`  layer "${node.name}" {`)
    lines.push(`    opcode: ${node.opcodeName ?? 'SOLID_COLOR'}`)
    for (const [key, value] of Object.entries(node.params)) {
      lines.push(`    ${key}: ${jsonLiteralToWdl(value)}`)
    }
    lines.push(`  }`)
    lines.push('')
  }

  // —— effect 块 ——
  for (const node of effectNodes) {
    lines.push(`  effect "${node.name}" {`)
    lines.push(`    type: ${node.opcodeName ?? 'blur'}`)

    // 查找 target(edge: targetLayer → effect)
    const sources = reverseEdgeMap.get(node.id) ?? []
    if (sources.length > 0) {
      const targetName = nodeIdToName.get(sources[0])
      if (targetName) {
        lines.push(`    target: "${targetName}"`)
      }
    }

    for (const [key, value] of Object.entries(node.params)) {
      lines.push(`    ${key}: ${jsonLiteralToWdl(value)}`)
    }
    lines.push(`  }`)
    lines.push('')
  }

  // —— region 块(从 edges 推导 layerRefs)——
  if (regionNodes.length > 0) {
    lines.push(`  region "main" {`)
    lines.push(`    bounds: [0, 0, 1, 1]`)

    // 收集所有 layer name(按节点顺序)
    const layerNames = regionNodes.map((n) => n.name)
    const layersArray = layerNames.map((n) => `"${n}"`).join(', ')
    lines.push(`    layers: [${layersArray}]`)

    lines.push(`  }`)
  }

  lines.push('}')

  return lines.join('\n')
}

// ============================================================================
// 4. 辅助函数
// ============================================================================

/** 生成 edge ID */
function makeEdge(from: string, fromPort: string, to: string, toPort: string): GraphEdge {
  return {
    id: `${from}:${fromPort}->${to}:${toPort}`,
    from,
    fromPort,
    to,
    toPort,
  }
}

/** ValueNode → JsonLiteral(复用 wdlCompiler 的逻辑) */
function valueNodeToJsonLiteral(value: import('./wdlParser').ValueNode): JsonLiteral {
  switch (value.kind) {
    case 'number': return value.value
    case 'string': return value.value
    case 'boolean': return value.value
    case 'ident': return value.value
    case 'array': return value.elements.map(valueNodeToJsonLiteral)
    default: return null
  }
}

/** JsonLiteral → WDL 源码字符串 */
function jsonLiteralToWdl(value: JsonLiteral): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return `[${value.map(jsonLiteralToWdl).join(', ')}]`
  }
  return 'null'
}
