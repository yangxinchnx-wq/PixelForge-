<script setup lang="ts">
/**
 * CommandPalette(Step 40.2)— Ctrl+K 命令面板。
 *
 * 功能:
 * - 模态弹窗,顶部居中显示
 * - 搜索框(自动聚焦)实时过滤命令(name / id / description 模糊匹配)
 * - 命令列表按 category 分组,显示快捷键徽章
 * - 键盘导航:ArrowUp/Down 选择,Enter 执行,Esc/背景点击关闭
 * - 鼠标 hover 也可选中
 *
 * 数据来源:全局 commandRegistry 单例(search / listByCategory)
 *
 * 动画:iOS 风格 180ms cubic-bezier(0.22, 1, 0.36, 1)
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { commandRegistry, formatShortcut, type CommandInfo, type CommandCategory } from '@/composables/commandRegistry'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// —— 搜索 ——
const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

// —— 平台检测(用于快捷键格式化) ——
const platform = computed<'mac' | 'win'>(() => {
  if (typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)) return 'mac'
  return 'win'
})

// —— 过滤后的命令(按 category 分组) ——
const filteredCommands = computed<CommandInfo[]>(() => {
  return commandRegistry.search(query.value)
})

const CATEGORY_LABEL: Record<CommandCategory, string> = {
  playback: '播放控制',
  history: '历史记录',
  project: '项目',
  editor: '编辑器',
  view: '视图',
  settings: '设置',
}

const groupedCommands = computed(() => {
  const groups: { category: CommandCategory; label: string; items: CommandInfo[] }[] = []
  const map = new Map<CommandCategory, CommandInfo[]>()
  for (const cmd of filteredCommands.value) {
    if (!map.has(cmd.category)) map.set(cmd.category, [])
    map.get(cmd.category)!.push(cmd)
  }
  // 按 CATEGORY_LABEL 中的固定顺序输出
  const order: CommandCategory[] = ['playback', 'history', 'editor', 'view', 'project', 'settings']
  for (const cat of order) {
    const items = map.get(cat)
    if (items && items.length > 0) {
      groups.push({ category: cat, label: CATEGORY_LABEL[cat], items })
    }
  }
  return groups
})

// —— 选中索引(扁平化后的全局索引) ——
const selectedIndex = ref(0)

const flatCommands = computed(() => groupedCommands.value.flatMap((g) => g.items))

function clampIndex(idx: number): number {
  const len = flatCommands.value.length
  if (len === 0) return -1
  if (idx < 0) return len - 1
  if (idx >= len) return 0
  return idx
}

// —— 键盘导航 ——
function onKeydown(e: KeyboardEvent) {
  if (!props.open) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = clampIndex(selectedIndex.value + 1)
    scrollSelectedIntoView()
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = clampIndex(selectedIndex.value - 1)
    scrollSelectedIntoView()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const cmd = flatCommands.value[selectedIndex.value]
    if (cmd) executeCommand(cmd)
    return
  }
}

function scrollSelectedIntoView() {
  nextTick(() => {
    const list = document.querySelector('.command-list')
    if (!list) return
    const sel = list.querySelector('.command-item.selected') as HTMLElement | null
    if (sel) sel.scrollIntoView({ block: 'nearest' })
  })
}

// —— 执行命令 ——
function executeCommand(cmd: CommandInfo) {
  const ok = commandRegistry.execute(cmd.id)
  if (ok) emit('close')
}

// —— 鼠标 hover 选中 ——
function onItemHover(idx: number) {
  selectedIndex.value = idx
}

// —— 背景点击关闭 ——
function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

// —— open 变化时重置状态 ——
watch(() => props.open, async (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedIndex.value = 0
    await nextTick()
    inputRef.value?.focus()
  }
})

// —— 搜索变化时重置选中 ——
watch(query, () => {
  selectedIndex.value = 0
})

// —— 全局键盘监听(只在该组件挂载时安装) ——
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

// —— 格式化快捷键 ——
function formatShortcutLabel(cmd: CommandInfo): string | null {
  const parts: string[] = []
  if (cmd.shortcut) parts.push(formatShortcut(cmd.shortcut, platform.value))
  if (cmd.altShortcut) parts.push(formatShortcut(cmd.altShortcut, platform.value))
  return parts.length > 0 ? parts.join(' / ') : null
}
</script>

<template>
  <Transition name="palette-fade">
    <div v-if="open" class="palette-backdrop" @click="onBackdropClick">
      <Transition name="palette-pop" appear>
        <div v-if="open" class="palette" role="dialog" aria-modal="true" aria-label="命令面板">
          <!-- 搜索框 -->
          <div class="palette-input-wrap">
            <span class="palette-icon">⌘</span>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="palette-input"
              placeholder="搜索命令…"
              spellcheck="false"
              autocomplete="off"
            />
            <kbd class="palette-esc">Esc</kbd>
          </div>

          <!-- 命令列表 -->
          <div class="command-list" v-if="flatCommands.length > 0">
            <template v-for="group in groupedCommands" :key="group.category">
              <div class="group-label">{{ group.label }}</div>
              <button
                v-for="cmd in group.items"
                :key="cmd.id"
                :class="['command-item', {
                  selected: flatCommands.indexOf(cmd) === selectedIndex,
                  disabled: !cmd.enabled,
                }]"
                :disabled="!cmd.enabled"
                @click="executeCommand(cmd)"
                @mouseenter="onItemHover(flatCommands.indexOf(cmd))"
              >
                <div class="cmd-text">
                  <span class="cmd-name">{{ cmd.name }}</span>
                  <span v-if="cmd.description" class="cmd-desc">{{ cmd.description }}</span>
                </div>
                <kbd v-if="formatShortcutLabel(cmd)" class="cmd-shortcut">{{ formatShortcutLabel(cmd) }}</kbd>
              </button>
            </template>
          </div>

          <!-- 空状态 -->
          <div v-else class="palette-empty">
            <span>未找到匹配的命令</span>
          </div>

          <!-- 底部提示 -->
          <footer class="palette-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
            <span><kbd>Enter</kbd> 执行</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </footer>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* —— 背景遮罩 —— */
.palette-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  z-index: 1100;
}

/* —— 面板主体 —— */
.palette {
  width: 560px;
  max-height: 70vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

/* —— 搜索框 —— */
.palette-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--pf-line);
}
.palette-icon {
  font-size: 16px;
  color: var(--pf-ink-muted);
  font-family: 'JetBrains Mono', monospace;
}
.palette-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--pf-ink);
  font-size: 15px;
  font-family: 'JetBrains Mono', monospace;
}
.palette-input::placeholder {
  color: var(--pf-ink-muted);
}
.palette-esc {
  padding: 2px 8px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-sm);
  background: var(--pf-surface-soft);
  color: var(--pf-ink-muted);
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}

/* —— 命令列表 —— */
.command-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

/* —— 分组标签 —— */
.group-label {
  padding: 10px 18px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--pf-ink-muted);
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
}

/* —— 命令项 —— */
.command-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.command-item:hover,
.command-item.selected {
  background: var(--pf-surface-soft);
}
.command-item.selected {
  background: var(--pf-accent-soft);
}
.command-item.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.cmd-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cmd-name {
  font-size: 13px;
  color: var(--pf-ink);
  font-weight: 500;
}
.cmd-desc {
  font-size: 11px;
  color: var(--pf-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cmd-shortcut {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-sm);
  background: var(--pf-surface-sunk);
  color: var(--pf-ink-soft);
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
}

/* —— 空状态 —— */
.palette-empty {
  padding: 32px 18px;
  text-align: center;
  color: var(--pf-ink-muted);
  font-size: 13px;
}

/* —— 底部 —— */
.palette-footer {
  display: flex;
  gap: 16px;
  padding: 10px 18px;
  border-top: 1px solid var(--pf-line);
  font-size: 11px;
  color: var(--pf-ink-muted);
  font-family: 'JetBrains Mono', monospace;
}
.palette-footer kbd {
  display: inline-block;
  padding: 1px 5px;
  margin-right: 4px;
  border: 1px solid var(--pf-line);
  border-radius: 3px;
  background: var(--pf-surface-soft);
  color: var(--pf-ink-soft);
  font-size: 10px;
}

/* —— 动画 —— */
.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
.palette-pop-enter-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.palette-pop-leave-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.palette-pop-enter-from,
.palette-pop-leave-to {
  transform: scale(0.96) translateY(-8px);
  opacity: 0;
}
</style>
