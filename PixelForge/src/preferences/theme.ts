/**
 * Theme Presets(Step 40.1)— 主题预设与切换。
 *
 * 设计:
 * - dark/light preset 使用 index.css 的 --glass- / --text- / --accent 令牌
 * - auto 模式跟随 prefers-color-scheme
 * - 切换机制:document.documentElement.setAttribute('data-theme', 'dark'|'light')
 * - CSS 变量定义在 index.css 中(:root / [data-theme="dark"]),
 *   本模块只负责 JS 侧的预设定义 + 切换函数 + 系统偏好监听
 */

// ============================================================================
// 类型
// ============================================================================

export type ThemeMode = 'dark' | 'light' | 'auto'

/** 实际生效的主题(解析 auto 后) */
export type ResolvedTheme = 'dark' | 'light'

/**
 * 主题令牌 — 与 index.css 中的 CSS 变量名对齐。
 * 通过 setProperty 注入时覆盖 CSS 默认值。
 */
export interface ThemeTokens {
  '--base-bg': string
  '--glass-bg': string
  '--glass-bg-hover': string
  '--glass-bg-pressed': string
  '--glass-border': string
  '--glass-edge': string
  '--track-bg': string
  '--track-bg-hover': string
  '--separator': string
  '--separator-strong': string
  '--accent': string
  '--accent-hover': string
  '--accent-pressed': string
  '--accent-text': string
  '--text-primary': string
  '--text-secondary': string
  '--text-tertiary': string
  '--text-quaternary': string
  '--canvas-bg': string
  '--playhead': string
  '--toggle-mute': string
  '--toggle-solo': string
  '--toggle-lock': string
}

// ============================================================================
// 主题预设
// ============================================================================

/** Dark 主题(对齐 index.css [data-theme="dark"] 的值) */
export const DARK_TOKENS: ThemeTokens = {
  '--base-bg': '#1c1c1e',
  '--glass-bg': 'rgba(40, 40, 48, 0.6)',
  '--glass-bg-hover': 'rgba(55, 55, 65, 0.7)',
  '--glass-bg-pressed': 'rgba(30, 30, 38, 0.5)',
  '--glass-border': 'rgba(255, 255, 255, 0.08)',
  '--glass-edge': 'rgba(255, 255, 255, 0.12)',
  '--track-bg': 'rgba(255, 255, 255, 0.02)',
  '--track-bg-hover': 'rgba(255, 255, 255, 0.04)',
  '--separator': 'rgba(255, 255, 255, 0.06)',
  '--separator-strong': 'rgba(255, 255, 255, 0.1)',
  '--accent': '#0a84ff',
  '--accent-hover': '#3a9fff',
  '--accent-pressed': '#0060df',
  '--accent-text': 'rgba(255, 255, 255, 0.95)',
  '--text-primary': 'rgba(255, 255, 255, 0.92)',
  '--text-secondary': 'rgba(255, 255, 255, 0.6)',
  '--text-tertiary': 'rgba(255, 255, 255, 0.38)',
  '--text-quaternary': 'rgba(255, 255, 255, 0.12)',
  '--canvas-bg': '#0a0a0c',
  '--playhead': '#ff453a',
  '--toggle-mute': '#ff453a',
  '--toggle-solo': '#ff9f0a',
  '--toggle-lock': '#30d158',
}

/** Light 主题(对齐 index.css :root / [data-theme="light"] 的值) */
export const LIGHT_TOKENS: ThemeTokens = {
  '--base-bg': '#e8e8ed',
  '--glass-bg': 'rgba(255, 255, 255, 0.8)',
  '--glass-bg-hover': 'rgba(255, 255, 255, 0.9)',
  '--glass-bg-pressed': 'rgba(255, 255, 255, 0.7)',
  '--glass-border': 'rgba(0, 0, 0, 0.12)',
  '--glass-edge': 'rgba(0, 0, 0, 0.08)',
  '--track-bg': 'rgba(0, 0, 0, 0.04)',
  '--track-bg-hover': 'rgba(0, 0, 0, 0.06)',
  '--separator': 'rgba(0, 0, 0, 0.1)',
  '--separator-strong': 'rgba(0, 0, 0, 0.16)',
  '--accent': '#0a84ff',
  '--accent-hover': '#3a9fff',
  '--accent-pressed': '#0060df',
  '--accent-text': 'rgba(255, 255, 255, 0.95)',
  '--text-primary': 'rgba(0, 0, 0, 0.92)',
  '--text-secondary': 'rgba(0, 0, 0, 0.62)',
  '--text-tertiary': 'rgba(0, 0, 0, 0.4)',
  '--text-quaternary': 'rgba(0, 0, 0, 0.15)',
  '--canvas-bg': '#f0f0f5',
  '--playhead': '#ff3b30',
  '--toggle-mute': '#ff3b30',
  '--toggle-solo': '#ff9500',
  '--toggle-lock': '#24a045',
}

/** 所有可用主题模式 */
export const THEME_MODES: ThemeMode[] = ['dark', 'light', 'auto']

// ============================================================================
// 主题解析与切换
// ============================================================================

/**
 * 检测系统颜色偏好(SSR 安全)。
 */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 将 ThemeMode 解析为 ResolvedTheme(auto → 系统)。
 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'auto' ? getSystemTheme() : mode
}

/**
 * 获取指定主题的 tokens。
 */
export function getThemeTokens(theme: ResolvedTheme): ThemeTokens {
  return theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS
}

/**
 * 将 tokens 应用到 document.documentElement(SSR 安全)。
 * 通过 CSS 自定义属性(setProperty)注入,与 index.css 的变量名对齐。
 */
export function applyThemeTokens(tokens: ThemeTokens): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value)
  }
}

/**
 * 应用主题模式(解析 auto + 应用 tokens + 设置 data-theme 属性)。
 */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode)
  applyThemeTokens(getThemeTokens(resolved))
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved)
  }
  return resolved
}

// ============================================================================
// 系统主题变化监听
// ============================================================================

/**
 * 监听系统主题变化(auto 模式下自动跟随)。
 *
 * @param callback 系统主题变化时的回调(传入新的 ResolvedTheme)
 * @returns 取消监听函数
 */
export function watchSystemTheme(callback: (theme: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {}
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = (e: MediaQueryListEvent) => {
    callback(e.matches ? 'dark' : 'light')
  }
  mql.addEventListener('change', handler)
  return () => mql.removeEventListener('change', handler)
}
