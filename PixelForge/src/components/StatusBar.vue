<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  saveStatus: 'saved' | 'saving' | 'unsaved';
  lastSavedTime: string | null;
  resolution: string;
  frameRate: string;
}>();

const statusText = computed(() => {
  if (props.saveStatus === 'saved') return '已保存';
  if (props.saveStatus === 'saving') return '保存中…';
  return '未保存';
});
</script>

<template>
  <div class="statusbar glass-surface">
    <div class="statusbar-item">
      <div class="statusbar-dot" :class="saveStatus" />
      <span>{{ statusText }}</span>
    </div>
    <div v-if="lastSavedTime" class="statusbar-item">
      <span>{{ lastSavedTime }}</span>
    </div>
    <div class="statusbar-spacer" />
    <div class="statusbar-item">
      <span>{{ resolution }}</span>
    </div>
    <div class="statusbar-item">
      <span>{{ frameRate }}</span>
    </div>
  </div>
</template>
