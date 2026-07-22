/**
 * PixelForge - WDL Diagnostics(Step 38.3)
 *
 * 职责:
 * - 将 ValidationReport(errors + warnings)转换为 Monaco editor markers
 * - 将 Lexer/Parser 抛出的错误(含行号)也转为 markers
 * - 提供纯函数转换(便于测试)+ Monaco 集成函数
 *
 * 用法(在 ProTimelineWDLEditor.vue 中):
 *   import { reportToMarkers, applyMarkersToModel } from '@/world/wdl/wdlDiagnostics'
 *   const report = validateSource(source)
 *   const markers = reportToMarkers(report)
 *   applyMarkersToModel(monaco, model, markers)
 */
import type * as Monaco from 'monaco-editor'
import type { ValidationReport, ValidationMessage } from './wdlValidator'
import { validateSource } from './wdlValidator'

// ============================================================================
// 1. 纯函数:ValidationReport → MarkerData(独立于 Monaco 运行时)
// ============================================================================

/**
 * Marker 数据结构(简化版,对应 Monaco editor.IMarkerData,但独立于运行时)。
 * 便于测试,不依赖 Monaco 命名空间。
 */
export interface WDLMarker {
  /** 行号(1-based) */
  lineNumber: number
  /** 起始列(1-based) */
  startColumn: number
  /** 结束列(1-based) */
  endColumn: number
  /** 严重级别:'error' | 'warning' */
  severity: 'error' | 'warning'
  /** 消息内容 */
  message: string
}

/** 默认列范围(当 column 信息不足时使用) */
const DEFAULT_COLUMN_START = 1
const DEFAULT_COLUMN_END = 2

/**
 * 将单条 ValidationMessage 转换为 Marker。
 *
 * @param msg 校验消息
 * @param lineLength 该行的字符长度(用于计算 endColumn)
 * @returns Marker
 */
export function messageToMarker(msg: ValidationMessage, lineLength: number): WDLMarker {
  const startColumn = msg.column > 0 ? msg.column : DEFAULT_COLUMN_START
  // endColumn 至少覆盖一个字符,最多到行尾 + 1
  const endColumn = Math.max(startColumn + 1, Math.min(startColumn + 1, lineLength + 1))
  return {
    lineNumber: msg.line > 0 ? msg.line : 1,
    startColumn,
    endColumn,
    severity: msg.severity,
    message: msg.message,
  }
}

/**
 * 将 ValidationReport 转换为 Marker 列表。
 *
 * @param report 校验报告
 * @param sourceLines 源码行数组(用于计算每行长度)— 可选,缺省时 endColumn = startColumn + 1
 * @returns Marker 列表
 */
export function reportToMarkers(
  report: ValidationReport,
  sourceLines?: string[],
): WDLMarker[] {
  const all = [...report.errors, ...report.warnings]
  return all.map((msg) => {
    const lineLength = sourceLines ? (sourceLines[msg.line - 1]?.length ?? 0) : 0
    return messageToMarker(msg, lineLength)
  })
}

// ============================================================================
// 2. Lexer/Parser/Compiler 错误转换
// ============================================================================

/** Lexer/Parser/CompileError 的公共接口 */
interface ErrorWithPosition {
  line: number
  column: number
  message: string
}

/**
 * 将 Lexer/Parser/Compiler 抛出的错误转换为 Marker。
 *
 * 这些错误类都含 line/column 字段。
 *
 * @param e 错误对象
 * @returns Marker 或 null(无可定位信息时)
 */
export function errorToMarker(e: unknown): WDLMarker | null {
  // 检查是否含 line/column(所有 WDL 错误类都含)
  const err = e as Partial<ErrorWithPosition> & Error
  if (typeof err?.line !== 'number' || typeof err?.column !== 'number') {
    return null
  }
  return {
    lineNumber: err.line > 0 ? err.line : 1,
    startColumn: err.column > 0 ? err.column : DEFAULT_COLUMN_START,
    endColumn: err.column > 0 ? err.column + 1 : DEFAULT_COLUMN_END,
    severity: 'error',
    message: err.message ?? String(e),
  }
}

/**
 * 将异常对象(可能含多个错误)转换为 Marker 列表。
 * 当前只支持单个错误(所有 WDL 错误类都是单错误)。
 */
export function errorsToMarkers(e: unknown): WDLMarker[] {
  const marker = errorToMarker(e)
  return marker ? [marker] : []
}

// ============================================================================
// 3. Monaco 集成
// ============================================================================

/** WDLMarker severity → Monaco MarkerSeverity 映射(使用传入的 monaco 实例) */
function toMonacoSeverity(
  severity: 'error' | 'warning',
  monaco: typeof Monaco,
): Monaco.MarkerSeverity {
  switch (severity) {
    case 'error': return monaco.MarkerSeverity.Error
    case 'warning': return monaco.MarkerSeverity.Warning
    default: return monaco.MarkerSeverity.Info
  }
}

/** WDLMarker → Monaco IMarkerData 转换 */
function toMonacoMarker(
  marker: WDLMarker,
  model: Monaco.editor.ITextModel,
  monaco: typeof Monaco,
): Monaco.editor.IMarkerData {
  // 确保 endColumn 不超过行长度 + 1
  const lineMaxColumn = model.getLineMaxColumn(marker.lineNumber)
  const safeEndColumn = Math.min(marker.endColumn, lineMaxColumn)
  const safeStartColumn = Math.min(marker.startColumn, safeEndColumn)

  return {
    startLineNumber: marker.lineNumber,
    startColumn: safeStartColumn,
    endLineNumber: marker.lineNumber,
    endColumn: Math.max(safeEndColumn, safeStartColumn + 1),
    severity: toMonacoSeverity(marker.severity, monaco),
    message: marker.message,
    source: 'wdl-validator',
  }
}

/**
 * 将 Marker 列表应用到 Monaco editor model。
 *
 * 这会让错误/警告以波浪线形式显示在编辑器中,并在"问题"面板里列出。
 *
 * @param monaco Monaco 实例(运行时值,用于访问 MarkerSeverity 等枚举)
 * @param model 编辑器 model
 * @param markers Marker 列表
 */
export function applyMarkersToModel(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  markers: WDLMarker[],
): void {
  const monacoMarkers = markers.map((m) => toMonacoMarker(m, model, monaco))
  monaco.editor.setModelMarkers(model, 'wdl-validator', monacoMarkers)
}

/**
 * 清除 Monaco editor model 上的所有 WDL 标记。
 *
 * @param monaco Monaco 实例
 * @param model 编辑器 model
 */
export function clearMarkersFromModel(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
): void {
  monaco.editor.setModelMarkers(model, 'wdl-validator', [])
}

// ============================================================================
// 4. 一站式:源码 → 校验 → Markers
// ============================================================================

/**
 * 校验源码并返回 Marker 列表(纯函数,便于测试)。
 *
 * 内部调用 validateSource,如果解析失败也会转为 Marker。
 *
 * @param source WDL 源码
 * @returns Marker 列表
 */
export function validateSourceToMarkers(source: string): WDLMarker[] {
  const report = validateSource(source)
  const sourceLines = source.split('\n')
  return reportToMarkers(report, sourceLines)
}
