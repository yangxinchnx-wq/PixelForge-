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
  { tab: 'input', label: '视频', icon: 'PhPlayCircle' },
  { tab: 'scene', label: '场景', icon: 'PhBinoculars' },
  { tab: 'elements', label: '元素', icon: 'PhPuzzlePiece' },
  { tab: 'effects', label: '效果', icon: 'PhRainbow' },
  { tab: 'history', label: '历史', icon: 'PhBookBookmark' },
  { tab: 'render', label: '渲染', icon: 'PhProjectorScreen' },
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
      <component :is="item.icon" :size="20" weight="duotone" />
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
