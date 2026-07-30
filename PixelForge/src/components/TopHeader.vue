<script setup lang="ts">
defineProps<{
  theme: string;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  exportClick: [];
  settingsClick: [];
  toggleTheme: [];
  generate: [];
}>();
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-section">
      <span class="toolbar-title">PixelForge</span>
    </div>

    <div class="toolbar-spacer" />

    <div class="toolbar-section">
      <button class="btn-primary" :disabled="isGenerating" @click="emit('generate')">
        <PhWand :size="14" weight="fill" />
        {{ isGenerating ? '生成中…' : '生成' }}
      </button>
      <button class="btn btn-icon" title="导出" @click="emit('exportClick')">
        <PhUploadSimple :size="16" weight="duotone" />
      </button>
      <button class="btn btn-icon" title="设置" @click="emit('settingsClick')">
        <PhGearSix :size="16" weight="duotone" />
      </button>
      <div class="toolbar-divider" />
      <button
        class="theme-toggle"
        :title="theme === 'dark' ? '浅色模式' : '深色模式'"
        @click="emit('toggleTheme')"
      >
        <PhCloud v-if="theme === 'dark'" :size="16" weight="duotone" />
        <PhStars v-else :size="16" weight="duotone" />
      </button>
    </div>
  </div>
</template>
