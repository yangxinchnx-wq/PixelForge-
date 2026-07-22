/**
 * PixelForge - WDL Lexer/Tokenizer(Step 37.1)
 *
 * 职责:
 * - 将 WDL 源码文本拆分为 token 流
 * - 支持关键字 / 标识符 / 数字 / 字符串 / 标点 / 注释
 * - 跳过空白字符和注释
 * - 提供行号/列号用于错误定位
 *
 * WDL 语法示例:
 *   scene "星空夜景" {
 *     canvas: 1920x1080
 *     layer "background" {
 *       opcode: SOLID_COLOR
 *       color: [0.02, 0.04, 0.12, 1.0]
 *       blendMode: normal
 *     }
 *   }
 *
 * Token 类型:
 * - KEYWORD: scene / layer / effect / region / canvas / opcode / type / target / bounds / layers / blendMode / visible
 * - IDENT: 标识符(参数名等)
 * - STRING: "..." 字符串字面量
 * - NUMBER: 数字字面量(整数/浮点/负数)
 * - LBRACE / RBRACE: { }
 * - LBRACKET / RBRACKET: [ ]
 * - COLON: :
 * - COMMA: ,
 * - SIZE: 1920x1080(宽x高尺寸字面量)
 * - EOF: 文件结束
 */
// ============================================================================
// 1. Token 类型定义
// ============================================================================

/** WDL Token 类型枚举 */
export enum TokenType {
  KEYWORD = 'KEYWORD',
  IDENT = 'IDENT',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  LBRACE = 'LBRACE',        // {
  RBRACE = 'RBRACE',        // }
  LBRACKET = 'LBRACKET',    // [
  RBRACKET = 'RBRACKET',    // ]
  COLON = 'COLON',           // :
  COMMA = 'COMMA',           // ,
  SIZE = 'SIZE',             // 1920x1080
  EOF = 'EOF',
}

/** WDL 关键字集合 */
export const WDL_KEYWORDS = new Set([
  'scene', 'layer', 'effect', 'region',
  'canvas', 'opcode', 'type', 'target',
  'bounds', 'layers', 'blendMode', 'visible',
])

/** Token 接口 */
export interface Token {
  /** Token 类型 */
  type: TokenType
  /** 原始文本 */
  value: string
  /** 行号(1-based) */
  line: number
  /** 列号(1-based) */
  column: number
}

// ============================================================================
// 2. LexerError
// ============================================================================

/** 词法分析错误 */
export class LexerError extends Error {
  line: number
  column: number

  constructor(message: string, line: number, column: number) {
    super(`WDL Lexer Error (line ${line}, col ${column}): ${message}`)
    this.name = 'LexerError'
    this.line = line
    this.column = column
  }
}

// ============================================================================
// 3. Lexer 实现
// ============================================================================

/**
 * WDL 词法分析器。
 *
 * 用法:
 *   const tokens = tokenize(source)
 *   for (const token of tokens) { ... }
 *
 * 单遍扫描,无回溯。支持:
 * - 空白字符(空格/Tab/换行)
 * - 单行注释 // ...
 * - 多行注释 / * ... * /
 * - 字符串字面量 "..."(支持转义 \" \\ \n \t)
 * - 数字字面量(整数/浮点/负数/科学计数法)
 * - 尺寸字面量 1920x1080 / 800x600
 * - 标识符和关键字([a-zA-Z_][a-zA-Z0-9_]*)
 * - 标点符号 { } [ ] : ,
 */
export class Lexer {
  private source: string
  private pos: number = 0
  private line: number = 1
  private column: number = 1
  private tokens: Token[] = []

  constructor(source: string) {
    this.source = source
  }

  /** 执行词法分析,返回 token 数组(以 EOF 结尾) */
  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]

      // 空白字符
      if (this.isWhitespace(ch)) {
        this.advance()
        continue
      }

      // 单行注释
      if (ch === '/' && this.peek(1) === '/') {
        this.skipLineComment()
        continue
      }

      // 多行注释
      if (ch === '/' && this.peek(1) === '*') {
        this.skipBlockComment()
        continue
      }

      // 字符串字面量
      if (ch === '"') {
        this.tokenizeString()
        continue
      }

      // 数字字面量(含负数)
      if (this.isDigit(ch) || (ch === '-' && this.isDigit(this.peek(1)))) {
        this.tokenizeNumber()
        continue
      }

      // 标识符和关键字
      if (this.isIdentStart(ch)) {
        this.tokenizeIdent()
        continue
      }

      // 标点符号
      this.tokenizePunctuation(ch)
    }

    this.tokens.push({
      type: TokenType.EOF,
      value: '',
      line: this.line,
      column: this.column,
    })

    return this.tokens
  }

  // --------------------------------------------------------------------------
  // 字符分类辅助
  // --------------------------------------------------------------------------

  private isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9'
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch)
  }

  /** 查看偏移 offset 处的字符(不推进位置),越界返回 '\0' */
  private peek(offset: number): string {
    const idx = this.pos + offset
    return idx < this.source.length ? this.source[idx] : '\0'
  }

  /** 推进一个字符,更新行号/列号 */
  private advance(): string {
    const ch = this.source[this.pos]
    this.pos++
    if (ch === '\n') {
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return ch
  }

  // --------------------------------------------------------------------------
  // 注释跳过
  // --------------------------------------------------------------------------

  private skipLineComment(): void {
    // 已确认前两个字符是 //
    this.advance()
    this.advance()
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.advance()
    }
  }

  private skipBlockComment(): void {
    // 已确认前两个字符是 /*
    const startLine = this.line
    const startCol = this.column
    this.advance()
    this.advance()
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === '*' && this.peek(1) === '/') {
        this.advance()
        this.advance()
        return
      }
      this.advance()
    }
    throw new LexerError('未闭合的多行注释', startLine, startCol)
  }

  // --------------------------------------------------------------------------
  // 字符串字面量
  // --------------------------------------------------------------------------

  private tokenizeString(): void {
    const startLine = this.line
    const startCol = this.column
    this.advance() // 跳过开头的 "

    let value = ''
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]

      if (ch === '"') {
        this.advance() // 跳过结尾的 "
        this.tokens.push({
          type: TokenType.STRING,
          value,
          line: startLine,
          column: startCol,
        })
        return
      }

      if (ch === '\\') {
        // 转义字符
        this.advance()
        const escaped = this.source[this.pos]
        switch (escaped) {
          case '"': value += '"'; break
          case '\\': value += '\\'; break
          case 'n': value += '\n'; break
          case 't': value += '\t'; break
          case 'r': value += '\r'; break
          default:
            throw new LexerError(`无效的转义字符 \\${escaped}`, this.line, this.column)
        }
        this.advance()
        continue
      }

      if (ch === '\n') {
        throw new LexerError('字符串字面量中不允许换行', this.line, this.column)
      }

      value += ch
      this.advance()
    }

    throw new LexerError('未闭合的字符串字面量', startLine, startCol)
  }

  // --------------------------------------------------------------------------
  // 数字字面量(含尺寸 1920x1080)
  // --------------------------------------------------------------------------

  private tokenizeNumber(): void {
    const startLine = this.line
    const startCol = this.column
    let value = ''

    // 可选负号
    if (this.source[this.pos] === '-') {
      value += '-'
      this.advance()
    }

    // 整数部分
    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.source[this.pos]
      this.advance()
    }

    // 小数部分
    if (this.source[this.pos] === '.') {
      value += '.'
      this.advance()
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        value += this.source[this.pos]
        this.advance()
      }
    }

    // 科学计数法
    if (this.source[this.pos] === 'e' || this.source[this.pos] === 'E') {
      const expPart = this.source[this.pos]
      value += expPart
      this.advance()
      if (this.source[this.pos] === '+' || this.source[this.pos] === '-') {
        value += this.source[this.pos]
        this.advance()
      }
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        value += this.source[this.pos]
        this.advance()
      }
    }

    // 尺寸字面量: 1920x1080 / 800x600 (大小写不敏感)
    if (this.source[this.pos] === 'x' || this.source[this.pos] === 'X') {
      const xChar = this.source[this.pos]
      const afterX = this.peek(1)
      if (this.isDigit(afterX)) {
        // 确认是尺寸字面量
        let widthPart = value
        this.advance() // 跳过 x/X

        let heightPart = ''
        while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
          heightPart += this.source[this.pos]
          this.advance()
        }

        this.tokens.push({
          type: TokenType.SIZE,
          value: `${widthPart}${xChar}${heightPart}`,
          line: startLine,
          column: startCol,
        })
        return
      }
    }

    this.tokens.push({
      type: TokenType.NUMBER,
      value,
      line: startLine,
      column: startCol,
    })
  }

  // --------------------------------------------------------------------------
  // 标识符和关键字
  // --------------------------------------------------------------------------

  private tokenizeIdent(): void {
    const startLine = this.line
    const startCol = this.column
    let value = ''

    while (this.pos < this.source.length && this.isIdentPart(this.source[this.pos])) {
      value += this.source[this.pos]
      this.advance()
    }

    const type = WDL_KEYWORDS.has(value) ? TokenType.KEYWORD : TokenType.IDENT
    this.tokens.push({
      type,
      value,
      line: startLine,
      column: startCol,
    })
  }

  // --------------------------------------------------------------------------
  // 标点符号
  // --------------------------------------------------------------------------

  private tokenizePunctuation(ch: string): void {
    const startLine = this.line
    const startCol = this.column
    let type: TokenType

    switch (ch) {
      case '{': type = TokenType.LBRACE; break
      case '}': type = TokenType.RBRACE; break
      case '[': type = TokenType.LBRACKET; break
      case ']': type = TokenType.RBRACKET; break
      case ':': type = TokenType.COLON; break
      case ',': type = TokenType.COMMA; break
      default:
        throw new LexerError(`意外字符 '${ch}'`, startLine, startCol)
    }

    this.advance()
    this.tokens.push({ type, value: ch, line: startLine, column: startCol })
  }
}

// ============================================================================
// 4. 便捷函数
// ============================================================================

/**
 * 将 WDL 源码文本词法分析为 token 数组。
 *
 * @param source WDL 源码
 * @returns token 数组(以 EOF 结尾)
 * @throws LexerError 词法错误
 */
export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize()
}
