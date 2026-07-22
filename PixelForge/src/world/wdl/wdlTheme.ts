/**
 * PixelForge - WDL Monaco Theme(Step 38.1)
 *
 * 职责:
 * - 定义适配 PixelForge 暗色主题的 Monaco editor 主题
 * - 颜色值与 src/style.css 的 --pf-* 设计令牌保持一致
 *
 * 颜色映射(--pf-* → Monaco theme):
 *   --pf-surface     rgba(18,24,39,0.58) → editor.background
 *   --pf-ink         #f5f5f7             → editor.foreground
 *   --pf-line        rgba(255,255,255,0.11) → editorLineNumber.foreground
 *   --pf-accent      #9b6cff             → editorCursor.foreground
 */
import type { editor } from 'monaco-editor'

/** PixelForge 暗色主题 ID */
export const WDL_THEME_ID = 'pixelforge-dark'

/** PixelForge 暗色主题定义(与 style.css --pf-* 令牌对齐) */
export const wdlThemeDefinition: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    // 关键字(scene/layer/effect/region/canvas...)
    { token: 'keyword', foreground: 'c678dd' },
    // opcode(SOLID_COLOR/NOISE...) — 紫色调,略亮于 keyword
    { token: 'type.identifier', foreground: '9b6cff' },
    // 标识符(参数名)
    { token: 'identifier', foreground: 'e5c07b' },
    // 数字
    { token: 'number', foreground: 'd19a66' },
    // 尺寸字面量(1920x1080)— 橙色略深
    { token: 'number.hex', foreground: 'e06c75' },
    // 字符串
    { token: 'string', foreground: '98c379' },
    // 字符串转义
    { token: 'string.escape', foreground: '56b6c2' },
    // 注释
    { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
    // 标点
    { token: 'delimiter', foreground: 'abb2bf' },
    // 括号
    { token: '@brackets', foreground: 'abb2bf' },
  ],
  colors: {
    // 编辑器背景 — --pf-surface
    'editor.background': '#12182700',
    // 编辑器前景文字 — --pf-ink
    'editor.foreground': '#f5f5f7',
    // 行号 — --pf-ink-faint
    'editorLineNumber.foreground': 'rgba(245,245,247,0.32)',
    'editorLineNumber.activeForeground': 'rgba(245,245,247,0.78)',
    // 光标 — --pf-accent
    'editorCursor.foreground': '#9b6cff',
    // 选中高亮
    'editor.selectionBackground': 'rgba(155,108,255,0.25)',
    'editor.selectionHighlightBackground': 'rgba(155,108,255,0.15)',
    // 当前行高亮
    'editor.lineHighlightBackground': 'rgba(255,255,255,0.03)',
    'editor.lineHighlightBorder': '#00000000',
    // 匹配括号
    'editorBracketMatch.background': 'rgba(155,108,255,0.1)',
    'editorBracketMatch.border': 'rgba(155,108,255,0.4)',
    // 错误/警告下划线
    'editorError.foreground': '#e53935',
    'editorWarning.foreground': '#f9a825',
  },
}
