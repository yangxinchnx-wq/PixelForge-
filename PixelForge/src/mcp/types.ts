/**
 * MCP（Model Context Protocol）协议类型定义。
 *
 * 遵循 MCP 规范 2024-11-05，基于 JSON-RPC 2.0 传输。
 * 参考: https://modelcontextprotocol.io/specification/2024-11-05
 */

// ─── JSON-RPC 2.0 基础类型 ───

/** JSON-RPC 2.0 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 2.0 成功响应 */
export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0'
  id: number | string
  result: unknown
}

/** JSON-RPC 2.0 错误响应 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0'
  id: number | string | null
  error: JsonRpcError
}

/** JSON-RPC 2.0 错误对象 */
export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

/** JSON-RPC 2.0 通知（无 id，无需响应） */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

// ─── MCP 特定类型 ───

/** MCP 服务器能力声明 */
export interface ServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean; listChanged?: boolean }
  prompts?: { listChanged?: boolean }
  logging?: Record<string, unknown>
}

/** MCP initialize 请求参数 */
export interface InitializeParams {
  protocolVersion: string
  capabilities: ClientCapabilities
  clientInfo: {
    name: string
    version: string
  }
}

/** MCP 客户端能力声明 */
export interface ClientCapabilities {
  roots?: { listChanged?: boolean }
  sampling?: Record<string, unknown>
}

/** MCP initialize 响应 */
export interface InitializeResult {
  protocolVersion: string
  capabilities: ServerCapabilities
  serverInfo: {
    name: string
    version: string
  }
}

/** MCP 工具定义 */
export interface ToolDefinition {
  /** 工具名称（唯一标识，使用 snake_case） */
  name: string
  /** 工具描述（LLM 阅读，需清晰准确） */
  description: string
  /** JSON Schema 格式的输入参数定义 */
  inputSchema: JsonSchema
  /** 工具所属模块（自定义扩展） */
  module?: string
  /** 是否为只读工具（自定义扩展，用于安全控制） */
  readOnly?: boolean
  /** 是否需要用户确认（自定义扩展，用于安全控制） */
  requiresConfirmation?: boolean
}

/** JSON Schema 子集 */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null'
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  items?: JsonSchemaProperty
  enum?: (string | number)[]
  default?: unknown
  description?: string
}

/** JSON Schema 属性定义 */
export interface JsonSchemaProperty {
  type: string | string[]
  description?: string
  enum?: (string | number)[]
  default?: unknown
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}

/** tools/list 响应 */
export interface ToolsListResult {
  tools: ToolDefinition[]
}

/** tools/call 请求参数 */
export interface ToolCallParams {
  name: string
  arguments?: Record<string, unknown>
}

/** 工具执行结果 */
export interface ToolResult {
  /** 结果内容列表 */
  content: ToolContent[]
  /** 是否为错误结果 */
  isError?: boolean
}

/** 工具结果内容 */
export interface ToolContent {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
}

// ─── 审计日志类型 ───

/** 审计日志条目 */
export interface AuditLogEntry {
  timestamp: number
  method: string
  toolName?: string
  params?: Record<string, unknown>
  result?: 'success' | 'error'
  error?: string
  duration?: number
  clientId?: string
}

// ─── 服务器配置 ───

/** MCP 服务器配置 */
export interface MCPServerConfig {
  /** 服务器名称 */
  name: string
  /** 服务器版本 */
  version: string
  /** 最大并发请求数 */
  maxConcurrentRequests?: number
  /** 审计日志开关 */
  enableAuditLog?: boolean
  /** 审计日志最大条数 */
  maxAuditLogEntries?: number
  /** 请求超时(ms) */
  requestTimeout?: number
  /** 只读模式（禁止所有写操作） */
  readOnlyMode?: boolean
}
