<script setup lang="ts">
/**
 * AnimationKeyframe — 关键帧点(可拖动 + 右键删除)。
 *
 * 与 frame-based KeyframePoint.vue 区别:
 * - 基于 time(秒)
 * - 支持 linear / bezier / step 三种插值,颜色区分
 * - 拖动 → store.updateKeyframe(trackId, kfId, { time })
 * - 右键 → store.removeKeyframe(trackId, kfId)
 * - tooltip 显示 time + value + interpolation
 */
import { computed } from 'vue'

import type { Keyframe } from '@/animation/types'

interface Props {
  keyframe: Keyframe
  /** left 百分比(0-100,字符串) */
  left: string
  /** 是否选中(高亮) */
  selected?: boolean
  /** 是否正在拖动 */
  dragging?: boolean
  /** 轨道颜色(用于点边框) */
  color?: string
}

const props = withDefaults(defineProps<Props>(), {
  selected: false,
  dragging: false,
  color: '',
})

const emit = defineEmits<{
  mousedown: [event: MouseEvent]
  contextmenu: [event: MouseEvent]
}>()

const tooltip = computed(() => {
  const k = props.keyframe
  return `${k.time.toFixed(2)}s · ${k.value.toFixed(3)} · ${k.interpolation}`
})

const borderStyle = computed(() => {
  if (props.color) return `2px solid ${props.color}`
  return '2px solid var(--pf-accent)'
})

const shapeClass = computed(() => {
  // 不同插值用不同形状:linear=圆 / bezier=菱形 / step=方
  switch (props.keyframe.interpolation) {
    case 'bezier':
      return 'shape-bezier'
    case 'step':
      return 'shape-step'
    default:
      return 'shape-linear'
  }
})
</script>

<template>
  <div
    class="anim-kf"
    :class="[shapeClass, { selected, dragging }]"
    :style="{ left, border: borderStyle }"
    :data-tip="tooltip"
    @mousedown="emit('mousedown', $event)"
    @contextmenu.prevent="emit('contextmenu', $event)"
  ></div>
</template>

<style scoped>
.anim-kf {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--pf-surface);
  transform: translate(-50%, -50%);
  cursor: grab;
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 160ms ease,
              background 160ms ease;
  z-index: 4;
}
/* linear:圆形 */
.shape-linear {
  border-radius: 999px;
}
/* bezier:菱形(45°旋转的正方形) */
.shape-bezier {
  border-radius: 2px;
  transform: translate(-50%, -50%) rotate(45deg);
}
.shape-bezier:hover {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.25);
}
.shape-bezier.selected {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.15);
}
.shape-bezier.dragging {
  transform: translate(-50%, -50%) rotate(45deg) scale(1.3);
}
/* step:方形 */
.shape-step {
  border-radius: 2px;
}

.anim-kf:hover {
  transform: translate(-50%, -50%) scale(1.25);
  box-shadow: 0 2px 6px rgba(184, 92, 46, 0.4);
}
.anim-kf.selected {
  background: var(--pf-accent);
  transform: translate(-50%, -50%) scale(1.15);
  box-shadow: 0 2px 8px rgba(184, 92, 46, 0.5);
}
.anim-kf.dragging {
  cursor: grabbing;
  transform: translate(-50%, -50%) scale(1.3);
  box-shadow: 0 4px 12px rgba(184, 92, 46, 0.6);
}
.anim-kf:active {
  cursor: grabbing;
}

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
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  border-radius: 7px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}
</style>
