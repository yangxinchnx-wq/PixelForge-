<!--
  PixelForge Timeline UI — TrackLane（轨道通道）。

  Canvas 渲染区域，每条轨道一行。
  Clip 由 TimelineRenderer 绘制到 Canvas 上。
-->
<script setup lang="ts">
import type { Track } from '@/timeline/core/track'

const props = defineProps<{
  track: Track
  /** 轨道高度 */
  height: number
}>()
</script>

<template>
  <div
    class="track-lane"
    :class="{ disabled: !props.track.enabled }"
    :style="{ height: props.height + 'px' }"
  >
    <!-- Clip 由 Canvas 绘制，这里只做轨道背景容器 -->
  </div>
</template>

<style scoped>
.track-lane {
  background: #0d0d1a;
  border-bottom: 1px solid #1a1a2e;
  position: relative;
}

.track-lane.disabled {
  background: #08080f;
}
</style>
