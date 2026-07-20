import { onBeforeUnmount, onMounted } from 'vue'

import { useRuntimeStore } from '@/stores/runtime'
import { useHistoryStore } from '@/stores/history'
import { useTimelineStore } from '@/stores/timeline'

/**
 * 全局键盘快捷键 composable。
 *
 * 快捷键表:
 * - Ctrl/Cmd + Z       → undo
 * - Ctrl/Cmd + Shift+Z → redo(也支持 Ctrl+Y)
 * - Ctrl/Cmd + Y       → redo
 * - Space              → 播放 / 暂停(焦点不在 input/textarea/select 时)
 * - ← / →              → 上一帧 / 下一帧
 * - Home / End         → 跳到开头 / 结尾
 *
 * 用法:
 *   import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
 *   useKeyboardShortcuts()
 *
 * 设计原则:
 * - 在 input / textarea / select / [contenteditable] 聚焦时禁用快捷键
 *   (避免编辑参数时触发播放/跳帧)
 * - undo/redo 即使在 input 聚焦时也响应(更符合直觉)
 */
export function useKeyboardShortcuts(): void {
  const runtime = useRuntimeStore()
  const history = useHistoryStore()
  const timeline = useTimelineStore()

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    if (target.isContentEditable) return true
    return false
  }

  function onKeyDown(event: KeyboardEvent) {
    const isMod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()

    // —— Undo / Redo(任何焦点都响应)——
    if (isMod && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        history.redo(runtime)
      } else {
        history.undo(runtime)
      }
      return
    }
    if (isMod && key === 'y') {
      event.preventDefault()
      history.redo(runtime)
      return
    }

    // —— 以下快捷键在编辑控件聚焦时不响应 ——
    if (isEditableTarget(event.target)) return

    // Space → 播放 / 暂停
    if (key === ' ' || event.code === 'Space') {
      event.preventDefault()
      timeline.togglePlay()
      return
    }

    // ← → 上下帧
    if (key === 'arrowleft') {
      event.preventDefault()
      timeline.stepBackward()
      return
    }
    if (key === 'arrowright') {
      event.preventDefault()
      timeline.stepForward()
      return
    }

    // Home / End 跳到开头 / 结尾
    if (key === 'home') {
      event.preventDefault()
      timeline.jumpStart()
      return
    }
    if (key === 'end') {
      event.preventDefault()
      timeline.jumpEnd()
      return
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
  })
}
