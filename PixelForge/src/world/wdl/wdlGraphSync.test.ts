/**
 * WDL ↔ Graph 双向同步 Tests(Step 38.4)
 *
 * 测试策略:
 * - wdlToGraph: WDL AST → RenderGraph(节点数/边数/opcode/params/canvas)
 * - graphToWdl: RenderGraph → WDL 源码(可重新解析,round-trip 一致性)
 * - round-trip: WDL → Graph → WDL,验证语义保持
 */
import { describe, it, expect } from 'vitest'
import { wdlSourceToGraph, graphToWdl } from './wdlGraphSync'
import { parse } from './wdlParser'
import type { RenderGraph, GraphNode } from '@/graph/types'

// ============================================================================
// 辅助函数
// ============================================================================

/** 解析 WDL 源码并转为 Graph */
function toGraph(source: string): RenderGraph {
  return wdlSourceToGraph(source)
}

/** 找节点 by name */
function findNode(graph: RenderGraph, name: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.name === name)
}

/** 找节点 by type */
function nodesByType(graph: RenderGraph, type: string): GraphNode[] {
  return graph.nodes.filter((n) => n.type === type)
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL ↔ Graph 双向同步', () => {
  // ==========================================================================
  // wdlToGraph: WDL → Graph
  // ==========================================================================
  describe('wdlToGraph', () => {
    it('W01: 空场景应生成 OUTPUT 节点', () => {
      const graph = toGraph('scene "empty" {}')
      const outputs = nodesByType(graph, 'OUTPUT')
      expect(outputs).toHaveLength(1)
    })

    it('W02: 单个 layer 应生成 REGION 节点', () => {
      const source = `scene "test" {
  layer "bg" {
    opcode: SOLID_COLOR
    color: [1, 0, 0, 1]
  }
}`
      const graph = toGraph(source)
      const regions = nodesByType(graph, 'REGION')
      expect(regions).toHaveLength(1)
      expect(regions[0].name).toBe('bg')
      expect(regions[0].opcodeName).toBe('SOLID_COLOR')
    })

    it('W03: layer params 应正确转换(排除 opcode)', () => {
      const source = `scene "test" {
  layer "bg" {
    opcode: NOISE
    scale: 0.8
    intensity: 0.9
  }
}`
      const graph = toGraph(source)
      const node = findNode(graph, 'bg')
      expect(node).toBeDefined()
      expect(node!.params.scale).toBe(0.8)
      expect(node!.params.intensity).toBe(0.9)
      expect(node!.params).not.toHaveProperty('opcode')
    })

    it('W04: 多个 layer 应生成多个 REGION 节点', () => {
      const source = `scene "test" {
  layer "bg" { opcode: SOLID_COLOR }
  layer "stars" { opcode: NOISE }
}`
      const graph = toGraph(source)
      expect(nodesByType(graph, 'REGION')).toHaveLength(2)
    })

    it('W05: effect 应生成 EFFECT 节点', () => {
      const source = `scene "test" {
  layer "bg" { opcode: SOLID_COLOR }
  effect "vignette1" {
    type: vignette
    target: "bg"
    intensity: 0.6
  }
}`
      const graph = toGraph(source)
      const effects = nodesByType(graph, 'EFFECT')
      expect(effects).toHaveLength(1)
      expect(effects[0].opcodeName).toBe('vignette')
      expect(effects[0].params.intensity).toBe(0.6)
    })

    it('W06: effect target 应生成 edge', () => {
      const source = `scene "test" {
  layer "bg" { opcode: SOLID_COLOR }
  effect "vig" {
    type: vignette
    target: "bg"
  }
}`
      const graph = toGraph(source)
      // 应有 edge: bg → vig
      const effectNode = findNode(graph, 'vig')
      const incomingEdge = graph.edges.find((e) => e.to === effectNode!.id)
      expect(incomingEdge).toBeDefined()
      const bgNode = findNode(graph, 'bg')
      expect(incomingEdge!.from).toBe(bgNode!.id)
    })

    it('W07: region.layers 应生成链式 edges', () => {
      const source = `scene "test" {
  layer "a" { opcode: SOLID_COLOR }
  layer "b" { opcode: NOISE }
  layer "c" { opcode: CIRCLE_SHAPE }
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["a", "b", "c"]
  }
}`
      const graph = toGraph(source)
      // a → b, b → c
      const aNode = findNode(graph, 'a')
      const bNode = findNode(graph, 'b')
      const cNode = findNode(graph, 'c')
      const abEdge = graph.edges.find((e) => e.from === aNode!.id && e.to === bNode!.id)
      const bcEdge = graph.edges.find((e) => e.from === bNode!.id && e.to === cNode!.id)
      expect(abEdge).toBeDefined()
      expect(bcEdge).toBeDefined()
    })

    it('W08: 最后一个 layer 应连接到 OUTPUT', () => {
      const source = `scene "test" {
  layer "bg" { opcode: SOLID_COLOR }
}`
      const graph = toGraph(source)
      const bgNode = findNode(graph, 'bg')
      const outputNode = nodesByType(graph, 'OUTPUT')[0]
      const edge = graph.edges.find((e) => e.from === bgNode!.id && e.to === outputNode.id)
      expect(edge).toBeDefined()
    })

    it('W09: canvas 应正确传递', () => {
      const source = `scene "test" {
  canvas: 800x600
  layer "bg" { opcode: SOLID_COLOR }
}`
      const graph = toGraph(source)
      expect(graph.canvas).toEqual({ width: 800, height: 600 })
    })

    it('W10: 缺省 canvas 应为 1920x1080', () => {
      const graph = toGraph('scene "t" { layer "bg" { opcode: SOLID_COLOR } }')
      expect(graph.canvas).toEqual({ width: 1920, height: 1080 })
    })

    it('W11: 节点应有画布坐标', () => {
      const graph = toGraph('scene "t" { layer "bg" { opcode: SOLID_COLOR } }')
      const node = findNode(graph, 'bg')
      expect(node!.position.x).toBeGreaterThanOrEqual(0)
      expect(node!.position.y).toBeGreaterThanOrEqual(0)
    })

    it('W12: 节点应有输入输出端口', () => {
      const graph = toGraph('scene "t" { layer "bg" { opcode: SOLID_COLOR } }')
      const node = findNode(graph, 'bg')
      expect(node!.inputs.length).toBeGreaterThan(0)
      expect(node!.outputs.length).toBeGreaterThan(0)
    })

    it('W13: color 数组参数应正确转换', () => {
      const source = `scene "test" {
  layer "bg" {
    opcode: SOLID_COLOR
    color: [0.5, 0.2, 0.8, 1.0]
  }
}`
      const graph = toGraph(source)
      const node = findNode(graph, 'bg')
      expect(node!.params.color).toEqual([0.5, 0.2, 0.8, 1.0])
    })
  })

  // ==========================================================================
  // graphToWdl: Graph → WDL
  // ==========================================================================
  describe('graphToWdl', () => {
    it('G01: 空 Graph(仅 OUTPUT)应生成空场景', () => {
      const graph: RenderGraph = {
        nodes: [{ id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} }],
        edges: [],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('scene')
      expect(wdl).toContain('1920x1080')
      // 无 layer 块
      expect(wdl).not.toContain('layer "')
    })

    it('G02: REGION 节点应生成 layer 块', () => {
      const graph: RenderGraph = {
        nodes: [
          {
            id: 'n1', type: 'REGION', name: 'bg', position: { x: 0, y: 0 },
            inputs: [], outputs: [], params: { scale: 0.5 }, opcodeName: 'NOISE',
          },
          { id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} },
        ],
        edges: [],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('layer "bg"')
      expect(wdl).toContain('opcode: NOISE')
      expect(wdl).toContain('scale: 0.5')
    })

    it('G03: EFFECT 节点应生成 effect 块', () => {
      const graph: RenderGraph = {
        nodes: [
          {
            id: 'n1', type: 'REGION', name: 'bg', position: { x: 0, y: 0 },
            inputs: [], outputs: [], params: {}, opcodeName: 'SOLID_COLOR',
          },
          {
            id: 'e1', type: 'EFFECT', name: 'vig', position: { x: 0, y: 0 },
            inputs: [], outputs: [], params: { intensity: 0.6 }, opcodeName: 'vignette',
          },
          { id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} },
        ],
        edges: [{ id: 'n1:output->e1:input', from: 'n1', fromPort: 'output', to: 'e1', toPort: 'input' }],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('effect "vig"')
      expect(wdl).toContain('type: vignette')
      expect(wdl).toContain('intensity: 0.6')
    })

    it('G04: edge 应转为 effect target', () => {
      const graph: RenderGraph = {
        nodes: [
          {
            id: 'n1', type: 'REGION', name: 'bg', position: { x: 0, y: 0 },
            inputs: [], outputs: [], params: {}, opcodeName: 'SOLID_COLOR',
          },
          {
            id: 'e1', type: 'EFFECT', name: 'vig', position: { x: 0, y: 0 },
            inputs: [], outputs: [], params: {}, opcodeName: 'vignette',
          },
          { id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} },
        ],
        edges: [{ id: 'n1:output->e1:input', from: 'n1', fromPort: 'output', to: 'e1', toPort: 'input' }],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('target: "bg"')
    })

    it('G05: region 块应包含所有 layer 名称', () => {
      const graph: RenderGraph = {
        nodes: [
          { id: 'n1', type: 'REGION', name: 'a', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {}, opcodeName: 'SOLID_COLOR' },
          { id: 'n2', type: 'REGION', name: 'b', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {}, opcodeName: 'NOISE' },
          { id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} },
        ],
        edges: [],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('region "main"')
      expect(wdl).toContain('"a"')
      expect(wdl).toContain('"b"')
    })

    it('G06: canvas 应正确输出', () => {
      const graph: RenderGraph = {
        nodes: [{ id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} }],
        edges: [],
        canvas: { width: 1280, height: 720 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('1280x720')
    })

    it('G07: 数组参数应正确序列化', () => {
      const graph: RenderGraph = {
        nodes: [
          {
            id: 'n1', type: 'REGION', name: 'bg', position: { x: 0, y: 0 },
            inputs: [], outputs: [], params: { color: [1, 0, 0, 1] }, opcodeName: 'SOLID_COLOR',
          },
          { id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} },
        ],
        edges: [],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      expect(wdl).toContain('color: [1, 0, 0, 1]')
    })

    it('G08: 生成的 WDL 应可重新解析', () => {
      const graph: RenderGraph = {
        nodes: [
          { id: 'n1', type: 'REGION', name: 'bg', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: { scale: 0.5 }, opcodeName: 'NOISE' },
          { id: 'out', type: 'OUTPUT', name: '输出', position: { x: 0, y: 0 }, inputs: [], outputs: [], params: {} },
        ],
        edges: [],
        canvas: { width: 1920, height: 1080 },
      }
      const wdl = graphToWdl(graph)
      // 应能成功解析
      expect(() => parse(wdl)).not.toThrow()
    })
  })

  // ==========================================================================
  // Round-trip: WDL → Graph → WDL
  // ==========================================================================
  describe('round-trip', () => {
    it('R01: 简单场景 round-trip 应保持语义', () => {
      const original = `scene "test" {
  canvas: 1920x1080
  layer "bg" {
    opcode: SOLID_COLOR
    color: [1, 0, 0, 1]
  }
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg"]
  }
}`
      const graph = toGraph(original)
      const wdl = graphToWdl(graph)
      // 重新解析
      const ast = parse(wdl)
      expect(ast.canvas).toEqual({ width: 1920, height: 1080 })
      expect(ast.layers).toHaveLength(1)
      expect(ast.layers[0].name).toBe('bg')
    })

    it('R02: 多 layer round-trip 应保持节点数', () => {
      const original = `scene "test" {
  layer "a" { opcode: SOLID_COLOR }
  layer "b" { opcode: NOISE }
  layer "c" { opcode: CIRCLE_SHAPE }
}`
      const graph = toGraph(original)
      const wdl = graphToWdl(graph)
      const ast = parse(wdl)
      expect(ast.layers).toHaveLength(3)
    })

    it('R03: effect round-trip 应保持 type 和 target', () => {
      const original = `scene "test" {
  layer "bg" { opcode: SOLID_COLOR }
  effect "vig" {
    type: vignette
    target: "bg"
  }
}`
      const graph = toGraph(original)
      const wdl = graphToWdl(graph)
      const ast = parse(wdl)
      expect(ast.effects).toHaveLength(1)
      expect(ast.effects[0].name).toBe('vig')
      // 验证 type 参数
      const typeParam = ast.effects[0].params.find((p) => p.key === 'type')
      expect(typeParam).toBeDefined()
    })

    it('R04: canvas round-trip 应保持尺寸', () => {
      const original = `scene "test" {
  canvas: 800x600
  layer "bg" { opcode: SOLID_COLOR }
}`
      const graph = toGraph(original)
      const wdl = graphToWdl(graph)
      const ast = parse(wdl)
      expect(ast.canvas).toEqual({ width: 800, height: 600 })
    })
  })
})
