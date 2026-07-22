/**
 * PixelForge - WDL Monarch Tokenizer(Step 38.1)
 *
 * 职责:
 * - 为 Monaco Editor 提供 WDL 语言的 Monarch 词法定义
 * - 将 Step 37.1 的 wdlLexer.ts 规则映射到 Monaco Monarch 语法
 * - 支持关键字 / 标识符 / 数字 / 字符串 / 尺寸 / 标点 / 注释的高亮
 *
 * 与 wdlLexer.ts 的关系:
 * - wdlLexer.ts: 域逻辑层 Lexer,产出 Token[] 供 Parser 使用(精确,含行号列号)
 * - wdlMonarch.ts: 视图层 tokenizer,产出 Monaco token class 供编辑器高亮(轻量,仅用于着色)
 * - 两者规则保持同步,但实现独立
 *
 * Token 着色映射:
 * - 关键字 (scene/layer/effect/region...) → keyword
 * - opcode (SOLID_COLOR/NOISE...)         → type.identifier
 * - blendMode (normal/add/screen...)      → keyword
 * - 布尔 (true/false)                     → keyword
 * - 数字 (42/3.14/-0.5/1e3)               → number
 * - 尺寸 (1920x1080)                      → number.hex(区别于普通数字)
 * - 字符串 ("...")                        → string
 * - 标识符 (myParam)                      → identifier
 * - 标点 ({ } [ ] : ,)                    → delimiter
 * - 注释 (单行 // 和多行块注释)            → comment
 */
import type { languages } from 'monaco-editor'

/** Monaco 语言 ID */
export const WDL_LANGUAGE_ID = 'wdl'

/** WDL 关键字(与 wdlLexer.ts WDL_KEYWORDS 保持同步) */
export const WDL_MONARCH_KEYWORDS = [
  'scene', 'layer', 'effect', 'region',
  'canvas', 'opcode', 'type', 'target',
  'bounds', 'layers', 'blendMode', 'visible',
] as const

/** WDL opcode 值(与 wdlCompiler.ts OPCODE_MAP 保持同步) */
export const WDL_MONARCH_OPCODES = [
  'SOLID_COLOR', 'LINEAR_GRADIENT', 'NOISE', 'BLEND', 'CIRCLE_SHAPE', 'IMAGE_TEXTURE',
] as const

/** WDL blendMode 值(与 wdlCompiler.ts BLEND_MODES 保持同步) */
export const WDL_MONARCH_BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay', 'add', 'subtract',
] as const

/** WDL 布尔值 */
export const WDL_MONARCH_BOOLEANS = ['true', 'false'] as const

/**
 * WDL Monarch 词法定义。
 *
 * 规则顺序很重要 — Monarch 使用第一个匹配的规则。
 * 尺寸字面量(1920x1080)必须在数字(1920)之前,否则数字会先匹配。
 */
export const wdlMonarchDefinition: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.wdl',

  // 关键字列表(Monarch @keywords 引用)
  keywords: [...WDL_MONARCH_KEYWORDS],
  // opcode 值(@opcodes 引用)
  opcodes: [...WDL_MONARCH_OPCODES],
  // blendMode 值(@blendModes 引用)
  blendModes: [...WDL_MONARCH_BLEND_MODES],
  // 布尔值(@booleans 引用)
  booleans: [...WDL_MONARCH_BOOLEANS],

  tokenizer: {
    root: [
      // 单行注释 //
      [/\/\/.*$/, 'comment'],

      // 多行注释 /* ... */
      [/\/\*/, 'comment', '@comment'],

      // 字符串 "..."
      [/"/, 'string', '@string'],

      // 尺寸字面量 1920x1080 / 800X600(必须在数字之前)
      [/\d+[xX]\d+/, 'number.hex'],

      // 数字: 整数 / 浮点 / 负数 / 科学计数法
      [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],

      // 标识符和关键字(通过 cases 区分)
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@opcodes': 'type.identifier',
          '@blendModes': 'keyword',
          '@booleans': 'keyword',
          '@default': 'identifier',
        },
      }],

      // 标点符号
      [/[{}]/, '@brackets'],
      [/[[\]]/, '@brackets'],
      [/:/, 'delimiter'],
      [/,/, 'delimiter'],

      // 空白
      [/\s+/, ''],
    ],

    // 多行注释状态
    comment: [
      [/\*\//, 'comment', '@pop'],
      [/[^/*]+/, 'comment'],
      [/[/*]/, 'comment'],
    ],

    // 字符串状态
    string: [
      [/[^"\\]+/, 'string'],
      [/\\[ntr"\\]/, 'string.escape'],
      [/\\[^ntr"\\]/, 'string.escape.invalid'],
      [/"/, 'string', '@pop'],
    ],
  },
}
