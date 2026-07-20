<script setup lang="ts">
import { computed } from 'vue'

import { useHistoryStore } from '@/stores/history'
import { useProjectStore } from '@/project/projectStore'

interface Props {
  status: 'idle' | 'initializing' | 'ready' | 'error' | string
  currentFrame: number
  totalFrames: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  play: []
  pause: []
  stepForward: []
  stepBackward: []
  jumpStart: []
  jumpEnd: []
  undo: []
  redo: []
  newProject: []
  openProject: []
  saveProject: []
}>()

const history = useHistoryStore()
const project = useProjectStore()

const statusInfo = computed(() => {
  switch (props.status) {
    case 'ready':        return { label: '就绪',     color: 'var(--pf-success)' }
    case 'initializing': return { label: '初始化中', color: 'var(--pf-warning)' }
    case 'error':        return { label: '错误',     color: 'var(--pf-danger)' }
    default:             return { label: '空闲',     color: 'var(--pf-ink-muted)' }
  }
})

const undoTip = computed(() =>
  history.canUndo
    ? `撤销 · ${history.lastEntry?.description ?? ''} (Ctrl+Z)`
    : '无可撤销操作',
)
const redoTip = computed(() =>
  history.canRedo
    ? `重做 · ${history.nextRedoEntry?.description ?? ''} (Ctrl+Y)`
    : '无可重做操作',
)

const projectTitle = computed(() => {
  if (!project.hasProject) return 'PixelForge <sub>语义视频生成</sub>'
  const dirty = project.dirty ? ' •' : ''
  return `${project.projectName}${dirty} <sub>PixelForge</sub>`
})

const saveTip = computed(() =>
  project.dirty ? '保存项目(有未保存修改)' : '保存项目',
)
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <div class="brand"></div>
      <div class="title" v-html="projectTitle"></div>
      <div class="project-actions">
        <button class="pa-btn" data-tip="新建项目" @click="emit('newProject')">新建</button>
        <button class="pa-btn" data-tip="打开项目文件" @click="emit('openProject')">打开</button>
        <button class="pa-btn primary" :data-tip="saveTip" @click="emit('saveProject')">保存</button>
      </div>
    </div>

    <div class="topbar-center">
      <button
        class="tp-btn history-btn"
        :class="{ disabled: !history.canUndo }"
        :data-tip="undoTip"
        :disabled="!history.canUndo"
        @click="emit('undo')"
      >↶</button>
      <button
        class="tp-btn history-btn"
        :class="{ disabled: !history.canRedo }"
        :data-tip="redoTip"
        :disabled="!history.canRedo"
        @click="emit('redo')"
      >↷</button>

      <span class="divider"></span>

      <button class="tp-btn" data-tip="跳到开头 (Home)" @click="emit('jumpStart')">⏮</button>
      <button class="tp-btn" data-tip="上一帧 (←)" @click="emit('stepBackward')">‹</button>
      <button class="tp-btn play" data-tip="播放 (Space)" @click="emit('play')">▶</button>
      <button class="tp-btn" data-tip="下一帧 (→)" @click="emit('stepForward')">›</button>
      <button class="tp-btn" data-tip="跳到结尾 (End)" @click="emit('jumpEnd')">⏭</button>
    </div>

    <div class="topbar-right">
      <span class="chip"><strong>1920</strong> × <strong>1080</strong></span>
      <span class="chip"><strong>60</strong> FPS</span>
      <span class="chip">帧 <strong>{{ currentFrame }}</strong> / {{ totalFrames }}</span>
      <span class="chip">
        <span class="dot" :style="{ background: statusInfo.color }"></span>
        {{ statusInfo.label }}
      </span>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xl);
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.topbar-left { display: flex; align-items: center; gap: 12px; }
.brand {
  width: 32px; height: 32px;
  border-radius: 10px;
  background: var(--pf-ink);
  position: relative;
  flex-shrink: 0;
}
.brand::after {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 11px; height: 11px;
  border-radius: 3px;
  background: var(--pf-accent);
}
.title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.title sub { font-size: 10.5px; font-weight: 400; color: var(--pf-ink-muted); margin-left: 6px; }

.project-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
}
.pa-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  border-radius: var(--pf-r-xs);
  font: inherit;
  font-size: 12px;
  color: var(--pf-ink-soft);
  cursor: pointer;
  transition: all 160ms ease;
}
.pa-btn:hover {
  border-color: var(--pf-line-strong);
  color: var(--pf-ink);
}
.pa-btn.primary {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
}
.pa-btn.primary:hover {
  background: var(--pf-accent-deep);
  border-color: var(--pf-accent-deep);
}

.topbar-center {
  display: flex; align-items: center; gap: 4px;
  background: var(--pf-surface-soft);
  padding: 4px;
  border-radius: 999px;
}
.tp-btn {
  width: 32px; height: 32px;
  border: 0;
  background: transparent;
  border-radius: 999px;
  display: grid; place-items: center;
  color: var(--pf-ink-soft);
  font-size: 13px;
  cursor: pointer;
  transition: all 160ms ease;
}
.tp-btn:hover { background: var(--pf-surface); color: var(--pf-ink); }
.tp-btn.play {
  background: var(--pf-ink);
  color: var(--pf-paper);
  width: 36px; height: 36px;
  margin: 0 4px;
  font-size: 11px;
}
.tp-btn.play:hover { background: #2a2620; }

.tp-btn.history-btn { font-size: 16px; }
.tp-btn.history-btn.disabled,
.tp-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--pf-line-strong);
  margin: 0 6px;
  flex-shrink: 0;
}

.topbar-right { display: flex; align-items: center; gap: 8px; }
.chip {
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--pf-surface-soft);
  border: 1px solid var(--pf-line);
  font-size: 12px;
  font-weight: 500;
  color: var(--pf-ink-soft);
  display: inline-flex; align-items: center; gap: 6px;
  font-family: 'JetBrains Mono', monospace;
}
.chip strong { color: var(--pf-ink); font-weight: 600; }
.chip .dot { width: 6px; height: 6px; border-radius: 999px; }

[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%) scale(0.95);
  padding: 5px 10px;
  background: var(--pf-ink);
  color: var(--pf-paper);
  font-size: 11px;
  border-radius: 7px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) scale(1); }
</style>
