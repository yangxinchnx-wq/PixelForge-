/**
 * MCP 模块入口。
 *
 * 导出 MCP 服务器的公共 API。
 */

// 核心服务器
export { MCPServer, StdioTransport, MemoryTransport, registerToolModule } from './server'
export type { Transport } from './server'

// 工具注册中心
export { ToolRegistry, getGlobalRegistry, resetGlobalRegistry, registerTool } from './registry'
export type { ToolHandler } from './registry'

// 安全管理
export { SecurityManager, AuditLogger, RateLimiter } from './security'
export type { SecurityPolicy } from './security'

// 编辑器桥接
export { MockEditorBridge } from './bridge'
export type {
  EditorBridge,
  GraphResult,
  NodeResult,
  EdgeResult,
  CompileResult,
  SubGraphResult,
  Sequence,
  Track,
  Keyframe,
  SequenceResult,
  KeyframeResult,
  RenderStatus,
  ScreenshotResult,
  AssetType,
  AssetInfo,
  AssetListResult,
  AssetOperationResult,
  GenerationResult,
  SuggestionResult,
} from './bridge'

// 错误类型
export {
  MCPError,
  ParseError,
  InvalidRequestError,
  MethodNotFoundError,
  InvalidParamsError,
  InternalError,
  ToolNotFoundError,
  ToolExecutionError,
  ValidationError,
  SecurityError,
  ReadOnlyError,
  ConfirmationRequiredError,
  JsonRpcErrorCode,
  PixelForgeErrorCode,
} from './errors'

// 协议类型
export type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  JsonRpcErrorResponse,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
  ClientCapabilities,
  ToolDefinition,
  ToolsListResult,
  ToolCallParams,
  ToolResult,
  ToolContent,
  MCPServerConfig,
  AuditLogEntry,
} from './types'

// LLM 规范
export { LLM_SPECIFICATION, getLLMSpecification } from './llm-spec'

// 工具模块
export {
  createGraphTools,
  createTimelineTools,
  createRenderTools,
  createAIDirectorTools,
  createAssetTools,
} from './tools'

// ─── 便捷启动函数 ───

import { MCPServer } from './server'
import { getGlobalRegistry } from './registry'
import type { EditorBridge } from './bridge'
import type { MCPServerConfig } from './types'
import {
  createGraphTools,
  createTimelineTools,
  createRenderTools,
  createAIDirectorTools,
  createAssetTools,
} from './tools'
import { registerToolModule } from './server'

/**
 * 一键启动 MCP 服务器。
 *
 * 注册所有工具模块，创建服务器实例，绑定传输层，开始消息循环。
 *
 * @param bridge - 编辑器桥接实例
 * @param options - 可选配置
 * @returns MCP 服务器实例
 */
export function startMCPServer(
  bridge: EditorBridge,
  options?: {
    config?: Partial<MCPServerConfig>
    /** 是否注册默认工具模块（默认 true） */
    registerDefaultTools?: boolean
  },
): MCPServer {
  const registry = getGlobalRegistry()

  // 注册所有工具模块
  if (options?.registerDefaultTools !== false) {
    registerToolModule(registry, createGraphTools(bridge))
    registerToolModule(registry, createTimelineTools(bridge))
    registerToolModule(registry, createRenderTools(bridge))
    registerToolModule(registry, createAIDirectorTools(bridge))
    registerToolModule(registry, createAssetTools(bridge))
  }

  const server = new MCPServer(bridge, {
    config: options?.config,
    registry,
  })

  return server
}
