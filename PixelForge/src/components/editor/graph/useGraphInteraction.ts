/**
 * useGraphInteraction(Step 27.5)— 节点图交互 Hook。
 *
 * 职责:
 * - 把鼠标/滚轮事件转换为 uiStore / graphStore / graphHistory 的状态变更
 * - 屏蔽 DOM 事件细节,让 GraphEditor.vue 只关心组合
 *
 * 交互模式:
 * - 滚轮:                  缩放(以鼠标位置为中心)
 * - 拖动空白区域:           平移画布
 * - 拖动节点 header:        移动节点(单选 / 多选时批量移动)
 * - mousedown 输出端口:     开始连线
 * - mousemove(连线中):      更新临时连线终点
 * - mouseup 在输入端口:      完成连线(创建 edge)
 * - 右键画布:               打开节点搜索菜单
 *
 * 坐标转换:
 * - screen → world: world = (screen - canvasRect.left - offset) / zoom
 * - 所有 graphStore 的 position 都是 world 坐标
 * - uiStore.offset / zoom 是 viewport 参数
 */

import { onBeforeUnmount, ref, type Ref } from 'vue'

import { useGraphStore } from '@/graph/graphStore'
import { useGraphUIStore } from '@/graph/uiStore'
import {
  ConnectCommand,
  MoveNodeCommand,
  useGraphHistoryStore,
} from '@/graph/graphHistory'
import type { NodePosition } from '@/graph/types'

/** 拖动状态(单节点) */
interface DragState {
  nodeId: string
  /** 鼠按下时,鼠标在节点内的偏移(world 系) */
  offsetInNode: { x: number; y: number }
  /** 鼠按下时,节点的旧位置(用于 history 记录) */
  oldPosition: NodePosition
}

/**
 * Graph 交互 Hook。
 *
 * @param canvasEl 画布 DOM 元素引用(用于 getBoundingClientRect)
 */
export function useGraphInteraction(canvasEl: Ref<HTMLElement | null>) {
  const graph = useGraphStore()
  const ui = useGraphUIStore()
  const history = useGraphHistoryStore()

  const dragState = ref<DragState | null>(null)

  // —— 坐标转换 ——

  /**
   * screen(客户端)坐标 → world(画布)坐标。
   */
  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasEl.value?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const screenX = clientX - rect.left
    const screenY = clientY - rect.top
    return {
      x: (screenX - ui.offset.x) / ui.zoom,
      y: (screenY - ui.offset.y) / ui.zoom,
    }
  }

  // —— 滚轮缩放 ——

  function handleWheel(e: WheelEvent): void {
    e.preventDefault()
    const rect = canvasEl.value?.getBoundingClientRect()
    if (!rect) return

    // 鼠标相对于画布的 screen 坐标
    const center = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }

    // deltaY < 0(向上滚)放大,> 0(向下滚)缩小
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    ui.zoomBy(delta, center)
  }

  // —— 画布平移(在空白处 mousedown)——

  function handleCanvasMouseDown(e: MouseEvent): void {
    // 仅左键 + 点击空白处(非节点 / 非端口 / 非 edge)
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (!isCanvasBackground(target)) return

    // 取消选中 + 取消连线
    ui.clearSelection()
    if (ui.connecting) {
      ui.cancelConnecting()
    }

    ui.isPanning = true
    const startX = e.clientX
    const startY = e.clientY
    const startOffsetX = ui.offset.x
    const startOffsetY = ui.offset.y

    const onMove = (ev: MouseEvent) => {
      if (!ui.isPanning) return
      ui.setOffset(
        startOffsetX + (ev.clientX - startX),
        startOffsetY + (ev.clientY - startY),
      )
    }
    const onUp = () => {
      ui.isPanning = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // —— 右键菜单 ——

  function handleContextMenu(e: MouseEvent): void {
    e.preventDefault()
    const rect = canvasEl.value?.getBoundingClientRect()
    if (!rect) return
    ui.openNodeMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  // —— 节点拖动 ——

  /**
   * 开始拖动节点(由 GraphNode.vue 的 header mousedown 触发)。
   *
   * @param nodeId  节点 ID
   * @param clientX 鼠标 client 坐标
   * @param clientY
   */
  function startNodeDrag(nodeId: string, clientX: number, clientY: number): void {
    const node = graph.getNode(nodeId)
    if (!node) return

    // 选中节点(若未选中)
    if (!ui.isNodeSelected(nodeId)) {
      if (ui.selectedNodeIds.size <= 1) {
        ui.selectNode(nodeId)
      }
    }

    const world = screenToWorld(clientX, clientY)
    dragState.value = {
      nodeId,
      offsetInNode: {
        x: world.x - node.position.x,
        y: world.y - node.position.y,
      },
      oldPosition: { ...node.position },
    }
    ui.isDragging = true

    // 注册全局 mousemove / mouseup
    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', handleDragEnd)
  }

  function handleDragMove(e: MouseEvent): void {
    if (!dragState.value) return
    const world = screenToWorld(e.clientX, e.clientY)
    const newX = world.x - dragState.value.offsetInNode.x
    const newY = world.y - dragState.value.offsetInNode.y
    // 实时更新位置(不入 history,拖动结束时才入栈)
    graph.updateNodePosition(dragState.value.nodeId, { x: newX, y: newY })
  }

  function handleDragEnd(): void {
    if (!dragState.value) return

    const node = graph.getNode(dragState.value.nodeId)
    if (node) {
      // 仅在位置真正变化时入栈(避免点击不拖动也产生历史)
      const moved =
        node.position.x !== dragState.value.oldPosition.x ||
        node.position.y !== dragState.value.oldPosition.y
      if (moved) {
        history.execute(
          new MoveNodeCommand(
            dragState.value.nodeId,
            dragState.value.oldPosition,
            { ...node.position },
            graph,
          ),
        )
      }
    }

    dragState.value = null
    ui.isDragging = false
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', handleDragEnd)
  }

  // —— 端口连线 ——

  /**
   * 开始连线(mousedown 在输出端口)。
   */
  function startConnecting(
    nodeId: string,
    portId: string,
    clientX: number,
    clientY: number,
  ): void {
    const world = screenToWorld(clientX, clientY)
    ui.startConnecting(nodeId, portId, world)

    window.addEventListener('mousemove', handleConnectingMove)
    window.addEventListener('mouseup', handleConnectingEnd)
  }

  function handleConnectingMove(e: MouseEvent): void {
    if (!ui.connecting) return
    const world = screenToWorld(e.clientX, e.clientY)
    ui.updateConnectingPosition(world)
  }

  function handleConnectingEnd(e?: MouseEvent): void {
    // 检查是否落在输入端口上
    if (e && ui.connecting) {
      const target = e.target as HTMLElement
      const portData = target?.dataset
      if (
        portData?.portDirection === 'input' &&
        portData.portNodeId &&
        portData.portId
      ) {
        // 完成连线
        const result = graph.connect(
          ui.connecting.fromNodeId,
          ui.connecting.fromPortId,
          portData.portNodeId,
          portData.portId,
        )
        if (result.ok && result.edgeId) {
          // 入 history
          history.execute(
            new ConnectCommand(
              ui.connecting.fromNodeId,
              ui.connecting.fromPortId,
              portData.portNodeId,
              portData.portId,
              graph,
            ),
          )
        }
      }
    }
    ui.cancelConnecting()
    window.removeEventListener('mousemove', handleConnectingMove)
    window.removeEventListener('mouseup', handleConnectingEnd)
  }

  // —— 辅助 ——

  /** 判断点击是否落在画布背景(非节点 / 端口 / edge)上 */
  function isCanvasBackground(target: HTMLElement): boolean {
    return (
      target.classList.contains('graph-canvas') ||
      target.classList.contains('graph-world') ||
      target.classList.contains('graph-canvas-inner')
    )
  }

  // —— 生命周期 ——

  onBeforeUnmount(() => {
    // 清理所有未完成的交互
    dragState.value = null
    ui.isDragging = false
    ui.isPanning = false
    ui.cancelConnecting()
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', handleDragEnd)
    window.removeEventListener('mousemove', handleConnectingMove)
    window.removeEventListener('mouseup', handleConnectingEnd)
  })

  return {
    // 坐标转换
    screenToWorld,
    // 事件处理
    handleWheel,
    handleCanvasMouseDown,
    handleContextMenu,
    // 节点拖动
    startNodeDrag,
    // 端口连线
    startConnecting,
  }
}
