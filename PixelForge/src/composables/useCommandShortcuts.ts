/**
 * useCommandShortcuts(Step 40.2)— 基于 CommandRegistry 的全局快捷键 composable。
 *
 * 替换原有 useKeyboardShortcuts,从 commandRegistry 读取绑定,统一调度。
 *
 * 行为:
 * - 监听 window keydown 事件
 * - 通过 commandRegistry.matchShortcut(event) 查找命令
 * - 焦点守卫:若命令未标记 activeWhenEditing 且当前焦点在 input/textarea/select/contenteditable,则跳过
 * - 命令面板(Ctrl+K / Cmd+K)由调用方单独绑定,不在此处处理(避免循环触发)
 *
 * 用法:
 *   import { useCommandShortcuts } from '@/composables/useCommandShortcuts'
 *   useCommandShortcuts()
 *
 * 设计原则:
 * - 副作用集中在 onMounted/onBeforeUnmount,便于在 SFC setup 中使用
 * - 不依赖具体 store,所有命令通过 commandRegistry.execute(id) 调用
 * - 与 CommandPalette.vue 协同:面板打开时仍可响应快捷键(但通常面板会拦截 Esc/Arrow/Enter)
 */
import { onBeforeUnmount, onMounted } from 'vue'

import { commandRegistry, isEditableTarget } from './commandRegistry'

export function useCommandShortcuts(): void {
  function onKeyDown(event: KeyboardEvent) {
    const cmd = commandRegistry.matchShortcut(event)
    if (!cmd) return

    // 焦点守卫:编辑控件聚焦时,只响应 activeWhenEditing 标记的命令
    if (!cmd.activeWhenEditing && isEditableTarget(event.target)) return

    event.preventDefault()
    void cmd.execute()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
  })
}
