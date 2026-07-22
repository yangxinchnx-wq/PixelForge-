/**
 * Settings Store + Theme Tests(Step 40.1)
 *
 * 测试策略:
 * - theme.ts:预设完整性 / resolveTheme / applyThemeTokens / watchSystemTheme
 * - settingsStore:状态管理 / 主题切换 / 持久化 / 边界
 *
 * 环境:Node(无 DOM),通过 mock document/localStorage/matchMedia 实现
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  DARK_TOKENS,
  LIGHT_TOKENS,
  THEME_MODES,
  getSystemTheme,
  resolveTheme,
  getThemeTokens,
  applyThemeTokens,
  applyTheme,
  watchSystemTheme,
} from './theme'

// ============================================================================
// Mock DOM
// ============================================================================

class MockStyle {
  private props = new Map<string, string>()
  setProperty(key: string, value: string) { this.props.set(key, value) }
  getPropertyValue(key: string) { return this.props.get(key) ?? '' }
  get cssText() { return Array.from(this.props.entries()).map(([k, v]) => `${k}: ${v}`).join('; ') }
  set cssText(_v: string) { this.props.clear() }
}

class MockElement {
  style = new MockStyle()
  private attrs = new Map<string, string>()
  setAttribute(key: string, value: string) { this.attrs.set(key, value) }
  getAttribute(key: string) { return this.attrs.get(key) ?? null }
  removeAttribute(key: string) { this.attrs.delete(key) }
}

function createMockDocument() {
  const el = new MockElement()
  return { documentElement: el } as unknown as Document
}

function createMockLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    get length() { return store.size },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  } as unknown as Storage
}

function setSystemTheme(dark: boolean): void {
  // matchMedia('(prefers-color-scheme: dark)').matches = dark
  // 即:dark=true 时 matches=true,dark=false 时 matches=false
  const mql = {
    matches: dark, // 直接针对 (prefers-color-scheme: dark) 查询
    media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }
  const matchMediaFn = (query: string) => ({
    ...mql,
    media: query,
    matches: query.includes('dark') ? dark : !dark,
  })
  // getSystemTheme 使用 window.matchMedia,需 stub window
  const mockWindow = { matchMedia: matchMediaFn }
  vi.stubGlobal('matchMedia', matchMediaFn)
  vi.stubGlobal('window', mockWindow)
}

// ============================================================================
// 1. 主题预设(纯数据,无 DOM 依赖)
// ============================================================================

describe('theme / presets', () => {
  it('P01: DARK_TOKENS 包含全部 21 个 token', () => {
    const keys = Object.keys(DARK_TOKENS)
    expect(keys).toHaveLength(21)
    expect(keys).toContain('--pf-paper')
    expect(keys).toContain('--pf-ink')
    expect(keys).toContain('--pf-accent')
    expect(keys).toContain('--pf-r-xl')
  })

  it('P02: LIGHT_TOKENS 包含全部 21 个 token', () => {
    const keys = Object.keys(LIGHT_TOKENS)
    expect(keys).toHaveLength(21)
    expect(keys).toContain('--pf-paper')
    expect(keys).toContain('--pf-ink')
  })

  it('P03: dark 和 light 的 token key 完全一致', () => {
    const darkKeys = Object.keys(DARK_TOKENS).sort()
    const lightKeys = Object.keys(LIGHT_TOKENS).sort()
    expect(darkKeys).toEqual(lightKeys)
  })

  it('P04: dark 和 light 的 paper 色值不同', () => {
    expect(DARK_TOKENS['--pf-paper']).not.toBe(LIGHT_TOKENS['--pf-paper'])
  })

  it('P05: dark paper 是深色,light paper 是浅色', () => {
    expect(DARK_TOKENS['--pf-paper']).toMatch(/^#1/)
    expect(LIGHT_TOKENS['--pf-paper']).toMatch(/^#f/)
  })

  it('P06: THEME_MODES 包含 dark/light/auto', () => {
    expect(THEME_MODES).toEqual(['dark', 'light', 'auto'])
  })

  it('P07: 圆角 token 在 dark 和 light 中一致', () => {
    expect(DARK_TOKENS['--pf-r-xs']).toBe(LIGHT_TOKENS['--pf-r-xs'])
    expect(DARK_TOKENS['--pf-r-xl']).toBe(LIGHT_TOKENS['--pf-r-xl'])
  })

  it('P08: accent 色值不同(dark 用亮橙,light 用深橙)', () => {
    expect(DARK_TOKENS['--pf-accent']).not.toBe(LIGHT_TOKENS['--pf-accent'])
  })
})

// ============================================================================
// 2. getSystemTheme / resolveTheme(依赖 matchMedia mock)
// ============================================================================

describe('theme / resolve', () => {
  beforeEach(() => {
    setSystemTheme(true)
  })

  it('R01: getSystemTheme 返回 dark(系统 dark)', () => {
    setSystemTheme(true)
    expect(getSystemTheme()).toBe('dark')
  })

  it('R02: getSystemTheme 返回 light(系统 light)', () => {
    setSystemTheme(false)
    expect(getSystemTheme()).toBe('light')
  })

  it('R03: resolveTheme(dark) = dark', () => {
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('R04: resolveTheme(light) = light', () => {
    expect(resolveTheme('light')).toBe('light')
  })

  it('R05: resolveTheme(auto) 跟随系统(dark)', () => {
    setSystemTheme(true)
    expect(resolveTheme('auto')).toBe('dark')
  })

  it('R06: resolveTheme(auto) 跟随系统(light)', () => {
    setSystemTheme(false)
    expect(resolveTheme('auto')).toBe('light')
  })

  it('R07: getSystemTheme 无 matchMedia 时返回 dark', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(getSystemTheme()).toBe('dark')
  })
})

// ============================================================================
// 3. getThemeTokens
// ============================================================================

describe('theme / getThemeTokens', () => {
  it('GT01: dark → DARK_TOKENS', () => {
    expect(getThemeTokens('dark')).toBe(DARK_TOKENS)
  })

  it('GT02: light → LIGHT_TOKENS', () => {
    expect(getThemeTokens('light')).toBe(LIGHT_TOKENS)
  })
})

// ============================================================================
// 4. applyThemeTokens(依赖 document mock)
// ============================================================================

describe('theme / applyThemeTokens', () => {
  let mockDoc: Document

  beforeEach(() => {
    mockDoc = createMockDocument()
    vi.stubGlobal('document', mockDoc)
  })

  it('AT01: 应用 dark tokens 到 documentElement', () => {
    applyThemeTokens(DARK_TOKENS)
    const root = mockDoc.documentElement
    expect(root.style.getPropertyValue('--pf-paper')).toBe(DARK_TOKENS['--pf-paper'])
    expect(root.style.getPropertyValue('--pf-ink')).toBe(DARK_TOKENS['--pf-ink'])
  })

  it('AT02: 应用 light tokens 覆盖 dark', () => {
    applyThemeTokens(DARK_TOKENS)
    applyThemeTokens(LIGHT_TOKENS)
    const root = mockDoc.documentElement
    expect(root.style.getPropertyValue('--pf-paper')).toBe(LIGHT_TOKENS['--pf-paper'])
    expect(root.style.getPropertyValue('--pf-ink')).toBe(LIGHT_TOKENS['--pf-ink'])
  })

  it('AT03: 应用所有 21 个 token', () => {
    applyThemeTokens(DARK_TOKENS)
    const root = mockDoc.documentElement
    for (const [key, value] of Object.entries(DARK_TOKENS)) {
      expect(root.style.getPropertyValue(key)).toBe(value)
    }
  })
})

// ============================================================================
// 5. applyTheme
// ============================================================================

describe('theme / applyTheme', () => {
  let mockDoc: Document

  beforeEach(() => {
    setSystemTheme(true)
    mockDoc = createMockDocument()
    vi.stubGlobal('document', mockDoc)
  })

  it('AP01: applyTheme(dark) 返回 dark 并设置 data-theme', () => {
    const result = applyTheme('dark')
    expect(result).toBe('dark')
    expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('AP02: applyTheme(light) 返回 light 并设置 data-theme', () => {
    const result = applyTheme('light')
    expect(result).toBe('light')
    expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('AP03: applyTheme(auto) 在系统 dark 时返回 dark', () => {
    setSystemTheme(true)
    const result = applyTheme('auto')
    expect(result).toBe('dark')
  })

  it('AP04: applyTheme(auto) 在系统 light 时返回 light', () => {
    setSystemTheme(false)
    const result = applyTheme('auto')
    expect(result).toBe('light')
  })

  it('AP05: applyTheme 后 CSS 变量已应用', () => {
    applyTheme('light')
    const root = mockDoc.documentElement
    expect(root.style.getPropertyValue('--pf-paper')).toBe(LIGHT_TOKENS['--pf-paper'])
  })
})

// ============================================================================
// 6. watchSystemTheme
// ============================================================================

describe('theme / watchSystemTheme', () => {
  it('W01: 返回取消监听函数', () => {
    setSystemTheme(true)
    const handler = vi.fn()
    const unwatch = watchSystemTheme(handler)
    expect(typeof unwatch).toBe('function')
    unwatch()
  })

  it('W02: 无 matchMedia 时返回 no-op 函数', () => {
    vi.stubGlobal('matchMedia', undefined)
    const handler = vi.fn()
    const unwatch = watchSystemTheme(handler)
    expect(typeof unwatch).toBe('function')
    unwatch()
  })
})

// ============================================================================
// 7. SettingsStore(依赖 document + localStorage mock)
// ============================================================================

import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore } from './settingsStore'
import { LIGHT_TOKENS as LT } from './theme'

describe('settingsStore', () => {
  let mockDoc: Document
  let mockStorage: Storage

  beforeEach(() => {
    setActivePinia(createPinia())
    mockStorage = createMockLocalStorage()
    mockDoc = createMockDocument()
    vi.stubGlobal('document', mockDoc)
    vi.stubGlobal('localStorage', mockStorage)
    setSystemTheme(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  // --------------------------------------------------------------------------
  // 7.1 初始状态
  // --------------------------------------------------------------------------

  it('I01: 默认主题为 dark', () => {
    const s = useSettingsStore()
    expect(s.theme).toBe('dark')
  })

  it('I02: 默认语言为 zh-CN', () => {
    const s = useSettingsStore()
    expect(s.language).toBe('zh-CN')
  })

  it('I03: 默认自动保存间隔 10000ms', () => {
    const s = useSettingsStore()
    expect(s.autosaveIntervalMs).toBe(10_000)
  })

  it('I04: 默认画布 1920x1080', () => {
    const s = useSettingsStore()
    expect(s.defaultCanvasWidth).toBe(1920)
    expect(s.defaultCanvasHeight).toBe(1080)
  })

  it('I05: 默认 showPerformanceMonitor = false', () => {
    const s = useSettingsStore()
    expect(s.showPerformanceMonitor).toBe(false)
  })

  it('I06: 默认 restoreOnStartup = true', () => {
    const s = useSettingsStore()
    expect(s.restoreOnStartup).toBe(true)
  })

  it('I07: resolvedTheme 初始为 dark(系统 dark)', () => {
    setSystemTheme(true)
    const s = useSettingsStore()
    expect(s.resolvedTheme).toBe('dark')
  })

  // --------------------------------------------------------------------------
  // 7.2 主题切换
  // --------------------------------------------------------------------------

  it('T01: setTheme(light) 切换到 light', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    expect(s.theme).toBe('light')
    expect(s.resolvedTheme).toBe('light')
    expect(s.isDark).toBe(false)
  })

  it('T02: setTheme(dark) 切换到 dark', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    s.setTheme('dark')
    expect(s.theme).toBe('dark')
    expect(s.resolvedTheme).toBe('dark')
    expect(s.isDark).toBe(true)
  })

  it('T03: setTheme(auto) 在系统 dark 时解析为 dark', () => {
    setSystemTheme(true)
    const s = useSettingsStore()
    s.setTheme('auto')
    expect(s.theme).toBe('auto')
    expect(s.resolvedTheme).toBe('dark')
    expect(s.isAutoTheme).toBe(true)
  })

  it('T04: setTheme(auto) 在系统 light 时解析为 light', () => {
    setSystemTheme(false)
    const s = useSettingsStore()
    s.setTheme('auto')
    expect(s.theme).toBe('auto')
    expect(s.resolvedTheme).toBe('light')
  })

  it('T05: toggleTheme 在 dark 时切换到 light', () => {
    const s = useSettingsStore()
    expect(s.resolvedTheme).toBe('dark')
    s.toggleTheme()
    expect(s.resolvedTheme).toBe('light')
  })

  it('T06: toggleTheme 在 light 时切换到 dark', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    s.toggleTheme()
    expect(s.resolvedTheme).toBe('dark')
  })

  it('T07: setTheme 应用 CSS 变量到 documentElement', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    expect(mockDoc.documentElement.style.getPropertyValue('--pf-paper')).toBe(LT['--pf-paper'])
  })

  it('T08: setTheme 设置 data-theme 属性', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('light')
  })

  // --------------------------------------------------------------------------
  // 7.3 自动保存间隔
  // --------------------------------------------------------------------------

  it('A01: setAutosaveInterval 设置间隔', () => {
    const s = useSettingsStore()
    s.setAutosaveInterval(30_000)
    expect(s.autosaveIntervalMs).toBe(30_000)
  })

  it('A02: setAutosaveInterval 最小 1000ms', () => {
    const s = useSettingsStore()
    s.setAutosaveInterval(500)
    expect(s.autosaveIntervalMs).toBe(1_000)
  })

  it('A03: setAutosaveInterval 最大 300000ms', () => {
    const s = useSettingsStore()
    s.setAutosaveInterval(500_000)
    expect(s.autosaveIntervalMs).toBe(300_000)
  })

  it('A04: autosaveIntervalSeconds getter', () => {
    const s = useSettingsStore()
    s.setAutosaveInterval(30_000)
    expect(s.autosaveIntervalSeconds).toBe(30)
  })

  // --------------------------------------------------------------------------
  // 7.4 画布尺寸
  // --------------------------------------------------------------------------

  it('C01: setDefaultCanvasSize 设置尺寸', () => {
    const s = useSettingsStore()
    s.setDefaultCanvasSize(1280, 720)
    expect(s.defaultCanvasWidth).toBe(1280)
    expect(s.defaultCanvasHeight).toBe(720)
  })

  it('C02: setDefaultCanvasSize 拒绝负值', () => {
    const s = useSettingsStore()
    s.setDefaultCanvasSize(-100, 720)
    expect(s.defaultCanvasWidth).toBe(1920)
  })

  it('C03: setDefaultCanvasSize 拒绝零值', () => {
    const s = useSettingsStore()
    s.setDefaultCanvasSize(0, 720)
    expect(s.defaultCanvasWidth).toBe(1920)
  })

  it('C04: setDefaultCanvasSize 四舍五入', () => {
    const s = useSettingsStore()
    s.setDefaultCanvasSize(1920.7, 1080.2)
    expect(s.defaultCanvasWidth).toBe(1921)
    expect(s.defaultCanvasHeight).toBe(1080)
  })

  // --------------------------------------------------------------------------
  // 7.5 语言 / 性能监控 / 启动恢复
  // --------------------------------------------------------------------------

  it('M01: setLanguage 设置语言', () => {
    const s = useSettingsStore()
    s.setLanguage('en-US')
    expect(s.language).toBe('en-US')
  })

  it('M02: setLanguage 拒绝空字符串', () => {
    const s = useSettingsStore()
    s.setLanguage('')
    expect(s.language).toBe('zh-CN')
  })

  it('M03: setShowPerformanceMonitor 开关', () => {
    const s = useSettingsStore()
    s.setShowPerformanceMonitor(true)
    expect(s.showPerformanceMonitor).toBe(true)
    s.setShowPerformanceMonitor(false)
    expect(s.showPerformanceMonitor).toBe(false)
  })

  it('M04: setRestoreOnStartup 开关', () => {
    const s = useSettingsStore()
    s.setRestoreOnStartup(false)
    expect(s.restoreOnStartup).toBe(false)
  })

  // --------------------------------------------------------------------------
  // 7.6 持久化
  // --------------------------------------------------------------------------

  it('LS01: 设置变更后写入 localStorage', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    const raw = mockStorage.getItem('pixelforge:settings')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.theme).toBe('light')
  })

  it('LS02: autosaveInterval 变更后写入 localStorage', () => {
    const s = useSettingsStore()
    s.setAutosaveInterval(60_000)
    const raw = mockStorage.getItem('pixelforge:settings')
    const parsed = JSON.parse(raw!)
    expect(parsed.autosaveIntervalMs).toBe(60_000)
  })

  it('LS03: 从 localStorage 恢复设置', () => {
    mockStorage.setItem('pixelforge:settings', JSON.stringify({
      theme: 'light',
      language: 'en-US',
      autosaveIntervalMs: 30_000,
      defaultCanvasWidth: 1280,
      defaultCanvasHeight: 720,
      showPerformanceMonitor: true,
      restoreOnStartup: false,
    }))
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('light')
    expect(s.language).toBe('en-US')
    expect(s.autosaveIntervalMs).toBe(30_000)
    expect(s.defaultCanvasWidth).toBe(1280)
    expect(s.showPerformanceMonitor).toBe(true)
    expect(s.restoreOnStartup).toBe(false)
  })

  it('LS04: localStorage 损坏时回退默认', () => {
    mockStorage.setItem('pixelforge:settings', '{invalid json')
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('dark')
    expect(s.autosaveIntervalMs).toBe(10_000)
  })

  it('LS05: localStorage 部分字段缺失时合并默认', () => {
    mockStorage.setItem('pixelforge:settings', JSON.stringify({ theme: 'light' }))
    setActivePinia(createPinia())
    const s = useSettingsStore()
    expect(s.theme).toBe('light')
    expect(s.autosaveIntervalMs).toBe(10_000)
    expect(s.language).toBe('zh-CN')
  })

  // --------------------------------------------------------------------------
  // 7.7 重置 / 初始化
  // --------------------------------------------------------------------------

  it('RS01: resetToDefaults 恢复所有默认值', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    s.setAutosaveInterval(60_000)
    s.setLanguage('en-US')
    s.resetToDefaults()
    expect(s.theme).toBe('dark')
    expect(s.autosaveIntervalMs).toBe(10_000)
    expect(s.language).toBe('zh-CN')
  })

  it('RS02: init 应用主题到 documentElement', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    // 模拟重新初始化(清空 style)
    mockDoc = createMockDocument()
    vi.stubGlobal('document', mockDoc)
    s.init()
    expect(mockDoc.documentElement.getAttribute('data-theme')).toBe('light')
    expect(mockDoc.documentElement.style.getPropertyValue('--pf-paper')).toBe(LT['--pf-paper'])
  })

  it('RS03: dispose 停止系统监听(不抛错)', () => {
    const s = useSettingsStore()
    s.setTheme('auto')
    expect(() => s.dispose()).not.toThrow()
  })

  // --------------------------------------------------------------------------
  // 7.8 Getters
  // --------------------------------------------------------------------------

  it('G01: isDark 在 dark 主题时为 true', () => {
    const s = useSettingsStore()
    expect(s.isDark).toBe(true)
  })

  it('G02: isDark 在 light 主题时为 false', () => {
    const s = useSettingsStore()
    s.setTheme('light')
    expect(s.isDark).toBe(false)
  })

  it('G03: isAutoTheme 在 auto 模式时为 true', () => {
    const s = useSettingsStore()
    s.setTheme('auto')
    expect(s.isAutoTheme).toBe(true)
  })

  it('G04: isAutoTheme 在 dark 模式时为 false', () => {
    const s = useSettingsStore()
    expect(s.isAutoTheme).toBe(false)
  })
})
