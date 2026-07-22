/**
 * WDL Parser Tests(Step 37.2)— 语法分析测试。
 */
import { describe, it, expect } from 'vitest'
import { Parser, parse, ParseError, SceneNode, ValueNode } from './wdlParser'
import { tokenize } from './wdlLexer'

// ============================================================================
// 辅助函数
// ============================================================================

/** 解析并返回 AST */
function ast(source: string): SceneNode {
  return parse(source)
}

/** 安全获取 ValueNode 的 value 字段(类型断言辅助) */
function vval(v: ValueNode): unknown {
  return (v as { value?: unknown }).value
}

/** 安全获取 ValueNode 的 elements 字段(类型断言辅助) */
function velems(v: ValueNode): ValueNode[] {
  return (v as { elements?: ValueNode[] }).elements ?? []
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Parser', () => {
  // ==========================================================================
  // 基础场景解析
  // ==========================================================================
  describe('基础场景解析', () => {
    it('P01: 空场景', () => {
      const node = ast('scene "test" {}')
      expect(node.type).toBe('scene')
      expect(node.name).toBe('test')
      expect(node.canvas).toBeNull()
      expect(node.layers).toHaveLength(0)
      expect(node.effects).toHaveLength(0)
      expect(node.regions).toHaveLength(0)
    })

    it('P02: 场景名称应保留中文', () => {
      const node = ast('scene "星空夜景" {}')
      expect(node.name).toBe('星空夜景')
    })

    it('P03: 缺少 scene 关键字应抛错', () => {
      expect(() => ast('"test" {}')).toThrow(ParseError)
    })

    it('P04: 缺少场景名称应抛错', () => {
      expect(() => ast('scene {}')).toThrow(ParseError)
    })

    it('P05: 缺少左花括号应抛错', () => {
      expect(() => ast('scene "test"')).toThrow(ParseError)
    })

    it('P06: 缺少右花括号应抛错', () => {
      expect(() => ast('scene "test" {')).toThrow(ParseError)
    })
  })

  // ==========================================================================
  // canvas 解析
  // ==========================================================================
  describe('canvas 解析', () => {
    it('P07: 应正确解析 canvas 尺寸', () => {
      const node = ast('scene "test" { canvas: 1920x1080 }')
      expect(node.canvas).toEqual({ width: 1920, height: 1080 })
    })

    it('P08: canvas 尺寸应支持大写 X', () => {
      const node = ast('scene "test" { canvas: 800X600 }')
      expect(node.canvas).toEqual({ width: 800, height: 600 })
    })

    it('P09: 缺少冒号应抛错', () => {
      expect(() => ast('scene "test" { canvas 1920x1080 }')).toThrow(ParseError)
    })

    it('P10: canvas 值非 SIZE 应抛错', () => {
      expect(() => ast('scene "test" { canvas: "big" }')).toThrow(ParseError)
    })
  })

  // ==========================================================================
  // layer 解析
  // ==========================================================================
  describe('layer 解析', () => {
    it('P11: 空 layer', () => {
      const node = ast('scene "test" { layer "bg" {} }')
      expect(node.layers).toHaveLength(1)
      expect(node.layers[0].type).toBe('layer')
      expect(node.layers[0].name).toBe('bg')
      expect(node.layers[0].params).toHaveLength(0)
    })

    it('P12: layer 含单个参数', () => {
      const node = ast('scene "test" { layer "bg" { opacity: 0.5 } }')
      expect(node.layers[0].params).toHaveLength(1)
      expect(node.layers[0].params[0].key).toBe('opacity')
      expect(node.layers[0].params[0].value.kind).toBe('number')
      expect(vval(node.layers[0].params[0].value)).toBe(0.5)
    })

    it('P13: layer 含多个参数', () => {
      const node = ast(`scene "test" {
        layer "bg" {
          opcode: SOLID_COLOR
          color: [1, 0, 0, 1]
          visible: true
        }
      }`)
      const layer = node.layers[0]
      expect(layer.params).toHaveLength(3)
      expect(layer.params[0].key).toBe('opcode')
      expect(layer.params[0].value.kind).toBe('ident')
      expect(vval(layer.params[0].value)).toBe('SOLID_COLOR')
      expect(layer.params[1].key).toBe('color')
      expect(layer.params[1].value.kind).toBe('array')
      expect(layer.params[2].key).toBe('visible')
      expect(layer.params[2].value.kind).toBe('boolean')
      expect(vval(layer.params[2].value)).toBe(true)
    })

    it('P14: 多个 layer', () => {
      const node = ast(`scene "test" {
        layer "bg" {}
        layer "stars" {}
      }`)
      expect(node.layers).toHaveLength(2)
      expect(node.layers[0].name).toBe('bg')
      expect(node.layers[1].name).toBe('stars')
    })

    it('P15: 缺少 layer 名称应抛错', () => {
      expect(() => ast('scene "test" { layer {} }')).toThrow(ParseError)
    })
  })

  // ==========================================================================
  // effect 解析
  // ==========================================================================
  describe('effect 解析', () => {
    it('P16: 空 effect', () => {
      const node = ast('scene "test" { effect "blur1" {} }')
      expect(node.effects).toHaveLength(1)
      expect(node.effects[0].name).toBe('blur1')
    })

    it('P17: effect 含参数', () => {
      const node = ast(`scene "test" {
        effect "vignette" {
          type: vignette
          target: "bg"
          intensity: 0.6
        }
      }`)
      const effect = node.effects[0]
      expect(effect.params).toHaveLength(3)
      expect(effect.params[0].key).toBe('type')
      expect(effect.params[1].key).toBe('target')
      expect(effect.params[1].value.kind).toBe('string')
      expect(vval(effect.params[1].value)).toBe('bg')
    })
  })

  // ==========================================================================
  // region 解析
  // ==========================================================================
  describe('region 解析', () => {
    it('P18: 空 region', () => {
      const node = ast('scene "test" { region "main" {} }')
      expect(node.regions).toHaveLength(1)
      expect(node.regions[0].name).toBe('main')
    })

    it('P19: region 含 bounds 和 layers', () => {
      const node = ast(`scene "test" {
        region "main" {
          bounds: [0, 0, 1, 1]
          layers: ["bg", "stars"]
        }
      }`)
      const region = node.regions[0]
      expect(region.params).toHaveLength(2)
      expect(region.params[0].key).toBe('bounds')
      expect(region.params[0].value.kind).toBe('array')
      expect(region.params[1].key).toBe('layers')
      expect(region.params[1].value.kind).toBe('array')
      expect(velems(region.params[1].value)).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 值类型解析
  // ==========================================================================
  describe('值类型解析', () => {
    it('P20: 整数值', () => {
      const node = ast('scene "t" { layer "l" { x: 42 } }')
      const value = node.layers[0].params[0].value
      expect(value.kind).toBe('number')
      expect(vval(value)).toBe(42)
    })

    it('P21: 浮点值', () => {
      const node = ast('scene "t" { layer "l" { x: 3.14 } }')
      expect(vval(node.layers[0].params[0].value)).toBe(3.14)
    })

    it('P22: 负数值', () => {
      const node = ast('scene "t" { layer "l" { x: -0.5 } }')
      expect(vval(node.layers[0].params[0].value)).toBe(-0.5)
    })

    it('P23: 字符串值', () => {
      const node = ast('scene "t" { layer "l" { name: "hello" } }')
      const value = node.layers[0].params[0].value
      expect(value.kind).toBe('string')
      expect(vval(value)).toBe('hello')
    })

    it('P24: 布尔值 true', () => {
      const node = ast('scene "t" { layer "l" { visible: true } }')
      const value = node.layers[0].params[0].value
      expect(value.kind).toBe('boolean')
      expect(vval(value)).toBe(true)
    })

    it('P25: 布尔值 false', () => {
      const node = ast('scene "t" { layer "l" { visible: false } }')
      expect(vval(node.layers[0].params[0].value)).toBe(false)
    })

    it('P26: 标识符值', () => {
      const node = ast('scene "t" { layer "l" { opcode: SOLID_COLOR } }')
      const value = node.layers[0].params[0].value
      expect(value.kind).toBe('ident')
      expect(vval(value)).toBe('SOLID_COLOR')
    })

    it('P27: 空数组', () => {
      const node = ast('scene "t" { layer "l" { items: [] } }')
      const value = node.layers[0].params[0].value
      expect(value.kind).toBe('array')
      expect(velems(value)).toHaveLength(0)
    })

    it('P28: 数字数组', () => {
      const node = ast('scene "t" { layer "l" { color: [1, 0, 0, 1] } }')
      const value = node.layers[0].params[0].value
      expect(value.kind).toBe('array')
      expect(velems(value)).toHaveLength(4)
      expect(vval(velems(value)[0])).toBe(1)
      expect(vval(velems(value)[3])).toBe(1)
    })

    it('P29: 字符串数组', () => {
      const node = ast('scene "t" { layer "l" { tags: ["a", "b"] } }')
      const value = node.layers[0].params[0].value
      expect(velems(value)).toHaveLength(2)
      expect(vval(velems(value)[0])).toBe('a')
      expect(vval(velems(value)[1])).toBe('b')
    })

    it('P30: 混合类型数组', () => {
      const node = ast('scene "t" { layer "l" { mixed: [1, "two", true] } }')
      const value = node.layers[0].params[0].value
      expect(velems(value)).toHaveLength(3)
      expect(velems(value)[0].kind).toBe('number')
      expect(velems(value)[1].kind).toBe('string')
      expect(velems(value)[2].kind).toBe('boolean')
    })
  })

  // ==========================================================================
  // 错误处理
  // ==========================================================================
  describe('错误处理', () => {
    it('P31: 无效的 sceneBody 元素应抛错', () => {
      expect(() => ast('scene "t" { invalid "x" {} }')).toThrow(ParseError)
    })

    it('P32: 参数缺少冒号应抛错', () => {
      expect(() => ast('scene "t" { layer "l" { x 42 } }')).toThrow(ParseError)
    })

    it('P33: 数组缺少右方括号应抛错', () => {
      expect(() => ast('scene "t" { layer "l" { x: [1, 2 } }')).toThrow(ParseError)
    })

    it('P34: 数组元素间缺少逗号应抛错', () => {
      expect(() => ast('scene "t" { layer "l" { x: [1 2] } }')).toThrow(ParseError)
    })

    it('P35: ParseError 应包含行号列号', () => {
      try {
        ast('scene "t" {\n  invalid "x" {} \n}')
        expect.fail('应抛出错误')
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError)
        const err = e as ParseError
        expect(err.line).toBe(2)
      }
    })
  })

  // ==========================================================================
  // 完整场景解析
  // ==========================================================================
  describe('完整场景解析', () => {
    it('P36: 应正确解析完整复杂场景', () => {
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
      const node = ast(source)

      expect(node.name).toBe('星空夜景')
      expect(node.canvas).toEqual({ width: 1920, height: 1080 })
      expect(node.layers).toHaveLength(2)
      expect(node.effects).toHaveLength(1)
      expect(node.regions).toHaveLength(1)

      // 验证第一个 layer
      const bg = node.layers[0]
      expect(bg.name).toBe('background')
      expect(bg.params).toHaveLength(3)
      expect(bg.params[0].key).toBe('opcode')

      // 验证 effect
      const vig = node.effects[0]
      expect(vig.name).toBe('vignette')
      expect(vig.params).toHaveLength(3)

      // 验证 region
      const main = node.regions[0]
      expect(main.name).toBe('main')
      expect(main.params).toHaveLength(2)
    })

    it('P37: 应支持注释', () => {
      const source = `// 场景注释
scene "test" { // 行尾注释
  /* 块注释 */
  layer "bg" {} // 图层注释
}`
      const node = ast(source)
      expect(node.layers).toHaveLength(1)
      expect(node.layers[0].name).toBe('bg')
    })

    it('P38: 应保留所有节点的行号信息', () => {
      const source = `scene "test" {
  layer "bg" {}
}`
      const node = ast(source)
      expect(node.line).toBe(1)
      expect(node.layers[0].line).toBe(2)
    })
  })

  // ==========================================================================
  // Parser 类直接使用
  // ==========================================================================
  describe('Parser 类', () => {
    it('P39: 应支持从 token 数组构造', () => {
      const tokens = tokenize('scene "test" {}')
      const parser = new Parser(tokens)
      const node = parser.parse()
      expect(node.type).toBe('scene')
    })
  })
})
