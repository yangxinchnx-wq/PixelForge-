<script setup lang="ts">
import type { LeftNavTab } from '../types';

defineProps<{
  activeTab: LeftNavTab;
}>();

const emit = defineEmits<{
  'update:activeTab': [tab: LeftNavTab];
  settingsClick: [];
}>();

const navItems: { tab: LeftNavTab; label: string }[] = [
  { tab: 'input', label: '输入' },
  { tab: 'scene', label: '场景' },
  { tab: 'elements', label: '元素' },
  { tab: 'effects', label: '效果' },
  { tab: 'history', label: '历史' },
  { tab: 'render', label: '渲染' },
];
</script>

<template>
  <div class="pf-rail">
    <button
      v-for="item in navItems"
      :key="item.tab"
      class="pf-rail-btn"
      :class="{ active: activeTab === item.tab }"
      :title="item.label"
      @click="emit('update:activeTab', item.tab)"
    >
      <!-- Input Icon -->
      <svg v-if="item.tab === 'input'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
      <!-- Scene Icon -->
      <svg v-else-if="item.tab === 'scene'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
      </svg>
      <!-- Elements Icon -->
      <svg v-else-if="item.tab === 'elements'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
      <!-- Effects Icon -->
      <svg v-else-if="item.tab === 'effects'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <path d="M15 4V2" />
        <path d="M15 16v-2" />
        <path d="M8 9h2" />
        <path d="M20 9h2" />
        <path d="M17.8 11.8L19 13" />
        <path d="M17.8 6.2L19 5" />
        <path d="M3 21l9-9" />
        <path d="M12.2 6.2L11 5" />
      </svg>
      <!-- History Icon -->
      <svg v-else-if="item.tab === 'history'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <!-- Render Icon -->
      <svg v-else-if="item.tab === 'render'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
    </button>

    <div class="pf-rail-spacer" />

    <button
      class="pf-rail-btn"
      :class="{ active: activeTab === 'performance' }"
      title="性能"
      @click="emit('update:activeTab', 'performance')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    </button>

    <button class="pf-rail-btn" title="设置" @click="emit('settingsClick')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
  </div>
</template>
