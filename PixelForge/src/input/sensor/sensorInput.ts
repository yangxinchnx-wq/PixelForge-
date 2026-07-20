/**
 * Sensor Input(Step 30.x)— 通用传感器接口。
 *
 * 职责:
 * - 提供通用信号写入接口(鼠标 / 键盘 / 自定义事件 / AI 事件)
 * - 不绑定具体硬件(与 audio / midi / camera 模块解耦)
 *
 * 用途:
 * - 鼠标位置 → 信号 'mouse.x' / 'mouse.y'
 * - 键盘按键 → 信号 'key.space' (0/1)
 * - AI 事件 → 信号 'ai.scene_change' (瞬时值)
 * - 自定义数据源(WebSocket / IPC / 插件)
 *
 * 设计:
 * - 纯函数式 API(不持有状态,直接写入 InputRouter)
 * - 不做事件监听(由调用方监听浏览器事件,调用 writeMouseSignal 等)
 */

import type { InputSourceKind } from '../types'

// ============================================================================
// 1. SignalWriter 接口
// ============================================================================

interface SignalWriter {
  setSignal: (id: string, value: number, source: InputSourceKind) => void
}

// ============================================================================
// 2. 鼠标信号
// ============================================================================

/** 鼠标信号 id 前缀 */
export const MOUSE_SIGNAL_PREFIX = 'mouse'

/** 鼠标 X 信号 id(归一化到 0-1,相对于 viewport 宽度) */
export const MOUSE_X_SIGNAL_ID = `${MOUSE_SIGNAL_PREFIX}.x`

/** 鼠标 Y 信号 id(归一化到 0-1,相对于 viewport 高度) */
export const MOUSE_Y_SIGNAL_ID = `${MOUSE_SIGNAL_PREFIX}.y`

/** 鼠标按钮信号 id 前缀(如 'mouse.button0' = 左键) */
export function mouseButtonSignalId(button: number): string {
  return `${MOUSE_SIGNAL_PREFIX}.button${button}`
}

/**
 * 把鼠标位置写入 InputRouter(归一化到 0-1)。
 *
 * @param router InputRouter(或实现 SignalWriter 的对象)
 * @param clientX  鼠标 X(相对于 viewport)
 * @param clientY  鼠标 Y(相对于 viewport)
 * @param viewportWidth   viewport 宽度
 * @param viewportHeight  viewport 高度
 */
export function writeMousePosition(
  router: SignalWriter,
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const x = viewportWidth > 0 ? clientX / viewportWidth : 0
  const y = viewportHeight > 0 ? clientY / viewportHeight : 0
  router.setSignal(MOUSE_X_SIGNAL_ID, Math.max(0, Math.min(1, x)), 'SENSOR')
  router.setSignal(MOUSE_Y_SIGNAL_ID, Math.max(0, Math.min(1, y)), 'SENSOR')
}

/**
 * 把鼠标按钮状态写入 InputRouter(按下=1, 释放=0)。
 */
export function writeMouseButton(
  router: SignalWriter,
  button: number,
  pressed: boolean,
): void {
  router.setSignal(mouseButtonSignalId(button), pressed ? 1 : 0, 'SENSOR')
}

// ============================================================================
// 3. 键盘信号
// ============================================================================

/** 键盘信号 id 前缀(如 'key.space' / 'key.enter') */
export const KEY_SIGNAL_PREFIX = 'key'

/** 把 key 名转换成信号 id */
export function keySignalId(key: string): string {
  // 规范化:小写 + 空格转下划线
  const normalized = key.toLowerCase().replace(/\s+/g, '_')
  return `${KEY_SIGNAL_PREFIX}.${normalized}`
}

/**
 * 把键盘按键状态写入 InputRouter(按下=1, 释放=0)。
 *
 * @param key KeyboardEvent.key 值(如 ' ' / 'Enter' / 'a')
 */
export function writeKeyState(
  router: SignalWriter,
  key: string,
  pressed: boolean,
): void {
  router.setSignal(keySignalId(key), pressed ? 1 : 0, 'SENSOR')
}

// ============================================================================
// 4. AI 事件信号
// ============================================================================

/** AI 信号 id 前缀 */
export const AI_SIGNAL_PREFIX = 'ai'

/**
 * 写入 AI 事件信号(瞬时值,通常 0-1)。
 *
 * 用途:
 * - LLM 触发的场景切换 → 'ai.scene_change' = 1
 * - AI 生成的情感强度 → 'ai.emotion' = 0.8
 *
 * @param name  信号名(如 'scene_change' / 'emotion')
 * @param value 信号值(0-1)
 */
export function writeAiSignal(
  router: SignalWriter,
  name: string,
  value: number,
): void {
  const id = `${AI_SIGNAL_PREFIX}.${name}`
  router.setSignal(id, value, 'AI')
}

// ============================================================================
// 5. 通用信号写入
// ============================================================================

/**
 * 写入自定义传感器信号。
 *
 * 用于插件 / WebSocket / IPC 等自定义数据源。
 *
 * @param name  信号名(如 'weather.temperature')
 * @param value 信号值
 */
export function writeSensorSignal(
  router: SignalWriter,
  name: string,
  value: number,
): void {
  const id = `sensor.${name}`
  router.setSignal(id, value, 'SENSOR')
}

// ============================================================================
// 6. 浏览器事件监听便捷函数
// ============================================================================

/**
 * 附加鼠标 / 键盘监听器,自动写入 InputRouter。
 *
 * 返回 cleanup 函数(调用时移除所有监听器)。
 *
 * 用法:
 *   const cleanup = attachBrowserInputListeners(inputRouter, window)
 *   // 组件销毁时:
 *   cleanup()
 */
export function attachBrowserInputListeners(
  router: SignalWriter,
  target: Window & typeof globalThis,
): () => void {
  const onMouseMove = (e: MouseEvent) => {
    writeMousePosition(router, e.clientX, e.clientY, target.innerWidth, target.innerHeight)
  }
  const onMouseDown = (e: MouseEvent) => {
    writeMouseButton(router, e.button, true)
  }
  const onMouseUp = (e: MouseEvent) => {
    writeMouseButton(router, e.button, false)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    writeKeyState(router, e.key, true)
  }
  const onKeyUp = (e: KeyboardEvent) => {
    writeKeyState(router, e.key, false)
  }

  target.addEventListener('mousemove', onMouseMove)
  target.addEventListener('mousedown', onMouseDown)
  target.addEventListener('mouseup', onMouseUp)
  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)

  return () => {
    target.removeEventListener('mousemove', onMouseMove)
    target.removeEventListener('mousedown', onMouseDown)
    target.removeEventListener('mouseup', onMouseUp)
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
  }
}
