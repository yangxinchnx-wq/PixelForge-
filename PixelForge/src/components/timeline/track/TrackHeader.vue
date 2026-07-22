<!--
  PixelForge Timeline UI — TrackHeader（轨道头部）。

  左侧面板：
    V1  🔒  👁
    V2  🔒  👁
    A1  🔒  👁

  功能：Mute / Lock / Hide
-->
<script setup lang="ts">
import type { Track } from '@/timeline/core/track'

const props = defineProps<{
  track: Track
}>()

const emit = defineEmits<{
  toggleEnabled: [trackId: string]
  toggleLocked: [trackId: string]
}>()

const typeIcon: Record<string, string> = {
  video: 'V',
  audio: 'A',
  text: 'T',
  effect: 'E',
}
</script>

<template>
  <div class="track-header" :class="{ disabled: !props.track.enabled, locked: props.track.locked }">
    <span class="track-type-icon">{{ typeIcon[props.track.type] }}</span>
    <span class="track-name">{{ props.track.name }}</span>
    <button
      class="track-btn"
      :class="{ active: !props.track.enabled }"
      title="显示/隐藏"
      @click="emit('toggleEnabled', props.track.id)"
    >
      {{ props.track.enabled ? '👁' : '🚫' }}
    </button>
    <button
      class="track-btn"
      :class="{ active: props.track.locked }"
      title="锁定/解锁"
      @click="emit('toggleLocked', props.track.id)"
    >
      {{ props.track.locked ? '🔒' : '🔓' }}
    </button>
  </div>
</template>

<style scoped>
.track-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 40px;
  background: #1a1a2e;
  border-bottom: 1px solid #2a2a3e;
  border-right: 1px solid #2a2a3e;
  font-size: 12px;
  color: #e5e7eb;
}

.track-header.disabled {
  opacity: 0.5;
}

.track-header.locked {
  background: #2a1a1a;
}

.track-type-icon {
  font-weight: bold;
  width: 16px;
  text-align: center;
  color: #818cf8;
}

.track-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
  border-radius: 3px;
}

.track-btn:hover {
  background: #2a2a3e;
}
</style>
