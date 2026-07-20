<script setup lang="ts">
/**
 * AnimationPlayhead — 播放头(竖线 + 顶部 handle)。
 *
 * 设计:
 * - 读取 store.currentTime / duration 计算位置
 * - handle 可拖动 → store.seek(time)
 * - 60ms 线性过渡(避免高帧率播放时的抖动)
 * - 显示当前时间浮标(handle 上方)
 */
import { computed, ref } from 'vue'

import { useAnimationStore } from '@/animation/timeline'

const store = useAnimationStore()

const handleRef = ref<HTMLElement | null>(null)

const leftPercent = computed(() => {
  if (store.duration <= 0) return 0
  return Math.max(0, Math.min(100, (store.currentTime / store.duration) * 100))
})

const timeLabel = computed(() => {
  const t = store.currentTime
  if (t < 1) return t.toFixed(2) + 's'
  if (t < 10) return t.toFixed(2) + 's'
  return t.toFixed(1) + 's'
})

/** handle 拖动:从鼠标 x 计算时间 */
function onHandleMouseDown(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()

  const onMove = (e: MouseEvent) => {
    if (!handleRef.value) return
    // 取父容器(整个 Playhead 容器)的 rect
    const parent = handleRef.value.parentElement?.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const time = (x / rect.width) * store.duration
    store.seek(time)
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<template>
  <div
    class="anim-playhead"
    :style="{ left: leftPercent + '%' }"
  >
    <div class="playhead-line"></div>
    <div
      ref="handleRef"
      class="playhead-handle"
      @mousedown="onHandleMouseDown"
    >
      <span class="playhead-time">{{ timeLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.anim-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 10;
  transition: left 60ms linear;
}
.playhead-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  background: var(--pf-accent);
  transform: translateX(-50%);
  box-shadow: 0 0 4px rgba(184, 92, 46, 0.4);
}
.playhead-handle {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 14px;
  height: 14px;
  background: var(--pf-accent);
  border: 2px solid var(--pf-surface);
  border-radius: 999px;
  transform: translateX(-50%);
  cursor: ew-resize;
  pointer-events: auto;
  box-shadow: 0 2px 6px rgba(184, 92, 46, 0.5);
  transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 160ms ease;
}
.playhead-handle:hover {
  transform: translateX(-50%) scale(1.15);
  box-shadow: 0 4px 10px rgba(184, 92, 46, 0.6);
}
.playhead-handle:active {
  transform: translateX(-50%) scale(1.05);
}
.playhead-time {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 8px;
  background: var(--pf-accent);
  color: #fff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  border-radius: 6px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
}
.playhead-handle:hover .playhead-time {
  opacity: 1;
}
</style>
