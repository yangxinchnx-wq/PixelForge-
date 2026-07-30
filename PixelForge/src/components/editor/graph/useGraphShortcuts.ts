/**
 * useGraphShortcuts(Step 27.16)— Graph Editor 专用快捷键。
 *
 * 与全局 useKeyboardShortcuts 的分工:
 * - 全局:Space(播放)/ ←→(帧)/ Home/End(timeline)—— 这些在任何地方都生效
 * - 本 composable:仅在 GraphEditor 可见时生效
 *   - Delete / Backspace:  删除选中节点 / 边(入 graphHistory)
 *   - F:                    适应视图(fit view)
 *   - Esc:                  取消连线 / 取消选中 / 关闭节点菜单
 *   - Ctrl/Cmd + D:         复制选中节点(入 graphHistory)
 *   - Ctrl/Cmd + Z:         graphHistory.undo()(GraphEditor 可见时拦截)
 *   - Ctrl/Cmd + Shift+Z:   graphHistory.redo()
 *   - Ctrl/Cmd + Y:         graphHistory.redo()
 *
 * 拦截机制:
 * - 用 capture phase 监听,先于全局 listener 执行
 * - 命中后调用 stopImmediatePropagation() 阻止全局 listener 二次处理
 *   (避免 Ctrl+Z 同时触发 graphHistory.undo 和 stores/history.undo)
 *
 * 用法:
 *   import { useGraphShortcuts } from './useGraphShortcuts'
 *   useGraphShortcuts()  // 在 GraphEditor.vue 的 setup 中调用
 */

import { onBeforeUnmount, onMounted } from 'vue'

import { useGraphStore } from '@/graph/graphStore'
import { useGraphUIStore } from '@/graph/uiStore'
import {
  AddNodeCommand,
  DisconnectCommand,
  RemoveNodeCommand,
  useGraphHistoryStore,
} from '@/graph/graphHistory'
import { computeNodeBounds } from '@/graph/layout'
import type { GraphNode } from '@/graph/types'

/** 节点复制时的偏移(避免完全重叠) */
const DUPLICATE_OFFSET = 24

/**
 * Graph 快捷键 composable。
 *
 * 必须在 GraphEditor.vue 的 setup 中调用(依赖 onMounted/onBeforeUnmount 生命周期)。
 */
export function useGraphShortcuts(): void {
  const graph = useGraphStore()
  const ui = useGraphUIStore()
  const history = useGraphHistoryStore()

  /** 判断事件目标是否在可编辑控件内(input/textarea/select/contenteditable) */
  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    if (target.isContentEditable) return true
    return false
  }

  /**
   * 删除所有选中节点 + 选中边(入 graphHistory)。
   */
  function deleteSelected(): void {
    // 优先删除选中节点(同时会移除关联 edge)
    const nodeIds = Array.from(ui.selectedNodeIds)
    const edgeIds = Array.from(ui.selectedEdgeIds)

    if (nodeIds.length === 0 && edgeIds.length === 0) return

    // 删除节点:为每个节点创建 RemoveNodeCommand(快照节点 + 关联 edge)
    for (const nodeId of nodeIds) {
      const node = graph.getNode(nodeId)
      if (!node) continue
      const relatedEdges = [
        ...graph.getIncomingEdges(nodeId),
        ...graph.getOutgoingEdges(nodeId),
      ]
      history.execute(new RemoveNodeCommand(node, relatedEdges, graph))
    }

    // 删除孤立选中边(不关联已删节点的)
    for (const edgeId of edgeIds) {
      const edge = graph.edges.find((e) => e.id === edgeId)
      if (!edge) continue
      // 跳过已被节点删除连带移除的 edge
      if (nodeIds.includes(edge.from) || nodeIds.includes(edge.to)) continue
      history.execute(new DisconnectCommand(edge, graph))
    }

    ui.clearSelection()
  }

  /**
   * 适应视图:把所有节点居中并缩放到合适大小。
   */
  function fitView(): void {
    if (graph.nodes.length === 0) return
    const bounds = computeNodeBounds(graph.nodes)
    // 使用画布 DOM 的尺寸(由 GraphEditor 通过 ui 传入或读取)
    // 这里简化:用一个合理的默认值,实际尺寸由 GraphEditor 在调用时覆盖
    const canvasEl = document.querySelector('.graph-canvas') as HTMLElement | null
    const viewportSize = canvasEl
      ? { width: canvasEl.clientWidth, height: canvasEl.clientHeight }
      : { width: 1200, height: 720 }
    ui.fitView(bounds, viewportSize)
  }

  /**
   * 取消当前交互:优先级 菜单 > 连线 > 选中。
   */
  function cancelInteraction(): void {
    if (ui.nodeMenuVisible) {
      ui.closeNodeMenu()
      return
    }
    if (ui.connecting) {
      ui.cancelConnecting()
      return
    }
    if (ui.hasSelection) {
      ui.clearSelection()
      return
    }
  }

  /**
   * 复制选中节点(单选时)。
   * 在原节点位置偏移 DUPLICATE_OFFSET 处创建同类型新节点。
   *
   * 实现说明:
   * - 不预先调用 addNodeDirect(避免与 AddNodeCommand.execute 重复添加)
   * - 本地生成新 id,构造完整 GraphNode,交给 AddNodeCommand 一次性执行
   */
  function duplicateSelected(): void {
    const selectedIds = Array.from(ui.selectedNodeIds)
    if (selectedIds.length === 0) return

    const newIds: string[] = []
    for (const id of selectedIds) {
      const original = graph.getNode(id)
      if (!original) continue
      // 生成新 id(与 graphStore.generateNodeId 格式一致)
      const newId = `dup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const clone: GraphNode = {
        id: newId,
        type: original.type,
        name: original.name,
        position: {
          x: original.position.x + DUPLICATE_OFFSET,
          y: original.position.y + DUPLICATE_OFFSET,
        },
        inputs: original.inputs.map((p) => ({ ...p })),
        outputs: original.outputs.map((p) => ({ ...p })),
        params: { ...original.params },
        opcodeName: original.opcodeName,
        templateKey: original.templateKey,
      }
      // 一次性入栈(AddNodeCommand.execute 会调用 addNodeDirect)
      history.execute(new AddNodeCommand(clone, graph))
      newIds.push(newId)
    }

    if (newIds.length > 0) {
      ui.selectNodes(newIds)
    }
  }

  /** 主事件处理 */
  function onKeyDown(event: KeyboardEvent): void {
    const isMod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    // —— Undo / Redo(GraphEditor 可见时拦截,避免全局 listener 二次处理)——
    if (isMod && key === 'z') {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.shiftKey) {
        history.redo()
      } else {
        history.undo()
      }
      return
    }
    if (isMod && key === 'y') {
      event.preventDefault()
      event.stopImmediatePropagation()
      history.redo()
      return
    }

    // —— 以下快捷键在编辑控件聚焦时不响应 ——
    if (isEditableTarget(event.target)) return

    // Ctrl/Cmd + D → 复制选中
    if (isMod && key === 'd') {
      event.preventDefault()
      event.stopImmediatePropagation()
      duplicateSelected()
      return
    }

    // Delete / Backspace → 删除选中
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault()
      event.stopImmediatePropagation()
      deleteSelected()
      return
    }

    // F → 适应视图
    if (key === 'f') {
      event.preventDefault()
      event.stopImmediatePropagation()
      fitView()
      return
    }

    // Esc → 取消交互
    if (key === 'escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelInteraction()
      return
    }
  }

  onMounted(() => {
    // 使用 capture phase,先于全局 listener 执行
    window.addEventListener('keydown', onKeyDown, true)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown, true)
  })
}
