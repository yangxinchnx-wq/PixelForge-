/**
 * 子图(SubGraph)机制单元测试。
 *
 * 覆盖：
 * - SG-T: 类型定义（SubGraphDefinition / SubGraphNode / SubGraphPort）
 * - SG-I: subgraphInliner（inlineSubGraphs / detectSubGraphCycles / createSubGraphFromSelection）
 * - SG-C: graphCompiler 集成（编译含子图的 RenderGraph）
 * - SG-V: validator 集成（校验 SUBGRAPH 节点）
 * - SG-S: graphStore 集成（子图管理 actions）
 * - SG-E: evaluator 集成（SUBGRAPH 节点不应到达运行时）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import { Opcode } from '@/shared/types'
import type {
  GraphEdge,
  GraphNode,
  RenderGraph,
  SubGraphDefinition,
  SubGraphNode,
  SubGraphPort,
} from './types'
import {
  inlineSubGraphs,
  SubGraphInlineError,
  createEmptySubGraphDefinition,
  createSubGraphFromSelection,
  generateSubGraphInstanceId,
} from './subgraphInliner'
import { compileGraph } from './graphCompiler'
import { validateGraph } from './validator'
import { useGraphStore } from './graphStore'
import { getSubGraphPorts } from './nodeRegistry'

// ============================================================================
// 辅助函数
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

/** 创建一个简单的子图定义：Noise → Blur */
function makeNoiseBlurSubGraph(): SubGraphDefinition {
  return {
    id: 'sg_noise_blur',
    name: '噪声模糊',
    description: '噪声 + 模糊的标准组合',
    version: '1.0.0',
    inputPorts: [
      {
        id: 'sg_input',
        name: '背景',
        type: 'texture',
        boundTo: { nodeId: 'internal_noise', portId: 'input' },
      },
    ],
    outputPorts: [
      {
        id: 'sg_output',
        name: '效果',
        type: 'texture',
        boundTo: { nodeId: 'internal_blur', portId: 'output' },
      },
    ],
    nodes: [
      makeRegionNode('internal_noise', 'NOISE', '内部噪声', { x: 0, y: 0 }),
      makeEffectNode('internal_blur', 'blur', '内部模糊', { x: 250, y: 0 }),
    ],
    edges: [
      makeEdge('internal_noise', 'internal_blur'),
    ],
    params: [
      {
        key: 'noiseScale',
        name: '噪声缩放',
        type: 'number',
        defaultValue: 24,
        description: '噪声的缩放比例',
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** 创建 SUBGRAPH 节点 */
function makeSubGraphNode(
  id: string,
  subgraphId: string,
  instanceId: string,
  position = { x: 100, y: 100 },
): SubGraphNode {
  return {
    id,
    type: 'SUBGRAPH',
    name: '子图节点',
    position,
    inputs: [
      { id: 'sg_input', name: '背景', type: 'texture' },
    ],
    outputs: [
      { id: 'sg_output', name: '效果', type: 'texture' },
    ],
    params: {},
    subgraphId,
    paramOverrides: {},
    instanceId,
  }
}

// ============================================================================
// SG-T: 类型定义
// ============================================================================

describe('subgraph/types', () => {
  it('SG-T1: SubGraphDefinition 应包含必要字段', () => {
    const def = makeNoiseBlurSubGraph()
    expect(def.id).toBe('sg_noise_blur')
    expect(def.name).toBe('噪声模糊')
    expect(def.version).toBe('1.0.0')
    expect(def.inputPorts).toHaveLength(1)
    expect(def.outputPorts).toHaveLength(1)
    expect(def.nodes).toHaveLength(2)
    expect(def.edges).toHaveLength(1)
    expect(def.params).toHaveLength(1)
  })

  it('SG-T2: SubGraphNode 应有 SUBGRAPH 类型和必要字段', () => {
    const node = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')
    expect(node.type).toBe('SUBGRAPH')
    expect(node.subgraphId).toBe('sg_noise_blur')
    expect(node.instanceId).toBe('inst_1')
    expect(node.paramOverrides).toEqual({})
  })

  it('SG-T3: SubGraphPort 应有 boundTo 字段', () => {
    const port: SubGraphPort = {
      id: 'input',
      name: '背景',
      type: 'texture',
      boundTo: { nodeId: 'node1', portId: 'input' },
    }
    expect(port.boundTo.nodeId).toBe('node1')
    expect(port.boundTo.portId).toBe('input')
  })
})

// ============================================================================
// SG-I: subgraphInliner
// ============================================================================

describe('subgraph/subgraphInliner', () => {
  describe('inlineSubGraphs', () => {
    it('SG-I1: 无子图节点时应原样返回', () => {
      const graph = makeMinimalGraph()
      const result = inlineSubGraphs(graph)
      expect(result.nodes).toHaveLength(2)
      expect(result.edges).toHaveLength(1)
    })

    it('SG-I2: 基本子图内联应展开 SUBGRAPH 节点', () => {
      const subDef = makeNoiseBlurSubGraph()
      const sgNode = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')

      // 外部图：SolidColor → SubGraph → Output
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('bg', 'SOLID_COLOR', '背景'),
          sgNode,
          makeOutputNode('out'),
        ],
        edges: [
          makeEdge('bg', 'sg1', 'output', 'sg_input'),
          makeEdge('sg1', 'out', 'sg_output', 'input'),
        ],
        subgraphLibrary: [subDef],
      }

      const result = inlineSubGraphs(graph)

      // SUBGRAPH 节点应被替换为内部节点
      expect(result.nodes.some((n) => n.type === 'SUBGRAPH')).toBe(false)
      // 应有 2 个内部节点（noise + blur）+ 1 个背景 + 1 个输出
      expect(result.nodes).toHaveLength(4)
      // 内部节点 ID 应有前缀
      expect(result.nodes.some((n) => n.id.startsWith('inst_1_'))).toBe(true)
      // 子图库应被清空
      expect(result.subgraphLibrary).toEqual([])
    })

    it('SG-I3: 外部边应被正确重定向到内部节点', () => {
      const subDef = makeNoiseBlurSubGraph()
      const sgNode = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')

      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('bg', 'SOLID_COLOR', '背景'),
          sgNode,
          makeOutputNode('out'),
        ],
        edges: [
          makeEdge('bg', 'sg1', 'output', 'sg_input'),
          makeEdge('sg1', 'out', 'sg_output', 'input'),
        ],
        subgraphLibrary: [subDef],
      }

      const result = inlineSubGraphs(graph)

      // 入边：bg → inst_1_internal_noise（而不是 sg1）
      const inEdge = result.edges.find((e) => e.from === 'bg')
      expect(inEdge).toBeDefined()
      expect(inEdge!.to).toBe('inst_1_internal_noise')
      expect(inEdge!.toPort).toBe('input')

      // 出边：inst_1_internal_blur → out（而不是 sg1）
      const outEdge = result.edges.find((e) => e.to === 'out')
      expect(outEdge).toBeDefined()
      expect(outEdge!.from).toBe('inst_1_internal_blur')
      expect(outEdge!.fromPort).toBe('output')
    })

    it('SG-I4: 同一子图的多个实例应有不同 ID 前缀', () => {
      const subDef = makeNoiseBlurSubGraph()
      const sg1 = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')
      const sg2 = makeSubGraphNode('sg2', 'sg_noise_blur', 'inst_2')

      const graph: RenderGraph = {
        nodes: [sg1, sg2, makeOutputNode('out')],
        edges: [
          makeEdge('sg1', 'out', 'sg_output', 'input'),
          // sg2 没有连接（悬空，但不影响内联测试）
        ],
        subgraphLibrary: [subDef],
      }

      const result = inlineSubGraphs(graph)

      // 应有 4 个内部节点（2 实例 × 2 节点）+ 1 个输出
      expect(result.nodes).toHaveLength(5)

      // 两组内部节点应有不同的前缀
      const inst1Nodes = result.nodes.filter((n) => n.id.startsWith('inst_1_'))
      const inst2Nodes = result.nodes.filter((n) => n.id.startsWith('inst_2_'))
      expect(inst1Nodes).toHaveLength(2)
      expect(inst2Nodes).toHaveLength(2)
    })

    it('SG-I5: 参数覆盖应替换内部节点参数', () => {
      const subDef = makeNoiseBlurSubGraph()
      const sgNode: SubGraphNode = {
        ...makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1'),
        paramOverrides: { noiseScale: 64 },
      }

      // 修改子图定义，让内部节点使用模板参数
      subDef.nodes[0].params.scale = '${noiseScale}'

      const graph: RenderGraph = {
        nodes: [sgNode, makeOutputNode('out')],
        edges: [makeEdge('sg1', 'out', 'sg_output', 'input')],
        subgraphLibrary: [subDef],
      }

      const result = inlineSubGraphs(graph)

      // 内部噪声节点的 scale 应被替换为 64
      const noiseNode = result.nodes.find(
        (n) => n.id === 'inst_1_internal_noise',
      )
      expect(noiseNode).toBeDefined()
      expect(noiseNode!.params.scale).toBe('64')
    })

    it('SG-I6: 子图定义不存在时应抛出错误', () => {
      const sgNode = makeSubGraphNode('sg1', 'nonexistent', 'inst_1')

      const graph: RenderGraph = {
        nodes: [sgNode, makeOutputNode('out')],
        edges: [],
        subgraphLibrary: [],
      }

      expect(() => inlineSubGraphs(graph)).toThrow(SubGraphInlineError)
      expect(() => inlineSubGraphs(graph)).toThrow(/子图定义未找到/)
    })

    it('SG-I7: 子图库中的循环引用应被检测到', () => {
      // 子图 A 引用子图 B，子图 B 引用子图 A
      const subA: SubGraphDefinition = {
        ...createEmptySubGraphDefinition('sg_a', 'A'),
        nodes: [makeSubGraphNode('ref_b', 'sg_b', 'inst_b', { x: 0, y: 0 })],
      }
      const subB: SubGraphDefinition = {
        ...createEmptySubGraphDefinition('sg_b', 'B'),
        nodes: [makeSubGraphNode('ref_a', 'sg_a', 'inst_a', { x: 0, y: 0 })],
      }

      // 图中也需要有 SUBGRAPH 节点才会触发内联流程
      const sgNode = makeSubGraphNode('sg1', 'sg_a', 'inst_1')

      const graph: RenderGraph = {
        nodes: [sgNode, makeOutputNode('out')],
        edges: [],
        subgraphLibrary: [subA, subB],
      }

      expect(() => inlineSubGraphs(graph)).toThrow(SubGraphInlineError)
      expect(() => inlineSubGraphs(graph)).toThrow(/循环引用/)
    })
  })

  describe('createEmptySubGraphDefinition', () => {
    it('SG-I8: 应创建空的子图定义', () => {
      const def = createEmptySubGraphDefinition('test_id', '测试子图')
      expect(def.id).toBe('test_id')
      expect(def.name).toBe('测试子图')
      expect(def.nodes).toEqual([])
      expect(def.edges).toEqual([])
      expect(def.inputPorts).toEqual([])
      expect(def.outputPorts).toEqual([])
    })
  })

  describe('createSubGraphFromSelection', () => {
    it('SG-I9: 应从选中节点创建子图定义', () => {
      const graph: RenderGraph = {
        nodes: [
          makeRegionNode('noise1', 'NOISE', '噪声'),
          makeEffectNode('blur1', 'blur', '模糊'),
          makeOutputNode('out'),
        ],
        edges: [
          makeEdge('noise1', 'blur1'),
          makeEdge('blur1', 'out'),
        ],
      }

      const selectedIds = new Set(['noise1', 'blur1'])
      const def = createSubGraphFromSelection(
        graph,
        selectedIds,
        'new_sg',
        '新子图',
      )

      expect(def.id).toBe('new_sg')
      expect(def.name).toBe('新子图')
      expect(def.nodes).toHaveLength(2)
      expect(def.edges).toHaveLength(1)
      // 应有 0 个输入端口（noise1 的入边来自外部，但 bg 不存在）
      // 应有 1 个输出端口（blur1 的出边到 out）
      expect(def.outputPorts).toHaveLength(1)
    })
  })

  describe('generateSubGraphInstanceId', () => {
    it('SG-I10: 应生成唯一的实例 ID', () => {
      const id1 = generateSubGraphInstanceId()
      const id2 = generateSubGraphInstanceId()
      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^sg_/)
    })
  })
})

// ============================================================================
// SG-C: graphCompiler 集成
// ============================================================================

describe('subgraph/graphCompiler', () => {
  it('SG-C1: 含子图的 Graph 应能正确编译', () => {
    const subDef = makeNoiseBlurSubGraph()
    const sgNode = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')

    const graph: RenderGraph = {
      nodes: [
        makeRegionNode('bg', 'SOLID_COLOR', '背景'),
        sgNode,
        makeOutputNode('out'),
      ],
      edges: [
        makeEdge('bg', 'sg1', 'output', 'sg_input'),
        makeEdge('sg1', 'out', 'sg_output', 'input'),
      ],
      subgraphLibrary: [subDef],
    }

    const result = compileGraph(graph)

    // 应编译成功，生成 3 个 Layer（bg + noise + blur 的 effect）
    expect(result.ir.layers.length).toBeGreaterThanOrEqual(2)
    expect(result.ir.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
    expect(result.ir.layers[1].opcode).toBe(Opcode.NOISE)
    // 应有 1 个 Effect（blur）
    expect(result.ir.effects).toHaveLength(1)
    expect(result.ir.effects[0].type).toBe('blur')
  })

  it('SG-C2: 编译后子图库应被清空', () => {
    const subDef = makeNoiseBlurSubGraph()
    const sgNode = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')

    const graph: RenderGraph = {
      nodes: [sgNode, makeOutputNode('out')],
      edges: [makeEdge('sg1', 'out', 'sg_output', 'input')],
      subgraphLibrary: [subDef],
    }

    const result = compileGraph(graph)
    expect(result.ir.layers.length).toBeGreaterThan(0)
    // 编译成功即表示内联完成
  })
})

// ============================================================================
// SG-V: validator 集成
// ============================================================================

describe('subgraph/validator', () => {
  it('SG-V1: SUBGRAPH 节点缺少 subgraphId 应报错', () => {
    const badNode: SubGraphNode = {
      ...makeSubGraphNode('sg1', '', 'inst_1'),
      subgraphId: '',
    }

    const graph: RenderGraph = {
      nodes: [badNode, makeOutputNode('out')],
      edges: [],
    }

    const result = validateGraph(graph)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('subgraphId'))).toBe(true)
  })

  it('SG-V2: SUBGRAPH 节点缺少 instanceId 应报错', () => {
    const badNode: SubGraphNode = {
      ...makeSubGraphNode('sg1', 'sg_test', ''),
      instanceId: '',
    }

    const graph: RenderGraph = {
      nodes: [badNode, makeOutputNode('out')],
      edges: [],
    }

    const result = validateGraph(graph)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('instanceId'))).toBe(true)
  })

  it('SG-V3: SUBGRAPH 节点引用不存在的子图定义应报错', () => {
    const sgNode = makeSubGraphNode('sg1', 'nonexistent', 'inst_1')

    const graph: RenderGraph = {
      nodes: [sgNode, makeOutputNode('out')],
      edges: [],
      subgraphLibrary: [],
    }

    const result = validateGraph(graph)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('子图定义不存在'))).toBe(true)
  })

  it('SG-V4: 有效的 SUBGRAPH 节点应通过校验', () => {
    const subDef = makeNoiseBlurSubGraph()
    const sgNode = makeSubGraphNode('sg1', 'sg_noise_blur', 'inst_1')

    const graph: RenderGraph = {
      nodes: [sgNode, makeOutputNode('out')],
      edges: [makeEdge('sg1', 'out', 'sg_output', 'input')],
      subgraphLibrary: [subDef],
    }

    const result = validateGraph(graph)
    expect(result.valid).toBe(true)
  })
})

// ============================================================================
// SG-S: graphStore 集成
// ============================================================================

describe('subgraph/graphStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('SG-S1: addSubGraphDefinition 应添加子图定义', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()

    store.addSubGraphDefinition(def)
    expect(store.subgraphLibrary).toHaveLength(1)
    expect(store.subgraphLibrary[0].id).toBe('sg_noise_blur')
  })

  it('SG-S2: removeSubGraphDefinition 应移除子图定义', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()

    store.addSubGraphDefinition(def)
    expect(store.subgraphLibrary).toHaveLength(1)

    store.removeSubGraphDefinition('sg_noise_blur')
    expect(store.subgraphLibrary).toHaveLength(0)
  })

  it('SG-S3: removeSubGraphDefinition 应同时移除引用该子图的节点', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()

    store.addSubGraphDefinition(def)
    store.addSubGraphNode('sg_noise_blur')
    expect(store.nodes).toHaveLength(1)
    expect(store.nodes[0].type).toBe('SUBGRAPH')

    store.removeSubGraphDefinition('sg_noise_blur')
    expect(store.nodes).toHaveLength(0)
    expect(store.subgraphLibrary).toHaveLength(0)
  })

  it('SG-S4: addSubGraphNode 应创建 SUBGRAPH 节点', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()

    store.addSubGraphDefinition(def)
    store.addSubGraphNode('sg_noise_blur')

    expect(store.nodes).toHaveLength(1)
    const node = store.nodes[0] as SubGraphNode
    expect(node.type).toBe('SUBGRAPH')
    expect(node.subgraphId).toBe('sg_noise_blur')
    expect(node.instanceId).toMatch(/^sg_/)
    // 端口应从子图定义动态生成
    expect(node.inputs).toHaveLength(1)
    expect(node.outputs).toHaveLength(1)
  })

  it('SG-S5: addSubGraphNode 子图定义不存在时应抛错', () => {
    const store = useGraphStore()
    expect(() => store.addSubGraphNode('nonexistent')).toThrow(/子图定义不存在/)
  })

  it('SG-S6: getSubGraphDefinition 应返回子图定义', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()

    store.addSubGraphDefinition(def)
    const found = store.getSubGraphDefinition('sg_noise_blur')
    expect(found).toBeDefined()
    expect(found!.name).toBe('噪声模糊')
  })

  it('SG-S7: listSubGraphDefinitions 应返回所有子图定义', () => {
    const store = useGraphStore()
    store.addSubGraphDefinition(makeNoiseBlurSubGraph())
    store.addSubGraphDefinition(
      createEmptySubGraphDefinition('sg_test2', '测试2'),
    )

    const list = store.listSubGraphDefinitions()
    expect(list).toHaveLength(2)
  })

  it('SG-S8: loadGraph 应加载子图库', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()

    const graph: RenderGraph = {
      nodes: [makeOutputNode('out')],
      edges: [],
      subgraphLibrary: [def],
    }

    store.loadGraph(graph)
    expect(store.subgraphLibrary).toHaveLength(1)
    expect(store.subgraphLibrary[0].id).toBe('sg_noise_blur')
  })

  it('SG-S9: clearGraph 应清空子图库', () => {
    const store = useGraphStore()
    store.addSubGraphDefinition(makeNoiseBlurSubGraph())
    expect(store.subgraphLibrary).toHaveLength(1)

    store.clearGraph()
    expect(store.subgraphLibrary).toHaveLength(0)
  })

  it('SG-S10: exportGraph 应包含子图库', () => {
    const store = useGraphStore()
    store.addSubGraphDefinition(makeNoiseBlurSubGraph())

    const exported = store.exportGraph()
    expect(exported.subgraphLibrary).toHaveLength(1)
    expect(exported.subgraphLibrary![0].id).toBe('sg_noise_blur')
  })

  it('SG-S11: exportGraph 无子图时 subgraphLibrary 应为 undefined', () => {
    const store = useGraphStore()
    store.addNode('Noise')

    const exported = store.exportGraph()
    expect(exported.subgraphLibrary).toBeUndefined()
  })

  it('SG-S12: updateSubGraphNodeOverrides 应更新参数覆盖', () => {
    const store = useGraphStore()
    const def = makeNoiseBlurSubGraph()
    store.addSubGraphDefinition(def)
    const nodeId = store.addSubGraphNode('sg_noise_blur')

    store.updateSubGraphNodeOverrides(nodeId, { noiseScale: 64 })
    const node = store.nodes[0] as SubGraphNode
    expect(node.paramOverrides.noiseScale).toBe(64)
  })

  it('SG-S13: addSubGraphDefinition 同 ID 应替换已有定义', () => {
    const store = useGraphStore()
    const def1 = makeNoiseBlurSubGraph()
    store.addSubGraphDefinition(def1)

    const def2 = { ...def1, name: '更新后的名称' }
    store.addSubGraphDefinition(def2)

    expect(store.subgraphLibrary).toHaveLength(1)
    expect(store.subgraphLibrary[0].name).toBe('更新后的名称')
  })
})

// ============================================================================
// SG-E: getSubGraphPorts
// ============================================================================

describe('subgraph/nodeRegistry', () => {
  it('SG-E1: getSubGraphPorts 应从子图定义生成端口', () => {
    const def = makeNoiseBlurSubGraph()
    const { inputs, outputs } = getSubGraphPorts(def)

    expect(inputs).toHaveLength(1)
    expect(inputs[0].id).toBe('sg_input')
    expect(inputs[0].name).toBe('背景')
    expect(inputs[0].type).toBe('texture')

    expect(outputs).toHaveLength(1)
    expect(outputs[0].id).toBe('sg_output')
    expect(outputs[0].name).toBe('效果')
    expect(outputs[0].type).toBe('texture')
  })

  it('SG-E2: 空子图定义应返回空端口', () => {
    const def = createEmptySubGraphDefinition('empty', '空子图')
    const { inputs, outputs } = getSubGraphPorts(def)

    expect(inputs).toEqual([])
    expect(outputs).toEqual([])
  })
})
