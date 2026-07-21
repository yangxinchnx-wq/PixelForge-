<script setup lang="ts">
/**
 * ProTimelineSequenceBar(Step 31.6)— 序列切换栏。
 *
 * 功能:
 * - 标签页式序列切换(点击切换 activeSequence)
 * - 添加序列按钮(+)
 * - 右键菜单:重命名 / 复制 / 删除
 * - 双击标签页重命名(内联输入)
 * - 嵌套引用警告(若序列被其他序列引用,删除时提示)
 *
 * 设计:
 * - 中文文字标签,无纯图标
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - --pf-* 设计令牌
 */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'

const store = useProTimelineStore()

// ============================================================================
// 1. 重命名状态
// ============================================================================

const renamingId = ref<string | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)
const renameValue = ref('')

function startRename(seqId: string, currentName: string) {
  renamingId.value = seqId
  renameValue.value = currentName
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function commitRename() {
  if (renamingId.value && renameValue.value.trim()) {
    store.renameSequence(renamingId.value, renameValue.value)
  }
  renamingId.value = null
}

function cancelRename() {
  renamingId.value = null
}

// ============================================================================
// 2. 右键菜单
// ============================================================================

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuSeqId = ref<string | null>(null)

function openMenu(event: MouseEvent, seqId: string) {
  event.preventDefault()
  menuSeqId.value = seqId
  menuX.value = event.clientX
  menuY.value = event.clientY
  menuVisible.value = true
}

function closeMenu() {
  menuVisible.value = false
  menuSeqId.value = null
}

function menuRename() {
  if (!menuSeqId.value) return
  const seq = store.findSequenceById(menuSeqId.value)
  if (seq) startRename(seq.id, seq.name)
  closeMenu()
}

function menuDuplicate() {
  if (!menuSeqId.value) return
  store.duplicateSequence(menuSeqId.value)
  closeMenu()
}

function menuDelete() {
  if (!menuSeqId.value) return
  // 检查是否被其他序列引用
  const refs = store.findReferencingSequences(menuSeqId.value)
  if (refs.length > 0) {
    const refNames = refs
      .map((id) => store.findSequenceById(id)?.name ?? id)
      .join(', ')
    if (!window.confirm(`该序列被以下序列嵌套引用:${refNames}\n删除后这些引用将失效。是否继续?`)) {
      closeMenu()
      return
    }
  }
  // 不允许删除最后一个
  if (store.sequenceCount <= 1) {
    window.alert('至少需要保留一个序列')
    closeMenu()
    return
  }
  store.removeSequence(menuSeqId.value)
  closeMenu()
}

function onContextMenuOutside() {
  closeMenu()
}

onMounted(() => {
  window.addEventListener('click', onContextMenuOutside)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', onContextMenuOutside)
})

// ============================================================================
// 3. 添加 / 切换序列
// ============================================================================

function onAddSequence() {
  store.addSequence()
}

function onSwitch(seqId: string) {
  if (seqId !== store.activeSequenceId) {
    store.switchSequence(seqId)
  }
}

// ============================================================================
// 4. 跨 Sequence 拖拽(Step 31.7)
// ============================================================================

const dragOverSeqId = ref<string | null>(null)
const dragOverIsCopy = ref(false)

function onSeqDragOver(event: DragEvent, seqId: string) {
  if (!event.dataTransfer) return
  // 只接受 pf-cross-seq 类型的拖拽
  const types = event.dataTransfer.types
  if (!types.includes('text/pf-cross-seq')) return
  // 不允许拖到当前活跃 Sequence(已经在那)
  if (seqId === store.activeSequenceId) return
  event.preventDefault()
  event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move'
  dragOverSeqId.value = seqId
  dragOverIsCopy.value = event.altKey
}

function onSeqDragLeave(seqId: string) {
  if (dragOverSeqId.value === seqId) {
    dragOverSeqId.value = null
  }
}

function onSeqDrop(event: DragEvent, seqId: string) {
  event.preventDefault()
  const clipId = event.dataTransfer?.getData('text/pf-clip-id')
  const mode = event.dataTransfer?.getData('text/pf-cross-seq') // 'copy' | 'move'
  dragOverSeqId.value = null
  dragOverIsCopy.value = false
  if (!clipId) return
  if (seqId === store.activeSequenceId) return // 拖回自身:无操作

  if (mode === 'copy') {
    const newId = store.copyClipToSequence(clipId, seqId)
    if (newId) {
      // 切换到目标 Sequence 查看
      store.switchSequence(seqId)
    } else {
      window.alert('复制失败:可能未找到兼容轨道')
    }
  } else {
    const movedId = store.moveClipToSequence(clipId, seqId)
    if (movedId) {
      store.switchSequence(seqId)
    } else {
      window.alert('移动失败:可能未找到兼容轨道')
    }
  }
}
</script>

<template>
  <div class="sequence-bar">
    <div class="sequence-tabs">
      <div
        v-for="seq in store.sequences"
        :key="seq.id"
        class="sequence-tab"
        :class="{
          active: seq.id === store.activeSequenceId,
          'drop-target': dragOverSeqId === seq.id,
          'drop-copy': dragOverSeqId === seq.id && dragOverIsCopy,
        }"
        @click="onSwitch(seq.id)"
        @dblclick="startRename(seq.id, seq.name)"
        @contextmenu="openMenu($event, seq.id)"
        @dragover="onSeqDragOver($event, seq.id)"
        @dragleave="onSeqDragLeave(seq.id)"
        @drop="onSeqDrop($event, seq.id)"
      >
        <template v-if="renamingId === seq.id">
          <input
            ref="renameInput"
            v-model="renameValue"
            class="rename-input"
            @blur="commitRename"
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
            @click.stop
          />
        </template>
        <template v-else>
          <span class="seq-name">{{ seq.name }}</span>
          <span class="seq-meta">{{ seq.fps }}fps · {{ seq.width }}×{{ seq.height }}</span>
        </template>
      </div>
      <button class="add-seq-btn" title="添加序列" @click="onAddSequence">+</button>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="menuVisible"
      class="context-menu"
      :style="{ left: menuX + 'px', top: menuY + 'px' }"
      @click.stop
    >
      <button class="menu-item" @click="menuRename">重命名</button>
      <button class="menu-item" @click="menuDuplicate">复制序列</button>
      <button class="menu-item danger" @click="menuDelete">删除</button>
    </div>
  </div>
</template>

<style scoped>
.sequence-bar {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  background: var(--pf-surface);
  border-bottom: 1px solid var(--pf-line);
  min-height: 36px;
}

.sequence-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

.sequence-tabs::-webkit-scrollbar {
  height: 2px;
}

.sequence-tab {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 4px 12px;
  min-width: 80px;
  max-width: 180px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--pf-r-sm);
  background: transparent;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  user-select: none;
}

.sequence-tab:hover {
  background: var(--pf-surface-sunk);
}

.sequence-tab.active {
  background: var(--pf-surface-sunk);
  border-color: var(--pf-line-strong);
}

.sequence-tab.drop-target {
  background: var(--pf-accent-soft);
  border-color: var(--pf-accent);
  transform: scale(1.04);
}

.sequence-tab.drop-copy {
  border-style: dashed;
}

.seq-name {
  font-size: 12px;
  color: var(--pf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.sequence-tab.active .seq-name {
  color: var(--pf-accent);
  font-weight: 500;
}

.seq-meta {
  font-size: 10px;
  color: var(--pf-ink-muted);
  font-family: 'JetBrains Mono', monospace;
  line-height: 1.2;
  white-space: nowrap;
}

.rename-input {
  width: 100%;
  height: 20px;
  padding: 0 4px;
  border: 1px solid var(--pf-accent);
  border-radius: var(--pf-r-xs);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-size: 12px;
  outline: none;
  font-family: inherit;
}

.add-seq-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-sm);
  background: var(--pf-surface);
  color: var(--pf-ink-muted);
  font-size: 16px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-seq-btn:hover {
  border-color: var(--pf-line-strong);
  color: var(--pf-ink);
  background: var(--pf-surface-sunk);
}

.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 120px;
  padding: 4px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-sm);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--pf-ink);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  border-radius: var(--pf-r-xs);
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.menu-item:hover {
  background: var(--pf-surface-sunk);
}

.menu-item.danger {
  color: #e53935;
}

.menu-item.danger:hover {
  background: rgba(229, 57, 53, 0.08);
}
</style>
