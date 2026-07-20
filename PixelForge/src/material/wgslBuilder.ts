/**
 * WGSL Builder(Step 28.10)— 结构化 WGSL 代码生成器。
 *
 * 职责:
 * - 避免直接字符串拼接(可读性 / 可维护性差)
 * - 提供层级缩进管理(block 嵌套)
 * - 提供变量名生成器(避免命名冲突)
 * - 输出格式化的 WGSL 源码
 *
 * 用法:
 *   const b = new WGSLBuilder()
 *   b.addLine('let uv = input.uv;')
 *   b.openBlock('fn noise(p: vec2<f32>) -> f32')
 *   b.addLine('return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);')
 *   b.closeBlock()
 *   const code = b.build()
 *
 * 与 compiler.ts 的协作:
 * - compiler 为每个节点创建独立 WGSLBuilder(或共享一个 builder + 缩进管理)
 * - 节点 generateWGSL 通过 ctx.builder.add* 写入代码
 * - compiler 最终合并所有 builder 输出
 */

import type { PortType } from './types'

/** WGSL 类型 → 默认零值字面量 */
const ZERO_LITERALS: Record<PortType, string> = {
  float: '0.0',
  vec2: 'vec2<f32>(0.0, 0.0)',
  vec3: 'vec3<f32>(0.0, 0.0, 0.0)',
  vec4: 'vec4<f32>(0.0, 0.0, 0.0, 0.0)',
  texture: 'texture_2d<f32>',  // texture 类型不能有零值,这里仅占位
}

/** WGSL 类型 → WGSL 类型声明字符串 */
const TYPE_DECL: Record<PortType, string> = {
  float: 'f32',
  vec2: 'vec2<f32>',
  vec3: 'vec3<f32>',
  vec4: 'vec4<f32>',
  texture: 'texture_2d<f32>',
}

export class WGSLBuilder {
  private lines: string[] = []
  private indent = 0
  private varCounter = 0

  /** 增加缩进 */
  pushIndent(): this {
    this.indent++
    return this
  }

  /** 减少缩进 */
  popIndent(): this {
    if (this.indent > 0) this.indent--
    return this
  }

  /** 打开一个代码块(自动添加 { 和缩进) */
  openBlock(header: string): this {
    this.addLine(`${header} {`)
    this.pushIndent()
    return this
  }

  /** 关闭当前代码块(减少缩进 + 添加 }) */
  closeBlock(): this {
    this.popIndent()
    this.addLine('}')
    return this
  }

  /** 添加一行代码(自动应用当前缩进) */
  addLine(code: string): this {
    const padding = '    '.repeat(this.indent)
    this.lines.push(`${padding}${code}`)
    return this
  }

  /** 添加空行 */
  addEmptyLine(): this {
    this.lines.push('')
    return this
  }

  /** 添加注释 */
  addComment(text: string): this {
    this.addLine(`// ${text}`)
    return this
  }

  /**
   * 生成唯一变量名。
   * - base: 变量基础名(如 'uv' / 'color' / 'noise')
   * - 返回: `${base}_${counter}`(如 'uv_0' / 'color_1')
   */
  genVar(base: string): string {
    const name = `${base}_${this.varCounter}`
    this.varCounter++
    return name
  }

  /**
   * 声明变量(let,不可变)。
   * - name:     变量名
   * - type:     WGSL 类型
   * - initExpr: 初始化表达式
   */
  addLet(name: string, type: PortType, initExpr: string): this {
    this.addLine(`let ${name}: ${TYPE_DECL[type]} = ${initExpr};`)
    return this
  }

  /**
   * 声明变量(var,可变)。
   */
  addVar(name: string, type: PortType, initExpr?: string): this {
    if (initExpr) {
      this.addLine(`var ${name}: ${TYPE_DECL[type]} = ${initExpr};`)
    } else {
      this.addLine(`var ${name}: ${TYPE_DECL[type]} = ${ZERO_LITERALS[type]};`)
    }
    return this
  }

  /** 赋值语句 */
  addAssign(name: string, expr: string): this {
    this.addLine(`${name} = ${expr};`)
    return this
  }

  /** return 语句 */
  addReturn(expr: string): this {
    this.addLine(`return ${expr};`)
    return this
  }

  /** 获取类型声明字符串 */
  static typeDecl(type: PortType): string {
    return TYPE_DECL[type]
  }

  /** 获取零值字面量 */
  static zeroLiteral(type: PortType): string {
    return ZERO_LITERALS[type]
  }

  /** 构建最终 WGSL 源码 */
  build(): string {
    return this.lines.join('\n')
  }

  /** 当前代码行数(调试用) */
  get lineCount(): number {
    return this.lines.length
  }
}

/**
 * 把端口类型转换表达式包装为字符串。
 *
 * 用于 typeChecker 允许的兼容连接(如 vec4 → vec3 取 .rgb):
 *   vec3 ← vec4: vec3<f32>(input.rgb)
 *   vec4 ← vec3: vec4<f32>(input, 1.0)
 *   float ← vec2/3/4: input.x(取第一个分量)
 *
 * @param fromType 上游输出类型
 * @param toType   下游输入类型
 * @param varName  上游变量名
 * @returns 转换后的表达式(若类型相同则直接返回 varName)
 */
export function castPortType(
  fromType: PortType,
  toType: PortType,
  varName: string,
): string {
  if (fromType === toType) return varName

  // vec3 ← vec4: 截断
  if (fromType === 'vec4' && toType === 'vec3') {
    return `vec3<f32>(${varName}.rgb)`
  }
  // vec4 ← vec3: 扩展 alpha=1
  if (fromType === 'vec3' && toType === 'vec4') {
    return `vec4<f32>(${varName}, 1.0)`
  }
  // float ← vec*: 取 .x
  if (toType === 'float' && (fromType === 'vec2' || fromType === 'vec3' || fromType === 'vec4')) {
    return `${varName}.x`
  }
  // vec2 ← vec3/vec4: 截断 .xy
  if (toType === 'vec2' && (fromType === 'vec3' || fromType === 'vec4')) {
    return `vec2<f32>(${varName}.xy)`
  }
  // vec3 ← vec2: 扩展 z=0
  if (toType === 'vec3' && fromType === 'vec2') {
    return `vec3<f32>(${varName}, 0.0)`
  }
  // vec4 ← vec2: 扩展 z=0, w=1
  if (toType === 'vec4' && fromType === 'vec2') {
    return `vec4<f32>(${varName}, 0.0, 1.0)`
  }
  // vec2/3/4 ← float: 广播
  if (fromType === 'float') {
    return `${WGSLBuilder.typeDecl(toType)}(${varName})`
  }

  // 不兼容(如 texture → float):返回原变量,由 typeChecker 上游拦截
  return varName
}
