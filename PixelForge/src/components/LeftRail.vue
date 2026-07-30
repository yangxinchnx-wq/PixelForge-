<script setup lang="ts">
import type { LeftNavTab } from '../types';

defineProps<{
  activeTab: LeftNavTab;
}>();

const emit = defineEmits<{
  'update:activeTab': [tab: LeftNavTab];
  settingsClick: [];
}>();

const navItems: { tab: LeftNavTab; label: string; icon: string }[] = [
  { tab: 'input', label: '视频', icon: 'video' },
  { tab: 'image', label: '图片', icon: 'PhImage' },
  { tab: 'elements', label: '元素', icon: 'PhPuzzlePiece' },
  { tab: 'history', label: '历史', icon: 'PhBookBookmark' },
  { tab: 'render', label: '渲染', icon: 'export' },
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
      <!-- 自定义摄像机图标 -->
      <svg v-if="item.icon === 'video'" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9a1 1 0 0 1 1-1h3l1.5-2h3L13 8h7a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
        <circle cx="12" cy="13.5" r="3" />
        <circle cx="12" cy="13.5" r="1" fill="currentColor" stroke="none" opacity="0.35" />
        <circle cx="18" cy="11" r="0.7" fill="currentColor" stroke="none" />
      </svg>
      <!-- 自定义导出图标 -->
      <svg v-else-if="item.icon === 'export'" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v10" />
        <path d="M8 7l4-4 4 4" />
        <path d="M4 13v5a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" />
        <rect x="9" y="14" width="6" height="4" rx="1" fill="currentColor" stroke="none" opacity="0.25" />
      </svg>
      <component v-else :is="item.icon" :size="20" weight="duotone" />
    </button>

    <div class="pf-rail-spacer" />

    <button
      class="pf-rail-btn"
      :class="{ active: activeTab === 'performance' }"
      title="性能"
      @click="emit('update:activeTab', 'performance')"
    >
      <PhActivity :size="20" weight="duotone" />
    </button>

    <button class="pf-rail-btn" title="设置" @click="emit('settingsClick')">
      <PhGearSix :size="20" weight="duotone" />
    </button>
  </div>
</template>
