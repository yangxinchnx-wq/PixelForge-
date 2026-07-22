/**
 * WDL Compiler Tests(Step 37.3)— AST → RenderIR 编译测试。
 */
import { describe, it, expect } from 'vitest'
import { compile, compileSource, CompileError } from './wdlCompiler'
import { parse } from './wdlParser'
import { Opcode } from '@/shared/types'

// ============================================================================
// 辅助函数
// ============================================================================

/** 从源码一站式编译 */
function compileFromString(source: string) {
  return compileSource(source)
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Compiler', () => {
  // ==========================================================================
  // 基础编译
  // ==========================================================================
  describe('基础编译', () => {
    it('C01: 空场景应生成默认 canvas 的空 RenderIR', () => {
      const ir = compileFromString('scene "test" {}')
      expect(ir.canvas).toEqual({ width: 1920, height: 1080 })
      expect(ir.layers).toHaveLength(0)
      expect(ir.effects).toHaveLength(0)
      expect(ir.regions).toHaveLength(0)
      expect(ir.compileHints).toEqual({ preferredProfile: 'region' })
    })

    it('C02: canvas 尺寸应正确传递', () => {
      const ir = compileFromString('scene "test" { canvas: 800x600 }')
      expect(ir.canvas).toEqual({ width: 800, height: 600 })
    })
  })

  // ==========================================================================
  // Layer 编译
  // ==========================================================================
  describe('Layer 编译', () => {
    it('C03: SOLID_COLOR layer 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" {
          opcode: SOLID_COLOR
          color: [1, 0, 0, 1]
        }
      }`)
      expect(ir.layers).toHaveLength(1)
      const layer = ir.layers[0]
      expect(layer.id).toBe('bg')
      expect(layer.opcode).toBe(Opcode.SOLID_COLOR)
      expect(layer.params.color).toEqual([1, 0, 0, 1])
      expect(layer.source).toBe('system_default')
      expect(layer.paramOwnership.color).toBe('l2_user')
      expect(layer.visible).toBe(true)
      expect(layer.blendMode).toBeUndefined()
    })

    it('C04: NOISE layer 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "noise" {
          opcode: NOISE
          scale: 0.8
          intensity: 0.9
        }
      }`)
      expect(ir.layers[0].opcode).toBe(Opcode.NOISE)
      expect(ir.layers[0].params.scale).toBe(0.8)
      expect(ir.layers[0].params.intensity).toBe(0.9)
    })

    it('C05: LINEAR_GRADIENT layer 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "grad" {
          opcode: LINEAR_GRADIENT
          color: [0, 0, 1, 1]
          color2: [1, 1, 0, 1]
          angle: 90
        }
      }`)
      expect(ir.layers[0].opcode).toBe(Opcode.LINEAR_GRADIENT)
      expect(ir.layers[0].params.angle).toBe(90)
    })

    it('C06: blendMode 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" {
          opcode: SOLID_COLOR
          blendMode: add
        }
      }`)
      expect(ir.layers[0].blendMode).toBe('add')
    })

    it('C07: visible=false 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" {
          opcode: SOLID_COLOR
          visible: false
        }
      }`)
      expect(ir.layers[0].visible).toBe(false)
    })

    it('C08: 缺少 opcode 应抛错', () => {
      expect(() => compileFromString('scene "t" { layer "bg" { color: [1,0,0,1] } }'))
        .toThrow(CompileError)
      expect(() => compileFromString('scene "t" { layer "bg" { color: [1,0,0,1] } }'))
        .toThrow(/缺少 opcode/)
    })

    it('C09: 无效 opcode 应抛错', () => {
      expect(() => compileFromString('scene "t" { layer "bg" { opcode: INVALID } }'))
        .toThrow(CompileError)
      expect(() => compileFromString('scene "t" { layer "bg" { opcode: INVALID } }'))
        .toThrow(/不合法/)
    })

    it('C10: 无效 blendMode 应抛错', () => {
      expect(() => compileFromString('scene "t" { layer "bg" { opcode: SOLID_COLOR, blendMode: invalid } }'))
        .toThrow(CompileError)
    })

    it('C11: 多个 layer 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR }
        layer "stars" { opcode: NOISE }
      }`)
      expect(ir.layers).toHaveLength(2)
      expect(ir.layers[0].id).toBe('bg')
      expect(ir.layers[1].id).toBe('stars')
    })

    it('C12: opcode 不应进入 params', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR, color: [1,0,0,1] }
      }`)
      expect(ir.layers[0].params).not.toHaveProperty('opcode')
      expect(ir.layers[0].params).toHaveProperty('color')
    })
  })

  // ==========================================================================
  // Effect 编译
  // ==========================================================================
  describe('Effect 编译', () => {
    it('C13: effect 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "vignette" {
          type: vignette
          target: "bg"
          intensity: 0.6
        }
      }`)
      expect(ir.effects).toHaveLength(1)
      const effect = ir.effects[0]
      expect(effect.id).toBe('vignette')
      expect(effect.type).toBe('vignette')
      expect(effect.targetLayer).toBe('bg')
      expect(effect.params.intensity).toBe(0.6)
    })

    it('C14: effect 缺少 type 应抛错', () => {
      expect(() => compileFromString('scene "t" { effect "e" { intensity: 0.5 } }'))
        .toThrow(CompileError)
    })

    it('C15: target 用 ident 也应支持', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "e" { type: blur, target: bg }
      }`)
      expect(ir.effects[0].targetLayer).toBe('bg')
    })

    it('C16: type/target 不应进入 params', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR }
        effect "e" { type: blur, target: "bg", intensity: 0.5 }
      }`)
      expect(ir.effects[0].params).not.toHaveProperty('type')
      expect(ir.effects[0].params).not.toHaveProperty('target')
      expect(ir.effects[0].params).toHaveProperty('intensity')
    })
  })

  // ==========================================================================
  // Region 编译
  // ==========================================================================
  describe('Region 编译', () => {
    it('C17: region 应正确编译', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR }
        layer "stars" { opcode: NOISE }
        region "main" {
          bounds: [0, 0, 1, 1]
          layers: ["bg", "stars"]
        }
      }`)
      expect(ir.regions).toHaveLength(1)
      const region = ir.regions[0]
      expect(region.id).toBe('main')
      expect(region.bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
      expect(region.layerRefs).toEqual(['bg', 'stars'])
    })

    it('C18: region 缺少 bounds 应抛错', () => {
      expect(() => compileFromString('scene "t" { region "r" { layers: [] } }'))
        .toThrow(CompileError)
    })

    it('C19: region bounds 非数组应抛错', () => {
      expect(() => compileFromString('scene "t" { region "r" { bounds: 5, layers: [] } }'))
        .toThrow(CompileError)
    })

    it('C20: region bounds 非 4 元素应抛错', () => {
      expect(() => compileFromString('scene "t" { region "r" { bounds: [0, 0, 1], layers: [] } }'))
        .toThrow(CompileError)
    })

    it('C21: region 缺少 layers 应抛错', () => {
      expect(() => compileFromString('scene "t" { region "r" { bounds: [0,0,1,1] } }'))
        .toThrow(CompileError)
    })
  })

  // ==========================================================================
  // 完整场景编译
  // ==========================================================================
  describe('完整场景编译', () => {
    it('C22: 星空夜景完整场景', () => {
      const source = `scene "星空夜景" {
  canvas: 1920x1080

  layer "background" {
    opcode: SOLID_COLOR
    color: [0.02, 0.04, 0.12, 1.0]
    blendMode: normal
  }

  layer "stars" {
    opcode: NOISE
    scale: 0.8
    intensity: 0.9
    blendMode: add
  }

  effect "vignette" {
    type: vignette
    target: "background"
    intensity: 0.6
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["background", "stars"]
  }
}`
      const ir = compileFromString(source)

      expect(ir.canvas).toEqual({ width: 1920, height: 1080 })
      expect(ir.layers).toHaveLength(2)
      expect(ir.effects).toHaveLength(1)
      expect(ir.regions).toHaveLength(1)

      // 验证图层
      expect(ir.layers[0].id).toBe('background')
      expect(ir.layers[0].opcode).toBe(Opcode.SOLID_COLOR)
      expect(ir.layers[0].params.color).toEqual([0.02, 0.04, 0.12, 1.0])
      expect(ir.layers[0].blendMode).toBe('normal')

      expect(ir.layers[1].id).toBe('stars')
      expect(ir.layers[1].opcode).toBe(Opcode.NOISE)
      expect(ir.layers[1].blendMode).toBe('add')

      // 验证效果
      expect(ir.effects[0].targetLayer).toBe('background')
      expect(ir.effects[0].params.intensity).toBe(0.6)

      // 验证区域
      expect(ir.regions[0].layerRefs).toEqual(['background', 'stars'])
    })

    it('C23: 从 AST 直接编译', () => {
      const ast = parse('scene "test" { layer "bg" { opcode: SOLID_COLOR } }')
      const ir = compile(ast)
      expect(ir.layers).toHaveLength(1)
      expect(ir.layers[0].id).toBe('bg')
    })

    it('C24: CompileError 应包含行号', () => {
      try {
        compileFromString('scene "t" {\n  layer "bg" {\n    color: [1,0,0,1]\n  }\n}')
        expect.fail('应抛出错误')
      } catch (e) {
        expect(e).toBeInstanceOf(CompileError)
        const err = e as CompileError
        expect(err.line).toBe(2)
      }
    })
  })

  // ==========================================================================
  // 值类型转换
  // ==========================================================================
  describe('值类型转换', () => {
    it('C25: 字符串参数值', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR, label: "hello" }
      }`)
      expect(ir.layers[0].params.label).toBe('hello')
    })

    it('C26: 布尔参数值', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR, locked: true }
      }`)
      expect(ir.layers[0].params.locked).toBe(true)
    })

    it('C27: 负数参数值', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR, offset: -0.5 }
      }`)
      expect(ir.layers[0].params.offset).toBe(-0.5)
    })

    it('C28: 标识符参数值作为字符串', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR, mode: normal }
      }`)
      expect(ir.layers[0].params.mode).toBe('normal')
    })

    it('C29: 嵌套数组', () => {
      const ir = compileFromString(`scene "t" {
        layer "bg" { opcode: SOLID_COLOR, matrix: [[1, 0], [0, 1]] }
      }`)
      expect(ir.layers[0].params.matrix).toEqual([[1, 0], [0, 1]])
    })
  })
})
