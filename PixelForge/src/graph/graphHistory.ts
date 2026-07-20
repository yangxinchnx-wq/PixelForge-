/**
 * Graph History(Step 27.15)— Graph 编辑操作的 Undo/Redo。
 *
 * 与 stores/history.ts 的区别:
 * - history.ts:  值级 Patch(targetId + paramKey + value),紧耦合 runtime.applyValuePatch
 * - graphHistory: 结构级 Command(添加节点 / 删除节点 / 连接 / 移动),独立栈
 *
 * 两者完全独立,各自维护 undo/redo 栈,互不干扰。
 * Ctrl+Z 在 GraphEditor 可见时优先消费 graphHistory(由快捷键 composable 决定)。
 *
 * Command 接口:
 *   interface GraphCommand {
 *     description: string         // 可读描述(用于 UI 显示)
 *     execute(): void             // 执行(apply)
 *     undo(): void                // 撤销(rollback)
 *   }
 *
 * 已实现的 Command:
 * - AddNodeCommand:        添加节点(undo = 删除)
 * - RemoveNodeCommand:     删除节点 + 关联边(undo = 恢复节点 + 边)
 * - ConnectCommand:        连接两个端口(undo = 断开)
 * - DisconnectCommand:     断开连接(undo = 重新连接)
 * - MoveNodeCommand:       移动节点位置(拖动结束时入栈,合并 500ms 内同节点的连续移动)
 * - UpdateNodeParamsCommand: 修改节点参数(Inspector 编辑)
 * - AutoLayoutCommand:     自动布局(批量移动,undo = 恢复全部旧位置)
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { GraphEdge, GraphNode, NodePosition } from './types'
import { useGraphStore } from './graphStore'

// ============================================================================
// Command 接口
// ============================================================================

/**
 * Graph 编辑命令(结构级操作的原子单元)。
 *
 * 每个 Command 必须满足:
 * - execute() 与 undo() 互为逆操作
 * - execute() 后可多次调用 undo()→execute() 来回切换(redo = 再 execute)
 * - 不直接操作 DOM,只改 graphStore 状态
 */
export interface GraphCommand {
  /** 可读描述(用于历史面板 UI) */
  description: string
  /** 时间戳(用于合并窗口判断) */
  timestamp: number
  /** 执行(初次调用或 redo) */
  execute(): void
  /** 撤销 */
  undo(): void
}

// ============================================================================
// 具体 Command 实现
// ============================================================================

/**
 * 添加节点命令。
 *
 * execute: 调用 graphStore.addNodeDirect(节点)
 * undo:    调用 graphStore.removeNode(节点 id)
 *
 * 注意:节点 id 在创建时确定,undo 后再 redo 时复用同一 id(保持稳定)。
 */
export class AddNodeCommand implements GraphCommand {
  description: string
  timestamp: number
  private node: GraphNode
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(node: GraphNode, graphStore: ReturnType<typeof useGraphStore>) {
    this.node = node
    this.graphStore = graphStore
    this.description = `添加节点: ${node.name}`
    this.timestamp = Date.now()
  }

  execute(): void {
    this.graphStore.addNodeDirect({ ...this.node })
  }

  undo(): void {
    this.graphStore.removeNode(this.node.id)
  }
}

/**
 * 删除节点命令。
 *
 * execute: removeNode(id) — 同时会移除关联的 edge
 * undo:    addNodeDirect(node) + 恢复所有关联 edge
 *
 * 注意:需要在构造时快照节点 + 关联 edge(因为 removeNode 会丢弃它们)。
 */
export class RemoveNodeCommand implements GraphCommand {
  description: string
  timestamp: number
  private node: GraphNode
  private relatedEdges: GraphEdge[]
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(
    node: GraphNode,
    relatedEdges: GraphEdge[],
    graphStore: ReturnType<typeof useGraphStore>,
  ) {
    this.node = { ...node, inputs: [...node.inputs], outputs: [...node.outputs], params: { ...node.params } }
    this.relatedEdges = relatedEdges.map((e) => ({ ...e }))
    this.graphStore = graphStore
    this.description = `删除节点: ${node.name}`
    this.timestamp = Date.now()
  }

  execute(): void {
    this.graphStore.removeNode(this.node.id)
  }

  undo(): void {
    // 先恢复节点,再恢复关联 edge
    this.graphStore.addNodeDirect({
      ...this.node,
      inputs: [...this.node.inputs],
      outputs: [...this.node.outputs],
      params: { ...this.node.params },
    })
    for (const edge of this.relatedEdges) {
      this.graphStore.connect(edge.from, edge.fromPort, edge.to, edge.toPort)
    }
  }
}

/**
 * 连接命令。
 *
 * execute: connect(from, fromPort, to, toPort)
 * undo:    disconnect(edgeId)
 */
export class ConnectCommand implements GraphCommand {
  description: string
  timestamp: number
  private from: string
  private fromPort: string
  private to: string
  private toPort: string
  private edgeId: string
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(
    from: string,
    fromPort: string,
    to: string,
    toPort: string,
    graphStore: ReturnType<typeof useGraphStore>,
  ) {
    this.from = from
    this.fromPort = fromPort
    this.to = to
    this.toPort = toPort
    this.graphStore = graphStore
    this.edgeId = `${from}:${fromPort}->${to}:${toPort}`
    this.description = `连接: ${from} → ${to}`
    this.timestamp = Date.now()
  }

  execute(): void {
    this.graphStore.connect(this.from, this.fromPort, this.to, this.toPort)
  }

  undo(): void {
    this.graphStore.disconnect(this.edgeId)
  }
}

/**
 * 断开连接命令。
 *
 * execute: disconnect(edgeId)
 * undo:    connect(from, fromPort, to, toPort)
 */
export class DisconnectCommand implements GraphCommand {
  description: string
  timestamp: number
  private edge: GraphEdge
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(
    edge: GraphEdge,
    graphStore: ReturnType<typeof useGraphStore>,
  ) {
    this.edge = { ...edge }
    this.graphStore = graphStore
    this.description = `断开: ${edge.from} → ${edge.to}`
    this.timestamp = Date.now()
  }

  execute(): void {
    this.graphStore.disconnect(this.edge.id)
  }

  undo(): void {
    this.graphStore.connect(this.edge.from, this.edge.fromPort, this.edge.to, this.edge.toPort)
  }
}

/**
 * 移动节点命令(拖动结束时入栈)。
 *
 * execute: updateNodePosition(id, newPosition)
 * undo:    updateNodePosition(id, oldPosition)
 *
 * 合并窗口:500ms 内同节点的连续移动合并为一条(避免拖动产生海量历史)。
 */
export class MoveNodeCommand implements GraphCommand {
  description: string
  timestamp: number
  private nodeId: string
  private oldPosition: NodePosition
  private newPosition: NodePosition
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(
    nodeId: string,
    oldPosition: NodePosition,
    newPosition: NodePosition,
    graphStore: ReturnType<typeof useGraphStore>,
  ) {
    this.nodeId = nodeId
    this.oldPosition = { ...oldPosition }
    this.newPosition = { ...newPosition }
    this.graphStore = graphStore
    this.description = `移动节点: ${nodeId}`
    this.timestamp = Date.now()
  }

  execute(): void {
    this.graphStore.updateNodePosition(this.nodeId, this.newPosition)
  }

  undo(): void {
    this.graphStore.updateNodePosition(this.nodeId, this.oldPosition)
  }

  /** 是否可与下一个 MoveNodeCommand 合并(同节点 + 500ms 内) */
  canMergeWith(next: MoveNodeCommand, mergeWindowMs = 500): boolean {
    return (
      this.nodeId === next.nodeId &&
      next.timestamp - this.timestamp < mergeWindowMs
    )
  }

  /** 合并:把 newPosition 更新为 next 的 newPosition */
  mergeWith(next: MoveNodeCommand): void {
    this.newPosition = { ...next.newPosition }
    this.timestamp = next.timestamp
  }
}

/**
 * 修改节点参数命令(Inspector 编辑)。
 *
 * execute: updateNodeParams(id, newParams)
 * undo:    updateNodeParams(id, oldParams)
 */
export class UpdateNodeParamsCommand implements GraphCommand {
  description: string
  timestamp: number
  private nodeId: string
  private oldParams: Record<string, unknown>
  private newParams: Record<string, unknown>
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(
    nodeId: string,
    oldParams: Record<string, unknown>,
    newParams: Record<string, unknown>,
    graphStore: ReturnType<typeof useGraphStore>,
  ) {
    this.nodeId = nodeId
    this.oldParams = { ...oldParams }
    this.newParams = { ...newParams }
    this.graphStore = graphStore
    this.description = `修改参数: ${nodeId}`
    this.timestamp = Date.now()
  }

  execute(): void {
    this.graphStore.updateNodeParams(this.nodeId, this.newParams as Record<string, never>)
  }

  undo(): void {
    this.graphStore.updateNodeParams(this.nodeId, this.oldParams as Record<string, never>)
  }
}

/**
 * 自动布局命令(批量移动)。
 *
 * execute: 应用所有新位置
 * undo:    恢复所有旧位置
 */
export class AutoLayoutCommand implements GraphCommand {
  description: string
  timestamp: number
  private oldPositions: Map<string, NodePosition>
  private newPositions: Map<string, NodePosition>
  private graphStore: ReturnType<typeof useGraphStore>

  constructor(
    oldPositions: Map<string, NodePosition>,
    newPositions: Map<string, NodePosition>,
    graphStore: ReturnType<typeof useGraphStore>,
  ) {
    this.oldPositions = new Map(oldPositions)
    this.newPositions = new Map(newPositions)
    this.graphStore = graphStore
    this.description = '自动布局'
    this.timestamp = Date.now()
  }

  execute(): void {
    for (const [id, pos] of this.newPositions) {
      this.graphStore.updateNodePosition(id, pos)
    }
  }

  undo(): void {
    for (const [id, pos] of this.oldPositions) {
      this.graphStore.updateNodePosition(id, pos)
    }
  }
}

// ============================================================================
// Graph History Store
// ============================================================================

/** 默认历史栈最大长度 */
const DEFAULT_MAX_SIZE = 100
/** 同节点移动的合并时间窗口(ms) */
const DEFAULT_MERGE_WINDOW_MS = 500

/**
 * Graph History Store。
 *
 * 使用独立的 undo/redo 栈,不与 stores/history.ts 混淆。
 *
 * 用法:
 *   const graphHistory = useGraphHistoryStore()
 *   const graphStore = useGraphStore()
 *
 *   // 执行一个命令(自动入栈)
 *   graphHistory.execute(new AddNodeCommand(node, graphStore))
 *
 *   // 撤销
 *   graphHistory.undo()
 *
 *   // 重做
 *   graphHistory.redo()
 */
export const useGraphHistoryStore = defineStore('graphHistory', () => {
  const undoStack = ref<GraphCommand[]>([])
  const redoStack = ref<GraphCommand[]>([])
  const maxSize = ref(DEFAULT_MAX_SIZE)
  const mergeWindowMs = ref(DEFAULT_MERGE_WINDOW_MS)

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const undoCount = computed(() => undoStack.value.length)
  const redoCount = computed(() => redoStack.value.length)
  const lastCommand = computed<GraphCommand | null>(() =>
    undoStack.value.length > 0 ? undoStack.value[undoStack.value.length - 1] : null,
  )

  /**
   * 执行命令并入栈。
   *
   * - 调用 command.execute()
   * - 与栈顶 MoveNodeCommand 合并(若可合并)
   * - 否则压入 undoStack,清空 redoStack
   * - 超过 maxSize 时丢弃最旧条目
   */
  function execute(command: GraphCommand): void {
    command.execute()

    // 尝试与栈顶 MoveNodeCommand 合并
    const top = undoStack.value[undoStack.value.length - 1]
    if (
      command instanceof MoveNodeCommand &&
      top instanceof MoveNodeCommand &&
      top.canMergeWith(command, mergeWindowMs.value)
    ) {
      top.mergeWith(command)
      return
    }

    // 压入栈
    undoStack.value.push(command)
    if (undoStack.value.length > maxSize.value) {
      undoStack.value.shift()
    }
    // 清空 redoStack(新操作分支)
    redoStack.value = []
  }

  /**
   * 撤销栈顶命令。
   */
  function undo(): void {
    const command = undoStack.value.pop()
    if (!command) return
    command.undo()
    redoStack.value.push(command)
  }

  /**
   * 重做最近撤销的命令。
   */
  function redo(): void {
    const command = redoStack.value.pop()
    if (!command) return
    command.execute()
    undoStack.value.push(command)
  }

  /**
   * 清空全部历史(用于 loadGraph / clearGraph 后重置)。
   */
  function clear(): void {
    undoStack.value = []
    redoStack.value = []
  }

  return {
    // state
    undoStack,
    redoStack,
    maxSize,
    mergeWindowMs,
    // getters
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    lastCommand,
    // actions
    execute,
    undo,
    redo,
    clear,
  }
})
