/**
 * Material Prompt(Step 28.23)— LLM 生成 MaterialGraph 的 Prompt + Schema。
 *
 * 职责:
 * - 构造发送给 LLM 的 system prompt,描述可用节点和连接规则
 * - 定义 LLM 输出的 JSON Schema
 * - 解析 LLM 输出为 MaterialGraph
 *
 * 与 authoring/prompt/llmParser.ts 的区别:
 * - llmParser.ts: LLM → RenderIR Layer[](高层 opcode 级别)
 * - materialPrompt.ts: LLM → MaterialGraph(底层节点级别)
 *
 * LLM 输出格式:
 * {
 *   "preset": "starfield",          // 推荐预设(可选)
 *   "nodes": [
 *     { "type": "uv", "id": "n1" },
 *     { "type": "noise", "id": "n2", "params": { "scale": 32 } },
 *     { "type": "color", "id": "n3", "params": { "r": 1, "g": 1, "b": 1, "a": 1 } },
 *     { "type": "output", "id": "n4" }
 *   ],
 *   "edges": [
 *     { "from": "n1", "fromPort": "uv", "to": "n2", "toPort": "uv" },
 *     { "from": "n3", "fromPort": "color", "to": "n4", "toPort": "color" }
 *   ]
 * }
 */

import type { JsonLiteral } from '@/shared/types'
import type { MaterialEdge, MaterialGraph, MaterialNode } from './types'
import { DEFAULT_MATERIAL_CANVAS } from './types'
import { createNodeFromTemplate, listShaderNodeKeys, listShaderNodeKeysByCategory } from './shaderRegistry'
import { buildPreset, type MaterialPresetKey } from './materialPresets'

// ============================================================================
// 1. 节点描述(用于 system prompt)
// ============================================================================

/**
 * 节点描述表(用于生成 system prompt)。
 *
 * 与 shaderRegistry.ts 中的注册表对齐,但只暴露 LLM 需要的信息。
 */
interface NodeDescription {
  type: string
  label: string
  category: string
  inputs: { id: string; name: string; type: string }[]
  outputs: { id: string; name: string; type: string }[]
  params: { name: string; type: string; default: string }[]
  description: string
}

/**
 * 从 shaderRegistry 生成节点描述列表。
 */
function buildNodeDescriptions(): NodeDescription[] {
  const byCategory = listShaderNodeKeysByCategory()
  const descriptions: NodeDescription[] = []

  for (const [category, keys] of Object.entries(byCategory)) {
    for (const key of keys) {
      // 使用 createNodeFromTemplate 获取端口信息
      const node = createNodeFromTemplate(key, 'tmp', { x: 0, y: 0 })
      if (!node) continue

      descriptions.push({
        type: key,
        label: node.name,
        category,
        inputs: node.inputs.map((p) => ({ id: p.id, name: p.name, type: p.type })),
        outputs: node.outputs.map((p) => ({ id: p.id, name: p.name, type: p.type })),
        params: Object.entries(node.params).map(([name, val]) => ({
          name,
          type: typeof val === 'number' ? 'number' : Array.isArray(val) ? 'array' : 'string',
          default: JSON.stringify(val),
        })),
        description: `${node.name}(${category})`,
      })
    }
  }

  return descriptions
}

// ============================================================================
// 2. System Prompt 构建
// ============================================================================

/**
 * 构造 MaterialGraph 生成用的 system prompt。
 */
export function buildMaterialSystemPrompt(): string {
  const descriptions = buildNodeDescriptions()
  const nodeLines = descriptions.map((d) => {
    const inputs = d.inputs.length > 0
      ? d.inputs.map((i) => `${i.id}:${i.type}`).join(', ')
      : '(无)'
    const outputs = d.outputs.length > 0
      ? d.outputs.map((o) => `${o.id}:${o.type}`).join(', ')
      : '(无)'
    const params = d.params.length > 0
      ? d.params.map((p) => `${p.name}=${p.default}`).join(', ')
      : '(无)'
    return `  - "${d.type}": ${d.label} | 输入: ${inputs} | 输出: ${outputs} | 参数: ${params}`
  }).join('\n')

  const presetList = [
    'starfield(星空)', 'nebula(星云)', 'gradient_bg(渐变背景)',
    'cellular(细胞纹理)', 'blend_effect(混合效果)', 'cinematic(电影调色)',
    'galaxy(银河)', 'dust(星尘)',
  ].join(' / ')

  return `You are a Material Graph generator for PixelForge, a WebGPU visual engine.

Your task: Given a natural language description of a visual effect, output a JSON object describing a MaterialGraph (node graph for pixel-level shader computation).

Output format (strict JSON):
{
  "preset": "<optional: recommend a preset key>",
  "nodes": [
    {
      "type": "<node type>",
      "id": "<unique node id, e.g. 'n1'>",
      "params": { <optional parameters> }
    }
  ],
  "edges": [
    {
      "from": "<source node id>",
      "fromPort": "<source output port id>",
      "to": "<target node id>",
      "toPort": "<target input port id>"
    }
  ]
}

Available node types:
${nodeLines}

Available presets (you can recommend one instead of building from scratch):
${presetList}

Rules:
1. The graph MUST have exactly one "output" node.
2. The graph MUST be a DAG (no cycles).
3. Each input port can only be connected to one edge.
4. Port types must be compatible: float→float, vec2→vec2, vec3→vec3/vec4, vec4→vec4/vec3, texture→texture.
5. If a preset fits the description, set "preset" and leave "nodes"/"edges" empty.
6. If building custom nodes, include all necessary nodes (uv, noise, color, etc.).
7. Colors are RGBA floats 0-1 (e.g. { "r": 0.2, "g": 0.3, "b": 1.0, "a": 1.0 }).
8. Keep node count between 2 and 20.
9. Output ONLY the JSON object, no markdown, no explanation.`
}

// ============================================================================
// 3. LLM 输出 Schema
// ============================================================================

/**
 * LLM 输出的 JSON Schema(用于 validateLLMOutput 校验)。
 */
export const MATERIAL_LLM_SCHEMA = {
  type: 'object',
  required: ['nodes', 'edges'],
  properties: {
    preset: {
      type: 'string',
      description: '推荐的预设 key(可选)',
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'id'],
        properties: {
          type: { type: 'string', description: '节点类型(如 uv / noise / color / output)' },
          id: { type: 'string', description: '节点唯一 ID' },
          params: {
            type: 'object',
            description: '节点参数(可选)',
            additionalProperties: true,
          },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'fromPort', 'to', 'toPort'],
        properties: {
          from: { type: 'string', description: '源节点 ID' },
          fromPort: { type: 'string', description: '源节点输出端口 ID' },
          to: { type: 'string', description: '目标节点 ID' },
          toPort: { type: 'string', description: '目标节点输入端口 ID' },
        },
      },
    },
  },
} as const

// ============================================================================
// 4. LLM 输出类型
// ============================================================================

export interface LLMNodeOutput {
  type: string
  id: string
  params?: Record<string, unknown>
}

export interface LLMEdgeOutput {
  from: string
  fromPort: string
  to: string
  toPort: string
}

export interface LLMMaterialOutput {
  preset?: string
  nodes: LLMNodeOutput[]
  edges: LLMEdgeOutput[]
}

// ============================================================================
// 5. LLM 输出 → MaterialGraph 解析
// ============================================================================

/**
 * 解析结果。
 */
export interface ParseMaterialResult {
  graph: MaterialGraph
  usedPreset: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 把 LLM 输出解析为 MaterialGraph。
 *
 * 两种路径:
 * 1. 如果 output.preset 存在且 nodes 为空 → 使用预设构建
 * 2. 如果 output.nodes 非空 → 逐个创建节点 + 连接边
 *
 * @param output LLM 输出(已 JSON.parse)
 * @returns 解析结果(含 graph + 错误/警告信息)
 */
export function parseLLMMaterialOutput(output: LLMMaterialOutput): ParseMaterialResult {
  const errors: string[] = []
  const warnings: string[] = []

  // —— 路径 1:使用预设(仅当没有自定义节点时) ——
  if (output.preset && (!output.nodes || output.nodes.length === 0)) {
    try {
      const graph = buildPreset(output.preset as MaterialPresetKey)
      return {
        graph,
        usedPreset: true,
        errors: [],
        warnings: [`使用预设: ${output.preset}`],
      }
    } catch {
      errors.push(`预设 "${output.preset}" 不存在,回退到节点构建`)
    }
  } else if (output.preset && output.nodes && output.nodes.length > 0) {
    // 有预设又有节点:验证预设是否存在(仅警告,不阻断)
    try {
      buildPreset(output.preset as MaterialPresetKey)
      // 预设存在但用户提供了自定义节点,使用节点构建
      warnings.push(`忽略了预设 "${output.preset}",使用自定义节点`)
    } catch {
      errors.push(`预设 "${output.preset}" 不存在,使用节点构建`)
    }
  }

  // —— 路径 2:节点构建 ——
  const nodes: MaterialNode[] = []
  const edges: MaterialEdge[] = []
  const nodeIds = new Set<string>()

  // 创建节点
  for (const llmNode of output.nodes ?? []) {
    if (nodeIds.has(llmNode.id)) {
      warnings.push(`节点 ID "${llmNode.id}" 重复,跳过`)
      continue
    }

    const validKeys = listShaderNodeKeys()
    if (!validKeys.includes(llmNode.type)) {
      errors.push(`节点类型 "${llmNode.type}" 不存在(可用: ${validKeys.join(', ')})`)
      continue
    }

    // 使用 createNodeFromTemplate 创建节点
    const position = { x: 80 + (nodes.length % 4) * 260, y: 80 + Math.floor(nodes.length / 4) * 200 }
    const node = createNodeFromTemplate(llmNode.type, llmNode.id, position)
    if (!node) {
      errors.push(`节点 "${llmNode.id}"(${llmNode.type}) 创建失败`)
      continue
    }

    // 合并参数
    if (llmNode.params) {
      for (const [key, val] of Object.entries(llmNode.params)) {
        node.params[key] = val as JsonLiteral
      }
    }

    nodes.push(node)
    nodeIds.add(llmNode.id)
  }

  // 检查 OUTPUT 节点
  const outputCount = nodes.filter((n) => n.type === 'OUTPUT').length
  if (outputCount === 0) {
    errors.push('缺少 OUTPUT 节点')
  } else if (outputCount > 1) {
    warnings.push(`有 ${outputCount} 个 OUTPUT 节点(应仅 1 个),保留第一个`)
    // 移除多余的 OUTPUT
    let foundFirst = false
    const filtered: MaterialNode[] = []
    for (const n of nodes) {
      if (n.type === 'OUTPUT') {
        if (foundFirst) continue
        foundFirst = true
      }
      filtered.push(n)
    }
    nodes.length = 0
    nodes.push(...filtered)
  }

  // 创建边
  for (const llmEdge of output.edges ?? []) {
    if (!nodeIds.has(llmEdge.from)) {
      warnings.push(`边引用不存在的源节点: ${llmEdge.from}`)
      continue
    }
    if (!nodeIds.has(llmEdge.to)) {
      warnings.push(`边引用不存在的目标节点: ${llmEdge.to}`)
      continue
    }

    const edgeId = `${llmEdge.from}:${llmEdge.fromPort}->${llmEdge.to}:${llmEdge.toPort}`
    edges.push({
      id: edgeId,
      from: llmEdge.from,
      fromPort: llmEdge.fromPort,
      to: llmEdge.to,
      toPort: llmEdge.toPort,
    })
  }

  const graph: MaterialGraph = {
    nodes,
    edges,
    canvas: { ...DEFAULT_MATERIAL_CANVAS },
  }

  return {
    graph,
    usedPreset: false,
    errors,
    warnings,
  }
}

// ============================================================================
// 6. 完整 prompt 构建(含用户输入)
// ============================================================================

/**
 * 构造完整的 LLM 请求 prompt(system + user)。
 *
 * @param userInput 用户自然语言输入
 * @returns { systemPrompt, userPrompt }
 */
export function buildMaterialLLMPrompt(
  userInput: string,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: buildMaterialSystemPrompt(),
    userPrompt: `生成一个 MaterialGraph,描述以下效果: ${userInput}`,
  }
}
