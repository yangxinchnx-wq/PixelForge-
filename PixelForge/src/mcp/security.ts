/**
 * MCP 安全控制模块。
 *
 * 提供：
 * - 参数安全验证
 * - 请求速率限制
 * - 审计日志记录
 * - 危险操作拦截
 */

import type { AuditLogEntry, ToolDefinition } from './types'
import {
  SecurityError,
  ReadOnlyError,
  ConfirmationRequiredError,
} from './errors'

// ─── 审计日志 ───

/**
 * 审计日志管理器。
 *
 * 记录所有 MCP 工具调用的完整历史，用于安全审计和问题排查。
 * 使用环形缓冲区，避免无限增长。
 */
export class AuditLogger {
  private entries: AuditLogEntry[] = []
  private readonly maxEntries: number

  constructor(maxEntries = 10000) {
    this.maxEntries = maxEntries
  }

  /**
   * 记录一条审计日志。
   */
  log(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: Date.now(),
    }

    this.entries.push(fullEntry)

    // 环形缓冲区：超过最大条数时移除最旧的
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries)
    }
  }

  /**
   * 获取最近 N 条审计日志。
   */
  getRecent(count = 100): AuditLogEntry[] {
    return this.entries.slice(-count)
  }

  /**
   * 获取指定工具的审计日志。
   */
  getByTool(toolName: string, count = 100): AuditLogEntry[] {
    return this.entries
      .filter((e) => e.toolName === toolName)
      .slice(-count)
  }

  /**
   * 获取错误日志。
   */
  getErrors(count = 100): AuditLogEntry[] {
    return this.entries
      .filter((e) => e.result === 'error')
      .slice(-count)
  }

  /**
   * 清除所有审计日志。
   */
  clear(): void {
    this.entries = []
  }

  /**
   * 获取日志条目总数。
   */
  get size(): number {
    return this.entries.length
  }
}

// ─── 速率限制器 ───

/**
 * 简单的滑动窗口速率限制器。
 *
 * 每个客户端独立计数，防止恶意调用导致服务不可用。
 */
export class RateLimiter {
  private windows = new Map<string, number[]>()

  constructor(
    /** 窗口大小(ms) */
    private readonly windowMs: number = 60000,
    /** 窗口内最大请求数 */
    private readonly maxRequests: number = 200,
  ) {}

  /**
   * 检查是否允许请求。
   *
   * @param clientId - 客户端标识
   * @returns true 表示允许，false 表示已达到限制
   */
  check(clientId: string): boolean {
    const now = Date.now()
    const window = this.windows.get(clientId) ?? []

    // 清除窗口外的旧时间戳
    const validWindow = window.filter((t) => now - t < this.windowMs)

    if (validWindow.length >= this.maxRequests) {
      return false
    }

    validWindow.push(now)
    this.windows.set(clientId, validWindow)
    return true
  }

  /**
   * 获取客户端在当前窗口内的请求次数。
   */
  getCount(clientId: string): number {
    const now = Date.now()
    const window = this.windows.get(clientId) ?? []
    return window.filter((t) => now - t < this.windowMs).length
  }

  /**
   * 重置指定客户端的速率限制。
   */
  reset(clientId: string): void {
    this.windows.delete(clientId)
  }

  /**
   * 重置所有客户端的速率限制。
   */
  resetAll(): void {
    this.windows.clear()
  }
}

// ─── 安全策略 ───

/** 安全策略配置 */
export interface SecurityPolicy {
  /** 只读模式：禁止所有写操作 */
  readOnlyMode: boolean
  /** 需要确认的操作列表（工具名 → 描述） */
  confirmationRequired: Set<string>
  /** 禁止的工具列表 */
  blockedTools: Set<string>
  /** 允许的参数模式（正则表达式，防止注入） */
  allowedValuePatterns?: RegExp[]
}

/**
 * 安全策略管理器。
 *
 * 检查工具调用是否符合安全策略，拦截危险操作。
 */
export class SecurityManager {
  private policy: SecurityPolicy
  private auditLogger: AuditLogger
  private rateLimiter: RateLimiter

  constructor(options?: {
    readOnlyMode?: boolean
    maxAuditEntries?: number
    rateLimitWindowMs?: number
    maxRequestsPerWindow?: number
  }) {
    this.policy = {
      readOnlyMode: options?.readOnlyMode ?? false,
      confirmationRequired: new Set(),
      blockedTools: new Set(),
    }

    this.auditLogger = new AuditLogger(options?.maxAuditEntries ?? 10000)

    this.rateLimiter = new RateLimiter(
      options?.rateLimitWindowMs ?? 60000,
      options?.maxRequestsPerWindow ?? 200,
    )
  }

  /**
   * 检查工具调用是否被允许。
   *
   * @param toolName - 工具名称
   * @param definition - 工具定义
   * @param args - 工具参数
   * @param clientId - 客户端标识
   * @param confirmed - 是否已获得用户确认（对需要确认的操作）
   * @throws {ReadOnlyError} 只读模式下尝试写操作
   * @throws {SecurityError} 工具被禁止
   * @throws {ConfirmationRequiredError} 需要用户确认但未确认
   */
  checkPermission(
    toolName: string,
    definition: ToolDefinition,
    args: Record<string, unknown>,
    clientId = 'default',
    confirmed = false,
  ): void {
    // 1. 速率限制检查
    if (!this.rateLimiter.check(clientId)) {
      this.auditLogger.log({
        method: 'tools/call',
        toolName,
        params: args,
        result: 'error',
        error: 'Rate limited',
        clientId,
      })
      throw new SecurityError(
        `Rate limit exceeded for client '${clientId}'. ` +
        `Maximum ${this.rateLimiter['maxRequests']} requests per ` +
        `${this.rateLimiter['windowMs'] / 1000}s window.`,
      )
    }

    // 2. 禁止工具检查
    if (this.policy.blockedTools.has(toolName)) {
      this.auditLogger.log({
        method: 'tools/call',
        toolName,
        params: args,
        result: 'error',
        error: 'Tool blocked',
        clientId,
      })
      throw new SecurityError(`Tool '${toolName}' is blocked by security policy.`)
    }

    // 3. 只读模式检查
    if (this.policy.readOnlyMode && !definition.readOnly) {
      this.auditLogger.log({
        method: 'tools/call',
        toolName,
        params: args,
        result: 'error',
        error: 'Read-only mode',
        clientId,
      })
      throw new ReadOnlyError(toolName)
    }

    // 4. 需要确认的检查
    if (
      (definition.requiresConfirmation || this.policy.confirmationRequired.has(toolName)) &&
      !confirmed
    ) {
      throw new ConfirmationRequiredError(toolName)
    }
  }

  /**
   * 记录工具调用结果。
   */
  logCall(
    toolName: string,
    args: Record<string, unknown>,
    result: 'success' | 'error',
    error?: string,
    duration?: number,
    clientId = 'default',
  ): void {
    this.auditLogger.log({
      method: 'tools/call',
      toolName,
      params: args,
      result,
      error,
      duration,
      clientId,
    })
  }

  /**
   * 记录非工具请求。
   */
  logRequest(method: string, clientId = 'default'): void {
    this.auditLogger.log({ method, clientId })
  }

  // ─── 策略管理 ───

  /** 设置只读模式 */
  setReadOnlyMode(enabled: boolean): void {
    this.policy.readOnlyMode = enabled
  }

  /** 添加需要确认的工具 */
  addConfirmationRequired(toolName: string): void {
    this.policy.confirmationRequired.add(toolName)
  }

  /** 移除需要确认的工具 */
  removeConfirmationRequired(toolName: string): void {
    this.policy.confirmationRequired.delete(toolName)
  }

  /** 添加禁止的工具 */
  addBlockedTool(toolName: string): void {
    this.policy.blockedTools.add(toolName)
  }

  /** 移除禁止的工具 */
  removeBlockedTool(toolName: string): void {
    this.policy.blockedTools.delete(toolName)
  }

  /** 获取当前策略快照 */
  getPolicySnapshot(): {
    readOnlyMode: boolean
    confirmationRequired: string[]
    blockedTools: string[]
  } {
    return {
      readOnlyMode: this.policy.readOnlyMode,
      confirmationRequired: [...this.policy.confirmationRequired],
      blockedTools: [...this.policy.blockedTools],
    }
  }

  // ─── 访问器 ───

  /** 获取审计日志器 */
  getAuditLogger(): AuditLogger {
    return this.auditLogger
  }

  /** 获取速率限制器 */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter
  }
}
