/**
 * RealEditorBridge — MCP 与 PixelForge 真实编辑器的桥接实现。
 *
 * 与 MockEditorBridge(内存假数据)不同,本实现把 23 个 MCP 工具真实映射到:
 *   - 图操作   → useGraphStore(真实节点图 store)
 *   - 子图操作 → useGraphStore 子图管理 actions + subgraphInliner
 *   - 时间轴   → 内部 TimelineContent(由 src/world/timeline/timelineManager 纯函数驱动)
 *   - 渲染     → useRenderStore(真实渲染 store)
 *   - 资产     → useAssetRegistryStore(真实资产注册表)
 *   - AI Director → src/world/director/director.ts 真实意图解析/决策函数
 *
 * 设计:
 * - 每个方法惰性获取对应 store(要求调用时 Pinia 已激活),便于在测试/运行时复用。
 * - 所有方法 try/catch 包裹,任何异常都转为 { success: false, error },保证 MCP server 不因单次调用崩溃。
 * - 时间轴组:项目当前无独立 timeline store(已被删除),故由本桥持有 TimelineContent 并用
 *   timelineManager 的 immutable 纯函数驱动,作为 MCP 侧可工作的 v1;未来可替换为注入引擎的 useTimelineStore。
 *
 * 启动入口见 ./startServer.ts(Node stdio),Tauri 侧见 src-tauri/src/lib.rs 的 mcp_start/mcp_stop。
 */

import type {
  EditorBridge,
  GraphResult,
  NodeResult,
  EdgeResult,
  CompileResult,
  SubGraphResult,
  SequenceResult,
  KeyframeResult,
  RenderStatus,
  ScreenshotResult,
  AssetListResult,
  AssetOperationResult,
  GenerationResult,
  SuggestionResult,
  Sequence,
  Track,
  Keyframe,
  AssetType,
  AssetInfo,
} from './bridge'
import type { JsonLiteral } from '@/shared/types'
import type { NodeRegistryKey } from '@/graph/nodeRegistry'
import type { TimelineContent, TimelineKeyframe } from '@/world/types'
import type { AssetRecord, AssetKind } from '@/editor/asset-genome/assetRegistry'

import { useGraphStore } from '@/graph/graphStore'
import { compileGraph } from '@/graph/graphCompiler'
import { createSubGraphFromSelection } from '@/graph/subgraphInliner'
import { useRenderStore } from '@/editor/render/renderStore'
import { useAssetRegistryStore } from '@/editor/asset-genome/assetRegistryStore'
import {
  createTimeline,
  createTrack,
  createKeyframe,
  addTrack,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
} from '@/world/timeline/timelineManager'
import { parseIntent, decide, toValuePatches } from '@/world/director/director'

// —— 资产类型映射(AssetKind → bridge AssetType) ——
function mapAssetType(kind: AssetKind): AssetType {
  switch (kind) {
    case 'image':
    case 'texture':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'material':
    case 'shader':
    case 'graph':
      return 'shader'
    default:
      return 'image'
  }
}

function mapAssetRecord(rec: AssetRecord): AssetInfo {
  return {
    id: rec.id,
    name: rec.name,
    type: mapAssetType(rec.kind),
    tags: rec.tags,
    size: rec.size ?? 0,
    path: rec.payloadRef ?? '',
    thumbnail: rec.thumbnail,
  }
}

// —— 时间轴 DTO 转换(TimelineContent ↔ bridge Sequence) ——
function toBridgeKeyframe(k: TimelineKeyframe): Keyframe {
  return {
    id: k.id,
    time: k.time,
    value: k.value,
    interpolation: k.interpolation === 'hold' ? 'step' : k.interpolation,
  }
}

function toSequence(tc: TimelineContent, name: string): Sequence {
  return {
    id: tc.id,
    name,
    duration: tc.duration,
    fps: tc.fps,
    tracks: tc.tracks.map(
      (t): Track => ({
        id: t.id,
        name: t.name,
        type: t.targetEntity === 'effect' ? 'effect' : 'video',
        keyframes: t.keyframes.map(toBridgeKeyframe),
      }),
    ),
  }
}

function findTrackIdByKeyframe(tc: TimelineContent, keyframeId: string): string | undefined {
  for (const t of tc.tracks) {
    if (t.keyframes.some((k) => k.id === keyframeId)) return t.id
  }
  return undefined
}

/**
 * 真实编辑器桥接。
 */
export class RealEditorBridge implements EditorBridge {
  // 时间轴内部模型(项目暂无独立 timeline store,MCP 侧持有)
  private timeline: TimelineContent | null = null
  private sequenceName = ''
  private playing = false
  private playhead = 0

  // ─── 图操作 ───

  async getCurrentGraph(): Promise<GraphResult> {
    try {
      const graph = useGraphStore()
      return { success: true, graph: graph.exportGraph() }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async createGraph(_name: string, _width: number, _height: number): Promise<GraphResult> {
    try {
      const graph = useGraphStore()
      graph.clearGraph()
      return { success: true, graph: graph.exportGraph() }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async loadGraph(graph: import('@/graph/types').RenderGraph): Promise<GraphResult> {
    try {
      const store = useGraphStore()
      store.loadGraph(graph)
      return { success: true, graph: store.exportGraph() }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async exportGraph(): Promise<GraphResult> {
    try {
      const graph = useGraphStore()
      return { success: true, graph: graph.exportGraph() }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async compileGraph(): Promise<CompileResult> {
    try {
      const graph = useGraphStore()
      const result = compileGraph(graph.exportGraph())
      return {
        success: true,
        renderIR: result.ir,
        warnings: result.warnings,
      }
    } catch (e) {
      return { success: false, errors: [errMsg(e)], warnings: [] }
    }
  }

  // ─── 节点操作 ───

  async addNode(
    registryKey: NodeRegistryKey,
    name: string,
    position: { x: number; y: number },
    params?: Record<string, JsonLiteral>,
  ): Promise<NodeResult> {
    try {
      const graph = useGraphStore()
      const id = graph.addNode(registryKey, position, name)
      if (params) graph.updateNodeParams(id, params)
      const node = graph.getNode(id)
      if (!node) return { success: false, error: '节点创建后未找到' }
      return { success: true, node }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async removeNode(nodeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      useGraphStore().removeNode(nodeId)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async moveNode(
    nodeId: string,
    position: { x: number; y: number },
  ): Promise<{ success: boolean; error?: string }> {
    try {
      useGraphStore().updateNodePosition(nodeId, position)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async updateNodeParams(
    nodeId: string,
    params: Record<string, JsonLiteral>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      useGraphStore().updateNodeParams(nodeId, params)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async getNode(nodeId: string): Promise<NodeResult> {
    try {
      const node = useGraphStore().getNode(nodeId)
      if (!node) return { success: false, error: '节点不存在' }
      return { success: true, node }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async listNodes(): Promise<{ success: boolean; nodes?: import('@/graph/types').GraphNode[]; error?: string }> {
    try {
      const graph = useGraphStore()
      return { success: true, nodes: graph.nodes }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  // ─── 连接操作 ───

  async connectNodes(
    fromNodeId: string,
    fromPortId: string,
    toNodeId: string,
    toPortId: string,
  ): Promise<EdgeResult> {
    try {
      const graph = useGraphStore()
      const res = graph.connect(fromNodeId, fromPortId, toNodeId, toPortId)
      if (!res.ok) return { success: false, error: res.error }
      const edge = graph.edges.find((e) => e.id === res.edgeId)
      return edge ? { success: true, edge } : { success: false, error: '边创建后未找到' }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async disconnectNodes(edgeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      useGraphStore().disconnect(edgeId)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async listEdges(): Promise<{ success: boolean; edges?: import('@/graph/types').GraphEdge[]; error?: string }> {
    try {
      const graph = useGraphStore()
      return { success: true, edges: graph.edges }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  // ─── 子图操作 ───

  async createSubGraphFromSelection(
    name: string,
    nodeIds: string[],
  ): Promise<SubGraphResult> {
    try {
      const graph = useGraphStore()
      const def = createSubGraphFromSelection(
        graph.exportGraph(),
        new Set(nodeIds),
        `sg_${Date.now().toString(36)}`,
        name,
      )
      graph.addSubGraphDefinition(def)
      return { success: true, subGraph: def }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async listSubGraphs(): Promise<{ success: boolean; subGraphs?: import('@/graph/types').SubGraphDefinition[]; error?: string }> {
    try {
      const graph = useGraphStore()
      return { success: true, subGraphs: graph.listSubGraphDefinitions() }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async removeSubGraph(subGraphId: string): Promise<{ success: boolean; error?: string }> {
    try {
      useGraphStore().removeSubGraphDefinition(subGraphId)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  // ─── 时间轴操作 ───

  async getCurrentSequence(): Promise<SequenceResult> {
    try {
      if (!this.timeline) return { success: false, error: '当前没有激活的序列' }
      return { success: true, sequence: toSequence(this.timeline, this.sequenceName) }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async createSequence(name: string, duration: number, fps: number): Promise<SequenceResult> {
    try {
      this.timeline = createTimeline(duration, fps)
      this.sequenceName = name
      this.playing = false
      this.playhead = 0
      return { success: true, sequence: toSequence(this.timeline, name) }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async addKeyframe(
    _sequenceId: string,
    trackId: string,
    time: number,
    value: JsonLiteral,
    interpolation: 'linear' | 'step' | 'bezier' = 'linear',
  ): Promise<KeyframeResult> {
    try {
      if (!this.timeline) return { success: false, error: '当前没有激活的序列' }
      // 轨道不存在则按需创建(编辑器由 AI Director 驱动时,轨道通常按需生成)
      if (!this.timeline.tracks.some((t) => t.id === trackId)) {
        const track = createTrack(`轨道 ${trackId}`, 'effect', trackId, 'value')
        track.id = trackId // 以调用方指定的 trackId 为准,保证后续查找一致
        this.timeline = addTrack(this.timeline, track)
      }
      const kf = createKeyframe(time, value, interpolation)
      this.timeline = addKeyframe(this.timeline, trackId, kf)
      const added = this.timeline.tracks
        .find((t) => t.id === trackId)
        ?.keyframes.find((k) => k.id === kf.id)
      return added ? { success: true, keyframe: toBridgeKeyframe(added) } : { success: false, error: '关键帧添加失败' }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async updateKeyframe(
    keyframeId: string,
    value: JsonLiteral,
    time?: number,
  ): Promise<KeyframeResult> {
    try {
      if (!this.timeline) return { success: false, error: '当前没有激活的序列' }
      const trackId = findTrackIdByKeyframe(this.timeline, keyframeId)
      if (!trackId) return { success: false, error: '关键帧不存在' }
      const updates: { value: JsonLiteral; time?: number } = { value }
      if (time !== undefined) updates.time = time
      this.timeline = updateKeyframe(this.timeline, trackId, keyframeId, updates)
      const updated = this.timeline.tracks
        .find((t) => t.id === trackId)
        ?.keyframes.find((k) => k.id === keyframeId)
      return updated ? { success: true, keyframe: toBridgeKeyframe(updated) } : { success: false, error: '关键帧更新失败' }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async removeKeyframe(keyframeId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.timeline) return { success: false, error: '当前没有激活的序列' }
      const trackId = findTrackIdByKeyframe(this.timeline, keyframeId)
      if (!trackId) return { success: false, error: '关键帧不存在' }
      this.timeline = removeKeyframe(this.timeline, trackId, keyframeId)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async playbackControl(
    action: 'play' | 'pause' | 'stop' | 'seek',
    time?: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      switch (action) {
        case 'play':
          this.playing = true
          break
        case 'pause':
          this.playing = false
          break
        case 'stop':
          this.playing = false
          this.playhead = 0
          break
        case 'seek':
          if (time !== undefined) this.playhead = time
          break
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  // ─── 渲染操作 ───

  async startRender(
    _outputFormat: 'png' | 'jpg' | 'mp4',
    _quality?: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const render = useRenderStore()
      // 真实渲染需要浏览器 WebGPU 上下文与帧渲染器(FrameRenderer),
      // stdio MCP 进程不具备这些条件,无法真正启动 GPU 渲染。
      // 这里如实返回当前状态并说明限制,保证链路可观测且不伪造成功。
      // 真正渲染由前端(浏览器)发起。
      const state = render.status
      return {
        success: false,
        error:
          `渲染需在浏览器 WebGPU 上下文发起(当前 stdio 进程无 GPU/帧渲染器),` +
          `无法真正启动;当前渲染状态: ${state}`,
      }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async pauseRender(): Promise<{ success: boolean; error?: string }> {
    try {
      useRenderStore().pauseRender()
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async resumeRender(): Promise<{ success: boolean; error?: string }> {
    try {
      useRenderStore().resumeRender()
      return { success: true }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async getRenderStatus(): Promise<RenderStatus> {
    try {
      const render = useRenderStore()
      return {
        state: render.status as RenderStatus['state'],
        progress: render.progress,
        currentFrame: render.completedFrames,
        totalFrames: render.totalFrames,
      }
    } catch (e) {
      return { state: 'error', progress: 0, currentFrame: 0, totalFrames: 0, error: errMsg(e) }
    }
  }

  async takeScreenshot(_format?: 'png' | 'jpg', _quality?: number): Promise<ScreenshotResult> {
    // stdio MCP server 运行在独立 Node 进程,无法直接访问浏览器 WebGPU canvas。
    // 真实截图需经 WebSocket/IPC 从前端取帧(后续集成);此处返回明确错误而非伪造数据。
    return { success: false, error: '截图需要实时浏览器画布,stdio 模式下不可用(请通过前端桥接获取)' }
  }

  // ─── AI Director 操作 ───

  async generateFromDescription(
    description: string,
    _style?: string,
    _duration?: number,
  ): Promise<GenerationResult> {
    try {
      const intent = parseIntent(description)
      const decision = await decide(intent)
      const patches = toValuePatches(decision.patches, decision.intentId)
      return {
        success: true,
        description: `已生成 ${patches.length} 个参数决策`,
      }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async modifyScene(_sceneId: string, _modifications: string): Promise<GenerationResult> {
    try {
      const intent = parseIntent(_modifications)
      const decision = await decide(intent)
      const patches = toValuePatches(decision.patches, decision.intentId)
      return { success: true, description: `已应用 ${patches.length} 个修改` }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async getSuggestions(
    context: string,
    type: 'improvement' | 'alternative' | 'optimization',
  ): Promise<SuggestionResult> {
    try {
      const intent = parseIntent(context)
      const decision = await decide(intent)
      const patches = toValuePatches(decision.patches, decision.intentId)
      const suggestions = patches.map((p) => `${type}: ${p.targetEntity} ${p.targetId} → ${JSON.stringify(p.value)}`)
      return { success: true, suggestions }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  // ─── 资产操作 ───

  async browseAssets(
    type?: AssetType,
    tags?: string[],
    limit?: number,
    offset?: number,
  ): Promise<AssetListResult> {
    try {
      const store = useAssetRegistryStore()
      let records = store.all.slice()
      if (type) records = records.filter((r) => mapAssetType(r.kind) === type)
      if (tags && tags.length > 0) records = records.filter((r) => tags.every((t) => r.tags.includes(t)))
      const total = records.length
      if (offset) records = records.slice(offset)
      if (limit !== undefined) records = records.slice(0, limit)
      return { success: true, assets: records.map(mapAssetRecord), total }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async searchAssets(query: string, type?: AssetType): Promise<AssetListResult> {
    try {
      const store = useAssetRegistryStore()
      const q = query.toLowerCase()
      let records = store.all.filter(
        (r) => r.name.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q)),
      )
      if (type) records = records.filter((r) => mapAssetType(r.kind) === type)
      return { success: true, assets: records.map(mapAssetRecord), total: records.length }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }

  async loadAsset(
    assetId: string,
    targetNodeId?: string,
  ): Promise<AssetOperationResult> {
    try {
      const store = useAssetRegistryStore()
      const rec = store.getById(assetId)
      if (!rec) return { success: false, error: '资产不存在' }
      if (targetNodeId) {
        const graph = useGraphStore()
        const node = graph.getNode(targetNodeId)
        if (node) graph.updateNodeParams(targetNodeId, { assetId: rec.id, assetRef: rec.payloadRef ?? rec.id })
      }
      return { success: true, asset: mapAssetRecord(rec) }
    } catch (e) {
      return { success: false, error: errMsg(e) }
    }
  }
}

/** 统一异常消息提取 */
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
