/**
 * MCP 错误类型定义。
 *
 * 遵循 JSON-RPC 2.0 错误码规范，并扩展 PixelForge 自定义错误码。
 */

// ─── JSON-RPC 2.0 标准错误码 ───

/** JSON-RPC 2.0 标准错误码 */
export enum JsonRpcErrorCode {
  /** 无效的 JSON */
  ParseError = -32700,
  /** 无效的 JSON-RPC 请求 */
  InvalidRequest = -32600,
  /** 方法不存在 */
  MethodNotFound = -32601,
  /** 无效的参数 */
  InvalidParams = -32602,
  /** 内部错误 */
  InternalError = -32603,
}

/** PixelForge 自定义错误码（-32000 到 -32099 范围） */
export enum PixelForgeErrorCode {
  // 通用
  InternalError = -32000,

  // 图相关
  GraphNotFound = -32001,
  GraphValidationFailed = -32002,
  GraphCompileError = -32003,
  GraphCycleDetected = -32004,

  // 节点相关
  NodeNotFound = -32010,
  NodeRegistryKeyInvalid = -32011,
  NodePortMismatch = -32012,
  NodeAlreadyExists = -32013,

  // 连接相关
  EdgeNotFound = -32020,
  EdgeDuplicate = -32021,
  EdgePortIncompatible = -32022,
  EdgeSelfConnection = -32023,

  // 子图相关
  SubGraphNotFound = -32030,
  SubGraphCycleDetected = -32031,
  SubGraphInlineError = -32032,

  // 渲染相关
  RenderNotReady = -32040,
  RenderFailed = -32041,
  RenderTimeout = -32042,

  // 资源相关
  AssetNotFound = -32050,
  AssetLoadFailed = -32051,
  AssetFormatUnsupported = -32052,

  // 时间轴相关
  TimelineNotFound = -32060,
  KeyframeNotFound = -32061,
  TimelineInvalidRange = -32062,

  // AI Director 相关
  AIDirectorBusy = -32070,
  AIDirectorError = -32071,
  AIDirectorTimeout = -32072,

  // 安全相关
  PermissionDenied = -32080,
  ReadOnlyMode = -32081,
  RateLimited = -32082,
  ConfirmationRequired = -32083,
}

// ─── 错误类 ───

/**
 * MCP 错误基类。
 *
 * 可序列化为 JSON-RPC error 对象。
 */
export class MCPError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = 'MCPError'
  }

  /** 转换为 JSON-RPC error 对象 */
  toJsonRpcError(): { code: number; message: string; data?: unknown } {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined ? { data: this.data } : {}),
    }
  }
}

/** 解析错误 */
export class ParseError extends MCPError {
  constructor(message = 'Invalid JSON', data?: unknown) {
    super(JsonRpcErrorCode.ParseError, message, data)
    this.name = 'ParseError'
  }
}

/** 无效请求错误 */
export class InvalidRequestError extends MCPError {
  constructor(message = 'Invalid JSON-RPC request', data?: unknown) {
    super(JsonRpcErrorCode.InvalidRequest, message, data)
    this.name = 'InvalidRequestError'
  }
}

/** 方法不存在错误 */
export class MethodNotFoundError extends MCPError {
  constructor(method: string) {
    super(JsonRpcErrorCode.MethodNotFound, `Method not found: ${method}`)
    this.name = 'MethodNotFoundError'
  }
}

/** 参数无效错误 */
export class InvalidParamsError extends MCPError {
  constructor(message: string, data?: unknown) {
    super(JsonRpcErrorCode.InvalidParams, message, data)
    this.name = 'InvalidParamsError'
  }
}

/** 内部错误 */
export class InternalError extends MCPError {
  constructor(message: string, data?: unknown) {
    super(JsonRpcErrorCode.InternalError, message, data)
    this.name = 'InternalError'
  }
}

/** 工具不存在错误 */
export class ToolNotFoundError extends MCPError {
  constructor(toolName: string) {
    super(JsonRpcErrorCode.MethodNotFound, `Tool not found: ${toolName}`)
    this.name = 'ToolNotFoundError'
  }
}

/** 工具执行错误 */
export class ToolExecutionError extends MCPError {
  constructor(
    toolName: string,
    message: string,
    public readonly errorCode: PixelForgeErrorCode = PixelForgeErrorCode.InternalError,
    data?: unknown,
  ) {
    super(errorCode, `Tool '${toolName}' execution failed: ${message}`, data)
    this.name = 'ToolExecutionError'
  }
}

/** 参数验证错误 */
export class ValidationError extends MCPError {
  constructor(field: string, message: string) {
    super(
      JsonRpcErrorCode.InvalidParams,
      `Validation failed for '${field}': ${message}`,
      { field },
    )
    this.name = 'ValidationError'
  }
}

/** 安全权限错误 */
export class SecurityError extends MCPError {
  constructor(message: string, data?: unknown) {
    super(PixelForgeErrorCode.PermissionDenied, message, data)
    this.name = 'SecurityError'
  }
}

/** 只读模式错误 */
export class ReadOnlyError extends MCPError {
  constructor(action: string) {
    super(
      PixelForgeErrorCode.ReadOnlyMode,
      `Cannot perform '${action}': server is in read-only mode`,
    )
    this.name = 'ReadOnlyError'
  }
}

/** 需要用户确认错误 */
export class ConfirmationRequiredError extends MCPError {
  constructor(action: string) {
    super(
      PixelForgeErrorCode.ConfirmationRequired,
      `Action '${action}' requires explicit user confirmation`,
    )
    this.name = 'ConfirmationRequiredError'
  }
}
