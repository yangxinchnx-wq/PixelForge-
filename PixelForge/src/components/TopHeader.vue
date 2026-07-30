<script setup lang="ts">
defineProps<{
  theme: string;
  isGenerating: boolean;
  showTimeline: boolean;
}>();

const emit = defineEmits<{
  toggleTheme: [];
  toggleTimeline: [];
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
        class="toolbar-btn"
        :class="{ active: showTimeline }"
        :title="showTimeline ? '隐藏时间轴' : '显示时间轴'"
        @click="emit('toggleTimeline')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
          <line x1="7" y1="6" x2="7" y2="18" />
          <line x1="12" y1="6" x2="12" y2="18" />
          <line x1="17" y1="6" x2="17" y2="18" />
        </svg>
        <span class="toolbar-btn-label">时间轴</span>
      </button>

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

<style scoped>
.toolbar {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: var(--surface, #1a1a1a);
  border-bottom: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
  gap: 8px;
}

.toolbar-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary, #fff);
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--separator-strong, #3a3a3a);
  background: transparent;
  border-radius: 8px;
  color: var(--text-secondary, #aaa);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 160ms ease;
}

.toolbar-btn:hover {
  border-color: var(--text-quaternary, #555);
  color: var(--text-primary, #fff);
  background: var(--surface-hover, #252525);
}

.toolbar-btn.active {
  border-color: var(--accent, #4a9eff);
  color: var(--accent, #4a9eff);
  background: color-mix(in srgb, var(--accent, #4a9eff) 12%, transparent);
}

.toolbar-btn-label {
  white-space: nowrap;
}

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--separator-strong, #3a3a3a);
  background: transparent;
  border-radius: 8px;
  color: var(--text-secondary, #aaa);
  cursor: pointer;
  transition: all 160ms ease;
}

.theme-toggle:hover {
  border-color: var(--text-quaternary, #555);
  color: var(--text-primary, #fff);
  background: var(--surface-hover, #252525);
}
</style>
