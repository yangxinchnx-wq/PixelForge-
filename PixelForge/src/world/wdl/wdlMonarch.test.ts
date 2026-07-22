/**
 * WDL Monarch Tokenizer Tests(Step 38.1)— Monarch 词法定义结构测试。
 *
 * 测试策略:
 * - 结构测试:验证 Monarch 定义对象包含正确的状态/规则/关键字列表
 * - 映射测试:验证 WDL Lexer token 类型与 Monarch token class 的映射关系
 * - 不依赖 Monaco 运行时(纯数据校验),可在 vitest node 环境运行
 */
import { describe, it, expect } from 'vitest'
import {
  WDL_LANGUAGE_ID,
  WDL_MONARCH_KEYWORDS,
  WDL_MONARCH_OPCODES,
  WDL_MONARCH_BLEND_MODES,
  WDL_MONARCH_BOOLEANS,
  wdlMonarchDefinition,
} from './wdlMonarch'
import { WDL_KEYWORDS } from './wdlLexer'

// ============================================================================
// 辅助函数
// ============================================================================

/** 安全获取 Monarch 规则的 regex(第一个元素) */
function ruleRegex(rule: unknown): RegExp | null {
  if (Array.isArray(rule) && rule[0] instanceof RegExp) return rule[0]
  return null
}

/** 安全获取 Monarch 规则的 action(第二个元素) */
function ruleAction(rule: unknown): unknown {
  if (Array.isArray(rule)) return rule[1]
  return null
}

/** 判断规则是否含 cases(action 是对象且有 cases 字段) */
function ruleHasCases(rule: unknown): boolean {
  const action = ruleAction(rule)
  return typeof action === 'object' && action !== null && 'cases' in action
}

/** 安全获取规则的 cases 对象 */
function ruleCases(rule: unknown): Record<string, string> {
  const action = ruleAction(rule) as { cases?: Record<string, string> }
  return action?.cases ?? {}
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Monarch Tokenizer', () => {
  // ==========================================================================
  // 语言 ID
  // ==========================================================================
  describe('语言 ID', () => {
    it('M01: 语言 ID 应为 "wdl"', () => {
      expect(WDL_LANGUAGE_ID).toBe('wdl')
    })
  })

  // ==========================================================================
  // 关键字同步
  // ==========================================================================
  describe('关键字同步', () => {
    it('M02: Monarch 关键字应与 wdlLexer WDL_KEYWORDS 完全一致', () => {
      const lexerKeywords = Array.from(WDL_KEYWORDS).sort()
      const monarchKeywords = [...WDL_MONARCH_KEYWORDS].sort()
      expect(monarchKeywords).toEqual(lexerKeywords)
    })

    it('M03: 应包含所有 12 个关键字', () => {
      expect(WDL_MONARCH_KEYWORDS).toHaveLength(12)
    })

    it('M04: 应包含 scene/layer/effect/region 块关键字', () => {
      expect(WDL_MONARCH_KEYWORDS).toContain('scene')
      expect(WDL_MONARCH_KEYWORDS).toContain('layer')
      expect(WDL_MONARCH_KEYWORDS).toContain('effect')
      expect(WDL_MONARCH_KEYWORDS).toContain('region')
    })

    it('M05: 应包含 canvas/opcode/type/target/bounds/layers/blendMode/visible 参数关键字', () => {
      const paramKeywords = ['canvas', 'opcode', 'type', 'target', 'bounds', 'layers', 'blendMode', 'visible']
      for (const kw of paramKeywords) {
        expect(WDL_MONARCH_KEYWORDS).toContain(kw)
      }
    })
  })

  // ==========================================================================
  // opcode 值
  // ==========================================================================
  describe('opcode 值', () => {
    it('M06: 应包含所有 6 种 opcode', () => {
      expect(WDL_MONARCH_OPCODES).toHaveLength(6)
    })

    it('M07: 应包含 SOLID_COLOR / LINEAR_GRADIENT / NOISE / BLEND / CIRCLE_SHAPE / IMAGE_TEXTURE', () => {
      const expected = ['SOLID_COLOR', 'LINEAR_GRADIENT', 'NOISE', 'BLEND', 'CIRCLE_SHAPE', 'IMAGE_TEXTURE']
      for (const op of expected) {
        expect(WDL_MONARCH_OPCODES).toContain(op)
      }
    })
  })

  // ==========================================================================
  // blendMode 值
  // ==========================================================================
  describe('blendMode 值', () => {
    it('M08: 应包含所有 6 种 blendMode', () => {
      expect(WDL_MONARCH_BLEND_MODES).toHaveLength(6)
    })

    it('M09: 应包含 normal/multiply/screen/overlay/add/subtract', () => {
      const expected = ['normal', 'multiply', 'screen', 'overlay', 'add', 'subtract']
      for (const bm of expected) {
        expect(WDL_MONARCH_BLEND_MODES).toContain(bm)
      }
    })
  })

  // ==========================================================================
  // 布尔值
  // ==========================================================================
  describe('布尔值', () => {
    it('M10: 应包含 true 和 false', () => {
      expect(WDL_MONARCH_BOOLEANS).toContain('true')
      expect(WDL_MONARCH_BOOLEANS).toContain('false')
      expect(WDL_MONARCH_BOOLEANS).toHaveLength(2)
    })
  })

  // ==========================================================================
  // Monarch 定义结构
  // ==========================================================================
  describe('Monarch 定义结构', () => {
    it('M11: 应有 tokenPostfix', () => {
      expect(wdlMonarchDefinition.tokenPostfix).toBe('.wdl')
    })

    it('M12: 应有 keywords/opcodes/blendModes/booleans 列表', () => {
      expect(wdlMonarchDefinition.keywords).toBeDefined()
      expect(wdlMonarchDefinition.opcodes).toBeDefined()
      expect(wdlMonarchDefinition.blendModes).toBeDefined()
      expect(wdlMonarchDefinition.booleans).toBeDefined()
    })

    it('M13: tokenizer 应包含 root/comment/string 三个状态', () => {
      expect(wdlMonarchDefinition.tokenizer.root).toBeDefined()
      expect(wdlMonarchDefinition.tokenizer.comment).toBeDefined()
      expect(wdlMonarchDefinition.tokenizer.string).toBeDefined()
    })

    it('M14: root 状态应至少有 9 条规则', () => {
      expect(wdlMonarchDefinition.tokenizer.root.length).toBeGreaterThanOrEqual(9)
    })
  })

  // ==========================================================================
  // root 规则验证
  // ==========================================================================
  describe('root 规则', () => {
    const rootRules = wdlMonarchDefinition.tokenizer.root

    it('M15: 应有单行注释规则(//)', () => {
      const hasLineComment = rootRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('// hello')
      )
      expect(hasLineComment).toBe(true)
    })

    it('M16: 应有多行注释规则(/*)', () => {
      const hasBlockComment = rootRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('/*')
      )
      expect(hasBlockComment).toBe(true)
    })

    it('M17: 应有字符串开头规则(")', () => {
      const hasString = rootRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('"')
      )
      expect(hasString).toBe(true)
    })

    it('M18: 应有尺寸字面量规则(1920x1080)', () => {
      const hasSize = rootRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('1920x1080')
      )
      expect(hasSize).toBe(true)
    })

    it('M19: 应有数字规则(42 / 3.14 / -0.5)', () => {
      const hasNumber = rootRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('42') && rule[0].test('3.14') && rule[0].test('-0.5')
      )
      expect(hasNumber).toBe(true)
    })

    it('M20: 应有标识符/关键字规则', () => {
      const hasIdent = rootRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('scene') && rule[0].test('myParam')
      )
      expect(hasIdent).toBe(true)
    })

    it('M21: 尺寸规则应在数字规则之前', () => {
      let sizeIdx = -1
      let numberIdx = -1
      rootRules.forEach((rule, i) => {
        if (Array.isArray(rule) && rule[0] instanceof RegExp) {
          const src = rule[0].source
          // 尺寸规则 source 含 [xX]
          if (src.includes('[xX]')) sizeIdx = i
          // 数字规则 source 含 -? 但不含 [xX]
          if (src.includes('-?') && !src.includes('[xX]')) numberIdx = i
        }
      })
      expect(sizeIdx).toBeGreaterThanOrEqual(0)
      expect(numberIdx).toBeGreaterThanOrEqual(0)
      expect(sizeIdx).toBeLessThan(numberIdx)
    })
  })

  // ==========================================================================
  // comment 状态
  // ==========================================================================
  describe('comment 状态', () => {
    const commentRules = wdlMonarchDefinition.tokenizer.comment

    it('M22: 应有 */ 结束规则(含 @pop)', () => {
      const hasEnd = commentRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('*/')
      )
      expect(hasEnd).toBe(true)
    })

    it('M23: 应至少有 2 条规则', () => {
      expect(commentRules.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ==========================================================================
  // string 状态
  // ==========================================================================
  describe('string 状态', () => {
    const stringRules = wdlMonarchDefinition.tokenizer.string

    it('M24: 应有 " 结束规则(含 @pop)', () => {
      const hasEnd = stringRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('"')
      )
      expect(hasEnd).toBe(true)
    })

    it('M25: 应有转义字符规则(\\\\n \\\\t \\\\")', () => {
      const hasEscape = stringRules.some(
        (rule) => Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].test('\\n')
      )
      expect(hasEscape).toBe(true)
    })

    it('M26: 应至少有 3 条规则', () => {
      expect(stringRules.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ==========================================================================
  // token class 映射
  // ==========================================================================
  describe('token class 映射', () => {
    it('M27: 关键字应映射到 "keyword" token class', () => {
      const keywordRule = wdlMonarchDefinition.tokenizer.root.find(ruleHasCases)
      expect(keywordRule).toBeDefined()
      const cases = ruleCases(keywordRule)
      expect(cases['@keywords']).toBe('keyword')
    })

    it('M28: opcode 应映射到 "type.identifier" token class', () => {
      const keywordRule = wdlMonarchDefinition.tokenizer.root.find(ruleHasCases)
      const cases = ruleCases(keywordRule)
      expect(cases['@opcodes']).toBe('type.identifier')
    })

    it('M29: 标识符应映射到 "identifier" token class', () => {
      const keywordRule = wdlMonarchDefinition.tokenizer.root.find(ruleHasCases)
      const cases = ruleCases(keywordRule)
      expect(cases['@default']).toBe('identifier')
    })

    it('M30: 单行注释应映射到 "comment" token class', () => {
      const lineCommentRule = wdlMonarchDefinition.tokenizer.root.find(
        (rule) => ruleRegex(rule)?.test('// hello') === true && ruleAction(rule) === 'comment'
      )
      expect(lineCommentRule).toBeDefined()
    })

    it('M31: 字符串开头应映射到 "string" token class', () => {
      const stringRule = wdlMonarchDefinition.tokenizer.root.find(
        (rule) => ruleRegex(rule)?.test('"') === true && ruleAction(rule) === 'string'
      )
      expect(stringRule).toBeDefined()
    })

    it('M32: 数字应映射到 "number" token class', () => {
      const numberRule = wdlMonarchDefinition.tokenizer.root.find(
        (rule) => {
          const re = ruleRegex(rule)
          if (!re) return false
          return re.source.includes('-?') && !re.source.includes('[xX]') && ruleAction(rule) === 'number'
        }
      )
      expect(numberRule).toBeDefined()
    })

    it('M33: 尺寸应映射到 "number.hex" token class', () => {
      const sizeRule = wdlMonarchDefinition.tokenizer.root.find(
        (rule) => {
          const re = ruleRegex(rule)
          if (!re) return false
          return re.test('1920x1080') && !re.test('42') && ruleAction(rule) === 'number.hex'
        }
      )
      expect(sizeRule).toBeDefined()
    })
  })
})
