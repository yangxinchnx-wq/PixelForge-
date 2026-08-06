/**
 * MCP 服务器核心。
 *
 * 实现 JSON-RPC 2.0 over stdio 传输层，处理 MCP 协议方法：
 * - initialize / initialized
 * - tools/list
 * - tools/call
 *
 * 设计为与编辑器桥接解耦，支持多种传输模式。
 */

import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  ToolCallParams,
  ToolsListResult,
  MCPServerConfig,
} from './types'
import {
  ParseError,
  MethodNotFoundError,
  InvalidParamsError,
  InternalError,
  MCPError,
} from './errors'
import { ToolRegistry, getGlobalRegistry } from './registry'
import { SecurityManager } from './security'
import type { EditorBridge } from './bridge'

// ─── 传输层接口 ───

/**
 * 传输层读写接口。
 *
 * 抽象 JSON-RPC 消息的收发，支持：
 * - stdio（默认 MCP 传输）
 * - WebSocket（远程调试）
 * - 内存（测试用）
 */
export interface Transport {
  /** 读取一行 JSON-RPC 消息 */
  readLine(): Promise<string | null>
  /** 写入一行 JSON-RPC 响应 */
  writeLine(line: string): Promise<void>
  /** 关闭传输 */
  close(): Promise<void>
}

/**
 * stdio 传输实现。
 *
 * 使用 process.stdin/stdout 进行 JSON-RPC 通信。
 * 严格按行分隔消息（MCP 规范要求）。
 *
 * 注意：此类仅在 Node.js 环境下可用（MCP 服务端进程），
 * 不要在浏览器/Vite 前端代码中使用。
 */
export class StdioTransport implements Transport {
  private buffer = ''
  private lineResolve: ((line: string | null) => void) | null = null
  private closed = false

  constructor() {
    // 动态获取 process，避免在浏览器环境中直接引用
    const proc = (globalThis as any).process as any
    if (!proc?.stdin || !proc?.stdout) {
      throw new Error('StdioTransport requires Node.js environment with process.stdin/stdout')
    }

    // 设置 stdin 编码为 UTF-8
    proc.stdin.setEncoding('utf-8')

    proc.stdin.on('data', (chunk: string) => {
      this.buffer += chunk
      this.tryResolve()
    })

    proc.stdin.on('end', () => {
      this.closed = true
      if (this.lineResolve) {
        this.lineResolve(null)
        this.lineResolve = null
      }
    })
  }

  private tryResolve(): void {
    if (!this.lineResolve) return

    const newlineIdx = this.buffer.indexOf('\n')
    if (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newlineIdx + 1)
      const resolve = this.lineResolve
      this.lineResolve = null
      resolve(line)
    }
  }

  async readLine(): Promise<string | null> {
    if (this.closed) return null

    // 先检查 buffer 中是否有完整行
    const newlineIdx = this.buffer.indexOf('\n')
    if (newlineIdx !== -1) {
      const line = this.buffer.slice(0, newlineIdx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newlineIdx + 1)
      return line
    }

    // 等待数据到达
    return new Promise<string | null>((resolve) => {
      this.lineResolve = resolve
    })
  }

  async writeLine(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = (globalThis as any).process as any
      proc.stdout.write(line + '\n', (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async close(): Promise<void> {
    this.closed = true
    if (this.lineResolve) {
      this.lineResolve(null)
      this.lineResolve = null
    }
  }
}

/**
 * 内存传输（测试用）。
 *
 * 使用 Promise 队列模拟输入，收集输出到数组。
 */
export class MemoryTransport implements Transport {
  private inputQueue: string[] = []
  private inputResolvers: ((line: string | null) => void)[] = []
  public outputLines: string[] = []
  private eofReached = false

  /** 向输入队列添加一行（普通输入） */
  pushInput(line: string): void {
    const resolver = this.inputResolvers.shift()
    if (resolver) {
      resolver(line)
    } else {
      this.inputQueue.push(line)
    }
  }

  /** 发送 EOF 信号：队列清空后 readLine 返回 null，使 run() 主循环退出 */
  pushEOF(): void {
    this.eofReached = true
    const resolver = this.inputResolvers.shift()
    if (resolver) {
      resolver(null)
    }
  }

  /** 发送一个完整的 JSON-RPC 请求 */
  pushRequest(request: JsonRpcRequest): void {
    this.pushInput(JSON.stringify(request))
  }

  async readLine(): Promise<string | null> {
    const queued = this.inputQueue.shift()
    if (queued !== undefined) return queued

    if (this.eofReached) return null

    return new Promise<string | null>((resolve) => {
      this.inputResolvers.push(resolve)
    })
  }

  async writeLine(line: string): Promise<void> {
    this.outputLines.push(line)
  }

  async close(): Promise<void> {
    this.eofReached = true
    for (const resolve of this.inputResolvers) {
      resolve(null)
    }
    this.inputResolvers = []
  }

  /** 获取所有输出的解析结果 */
  getOutputResponses(): JsonRpcResponse[] {
    return this.outputLines.map((line) => JSON.parse(line) as JsonRpcResponse)
  }

  /** 清空输出缓冲区 */
  clearOutput(): void {
    this.outputLines = []
  }
}

// ─── MCP 服务器 ───

/**
 * MCP 服务器。
 *
 * 处理 JSON-RPC 2.0 消息，路由到对应的 MCP 方法。
 * 协调工具注册中心、安全管理和编辑器桥接。
 */
export class MCPServer {
  private readonly config: Required<MCPServerConfig>
  private readonly registry: ToolRegistry
  private readonly security: SecurityManager
  /** 编辑器桥接实例（保留引用以支持未来扩展） */
  private readonly _bridge: EditorBridge
  private _initialized = false
  private running = false

  constructor(
    bridge: EditorBridge,
    options?: {
      config?: Partial<MCPServerConfig>
      registry?: ToolRegistry
      security?: SecurityManager
    },
  ) {
    this._bridge = bridge
    this.registry = options?.registry ?? getGlobalRegistry()
    this.security = options?.security ?? new SecurityManager({
      readOnlyMode: options?.config?.readOnlyMode,
      maxAuditEntries: options?.config?.maxAuditLogEntries,
    })

    this.config = {
      name: options?.config?.name ?? 'PixelForge MCP Server',
      version: options?.config?.version ?? '1.0.0',
      maxConcurrentRequests: options?.config?.maxConcurrentRequests ?? 10,
      enableAuditLog: options?.config?.enableAuditLog ?? true,
      maxAuditLogEntries: options?.config?.maxAuditLogEntries ?? 10000,
      requestTimeout: options?.config?.requestTimeout ?? 30000,
      readOnlyMode: options?.config?.readOnlyMode ?? false,
    }
  }

  /**
   * 获取服务器配置。
   */
  getConfig(): MCPServerConfig {
    return { ...this.config }
  }

  /**
   * 获取安全策略管理器。
   */
  getSecurityManager(): SecurityManager {
    return this.security
  }

  /**
   * 获取工具注册中心。
   */
  getRegistry(): ToolRegistry {
    return this.registry
  }

  /**
   * 获取编辑器桥接实例。
   */
  getBridge(): EditorBridge {
    return this._bridge
  }

  /**
   * 服务器是否已完成初始化握手。
   */
  get isInitialized(): boolean {
    return this._initialized
  }

  /**
   * 运行服务器（阻塞直到传输关闭）。
   *
   * 主循环：读取 → 解析 → 处理 → 响应。
   */
  async run(transport: Transport): Promise<void> {
    this.running = true

    while (this.running) {
      let line: string | null
      try {
        line = await transport.readLine()
      } catch {
        break
      }

      if (line === null) break // EOF

      const trimmed = line.trim()
      if (trimmed === '') continue

      let response: JsonRpcResponse | null = null
      let request: JsonRpcRequest | JsonRpcNotification | null = null

      // 解析 JSON
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest | JsonRpcNotification
      } catch (parseError) {
        response = this.makeErrorResponse(
          null,
          new ParseError(`Invalid JSON: ${parseError instanceof Error ? parseError.message : parseError}`),
        )
      }

      if (request && response === null) {
        // 判断是请求还是通知（有 id 是请求，无 id 是通知）
        const isNotification = !('id' in request)

        try {
          if (isNotification) {
            // 通知不需要响应
            await this.handleNotification(request as JsonRpcNotification)
            continue
          } else {
            response = await this.handleRequest(request as JsonRpcRequest)
          }
        } catch (error) {
          const req = request as JsonRpcRequest
          if (error instanceof MCPError) {
            response = this.makeErrorResponse(req.id, error)
          } else {
            response = this.makeErrorResponse(
              req.id,
              new InternalError(
                error instanceof Error ? error.message : String(error),
              ),
            )
          }
        }
      }

      if (response) {
        await transport.writeLine(JSON.stringify(response))
      }
    }

    // 注意：不在此处关闭 transport。
    // transport 的生命周期由调用方(生产环境 main / 测试)拥有，
    // 允许同一个 transport 被多次 run()（例如 MCP-I11 的两阶段流程）。
  }

  /**
   * 停止服务器。
   */
  stop(): void {
    this.running = false
  }

  // ─── 请求路由 ───

  /**
   * 处理 JSON-RPC 请求（有 id，需要响应）。
   */
  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = request

    switch (method) {
      case 'initialize':
        return this.handleInitialize(id, params as unknown as InitializeParams)

      case 'initialized':
        this._initialized = true
        return this.makeSuccessResponse(id, {})

      case 'tools/list':
        return this.handleToolsList(id)

      case 'tools/call':
        return this.handleToolsCall(id, params as unknown as ToolCallParams)

      case 'ping':
        return this.makeSuccessResponse(id, {})

      default:
        throw new MethodNotFoundError(method)
    }
  }

  /**
   * 处理 JSON-RPC 通知（无 id，不需要响应）。
   */
  private async handleNotification(notification: JsonRpcNotification): Promise<void> {
    switch (notification.method) {
      case 'initialized':
        this._initialized = true
        break

      case 'notifications/cancelled':
        // 取消通知，忽略
        break

      default:
        // 未知通知，静默忽略（MCP 规范允许）
        break
    }
  }

  // ─── MCP 方法实现 ───

  /**
   * 处理 initialize 请求。
   *
   * 返回服务器能力和信息。
   */
  private handleInitialize(id: string | number, params: InitializeParams): JsonRpcResponse {
    if (!params || !params.protocolVersion) {
      return this.makeErrorResponse(id, new InvalidParamsError('Missing required parameter: protocolVersion'))
    }

    this._initialized = true

    const result: InitializeResult = {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: this.config.name,
        version: this.config.version,
      },
    }

    this.security.logRequest('initialize', params.clientInfo?.name)
    return this.makeSuccessResponse(id, result)
  }

  /**
   * 处理 tools/list 请求。
   *
   * 返回所有已注册工具的定义。
   */
  private handleToolsList(id: string | number): JsonRpcResponse {
    const tools = this.registry.listTools()
    const result: ToolsListResult = { tools }
    this.security.logRequest('tools/list')
    return this.makeSuccessResponse(id, result)
  }

  /**
   * 处理 tools/call 请求。
   *
   * 验证参数 → 检查权限 → 执行工具 → 返回结果。
   */
  private async handleToolsCall(
    id: string | number,
    params: ToolCallParams,
  ): Promise<JsonRpcResponse> {
    if (!params || !params.name) {
      return this.makeErrorResponse(
        id,
        new InvalidParamsError('Missing required parameter: name'),
      )
    }

    const { name, arguments: args } = params
    const toolArgs = args ?? {}

    // 查找工具定义
    const definition = this.registry.getDefinition(name)
    if (!definition) {
      return this.makeErrorResponse(id, new MethodNotFoundError(`Tool not found: ${name}`))
    }

    // 安全检查
    try {
      this.security.checkPermission(name, definition, toolArgs)
    } catch (error) {
      if (error instanceof MCPError) {
        return this.makeErrorResponse(id, error)
      }
      throw error
    }

    // 执行工具
    const startTime = Date.now()
    try {
      const result = await this.registry.call(name, toolArgs)
      const duration = Date.now() - startTime

      if (this.config.enableAuditLog) {
        this.security.logCall(name, toolArgs, 'success', undefined, duration)
      }

      return this.makeSuccessResponse(id, result)
    } catch (error) {
      const duration = Date.now() - startTime
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (this.config.enableAuditLog) {
        this.security.logCall(name, toolArgs, 'error', errorMsg, duration)
      }

      if (error instanceof MCPError) {
        return this.makeErrorResponse(id, error)
      }

      return this.makeErrorResponse(
        id,
        new InternalError(`Tool execution failed: ${errorMsg}`),
      )
    }
  }

  // ─── 响应构建 ───

  private makeSuccessResponse(id: string | number, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
  }

  private makeErrorResponse(id: string | number | null, error: MCPError): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: id ?? 0,
      error: error.toJsonRpcError(),
    } as JsonRpcResponse
  }
}

// ─── 工具注册便捷函数 ───

/**
 * 注册图模块工具。
 *
 * 遍历模块中的所有工具定义，注册到全局注册中心。
 */
export function registerToolModule(
  registry: ToolRegistry,
  tools: Array<{
    definition: import('./types').ToolDefinition
    handler: import('./registry').ToolHandler
  }>,
): void {
  for (const { definition, handler } of tools) {
    registry.register(definition, handler)
  }
}
