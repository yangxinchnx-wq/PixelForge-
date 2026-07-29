<script setup lang="ts">
import { computed } from 'vue';
import { formatTimecode, FPS } from '../data';

const props = defineProps<{
  currentTime: number;
  duration: number;
  isPlaying: boolean;
}>();

const emit = defineEmits<{
  togglePlay: [];
  stepForward: [];
  stepBackward: [];
  reset: [];
}>();

const totalFrames = computed(() => Math.round(props.duration * FPS));
const currentFrame = computed(() => Math.min(totalFrames.value - 1, Math.floor(props.currentTime * FPS)));
const tc = computed(() => formatTimecode(props.currentTime, FPS));
</script>

<template>
  <div class="pf-panel pf-panel-center">
    <!-- Canvas Area -->
    <div class="pf-canvas-area">
      <div class="pf-canvas-frame-badge">
        帧 {{ currentFrame }} / {{ totalFrames }}
      </div>
      <div class="pf-canvas-placeholder">
        预览区域
      </div>
    </div>

    <!-- Canvas Toolbar -->
    <div class="pf-canvas-toolbar">
      <button class="btn btn-icon" title="上一帧" @click="emit('stepBackward')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
        </svg>
      </button>
      <button class="btn btn-primary" :title="isPlaying ? '暂停' : '播放'" @click="emit('togglePlay')">
        <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <button class="btn btn-icon" title="下一帧" @click="emit('stepForward')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path d="M4 18l8.5-6L4 6v12zm9.5-12v12l8.5-6-8.5-6z" />
        </svg>
      </button>
      <button class="btn btn-icon" title="重置" @click="emit('reset')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>

      <div class="pf-canvas-toolbar-spacer" />

      <div class="time-display">
        <span>{{ tc.mm }}</span>
        <span class="time-separator">:</span>
        <span>{{ tc.ss }}</span>
        <span class="time-separator">:</span>
        <span class="time-frame">{{ tc.ff }}</span>
      </div>
    </div>
  </div>
</template>
