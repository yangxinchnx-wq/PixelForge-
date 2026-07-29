<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { modalEnter, modalLeave } from '../composables/useAnime';

const props = defineProps<{
  isOpen: boolean;
  theme: string;
  autoSaveEnabled: boolean;
  lastSavedTime: string | null;
}>();

const emit = defineEmits<{
  close: [];
  selectTheme: [theme: 'light' | 'dark'];
  toggleAutoSave: [enabled: boolean];
  forceSave: [];
  resetProject: [];
}>();

// 内部可见状态:支持离开动画
const internalVisible = ref(false);
const overlayRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      internalVisible.value = true;
      await nextTick();
      if (overlayRef.value && modalRef.value) {
        modalEnter(overlayRef.value, modalRef.value);
      }
    } else if (internalVisible.value) {
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
        <span class="pf-modal-title">设置</span>
        <button class="btn btn-icon" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="pf-modal-body">
        <div class="pf-panel-section">
          <div class="pf-panel-label">主题</div>
          <div class="pf-seg">
            <button
              class="pf-seg-btn"
              :class="{ active: theme === 'light' }"
              @click="emit('selectTheme', 'light')"
            >
              浅色
            </button>
            <button
              class="pf-seg-btn"
              :class="{ active: theme === 'dark' }"
              @click="emit('selectTheme', 'dark')"
            >
              深色
            </button>
          </div>
        </div>
        <div class="pf-panel-section">
          <div class="pf-panel-label">自动保存</div>
          <div class="pf-seg">
            <button
              class="pf-seg-btn"
              :class="{ active: autoSaveEnabled }"
              @click="emit('toggleAutoSave', true)"
            >
              开启
            </button>
            <button
              class="pf-seg-btn"
              :class="{ active: !autoSaveEnabled }"
              @click="emit('toggleAutoSave', false)"
            >
              关闭
            </button>
          </div>
        </div>
        <div v-if="lastSavedTime" class="pf-panel-section">
          <div class="pf-panel-label">上次保存</div>
          <span style="font-size: 13px; color: var(--text-primary)">{{ lastSavedTime }}</span>
        </div>
      </div>
      <div class="pf-modal-footer">
        <button
          class="btn btn-icon"
          title="重置项目"
          style="margin-right: auto; font-size: 12px"
          @click="emit('resetProject')"
        >
          重置项目
        </button>
        <button class="btn-primary" @click="emit('forceSave')">立即保存</button>
      </div>
    </div>
  </div>
</template>
