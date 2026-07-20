/**
 * PixelForge - 错误诊断体系
 *
 * 本文件是项目「错误层公约」，提供：
 * - 错误工厂函数（createRuntimeError / createReplayError）
 * - 错误分类函数（classifyError）
 * - 错误码到严重等级的映射
 * - 错误码到可恢复性的映射
 *
 * 与骨架 §8.5 Error Taxonomy 对齐。
 * 错误码定义在 runtime/types.ts，此处仅提供工厂和分类逻辑。
 */

import type {
  ErrorSeverity,
  ErrorSource,
  ReplayErrorInfo,
  ReplayErrorCode,
  RuntimeErrorInfo,
  RuntimeErrorCode,
} from '@/runtime/types'

// ============================================================================
// 错误码 → 严重等级 映射
// ============================================================================

const RUNTIME_ERROR_SEVERITY: Record<RuntimeErrorCode, ErrorSeverity> = {
  // 初始化错误 = fatal（运行时不可用）
  'runtime/webgpu-unavailable': 'fatal',
  'runtime/adapter-unavailable': 'fatal',
  'runtime/context-unavailable': 'fatal',
  'runtime/device-request-failed': 'fatal',
  'runtime/output-texture-creation-failed': 'fatal',
  'runtime/present-pipeline-creation-failed': 'fatal',
  // GPU 运行时错误 = error（当前操作失败，运行时可能仍可用）
  'runtime/shader-compilation-failed': 'error',
  'runtime/pipeline-creation-failed': 'error',
  'runtime/buffer-creation-failed': 'error',
  'runtime/texture-creation-failed': 'error',
  'runtime/dispatch-failed': 'error',
  'runtime/gpu-device-lost': 'fatal',
  // 编译错误 = error
  'runtime/compile-error': 'error',
  // 导出错误 = error
  'runtime/export-failed': 'error',
  // 持久化错误 = warning（不影响渲染主流程）
  'runtime/persistence-failed': 'warning',
  // 未知 = error
  'runtime/unknown': 'error',
}

const RUNTIME_ERROR_RECOVERABLE: Record<RuntimeErrorCode, boolean> = {
  'runtime/webgpu-unavailable': false,
  'runtime/adapter-unavailable': false,
  'runtime/context-unavailable': false,
  'runtime/device-request-failed': true,
  'runtime/output-texture-creation-failed': true,
  'runtime/present-pipeline-creation-failed': true,
  'runtime/shader-compilation-failed': true,
  'runtime/pipeline-creation-failed': true,
  'runtime/buffer-creation-failed': true,
  'runtime/texture-creation-failed': true,
  'runtime/dispatch-failed': true,
  'runtime/gpu-device-lost': false,
  'runtime/compile-error': true,
  'runtime/export-failed': true,
  'runtime/persistence-failed': true,
  'runtime/unknown': false,
}

const REPLAY_ERROR_SEVERITY: Record<ReplayErrorCode, ErrorSeverity> = {
  'replay/missing-data': 'warning',
  'replay/incompatible-artifact-version': 'warning',
  'replay/signature-mismatch': 'error',
  'replay/runtime-unavailable': 'fatal',
}

const REPLAY_ERROR_RECOVERABLE: Record<ReplayErrorCode, boolean> = {
  'replay/missing-data': false,
  'replay/incompatible-artifact-version': false,
  'replay/signature-mismatch': true,
  'replay/runtime-unavailable': true,
}

// ============================================================================
// 错误码 → 来源模块 映射
// ============================================================================

const RUNTIME_ERROR_SOURCE: Record<RuntimeErrorCode, ErrorSource> = {
  'runtime/webgpu-unavailable': 'device-init',
  'runtime/adapter-unavailable': 'device-init',
  'runtime/context-unavailable': 'device-init',
  'runtime/device-request-failed': 'device-init',
  'runtime/output-texture-creation-failed': 'device-init',
  'runtime/present-pipeline-creation-failed': 'device-init',
  'runtime/shader-compilation-failed': 'render',
  'runtime/pipeline-creation-failed': 'render',
  'runtime/buffer-creation-failed': 'render',
  'runtime/texture-creation-failed': 'render',
  'runtime/dispatch-failed': 'render',
  'runtime/gpu-device-lost': 'render',
  'runtime/compile-error': 'compile',
  'runtime/export-failed': 'export',
  'runtime/persistence-failed': 'persistence',
  'runtime/unknown': 'unknown',
}

const REPLAY_ERROR_SOURCE: Record<ReplayErrorCode, ErrorSource> = {
  'replay/missing-data': 'replay',
  'replay/incompatible-artifact-version': 'replay',
  'replay/signature-mismatch': 'replay',
  'replay/runtime-unavailable': 'replay',
}

// ============================================================================
// 错误工厂函数
// ============================================================================

/**
 * 创建结构化运行时错误。
 *
 * 自动填充 severity / source / recoverable / timestamp。
 */
export function createRuntimeError(
  code: RuntimeErrorCode,
  message: string,
): RuntimeErrorInfo {
  const error = new Error(message) as RuntimeErrorInfo
  error.code = code
  error.severity = RUNTIME_ERROR_SEVERITY[code]
  error.source = RUNTIME_ERROR_SOURCE[code]
  error.recoverable = RUNTIME_ERROR_RECOVERABLE[code]
  error.timestamp = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return error
}

/**
 * 创建结构化回放错误。
 */
export function createReplayError(
  code: ReplayErrorCode,
  message: string,
): ReplayErrorInfo {
  return {
    code,
    message,
    severity: REPLAY_ERROR_SEVERITY[code],
    source: REPLAY_ERROR_SOURCE[code],
    recoverable: REPLAY_ERROR_RECOVERABLE[code],
    timestamp: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  }
}

// ============================================================================
// 错误分类函数
// ============================================================================

/**
 * 将未知错误分类为结构化运行时错误。
 *
 * 分类策略：
 * 1. 已有 RuntimeErrorInfo → 直接返回
 * 2. Error 实例 → 按消息内容匹配错误码
 * 3. 其他 → runtime/unknown
 */
export function classifyError(
  caughtError: unknown,
  defaultSource: ErrorSource = 'unknown',
): RuntimeErrorInfo {
  // 已是结构化错误
  if (
    typeof caughtError === 'object' &&
    caughtError !== null &&
    'code' in caughtError &&
    'severity' in caughtError &&
    'source' in caughtError
  ) {
    return caughtError as RuntimeErrorInfo
  }

  // Error 实例 → 按消息匹配
  if (caughtError instanceof Error) {
    const message = caughtError.message
    const code = matchErrorCode(message)
    const error = createRuntimeError(code, message) as RuntimeErrorInfo
    // 覆盖默认来源
    if (defaultSource !== 'unknown') {
      error.source = defaultSource
    }
    return error
  }

  // 其他 → 未知错误
  return createRuntimeError('runtime/unknown', String(caughtError))
}

/**
 * 根据错误消息内容匹配错误码。
 *
 * 匹配规则基于关键词，覆盖常见错误场景。
 */
function matchErrorCode(message: string): RuntimeErrorCode {
  const lower = message.toLowerCase()

  // 编译错误
  if (lower.includes('no visible layer') || lower.includes('does not contain any visible layer')) {
    return 'runtime/compile-error'
  }
  if (lower.includes('unsupported opcode') || lower.includes('unknown opcode')) {
    return 'runtime/compile-error'
  }
  if (lower.includes('blend opcode') && lower.includes('deprecated')) {
    return 'runtime/compile-error'
  }

  // GPU 运行时错误
  if (lower.includes('shader') && (lower.includes('compil') || lower.includes('error'))) {
    return 'runtime/shader-compilation-failed'
  }
  if (lower.includes('pipeline') && lower.includes('creation')) {
    return 'runtime/pipeline-creation-failed'
  }
  if (lower.includes('buffer') && lower.includes('creation')) {
    return 'runtime/buffer-creation-failed'
  }
  if (lower.includes('texture') && lower.includes('creation')) {
    return 'runtime/texture-creation-failed'
  }
  if (lower.includes('dispatch') && lower.includes('failed')) {
    return 'runtime/dispatch-failed'
  }
  if (lower.includes('device lost') || lower.includes('gpu device lost')) {
    return 'runtime/gpu-device-lost'
  }

  // 初始化错误
  if (lower.includes('webgpu') && lower.includes('unavailable')) {
    return 'runtime/webgpu-unavailable'
  }
  if (lower.includes('adapter') && lower.includes('unavailable')) {
    return 'runtime/adapter-unavailable'
  }
  if (lower.includes('context') && lower.includes('unavailable')) {
    return 'runtime/context-unavailable'
  }
  if (lower.includes('device') && lower.includes('request') && lower.includes('failed')) {
    return 'runtime/device-request-failed'
  }

  // 持久化错误
  if (lower.includes('indexeddb') || lower.includes('persistence')) {
    return 'runtime/persistence-failed'
  }

  // 导出错误
  if (lower.includes('export') && lower.includes('failed')) {
    return 'runtime/export-failed'
  }

  return 'runtime/unknown'
}

// ============================================================================
// 错误码人类可读名称
// ============================================================================

const ERROR_CODE_LABELS: Record<string, string> = {
  'runtime/webgpu-unavailable': 'WebGPU 不可用',
  'runtime/adapter-unavailable': 'GPU 适配器不可用',
  'runtime/context-unavailable': '画布上下文不可用',
  'runtime/device-request-failed': 'GPU 设备创建失败',
  'runtime/output-texture-creation-failed': '输出纹理创建失败',
  'runtime/present-pipeline-creation-failed': '呈现管线创建失败',
  'runtime/shader-compilation-failed': '着色器编译失败',
  'runtime/pipeline-creation-failed': '管线创建失败',
  'runtime/buffer-creation-failed': '缓冲区创建失败',
  'runtime/texture-creation-failed': '纹理创建失败',
  'runtime/dispatch-failed': 'GPU 调度失败',
  'runtime/gpu-device-lost': 'GPU 设备丢失',
  'runtime/compile-error': '编译错误',
  'runtime/export-failed': '导出失败',
  'runtime/persistence-failed': '持久化失败',
  'runtime/unknown': '未知错误',
  'replay/missing-data': '回放数据缺失',
  'replay/incompatible-artifact-version': '工件版本不兼容',
  'replay/signature-mismatch': '回放签名不一致',
  'replay/runtime-unavailable': '运行时不可用',
}

/**
 * 获取错误码的人类可读名称。
 */
export function getErrorCodeLabel(code: string): string {
  return ERROR_CODE_LABELS[code] ?? code
}

/**
 * 获取严重等级的人类可读名称。
 */
export function getSeverityLabel(severity: ErrorSeverity): string {
  switch (severity) {
    case 'fatal':
      return '致命'
    case 'error':
      return '错误'
    case 'warning':
      return '警告'
    case 'info':
      return '信息'
  }
}
