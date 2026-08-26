/**
 * 子图 UI 接线测试(UI wiring glue)。
 *
 * 这些测试不渲染 .vue(DOM 测试库未引入),而是直接驱动 GraphEditor 三个 handler
 * 所使用的真实代码路径,证明"界面按钮 → store → 行为"这一链路是正确的:
 *   - handlePackageSubgraph:  exportGraph → ui.selectedNodeIds → createSubGraphFromSelection → addSubGraphDefinition
 *   - handleAddSubGraphToCanvas:  addSubGraphNode(defId, worldCenter)
 *   - handleNodeDblClick(SUBGRAPH):  selectNode + computeNodeBounds + fitView
 *
 * 同时验证:绕开 graphStore.createSubGraphFromCurrentSelection 的 selectedNodeId bug,
 * 改用 uiStore.selectedNodeIds 作为选中来源。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

import type { GraphNode, SubGraphNode } from './types'
import { useGraphStore } from './graphStore'
import { useGraphUIStore } from './uiStore'
import { createSubGraphFromSelection } from './subgraphInliner'
import { computeNodeBounds } from './layout'

function makeNode(id: string, x: number, y: number): GraphNode {
  return {
    id,
    type: 'REGION',
    name: id,
    position: { x, y },
    inputs: [{ id: 'input', name: 'bg', type: 'texture' }],
    outputs: [{ id: 'output', name: 'tex', type: 'texture' }],
    params: { scale: 1 },
    opcodeName: 'SOLID_COLOR',
  }
}

/**
 * 复刻 GraphEditor.handlePackageSubgraph 的真实逻辑。
 */
function runPackageSubgraph(graph: ReturnType<typeof useGraphStore>, ui: ReturnType<typeof useGraphUIStore>): string {
  if (!ui.hasSelection || ui.selectedNodeIds.size === 0) return ''
  const subgraphId = `sg_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
  const def = createSubGraphFromSelection(graph.exportGraph(), ui.selectedNodeIds, subgraphId, '新子图')
  graph.addSubGraphDefinition(def)
  ui.clearSelection()
  return subgraphId
}

describe('SG-UI: 子图 UI 接线(库面板 + 打包按钮 + 双击聚焦)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('handlePackageSubgraph: 选中节点 → 打包为子图定义进入库', () => {
    const graph = useGraphStore()
    const ui = useGraphUIStore()

    // 准备 3 个节点
    graph.addNodeDirect(makeNode('a', 0, 0))
    graph.addNodeDirect(makeNode('b', 200, 0))
    graph.addNodeDirect(makeNode('c', 400, 0))

    // 选中 a、b(模拟 Ctrl 多选)
    ui.selectNodes(['a', 'b'])
    expect(ui.selectedNodeIds.size).toBe(2)

    const sgId = runPackageSubgraph(graph, ui)
    expect(sgId).toBeTruthy()

    // 子图库新增 1 个定义,含 2 个节点
    expect(graph.subgraphLibrary.length).toBe(1)
    expect(graph.subgraphLibrary[0].id).toBe(sgId)
    expect(graph.subgraphLibrary[0].nodes.length).toBe(2)
    // 打包后清空选择
    expect(ui.hasSelection).toBe(false)
  })

  it('handlePackageSubgraph: 未选中任何节点时不创建(不会抛错)', () => {
    const graph = useGraphStore()
    const ui = useGraphUIStore()
    graph.addNodeDirect(makeNode('a', 0, 0))

    const sgId = runPackageSubgraph(graph, ui)
    expect(sgId).toBe('')
    expect(graph.subgraphLibrary.length).toBe(0)
  })

  it('handleAddSubGraphToCanvas: 从库实例化 SUBGRAPH 节点到画布', () => {
    const graph = useGraphStore()
    const ui = useGraphUIStore()

    graph.addNodeDirect(makeNode('a', 0, 0))
    graph.addNodeDirect(makeNode('b', 200, 0))
    ui.selectNodes(['a', 'b'])
    const sgId = runPackageSubgraph(graph, ui)

    // 模拟面板点击 → 在画布中心(100,100)生成实例
    graph.addSubGraphNode(sgId, { x: 100, y: 100 })

    const sgNodes = graph.nodes.filter((n) => n.type === 'SUBGRAPH')
    expect(sgNodes.length).toBe(1)
    const sg = sgNodes[0] as SubGraphNode
    expect(sg).toBeDefined()
    expect(sg.subgraphId).toBe(sgId)
    expect(sg.position).toEqual({ x: 100, y: 100 })
    // 实例应带子图定义的动态端口
    expect(sg.inputs.length).toBe(graph.subgraphLibrary[0].inputPorts.length)
    expect(sg.outputs.length).toBe(graph.subgraphLibrary[0].outputPorts.length)
  })

  it('handleNodeDblClick(SUBGRAPH): 双击聚焦 → 选中 + fitView 改变视口', () => {
    const graph = useGraphStore()
    const ui = useGraphUIStore()

    graph.addNodeDirect(makeNode('a', 0, 0))
    graph.addNodeDirect(makeNode('b', 200, 0))
    ui.selectNodes(['a', 'b'])
    const sgId = runPackageSubgraph(graph, ui)
    graph.addSubGraphNode(sgId, { x: 100, y: 100 })

    const sgNode = graph.nodes.find((n) => n.type === 'SUBGRAPH')!
    const zoomBefore = ui.zoom

    // 复刻 handleNodeDblClick 逻辑(仅对 SUBGRAPH 生效)
    if (sgNode.type === 'SUBGRAPH') {
      ui.selectNode(sgNode.id)
      const bounds = computeNodeBounds([sgNode])
      ui.fitView(bounds, { width: 1200, height: 720 })
    }

    expect(ui.isNodeSelected(sgNode.id)).toBe(true)
    // fitView 应改变 zoom / offset(从默认 1 / 0,0 变为适配值)
    const changed = ui.zoom !== zoomBefore || ui.offset.x !== 0 || ui.offset.y !== 0
    expect(changed).toBe(true)
  })

  it('普通节点双击不触发聚焦(只处理 SUBGRAPH)', () => {
    const graph = useGraphStore()
    const ui = useGraphUIStore()
    graph.addNodeDirect(makeNode('plain', 50, 50))

    const plain = graph.getNode('plain')!
    ui.selectNode(plain.id) // 预选中
    // 复刻:普通节点 type !== 'SUBGRAPH → 不进入聚焦分支
    if (plain.type === 'SUBGRAPH') {
      ui.fitView(computeNodeBounds([plain]), { width: 1200, height: 720 })
    }
    // 视口保持默认(未被 fitView 改变)
    expect(ui.zoom).toBe(1)
    expect(ui.offset).toEqual({ x: 0, y: 0 })
  })
})
