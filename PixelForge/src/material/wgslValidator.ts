/**
 * WGSL Validator — WGSL 源码语法预校验器。
 *
 * 职责:
 * - 在将 WGSL 交给 device.createShaderModule 之前做静态语法检查
 * - 拦截明显的语法错误（括号不匹配 / 缺分号 / 非法入口点等）
 * - 提供行号 + 列号的详细错误信息，便于调试
 *
 * 校验规则:
 *   V1:  括号匹配（{}、()、[] 必须配对）
 *   V2:  每条语句以 ; 结尾（除控制语句 if/for/while 和块声明 struct/fn）
 *   V3:  @fragment / @vertex 入口点存在
 *   V4:  fn 声明后必须跟标识符 + (
 *   V5:  struct 声明后必须跟标识符 + {
 *   V6:  不允许出现空 fn 体（只有 { }）
 *   V7:  let/var 声明后必须跟标识符
 *   V8:  return 语句存在（fs_main 必须有返回值）
 *   V9:  @binding 必须跟数字
 *   V10: 不允许出现未关闭的字符串字面量
 *
 * 局限性:
 * - 不做完整的 WGSL 语义分析（类型推导 / 作用域等）
 * - 不验证函数调用参数个数 / 类型匹配
 * - 这些深层语义检查由 GPU 驱动的 createShaderModule 完成
 * - 本校验器聚焦于「能在交给 GPU 前拦截的明显错误」
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface WGSLValidationError {
  line: number
  column: number
  rule: string
  message: string
  snippet: string
}

export interface WGSLValidationResult {
  valid: boolean
  errors: WGSLValidationError[]
  warnings: WGSLValidationResultWarning[]
}

export interface WGSLValidationResultWarning {
  line: number
  message: string
}

// ============================================================================
// 校验器
// ============================================================================

/**
 * 校验 WGSL 源码语法。
 *
 * @param wgsl 完整 WGSL 源码
 * @param entryPoint 预期的入口函数名（如 'fs_main'）
 * @returns 校验结果
 */
export function validateWGSL(
  wgsl: string,
  entryPoint: string = 'fs_main',
): WGSLValidationResult {
  const errors: WGSLValidationError[] = []
  const warnings: WGSLValidationResultWarning[] = []

  const lines = wgsl.split('\n')

  // —— V1: 括号匹配 ——
  checkBracketBalance(lines, errors)

  // —— V2: 语句分号检查 ——
  checkSemicolons(lines, errors)

  // —— V3: 入口点存在 ——
  checkEntryPoint(lines, entryPoint, errors)

  // —— V4: fn 声明语法 ——
  checkFunctionDeclarations(lines, errors)

  // —— V5: struct 声明语法 ——
  checkStructDeclarations(lines, errors)

  // —— V7: let/var 声明语法 ——
  checkLetVarDeclarations(lines, errors)

  // —— V8: return 语句存在（在入口函数内） ——
  checkReturnStatement(lines, entryPoint, errors)

  // —— V9: @binding 必须跟数字 ——
  checkBindingAnnotations(lines, errors)

  // —— V10: 未关闭的字符串 ——
  checkUnclosedStrings(lines, errors)

  // —— W1: 空函数体警告 ——
  checkEmptyFunctionBody(lines, warnings)

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ============================================================================
// V1: 括号匹配检查
// ============================================================================

function checkBracketBalance(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  const stack: { char: string; line: number; column: number }[] = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const opens = new Set(['(', '[', '{'])

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 跳过注释行
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//')) continue

    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      // 跳过字符串内的内容
      if (ch === '"' ) {
        // 找到字符串结束
        let end = j + 1
        while (end < line.length && line[end] !== '"') end++
        j = end
        continue
      }
      // 跳过行内注释
      if (ch === '/' && j + 1 < line.length && line[j + 1] === '/') break

      if (opens.has(ch)) {
        stack.push({ char: ch, line: i + 1, column: j + 1 })
      } else if (pairs[ch]) {
        if (stack.length === 0) {
          errors.push({
            line: i + 1,
            column: j + 1,
            rule: 'V1',
            message: `多余的闭合括号 '${ch}'，没有对应的开始括号`,
            snippet: getSnippet(lines, i),
          })
        } else {
          const top = stack[stack.length - 1]
          if (top.char !== pairs[ch]) {
            errors.push({
              line: i + 1,
              column: j + 1,
              rule: 'V1',
              message: `括号不匹配: 期望 '${matchingClose(top.char)}' 但找到 '${ch}'`,
              snippet: getSnippet(lines, i),
            })
          } else {
            stack.pop()
          }
        }
      }
    }
  }

  // 检查未关闭的括号
  for (const item of stack) {
    errors.push({
      line: item.line,
      column: item.column,
      rule: 'V1',
      message: `未关闭的括号 '${item.char}'`,
      snippet: getSnippet(lines, item.line - 1),
    })
  }
}

function matchingClose(open: string): string {
  return open === '(' ? ')' : open === '[' ? ']' : '}'
}

// ============================================================================
// V2: 分号检查
// ============================================================================

function checkSemicolons(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  // 这些关键字开头的行不需要分号结尾
  const noSemicolonKeywords = [
    'if', 'for', 'while', 'else', 'switch', 'case',
    'fn', 'struct', '}', '{', 'var', 'let', 'const',
    '@group', '@binding', '@vertex', '@fragment',
    '@compute', '@workgroup_size', 'return',
  ]
  // 这些行也不需要分号
  const noSemicolonPatterns = [
    /^\s*$/,                    // 空行
    /^\s*\/\//,                 // 注释行
    /^\s*\}/,                   // 闭合大括号行
    /^\s*\{/,                   // 开始大括号行
    /^\s*@\w+/,                 // 注解行
    /^\s*(fn|struct|if|else|for|while|switch|case)\b/,  // 声明/控制流
    /^\s*var\s+\w+\s*:/,        // var 声明（多行，分号在赋值行）
    /^\s*let\s+\w+\s*:/,        // let 声明（多行，分号在赋值行）
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 跳过空行和注释
    if (trimmed === '' || trimmed.startsWith('//')) continue

    // 跳过不需要分号的行
    let skip = false
    for (const pattern of noSemicolonPatterns) {
      if (pattern.test(trimmed)) {
        skip = true
        break
      }
    }
    if (skip) continue

    // 如果行以 { 结尾（如 fn 声明后的 {），不需要分号
    if (trimmed.endsWith('{')) continue

    // 如果行以 , 结尾（多行参数列表），不需要分号
    if (trimmed.endsWith(',')) continue

    // 如果行以 && 或 || 结尾（多行布尔表达式），不需要分号
    if (trimmed.endsWith('&&') || trimmed.endsWith('||')) continue

    // 如果行以 ( 结尾（多行调用），不需要分号
    if (trimmed.endsWith('(')) continue

    // 如果行包含完整控制语句（如 if (...) {）
    if (/\b(if|for|while|switch)\b.*\{/.test(trimmed)) continue

    // 如果是 return 语句，必须有分号
    if (trimmed.startsWith('return')) {
      if (!trimmed.endsWith(';')) {
        errors.push({
          line: i + 1,
          column: trimmed.length,
          rule: 'V2',
          message: 'return 语句缺少分号 ;',
          snippet: getSnippet(lines, i),
        })
      }
      continue
    }

    // 赋值语句（let/var/const 或普通赋值）必须有分号
    if (/^\s*(let|var|const)\s+\w+/.test(trimmed) || /^\s*\w+\s*=/.test(trimmed)) {
      if (!trimmed.endsWith(';')) {
        errors.push({
          line: i + 1,
          column: trimmed.length,
          rule: 'V2',
          message: '语句缺少结尾分号 ;',
          snippet: getSnippet(lines, i),
        })
      }
      continue
    }

    // 其他以标识符/关键字开头的语句行
    // 如果行看起来是一个独立语句（不是注释、不是声明的一部分）
    if (/^\s*\w+.*[^;{}()\[\],\s]$/.test(line) && !trimmed.startsWith('//')) {
      // 排除 fn 声明（fn name() -> type {）
      if (/^\s*fn\s+/.test(trimmed) && trimmed.endsWith('{')) continue
      // 排除 struct 声明
      if (/^\s*struct\s+/.test(trimmed)) continue
      // 排除 @注解
      if (trimmed.startsWith('@')) continue

      errors.push({
        line: i + 1,
        column: trimmed.length,
        rule: 'V2',
        message: '语句可能缺少结尾分号 ;',
        snippet: getSnippet(lines, i),
      })
    }
  }
}

// ============================================================================
// V3: 入口点存在检查
// ============================================================================

function checkEntryPoint(
  lines: string[],
  entryPoint: string,
  errors: WGSLValidationError[],
): void {
  const pattern = new RegExp(`\\bfn\\s+${entryPoint}\\s*\\(`)
  let found = false

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      found = true
      break
    }
  }

  if (!found) {
    errors.push({
      line: 0,
      column: 0,
      rule: 'V3',
      message: `未找到入口函数 '${entryPoint}'`,
      snippet: '',
    })
  }
}

// ============================================================================
// V4: fn 声明语法检查
// ============================================================================

function checkFunctionDeclarations(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()

    // 匹配 fn 关键字后跟标识符
    const fnMatch = trimmed.match(/^fn\s+(\w+)/)
    if (!fnMatch) continue

    // 检查 fn 后面是否有 (
    const afterName = trimmed.slice(fnMatch[0].length).trimStart()
    if (!afterName.startsWith('(')) {
      errors.push({
        line: i + 1,
        column: fnMatch[0].length + 1,
        rule: 'V4',
        message: `函数 '${fnMatch[1]}' 声明后缺少 '('`,
        snippet: getSnippet(lines, i),
      })
    }
  }
}

// ============================================================================
// V5: struct 声明语法检查
// ============================================================================

function checkStructDeclarations(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()

    const structMatch = trimmed.match(/^struct\s+(\w+)/)
    if (!structMatch) continue

    const afterName = trimmed.slice(structMatch[0].length).trimStart()
    if (!afterName.startsWith('{')) {
      // struct 可能跨行，检查下一行
      if (i + 1 < lines.length) {
        const nextTrimmed = lines[i + 1].trimStart()
        if (!nextTrimmed.startsWith('{')) {
          errors.push({
            line: i + 1,
            column: structMatch[0].length + 1,
            rule: 'V5',
            message: `struct '${structMatch[1]}' 声明后缺少 '{'`,
            snippet: getSnippet(lines, i),
          })
        }
      } else {
        errors.push({
          line: i + 1,
          column: structMatch[0].length + 1,
          rule: 'V5',
          message: `struct '${structMatch[1]}' 声明后缺少 '{'`,
          snippet: getSnippet(lines, i),
        })
      }
    }
  }
}

// ============================================================================
// V7: let/var 声明语法检查
// ============================================================================

function checkLetVarDeclarations(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()

    // 匹配 let/var/const 关键字后跟标识符
    const declMatch = trimmed.match(/^(let|var|const)\s+(\w+)/)
    if (!declMatch) continue

    // 检查标识符后面是否有 : 或 = 或 ;
    const afterName = trimmed.slice(declMatch[0].length).trimStart()
    if (!afterName.startsWith(':') && !afterName.startsWith('=') && !afterName.startsWith(';')) {
      errors.push({
        line: i + 1,
        column: declMatch[0].length + 1,
        rule: 'V7',
        message: `${declMatch[1]} 声明 '${declMatch[2]}' 后缺少 ':' 或 '='`,
        snippet: getSnippet(lines, i),
      })
    }
  }
}

// ============================================================================
// V8: return 语句检查
// ============================================================================

function checkReturnStatement(
  lines: string[],
  entryPoint: string,
  errors: WGSLValidationError[],
): void {
  // 找到入口函数的起始行
  const pattern = new RegExp(`\\bfn\\s+${entryPoint}\\s*\\(`)
  let fnStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      fnStart = i
      break
    }
  }

  if (fnStart === -1) return  // V3 已报告

  // 从入口函数开始，找到匹配的 }
  let depth = 0
  let fnEnd = -1
  let hasReturn = false

  for (let i = fnStart; i < lines.length; i++) {
    const line = lines[i]
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '{') depth++
      else if (line[j] === '}') {
        depth--
        if (depth === 0) {
          fnEnd = i
          break
        }
      }
    }
    if (line.includes('return')) hasReturn = true
    if (fnEnd !== -1) break
  }

  if (fnEnd !== -1 && !hasReturn) {
    errors.push({
      line: fnStart + 1,
      column: 0,
      rule: 'V8',
      message: `入口函数 '${entryPoint}' 缺少 return 语句`,
      snippet: getSnippet(lines, fnStart),
    })
  }
}

// ============================================================================
// V9: @binding 注解检查
// ============================================================================

function checkBindingAnnotations(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart()

    // 匹配 @binding(
    const bindingMatch = trimmed.match(/@binding\s*\(\s*(\d+)\s*\)/)
    if (trimmed.includes('@binding')) {
      if (!bindingMatch) {
        errors.push({
          line: i + 1,
          column: 1,
          rule: 'V9',
          message: '@binding 注解必须跟一个数字，如 @binding(0)',
          snippet: getSnippet(lines, i),
        })
      }
    }

    // 匹配 @group(
    if (trimmed.includes('@group')) {
      const groupMatch = trimmed.match(/@group\s*\(\s*(\d+)\s*\)/)
      if (!groupMatch) {
        errors.push({
          line: i + 1,
          column: 1,
          rule: 'V9',
          message: '@group 注解必须跟一个数字，如 @group(0)',
          snippet: getSnippet(lines, i),
        })
      }
    }
  }
}

// ============================================================================
// V10: 未关闭字符串检查
// ============================================================================

function checkUnclosedStrings(
  lines: string[],
  errors: WGSLValidationError[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 跳过注释行
    if (line.trimStart().startsWith('//')) continue

    let inString = false
    for (let j = 0; j < line.length; j++) {
      const ch = line[j]
      if (ch === '"' ) {
        inString = !inString
      }
      // 跳过行内注释
      if (!inString && ch === '/' && j + 1 < line.length && line[j + 1] === '/') break
    }

    if (inString) {
      errors.push({
        line: i + 1,
        column: line.length,
        rule: 'V10',
        message: '未关闭的字符串字面量 "',
        snippet: getSnippet(lines, i),
      })
    }
  }
}

// ============================================================================
// W1: 空函数体警告
// ============================================================================

function checkEmptyFunctionBody(
  lines: string[],
  warnings: WGSLValidationResultWarning[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    // 检查 fn name(...) ... { 后下一行是否直接是 }
    if (trimmed.endsWith('{') && /\bfn\s+/.test(trimmed)) {
      // 向后查找第一个非空非注释行
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim()
        if (nextTrimmed === '' || nextTrimmed.startsWith('//')) continue
        if (nextTrimmed === '}') {
          warnings.push({
            line: i + 1,
            message: '函数体为空',
          })
        }
        break
      }
    }
  }
}

// ============================================================================
// 工具函数
// ============================================================================

function getSnippet(lines: string[], lineIndex: number): string {
  if (lineIndex < 0 || lineIndex >= lines.length) return ''
  const line = lines[lineIndex]
  return line.length > 80 ? line.slice(0, 77) + '...' : line
}
