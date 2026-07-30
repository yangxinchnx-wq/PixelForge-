<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { modalEnter, modalLeave } from '../composables/useAnime';
import { unifiedStore, type UnifiedStoreStats } from '../storage';
import { tauriDb } from '../storage';

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
      void refreshStorageInfo();
    } else if (internalVisible.value) {
      if (overlayRef.value && modalRef.value) {
        await modalLeave(overlayRef.value, modalRef.value);
      }
      internalVisible.value = false;
    }
  },
);

// ─── 存储信息 ───────────────────────────────────────────
const storageStats = ref<UnifiedStoreStats | null>(null);
const storagePath = ref<string | null>(null);
const isClearing = ref(false);
const clearResult = ref<string | null>(null);

async function refreshStorageInfo() {
  try {
    const [stats, path] = await Promise.all([
      unifiedStore.stats(),
      tauriDb.getDbPath(),
    ]);
    storageStats.value = stats;
    storagePath.value = path;
  } catch (e) {
    console.warn('[Settings] 存储信息加载失败', e);
  }
}

async function handleClearStorage() {
  if (!confirm('确定清空所有存储数据？此操作不可恢复。')) return;
  isClearing.value = true;
  clearResult.value = null;
  try {
    await unifiedStore.clearAll();
    clearResult.value = '已清空';
    await refreshStorageInfo();
  } catch (e) {
    clearResult.value = '清理失败';
    console.error(e);
  } finally {
    isClearing.value = false;
    setTimeout(() => { clearResult.value = null; }, 2000);
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
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

        <!-- 存储信息 -->
        <div class="pf-panel-section">
          <div class="pf-panel-label">存储系统</div>
          <div v-if="storageStats" style="font-size: 12px; display: flex; flex-direction: column; gap: 4px">
            <div>L1 帧缓存：{{ storageStats.frameMemory.entries }} 条 / {{ formatBytes(storageStats.frameMemory.bytes) }}（命中率 {{ (storageStats.frameMemory.hitRate * 100).toFixed(0) }}%）</div>
            <div>L1 文本缓存：{{ storageStats.textMemory.entries }} 条 / {{ formatBytes(storageStats.textMemory.bytes) }}（命中率 {{ (storageStats.textMemory.hitRate * 100).toFixed(0) }}%）</div>
            <div>L2 OPFS：<span :style="{ color: storageStats.opfsAvailable ? '#22c55e' : '#ef4444' }">{{ storageStats.opfsAvailable ? '可用' : '不可用' }}</span></div>
            <div>L3 数据库：<span style="word-break: break-all">{{ storagePath || '浏览器未启用' }}</span></div>
          </div>
          <div style="margin-top: 8px; display: flex; gap: 8px; align-items: center">
            <button
              class="btn btn-icon"
              style="font-size: 12px; padding: 4px 10px"
              :disabled="isClearing"
              @click="handleClearStorage"
            >
              {{ isClearing ? '清理中…' : '清空存储' }}
            </button>
            <span v-if="clearResult" style="font-size: 12px; color: var(--text-secondary)">{{ clearResult }}</span>
          </div>
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
