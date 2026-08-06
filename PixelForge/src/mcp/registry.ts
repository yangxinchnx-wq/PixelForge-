/**
 * MCP 工具注册中心。
 *
 * 管理所有已注册的 MCP 工具定义及其执行处理器。
 * 支持按模块分组、按名称查找、参数验证等。
 */

import type {
  ToolDefinition,
  ToolResult,
  JsonSchema,
} from './types'
import {
  ToolNotFoundError,
  ToolExecutionError,
  ValidationError,
  PixelForgeErrorCode,
} from './errors'

// ─── 工具处理器类型 ───

/** 工具执行函数签名 */
export type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<ToolResult> | ToolResult

/** 注册条目：定义 + 处理器 */
interface RegistryEntry {
  definition: ToolDefinition
  handler: ToolHandler
  /** 注册顺序（用于排序） */
  order: number
}

// ─── 工具注册中心 ───

/**
 * MCP 工具注册中心。
 *
 * 使用单例模式，所有工具模块共享同一个注册中心实例。
 */
export class ToolRegistry {
  private entries = new Map<string, RegistryEntry>()
  private nextOrder = 0

  /**
   * 注册工具。
   *
   * @param definition - 工具定义（包含 name、description、inputSchema 等）
   * @param handler - 工具执行函数
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.entries.has(definition.name)) {
      throw new Error(
        `Tool '${definition.name}' is already registered. ` +
        `Duplicate tool names are not allowed.`,
      )
    }

    this.entries.set(definition.name, {
      definition,
      handler,
      order: this.nextOrder++,
    })
  }

  /**
   * 注销工具。
   *
   * @param name - 工具名称
   * @returns 是否成功注销
   */
  unregister(name: string): boolean {
    return this.entries.delete(name)
  }

  /**
   * 获取工具定义。
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.entries.get(name)?.definition
  }

  /**
   * 检查工具是否存在。
   */
  has(name: string): boolean {
    return this.entries.has(name)
  }

  /**
   * 获取所有已注册工具的定义列表（按注册顺序排序）。
   */
  listTools(): ToolDefinition[] {
    return [...this.entries.values()]
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.definition)
  }

  /**
   * 获取指定模块的工具定义列表。
   */
  listToolsByModule(module: string): ToolDefinition[] {
    return [...this.entries.values()]
      .filter((entry) => entry.definition.module === module)
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.definition)
  }

  /**
   * 获取所有已注册模块名。
   */
  listModules(): string[] {
    const modules = new Set<string>()
    for (const entry of this.entries.values()) {
      if (entry.definition.module) {
        modules.add(entry.definition.module)
      }
    }
    return [...modules].sort()
  }

  /**
   * 获取已注册工具数量。
   */
  get size(): number {
    return this.entries.size
  }

  /**
   * 执行工具调用。
   *
   * 流程：
   * 1. 查找工具定义
   * 2. 验证参数
   * 3. 执行处理器
   * 4. 包装结果
   *
   * @param name - 工具名称
   * @param args - 工具参数
   * @returns 工具执行结果
   * @throws {ToolNotFoundError} 工具不存在
   * @throws {ValidationError} 参数验证失败
   * @throws {ToolExecutionError} 工具执行失败
   */
  async call(name: string, args?: Record<string, unknown>): Promise<ToolResult> {
    const entry = this.entries.get(name)
    if (!entry) {
      throw new ToolNotFoundError(name)
    }

    const toolArgs = args ?? {}

    // 参数验证
    this.validateArgs(toolArgs, entry.definition.inputSchema, name)

    // 执行
    try {
      const result = await entry.handler(toolArgs)
      return result
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        throw error
      }

      const message =
        error instanceof Error ? error.message : String(error)

      throw new ToolExecutionError(
        name,
        message,
        error instanceof MCPError ? error.code : PixelForgeErrorCode.InternalError,
        { originalError: error instanceof Error ? error.name : typeof error },
      )
    }
  }

  /**
   * 验证工具参数是否符合 JSON Schema 定义。
   *
   * 执行基本验证：
   * - required 字段检查
   * - type 类型检查
   * - enum 枚举检查
   * - minimum/maximum 范围检查
   * - minLength/maxLength 长度检查
   */
  validateArgs(
    args: Record<string, unknown>,
    schema: JsonSchema,
    toolName: string,
  ): void {
    // 检查必填字段
    if (schema.required) {
      for (const field of schema.required) {
        if (args[field] === undefined || args[field] === null) {
          throw new ValidationError(
            field,
            `Required parameter '${field}' is missing for tool '${toolName}'`,
          )
        }
      }
    }

    // 检查每个提供的参数
    if (schema.properties) {
      for (const [key, value] of Object.entries(args)) {
        const propDef = schema.properties[key]
        if (!propDef) {
          // 允许额外参数（宽松模式，不拒绝未知字段）
          continue
        }

        this.validateProperty(value, propDef, key, toolName)
      }
    }
  }

  /**
   * 验证单个属性值。
   */
  private validateProperty(
    value: unknown,
    propDef: JsonSchemaPropertyLike,
    fieldName: string,
    toolName: string,
  ): void {
    // type 检查
    if (propDef.type && value !== undefined && value !== null) {
      const expectedTypes = Array.isArray(propDef.type)
        ? propDef.type
        : [propDef.type]

      const actualType = Array.isArray(value) ? 'array' : typeof value
      if (!expectedTypes.includes(actualType) && !expectedTypes.includes('null')) {
        throw new ValidationError(
          fieldName,
          `Parameter '${fieldName}' in tool '${toolName}' expected type ` +
          `'${expectedTypes.join('|')}' but got '${actualType}'`,
        )
      }
    }

    // enum 检查
    if (propDef.enum && !propDef.enum.includes(value as string | number)) {
      throw new ValidationError(
        fieldName,
        `Parameter '${fieldName}' in tool '${toolName}' must be one of: ` +
        `[${propDef.enum.join(', ')}]`,
      )
    }

    // 数值范围检查
    if (typeof value === 'number') {
      if (propDef.minimum !== undefined && value < propDef.minimum) {
        throw new ValidationError(
          fieldName,
          `Parameter '${fieldName}' in tool '${toolName}' must be >= ${propDef.minimum}`,
        )
      }
      if (propDef.maximum !== undefined && value > propDef.maximum) {
        throw new ValidationError(
          fieldName,
          `Parameter '${fieldName}' in tool '${toolName}' must be <= ${propDef.maximum}`,
        )
      }
    }

    // 字符串长度检查
    if (typeof value === 'string') {
      if (propDef.minLength !== undefined && value.length < propDef.minLength) {
        throw new ValidationError(
          fieldName,
          `Parameter '${fieldName}' in tool '${toolName}' must have length >= ${propDef.minLength}`,
        )
      }
      if (propDef.maxLength !== undefined && value.length > propDef.maxLength) {
        throw new ValidationError(
          fieldName,
          `Parameter '${fieldName}' in tool '${toolName}' must have length <= ${propDef.maxLength}`,
        )
      }
    }
  }
}

/** JSON Schema 属性定义的简化接口（用于内部验证） */
interface JsonSchemaPropertyLike {
  type?: string | string[]
  enum?: (string | number)[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  properties?: Record<string, JsonSchemaPropertyLike>
  required?: string[]
}

// 引入 MCPError
import { MCPError } from './errors'

// ─── 全局注册中心实例 ───

/** 全局工具注册中心单例 */
let globalRegistry: ToolRegistry | null = null

/**
 * 获取全局工具注册中心。
 *
 * 首次调用时创建实例。
 */
export function getGlobalRegistry(): ToolRegistry {
  if (!globalRegistry) {
    globalRegistry = new ToolRegistry()
  }
  return globalRegistry
}

/**
 * 重置全局注册中心（仅用于测试）。
 */
export function resetGlobalRegistry(): void {
  globalRegistry = null
}

// ─── 装饰器工具函数（非 TS 装饰器，兼容性更好） ───

/**
 * 注册工具的便捷函数。
 *
 * 用法:
 * ```ts
 * const registry = getGlobalRegistry()
 * registerTool(registry, {
 *   name: 'create_graph',
 *   description: '创建新的节点图',
 *   inputSchema: { ... },
 *   module: 'graph',
 * }, async (args) => {
 *   // 实现逻辑
 *   return { content: [{ type: 'text', text: '...' }] }
 * })
 * ```
 */
export function registerTool(
  registry: ToolRegistry,
  definition: ToolDefinition,
  handler: ToolHandler,
): void {
  registry.register(definition, handler)
}
