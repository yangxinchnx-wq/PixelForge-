<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';

defineProps<{
  theme: string;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  toggleTheme: [];
}>();

// ─── 窗口控制（无边框窗口自定义标题栏按钮） ───
const appWindow = getCurrentWindow();

async function handleMinimize() {
  await appWindow.minimize();
}

async function handleToggleMaximize() {
  await appWindow.toggleMaximize();
}

async function handleClose() {
  await appWindow.close();
}
</script>

<template>
  <div class="toolbar" data-tauri-drag-region>
    <div class="toolbar-section">
      <span class="toolbar-title">PixelForge</span>
    </div>

    <div class="toolbar-spacer" />

    <div class="toolbar-section">
      <button
        class="theme-toggle"
        :data-tip="theme === 'dark' ? '浅色模式' : '深色模式'"
        @click="emit('toggleTheme')"
      >
        <PhSun v-if="theme === 'dark'" :size="16" weight="duotone" />
        <PhMoon v-else :size="16" weight="duotone" />
      </button>

      <!-- 窗口控制按钮：最小化 / 最大化 / 关闭 -->
      <div class="window-controls">
        <button class="wc-btn" @click="handleMinimize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
        <button class="wc-btn" @click="handleToggleMaximize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke="currentColor" stroke-width="1.5" rx="1.5" />
          </svg>
        </button>
        <button class="wc-btn wc-close" @click="handleClose">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 0L10 10M10 0L0 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  height: var(--toolbar-height);
  display: flex;
  align-items: center;
  padding: 0 16px;
  /* 使用主题玻璃背景色，与全局 .toolbar 一致 */
  background: var(--glass-bg);
  border-top: none;
  border-bottom: 1px solid var(--separator);
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
  color: var(--text-primary);
}

.toolbar-spacer {
  flex: 1;
}

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--separator-strong);
  background: transparent;
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 160ms ease;
}

.theme-toggle:hover {
  border-color: var(--text-quaternary);
  color: var(--text-primary);
  background: var(--glass-bg-hover);
}

/* ─── 窗口控制按钮 ─── */
.window-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
}

.wc-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: 8px;
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 160ms ease;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.wc-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.wc-btn.wc-close:hover {
  background: #e85555;
  color: #fff;
}

/* ─── 自定义 tooltip（替代原生 title 属性，避免系统默认浅白色提示框） ─── */
[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%) scale(0.95);
  padding: 5px 10px;
  background: var(--text-primary);
  color: var(--base-bg);
  font-size: 11px;
  border-radius: 7px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) scale(1); }
</style>
