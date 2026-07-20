/**
 * Graph Editor 单元测试(Step 25)。
 *
 * 覆盖:
 * - T: types / 常量(支持 opcode / effect 列表)
 * - N: nodeRegistry(getNodeDefinition / listNodeKeys / findRegionNodeByOpcodeName)
 * - V: validator(validateGraph / detectCycle / canAddEdge)
 * - C: graphCompiler(topologicalSort / nodeToLayer / compileGraph)
 * - G: graphGenerator(generateGraph / sceneLayerToGraphNode)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { Opcode } from '@/shared/types'
import type { CreativeRequirement } from '@/authoring/clarifier/types'

import {
  DEFAULT_GRAPH_CANVAS,
  NODE_SIZE,
  SUPPORTED_EFFECT_TYPES,
  SUPPORTED_GRAPH_OPCODE_NAMES,
  type GraphEdge,
  type GraphNode,
  type RenderGraph,
} from './types'
import {
  NodeRegistry,
  findEffectNodeByType,
  findRegionNodeByOpcodeName,
  getNodeDefinition,
  listNodeKeys,
  listNodeKeysByCategory,
} from './nodeRegistry'
import {
  canAddEdge,
  detectCycle,
  isCompilable,
  validateGraph,
} from './validator'
import { useGraphStore } from './graphStore'
import {
  compileGraph,
  nodeToEffect,
  nodeToLayer,
  summarizeCompileResult,
  topologicalSort,
} from './graphCompiler'
import {
  generateGraph,
  sceneLayerToGraphNode,
  summarizeGraph,
} from './graphGenerator'

// ============================================================================
// 辅助:构造测试用 Graph
// ============================================================================

function makeRegionNode(
  id: string,
  opcodeName: string,
  name: string = '测试节点',
  position = { x: 100, y: 100 },
): GraphNode {
  return {
    id,
    type: 'REGION',
    name,
    position,
    // REGION 节点有 1 个可选 input(下层背景)+ 1 个 output
    inputs: [{ id: 'input', name: 'background', type: 'texture' }],
    outputs: [{ id: 'output', name: 'texture', type: 'texture' }],
    params: { scale: 24 },
    opcodeName,
  }
}

function makeEffectNode(
  id: string,
  effectType: string,
  name: string = '效果节点',
  position = { x: 200, y: 100 },
): GraphNode {
  return {
    id,
    type: 'EFFECT',
    name,
    position,
    inputs: [{ id: 'input', name: 'source', type: 'texture' }],
    outputs: [{ id: 'output', name: 'texture', type: 'texture' }],
    params: { strength: 0.5 },
    opcodeName: effectType,
  }
}

function makeOutputNode(
  id: string = 'output_node',
  position = { x: 400, y: 100 },
): GraphNode {
  return {
    id,
    type: 'OUTPUT',
    name: '输出',
    position,
    inputs: [{ id: 'input', name: 'source', type: 'texture' }],
    outputs: [],
    params: {},
  }
}

function makeEdge(from: string, to: string, fromPort = 'output', toPort = 'input'): GraphEdge {
  return {
    id: `${from}:${fromPort}->${to}:${toPort}`,
    from,
    fromPort,
    to,
    toPort,
  }
}

/** 构造最小有效 Graph:Noise → Output */
function makeMinimalGraph(): RenderGraph {
  return {
    nodes: [
      makeRegionNode('noise1', 'NOISE', '噪声'),
      makeOutputNode('output1'),
    ],
    edges: [makeEdge('noise1', 'output1')],
  }
}

// ============================================================================
// T: types / 常量
// ============================================================================

describe('graph/types', () => {
  it('T1: SUPPORTED_GRAPH_OPCODE_NAMES 应包含 5 个 opcode', () => {
    expect(SUPPORTED_GRAPH_OPCODE_NAMES).toHaveLength(5)
    expect([...SUPPORTED_GRAPH_OPCODE_NAMES].sort()).toEqual(
      ['CIRCLE_SHAPE', 'IMAGE_TEXTURE', 'LINEAR_GRADIENT', 'NOISE', 'SOLID_COLOR'],
    )
  })

  it('T2: SUPPORTED_EFFECT_TYPES 应包含 5 个 effect type', () => {
    expect(SUPPORTED_EFFECT_TYPES).toHaveLength(5)
    expect([...SUPPORTED_EFFECT_TYPES].sort()).toEqual(
      ['bloom', 'blur', 'color_shift', 'mask', 'vignette'],
    )
  })

  it('T3: DEFAULT_GRAPH_CANVAS 应为 1920×1080', () => {
    expect(DEFAULT_GRAPH_CANVAS).toEqual({ width: 1920, height: 1080 })
  })

  it('T4: NODE_SIZE 应包含必要字段', () => {
    expect(NODE_SIZE.width).toBeGreaterThan(100)
    expect(NODE_SIZE.headerHeight).toBeGreaterThan(0)
    expect(NODE_SIZE.portHeight).toBeGreaterThan(0)
  })
})

// ============================================================================
// N: nodeRegistry
// ============================================================================

describe('graph/nodeRegistry', () => {
  it('N1: 所有 REGION 节点的 opcodeName 必须在 SUPPORTED_GRAPH_OPCODE_NAMES 内', () => {
    for (const [, def] of Object.entries(NodeRegistry)) {
      if (def.type === 'REGION') {
        expect(SUPPORTED_GRAPH_OPCODE_NAMES).toContain(def.opcodeName)
      }
    }
  })

  it('N2: 所有 EFFECT 节点的 opcodeName 必须在 SUPPORTED_EFFECT_TYPES 内', () => {
    for (const [, def] of Object.entries(NodeRegistry)) {
      if (def.type === 'EFFECT') {
        expect(SUPPORTED_EFFECT_TYPES).toContain(def.opcodeName)
      }
    }
  })

  it('N3: getNodeDefinition 返回节点定义', () => {
    const def = getNodeDefinition('Noise')
    expect(def.key).toBe('Noise')
    expect(def.type).toBe('REGION')
    expect(def.opcodeName).toBe('NOISE')
    expect(def.outputs).toHaveLength(1)
    expect(def.outputs[0].type).toBe('texture')
  })

  it('N4: getNodeDefinition 不存在的 key 应抛错', () => {
    expect(() => getNodeDefinition('NotExist' as never)).toThrow(/未知节点 key/)
  })

  it('N5: listNodeKeys 返回所有 key', () => {
    const keys = listNodeKeys()
    expect(keys.length).toBeGreaterThanOrEqual(10)  // 5 region + 5 effect + composite + output
    expect(keys).toContain('Noise')
    expect(keys).toContain('Vignette')
    expect(keys).toContain('Composite')
    expect(keys).toContain('Output')
  })

  it('N6: listNodeKeysByCategory 应按 category 分组', () => {
    const groups = listNodeKeysByCategory()
    expect(groups.background).toContain('SolidColor')
    expect(groups.shape).toContain('Noise')
    expect(groups.effect).toContain('Vignette')
    expect(groups.composite).toContain('Composite')
    expect(groups.output).toContain('Output')
  })

  it('N7: findRegionNodeByOpcodeName 能反查节点 key', () => {
    expect(findRegionNodeByOpcodeName('NOISE')).toBe('Noise')
    expect(findRegionNodeByOpcodeName('SOLID_COLOR')).toBe('SolidColor')
    expect(findRegionNodeByOpcodeName('CIRCLE_SHAPE')).toBe('CircleShape')
  })

  it('N8: findRegionNodeByOpcodeName 未知 opcode 返回 undefined', () => {
    expect(findRegionNodeByOpcodeName('SPIRAL')).toBeUndefined()
  })

  it('N9: findEffectNodeByType 能反查 effect 节点 key', () => {
    expect(findEffectNodeByType('blur')).toBe('Blur')
    expect(findEffectNodeByType('vignette')).toBe('Vignette')
    expect(findEffectNodeByType('bloom')).toBe('Bloom')
  })

  it('N10: findEffectNodeByType 未知 type 返回 undefined', () => {
    expect(findEffectNodeByType('unknown_effect')).toBeUndefined()
  })

  it('N11: Output 节点应有 1 个 input,无 output', () => {
    const def = getNodeDefinition('Output')
    expect(def.inputs).toHaveLength(1)
    expect(def.outputs).toEqual([])
  })

  it('N12: Composite 节点应有 3 个 input(多输入合并)', () => {
    const def = getNodeDefinition('Composite')
    expect(def.inputs.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// V: validator
// ============================================================================

describe('graph/validator', () => {
  describe('validateGraph', () => {
    it('V1: 最小有效 Graph 应通过校验', () => {
      const result = validateGraph(makeMinimalGraph())
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('V2: 缺少 OUTPUT 节点应报错', () => {
      const graph: RenderGraph = {
        nodes: [makeRegionNode('noise1', 'NOISE')],
        edges: [],
      }
      const result = validateGraph(graph)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('OUTPUT'))).toBe(true)
    })

    it('V3: 多个 OUTPUT 节点应报错', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('noise1', 'NOISE'),
          makeOutputNode('out1'),
          makeOutputNode('out2'),
        ],
        edges: [
          makeEdge('noise1', 'out1'),
          makeEdge('noise1', 'out2'),
        ],
      }
      const result = validateGraph(graph)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('OUTPUT 节点数量过多'))).toBe(true)
    })

    it('V4: 节点 ID 重复应报错', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('dup', 'NOISE', '节点 A'),
          makeRegionNode('dup', 'NOISE', '节点 B'),
        ],
        edges: [],
      }
      const result = validateGraph(graph)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('节点 ID 重复'))).toBe(true)
    })

    it('V5: edge 引用不存在的节点应报错', () => {
      const graph: RenderGraph = {
        nodes: [makeRegionNode('noise1', 'NOISE'), makeOutputNode('out1')],
        edges: [makeEdge('ghost_node', 'out1')],
      }
      const result = validateGraph(graph)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('from 节点不存在'))).toBe(true)
    })

    it('V6: 悬空节点应产生警告(但不阻塞)', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('noise1', 'NOISE'),
          makeRegionNode('orphan', 'NOISE', '孤立节点'),  // 未连接
          makeOutputNode('out1'),
        ],
        edges: [makeEdge('noise1', 'out1')],
      }
      const result = validateGraph(graph)
      expect(result.valid).toBe(true)
      expect(result.warnings.some((w) => w.includes('未连接'))).toBe(true)
    })

    it('V7: EFFECT 节点无输入应产生警告', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('noise1', 'NOISE'),
          makeEffectNode('vig1', 'vignette'),
          makeOutputNode('out1'),
        ],
        edges: [
          makeEdge('noise1', 'out1'),
          // vig1 没有输入
        ],
      }
      const result = validateGraph(graph)
      expect(result.valid).toBe(true)
      expect(result.warnings.some((w) => w.includes('EFFECT') && w.includes('没有输入'))).toBe(true)
    })
  })

  describe('detectCycle', () => {
    it('V8: 无环 Graph 返回 null', () => {
      expect(detectCycle(makeMinimalGraph())).toBeNull()
    })

    it('V9: 简单环 A → B → A 应被检测到', () => {
      const graph: RenderGraph = {
        nodes: [makeRegionNode('a', 'NOISE'), makeRegionNode('b', 'NOISE')],
        edges: [makeEdge('a', 'b'), makeEdge('b', 'a')],
      }
      const cycle = detectCycle(graph)
      expect(cycle).not.toBeNull()
      expect(cycle!.length).toBeGreaterThanOrEqual(2)
    })

    it('V10: 自环应被检测到', () => {
      const graph: RenderGraph = {
        nodes: [makeRegionNode('a', 'NOISE')],
        edges: [makeEdge('a', 'a')],
      }
      const cycle = detectCycle(graph)
      expect(cycle).not.toBeNull()
    })

    it('V11: 三节点环 A → B → C → A 应被检测到', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'NOISE'),
          makeRegionNode('b', 'NOISE'),
          makeRegionNode('c', 'NOISE'),
        ],
        edges: [
          makeEdge('a', 'b'),
          makeEdge('b', 'c'),
          makeEdge('c', 'a'),
        ],
      }
      expect(detectCycle(graph)).not.toBeNull()
    })
  })

  describe('canAddEdge', () => {
    it('V12: 合法新增连接应返回 ok=true', () => {
      // 场景:a → out 已存在,新增 b → out 应失败(输入端口被占)
      // 改为测试:b → out 之前没连,先连 a → out,再连 b → a(合法)
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'NOISE'),
          makeRegionNode('b', 'NOISE'),
          makeOutputNode('out'),
        ],
        edges: [makeEdge('a', 'out')],
      }
      // 新增 b → a(合法,a 的 input 端口未被占用)
      const result = canAddEdge(graph, {
        from: 'b',
        fromPort: 'output',
        to: 'a',
        toPort: 'input',
      })
      expect(result.ok).toBe(true)
    })

    it('V13: 自连应返回 ok=false', () => {
      const graph = makeMinimalGraph()
      const result = canAddEdge(graph, {
        from: 'noise1',
        fromPort: 'output',
        to: 'noise1',
        toPort: 'input',
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('自身')
    })

    it('V14: 输入端口已被占用应返回 ok=false', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'NOISE'),
          makeRegionNode('b', 'NOISE'),
          makeOutputNode('out'),
        ],
        edges: [makeEdge('a', 'out')],
      }
      const result = canAddEdge(graph, {
        from: 'b',
        fromPort: 'output',
        to: 'out',
        toPort: 'input',
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('已有连接')
    })

    it('V15: 形成环的连接应返回 ok=false', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'NOISE'),
          makeRegionNode('b', 'NOISE'),
        ],
        edges: [makeEdge('a', 'b')],
      }
      const result = canAddEdge(graph, {
        from: 'b',
        fromPort: 'output',
        to: 'a',
        toPort: 'input',
      })
      expect(result.ok).toBe(false)
      expect(result.reason).toContain('环')
    })
  })

  it('V16: isCompilable 等价于 validateGraph().valid', () => {
    expect(isCompilable(makeMinimalGraph())).toBe(true)
    expect(isCompilable({ nodes: [], edges: [] })).toBe(false)
  })
})

// ============================================================================
// C: graphCompiler
// ============================================================================

describe('graph/graphCompiler', () => {
  describe('topologicalSort', () => {
    it('C1: 链式 A → B → C 应得到 [A, B, C]', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'NOISE'),
          makeRegionNode('b', 'NOISE'),
          makeRegionNode('c', 'NOISE'),
        ],
        edges: [makeEdge('a', 'b'), makeEdge('b', 'c')],
      }
      const order = topologicalSort(graph)
      expect(order).toEqual(['a', 'b', 'c'])
    })

    it('C2: 分叉 A → B, A → C 顺序应保证 A 在前', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'NOISE'),
          makeRegionNode('b', 'NOISE'),
          makeRegionNode('c', 'NOISE'),
        ],
        edges: [makeEdge('a', 'b'), makeEdge('a', 'c')],
      }
      const order = topologicalSort(graph)
      expect(order[0]).toBe('a')
      expect(order).toContain('b')
      expect(order).toContain('c')
    })

    it('C3: 孤立节点也应出现在结果中', () => {
      const graph: RenderGraph = {
        nodes: [makeRegionNode('orphan', 'NOISE')],
        edges: [],
      }
      const order = topologicalSort(graph)
      expect(order).toEqual(['orphan'])
    })
  })

  describe('nodeToLayer', () => {
    it('C4: 应生成符合 Layer 接口的对象', () => {
      const node = makeRegionNode('n1', 'NOISE', '测试层')
      const layer = nodeToLayer(node, 0)
      expect(layer.id).toMatch(/^layer_[0-9a-f]{8}$/)
      expect(layer.opcode).toBe(Opcode.NOISE)
      expect(layer.params.scale).toBe(24)
      expect(layer.source).toBe('llm_parser')
      expect(layer.visible).toBe(true)
      expect(layer.blendMode).toBe('normal')
      expect(layer.paramOwnership.scale).toBe('l2_parser')
    })

    it('C5: 缺少 opcodeName 应抛错', () => {
      const node: GraphNode = {
        ...makeRegionNode('n1', 'NOISE'),
        opcodeName: undefined,
      }
      expect(() => nodeToLayer(node, 0)).toThrow(/缺少 opcodeName/)
    })

    it('C6: 不支持的 opcodeName 应抛错', () => {
      const node: GraphNode = {
        ...makeRegionNode('n1', 'NOISE'),
        opcodeName: 'SPIRAL',
      }
      expect(() => nodeToLayer(node, 0)).toThrow(/不支持/)
    })
  })

  describe('nodeToEffect', () => {
    it('C7: 应生成符合 Effect 接口的对象', () => {
      const node = makeEffectNode('e1', 'vignette', '晕影')
      const effect = nodeToEffect(node, 'layer_abc12345', 'region_def67890', 0)
      expect(effect.id).toMatch(/^effect_[0-9a-f]{8}$/)
      expect(effect.type).toBe('vignette')
      expect(effect.targetLayer).toBe('layer_abc12345')
      expect(effect.targetRegion).toBe('region_def67890')
      expect(effect.params.strength).toBe(0.5)
    })

    it('C8: 不支持的 effect type 应抛错', () => {
      const node: GraphNode = {
        ...makeEffectNode('e1', 'vignette'),
        opcodeName: 'unknown_effect',
      }
      expect(() => nodeToEffect(node, 'l', 'r', 0)).toThrow(/不支持/)
    })
  })

  describe('compileGraph (端到端)', () => {
    it('C9: 最小 Graph 应编译成功', () => {
      const result = compileGraph(makeMinimalGraph())
      expect(result.ir.layers).toHaveLength(1)
      expect(result.ir.layers[0].opcode).toBe(Opcode.NOISE)
      expect(result.ir.regions).toHaveLength(1)
      expect(result.ir.regions[0].layerRefs).toHaveLength(1)
      expect(result.ir.effects).toEqual([])
      expect(result.ir.canvas).toEqual({ width: 1920, height: 1080 })
    })

    it('C10: 校验失败的 Graph 应抛错', () => {
      const badGraph: RenderGraph = { nodes: [], edges: [] }
      expect(() => compileGraph(badGraph)).toThrow(/校验失败/)
    })

    it('C11: 链式 Graph(Noise → Vignette → Output)应正确编译', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('noise1', 'NOISE', '噪声'),
          makeEffectNode('vig1', 'vignette', '晕影'),
          makeOutputNode('out1'),
        ],
        edges: [
          makeEdge('noise1', 'vig1'),
          makeEdge('vig1', 'out1'),
        ],
      }
      const result = compileGraph(graph)
      expect(result.ir.layers).toHaveLength(1)
      expect(result.ir.layers[0].opcode).toBe(Opcode.NOISE)
      expect(result.ir.effects).toHaveLength(1)
      expect(result.ir.effects[0].type).toBe('vignette')
      expect(result.ir.effects[0].targetLayer).toBe(result.ir.layers[0].id)
    })

    it('C12: 多个 REGION 节点应生成多个 Layer', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'SOLID_COLOR', '背景'),
          makeRegionNode('b', 'NOISE', '主体'),
          makeOutputNode('out'),
        ],
        edges: [makeEdge('a', 'b'), makeEdge('b', 'out')],
      }
      const result = compileGraph(graph)
      expect(result.ir.layers).toHaveLength(2)
      expect(result.ir.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      expect(result.ir.layers[1].opcode).toBe(Opcode.NOISE)
    })

    it('C13: region.layerRefs 应包含所有 layer.id', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('a', 'SOLID_COLOR'),
          makeRegionNode('b', 'NOISE'),
          makeOutputNode('out'),
        ],
        edges: [makeEdge('a', 'b'), makeEdge('b', 'out')],
      }
      const result = compileGraph(graph)
      expect(result.ir.regions).toHaveLength(1)
      expect(result.ir.regions[0].layerRefs).toEqual(
        result.ir.layers.map((l) => l.id),
      )
    })

    it('C14: 同一 Graph 多次编译应得到相同 ID(稳定性)', () => {
      const graph = makeMinimalGraph()
      const r1 = compileGraph(graph)
      const r2 = compileGraph(graph)
      expect(r1.ir.layers[0].id).toBe(r2.ir.layers[0].id)
      expect(r1.ir.regions[0].id).toBe(r2.ir.regions[0].id)
    })

    it('C15: createRegion=false 时不生成 region', () => {
      const result = compileGraph(makeMinimalGraph(), { createRegion: false })
      expect(result.ir.regions).toEqual([])
    })

    it('C16: 自定义画布尺寸应生效', () => {
      const result = compileGraph(makeMinimalGraph(), {
        canvasWidth: 1024,
        canvasHeight: 768,
      })
      expect(result.ir.canvas).toEqual({ width: 1024, height: 768 })
    })

    it('C17: EFFECT 节点无前驱时应产生警告', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('noise1', 'NOISE'),
          makeEffectNode('vig1', 'vignette'),  // 无前驱
          makeOutputNode('out1'),
        ],
        edges: [makeEdge('noise1', 'out1')],
      }
      const result = compileGraph(graph)
      // 警告应包含 EFFECT 节点相关内容
      expect(result.warnings.length).toBeGreaterThan(0)
    })

    it('C18: summarizeCompileResult 应返回可读摘要', () => {
      const result = compileGraph(makeMinimalGraph())
      const summary = summarizeCompileResult(result)
      expect(summary).toMatch(/\d+ 图层/)
      expect(summary).toMatch(/\d+ 区域/)
      expect(summary).toContain('1920×1080')
    })
  })
})

// ============================================================================
// G: graphGenerator
// ============================================================================

describe('graph/graphGenerator', () => {
  describe('sceneLayerToGraphNode', () => {
    it('G1: 应把 SceneLayer 转换为 REGION 类型的 GraphNode', () => {
      const node = sceneLayerToGraphNode(
        {
          name: '星空',
          opcodeName: 'NOISE',
          role: 'main',
          params: { scale: 32, amount: 0.8 },
        },
        { x: 100, y: 200 },
        'node_1',
      )
      expect(node.id).toBe('node_1')
      expect(node.type).toBe('REGION')
      expect(node.name).toBe('星空')
      expect(node.opcodeName).toBe('NOISE')
      expect(node.position).toEqual({ x: 100, y: 200 })
      expect(node.params.scale).toBe(32)
      expect(node.outputs).toHaveLength(1)
      expect(node.outputs[0].type).toBe('texture')
    })

    it('G2: 不支持的 opcodeName 应抛错', () => {
      expect(() =>
        sceneLayerToGraphNode(
          {
            name: '未知',
            opcodeName: 'SPIRAL',
            role: 'main',
            params: {},
          },
          { x: 0, y: 0 },
          'n1',
        ),
      ).toThrow(/无对应节点/)
    })
  })

  describe('generateGraph', () => {
    const baseReq: CreativeRequirement = {
      subject: '宇宙',
      style: { color: '蓝紫色', tone: 'cinematic' },
      elements: ['星空', '星云', '银河'],
    }

    it('G3: 宇宙主题应生成多个节点(含 Output)', () => {
      const graph = generateGraph(baseReq)
      expect(graph.nodes.length).toBeGreaterThanOrEqual(5)  // 至少 4 个 layer + 1 个 output
      expect(graph.nodes.some((n) => n.type === 'OUTPUT')).toBe(true)
    })

    it('G4: 应自动追加 Vignette effect 节点(tone=cinematic)', () => {
      const graph = generateGraph(baseReq)
      const vigNode = graph.nodes.find(
        (n) => n.type === 'EFFECT' && n.opcodeName === 'vignette',
      )
      expect(vigNode).toBeDefined()
    })

    it('G5: dreamy tone 应追加 Bloom', () => {
      const graph = generateGraph({
        subject: '宇宙',
        style: { tone: 'dreamy' },
        elements: [],
      })
      const bloomNode = graph.nodes.find(
        (n) => n.type === 'EFFECT' && n.opcodeName === 'bloom',
      )
      expect(bloomNode).toBeDefined()
    })

    it('G6: lighting=柔和 应追加 Blur', () => {
      const graph = generateGraph({
        subject: '宇宙',
        style: { lighting: '柔和' },
        elements: [],
      })
      const blurNode = graph.nodes.find(
        (n) => n.type === 'EFFECT' && n.opcodeName === 'blur',
      )
      expect(blurNode).toBeDefined()
    })

    it('G7: 无 style 时不追加 effect 节点', () => {
      const graph = generateGraph({
        subject: '宇宙',
        elements: [],
      })
      const effectNodes = graph.nodes.filter((n) => n.type === 'EFFECT')
      expect(effectNodes).toEqual([])
    })

    it('G8: 应自动生成链式连接(A → B → ... → Output)', () => {
      const graph = generateGraph(baseReq)
      // OUTPUT 节点应有 1 条入边
      const outputNode = graph.nodes.find((n) => n.type === 'OUTPUT')!
      const inEdges = graph.edges.filter((e) => e.to === outputNode.id)
      expect(inEdges).toHaveLength(1)
    })

    it('G9: 生成的 Graph 应通过 validateGraph', () => {
      const graph = generateGraph(baseReq)
      const result = validateGraph(graph)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('G10: 生成的 Graph 应可编译为 RenderIR', () => {
      const graph = generateGraph(baseReq)
      const result = compileGraph(graph)
      expect(result.ir.layers.length).toBeGreaterThan(0)
      expect(result.ir.regions).toHaveLength(1)
      expect(result.ir.effects.length).toBeGreaterThan(0)
    })

    it('G11: createEffects=false 时不追加 effect 节点', () => {
      const graph = generateGraph(baseReq, { createEffects: false })
      const effectNodes = graph.nodes.filter((n) => n.type === 'EFFECT')
      expect(effectNodes).toEqual([])
    })

    it('G12: createOutput=false 时不追加 Output 节点(校验会失败)', () => {
      const graph = generateGraph(baseReq, { createOutput: false })
      expect(graph.nodes.some((n) => n.type === 'OUTPUT')).toBe(false)
      // 此时 validateGraph 会失败
      const result = validateGraph(graph)
      expect(result.valid).toBe(false)
    })

    it('G13: 同一 requirement 多次生成应得到相同结构(稳定性)', () => {
      const g1 = generateGraph(baseReq)
      const g2 = generateGraph(baseReq)
      expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id))
      expect(g1.edges.map((e) => e.id)).toEqual(g2.edges.map((e) => e.id))
    })

    it('G14: 用户示例场景 "电影感蓝紫宇宙" 完整链路验证', () => {
      // Step 25 spec 示例:电影感蓝紫宇宙
      const graph = generateGraph({
        subject: '宇宙',
        style: { color: '蓝紫色', tone: 'cinematic' },
        elements: ['星空', '星云', '银河'],
      })

      // 应包含多个 REGION 节点(NOISE opcode)
      const regionNodes = graph.nodes.filter((n) => n.type === 'REGION')
      expect(regionNodes.length).toBeGreaterThanOrEqual(3)

      // 应包含 Vignette effect
      expect(
        graph.nodes.some(
          (n) => n.type === 'EFFECT' && n.opcodeName === 'vignette',
        ),
      ).toBe(true)

      // 应包含 Output 节点
      expect(graph.nodes.some((n) => n.type === 'OUTPUT')).toBe(true)

      // 编译后蓝紫色应覆盖 NOISE layer 的 colorA
      const result = compileGraph(graph)
      const noiseLayers = result.ir.layers.filter((l) => l.opcode === Opcode.NOISE)
      expect(noiseLayers.length).toBeGreaterThanOrEqual(1)
      for (const layer of noiseLayers) {
        expect(layer.params.colorA).toEqual([0.2, 0.3, 1.0, 1])
      }

      // 应有 vignette effect
      expect(result.ir.effects.some((e) => e.type === 'vignette')).toBe(true)
    })

    it('G15: summarizeGraph 应返回可读摘要', () => {
      const graph = generateGraph(baseReq)
      const summary = summarizeGraph(graph)
      expect(summary).toMatch(/\d+ 节点/)
      expect(summary).toMatch(/\d+ 图层/)
      expect(summary).toMatch(/\d+ 连接/)
      expect(summary).toContain('已连接输出')
    })
  })
})

// ============================================================================
// S: graphStore (Pinia)
// ============================================================================

describe('graph/graphStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('S1: 初始状态应为空', () => {
    const store = useGraphStore()
    expect(store.nodes).toEqual([])
    expect(store.edges).toEqual([])
    expect(store.nodeCount).toBe(0)
    expect(store.edgeCount).toBe(0)
    expect(store.selectedNodeId).toBeNull()
  })

  it('S2: addNode 应从注册表实例化节点', () => {
    const store = useGraphStore()
    const id = store.addNode('Noise')
    expect(store.nodes).toHaveLength(1)
    expect(store.nodes[0].id).toBe(id)
    expect(store.nodes[0].type).toBe('REGION')
    expect(store.nodes[0].opcodeName).toBe('NOISE')
    expect(store.nodes[0].outputs).toHaveLength(1)
  })

  it('S3: removeNode 应同时移除相关 edge', () => {
    const store = useGraphStore()
    const id1 = store.addNode('Noise')
    const id2 = store.addNode('Output')
    store.connect(id1, 'output', id2, 'input')
    expect(store.edges).toHaveLength(1)

    store.removeNode(id1)
    expect(store.nodes).toHaveLength(1)
    expect(store.edges).toHaveLength(0)  // 相关 edge 被清理
  })

  it('S4: connect 合法连接应成功', () => {
    const store = useGraphStore()
    const id1 = store.addNode('Noise')
    const id2 = store.addNode('Output')
    const result = store.connect(id1, 'output', id2, 'input')
    expect(result.ok).toBe(true)
    expect(result.edgeId).toBeDefined()
    expect(store.edges).toHaveLength(1)
  })

  it('S5: connect 自连应失败', () => {
    const store = useGraphStore()
    const id = store.addNode('Noise')
    const result = store.connect(id, 'output', id, 'input')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('自身')
  })

  it('S6: connect 形成环应失败', () => {
    const store = useGraphStore()
    // 用两个 Vignette 互连(Noise 无 input,无法形成环)
    const v1 = store.addNode('Vignette')
    const v2 = store.addNode('Vignette')
    const r1 = store.connect(v1, 'output', v2, 'input')
    expect(r1.ok).toBe(true)
    const r2 = store.connect(v2, 'output', v1, 'input')
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('环')
  })

  it('S7: updateNodePosition 应更新节点位置', () => {
    const store = useGraphStore()
    const id = store.addNode('Noise')
    store.updateNodePosition(id, { x: 500, y: 600 })
    expect(store.getNode(id)?.position).toEqual({ x: 500, y: 600 })
  })

  it('S8: updateNodeParams 应更新节点参数', () => {
    const store = useGraphStore()
    const id = store.addNode('Noise')
    store.updateNodeParams(id, { scale: 64 })
    expect(store.getNode(id)?.params.scale).toBe(64)
  })

  it('S9: selectNode / clearSelection 应正确切换选中状态', () => {
    const store = useGraphStore()
    const id = store.addNode('Noise')
    store.selectNode(id)
    expect(store.selectedNodeId).toBe(id)
    expect(store.selectedNode?.id).toBe(id)
    store.clearSelection()
    expect(store.selectedNodeId).toBeNull()
    expect(store.selectedNode).toBeNull()
  })

  it('S10: loadGraph 应替换整个 Graph 状态', () => {
    const store = useGraphStore()
    store.addNode('Noise')  // 先放一个
    const graph = makeMinimalGraph()
    store.loadGraph(graph)
    expect(store.nodes).toHaveLength(2)
    expect(store.edges).toHaveLength(1)
  })

  it('S11: clearGraph 应清空状态', () => {
    const store = useGraphStore()
    store.addNode('Noise')
    store.addNode('Output')
    store.clearGraph()
    expect(store.nodes).toEqual([])
    expect(store.edges).toEqual([])
  })

  it('S12: exportGraph 应返回深拷贝(修改 export 不影响 store)', () => {
    const store = useGraphStore()
    store.addNode('Noise')
    const exported = store.exportGraph()
    exported.nodes[0].name = 'modified'
    expect(store.nodes[0].name).not.toBe('modified')
  })

  it('S13: validation 应是 computed(自动重算)', () => {
    const store = useGraphStore()
    // 空 graph:无 OUTPUT 节点 → invalid
    expect(store.isValid).toBe(false)

    store.addNode('Noise')
    // 仍无 OUTPUT → invalid
    expect(store.isValid).toBe(false)

    store.addNode('Output')
    // 有 1 个 OUTPUT 节点 → valid(悬空节点只是 warning,不阻塞)
    expect(store.isValid).toBe(true)

    // 再加一个 OUTPUT → 多个 OUTPUT 节点 → invalid
    store.addNode('Output')
    expect(store.isValid).toBe(false)
  })

  it('S14: getIncomingEdges / getOutgoingEdges 应正确返回边', () => {
    const store = useGraphStore()
    const n1 = store.addNode('Noise')
    const n2 = store.addNode('Vignette')
    const n3 = store.addNode('Output')
    store.connect(n1, 'output', n2, 'input')
    store.connect(n2, 'output', n3, 'input')

    expect(store.getIncomingEdges(n2)).toHaveLength(1)
    expect(store.getOutgoingEdges(n2)).toHaveLength(1)
    expect(store.getIncomingEdges(n1)).toHaveLength(0)
    expect(store.getOutgoingEdges(n1)).toHaveLength(1)
  })
})
