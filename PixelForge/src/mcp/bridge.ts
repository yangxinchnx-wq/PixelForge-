/**
 * MCP ↔ 编辑器通信桥接接口。
 *
 * 定义 MCP 服务器与 PixelForge 编辑器之间的通信协议。
 * 具体实现可以在 Tauri 进程内、WebSocket、或 IPC 传输层。
 *
 * 设计为接口而非具体实现，方便测试和解耦。
 */

import type {
  RenderGraph,
  GraphNode,
  GraphEdge,
  NodeType,
} from '@/graph/types'
import type { NodeRegistryKey } from '@/graph/nodeRegistry'
import type { SubGraphDefinition } from '@/graph/types'
import type { JsonLiteral } from '@/shared/types'

// ─── 图操作结果类型 ───

/** 图操作结果 */
export interface GraphResult {
  success: boolean
  graph?: RenderGraph
  error?: string
}

/** 节点操作结果 */
export interface NodeResult {
  success: boolean
  node?: GraphNode
  error?: string
}

/** 连接操作结果 */
export interface EdgeResult {
  success: boolean
  edge?: GraphEdge
  error?: string
}

/** 编译结果 */
export interface CompileResult {
  success: boolean
  renderIR?: unknown
  errors?: string[]
  warnings?: string[]
}

/** 子图操作结果 */
export interface SubGraphResult {
  success: boolean
  subGraph?: SubGraphDefinition
  error?: string
}

// ─── 时间轴类型 ───

/** 序列 */
export interface Sequence {
  id: string
  name: string
  duration: number
  fps: number
  tracks: Track[]
}

/** 轨道 */
export interface Track {
  id: string
  name: string
  type: 'video' | 'audio' | 'effect'
  keyframes: Keyframe[]
}

/** 关键帧 */
export interface Keyframe {
  id: string
  time: number
  value: JsonLiteral
  interpolation: 'linear' | 'step' | 'bezier'
}

/** 序列结果 */
export interface SequenceResult {
  success: boolean
  sequence?: Sequence
  error?: string
}

/** 关键帧结果 */
export interface KeyframeResult {
  success: boolean
  keyframe?: Keyframe
  error?: string
}

// ─── 渲染类型 ───

/** 渲染状态 */
export interface RenderStatus {
  state: 'idle' | 'rendering' | 'paused' | 'completed' | 'error'
  progress: number
  currentFrame: number
  totalFrames: number
  error?: string
}

/** 截图结果 */
export interface ScreenshotResult {
  success: boolean
  data?: string // base64
  format?: string
  error?: string
}

// ─── 资产类型 ───

/** 资产类型枚举 */
export type AssetType = 'image' | 'video' | 'audio' | '3d-model' | 'shader' | 'font'

/** 资产信息 */
export interface AssetInfo {
  id: string
  name: string
  type: AssetType
  tags: string[]
  size: number
  path: string
  thumbnail?: string
}

/** 资产列表结果 */
export interface AssetListResult {
  success: boolean
  assets?: AssetInfo[]
  total?: number
  error?: string
}

/** 资产操作结果 */
export interface AssetOperationResult {
  success: boolean
  asset?: AssetInfo
  error?: string
}

// ─── AI Director 类型 ───

/** 生成结果 */
export interface GenerationResult {
  success: boolean
  graph?: RenderGraph
  description?: string
  error?: string
}

/** 建议结果 */
export interface SuggestionResult {
  success: boolean
  suggestions?: string[]
  error?: string
}

// ─── 编辑器桥接接口 ───

/**
 * 编辑器桥接接口。
 *
 * MCP 服务器通过此接口与编辑器通信。
 * 所有方法均为异步，支持远程调用。
 */
export interface EditorBridge {
  // ─── 图操作 ───

  /** 获取当前图 */
  getCurrentGraph(): Promise<GraphResult>

  /** 创建新图 */
  createGraph(name: string, width: number, height: number): Promise<GraphResult>

  /** 加载图 */
  loadGraph(graph: RenderGraph): Promise<GraphResult>

  /** 导出图 */
  exportGraph(): Promise<GraphResult>

  /** 编译图 */
  compileGraph(graphId?: string): Promise<CompileResult>

  // ─── 节点操作 ───

  /** 添加节点 */
  addNode(
    registryKey: NodeRegistryKey,
    name: string,
    position: { x: number; y: number },
    params?: Record<string, JsonLiteral>,
  ): Promise<NodeResult>

  /** 删除节点 */
  removeNode(nodeId: string): Promise<{ success: boolean; error?: string }>

  /** 移动节点 */
  moveNode(
    nodeId: string,
    position: { x: number; y: number },
  ): Promise<{ success: boolean; error?: string }>

  /** 更新节点参数 */
  updateNodeParams(
    nodeId: string,
    params: Record<string, JsonLiteral>,
  ): Promise<{ success: boolean; error?: string }>

  /** 获取节点信息 */
  getNode(nodeId: string): Promise<NodeResult>

  /** 列出所有节点 */
  listNodes(): Promise<{ success: boolean; nodes?: GraphNode[]; error?: string }>

  // ─── 连接操作 ───

  /** 连接两个节点 */
  connectNodes(
    fromNodeId: string,
    fromPortId: string,
    toNodeId: string,
    toPortId: string,
  ): Promise<EdgeResult>

  /** 断开连接 */
  disconnectNodes(edgeId: string): Promise<{ success: boolean; error?: string }>

  /** 列出所有连接 */
  listEdges(): Promise<{ success: boolean; edges?: GraphEdge[]; error?: string }>

  // ─── 子图操作 ───

  /** 创建子图（从选中节点） */
  createSubGraphFromSelection(
    name: string,
    nodeIds: string[],
  ): Promise<SubGraphResult>

  /** 列出所有子图定义 */
  listSubGraphs(): Promise<{
    success: boolean
    subGraphs?: SubGraphDefinition[]
    error?: string
  }>

  /** 删除子图定义 */
  removeSubGraph(subGraphId: string): Promise<{ success: boolean; error?: string }>

  // ─── 时间轴操作 ───

  /** 获取当前序列 */
  getCurrentSequence(): Promise<SequenceResult>

  /** 创建序列 */
  createSequence(name: string, duration: number, fps: number): Promise<SequenceResult>

  /** 添加关键帧 */
  addKeyframe(
    sequenceId: string,
    trackId: string,
    time: number,
    value: JsonLiteral,
    interpolation?: 'linear' | 'step' | 'bezier',
  ): Promise<KeyframeResult>

  /** 修改关键帧 */
  updateKeyframe(
    keyframeId: string,
    value: JsonLiteral,
    time?: number,
  ): Promise<KeyframeResult>

  /** 删除关键帧 */
  removeKeyframe(keyframeId: string): Promise<{ success: boolean; error?: string }>

  /** 播放控制 */
  playbackControl(
    action: 'play' | 'pause' | 'stop' | 'seek',
    time?: number,
  ): Promise<{ success: boolean; error?: string }>

  // ─── 渲染操作 ───

  /** 开始渲染 */
  startRender(
    outputFormat: 'png' | 'jpg' | 'mp4',
    quality?: number,
  ): Promise<{ success: boolean; error?: string }>

  /** 暂停渲染 */
  pauseRender(): Promise<{ success: boolean; error?: string }>

  /** 恢复渲染 */
  resumeRender(): Promise<{ success: boolean; error?: string }>

  /** 获取渲染状态 */
  getRenderStatus(): Promise<RenderStatus>

  /** 截图 */
  takeScreenshot(format?: 'png' | 'jpg', quality?: number): Promise<ScreenshotResult>

  // ─── AI Director 操作 ───

  /** 自然语言生成 */
  generateFromDescription(
    description: string,
    style?: string,
    duration?: number,
  ): Promise<GenerationResult>

  /** 修改场景 */
  modifyScene(
    sceneId: string,
    modifications: string,
  ): Promise<GenerationResult>

  /** 获取建议 */
  getSuggestions(
    context: string,
    type: 'improvement' | 'alternative' | 'optimization',
  ): Promise<SuggestionResult>

  // ─── 资产操作 ───

  /** 浏览资产 */
  browseAssets(
    type?: AssetType,
    tags?: string[],
    limit?: number,
    offset?: number,
  ): Promise<AssetListResult>

  /** 搜索资产 */
  searchAssets(query: string, type?: AssetType): Promise<AssetListResult>

  /** 加载资产到节点 */
  loadAsset(
    assetId: string,
    targetNodeId?: string,
  ): Promise<AssetOperationResult>
}

// ─── Mock 桥接（用于测试） ───

/**
 * Mock 编辑器桥接。
 *
 * 内存中的模拟实现，用于单元测试和开发调试。
 * 所有状态保存在内存中，不依赖实际编辑器。
 */
export class MockEditorBridge implements EditorBridge {
  private graph: RenderGraph = { nodes: [], edges: [] }
  private sequences: Sequence[] = []
  private renderStatus: RenderStatus = {
    state: 'idle',
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
  }

  // ─── 图操作 ───

  async getCurrentGraph(): Promise<GraphResult> {
    return { success: true, graph: this.deepCopy(this.graph) }
  }

  async createGraph(_name: string, width: number, height: number): Promise<GraphResult> {
    this.graph = {
      nodes: [],
      edges: [],
      canvas: { width, height },
    }
    return { success: true, graph: this.deepCopy(this.graph) }
  }

  async loadGraph(graph: RenderGraph): Promise<GraphResult> {
    this.graph = this.deepCopy(graph)
    return { success: true, graph: this.deepCopy(this.graph) }
  }

  async exportGraph(): Promise<GraphResult> {
    return { success: true, graph: this.deepCopy(this.graph) }
  }

  async compileGraph(): Promise<CompileResult> {
    return { success: true, errors: [], warnings: [] }
  }

  // ─── 节点操作 ───

  async addNode(
    registryKey: NodeRegistryKey,
    name: string,
    position: { x: number; y: number },
    params: Record<string, JsonLiteral> = {},
  ): Promise<NodeResult> {
    const node: GraphNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      type: this.nodeTypeFromKey(registryKey),
      inputs: [],
      outputs: [],
      params,
      position,
    }
    this.graph.nodes.push(node)
    return { success: true, node: this.deepCopy(node) }
  }

  async removeNode(nodeId: string): Promise<{ success: boolean; error?: string }> {
    const idx = this.graph.nodes.findIndex((n) => n.id === nodeId)
    if (idx === -1) return { success: false, error: `Node '${nodeId}' not found` }
    this.graph.nodes.splice(idx, 1)
    this.graph.edges = this.graph.edges.filter(
      (e) => e.from !== nodeId && e.to !== nodeId,
    )
    return { success: true }
  }

  async moveNode(
    nodeId: string,
    position: { x: number; y: number },
  ): Promise<{ success: boolean; error?: string }> {
    const node = this.graph.nodes.find((n) => n.id === nodeId)
    if (!node) return { success: false, error: `Node '${nodeId}' not found` }
    node.position = { ...position }
    return { success: true }
  }

  async updateNodeParams(
    nodeId: string,
    params: Record<string, JsonLiteral>,
  ): Promise<{ success: boolean; error?: string }> {
    const node = this.graph.nodes.find((n) => n.id === nodeId)
    if (!node) return { success: false, error: `Node '${nodeId}' not found` }
    node.params = { ...node.params, ...params }
    return { success: true }
  }

  async getNode(nodeId: string): Promise<NodeResult> {
    const node = this.graph.nodes.find((n) => n.id === nodeId)
    if (!node) return { success: false, error: `Node '${nodeId}' not found` }
    return { success: true, node: this.deepCopy(node) }
  }

  async listNodes() {
    return { success: true, nodes: this.deepCopy(this.graph.nodes) }
  }

  // ─── 连接操作 ───

  async connectNodes(
    fromNodeId: string,
    fromPortId: string,
    toNodeId: string,
    toPortId: string,
  ): Promise<EdgeResult> {
    const edge: GraphEdge = {
      id: `edge_${Date.now()}`,
      from: fromNodeId,
      fromPort: fromPortId,
      to: toNodeId,
      toPort: toPortId,
    }
    this.graph.edges.push(edge)
    return { success: true, edge: this.deepCopy(edge) }
  }

  async disconnectNodes(edgeId: string) {
    const idx = this.graph.edges.findIndex((e) => e.id === edgeId)
    if (idx === -1) return { success: false, error: `Edge '${edgeId}' not found` }
    this.graph.edges.splice(idx, 1)
    return { success: true }
  }

  async listEdges() {
    return { success: true, edges: this.deepCopy(this.graph.edges) }
  }

  // ─── 子图操作 ───

  async createSubGraphFromSelection(
    name: string,
    nodeIds: string[],
  ): Promise<SubGraphResult> {
    const sub: SubGraphDefinition = {
      id: `subgraph_${Date.now()}`,
      name,
      description: '',
      version: '1.0.0',
      inputPorts: [],
      outputPorts: [],
      nodes: this.graph.nodes.filter((n) => nodeIds.includes(n.id)),
      edges: this.graph.edges.filter(
        (e) => nodeIds.includes(e.from) && nodeIds.includes(e.to),
      ),
      params: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return { success: true, subGraph: sub }
  }

  async listSubGraphs() {
    const subs = this.graph.subgraphLibrary ?? []
    return { success: true, subGraphs: subs }
  }

  async removeSubGraph(subGraphId: string) {
    if (!this.graph.subgraphLibrary) {
      return { success: false, error: 'No subgraph library' }
    }
    const idx = this.graph.subgraphLibrary.findIndex((s) => s.id === subGraphId)
    if (idx === -1) return { success: false, error: `SubGraph '${subGraphId}' not found` }
    this.graph.subgraphLibrary.splice(idx, 1)
    return { success: true }
  }

  // ─── 时间轴操作 ───

  async getCurrentSequence(): Promise<SequenceResult> {
    const seq = this.sequences[0]
    return seq
      ? { success: true, sequence: this.deepCopy(seq) }
      : { success: false, error: 'No active sequence' }
  }

  async createSequence(name: string, duration: number, fps: number) {
    const seq: Sequence = {
      id: `seq_${Date.now()}`,
      name,
      duration,
      fps,
      tracks: [],
    }
    this.sequences.push(seq)
    return { success: true, sequence: this.deepCopy(seq) }
  }

  async addKeyframe(
    sequenceId: string,
    trackId: string,
    time: number,
    value: JsonLiteral,
    interpolation: 'linear' | 'step' | 'bezier' = 'linear',
  ): Promise<KeyframeResult> {
    const seq = this.sequences.find((s) => s.id === sequenceId)
    if (!seq) return { success: false, error: `Sequence '${sequenceId}' not found` }
    const track = seq.tracks.find((t) => t.id === trackId)
    if (!track) return { success: false, error: `Track '${trackId}' not found` }

    const kf: Keyframe = {
      id: `kf_${Date.now()}`,
      time,
      value,
      interpolation,
    }
    track.keyframes.push(kf)
    track.keyframes.sort((a, b) => a.time - b.time)
    return { success: true, keyframe: this.deepCopy(kf) }
  }

  async updateKeyframe(
    keyframeId: string,
    value: JsonLiteral,
    time?: number,
  ): Promise<KeyframeResult> {
    for (const seq of this.sequences) {
      for (const track of seq.tracks) {
        const kf = track.keyframes.find((k) => k.id === keyframeId)
        if (kf) {
          kf.value = value
          if (time !== undefined) kf.time = time
          track.keyframes.sort((a, b) => a.time - b.time)
          return { success: true, keyframe: this.deepCopy(kf) }
        }
      }
    }
    return { success: false, error: `Keyframe '${keyframeId}' not found` }
  }

  async removeKeyframe(keyframeId: string) {
    for (const seq of this.sequences) {
      for (const track of seq.tracks) {
        const idx = track.keyframes.findIndex((k) => k.id === keyframeId)
        if (idx !== -1) {
          track.keyframes.splice(idx, 1)
          return { success: true }
        }
      }
    }
    return { success: false, error: `Keyframe '${keyframeId}' not found` }
  }

  async playbackControl(action: 'play' | 'pause' | 'stop' | 'seek', _time?: number) {
    if (action === 'play') this.renderStatus.state = 'rendering'
    if (action === 'pause') this.renderStatus.state = 'paused'
    if (action === 'stop') this.renderStatus.state = 'idle'
    return { success: true }
  }

  // ─── 渲染操作 ───

  async startRender(_outputFormat: string, _quality?: number) {
    this.renderStatus = { ...this.renderStatus, state: 'rendering', progress: 0 }
    return { success: true }
  }

  async pauseRender() {
    this.renderStatus.state = 'paused'
    return { success: true }
  }

  async resumeRender() {
    this.renderStatus.state = 'rendering'
    return { success: true }
  }

  async getRenderStatus(): Promise<RenderStatus> {
    return { ...this.renderStatus }
  }

  async takeScreenshot(format: 'png' | 'jpg' = 'png', _quality?: number) {
    return { success: true, data: 'mock_base64_data', format }
  }

  // ─── AI Director ───

  async generateFromDescription(description: string, _style?: string, _duration?: number) {
    return {
      success: true,
      graph: { nodes: [], edges: [] },
      description: `Generated from: ${description}`,
    }
  }

  async modifyScene(_sceneId: string, modifications: string) {
    return {
      success: true,
      graph: this.deepCopy(this.graph),
      description: `Modified: ${modifications}`,
    }
  }

  async getSuggestions(context: string, _type: string) {
    // 从材质预设中提取与上下文相关的建议
    const { listPresetKeys, getPreset } = await import('@/material/materialPresets')
    const suggestions = listPresetKeys().map((key) => {
      const preset = getPreset(key)
      return preset ? `${preset.label}: ${preset.description}` : key
    })
    return { success: true, suggestions }
  }

  // ─── 资产操作 ───

  async browseAssets(_type?: AssetType, tags?: string[], limit = 20, _offset = 0) {
    const { useMaterialAssetStore } = await import('@/material/materialAssetStore')
    const store = useMaterialAssetStore()
    let assets = store.assets

    // 按标签筛选
    if (tags && tags.length > 0) {
      assets = assets.filter((a) => tags.some((t) => a.tags.includes(t)))
    }

    const total = assets.length
    const limited = assets.slice(0, limit)

    return {
      success: true,
      assets: limited.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        tags: a.tags,
        thumbnail: a.thumbnail,
      })),
      total,
    }
  }

  async searchAssets(query: string, _type?: AssetType) {
    const { useMaterialAssetStore } = await import('@/material/materialAssetStore')
    const store = useMaterialAssetStore()
    const q = query.toLowerCase()
    const matched = store.assets.filter((a) =>
      a.name.toLowerCase().includes(q) ||
      a.tags.some((t) => t.toLowerCase().includes(q)) ||
      a.id.toLowerCase().includes(q),
    )

    return {
      success: true,
      assets: matched.map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        tags: a.tags,
        thumbnail: a.thumbnail,
      })),
      total: matched.length,
    }
  }

  async loadAsset(assetId: string, _targetNodeId?: string) {
    const { useMaterialAssetStore } = await import('@/material/materialAssetStore')
    const store = useMaterialAssetStore()
    const asset = store.getMaterial(assetId)

    if (!asset) {
      return { success: false, error: `未找到材质资产: ${assetId}` }
    }

    return {
      success: true,
      asset: {
        id: asset.id,
        name: asset.name,
        category: asset.category,
        tags: asset.tags,
        pbr: asset.pbr,
        graph: asset.graph,
        thumbnail: asset.thumbnail,
      },
    }
  }

  // ─── 工具方法 ───

  private nodeTypeFromKey(key: NodeRegistryKey): NodeType {
    const map: Record<string, NodeType> = {
      Background: 'REGION',
      SolidColor: 'REGION',
      Gradient: 'REGION',
      Noise: 'REGION',
      Checkerboard: 'REGION',
      Blur: 'EFFECT',
      BrightnessContrast: 'EFFECT',
      ColorAdjust: 'EFFECT',
      Grayscale: 'EFFECT',
      Invert: 'EFFECT',
      Composite: 'COMPOSITE',
      Output: 'OUTPUT',
      SubGraph: 'SUBGRAPH',
    }
    return map[key] ?? 'REGION'
  }

  private deepCopy<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj))
  }
}
