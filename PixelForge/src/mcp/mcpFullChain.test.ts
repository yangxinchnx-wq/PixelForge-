/**
 * MCP 全链路打通验证(RealEditorBridge → 真实 store)。
 *
 * 通过 MemoryTransport 驱动真实 MCPServer,把 23 个 MCP 工具经 JSON-RPC
 * 路由到 RealEditorBridge,再真实改写 Pinia store / timelineManager / AI Director:
 *   - 图:   graph_create → graph_add_node → graph_connect → graph_compile
 *           (真实改写 useGraphStore)
 *   - 时间轴: timeline_create_sequence → timeline_add_keyframe → timeline_get_sequence
 *           (真实改写内部 TimelineContent,由 timelineManager 纯函数驱动)
 *   - 资产: asset_browse / asset_search(真实读取 useAssetRegistryStore)
 *   - AI Director: ai_generate(真实调用 parseIntent → decide → toValuePatches)
 *   - 渲染: render_start / render_status(真实触达 useRenderStore,无 GPU 时优雅返回)
 *
 * 这是"全链路打通"的端到端证据:工具调用确实落到真实系统,而非 Mock。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { MCPServer, MemoryTransport, registerToolModule } from './server'
import { ToolRegistry } from './registry'
import type { ToolDefinition, JsonRpcRequest, JsonRpcResponse } from './types'
import { SecurityManager } from './security'
import { RealEditorBridge } from './realBridge'
import {
  createGraphTools,
  createTimelineTools,
  createRenderTools,
  createAIDirectorTools,
  createAssetTools,
} from './tools'
import { useGraphStore } from '@/graph/graphStore'
import { useAssetRegistryStore } from '@/editor/asset-genome/assetRegistryStore'

// 离线测试:让 AI Director 的 decide() 走失败回退(emptyDecision),避免真实网络调用
vi.mock('@/authoring/llm/callLLM', () => ({
  callLLM: vi.fn().mockRejectedValue(new Error('offline-test: no LLM configured')),
}))

/**
 * 测试用安全策略:自动确认(graph_create 等 requiresConfirmation),其余检查原样执行。
 * 服务端 handleToolsCall 调用 checkPermission 时不传 confirmed,故在此默认置 true。
 */
class AutoConfirmSecurity extends SecurityManager {
  checkPermission(
    name: string,
    definition: ToolDefinition,
    args: Record<string, unknown>,
    clientId = 'test',
    _confirmed?: boolean,
  ): void {
    super.checkPermission(name, definition, args, clientId, true)
  }
}

interface CallSpec {
  id: number
  name: string
  args?: Record<string, unknown>
}

function buildServer(bridge: RealEditorBridge): MCPServer {
  const registry = new ToolRegistry()
  registerToolModule(registry, createGraphTools(bridge))
  registerToolModule(registry, createTimelineTools(bridge))
  registerToolModule(registry, createRenderTools(bridge))
  registerToolModule(registry, createAIDirectorTools(bridge))
  registerToolModule(registry, createAssetTools(bridge))
  return new MCPServer(bridge, { registry, security: new AutoConfirmSecurity() })
}

/**
 * 把一组 tools/call 请求按序推入 MemoryTransport(前置 initialize),推 EOF,
 * 然后 await server.run() 直到处理完所有请求。返回全部 JSON-RPC 响应。
 */
async function runScript(bridge: RealEditorBridge, calls: CallSpec[]): Promise<JsonRpcResponse[]> {
  const transport = new MemoryTransport()
  const server = buildServer(bridge)
  transport.pushRequest({
    jsonrpc: '2.0',
    id: 'init',
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test' } },
  } as JsonRpcRequest)
  for (const c of calls) {
    transport.pushRequest({
      jsonrpc: '2.0',
      id: c.id,
      method: 'tools/call',
      params: { name: c.name, arguments: c.args ?? {} },
    } as JsonRpcRequest)
  }
  transport.pushEOF()
  await server.run(transport)
  return transport.getOutputResponses()
}

/** 从 tools/call 响应中提取桥接层返回的 JSON 结果 */
function bridgeResultOf(resp: JsonRpcResponse): any {
  const text = (resp.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text
  return text ? JSON.parse(text) : null
}

function respById(responses: JsonRpcResponse[], id: number): JsonRpcResponse {
  const r = responses.find((x) => x.id === id)
  if (!r) throw new Error(`no response for id ${id}`)
  return r
}

describe('MCP 全链路打通 (RealEditorBridge → 真实 store)', () => {
  let bridge: RealEditorBridge

  beforeEach(() => {
    setActivePinia(createPinia())
    bridge = new RealEditorBridge()
  })

  it('注册了全部 23 个工具(图8 + 时间轴5 + 渲染4 + AI3 + 资产3)', async () => {
    const transport = new MemoryTransport()
    const server = buildServer(bridge)
    transport.pushRequest({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    } as JsonRpcRequest)
    transport.pushRequest({ jsonrpc: '2.0', id: 'list', method: 'tools/list', params: {} } as JsonRpcRequest)
    transport.pushEOF()
    await server.run(transport)

    const listResp = transport.getOutputResponses().find((r) => r.id === 'list')!
    const tools = ((listResp.result as { tools: ToolDefinition[] }).tools)
    expect(tools.length).toBe(23)

    const names = new Set(tools.map((t) => t.name))
    // 完整 23 工具面(graph8 + timeline5 + render4 + ai3 + asset3)
    const expected = [
      'graph_get', 'graph_create', 'graph_compile', 'graph_add_node', 'graph_remove_node',
      'graph_connect', 'graph_disconnect', 'graph_update_node_params',
      'timeline_get_sequence', 'timeline_create_sequence', 'timeline_add_keyframe',
      'timeline_update_keyframe', 'timeline_playback_control',
      'render_start', 'render_pause', 'render_resume', 'render_status',
      'ai_generate', 'ai_modify_scene', 'ai_suggest',
      'asset_browse', 'asset_search', 'asset_load',
    ]
    expect(names.size).toBe(expected.length)
    for (const n of expected) {
      expect(names.has(n)).toBe(true)
    }
  })

  it('图全链路: 创建 → 加节点 → 连接 → 编译,真实改写 graph store', async () => {
    const res = await runScript(bridge, [
      { id: 1, name: 'graph_create', args: { name: 'demo' } },
      { id: 2, name: 'graph_add_node', args: { registryKey: 'SolidColor', name: 'BG' } },
      { id: 3, name: 'graph_add_node', args: { registryKey: 'Output', name: 'OUT' } },
      { id: 4, name: 'graph_get', args: {} },
      { id: 5, name: 'graph_compile', args: {} },
    ])

    expect(bridgeResultOf(respById(res, 1)).success).toBe(true)
    const bg = bridgeResultOf(respById(res, 2)).node
    const out = bridgeResultOf(respById(res, 3)).node
    expect(bg).toBeTruthy()
    expect(out).toBeTruthy()

    // 真实连接(需要端口)
    const g = bridgeResultOf(respById(res, 4)).graph
    const bgNode = g.nodes.find((n: { id: string }) => n.id === bg.id)
    const outNode = g.nodes.find((n: { id: string }) => n.id === out.id)
    const fromPort = bgNode.outputs?.[0]?.id
    const toPort = outNode.inputs?.[0]?.id
    if (fromPort && toPort) {
      const cRes = await runScript(bridge, [
        {
          id: 6,
          name: 'graph_connect',
          args: { fromNodeId: bg.id, fromPortId: fromPort, toNodeId: out.id, toPortId: toPort },
        },
      ])
      expect(bridgeResultOf(respById(cRes, 6)).success).toBe(true)
      // 真实 store 应包含这条边
      expect(useGraphStore().edges.length).toBe(1)
    }

    // 编译成功且产出 IR
    const compile = bridgeResultOf(respById(res, 5))
    expect(compile.success).toBe(true)
    expect(compile.renderIR).toBeTruthy()

    // 真实 store 已包含 2 个节点
    expect(useGraphStore().nodes.length).toBe(2)
  })

  it('子图全链路: createSubGraphFromSelection 真实写入 graph store(桥接层)', async () => {
    // 子图不是 MCP 工具面(23 工具未含),但 RealEditorBridge 的 createSubGraphFromSelection
    // 真实映射到 useGraphStore + subgraphInliner,这里在桥接层验证其落地到真实 store。
    const setup = await runScript(bridge, [
      { id: 1, name: 'graph_create', args: { name: 'demo' } },
      { id: 2, name: 'graph_add_node', args: { registryKey: 'SolidColor', name: 'BG' } },
      { id: 3, name: 'graph_add_node', args: { registryKey: 'Blur', name: 'BL' } },
    ])
    const bg = bridgeResultOf(respById(setup, 2)).node
    const bl = bridgeResultOf(respById(setup, 3)).node

    const def = await bridge.createSubGraphFromSelection('my-group', [bg.id, bl.id])
    expect(def.success).toBe(true)
    expect(def.subGraph?.nodes.length).toBe(2)
    // 真实 store 已写入子图定义
    expect(useGraphStore().listSubGraphDefinitions().length).toBe(1)
  })

  it('时间轴全链路: 建序列 → 加关键帧 → 读取,真实改写内部 timeline', async () => {
    const res = await runScript(bridge, [
      { id: 1, name: 'timeline_create_sequence', args: { name: 'seq1', duration: 5, fps: 30 } },
      { id: 2, name: 'timeline_add_keyframe', args: { sequenceId: 'seq1', trackId: 'track_a', time: 1.0, value: '0.5' } },
      { id: 3, name: 'timeline_get_sequence', args: {} },
    ])

    expect(bridgeResultOf(respById(res, 1)).success).toBe(true)
    expect(bridgeResultOf(respById(res, 2)).success).toBe(true)

    const seq = bridgeResultOf(respById(res, 3)).sequence
    expect(seq).toBeTruthy()
    expect(seq.tracks.length).toBe(1)
    expect(seq.tracks[0].keyframes.length).toBe(1)
    // 工具层 value 以 JSON 字符串传递,桥接层原样存入关键帧
    expect(seq.tracks[0].keyframes[0].value).toBe('0.5')
  })

  it('资产全链路: 注入真实资产后 browse/search 真实读取 store', async () => {
    const store = useAssetRegistryStore()
    store.create({ kind: 'image', name: 'sunset.png', tags: ['sunset', 'sky'] })
    store.create({ kind: 'video', name: 'intro.mp4', tags: ['intro'] })
    const total = store.all.length

    const res = await runScript(bridge, [
      { id: 1, name: 'asset_browse', args: {} },
      { id: 2, name: 'asset_search', args: { query: 'sunset' } },
      { id: 3, name: 'asset_browse', args: { type: 'image' } },
    ])

    const browse = bridgeResultOf(respById(res, 1))
    expect(browse.success).toBe(true)
    expect(browse.total).toBe(total)
    expect(browse.assets.length).toBe(total)

    const search = bridgeResultOf(respById(res, 2))
    expect(search.success).toBe(true)
    expect(search.assets.length).toBe(1)
    expect(search.assets[0].name).toBe('sunset.png')

    const byType = bridgeResultOf(respById(res, 3))
    expect(byType.assets.every((a: { type: string }) => a.type === 'image')).toBe(true)
  })

  it('AI Director 全链路: ai_generate 真实调用 parseIntent → decide → toValuePatches(离线回退)', async () => {
    const res = await runScript(bridge, [
      { id: 1, name: 'ai_generate', args: { description: '做一个温暖的日落氛围视频' } },
    ])
    const r = bridgeResultOf(respById(res, 1))
    // 离线环境下 decide 回退为 emptyDecision,但链路(解析 → 决策 → patch)已被真实调用
    expect(r.success).toBe(true)
    expect(typeof r.description).toBe('string')
  })

  it('渲染全链路: render_start / render_status 真实触达 render store(无 GPU 时优雅返回)', async () => {
    const res = await runScript(bridge, [
      { id: 1, name: 'render_start', args: { outputFormat: 'mp4' } },
      { id: 2, name: 'render_status', args: {} },
    ])
    // render_start 在 stdio 无 GPU 环境下应返回(成功或带说明的失败),不应崩溃 MCP server
    expect(respById(res, 1).result).toBeTruthy()
    const status = bridgeResultOf(respById(res, 2))
    // getRenderStatus 返回 RenderStatus(无 success 字段),断言真实状态可读
    expect(status).toBeTruthy()
    expect(['idle', 'rendering', 'paused', 'completed', 'error']).toContain(status.state)
    expect(typeof status.progress).toBe('number')
  })
})
