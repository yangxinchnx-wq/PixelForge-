/**
 * WDL Lexer Tests(Step 37.1)— 词法分析测试。
 */
import { describe, it, expect } from 'vitest'
import {
  Lexer,
  tokenize,
  TokenType,
  WDL_KEYWORDS,
  LexerError,
} from './wdlLexer'

// ============================================================================
// 辅助函数
// ============================================================================

/** 提取 token 类型数组(去掉 EOF) */
function types(source: string): TokenType[] {
  return tokenize(source)
    .filter((t) => t.type !== TokenType.EOF)
    .map((t) => t.type)
}

/** 提取 token 值数组(去掉 EOF) */
function values(source: string): string[] {
  return tokenize(source)
    .filter((t) => t.type !== TokenType.EOF)
    .map((t) => t.value)
}

// ============================================================================
// 测试
// ============================================================================

describe('WDL Lexer', () => {
  // ==========================================================================
  // 基础 token 识别
  // ==========================================================================
  describe('基础 token 识别', () => {
    it('L01: 空字符串应只产生 EOF', () => {
      const tokens = tokenize('')
      expect(tokens).toHaveLength(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
    })

    it('L02: 空白字符应被跳过', () => {
      const tokens = tokenize('   \n\t\r  ')
      expect(tokens).toHaveLength(1)
      expect(tokens[0].type).toBe(TokenType.EOF)
    })

    it('L03: 单行注释应被跳过', () => {
      const tokens = tokenize('// 这是注释\nscene')
      expect(tokens).toHaveLength(2)
      expect(tokens[0].type).toBe(TokenType.KEYWORD)
      expect(tokens[0].value).toBe('scene')
    })

    it('L04: 多行注释应被跳过', () => {
      const tokens = tokenize('/* 这是\n多行注释 */scene')
      expect(tokens).toHaveLength(2)
      expect(tokens[0].value).toBe('scene')
    })

    it('L05: 行尾单行注释', () => {
      const tokens = tokenize('scene // 行尾注释')
      expect(tokens).toHaveLength(2)
      expect(tokens[0].value).toBe('scene')
      expect(tokens[1].type).toBe(TokenType.EOF)
    })
  })

  // ==========================================================================
  // 标点符号
  // ==========================================================================
  describe('标点符号', () => {
    it('L06: 应正确识别花括号', () => {
      expect(types('{ }')).toEqual([TokenType.LBRACE, TokenType.RBRACE])
    })

    it('L07: 应正确识别方括号', () => {
      expect(types('[ ]')).toEqual([TokenType.LBRACKET, TokenType.RBRACKET])
    })

    it('L08: 应正确识别冒号和逗号', () => {
      expect(types(': ,')).toEqual([TokenType.COLON, TokenType.COMMA])
    })

    it('L09: 标点符号的值应保留', () => {
      const vals = values('{ } [ ] : ,')
      expect(vals).toEqual(['{', '}', '[', ']', ':', ','])
    })
  })

  // ==========================================================================
  // 字符串字面量
  // ==========================================================================
  describe('字符串字面量', () => {
    it('L10: 简单字符串', () => {
      const tokens = tokenize('"hello"')
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('hello')
    })

    it('L11: 含空格的字符串', () => {
      const tokens = tokenize('"星空 夜景"')
      expect(tokens[0].value).toBe('星空 夜景')
    })

    it('L12: 转义双引号', () => {
      const tokens = tokenize('"say \\"hi\\""')
      expect(tokens[0].value).toBe('say "hi"')
    })

    it('L13: 转义反斜杠', () => {
      const tokens = tokenize('"path\\\\file"')
      expect(tokens[0].value).toBe('path\\file')
    })

    it('L14: 转义换行符', () => {
      const tokens = tokenize('"line1\\nline2"')
      expect(tokens[0].value).toBe('line1\nline2')
    })

    it('L15: 转义制表符', () => {
      const tokens = tokenize('"col1\\tcol2"')
      expect(tokens[0].value).toBe('col1\tcol2')
    })

    it('L16: 空字符串', () => {
      const tokens = tokenize('""')
      expect(tokens[0].type).toBe(TokenType.STRING)
      expect(tokens[0].value).toBe('')
    })

    it('L17: 未闭合字符串应抛错', () => {
      expect(() => tokenize('"unclosed')).toThrow(LexerError)
      expect(() => tokenize('"unclosed')).toThrow(/未闭合/)
    })

    it('L18: 字符串中换行应抛错', () => {
      expect(() => tokenize('"line1\nline2"')).toThrow(LexerError)
    })

    it('L19: 无效转义字符应抛错', () => {
      expect(() => tokenize('"\\q"')).toThrow(LexerError)
    })
  })

  // ==========================================================================
  // 数字字面量
  // ==========================================================================
  describe('数字字面量', () => {
    it('L20: 整数', () => {
      const tokens = tokenize('42')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('42')
    })

    it('L21: 浮点数', () => {
      const tokens = tokenize('3.14')
      expect(tokens[0].value).toBe('3.14')
    })

    it('L22: 负数', () => {
      const tokens = tokenize('-0.5')
      expect(tokens[0].value).toBe('-0.5')
    })

    it('L23: 科学计数法', () => {
      const tokens = tokenize('1.5e3')
      expect(tokens[0].value).toBe('1.5e3')
    })

    it('L24: 负科学计数法指数', () => {
      const tokens = tokenize('2e-3')
      expect(tokens[0].value).toBe('2e-3')
    })

    it('L25: 零', () => {
      const tokens = tokenize('0')
      expect(tokens[0].value).toBe('0')
    })

    it('L26: 0 开头的浮点数', () => {
      const tokens = tokenize('0.5')
      expect(tokens[0].value).toBe('0.5')
    })
  })

  // ==========================================================================
  // 尺寸字面量
  // ==========================================================================
  describe('尺寸字面量', () => {
    it('L27: 标准 SIZE 1920x1080', () => {
      const tokens = tokenize('1920x1080')
      expect(tokens[0].type).toBe(TokenType.SIZE)
      expect(tokens[0].value).toBe('1920x1080')
    })

    it('L28: 大写 X', () => {
      const tokens = tokenize('800X600')
      expect(tokens[0].type).toBe(TokenType.SIZE)
      expect(tokens[0].value).toBe('800X600')
    })

    it('L29: 正方形尺寸', () => {
      const tokens = tokenize('512x512')
      expect(tokens[0].type).toBe(TokenType.SIZE)
    })

    it('L30: 数字后跟 x 但非尺寸应分别识别', () => {
      // 100 后面是 x 但 x 后面不是数字,所以 100 是 NUMBER,x 是 IDENT
      const tokens = tokenize('100x')
      expect(tokens[0].type).toBe(TokenType.NUMBER)
      expect(tokens[0].value).toBe('100')
      expect(tokens[1].type).toBe(TokenType.IDENT)
      expect(tokens[1].value).toBe('x')
    })
  })

  // ==========================================================================
  // 标识符和关键字
  // ==========================================================================
  describe('标识符和关键字', () => {
    it('L31: 关键字 scene 应识别为 KEYWORD', () => {
      const tokens = tokenize('scene')
      expect(tokens[0].type).toBe(TokenType.KEYWORD)
      expect(tokens[0].value).toBe('scene')
    })

    it('L32: 关键字 layer 应识别为 KEYWORD', () => {
      const tokens = tokenize('layer')
      expect(tokens[0].type).toBe(TokenType.KEYWORD)
    })

    it('L33: 非关键字标识符应识别为 IDENT', () => {
      const tokens = tokenize('myParam')
      expect(tokens[0].type).toBe(TokenType.IDENT)
      expect(tokens[0].value).toBe('myParam')
    })

    it('L34: 下划线开头的标识符', () => {
      const tokens = tokenize('_private')
      expect(tokens[0].type).toBe(TokenType.IDENT)
      expect(tokens[0].value).toBe('_private')
    })

    it('L35: 含数字的标识符', () => {
      const tokens = tokenize('color2')
      expect(tokens[0].type).toBe(TokenType.IDENT)
      expect(tokens[0].value).toBe('color2')
    })

    it('L36: 所有 WDL 关键字应正确识别', () => {
      const keywords = Array.from(WDL_KEYWORDS)
      for (const kw of keywords) {
        const tokens = tokenize(kw)
        expect(tokens[0].type).toBe(TokenType.KEYWORD)
      }
    })
  })

  // ==========================================================================
  // 行号/列号
  // ==========================================================================
  describe('行号和列号', () => {
    it('L37: 第一行 token 的行号应为 1', () => {
      const tokens = tokenize('scene')
      expect(tokens[0].line).toBe(1)
      expect(tokens[0].column).toBe(1)
    })

    it('L38: 第二行 token 的行号应为 2', () => {
      const tokens = tokenize('\nscene')
      expect(tokens[0].line).toBe(2)
      expect(tokens[0].column).toBe(1)
    })

    it('L39: 列号应正确递增', () => {
      const tokens = tokenize('scene "test"')
      expect(tokens[0].column).toBe(1)
      expect(tokens[1].column).toBe(7) // scene 占 5 字符 + 1 空格 = 第 7 列
    })

    it('L40: 多行 token 的行号应正确', () => {
      const source = 'scene "a" {\n  layer "b" {\n  }\n}'
      const tokens = tokenize(source)
      expect(tokens[0].line).toBe(1) // scene
      expect(tokens[1].line).toBe(1) // "a"
      expect(tokens[2].line).toBe(1) // {
      expect(tokens[3].line).toBe(2) // layer
      expect(tokens[4].line).toBe(2) // "b"
      expect(tokens[5].line).toBe(2) // {
      expect(tokens[6].line).toBe(3) // }
      expect(tokens[7].line).toBe(4) // }
    })
  })

  // ==========================================================================
  // 错误处理
  // ==========================================================================
  describe('错误处理', () => {
    it('L41: 意外字符应抛 LexerError', () => {
      expect(() => tokenize('@')).toThrow(LexerError)
      expect(() => tokenize('@')).toThrow(/意外字符/)
    })

    it('L42: 未闭合多行注释应抛错', () => {
      expect(() => tokenize('/* 未闭合')).toThrow(LexerError)
      expect(() => tokenize('/* 未闭合')).toThrow(/未闭合/)
    })

    it('L43: LexerError 应包含行号和列号', () => {
      try {
        tokenize('\n\n  @')
        expect.fail('应抛出错误')
      } catch (e) {
        expect(e).toBeInstanceOf(LexerError)
        const err = e as LexerError
        expect(err.line).toBe(3)
        expect(err.column).toBe(3)
      }
    })
  })

  // ==========================================================================
  // 完整场景词法分析
  // ==========================================================================
  describe('完整场景词法分析', () => {
    it('L44: 应正确词法分析完整场景', () => {
      const source = `scene "星空夜景" {
  canvas: 1920x1080

  layer "background" {
    opcode: SOLID_COLOR
    color: [0.02, 0.04, 0.12, 1.0]
    blendMode: normal
  }

  effect "vignette" {
    type: vignette
    target: "background"
    intensity: 0.6
  }
}`
      const tokens = tokenize(source)

      // 验证开头几个 token
      expect(tokens[0].type).toBe(TokenType.KEYWORD)
      expect(tokens[0].value).toBe('scene')
      expect(tokens[1].type).toBe(TokenType.STRING)
      expect(tokens[1].value).toBe('星空夜景')
      expect(tokens[2].type).toBe(TokenType.LBRACE)
      expect(tokens[3].type).toBe(TokenType.KEYWORD)
      expect(tokens[3].value).toBe('canvas')
      expect(tokens[4].type).toBe(TokenType.COLON)
      expect(tokens[5].type).toBe(TokenType.SIZE)
      expect(tokens[5].value).toBe('1920x1080')

      // 最后一个应是 EOF
      expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF)
    })

    it('L45: 应正确处理注释混合代码', () => {
      const source = `// 场景定义
scene "test" { /* 内联注释 */ }`
      const tokens = tokenize(source)
      expect(tokens[0].value).toBe('scene')
      expect(tokens[1].value).toBe('test')
      expect(tokens[2].value).toBe('{')
      expect(tokens[3].value).toBe('}')
    })
  })

  // ==========================================================================
  // Lexer 类直接使用
  // ==========================================================================
  describe('Lexer 类', () => {
    it('L46: 应支持多次调用 tokenize', () => {
      const lexer = new Lexer('scene')
      const t1 = lexer.tokenize()
      expect(t1).toHaveLength(2)
      expect(t1[0].value).toBe('scene')
    })

    it('L47: Token 接口字段完整性', () => {
      const tokens = tokenize('scene')
      const token = tokens[0]
      expect(token).toHaveProperty('type')
      expect(token).toHaveProperty('value')
      expect(token).toHaveProperty('line')
      expect(token).toHaveProperty('column')
    })
  })
})
