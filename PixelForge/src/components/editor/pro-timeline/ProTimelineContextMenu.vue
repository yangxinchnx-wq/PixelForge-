<script setup lang="ts">
/**
 * ProTimelineContextMenu(Step 31.2)— Clip 右键菜单。
 *
 * 选项:
 * - 切割(在播放头位置)
 * - 删除
 * - 涟漪删除(删除并后移填补)
 * - 启用/禁用
 * - 锁定/解锁
 *
 * 出现位置:鼠标点击位置
 * 关闭:点击外部 / Esc
 */
import { onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'

interface Props {
  visible: boolean
  x: number
  y: number
  clipEnabled: boolean
  clipLocked: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  cut: []
  delete: []
  'ripple-delete': []
  'toggle-enabled': []
  'toggle-locked': []
  close: []
}>()

const menuRef = ref<HTMLElement | null>(null)
/** 调整后位置(避免超出视口) */
const adjustedPos = ref({ x: 0, y: 0 })

function onDocumentClick(event: MouseEvent) {
  if (!props.visible) return
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    emit('close')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) {
    emit('close')
  }
}

watch(
  () => [props.visible, props.x, props.y] as const,
  async ([visible, x, y]) => {
    if (!visible) return
    await nextTick()
    adjustedPos.value = { x, y }
    // 等待 DOM 更新后检查边界
    await nextTick()
    if (menuRef.value) {
      const rect = menuRef.value.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      let nx = x
      let ny = y
      if (x + rect.width > vw - 8) nx = Math.max(8, vw - rect.width - 8)
      if (y + rect.height > vh - 8) ny = Math.max(8, vh - rect.height - 8)
      adjustedPos.value = { x: nx, y: ny }
    }
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('mousedown', onDocumentClick, true)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDocumentClick, true)
  window.removeEventListener('keydown', onKeydown)
})

function emitAndClose(name: 'cut' | 'delete' | 'ripple-delete' | 'toggle-enabled' | 'toggle-locked') {
  switch (name) {
    case 'cut': emit('cut'); break
    case 'delete': emit('delete'); break
    case 'ripple-delete': emit('ripple-delete'); break
    case 'toggle-enabled': emit('toggle-enabled'); break
    case 'toggle-locked': emit('toggle-locked'); break
  }
  emit('close')
}
</script>

<template>
  <div
    v-if="visible"
    ref="menuRef"
    class="pro-context-menu"
    :style="{ left: adjustedPos.x + 'px', top: adjustedPos.y + 'px' }"
    @mousedown.stop
  >
    <button class="menu-item" @click="emitAndClose('cut')">
      <span class="item-label">切割</span>
      <span class="item-shortcut">C</span>
    </button>
    <button class="menu-item danger" @click="emitAndClose('delete')">
      <span class="item-label">删除</span>
      <span class="item-shortcut">Del</span>
    </button>
    <button class="menu-item danger" @click="emitAndClose('ripple-delete')">
      <span class="item-label">涟漪删除</span>
      <span class="item-shortcut">Shift+Del</span>
    </button>
    <div class="menu-divider"></div>
    <button class="menu-item" @click="emitAndClose('toggle-enabled')">
      <span class="item-label">{{ clipEnabled ? '禁用片段' : '启用片段' }}</span>
    </button>
    <button class="menu-item" @click="emitAndClose('toggle-locked')">
      <span class="item-label">{{ clipLocked ? '解锁片段' : '锁定片段' }}</span>
    </button>
  </div>
</template>

<style scoped>
.pro-context-menu {
  position: fixed;
  min-width: 180px;
  padding: 4px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: var(--pf-r-sm);
  box-shadow: 0 8px 24px rgba(30, 25, 20, 0.18);
  z-index: 1000;
  font-family: 'Inter', system-ui, sans-serif;
  animation: ctx-pop 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes ctx-pop {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--pf-ink);
  font-size: 12px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: background 150ms cubic-bezier(0.22, 1, 0.36, 1);
  text-align: left;
}
.menu-item:hover {
  background: var(--pf-surface-soft);
}
.menu-item.danger {
  color: var(--pf-danger);
}
.menu-item.danger:hover {
  background: rgba(212, 75, 75, 0.08);
}
.item-label {
  flex: 1;
  min-width: 0;
}
.item-shortcut {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-faint);
  flex-shrink: 0;
}
.menu-divider {
  height: 1px;
  background: var(--pf-line);
  margin: 4px 0;
}
</style>
