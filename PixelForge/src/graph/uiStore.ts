/**
 * Graph UI Store(Step 27.2)— 节点图编辑器的 UI 交互状态。
 *
 * 与 graphStore 的职责分离:
 * - graphStore: 数据层(nodes / edges / canvas / validation)
 * - uiStore:    交互层(zoom / offset / 选中 / 连线中 / 菜单)
 *
 * 分离原因:
 * - 数据层变更需要进入 graphHistory(undo/redo)
 * - 交互层变更是临时状态,不入历史(如拖动中的临时位置)
 * - 两者生命周期不同:数据持久化,交互层在编辑器关闭时重置
 *
 * 状态分类:
 * - 视口(viewport): zoom / offset(决定 world→screen 变换)
 * - 选择(selection): selectedNodeIds(多选)/ selectedEdgeIds
 * - 交互(interaction): connecting / dragging / panning / marquee
 * - 菜单(menu): nodeMenuVisible / nodeMenuPosition / searchQuery
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * 视口状态(无限画布的相机)。
 *
 * 变换公式:
 *   screen = (world + offset) × zoom
 *
 * 反变换(鼠标坐标 → 世界坐标):
 *   world = screen / zoom - offset
 */
export interface Viewport {
  /** 缩放系数(1.0 = 100%,0.5 = 缩小到一半,2.0 = 放大两倍) */
  zoom: number
  /** 画布偏移(像素,screen 系) */
  offset: { x: number; y: number }
}

/**
 * 连线交互状态。
 * - from: 起始节点 + 端口(用户 mousedown 的输出端口)
 * - to: 鼠标当前位置(临时连线的终点,world 系)
 */
export interface ConnectingState {
  fromNodeId: string
  fromPortId: string
  /** 临时连线的当前终点(world 坐标,随鼠标移动) */
  currentPos: { x: number; y: number }
}

/**
 * Graph UI Store 主接口。
 */
export const useGraphUIStore = defineStore('graphUI', () => {
  // —— 视口状态 ——
  const zoom = ref(1)
  const offset = ref({ x: 0, y: 0 })

  /** zoom 限制(避免过度缩放导致交互异常) */
  const MIN_ZOOM = 0.2
  const MAX_ZOOM = 3.0

  // —— 选择状态(支持多选)——
  const selectedNodeIds = ref<Set<string>>(new Set())
  const selectedEdgeIds = ref<Set<string>>(new Set())

  // —— 交互状态 ——
  const connecting = ref<ConnectingState | null>(null)
  const isDragging = ref(false)
  const isPanning = ref(false)

  // —— 节点搜索菜单 ——
  const nodeMenuVisible = ref(false)
  const nodeMenuPosition = ref({ x: 0, y: 0 })  // screen 坐标
  const searchQuery = ref('')

  // —— Getters ——
  const viewport = computed<Viewport>(() => ({
    zoom: zoom.value,
    offset: { ...offset.value },
  }))

  const selectedNodeCount = computed(() => selectedNodeIds.value.size)
  const selectedEdgeCount = computed(() => selectedEdgeIds.value.size)
  const hasSelection = computed(
    () => selectedNodeIds.value.size > 0 || selectedEdgeIds.value.size > 0,
  )

  /** 单选时的当前节点(便于 Inspector / 快捷键使用) */
  const primarySelectedNodeId = computed<string | null>(() => {
    if (selectedNodeIds.value.size === 0) return null
    return Array.from(selectedNodeIds.value)[0]
  })

  // —— Actions: 视口 ——

  /**
   * 设置 zoom(自动 clamp 到 [MIN_ZOOM, MAX_ZOOM])。
   */
  function setZoom(next: number): void {
    zoom.value = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
  }

  /**
   * 以指定点为中心缩放(保持该点的 screen 坐标不变)。
   *
   * 数学推导:
   *   缩放前:screen = (world + offset) × zoom
   *   缩放后:screen = (world + offset') × zoom'
   *   要求 screen 不变:offset' = screen / zoom' - world
   *                            = (world + offset) × zoom / zoom' - world
   *                            = offset × zoom / zoom' + world × (zoom / zoom' - 1)
   *
   * @param nextZoom 目标 zoom
   * @param center   缩放中心(screen 坐标,通常是鼠标位置)
   */
  function zoomAt(nextZoom: number, center: { x: number; y: number }): void {
    const oldZoom = zoom.value
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
    if (newZoom === oldZoom) return

    const ratio = newZoom / oldZoom
    offset.value = {
      x: center.x - (center.x - offset.value.x) * ratio,
      y: center.y - (center.y - offset.value.y) * ratio,
    }
    zoom.value = newZoom
  }

  /**
   * 相对缩放(以指定点为中心,delta 为缩放倍率变化量)。
   */
  function zoomBy(delta: number, center: { x: number; y: number }): void {
    zoomAt(zoom.value * (1 + delta), center)
  }

  /**
   * 平移画布(相对偏移)。
   */
  function panBy(dx: number, dy: number): void {
    offset.value = { x: offset.value.x + dx, y: offset.value.y + dy }
  }

  /**
   * 设置绝对偏移。
   */
  function setOffset(x: number, y: number): void {
    offset.value = { x, y }
  }

  /**
   * 重置视口到默认状态(zoom=1, offset=0)。
   */
  function resetViewport(): void {
    zoom.value = 1
    offset.value = { x: 0, y: 0 }
  }

  /**
   * 居中并缩放以适应给定的世界坐标范围(fit view)。
   *
   * @param bounds   世界坐标范围 { minX, minY, maxX, maxY }
   * @param viewportSize 视口尺寸 { width, height }(screen 系)
   * @param padding  边距(像素,screen 系)
   */
  function fitView(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    viewportSize: { width: number; height: number },
    padding = 60,
  ): void {
    const bw = bounds.maxX - bounds.minX
    const bh = bounds.maxY - bounds.minY
    if (bw <= 0 || bh <= 0) return

    const availW = viewportSize.width - padding * 2
    const availH = viewportSize.height - padding * 2
    if (availW <= 0 || availH <= 0) return

    const nextZoom = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min(availW / bw, availH / bh)),
    )
    const cx = (bounds.minX + bounds.maxX) / 2
    const cy = (bounds.minY + bounds.maxY) / 2

    zoom.value = nextZoom
    offset.value = {
      x: viewportSize.width / 2 - cx * nextZoom,
      y: viewportSize.height / 2 - cy * nextZoom,
    }
  }

  // —— Actions: 选择 ——

  /**
   * 单选节点(清除其他选择)。
   */
  function selectNode(id: string): void {
    selectedNodeIds.value = new Set([id])
    selectedEdgeIds.value = new Set()
  }

  /**
   * 切换节点的选中状态(用于 Ctrl+Click 多选)。
   */
  function toggleNodeSelection(id: string): void {
    const next = new Set(selectedNodeIds.value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    selectedNodeIds.value = next
  }

  /**
   * 多选节点(批量添加)。
   */
  function selectNodes(ids: string[]): void {
    selectedNodeIds.value = new Set(ids)
    selectedEdgeIds.value = new Set()
  }

  function selectEdge(id: string): void {
    selectedEdgeIds.value = new Set([id])
    selectedNodeIds.value = new Set()
  }

  function clearSelection(): void {
    selectedNodeIds.value = new Set()
    selectedEdgeIds.value = new Set()
  }

  function isNodeSelected(id: string): boolean {
    return selectedNodeIds.value.has(id)
  }

  function isEdgeSelected(id: string): boolean {
    return selectedEdgeIds.value.has(id)
  }

  // —— Actions: 连线交互 ——

  /**
   * 开始连线(用户 mousedown 输出端口时调用)。
   */
  function startConnecting(nodeId: string, portId: string, startPos: { x: number; y: number }): void {
    connecting.value = {
      fromNodeId: nodeId,
      fromPortId: portId,
      currentPos: startPos,
    }
  }

  /**
   * 更新临时连线终点(mousemove 时调用)。
   */
  function updateConnectingPosition(pos: { x: number; y: number }): void {
    if (connecting.value) {
      connecting.value.currentPos = pos
    }
  }

  /**
   * 取消连线(Esc 或点击空白时调用)。
   */
  function cancelConnecting(): void {
    connecting.value = null
  }

  // —— Actions: 节点菜单 ——

  /**
   * 打开节点搜索菜单(右键或 Tab 时调用)。
   *
   * @param screenPos 鼠标在屏幕上的坐标(用于菜单定位)
   */
  function openNodeMenu(screenPos: { x: number; y: number }): void {
    nodeMenuVisible.value = true
    nodeMenuPosition.value = screenPos
    searchQuery.value = ''
  }

  function closeNodeMenu(): void {
    nodeMenuVisible.value = false
    searchQuery.value = ''
  }

  // —— Actions: 全局重置 ——

  /**
   * 重置所有 UI 状态(关闭编辑器时调用)。
   */
  function resetAll(): void {
    resetViewport()
    selectedNodeIds.value = new Set()
    selectedEdgeIds.value = new Set()
    connecting.value = null
    isDragging.value = false
    isPanning.value = false
    nodeMenuVisible.value = false
    searchQuery.value = ''
  }

  return {
    // state
    zoom,
    offset,
    selectedNodeIds,
    selectedEdgeIds,
    connecting,
    isDragging,
    isPanning,
    nodeMenuVisible,
    nodeMenuPosition,
    searchQuery,
    // getters
    viewport,
    selectedNodeCount,
    selectedEdgeCount,
    hasSelection,
    primarySelectedNodeId,
    // viewport actions
    setZoom,
    zoomAt,
    zoomBy,
    panBy,
    setOffset,
    resetViewport,
    fitView,
    // selection actions
    selectNode,
    toggleNodeSelection,
    selectNodes,
    selectEdge,
    clearSelection,
    isNodeSelected,
    isEdgeSelected,
    // connecting actions
    startConnecting,
    updateConnectingPosition,
    cancelConnecting,
    // menu actions
    openNodeMenu,
    closeNodeMenu,
    // reset
    resetAll,
  }
})
