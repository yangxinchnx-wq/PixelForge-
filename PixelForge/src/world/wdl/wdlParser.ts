/**
 * PixelForge - WDL Parser(Step 37.2)
 *
 * 职责:
 * - 递归下降语法分析器
 * - 消费 Lexer 产生的 token 流
 * - 构建 WDL AST(抽象语法树)
 * - 提供语法错误报告(含行号/列号)
 *
 * WDL 语法规则:
 *   document    := scene
 *   scene       := 'scene' STRING '{' sceneBody '}'
 *   sceneBody   := (canvas | layer | effect | region)*
 *   canvas      := 'canvas' ':' SIZE
 *   layer       := 'layer' STRING '{' paramBlock '}'
 *   effect      := 'effect' STRING '{' paramBlock '}'
 *   region      := 'region' STRING '{' paramBlock '}'
 *   paramBlock  := (param | stmt)*
 *   param       := IDENT ':' value
 *   stmt        := KEYWORD ':' value  (opcode/type/target/bounds/layers/blendMode/visible)
 *   value       := NUMBER | STRING | 'true' | 'false' | array
 *   array       := '[' (value (',' value)*)? ']'
 *
 * AST 节点类型:
 * - SceneNode: 根节点,含 canvas + layers + effects + regions
 * - LayerNode / EffectNode / RegionNode: 子声明
 * - ParamNode: 参数键值对
 * - ValueNode: 值节点(number/string/boolean/array)
 */
import { Lexer, Token, TokenType } from './wdlLexer'

// ============================================================================
// 1. AST 节点定义
// ============================================================================

/** AST 节点基础接口 */
export interface ASTNode {
  /** 节点类型 */
  type: string
  /** 行号 */
  line: number
  /** 列号 */
  column: number
}

/** 值节点类型 */
export type ValueNode =
  | { kind: 'number'; value: number; line: number; column: number }
  | { kind: 'string'; value: string; line: number; column: number }
  | { kind: 'boolean'; value: boolean; line: number; column: number }
  | { kind: 'array'; elements: ValueNode[]; line: number; column: number }
  | { kind: 'ident'; value: string; line: number; column: number }

/** 参数节点 */
export interface ParamNode extends ASTNode {
  type: 'param'
  /** 参数键 */
  key: string
  /** 参数值 */
  value: ValueNode
}

/** 图层声明节点 */
export interface LayerNode extends ASTNode {
  type: 'layer'
  /** 图层名称(来自字符串字面量) */
  name: string
  /** 参数列表 */
  params: ParamNode[]
}

/** 效果声明节点 */
export interface EffectNode extends ASTNode {
  type: 'effect'
  name: string
  params: ParamNode[]
}

/** 区域声明节点 */
export interface RegionNode extends ASTNode {
  type: 'region'
  name: string
  params: ParamNode[]
}

/** 场景根节点 */
export interface SceneNode extends ASTNode {
  type: 'scene'
  /** 场景名称 */
  name: string
  /** canvas 尺寸(width x height),默认 1920x1080 */
  canvas: { width: number; height: number } | null
  /** 图层列表 */
  layers: LayerNode[]
  /** 效果列表 */
  effects: EffectNode[]
  /** 区域列表 */
  regions: RegionNode[]
}

/** WDL 文档 AST = SceneNode */
export type WDLAST = SceneNode

// ============================================================================
// 2. ParseError
// ============================================================================

/** 语法分析错误 */
export class ParseError extends Error {
  line: number
  column: number

  constructor(message: string, line: number, column: number) {
    super(`WDL Parse Error (line ${line}, col ${column}): ${message}`)
    this.name = 'ParseError'
    this.line = line
    this.column = column
  }
}

// ============================================================================
// 3. Parser 实现(递归下降)
// ============================================================================

/**
 * WDL 递归下降语法分析器。
 *
 * 用法:
 *   const ast = parse(source)
 */
export class Parser {
  private tokens: Token[]
  private pos: number = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  // --------------------------------------------------------------------------
  // 公共入口
  // --------------------------------------------------------------------------

  /** 解析整个文档,返回 SceneNode AST */
  parse(): SceneNode {
    return this.parseScene()
  }

  // --------------------------------------------------------------------------
  // Token 辅助方法
  // --------------------------------------------------------------------------

  /** 当前 token */
  private current(): Token {
    return this.tokens[this.pos]
  }

  /** 前进一个 token,返回被消费的 token */
  private advance(): Token {
    const token = this.tokens[this.pos]
    if (this.pos < this.tokens.length - 1) {
      this.pos++
    }
    return token
  }

  /** 检查当前 token 类型是否匹配 */
  private check(type: TokenType): boolean {
    return this.current().type === type
  }

  /** 检查当前 token 是否为指定关键字 */
  private checkKeyword(keyword: string): boolean {
    const token = this.current()
    return token.type === TokenType.KEYWORD && token.value === keyword
  }

  /** 消费当前 token,要求类型匹配,否则抛错 */
  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance()
    }
    const token = this.current()
    throw new ParseError(
      `${message},但得到 ${token.type} '${token.value}'`,
      token.line,
      token.column,
    )
  }

  /** 消费当前 token,要求是指定关键字,否则抛错 */
  private consumeKeyword(keyword: string): Token {
    if (this.checkKeyword(keyword)) {
      return this.advance()
    }
    const token = this.current()
    throw new ParseError(
      `期望关键字 '${keyword}',但得到 ${token.type} '${token.value}'`,
      token.line,
      token.column,
    )
  }

  /** 消费冒号 */
  private consumeColon(): Token {
    return this.consume(TokenType.COLON, '期望冒号 :')
  }

  /** 消费左花括号 */
  private consumeLBrace(): Token {
    return this.consume(TokenType.LBRACE, '期望左花括号 {')
  }

  /** 消费右花括号 */
  private consumeRBrace(): Token {
    return this.consume(TokenType.RBRACE, '期望右花括号 }')
  }

  // --------------------------------------------------------------------------
  // 语法规则:scene
  // --------------------------------------------------------------------------

  private parseScene(): SceneNode {
    const sceneKeyword = this.consumeKeyword('scene')
    const nameToken = this.consume(TokenType.STRING, '期望场景名称字符串')
    this.consumeLBrace()

    const node: SceneNode = {
      type: 'scene',
      name: nameToken.value,
      line: sceneKeyword.line,
      column: sceneKeyword.column,
      canvas: null,
      layers: [],
      effects: [],
      regions: [],
    }

    // 解析 sceneBody
    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      if (this.checkKeyword('canvas')) {
        this.parseCanvas(node)
      } else if (this.checkKeyword('layer')) {
        node.layers.push(this.parseLayer())
      } else if (this.checkKeyword('effect')) {
        node.effects.push(this.parseEffect())
      } else if (this.checkKeyword('region')) {
        node.regions.push(this.parseRegion())
      } else {
        const token = this.current()
        throw new ParseError(
          `期望 canvas/layer/effect/region,但得到 ${token.type} '${token.value}'`,
          token.line,
          token.column,
        )
      }
    }

    this.consumeRBrace()
    return node
  }

  // --------------------------------------------------------------------------
  // 语法规则:canvas
  // --------------------------------------------------------------------------

  private parseCanvas(scene: SceneNode): void {
    this.consumeKeyword('canvas')
    this.consumeColon()
    const sizeToken = this.consume(TokenType.SIZE, '期望 canvas 尺寸(如 1920x1080)')

    const parts = sizeToken.value.split(/[xX]/)
    if (parts.length !== 2) {
      throw new ParseError(`无效的 canvas 尺寸 '${sizeToken.value}'`, sizeToken.line, sizeToken.column)
    }
    const width = parseInt(parts[0], 10)
    const height = parseInt(parts[1], 10)
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      throw new ParseError(`无效的 canvas 尺寸 '${sizeToken.value}'`, sizeToken.line, sizeToken.column)
    }

    scene.canvas = { width, height }
  }

  // --------------------------------------------------------------------------
  // 语法规则:layer / effect / region(结构相同,共用 parseDeclaration)
  // --------------------------------------------------------------------------

  private parseLayer(): LayerNode {
    const keyword = this.consumeKeyword('layer')
    const nameToken = this.consume(TokenType.STRING, '期望图层名称字符串')
    this.consumeLBrace()
    const params = this.parseParamBlock()
    this.consumeRBrace()
    return {
      type: 'layer',
      name: nameToken.value,
      params,
      line: keyword.line,
      column: keyword.column,
    }
  }

  private parseEffect(): EffectNode {
    const keyword = this.consumeKeyword('effect')
    const nameToken = this.consume(TokenType.STRING, '期望效果名称字符串')
    this.consumeLBrace()
    const params = this.parseParamBlock()
    this.consumeRBrace()
    return {
      type: 'effect',
      name: nameToken.value,
      params,
      line: keyword.line,
      column: keyword.column,
    }
  }

  private parseRegion(): RegionNode {
    const keyword = this.consumeKeyword('region')
    const nameToken = this.consume(TokenType.STRING, '期望区域名称字符串')
    this.consumeLBrace()
    const params = this.parseParamBlock()
    this.consumeRBrace()
    return {
      type: 'region',
      name: nameToken.value,
      params,
      line: keyword.line,
      column: keyword.column,
    }
  }

  // --------------------------------------------------------------------------
  // 语法规则:paramBlock
  // --------------------------------------------------------------------------

  private parseParamBlock(): ParamNode[] {
    const params: ParamNode[] = []

    while (!this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      params.push(this.parseParam())

      // 参数间可选逗号(CSS-like 多行用换行,单行用逗号)
      if (this.check(TokenType.COMMA)) {
        this.advance()
      }
    }

    return params
  }

  private parseParam(): ParamNode {
    const keyToken = this.current()
    // 参数键可以是 KEYWORD 或 IDENT
    if (keyToken.type !== TokenType.KEYWORD && keyToken.type !== TokenType.IDENT) {
      throw new ParseError(
        `期望参数名,但得到 ${keyToken.type} '${keyToken.value}'`,
        keyToken.line,
        keyToken.column,
      )
    }
    this.advance()
    this.consumeColon()
    const value = this.parseValue()

    return {
      type: 'param',
      key: keyToken.value,
      value,
      line: keyToken.line,
      column: keyToken.column,
    }
  }

  // --------------------------------------------------------------------------
  // 语法规则:value
  // --------------------------------------------------------------------------

  private parseValue(): ValueNode {
    const token = this.current()

    switch (token.type) {
      case TokenType.NUMBER:
        this.advance()
        return {
          kind: 'number',
          value: parseFloat(token.value),
          line: token.line,
          column: token.column,
        }

      case TokenType.STRING:
        this.advance()
        return {
          kind: 'string',
          value: token.value,
          line: token.line,
          column: token.column,
        }

      case TokenType.IDENT:
        this.advance()
        // 布尔值
        if (token.value === 'true') {
          return { kind: 'boolean', value: true, line: token.line, column: token.column }
        }
        if (token.value === 'false') {
          return { kind: 'boolean', value: false, line: token.line, column: token.column }
        }
        // 普通标识符(如 SOLID_COLOR / normal / add)
        return { kind: 'ident', value: token.value, line: token.line, column: token.column }

      case TokenType.KEYWORD:
        // 关键字作为值(如 opcode: SOLID_COLOR 中的 SOLID_COLOR 实际是 IDENT)
        // 但 WDL_KEYWORDS 不含 SOLID_COLOR,所以这通常不会发生
        // 如果发生,当作 ident 处理
        this.advance()
        return { kind: 'ident', value: token.value, line: token.line, column: token.column }

      case TokenType.LBRACKET:
        return this.parseArray()

      default:
        throw new ParseError(
          `期望值(NUMBER/STRING/数组),但得到 ${token.type} '${token.value}'`,
          token.line,
          token.column,
        )
    }
  }

  // --------------------------------------------------------------------------
  // 语法规则:array
  // --------------------------------------------------------------------------

  private parseArray(): ValueNode {
    const lbracket = this.consume(TokenType.LBRACKET, '期望左方括号 [')
    const elements: ValueNode[] = []

    // 空数组
    if (this.check(TokenType.RBRACKET)) {
      this.advance()
      return {
        kind: 'array',
        elements,
        line: lbracket.line,
        column: lbracket.column,
      }
    }

    // 第一个元素
    elements.push(this.parseValue())

    // 后续元素(逗号分隔)
    while (this.check(TokenType.COMMA)) {
      this.advance()
      elements.push(this.parseValue())
    }

    this.consume(TokenType.RBRACKET, '期望右方括号 ]')
    return {
      kind: 'array',
      elements,
      line: lbracket.line,
      column: lbracket.column,
    }
  }
}

// ============================================================================
// 4. 便捷函数
// ============================================================================

/**
 * 将 WDL 源码解析为 AST。
 *
 * @param source WDL 源码
 * @returns SceneNode AST
 * @throws LexerError 词法错误
 * @throws ParseError 语法错误
 */
export function parse(source: string): SceneNode {
  const lexer = new Lexer(source)
  const tokens = lexer.tokenize()
  return new Parser(tokens).parse()
}
