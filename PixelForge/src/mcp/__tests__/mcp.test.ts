/**
 * MCP 模块单元测试。
 *
 * 覆盖：
 * - JSON-RPC 2.0 协议正确性
 * - 工具注册中心
 * - 安全控制
 * - 图模块工具（通过 MockEditorBridge）
 * - 参数验证
 * - 错误处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ToolRegistry, resetGlobalRegistry } from '../registry'
import {
  ToolNotFoundError,
  ToolExecutionError,
  ValidationError,
  JsonRpcErrorCode,
  PixelForgeErrorCode,
} from '../errors'
import { SecurityManager, AuditLogger, RateLimiter } from '../security'
import { MCPServer, MemoryTransport, registerToolModule } from '../server'
import { MockEditorBridge } from '../bridge'
import { LLM_SPECIFICATION } from '../llm-spec'
import type { ToolDefinition, JsonRpcRequest } from '../types'
import {
  createGraphTools,
  createTimelineTools,
  createRenderTools,
  createAIDirectorTools,
  createAssetTools,
} from '../tools'

// ─── 辅助函数 ───

function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: { type: 'object', properties: {}, required: [] },
    ...overrides,
  }
}

function makeRequest(
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, params }
}

/** 获取 transport 输出的响应列表（类型断言为 any[] 方便测试中访问 result/error） */
function getResponses(t: MemoryTransport): any[] {
  return t.getOutputResponses() as any[]
}

// ─── ToolRegistry 测试 ───

describe('ToolRegistry', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = new ToolRegistry()
  })

  it('MC-R01: 注册和查找工具', () => {
    const def = makeToolDef({ name: 'my_tool' })
    const handler = vi.fn().mockReturnValue({ content: [] })

    registry.register(def, handler)

    expect(registry.has('my_tool')).toBe(true)
    expect(registry.getDefinition('my_tool')).toBe(def)
    expect(registry.size).toBe(1)
  })

  it('MC-R02: 禁止重复注册同名工具', () => {
    const def = makeToolDef({ name: 'dup_tool' })
    registry.register(def, vi.fn())

    expect(() => registry.register(def, vi.fn())).toThrow(/already registered/)
  })

  it('MC-R03: 注销工具', () => {
    registry.register(makeToolDef({ name: 'rm_tool' }), vi.fn())
    expect(registry.has('rm_tool')).toBe(true)

    registry.unregister('rm_tool')
    expect(registry.has('rm_tool')).toBe(false)
    expect(registry.size).toBe(0)
  })

  it('MC-R04: listTools 按注册顺序返回', () => {
    registry.register(makeToolDef({ name: 'b_tool' }), vi.fn())
    registry.register(makeToolDef({ name: 'a_tool' }), vi.fn())
    registry.register(makeToolDef({ name: 'c_tool' }), vi.fn())

    const tools = registry.listTools()
    expect(tools.map((t) => t.name)).toEqual(['b_tool', 'a_tool', 'c_tool'])
  })

  it('MC-R05: listToolsByModule 按模块过滤', () => {
    registry.register(makeToolDef({ name: 'g1', module: 'graph' }), vi.fn())
    registry.register(makeToolDef({ name: 'g2', module: 'graph' }), vi.fn())
    registry.register(makeToolDef({ name: 't1', module: 'timeline' }), vi.fn())

    const graphTools = registry.listToolsByModule('graph')
    expect(graphTools).toHaveLength(2)
    expect(graphTools.map((t) => t.name)).toEqual(['g1', 'g2'])
  })

  it('MC-R06: listModules 返回所有模块', () => {
    registry.register(makeToolDef({ name: 'g1', module: 'graph' }), vi.fn())
    registry.register(makeToolDef({ name: 't1', module: 'timeline' }), vi.fn())

    expect(registry.listModules()).toEqual(['graph', 'timeline'])
  })

  it('MC-R07: call 成功执行工具', async () => {
    const handler = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    })
    registry.register(makeToolDef({ name: 'ok_tool' }), handler)

    const result = await registry.call('ok_tool', { x: 1 })
    expect(result.content[0]).toEqual({ type: 'text', text: 'ok' })
    expect(handler).toHaveBeenCalledWith({ x: 1 })
  })

  it('MC-R08: call 工具不存在时抛出 ToolNotFoundError', async () => {
    await expect(registry.call('nonexistent')).rejects.toThrow(ToolNotFoundError)
  })

  it('MC-R09: call 缺少必填参数时抛出 ValidationError', async () => {
    registry.register(
      makeToolDef({
        name: 'req_tool',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
      }),
      vi.fn(),
    )

    await expect(registry.call('req_tool', {})).rejects.toThrow(ValidationError)
  })

  it('MC-R10: call 参数类型不匹配时抛出 ValidationError', async () => {
    registry.register(
      makeToolDef({
        name: 'type_tool',
        inputSchema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
          required: [],
        },
      }),
      vi.fn(),
    )

    await expect(registry.call('type_tool', { count: 'not_a_number' })).rejects.toThrow(
      ValidationError,
    )
  })

  it('MC-R11: call enum 参数验证', async () => {
    registry.register(
      makeToolDef({
        name: 'enum_tool',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['fast', 'slow'] },
          },
          required: [],
        },
      }),
      vi.fn(),
    )

    await expect(registry.call('enum_tool', { mode: 'invalid' })).rejects.toThrow(ValidationError)
  })

  it('MC-R12: call 数值范围验证', async () => {
    registry.register(
      makeToolDef({
        name: 'range_tool',
        inputSchema: {
          type: 'object',
          properties: {
            val: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: [],
        },
      }),
      vi.fn(),
    )

    await expect(registry.call('range_tool', { val: -5 })).rejects.toThrow(ValidationError)
    await expect(registry.call('range_tool', { val: 200 })).rejects.toThrow(ValidationError)
  })

  it('MC-R13: call 处理器抛错时包装为 ToolExecutionError', async () => {
    registry.register(
      makeToolDef({ name: 'throw_tool' }),
      () => { throw new Error('boom') },
    )

    await expect(registry.call('throw_tool')).rejects.toThrow(ToolExecutionError)
  })

  it('MC-R14: call 无参数调用时使用空对象', async () => {
    const handler = vi.fn().mockResolvedValue({ content: [] })
    registry.register(makeToolDef({ name: 'no_args' }), handler)

    await registry.call('no_args')
    expect(handler).toHaveBeenCalledWith({})
  })
})

// ─── SecurityManager 测试 ───

describe('SecurityManager', () => {
  let security: SecurityManager

  beforeEach(() => {
    security = new SecurityManager()
  })

  it('MC-S01: 正常操作通过权限检查', () => {
    const def = makeToolDef({ name: 'safe_tool', readOnly: true })
    expect(() => security.checkPermission('safe_tool', def, {})).not.toThrow()
  })

  it('MC-S02: 只读模式下阻止写操作', () => {
    security.setReadOnlyMode(true)
    const def = makeToolDef({ name: 'write_tool', readOnly: false })

    expect(() => security.checkPermission('write_tool', def, {})).toThrow('read-only mode')
  })

  it('MC-S03: 只读模式允许只读工具', () => {
    security.setReadOnlyMode(true)
    const def = makeToolDef({ name: 'read_tool', readOnly: true })

    expect(() => security.checkPermission('read_tool', def, {})).not.toThrow()
  })

  it('MC-S04: 禁止工具被阻止', () => {
    security.addBlockedTool('dangerous_tool')
    const def = makeToolDef({ name: 'dangerous_tool' })

    expect(() => security.checkPermission('dangerous_tool', def, {})).toThrow('blocked')
  })

  it('MC-S05: 需要确认时未确认被阻止', () => {
    const def = makeToolDef({ name: 'confirm_tool', requiresConfirmation: true })

    expect(() => security.checkPermission('confirm_tool', def, {}, 'default', false)).toThrow(
      'confirmation',
    )
  })

  it('MC-S06: 需要确认时已确认通过', () => {
    const def = makeToolDef({ name: 'confirm_tool', requiresConfirmation: true })

    expect(() =>
      security.checkPermission('confirm_tool', def, {}, 'default', true),
    ).not.toThrow()
  })

  it('MC-S07: 速率限制', () => {
    const limiter = new RateLimiter(1000, 3) // 1秒内最多3次

    expect(limiter.check('client1')).toBe(true)
    expect(limiter.check('client1')).toBe(true)
    expect(limiter.check('client1')).toBe(true)
    expect(limiter.check('client1')).toBe(false) // 第4次被限制
  })

  it('MC-S08: 速率限制独立计数', () => {
    const limiter = new RateLimiter(1000, 2)

    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('a')).toBe(false) // a 达到限制
    expect(limiter.check('b')).toBe(true) // b 独立计数
  })

  it('MC-S09: 审计日志记录', () => {
    const logger = new AuditLogger(100)
    logger.log({ method: 'tools/call', toolName: 'test', result: 'success' })
    logger.log({ method: 'tools/call', toolName: 'test', result: 'error', error: 'fail' })

    expect(logger.size).toBe(2)
    expect(logger.getErrors()).toHaveLength(1)
    expect(logger.getByTool('test')).toHaveLength(2)
  })

  it('MC-S10: 审计日志环形缓冲区', () => {
    const logger = new AuditLogger(3)

    logger.log({ method: 'a' })
    logger.log({ method: 'b' })
    logger.log({ method: 'c' })
    logger.log({ method: 'd' })

    expect(logger.size).toBe(3)
    expect(logger.getRecent(10)[0].method).toBe('b') // a 被移除
  })

  it('MC-S11: getPolicySnapshot 返回策略副本', () => {
    security.setReadOnlyMode(true)
    security.addBlockedTool('x')
    security.addConfirmationRequired('y')

    const snap = security.getPolicySnapshot()
    expect(snap.readOnlyMode).toBe(true)
    expect(snap.blockedTools).toContain('x')
    expect(snap.confirmationRequired).toContain('y')
  })
})

// ─── MCPServer 集成测试 ───

describe('MCPServer', () => {
  let bridge: MockEditorBridge
  let server: MCPServer
  let transport: MemoryTransport

  beforeEach(() => {
    bridge = new MockEditorBridge()
    resetGlobalRegistry()

    server = new MCPServer(bridge, {
      config: { enableAuditLog: false },
    })

    // 注册所有工具模块
    const registry = server.getRegistry()
    registerToolModule(registry, createGraphTools(bridge))
    registerToolModule(registry, createTimelineTools(bridge))
    registerToolModule(registry, createRenderTools(bridge))
    registerToolModule(registry, createAIDirectorTools(bridge))
    registerToolModule(registry, createAssetTools(bridge))

    transport = new MemoryTransport()
  })

  async function sendAndCollect(requests: JsonRpcRequest[]): Promise<any[]> {
    for (const req of requests) {
      transport.pushRequest(req)
    }
    // 发送一个关闭信号
    transport.pushEOF()

    // 运行服务器（会处理所有请求然后遇到 EOF 停止）
    await server.run(transport)
    return getResponses(transport) as any[]
  }

  it('MC-I01: initialize 返回正确的能力声明', async () => {
    const [resp] = await sendAndCollect([
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    ])

    const result = resp.result as any
    expect(result.protocolVersion).toBe('2024-11-05')
    expect(result.capabilities.tools).toBeDefined()
    expect(result.serverInfo.name).toBe('PixelForge MCP Server')
  })

  it('MC-I02: tools/list 返回所有注册工具', async () => {
    // 先 initialize
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(makeRequest('tools/list'))
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    expect(responses).toHaveLength(2)

    const listResult = responses[1].result as any
    expect(listResult.tools).toBeDefined()
    expect(listResult.tools.length).toBeGreaterThan(0)

    // 验证包含图模块工具
    const toolNames = listResult.tools.map((t: any) => t.name)
    expect(toolNames).toContain('graph_get')
    expect(toolNames).toContain('graph_add_node')
    expect(toolNames).toContain('timeline_get_sequence')
    expect(toolNames).toContain('render_start')
    expect(toolNames).toContain('ai_generate')
    expect(toolNames).toContain('asset_browse')
  })

  it('MC-I03: tools/call graph_get 返回空图', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', { name: 'graph_get', arguments: {} }),
    )
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    const callResult = responses[1].result as any
    expect(callResult.content).toBeDefined()
    expect(callResult.content[0].type).toBe('text')

    const graphData = JSON.parse(callResult.content[0].text)
    expect(graphData.success).toBe(true)
    expect(graphData.graph.nodes).toEqual([])
    expect(graphData.graph.edges).toEqual([])
  })

  it('MC-I04: tools/call graph_add_node 添加节点', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'graph_add_node',
        arguments: {
          registryKey: 'SolidColor',
          name: '红色背景',
          x: 100,
          y: 200,
          params: { color: '#FF0000' },
        },
      }),
    )
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    const result = JSON.parse((responses[1].result as any).content[0].text)
    expect(result.success).toBe(true)
    expect(result.node).toBeDefined()
    expect(result.node.name).toBe('红色背景')
    expect(result.node.type).toBe('REGION')
  })

  it('MC-I05: tools/call 不存在的工具返回错误', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', { name: 'nonexistent_tool', arguments: {} }),
    )
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    expect(responses[1].error).toBeDefined()
    expect(responses[1].error!.code).toBe(JsonRpcErrorCode.MethodNotFound)
  })

  it('MC-I06: 未知方法返回 MethodNotFound', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(makeRequest('unknown_method'))
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    expect(responses[1].error).toBeDefined()
    expect(responses[1].error!.code).toBe(JsonRpcErrorCode.MethodNotFound)
  })

  it('MC-I07: ping 返回成功', async () => {
    transport.pushRequest(makeRequest('ping', undefined, 42))
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    expect(responses[0].id).toBe(42)
    expect((responses[0] as any).result).toBeDefined()
    expect((responses[0] as any).error).toBeUndefined()
  })

  it('MC-I08: 无效 JSON 返回 ParseError', async () => {
    transport.pushInput('{invalid json!!!')
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    expect(responses[0].error).toBeDefined()
    expect(responses[0].error!.code).toBe(JsonRpcErrorCode.ParseError)
  })

  it('MC-I09: 缺少 name 参数的 tools/call 返回错误', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', { arguments: {} }), // 缺少 name
    )
    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    expect(responses[1].error).toBeDefined()
    expect(responses[1].error!.code).toBe(JsonRpcErrorCode.InvalidParams)
  })

  it('MC-I10: 完整工作流——创建图 → 添加节点 → 连接 → 编译', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )

    // 创建新图
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'graph_create',
        arguments: { name: '测试图', width: 1920, height: 1080 },
      }),
    )

    // 添加 SolidColor 节点
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'graph_add_node',
        arguments: {
          registryKey: 'SolidColor',
          name: '红色',
          params: { color: '#FF0000' },
        },
      }),
    )

    // 添加 Output 节点
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'graph_add_node',
        arguments: { registryKey: 'Output', name: '输出' },
      }),
    )

    // 编译（应该成功，即使没有连接，MockEditorBridge 不做真实校验）
    transport.pushRequest(
      makeRequest('tools/call', { name: 'graph_compile', arguments: {} }),
    )

    transport.pushEOF()
    await server.run(transport)

    const responses = getResponses(transport)
    // 应有 5 个响应（initialize + 4 个 tools/call）
    expect(responses).toHaveLength(5)

    // graph_create 是破坏性操作，按安全设计需要用户确认，未确认时应返回 -32083
    expect((responses[1] as any).error).toBeDefined()
    expect((responses[1] as any).error.code).toBe(PixelForgeErrorCode.ConfirmationRequired)
    expect((responses[1] as any).error.message).toContain('requires explicit user confirmation')

    // 其余操作应成功（在默认空图上执行）
    for (let i = 2; i < 5; i++) {
      expect((responses[i] as any).error).toBeUndefined()
      const result = JSON.parse((responses[i].result as any).content[0].text)
      expect(result.success).toBe(true)
    }
  })

  it('MC-I11: graph_update_node_params 更新参数', async () => {
    // 先添加节点
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'graph_add_node',
        arguments: {
          registryKey: 'Blur',
          name: '模糊',
          params: { radius: 5 },
        },
      }),
    )
    transport.pushEOF()
    await server.run(transport)

    // 获取节点 ID
    const addResult = JSON.parse(
      (getResponses(transport)[1].result as any).content[0].text,
    )
    const nodeId = addResult.node.id

    // 更新参数
    transport.clearOutput()
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'graph_update_node_params',
        arguments: { nodeId, params: { radius: 10 } },
      }),
    )
    transport.pushEOF()
    await server.run(transport)

    const updateResult = JSON.parse(
      (getResponses(transport)[1].result as any).content[0].text,
    )
    expect(updateResult.success).toBe(true)
  })

  it('MC-I12: timeline_create_sequence 创建序列', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'timeline_create_sequence',
        arguments: { name: '主序列', duration: 30, fps: 30 },
      }),
    )
    transport.pushEOF()
    await server.run(transport)

    const result = JSON.parse(
      (getResponses(transport)[1].result as any).content[0].text,
    )
    expect(result.success).toBe(true)
    expect(result.sequence.name).toBe('主序列')
    expect(result.sequence.duration).toBe(30)
    expect(result.sequence.fps).toBe(30)
  })

  it('MC-I13: render_status 返回渲染状态', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', { name: 'render_status', arguments: {} }),
    )
    transport.pushEOF()
    await server.run(transport)

    const result = JSON.parse(
      (getResponses(transport)[1].result as any).content[0].text,
    )
    expect(result.state).toBe('idle')
  })

  it('MC-I14: ai_generate 生成场景', async () => {
    transport.pushRequest(
      makeRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    )
    transport.pushRequest(
      makeRequest('tools/call', {
        name: 'ai_generate',
        arguments: {
          description: '夕阳下的海边，天空是橙色渐变，海面有波浪效果',
          style: 'cinematic',
          duration: 10,
        },
      }),
    )
    transport.pushEOF()
    await server.run(transport)

    const result = JSON.parse(
      (getResponses(transport)[1].result as any).content[0].text,
    )
    expect(result.success).toBe(true)
  })
})

// ─── LLM 规范测试 ───

describe('LLM Specification', () => {
  it('MC-L01: 规范文本长度 ≥ 30 字', () => {
    // 核心注意事项部分
    const coreSection = LLM_SPECIFICATION.split('核心原则')[1]?.split('##')[0] ?? ''
    // 去掉空白后检查长度
    const cleanText = coreSection.replace(/\s/g, '')
    expect(cleanText.length).toBeGreaterThanOrEqual(30)
  })

  it('MC-L02: 规范包含关键章节', () => {
    expect(LLM_SPECIFICATION).toContain('核心原则')
    expect(LLM_SPECIFICATION).toContain('查询优先原则')
    expect(LLM_SPECIFICATION).toContain('破坏性操作确认')
    expect(LLM_SPECIFICATION).toContain('参数规范')
    expect(LLM_SPECIFICATION).toContain('错误处理')
    expect(LLM_SPECIFICATION).toContain('安全约束')
  })
})

// ─── MemoryTransport 测试 ───

describe('MemoryTransport', () => {
  it('MC-T01: pushInput 后 readLine 返回数据', async () => {
    const transport = new MemoryTransport()
    transport.pushInput('hello')
    transport.pushInput('world')

    expect(await transport.readLine()).toBe('hello')
    expect(await transport.readLine()).toBe('world')
  })

  it('MC-T02: close 后 readLine 返回 null', async () => {
    const transport = new MemoryTransport()
    await transport.close()
    expect(await transport.readLine()).toBeNull()
  })

  it('MC-T03: writeLine 收集到 outputLines', async () => {
    const transport = new MemoryTransport()
    await transport.writeLine('line1')
    await transport.writeLine('line2')
    expect(transport.outputLines).toEqual(['line1', 'line2'])
  })

  it('MC-T04: clearOutput 清空输出', async () => {
    const transport = new MemoryTransport()
    await transport.writeLine('line')
    transport.clearOutput()
    expect(transport.outputLines).toEqual([])
  })

  it('MC-T05: 先 readLine 后 pushInput 能正确返回', async () => {
    const transport = new MemoryTransport()

    // 先开始读（会挂起）
    const readPromise = transport.readLine()

    // 然后推入数据
    transport.pushInput('delayed')

    // 应该能正确返回
    expect(await readPromise).toBe('delayed')
  })
})
