<script setup lang="ts">
defineProps<{
  activeTab: 'creation' | 'timeline' | 'preview';
  canUndo: boolean;
  canRedo: boolean;
  theme: string;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  'update:activeTab': [tab: 'creation' | 'timeline' | 'preview'];
  exportClick: [];
  settingsClick: [];
  undo: [];
  redo: [];
  toggleTheme: [];
  generate: [];
}>();
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-section">
      <span class="toolbar-title">PixelForge</span>
    </div>

    <div class="toolbar-divider" />

    <div class="pf-seg">
      <button
        class="pf-seg-btn"
        :class="{ active: activeTab === 'creation' }"
        @click="emit('update:activeTab', 'creation')"
      >
        创作
      </button>
      <button
        class="pf-seg-btn"
        :class="{ active: activeTab === 'timeline' }"
        @click="emit('update:activeTab', 'timeline')"
      >
        时间轴
      </button>
      <button
        class="pf-seg-btn"
        :class="{ active: activeTab === 'preview' }"
        @click="emit('update:activeTab', 'preview')"
      >
        预览
      </button>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-section">
      <button
        class="btn btn-icon"
        :disabled="!canUndo"
        title="撤销 (Ctrl+Z)"
        :style="{ opacity: canUndo ? 1 : 0.3, cursor: canUndo ? 'pointer' : 'not-allowed' }"
        @click="emit('undo')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M3 7v6h6" />
          <path d="M3 13a9 9 0 1 0 3-7.7L3 8" />
        </svg>
      </button>
      <button
        class="btn btn-icon"
        :disabled="!canRedo"
        title="重做 (Ctrl+Shift+Z)"
        :style="{ opacity: canRedo ? 1 : 0.3, cursor: canRedo ? 'pointer' : 'not-allowed' }"
        @click="emit('redo')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M21 7v6h-6" />
          <path d="M21 13a9 9 0 1 1-3-7.7L21 8" />
        </svg>
      </button>
    </div>

    <div class="toolbar-spacer" />

    <div class="toolbar-section">
      <button class="btn-primary" :disabled="isGenerating" @click="emit('generate')">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
          <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
        </svg>
        {{ isGenerating ? '生成中…' : '生成' }}
      </button>
      <button class="btn btn-icon" title="导出" @click="emit('exportClick')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      <button class="btn btn-icon" title="设置" @click="emit('settingsClick')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <div class="toolbar-divider" />
      <button
        class="theme-toggle"
        :title="theme === 'dark' ? '浅色模式' : '深色模式'"
        @click="emit('toggleTheme')"
      >
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </button>
    </div>
  </div>
</template>
