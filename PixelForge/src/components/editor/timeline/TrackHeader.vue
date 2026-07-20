<script setup lang="ts">
import type { ParameterTrack } from '@/editor/timeline/types'

interface Props {
  track: ParameterTrack
  /** 当前帧上的求值结果(由父组件计算后传入,避免子组件重复求值) */
  currentValue: number
}

defineProps<Props>()

const emit = defineEmits<{
  add: []
  reset: []
}>()
</script>

<template>
  <div class="track-header">
    <div class="track-label">
      <span class="label-zh">{{ track.label }}</span>
      <span class="label-en">{{ track.layerId }}.{{ track.parameter }}</span>
    </div>
    <div class="track-value">{{ currentValue.toFixed(2) }}</div>
    <div class="track-actions">
      <button class="th-btn" data-tip="在当前帧添加关键点" @click="emit('add')">+</button>
      <button class="th-btn" data-tip="重置曲线" @click="emit('reset')">↺</button>
    </div>
  </div>
</template>

<style scoped>
.track-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 14px;
  flex-shrink: 0;
}
.track-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.label-zh {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--pf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.label-en {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.track-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-accent);
  text-align: right;
  min-width: 44px;
  flex-shrink: 0;
}
.track-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.th-btn {
  width: 26px;
  height: 26px;
  border: 0;
  background: transparent;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--pf-ink-muted);
  font-size: 13px;
  cursor: pointer;
  transition: all 160ms ease;
}
.th-btn:hover { background: var(--pf-surface); color: var(--pf-accent); }

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
