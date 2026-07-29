<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { modalEnter, modalLeave } from '../composables/useAnime';

const props = defineProps<{
  isOpen: boolean;
  resolution: string;
  frameRate: string;
  duration: number;
}>();

const emit = defineEmits<{
  close: [];
}>();

// 内部可见状态:支持离开动画
const internalVisible = ref(false);
const overlayRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      // 进入:先挂载 DOM,下一帧播放进入动画
      internalVisible.value = true;
      await nextTick();
      if (overlayRef.value && modalRef.value) {
        modalEnter(overlayRef.value, modalRef.value);
      }
    } else if (internalVisible.value) {
      // 离开:播放离开动画后再卸载 DOM
      if (overlayRef.value && modalRef.value) {
        await modalLeave(overlayRef.value, modalRef.value);
      }
      internalVisible.value = false;
    }
  },
);
</script>

<template>
  <div v-if="internalVisible" ref="overlayRef" class="pf-modal-overlay" @click="emit('close')">
    <div ref="modalRef" class="pf-modal" @click.stop>
      <div class="pf-modal-header">
        <span class="pf-modal-title">导出</span>
        <button class="btn btn-icon" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="pf-modal-body">
        <div class="pf-panel-section">
          <div class="pf-panel-label">分辨率</div>
          <span style="font-size: 13px; color: var(--text-primary)">{{ resolution }}</span>
        </div>
        <div class="pf-panel-section">
          <div class="pf-panel-label">帧率</div>
          <span style="font-size: 13px; color: var(--text-primary)">{{ frameRate }}</span>
        </div>
        <div class="pf-panel-section">
          <div class="pf-panel-label">时长</div>
          <span style="font-size: 13px; color: var(--text-primary)">{{ duration.toFixed(1) }} 秒</span>
        </div>
      </div>
      <div class="pf-modal-footer">
        <button class="btn-primary" @click="emit('close')">导出</button>
      </div>
    </div>
  </div>
</template>
