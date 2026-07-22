/**
 * WDL Diagnostics Tests(Step 38.3)— 错误内联提示测试。
 *
 * 测试策略:
 * - 不依赖 Monaco 运行时,只测试纯函数 messageToMarker / reportToMarkers / errorToMarker / validateSourceToMarkers
 * - 覆盖:有效场景无 marker / 错误 marker / 警告 marker / 解析错误 marker / 多错误收集 / 列范围计算
 */
import { describe, it, expect } from 'vitest'
import {
  messageToMarker,
  reportToMarkers,
  errorToMarker,
  errorsToMarkers,
  validateSourceToMarkers,
} from './wdlDiagnostics'
import type { ValidationReport, ValidationMessage } from './wdlValidator'
import { ParseError } from './wdlParser'
import { LexerError } from './wdlLexer'
import { CompileError } from './wdlCompiler'

// ============================================================================
// 辅助函数
// ============================================================================

/** 创建一条 ValidationMessage */
function msg(
  severity: 'error' | 'warning',
  message: string,
  line: number,
  column: number,
): ValidationMessage {
  return { severity, message, line, column }
}

/** 创建一个 ValidationReport */
function report(
  errors: ValidationMessage[] = [],
  warnings: ValidationMessage[] = [],
): ValidationReport {
  return { valid: errors.length === 0, errors, warnings }
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Diagnostics', () => {
  // ==========================================================================
  // messageToMarker
  // ==========================================================================
  describe('messageToMarker', () => {
    it('D01: 错误消息应转为 error marker', () => {
      const m = msg('error', '缺少 opcode', 3, 5)
      const marker = messageToMarker(m, 20)
      expect(marker.severity).toBe('error')
      expect(marker.message).toBe('缺少 opcode')
      expect(marker.lineNumber).toBe(3)
      expect(marker.startColumn).toBe(5)
    })

    it('D02: 警告消息应转为 warning marker', () => {
      const m = msg('warning', '尺寸过大', 1, 1)
      const marker = messageToMarker(m, 10)
      expect(marker.severity).toBe('warning')
    })

    it('D03: column 为 0 时应使用默认列', () => {
      const m = msg('error', 'test', 1, 0)
      const marker = messageToMarker(m, 10)
      expect(marker.startColumn).toBe(1)
    })

    it('D04: line 为 0 时应使用默认行 1', () => {
      const m = msg('error', 'test', 0, 1)
      const marker = messageToMarker(m, 10)
      expect(marker.lineNumber).toBe(1)
    })

    it('D05: endColumn 应至少为 startColumn + 1', () => {
      const m = msg('error', 'test', 1, 5)
      const marker = messageToMarker(m, 3)
      expect(marker.endColumn).toBeGreaterThanOrEqual(marker.startColumn + 1)
    })
  })

  // ==========================================================================
  // reportToMarkers
  // ==========================================================================
  describe('reportToMarkers', () => {
    it('D06: 有效报告应返回空 marker 列表', () => {
      const r = report()
      const markers = reportToMarkers(r)
      expect(markers).toHaveLength(0)
    })

    it('D07: 含错误的报告应转为 marker', () => {
      const r = report([msg('error', '错误1', 2, 3)])
      const markers = reportToMarkers(r)
      expect(markers).toHaveLength(1)
      expect(markers[0].severity).toBe('error')
      expect(markers[0].message).toBe('错误1')
    })

    it('D08: 含警告的报告应转为 marker', () => {
      const r = report([], [msg('warning', '警告1', 5, 1)])
      const markers = reportToMarkers(r)
      expect(markers).toHaveLength(1)
      expect(markers[0].severity).toBe('warning')
    })

    it('D09: 含错误和警告应全部转换', () => {
      const r = report(
        [msg('error', '错误1', 2, 3), msg('error', '错误2', 4, 1)],
        [msg('warning', '警告1', 5, 1)],
      )
      const markers = reportToMarkers(r)
      expect(markers).toHaveLength(3)
    })

    it('D10: sourceLines 参数应影响 endColumn 计算', () => {
      const r = report([msg('error', 'test', 1, 1)])
      const markers = reportToMarkers(r, ['short line'])
      expect(markers[0].endColumn).toBeGreaterThan(markers[0].startColumn)
    })
  })

  // ==========================================================================
  // errorToMarker / errorsToMarkers
  // ==========================================================================
  describe('errorToMarker', () => {
    it('D11: ParseError 应转为 marker', () => {
      const e = new ParseError('语法错误', 3, 5)
      const marker = errorToMarker(e)
      expect(marker).not.toBeNull()
      expect(marker!.severity).toBe('error')
      expect(marker!.lineNumber).toBe(3)
      expect(marker!.startColumn).toBe(5)
      expect(marker!.message).toContain('语法错误')
    })

    it('D12: LexerError 应转为 marker', () => {
      const e = new LexerError('词法错误', 2, 1)
      const marker = errorToMarker(e)
      expect(marker).not.toBeNull()
      expect(marker!.lineNumber).toBe(2)
    })

    it('D13: CompileError 应转为 marker', () => {
      const e = new CompileError('编译错误', 4, 2)
      const marker = errorToMarker(e)
      expect(marker).not.toBeNull()
      expect(marker!.lineNumber).toBe(4)
    })

    it('D14: 普通错误(无行号)应返回 null', () => {
      const e = new Error('普通错误')
      const marker = errorToMarker(e)
      expect(marker).toBeNull()
    })

    it('D15: 非错误对象应返回 null', () => {
      const marker = errorToMarker('string error')
      expect(marker).toBeNull()
    })
  })

  describe('errorsToMarkers', () => {
    it('D16: ParseError 应转为单元素 marker 列表', () => {
      const e = new ParseError('语法错误', 3, 5)
      const markers = errorsToMarkers(e)
      expect(markers).toHaveLength(1)
    })

    it('D17: 普通错误应返回空列表', () => {
      const markers = errorsToMarkers(new Error('普通错误'))
      expect(markers).toHaveLength(0)
    })
  })

  // ==========================================================================
  // validateSourceToMarkers(一站式)
  // ==========================================================================
  describe('validateSourceToMarkers', () => {
    it('D18: 有效源码应返回空 marker 列表', () => {
      const source = `scene "test" {
  layer "bg" {
    opcode: SOLID_COLOR
    color: [1, 0, 0, 1]
  }
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg"]
  }
}`
      const markers = validateSourceToMarkers(source)
      expect(markers).toHaveLength(0)
    })

    it('D19: 缺少 opcode 应产生 error marker', () => {
      const source = `scene "test" {
  layer "bg" {}
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg"]
  }
}`
      const markers = validateSourceToMarkers(source)
      const errors = markers.filter((m) => m.severity === 'error')
      expect(errors.length).toBeGreaterThan(0)
      const opcodeError = errors.find((m) => m.message.includes('opcode'))
      expect(opcodeError).toBeDefined()
    })

    it('D20: 重复图层 ID 应产生 error marker', () => {
      const source = `scene "test" {
  layer "bg" {
    opcode: SOLID_COLOR
  }
  layer "bg" {
    opcode: NOISE
  }
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg"]
  }
}`
      const markers = validateSourceToMarkers(source)
      const dupError = markers.find((m) => m.message.includes('重复'))
      expect(dupError).toBeDefined()
    })

    it('D21: 引用不存在的图层应产生 error marker', () => {
      const source = `scene "test" {
  layer "bg" {
    opcode: SOLID_COLOR
  }
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["nonexistent"]
  }
}`
      const markers = validateSourceToMarkers(source)
      const refError = markers.find((m) => m.message.includes('不存在'))
      expect(refError).toBeDefined()
    })

    it('D22: 语法错误应转为 marker', () => {
      const source = 'scene "test" { invalid syntax }'
      const markers = validateSourceToMarkers(source)
      expect(markers.length).toBeGreaterThan(0)
      expect(markers[0].severity).toBe('error')
    })

    it('D23: 空场景应产生 warning marker(无图层)', () => {
      const source = 'scene "test" {}'
      const markers = validateSourceToMarkers(source)
      const warnings = markers.filter((m) => m.severity === 'warning')
      const noLayerWarning = warnings.find((m) => m.message.includes('图层'))
      expect(noLayerWarning).toBeDefined()
    })

    it('D24: marker 的 lineNumber 应在源码行范围内', () => {
      const source = `scene "test" {
  layer "bg" {}
}`
      const markers = validateSourceToMarkers(source)
      const lineCount = source.split('\n').length
      for (const m of markers) {
        expect(m.lineNumber).toBeGreaterThanOrEqual(1)
        expect(m.lineNumber).toBeLessThanOrEqual(lineCount)
      }
    })

    it('D25: 多错误应全部收集', () => {
      const source = `scene "test" {
  layer "bg" {}
  layer "bg" {}
  effect "e1" {}
  region "main" {
    bounds: [0, 0]
    layers: ["nonexistent"]
  }
}`
      const markers = validateSourceToMarkers(source)
      // 缺 opcode(2个) + 重复 ID(1个) + 缺 type(1个) + bounds 长度(1个) + 引用不存在(1个)
      expect(markers.length).toBeGreaterThanOrEqual(3)
    })
  })
})
