/**
 * PixelForge - WDL Language Configuration(Step 38.1)
 *
 * 职责:
 * - 为 Monaco Editor 提供 WDL 语言的编辑行为配置
 * - 定义括号匹配 / 自动闭合 / 注释切换 / 缩进规则
 *
 * 与 Monaco 的集成:
 *   monaco.languages.setLanguageConfiguration('wdl', wdlLanguageConfiguration)
 */
import type { languages } from 'monaco-editor'

/** WDL 语言配置(括号 / 自动闭合 / 注释) */
export const wdlLanguageConfiguration: languages.LanguageConfiguration = {
  // 括号配对(用于高亮匹配 + 括号对导航)
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['"', '"'],
  ],

  // 自动闭合对(输入左括号时自动补右括号)
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],

  // 包围操作(选中文本后输入括号时用括号包围)
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],

  // 注释切换(Ctrl+/ )
  comments: {
    lineComment: '//',
    blockComment: ['/*', '*/'],
  },

  // 自动缩进规则
  indentationRules: {
    // { 后增加缩进
    increaseIndentPattern: /[{[]\s*$/,
    // } 前减少缩进
    decreaseIndentPattern: /^\s*[}\]]/,
  },

  // 代码折叠
  folding: {
    markers: {
      start: /^\s*\/\*\s*#region\b/,
      end: /^\s*\/\*\s*#endregion\b/,
    },
  },
}
