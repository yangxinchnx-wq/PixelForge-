/**
 * WDL Validator Tests(Step 37.4)— 语义校验测试。
 */
import { describe, it, expect } from 'vitest'
import { validateSource, Validator, ValidationReport } from './wdlValidator'
import { parse } from './wdlParser'

// ============================================================================
// 辅助函数
// ============================================================================

/** 从源码解析并校验 */
function validateStr(source: string): ValidationReport {
  return validateSource(source)
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Validator', () => {
  // ==========================================================================
  // 有效场景
  // ==========================================================================
  describe('有效场景', () => {
    it('V01: 完整有效场景应通过校验', () => {
      const source = `scene "test" {
        canvas: 800x600
        layer "bg" { opcode: SOLID_COLOR, color: [1, 0, 0, 1] }
        region "main" { bounds: [0, 0, 1, 1], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(true)
      expect(report.errors).toHaveLength(0)
    })

    it('V02: 含 effect 的有效场景', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "vignette" { type: vignette, target: "bg" }
        region "main" { bounds: [0, 0, 1, 1], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(true)
    })

    it('V03: 多 layer 多 region 场景', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        layer "stars" { opcode: NOISE }
        region "main" { bounds: [0, 0, 1, 1], layers: ["bg", "stars"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(true)
    })
  })

  // ==========================================================================
  // ID 唯一性
  // ==========================================================================
  describe('ID 唯一性', () => {
    it('V04: 重复 layer ID 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        layer "bg" { opcode: NOISE }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('重复'))).toBe(true)
    })

    it('V05: 重复 effect ID 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "e1" { type: blur, target: "bg" }
        effect "e1" { type: bloom, target: "bg" }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('重复'))).toBe(true)
    })

    it('V06: 重复 region ID 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "main" { bounds: [0, 0, 1, 1], layers: ["bg"] }
        region "main" { bounds: [0, 0, 0.5, 0.5], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('重复'))).toBe(true)
    })
  })

  // ==========================================================================
  // 引用完整性
  // ==========================================================================
  describe('引用完整性', () => {
    it('V07: effect.target 引用不存在的 layer 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "e1" { type: blur, target: "nonexistent" }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('不存在'))).toBe(true)
    })

    it('V08: region.layers 引用不存在的 layer 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "main" { bounds: [0, 0, 1, 1], layers: ["bg", "missing"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('不存在'))).toBe(true)
    })

    it('V09: 有效的 target 引用不应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "e1" { type: blur, target: "bg" }
      }`
      const report = validateStr(source)
      expect(report.errors.some((e) => e.message.includes('不存在'))).toBe(false)
    })
  })

  // ==========================================================================
  // 必填字段
  // ==========================================================================
  describe('必填字段', () => {
    it('V10: layer 缺少 opcode 应报错', () => {
      const source = `scene "test" { layer "bg" { color: [1,0,0,1] } }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('opcode'))).toBe(true)
    })

    it('V11: effect 缺少 type 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "e1" { intensity: 0.5 }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('type'))).toBe(true)
    })

    it('V12: region 缺少 bounds 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('bounds'))).toBe(true)
    })

    it('V13: region 缺少 layers 应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { bounds: [0, 0, 1, 1] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('layers'))).toBe(true)
    })
  })

  // ==========================================================================
  // 参数值校验
  // ==========================================================================
  describe('参数值校验', () => {
    it('V14: bounds 非 4 元素应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { bounds: [0, 0, 1], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('4 元素'))).toBe(true)
    })

    it('V15: color 非 3/4 元素应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR, color: [1, 0] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('color'))).toBe(true)
    })

    it('V16: bounds width 为负应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { bounds: [0, 0, -1, 1], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('width'))).toBe(true)
    })

    it('V17: bounds height 为零应报错', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { bounds: [0, 0, 1, 0], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.valid).toBe(false)
      expect(report.errors.some((e) => e.message.includes('height'))).toBe(true)
    })
  })

  // ==========================================================================
  // 警告
  // ==========================================================================
  describe('警告', () => {
    it('V18: 无图层的场景应警告', () => {
      const source = `scene "test" {}`
      const report = validateStr(source)
      expect(report.warnings.some((w) => w.message.includes('没有图层'))).toBe(true)
    })

    it('V19: 有图层但无区域应警告', () => {
      const source = `scene "test" { layer "bg" { opcode: SOLID_COLOR } }`
      const report = validateStr(source)
      expect(report.warnings.some((w) => w.message.includes('没有区域'))).toBe(true)
    })

    it('V20: region.layers 空数组应警告', () => {
      const source = `scene "test" {
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { bounds: [0, 0, 1, 1], layers: [] }
      }`
      const report = validateStr(source)
      expect(report.warnings.some((w) => w.message.includes('为空'))).toBe(true)
    })

    it('V21: canvas 尺寸过大应警告', () => {
      const source = `scene "test" {
        canvas: 16384x16384
        layer "bg" { opcode: SOLID_COLOR }
        region "r" { bounds: [0, 0, 1, 1], layers: ["bg"] }
      }`
      const report = validateStr(source)
      expect(report.warnings.some((w) => w.message.includes('过大'))).toBe(true)
    })
  })

  // ==========================================================================
  // 多错误收集
  // ==========================================================================
  describe('多错误收集', () => {
    it('V22: 应收集多个错误而非遇到第一个就停止', () => {
      const source = `scene "test" {
        layer "bg" { color: [1, 0] }
        effect "e1" { intensity: 0.5 }
        region "r" { bounds: [0, 0], layers: ["missing"] }
      }`
      const report = validateStr(source)
      expect(report.errors.length).toBeGreaterThanOrEqual(4)
    })
  })

  // ==========================================================================
  // 解析错误处理
  // ==========================================================================
  describe('解析错误处理', () => {
    it('V23: 语法错误应转为校验报告', () => {
      const report = validateStr('scene "test" { invalid }')
      expect(report.valid).toBe(false)
      expect(report.errors).toHaveLength(1)
      expect(report.errors[0].message).toContain('Error')
    })

    it('V24: 词法错误应转为校验报告', () => {
      const report = validateStr('@invalid')
      expect(report.valid).toBe(false)
      expect(report.errors).toHaveLength(1)
    })
  })

  // ==========================================================================
  // Validator 类直接使用
  // ==========================================================================
  describe('Validator 类', () => {
    it('V25: 应支持从 AST 直接校验', () => {
      const ast = parse('scene "test" { layer "bg" { opcode: SOLID_COLOR } }')
      const validator = new Validator()
      const report = validator.validate(ast)
      // 有 layer 但没 region,应有 warning
      expect(report.warnings.length).toBeGreaterThan(0)
    })

    it('V26: 校验报告应包含 valid/errors/warnings 字段', () => {
      const report = validateStr('scene "test" {}')
      expect(report).toHaveProperty('valid')
      expect(report).toHaveProperty('errors')
      expect(report).toHaveProperty('warnings')
      expect(Array.isArray(report.errors)).toBe(true)
      expect(Array.isArray(report.warnings)).toBe(true)
    })
  })
})
