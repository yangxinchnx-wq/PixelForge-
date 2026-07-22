/**
 * Theme Presets(Step 40.1)— 主题预设与切换。
 *
 * 设计:
 * - dark preset 复用 App.vue 现有 :root tokens(零迁移成本)
 * - light preset 为新增(对齐 dark 的 14 个 token)
 * - auto 模式跟随 prefers-color-scheme
 * - 切换机制:document.documentElement.setAttribute('data-theme', 'dark'|'light')
 * - CSS 变量定义在 App.vue <style> 中(:root[data-theme="..."]),
 *   本模块只负责 JS 侧的预设定义 + 切换函数 + 系统偏好监听
 */

// ============================================================================
// 类型
// ============================================================================

export type ThemeMode = 'dark' | 'light' | 'auto'

/** 实际生效的主题(解析 auto 后) */
export type ResolvedTheme = 'dark' | 'light'

export interface ThemeTokens {
  '--pf-paper': string
  '--pf-surface': string
  '--pf-surface-soft': string
  '--pf-surface-sunk': string
  '--pf-line': string
  '--pf-line-strong': string
  '--pf-ink': string
  '--pf-ink-soft': string
  '--pf-ink-muted': string
  '--pf-ink-faint': string
  '--pf-accent': string
  '--pf-accent-soft': string
  '--pf-accent-deep': string
  '--pf-success': string
  '--pf-warning': string
  '--pf-danger': string
  '--pf-r-xs': string
  '--pf-r-sm': string
  '--pf-r-md': string
  '--pf-r-lg': string
  '--pf-r-xl': string
}

// ============================================================================
// 主题预设
// ============================================================================

/** Dark 主题(对齐 App.vue 现有 :root tokens) */
export const DARK_TOKENS: ThemeTokens = {
  '--pf-paper': '#111315',
  '--pf-surface': '#171a1d',
  '--pf-surface-soft': '#1d2125',
  '--pf-surface-sunk': '#101214',
  '--pf-line': 'rgba(255, 255, 255, 0.08)',
  '--pf-line-strong': 'rgba(255, 255, 255, 0.15)',
  '--pf-ink': '#ece8e1',
  '--pf-ink-soft': '#b8b4ac',
  '--pf-ink-muted': '#817f79',
  '--pf-ink-faint': '#5d5c58',
  '--pf-accent': '#ef855d',
  '--pf-accent-soft': 'rgba(239, 133, 93, 0.14)',
  '--pf-accent-deep': '#d96945',
  '--pf-success': '#71c69a',
  '--pf-warning': '#e6b86a',
  '--pf-danger': '#e8797f',
  '--pf-r-xs': '6px',
  '--pf-r-sm': '8px',
  '--pf-r-md': '10px',
  '--pf-r-lg': '12px',
  '--pf-r-xl': '14px',
}

/** Light 主题(新增,色值对齐 dark 的语义角色) */
export const LIGHT_TOKENS: ThemeTokens = {
  '--pf-paper': '#f5f4f1',
  '--pf-surface': '#ffffff',
  '--pf-surface-soft': '#f0efec',
  '--pf-surface-sunk': '#e8e7e3',
  '--pf-line': 'rgba(0, 0, 0, 0.08)',
  '--pf-line-strong': 'rgba(0, 0, 0, 0.15)',
  '--pf-ink': '#1a1c1e',
  '--pf-ink-soft': '#4a4c4f',
  '--pf-ink-muted': '#7a7c7f',
  '--pf-ink-faint': '#a8aaad',
  '--pf-accent': '#d96945',
  '--pf-accent-soft': 'rgba(217, 105, 69, 0.12)',
  '--pf-accent-deep': '#c4552f',
  '--pf-success': '#3da872',
  '--pf-warning': '#c9952f',
  '--pf-danger': '#d65560',
  '--pf-r-xs': '6px',
  '--pf-r-sm': '8px',
  '--pf-r-md': '10px',
  '--pf-r-lg': '12px',
  '--pf-r-xl': '14px',
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
 * 通过 CSS 自定义属性(setProperty)注入,不依赖 :root[data-theme] CSS 规则。
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
