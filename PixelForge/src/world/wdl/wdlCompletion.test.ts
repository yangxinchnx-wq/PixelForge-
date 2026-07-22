/**
 * WDL Completion Provider Tests(Step 38.2)— 自动补全测试。
 *
 * 测试策略:
 * - 不依赖 Monaco 运行时,只测试纯函数 analyzeCompletionContext / generateCompletions
 * - 7 类补全:块关键字 / 参数关键字(scene/layer/effect/region)/ opcode 值 / blendMode 值 / 布尔值 / 图层引用 / effect type 值
 * - 上下文检测:光标位置 / block 类型 / afterColon / 已声明 ID 收集
 */
import { describe, it, expect } from 'vitest'
import {
  analyzeCompletionContext,
  generateCompletions,
  type WDLCompletionItem,
} from './wdlCompletion'

// ============================================================================
// 辅助函数
// ============================================================================

/** 获取补全项的 label 列表 */
function labels(items: WDLCompletionItem[]): string[] {
  return items.map((i) => i.label)
}

/** 在指定位置分析上下文并生成补全 */
function completionsAt(source: string, line: number, column: number): WDLCompletionItem[] {
  const ctx = analyzeCompletionContext(source, line, column)
  return generateCompletions(ctx)
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Completion', () => {
  // ==========================================================================
  // 上下文检测:analyzeCompletionContext
  // ==========================================================================
  describe('analyzeCompletionContext', () => {
    it('A01: root 层(无块)应返回 root block', () => {
      const ctx = analyzeCompletionContext('', 1, 1)
      expect(ctx.block).toBe('root')
    })

    it('A02: scene 块内应返回 scene block', () => {
      const source = 'scene "test" {\n  \n}'
      const ctx = analyzeCompletionContext(source, 2, 3)
      expect(ctx.block).toBe('scene')
    })

    it('A03: layer 块内应返回 layer block', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    \n  }\n}'
      const ctx = analyzeCompletionContext(source, 3, 5)
      expect(ctx.block).toBe('layer')
    })

    it('A04: effect 块内应返回 effect block', () => {
      const source = 'scene "t" {\n  effect "blur" {\n    \n  }\n}'
      const ctx = analyzeCompletionContext(source, 3, 5)
      expect(ctx.block).toBe('effect')
    })

    it('A05: region 块内应返回 region block', () => {
      const source = 'scene "t" {\n  region "main" {\n    \n  }\n}'
      const ctx = analyzeCompletionContext(source, 3, 5)
      expect(ctx.block).toBe('region')
    })

    it('A06: 光标在 "key:" 后应检测到 afterColon', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    opcode: \n  }\n}'
      const ctx = analyzeCompletionContext(source, 3, 12)
      expect(ctx.afterColon).toBe(true)
      expect(ctx.lastKey).toBe('opcode')
    })

    it('A07: 光标在 "key: value" 中间不应检测到 afterColon', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    color: [1,0,0,1]\n  }\n}'
      const ctx = analyzeCompletionContext(source, 3, 10)
      // "color: [" — 不是 "key:" 结尾
      expect(ctx.afterColon).toBe(false)
    })

    it('A08: 应收集已声明的 layer ID', () => {
      const source = 'scene "t" {\n  layer "bg" {}\n  layer "stars" {}\n}'
      const ctx = analyzeCompletionContext(source, 4, 1)
      expect(ctx.declaredLayers).toEqual(['bg', 'stars'])
    })

    it('A09: 应收集已声明的 effect ID', () => {
      const source = 'scene "t" {\n  effect "blur1" {}\n  effect "glow" {}\n}'
      const ctx = analyzeCompletionContext(source, 4, 1)
      expect(ctx.declaredEffects).toEqual(['blur1', 'glow'])
    })

    it('A10: 应收集已声明的 region ID', () => {
      const source = 'scene "t" {\n  region "main" {}\n  region "overlay" {}\n}'
      const ctx = analyzeCompletionContext(source, 4, 1)
      expect(ctx.declaredRegions).toEqual(['main', 'overlay'])
    })

    it('A11: 嵌套块内应返回最内层 block', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    \n  }\n  layer "fg" {\n    \n  }\n}'
      // 第二个 layer 块内
      const ctx = analyzeCompletionContext(source, 6, 5)
      expect(ctx.block).toBe('layer')
    })
  })

  // ==========================================================================
  // 块关键字补全(root 层)
  // ==========================================================================
  describe('块关键字补全', () => {
    it('B01: root 层应补全 scene/layer/effect/region', () => {
      const items = completionsAt('', 1, 1)
      const lbls = labels(items)
      expect(lbls).toContain('scene')
      expect(lbls).toContain('layer')
      expect(lbls).toContain('effect')
      expect(lbls).toContain('region')
    })

    it('B02: 块补全应为 snippet 类型(含 name 和花括号)', () => {
      const items = completionsAt('', 1, 1)
      const sceneItem = items.find((i) => i.label === 'scene')
      expect(sceneItem).toBeDefined()
      expect(sceneItem!.kind).toBe('snippet')
      expect(sceneItem!.insertText).toContain('name')
      expect(sceneItem!.insertText).toContain('{')
    })
  })

  // ==========================================================================
  // 参数关键字补全
  // ==========================================================================
  describe('参数关键字补全', () => {
    it('C01: scene 块内应补全 canvas', () => {
      const source = 'scene "t" {\n  \n}'
      const items = completionsAt(source, 2, 3)
      expect(labels(items)).toContain('canvas')
    })

    it('C02: layer 块内应补全 opcode', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    \n  }\n}'
      const items = completionsAt(source, 3, 5)
      expect(labels(items)).toContain('opcode')
    })

    it('C03: layer 块内应补全 blendMode / visible / color', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    \n  }\n}'
      const items = completionsAt(source, 3, 5)
      const lbls = labels(items)
      expect(lbls).toContain('blendMode')
      expect(lbls).toContain('visible')
      expect(lbls).toContain('color')
    })

    it('C04: effect 块内应补全 type / target / intensity', () => {
      const source = 'scene "t" {\n  effect "blur" {\n    \n  }\n}'
      const items = completionsAt(source, 3, 5)
      const lbls = labels(items)
      expect(lbls).toContain('type')
      expect(lbls).toContain('target')
      expect(lbls).toContain('intensity')
    })

    it('C05: region 块内应补全 bounds / layers', () => {
      const source = 'scene "t" {\n  region "main" {\n    \n  }\n}'
      const items = completionsAt(source, 3, 5)
      const lbls = labels(items)
      expect(lbls).toContain('bounds')
      expect(lbls).toContain('layers')
    })

    it('C06: 参数补全应为 property 类型', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    \n  }\n}'
      const items = completionsAt(source, 3, 5)
      const opcodeItem = items.find((i) => i.label === 'opcode')
      expect(opcodeItem!.kind).toBe('property')
    })
  })

  // ==========================================================================
  // opcode 值补全
  // ==========================================================================
  describe('opcode 值补全', () => {
    it('D01: "opcode:" 后应补全所有 opcode', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    opcode: \n  }\n}'
      const items = completionsAt(source, 3, 12)
      const lbls = labels(items)
      expect(lbls).toContain('SOLID_COLOR')
      expect(lbls).toContain('LINEAR_GRADIENT')
      expect(lbls).toContain('NOISE')
      expect(lbls).toContain('CIRCLE_SHAPE')
      expect(lbls).toContain('IMAGE_TEXTURE')
    })

    it('D02: opcode 值补全应为 value 类型', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    opcode: \n  }\n}'
      const items = completionsAt(source, 3, 12)
      const item = items.find((i) => i.label === 'SOLID_COLOR')
      expect(item!.kind).toBe('value')
    })

    it('D03: opcode 值应含中文描述', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    opcode: \n  }\n}'
      const items = completionsAt(source, 3, 12)
      const item = items.find((i) => i.label === 'SOLID_COLOR')
      expect(item!.detail).toContain('纯色')
    })
  })

  // ==========================================================================
  // blendMode 值补全
  // ==========================================================================
  describe('blendMode 值补全', () => {
    it('E01: "blendMode:" 后应补全所有混合模式', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    blendMode: \n  }\n}'
      const items = completionsAt(source, 3, 15)
      const lbls = labels(items)
      expect(lbls).toContain('normal')
      expect(lbls).toContain('multiply')
      expect(lbls).toContain('screen')
      expect(lbls).toContain('overlay')
      expect(lbls).toContain('add')
      expect(lbls).toContain('subtract')
    })
  })

  // ==========================================================================
  // 布尔值补全
  // ==========================================================================
  describe('布尔值补全', () => {
    it('F01: "visible:" 后应补全 true / false', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    visible: \n  }\n}'
      const items = completionsAt(source, 3, 13)
      const lbls = labels(items)
      expect(lbls).toContain('true')
      expect(lbls).toContain('false')
    })
  })

  // ==========================================================================
  // 图层 ID 引用补全
  // ==========================================================================
  describe('图层 ID 引用补全', () => {
    it('G01: "target:" 后应补全已声明的 layer ID', () => {
      const source = `scene "t" {
  layer "bg" {}
  layer "stars" {}
  effect "e1" {
    target: \n  }
}`
      const items = completionsAt(source, 5, 12)
      const lbls = labels(items)
      expect(lbls).toContain('"bg"')
      expect(lbls).toContain('"stars"')
    })

    it('G02: "target:" 引用补全应为 reference 类型', () => {
      const source = `scene "t" {
  layer "bg" {}
  effect "e1" {
    target: \n  }
}`
      const items = completionsAt(source, 4, 12)
      const item = items.find((i) => i.label === '"bg"')
      expect(item).toBeDefined()
      expect(item!.kind).toBe('reference')
    })

    it('G03: "targetRegion:" 后应补全已声明的 region ID', () => {
      const source = `scene "t" {
  region "main" {}
  effect "e1" {
    targetRegion: \n  }
}`
      const items = completionsAt(source, 4, 18)
      const lbls = labels(items)
      expect(lbls).toContain('"main"')
    })

    it('G04: 无已声明 layer 时不提供 target 补全', () => {
      const source = `scene "t" {
  effect "e1" {
    target: \n  }
}`
      const items = completionsAt(source, 3, 12)
      expect(items).toHaveLength(0)
    })
  })

  // ==========================================================================
  // effect type 值补全
  // ==========================================================================
  describe('effect type 值补全', () => {
    it('H01: "type:" 后应补全效果类型', () => {
      const source = `scene "t" {
  effect "e1" {
    type: \n  }
}`
      const items = completionsAt(source, 3, 10)
      const lbls = labels(items)
      expect(lbls).toContain('vignette')
      expect(lbls).toContain('blur')
      expect(lbls).toContain('bloom')
      expect(lbls).toContain('glitch')
    })

    it('H02: effect type 值应含中文描述', () => {
      const source = `scene "t" {
  effect "e1" {
    type: \n  }
}`
      const items = completionsAt(source, 3, 10)
      const item = items.find((i) => i.label === 'vignette')
      expect(item!.detail).toContain('暗角')
    })
  })

  // ==========================================================================
  // 普通参数值不补全
  // ==========================================================================
  describe('普通参数值', () => {
    it('I01: "color:" 后不应提供补全(用户自由输入数组)', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    color: \n  }\n}'
      const items = completionsAt(source, 3, 11)
      expect(items).toHaveLength(0)
    })

    it('I02: "scale:" 后不应提供补全(用户自由输入数字)', () => {
      const source = 'scene "t" {\n  layer "bg" {\n    scale: \n  }\n}'
      const items = completionsAt(source, 3, 11)
      expect(items).toHaveLength(0)
    })
  })

  // ==========================================================================
  // 边界情况
  // ==========================================================================
  describe('边界情况', () => {
    it('J01: 空源码 root 应补全块关键字', () => {
      const items = completionsAt('', 1, 1)
      expect(items.length).toBeGreaterThan(0)
    })

    it('J02: 块关键字补全应含 snippet 占位符', () => {
      const items = completionsAt('', 1, 1)
      const layerItem = items.find((i) => i.label === 'layer')
      expect(layerItem!.insertText).toContain('${1:name}')
    })
  })
})
