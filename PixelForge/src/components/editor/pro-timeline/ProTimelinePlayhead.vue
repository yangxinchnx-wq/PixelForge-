<script setup lang="ts">
/**
 * ProTimelinePlayhead(Step 31.2)— 播放头覆盖层。
 *
 * 设计:
 * - 绝对定位在轨道容器之上
 * - 通过 layout.timeToViewportX 定位
 * - 支持拖拽 seek(头部手柄 + 垂直线)
 * - 当前时间显示在头部
 */
import { computed, ref } from 'vue'

import type { Time } from '@/editor/timeline/core/time'
import { timeToFrame, formatTimecode } from '@/editor/timeline/core/time'
import type { ProTimelineLayout } from './useProTimelineLayout'

interface Props {
  layout: ProTimelineLayout
  currentTime: Time
  duration: Time
  fps: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  seek: [time: Time]
}>()

const headRef = ref<HTMLElement | null>(null)

const viewportX = computed(() => props.layout.timeToViewportX(props.currentTime))

const timecode = computed(() => formatTimecode(props.currentTime, props.fps))

const frame = computed(() => timeToFrame(props.currentTime, props.fps))

function seekFromClientX(clientX: number) {
  if (!headRef.value) return
  // 用父容器(getBoundingClientRect 的 parent)的 left
  const parent = headRef.value.parentElement
  if (!parent) return
  const rect = parent.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
  const t = props.layout.viewportXToTime(x)
  // 吸附到最近帧
  const f = timeToFrame(t, props.fps)
  const snapped: Time = (BigInt(f) * 1_000_000n) / BigInt(props.fps)
  emit('seek', snapped)
}

function onHeadMouseDown(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  seekFromClientX(event.clientX)
  const onMove = (e: MouseEvent) => seekFromClientX(e.clientX)
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
    class="pro-playhead"
    :style="{ left: viewportX + 'px' }"
  >
    <div
      ref="headRef"
      class="playhead-head"
      @mousedown="onHeadMouseDown"
    >
      <span class="playhead-time">{{ timecode }}</span>
      <span class="playhead-frame">F{{ frame }}</span>
    </div>
    <div class="playhead-line"></div>
  </div>
</template>

<style scoped>
.pro-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  pointer-events: none;
  z-index: 10;
  transition: left 60ms linear;
}
.playhead-head {
  position: absolute;
  top: -2px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 8px;
  background: var(--pf-accent);
  color: #fff;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  font-weight: 500;
  cursor: ew-resize;
  pointer-events: auto;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(184, 92, 46, 0.3);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.playhead-head:hover {
  transform: translateX(-50%) scale(1.04);
}
.playhead-time {
  letter-spacing: 0.02em;
}
.playhead-frame {
  font-size: 9.5px;
  opacity: 0.85;
}
.playhead-line {
  position: absolute;
  top: 22px;
  bottom: 0;
  left: 50%;
  width: 1.5px;
  background: var(--pf-accent);
  transform: translateX(-50%);
  pointer-events: none;
}
</style>
