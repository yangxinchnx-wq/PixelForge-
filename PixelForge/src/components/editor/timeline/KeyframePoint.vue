<script setup lang="ts">
import type { Keyframe } from '@/editor/timeline/types'

interface Props {
  keyframe: Keyframe
  /** left 百分比(如 '42.5%') */
  left: string
  /** top 百分比(如 '30%') */
  top: string
  /** 是否为当前帧最近的关键帧(高亮) */
  active?: boolean
  /** 是否正在拖动 */
  dragging?: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  mousedown: [event: MouseEvent]
  contextmenu: [event: MouseEvent]
}>()
</script>

<template>
  <div
    class="kf-point"
    :class="{ active, dragging }"
    :style="{ left, top }"
    :data-tip="`帧 ${keyframe.frame} · ${keyframe.value.toFixed(2)} · ${keyframe.easing}`"
    @mousedown="emit('mousedown', $event)"
    @contextmenu="emit('contextmenu', $event)"
  ></div>
</template>

<style scoped>
.kf-point {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: var(--pf-surface);
  border: 2px solid var(--pf-accent);
  transform: translate(-50%, -50%);
  cursor: grab;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
  z-index: 2;
}
.kf-point:hover {
  transform: translate(-50%, -50%) scale(1.25);
  box-shadow: 0 2px 6px rgba(184, 92, 46, 0.4);
}
.kf-point.active {
  background: var(--pf-accent);
  transform: translate(-50%, -50%) scale(1.15);
  box-shadow: 0 2px 8px rgba(184, 92, 46, 0.5);
}
.kf-point.dragging {
  cursor: grabbing;
  transform: translate(-50%, -50%) scale(1.3);
  box-shadow: 0 4px 12px rgba(184, 92, 46, 0.6);
}
.kf-point:active { cursor: grabbing; }

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
