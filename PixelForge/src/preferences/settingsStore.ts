/**
 * Settings Store(Step 40.1)— 用户偏好设置。
 *
 * 职责:
 * - 管理用户级偏好(主题/语言/自动保存间隔/画布默认尺寸/性能监控开关)
 * - localStorage 持久化(键名 'pixelforge:settings')
 * - 主题切换联动 theme.ts(applyTheme + watchSystemTheme)
 *
 * 与现有 Store 的关系:
 * - 项目级配置(canvasSize/fps/totalFrames)仍在 projectStore / timelineStore
 * - 用户级偏好(主题/语言/autosaveInterval)在 settingsStore
 * - 不与 projectStore 冲突(settings 是跨项目的用户偏好)
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  type ThemeMode,
  type ResolvedTheme,
  THEME_MODES,
  applyTheme,
  resolveTheme,
  watchSystemTheme,
} from './theme'

// ============================================================================
// 类型
// ============================================================================

export interface SettingsState {
  /** 主题模式 */
  theme: ThemeMode
  /** 语言(预留,当前仅 'zh-CN') */
  language: string
  /** 自动保存间隔(ms) */
  autosaveIntervalMs: number
  /** 默认画布宽度 */
  defaultCanvasWidth: number
  /** 默认画布高度 */
  defaultCanvasHeight: number
  /** 性能监控开关(Profiler 悬浮窗) */
  showPerformanceMonitor: boolean
  /** 启动时自动恢复上次项目 */
  restoreOnStartup: boolean
}

// ============================================================================
// 常量
// ============================================================================

const STORAGE_KEY = 'pixelforge:settings'
const DEFAULT_SETTINGS: SettingsState = {
  theme: 'dark',
  language: 'zh-CN',
  autosaveIntervalMs: 10_000,
  defaultCanvasWidth: 1920,
  defaultCanvasHeight: 1080,
  showPerformanceMonitor: false,
  restoreOnStartup: true,
}

const AUTOSAVE_INTERVAL_MIN = 1_000
const AUTOSAVE_INTERVAL_MAX = 300_000

// ============================================================================
// localStorage 工具(SSR 安全)
// ============================================================================

function loadSettings(): SettingsState {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<SettingsState>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(state: SettingsState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 静默忽略(localStorage 满或禁用)
  }
}

// ============================================================================
// Store 定义
// ============================================================================

export const useSettingsStore = defineStore('settings', () => {
  // --------------------------------------------------------------------------
  // State
  // --------------------------------------------------------------------------

  const persisted = loadSettings()
  const theme = ref<ThemeMode>(persisted.theme)
  const language = ref<string>(persisted.language)
  const autosaveIntervalMs = ref<number>(persisted.autosaveIntervalMs)
  const defaultCanvasWidth = ref<number>(persisted.defaultCanvasWidth)
  const defaultCanvasHeight = ref<number>(persisted.defaultCanvasHeight)
  const showPerformanceMonitor = ref<boolean>(persisted.showPerformanceMonitor)
  const restoreOnStartup = ref<boolean>(persisted.restoreOnStartup)

  /** 解析后的实际主题(auto → 系统) */
  const resolvedTheme = ref<ResolvedTheme>(resolveTheme(theme.value))

  // --------------------------------------------------------------------------
  // 系统主题监听(auto 模式下自动跟随)
  // --------------------------------------------------------------------------

  let unwatchSystem: (() => void) | null = null

  function startSystemThemeWatch(): void {
    if (unwatchSystem) return
    unwatchSystem = watchSystemTheme((sysTheme) => {
      if (theme.value === 'auto') {
        resolvedTheme.value = sysTheme
        applyTheme('auto')
      }
    })
  }

  function stopSystemThemeWatch(): void {
    if (unwatchSystem) {
      unwatchSystem()
      unwatchSystem = null
    }
  }

  // --------------------------------------------------------------------------
  // Actions
  // --------------------------------------------------------------------------

  /**
   * 设置主题模式并立即应用。
   */
  function setTheme(mode: ThemeMode): void {
    if (!THEME_MODES.includes(mode)) return
    theme.value = mode
    resolvedTheme.value = applyTheme(mode)
    if (mode === 'auto') {
      startSystemThemeWatch()
    } else {
      stopSystemThemeWatch()
    }
  }

  /**
   * 切换 dark/light(auto 解析后切换)。
   */
  function toggleTheme(): void {
    const current = resolvedTheme.value
    setTheme(current === 'dark' ? 'light' : 'dark')
  }

  /**
   * 设置自动保存间隔(限制在 1s ~ 5min)。
   */
  function setAutosaveInterval(ms: number): void {
    const clamped = Math.max(AUTOSAVE_INTERVAL_MIN, Math.min(AUTOSAVE_INTERVAL_MAX, Math.round(ms)))
    autosaveIntervalMs.value = clamped
  }

  /**
   * 设置默认画布尺寸。
   */
  function setDefaultCanvasSize(width: number, height: number): void {
    if (width > 0 && height > 0) {
      defaultCanvasWidth.value = Math.round(width)
      defaultCanvasHeight.value = Math.round(height)
    }
  }

  /**
   * 设置语言。
   */
  function setLanguage(lang: string): void {
    if (lang) language.value = lang
  }

  /**
   * 设置性能监控开关。
   */
  function setShowPerformanceMonitor(show: boolean): void {
    showPerformanceMonitor.value = show
  }

  /**
   * 设置启动恢复开关。
   */
  function setRestoreOnStartup(restore: boolean): void {
    restoreOnStartup.value = restore
  }

  /**
   * 重置为默认设置。
   */
  function resetToDefaults(): void {
    theme.value = DEFAULT_SETTINGS.theme
    language.value = DEFAULT_SETTINGS.language
    autosaveIntervalMs.value = DEFAULT_SETTINGS.autosaveIntervalMs
    defaultCanvasWidth.value = DEFAULT_SETTINGS.defaultCanvasWidth
    defaultCanvasHeight.value = DEFAULT_SETTINGS.defaultCanvasHeight
    showPerformanceMonitor.value = DEFAULT_SETTINGS.showPerformanceMonitor
    restoreOnStartup.value = DEFAULT_SETTINGS.restoreOnStartup
    resolvedTheme.value = applyTheme(theme.value)
  }

  /**
   * 初始化(应用主题 + 启动系统监听 if auto)。
   * 应在 App.vue setup 中调用。
   */
  function init(): void {
    resolvedTheme.value = applyTheme(theme.value)
    if (theme.value === 'auto') {
      startSystemThemeWatch()
    }
  }

  /**
   * 销毁(停止系统监听)。
   */
  function dispose(): void {
    stopSystemThemeWatch()
  }

  // --------------------------------------------------------------------------
  // 持久化(深度 watch 自动保存)
  // --------------------------------------------------------------------------

  watch(
    [theme, language, autosaveIntervalMs, defaultCanvasWidth, defaultCanvasHeight,
     showPerformanceMonitor, restoreOnStartup],
    () => {
      saveSettings({
        theme: theme.value,
        language: language.value,
        autosaveIntervalMs: autosaveIntervalMs.value,
        defaultCanvasWidth: defaultCanvasWidth.value,
        defaultCanvasHeight: defaultCanvasHeight.value,
        showPerformanceMonitor: showPerformanceMonitor.value,
        restoreOnStartup: restoreOnStartup.value,
      })
    },
    { flush: 'sync' },
  )

  // --------------------------------------------------------------------------
  // Getters
  // --------------------------------------------------------------------------

  const isDark = computed(() => resolvedTheme.value === 'dark')
  const isAutoTheme = computed(() => theme.value === 'auto')
  const autosaveIntervalSeconds = computed(() => autosaveIntervalMs.value / 1000)

  return {
    // State
    theme,
    language,
    autosaveIntervalMs,
    defaultCanvasWidth,
    defaultCanvasHeight,
    showPerformanceMonitor,
    restoreOnStartup,
    resolvedTheme,
    // Getters
    isDark,
    isAutoTheme,
    autosaveIntervalSeconds,
    // Actions
    setTheme,
    toggleTheme,
    setAutosaveInterval,
    setDefaultCanvasSize,
    setLanguage,
    setShowPerformanceMonitor,
    setRestoreOnStartup,
    resetToDefaults,
    init,
    dispose,
  }
})
