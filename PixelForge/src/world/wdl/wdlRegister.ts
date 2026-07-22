/**
 * PixelForge - WDL Monaco 语言注册(Step 38.1)
 *
 * 职责:
 * - 在 Monaco Editor 中注册 WDL 语言
 * - 注册 Monarch tokenizer + 语言配置 + 主题
 * - 提供幂等注册函数(多次调用安全)
 *
 * 用法:
 *   import { registerWDLLanguage } from '@/world/wdl/wdlRegister'
 *   registerWDLLanguage(monaco)  // 在组件 onMounted 时调用
 */
import type * as Monaco from 'monaco-editor'
import {
  WDL_LANGUAGE_ID,
  wdlMonarchDefinition,
} from './wdlMonarch'
import { wdlLanguageConfiguration } from './wdlLanguageConfig'
import { WDL_THEME_ID, wdlThemeDefinition } from './wdlTheme'
import { registerWDLCompletion } from './wdlCompletion'

/** 标记是否已注册(防止重复注册) */
let registered = false

/**
 * 在 Monaco 实例上注册 WDL 语言。
 *
 * 包含:
 * - 语言 ID 注册('wdl')
 * - Monarch tokenizer(语法高亮)
 * - 语言配置(括号匹配 / 自动闭合 / 注释切换)
 * - 主题(pixelforge-dark)
 *
 * 幂等:多次调用只注册一次。
 */
export function registerWDLLanguage(monaco: typeof Monaco): void {
  if (registered) return

  // 1. 注册语言 ID
  monaco.languages.register({ id: WDL_LANGUAGE_ID })

  // 2. 注册 Monarch tokenizer
  monaco.languages.setMonarchTokensProvider(WDL_LANGUAGE_ID, wdlMonarchDefinition)

  // 3. 注册语言配置
  monaco.languages.setLanguageConfiguration(WDL_LANGUAGE_ID, wdlLanguageConfiguration)

  // 4. 定义主题
  monaco.editor.defineTheme(WDL_THEME_ID, wdlThemeDefinition)

  // 5. 注册自动补全(Step 38.2)
  registerWDLCompletion(monaco)

  registered = true
}

/** 重置注册状态(仅用于测试) */
export function _resetRegistrationForTest(): void {
  registered = false
}
