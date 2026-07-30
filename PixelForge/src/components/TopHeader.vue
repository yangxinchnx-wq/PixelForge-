<script setup lang="ts">
defineProps<{
  theme: string;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  toggleTheme: [];
}>();
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-section">
      <span class="toolbar-title">PixelForge</span>
    </div>

    <div class="toolbar-spacer" />

    <div class="toolbar-section">
      <button
        class="theme-toggle"
        :title="theme === 'dark' ? '浅色模式' : '深色模式'"
        @click="emit('toggleTheme')"
      >
        <PhSun v-if="theme === 'dark'" :size="16" weight="duotone" />
        <PhMoon v-else :size="16" weight="duotone" />
      </button>
    </div>
  </div>
</template>
