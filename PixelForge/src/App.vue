<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from './stores/app';
import TopHeader from './components/TopHeader.vue';
import LeftRail from './components/LeftRail.vue';
import ControlPanel from './components/ControlPanel.vue';
import CanvasViewport from './components/CanvasViewport.vue';
import IRPreviewPanel from './components/IRPreviewPanel.vue';
import TimelinePanel from './components/TimelinePanel.vue';
import StatusBar from './components/StatusBar.vue';
import AmbientFluidCanvas from './components/AmbientFluidCanvas.vue';
import ExportModal from './components/ExportModal.vue';
import SettingsModal from './components/SettingsModal.vue';
import { pageEnter } from './composables/useAnime';
import { TOTAL_DURATION } from './data';
import { unifiedStore, type UnifiedStoreStats } from './storage';

const store = useAppStore();
const {
  activeLeftTab,
  livePromptText,
  activeSnapshot,
  resolution,
  frameRate,
  treeData,
  currentTime,
  isPlaying,
  isExportOpen,
  isSettingsOpen,
  theme,
  isGenerating,
  autoSaveEnabled,
  saveStatus,
  lastSavedTime,
  history,
  currentIndex,
  canUndo,
  canRedo,
} = storeToRefs(store);

// ─── Theme application ────────────────────────────────
watch(theme, (val) => {
  document.documentElement.dataset.theme = val;
}, { immediate: true });

// ─── Playback ─────────────────────────────────────────
watch(isPlaying, (playing) => {
  if (playing) {
    store.startPlayback();
  } else {
    store.stopPlayback();
  }
});

// ─── Keyboard (undo/redo) ─────────────────────────────
function handleKeyDown(e: KeyboardEvent) {
  const activeTag = document.activeElement?.tagName;
  const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) {
      if (canRedo.value) {
        e.preventDefault();
        store.redo();
      }
    } else {
      if (canUndo.value && !isEditingText) {
        e.preventDefault();
        store.undo();
      }
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    if (canRedo.value) {
      e.preventDefault();
      store.redo();
    }
  }
}

onMounted(() => {
  document.documentElement.dataset.theme = theme.value;
  window.addEventListener('keydown', handleKeyDown);
  // 初始化完成后从三层统一存储异步加载项目快照（覆盖 localStorage 同步加载结果）
  void store.loadFromUnifiedStore();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  store.stopPlayback();
});

// ─── Autosave ─────────────────────────────────────────
watch(
  [livePromptText, () => activeSnapshot.value.elements, () => activeSnapshot.value.tuningParams, treeData, resolution, frameRate, theme, autoSaveEnabled],
  () => {
    store.triggerAutosave();
  }
);

// ─── Page content ─────────────────────────────────────
const slidersConfig = [
  { key: 'starDensity' as const, label: '星空密度', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
  { key: 'brightness' as const, label: '亮度', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
  { key: 'hue' as const, label: '色相', min: 0, max: 360, step: 1, fmt: (v: number) => `${Math.round(v)}°` },
  { key: 'contrast' as const, label: '对比度', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
];

function onSliderChange(key: string, event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value);
  store.setTuningParams((prev) => ({ ...prev, [key]: value }));
}

function goBackToInput() {
  activeLeftTab.value = 'input';
}

// ─── 页面切换动画 (anime.js v4) ────────────────────────
// 监听左侧 Tab 切换,内容区淡入 + 上浮,iOS 风格平滑过渡
const contentRef = ref<HTMLElement | null>(null);
watch(activeLeftTab, async () => {
  await nextTick();
  if (contentRef.value) {
    pageEnter(contentRef.value);
  }
});

// ─── Prompt 历史（从数据库加载）────────────────────────
const promptHistory = ref<Array<{ timestampMs: number; text: string }>>([]);

async function refreshPromptHistory() {
  promptHistory.value = await store.loadPromptHistory();
}

function formatPromptTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function truncateText(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function applyPromptFromHistory(text: string) {
  store.handlePromptTextChange(text);
}

// ─── 存储统计（性能页 / 设置弹窗用）────────────────────
const storageStats = ref<UnifiedStoreStats | null>(null);
const storagePath = ref<string | null>(null);
const isStorageLoading = ref(false);

async function refreshStorageStats() {
  isStorageLoading.value = true;
  try {
    const [stats, path] = await Promise.all([
      unifiedStore.stats(),
      import('./storage').then((m) => m.tauriDb.getDbPath()),
    ]);
    storageStats.value = stats;
    storagePath.value = path;
  } catch (e) {
    console.warn('[App] 存储统计加载失败', e);
  } finally {
    isStorageLoading.value = false;
  }
}

// 切换到历史/性能页时自动加载数据
watch(activeLeftTab, (tab) => {
  if (tab === 'history') void refreshPromptHistory();
  if (tab === 'performance') void refreshStorageStats();
});
</script>

<template>
  <div class="pf-app">
    <AmbientFluidCanvas />

    <TopHeader
      :theme="theme"
      :is-generating="isGenerating"
      @export-click="isExportOpen = true"
      @settings-click="isSettingsOpen = true"
      @toggle-theme="store.toggleTheme"
      @generate="store.handleGenerate"
    />

    <div class="pf-main">
      <LeftRail
        :active-tab="activeLeftTab"
        @update:active-tab="activeLeftTab = $event"
        @settings-click="isSettingsOpen = true"
      />

      <div class="pf-content" ref="contentRef">
        <!-- Main Workspace -->
        <div v-if="activeLeftTab === 'input'" class="pf-workspace">
          <div class="pf-workspace-top">
            <ControlPanel
              :prompt-text="livePromptText"
              :elements="activeSnapshot.elements"
              :tuning-params="activeSnapshot.tuningParams"
              :is-generating="isGenerating"
              @update:prompt-text="store.handlePromptTextChange"
              @toggle-element="store.toggleElement"
              @update:tuning-params="(updater) => store.setTuningParams(updater)"
              @generate="store.handleGenerate"
            />
            <CanvasViewport
              :current-time="currentTime"
              :duration="TOTAL_DURATION"
              :is-playing="isPlaying"
              @toggle-play="store.togglePlay"
              @step-forward="store.stepForward"
              @step-backward="store.stepBackward"
              @reset="store.resetTime"
            />
            <div style="width: var(--panel-right-width); flex-shrink: 0; min-height: 0">
              <IRPreviewPanel
                :tree-data="treeData"
                @toggle-visibility="store.toggleIRVisibility"
              />
            </div>
          </div>
          <TimelinePanel
            :current-time="currentTime"
            :is-playing="isPlaying"
            @seek="store.seek"
            @toggle-play="store.togglePlay"
          />
        </div>

        <!-- Scene Page -->
        <div v-else-if="activeLeftTab === 'scene'" class="pf-page">
          <div class="pf-page-header">
            <button class="btn btn-icon" title="返回" @click="goBackToInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span class="pf-page-title">场景</span>
          </div>
          <div class="pf-page-body" style="display: flex">
            <div class="pf-panel" style="flex: 1; min-height: 0">
              <div class="pf-panel-header">
                <span class="pf-panel-title">场景图</span>
              </div>
              <div class="pf-panel-body">
                <IRPreviewPanel
                  :tree-data="treeData"
                  @toggle-visibility="store.toggleIRVisibility"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Elements Page -->
        <div v-else-if="activeLeftTab === 'elements'" class="pf-page">
          <div class="pf-page-header">
            <button class="btn btn-icon" title="返回" @click="goBackToInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span class="pf-page-title">元素</span>
          </div>
          <div class="pf-page-body" style="display: flex">
            <div class="pf-panel" style="flex: 1; min-height: 0">
              <div class="pf-panel-header">
                <span class="pf-panel-title">图层元素</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-chips">
                  <button
                    v-for="el in activeSnapshot.elements"
                    :key="el.id"
                    class="pf-chip"
                    :class="{ active: el.active }"
                    @click="store.toggleElement(el.id)"
                  >
                    <span class="pf-chip-dot" />
                    {{ el.name }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Effects Page -->
        <div v-else-if="activeLeftTab === 'effects'" class="pf-page">
          <div class="pf-page-header">
            <button class="btn btn-icon" title="返回" @click="goBackToInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span class="pf-page-title">效果</span>
          </div>
          <div class="pf-page-body" style="display: flex">
            <div class="pf-panel" style="flex: 1; min-height: 0; max-width: 400px">
              <div class="pf-panel-header">
                <span class="pf-panel-title">画面调节</span>
              </div>
              <div class="pf-panel-body">
                <div v-for="slider in slidersConfig" :key="slider.key" class="pf-slider-row">
                  <div class="pf-slider-header">
                    <span class="pf-slider-label">{{ slider.label }}</span>
                    <span class="pf-slider-value">{{ slider.fmt(activeSnapshot.tuningParams[slider.key]) }}</span>
                  </div>
                  <input
                    type="range"
                    class="pf-slider"
                    :min="slider.min"
                    :max="slider.max"
                    :step="slider.step"
                    :value="activeSnapshot.tuningParams[slider.key]"
                    @input="onSliderChange(slider.key, $event)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- History Page -->
        <div v-else-if="activeLeftTab === 'history'" class="pf-page">
          <div class="pf-page-header">
            <button class="btn btn-icon" title="返回" @click="goBackToInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span class="pf-page-title">历史</span>
          </div>
          <div class="pf-page-body" style="display: flex; gap: 12px">
            <div class="pf-panel" style="flex: 1; min-height: 0">
              <div class="pf-panel-header">
                <span class="pf-panel-title">操作历史</span>
              </div>
              <div class="pf-panel-body">
                <div
                  v-for="(record, i) in history"
                  :key="record.id"
                  class="pf-tree-row"
                  :style="{ cursor: 'pointer', opacity: i === currentIndex ? 1 : 0.5, fontWeight: i === currentIndex ? 600 : 400 }"
                  @click="store.jumpTo(i)"
                >
                  <span class="pf-tree-label">{{ record.actionName }}</span>
                  <span class="pf-tree-badge">{{ record.timestamp }}</span>
                </div>
              </div>
            </div>
            <div class="pf-panel" style="flex: 1; min-height: 0">
              <div class="pf-panel-header">
                <span class="pf-panel-title">Prompt 历史</span>
                <button class="btn btn-icon" title="刷新" @click="refreshPromptHistory" style="margin-left: auto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              </div>
              <div class="pf-panel-body">
                <div v-if="promptHistory.length === 0" class="pf-canvas-placeholder">
                  暂无 Prompt 历史
                </div>
                <div
                  v-for="(item, i) in promptHistory"
                  :key="i"
                  class="pf-tree-row"
                  style="cursor: pointer"
                  :title="item.text"
                  @click="applyPromptFromHistory(item.text)"
                >
                  <span class="pf-tree-label" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 280px">
                    {{ truncateText(item.text) }}
                  </span>
                  <span class="pf-tree-badge">{{ formatPromptTime(item.timestampMs) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Render Page -->
        <div v-else-if="activeLeftTab === 'render'" class="pf-page">
          <div class="pf-page-header">
            <button class="btn btn-icon" title="返回" @click="goBackToInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span class="pf-page-title">渲染</span>
          </div>
          <div class="pf-page-body" style="display: flex">
            <div class="pf-panel" style="flex: 1; min-height: 0; max-width: 400px">
              <div class="pf-panel-header">
                <span class="pf-panel-title">渲染设置</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-panel-section">
                  <div class="pf-panel-label">分辨率</div>
                  <div class="pf-seg">
                    <button
                      class="pf-seg-btn"
                      :class="{ active: resolution === '1280 × 720' }"
                      @click="resolution = '1280 × 720'"
                    >
                      720p
                    </button>
                    <button
                      class="pf-seg-btn"
                      :class="{ active: resolution === '1920 × 1080' }"
                      @click="resolution = '1920 × 1080'"
                    >
                      1080p
                    </button>
                    <button
                      class="pf-seg-btn"
                      :class="{ active: resolution === '3840 × 2160' }"
                      @click="resolution = '3840 × 2160'"
                    >
                      4K
                    </button>
                  </div>
                </div>
                <div class="pf-panel-section">
                  <div class="pf-panel-label">帧率</div>
                  <div class="pf-seg">
                    <button
                      class="pf-seg-btn"
                      :class="{ active: frameRate === '24 fps' }"
                      @click="frameRate = '24 fps'"
                    >
                      24
                    </button>
                    <button
                      class="pf-seg-btn"
                      :class="{ active: frameRate === '30 fps' }"
                      @click="frameRate = '30 fps'"
                    >
                      30
                    </button>
                    <button
                      class="pf-seg-btn"
                      :class="{ active: frameRate === '60 fps' }"
                      @click="frameRate = '60 fps'"
                    >
                      60
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Performance Page -->
        <div v-else-if="activeLeftTab === 'performance'" class="pf-page">
          <div class="pf-page-header">
            <button class="btn btn-icon" title="返回" @click="goBackToInput">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span class="pf-page-title">性能</span>
          </div>
          <div class="pf-page-body" style="display: flex; gap: 12px">
            <div class="pf-panel" style="flex: 1; min-height: 0">
              <div class="pf-panel-header">
                <span class="pf-panel-title">三层存储统计</span>
                <button class="btn btn-icon" title="刷新" @click="refreshStorageStats" style="margin-left: auto">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
              </div>
              <div class="pf-panel-body">
                <div v-if="isStorageLoading" class="pf-canvas-placeholder">加载中…</div>
                <template v-else-if="storageStats">
                  <!-- L1 帧缓存 -->
                  <div class="pf-panel-section">
                    <div class="pf-panel-label">L1 帧缓存（内存 LRU）</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px">
                      <div>条目数：<strong>{{ storageStats.frameMemory.entries }}</strong></div>
                      <div>占用：<strong>{{ formatBytes(storageStats.frameMemory.bytes) }}</strong> / {{ formatBytes(storageStats.frameMemory.maxBytes) }}</div>
                      <div>命中：<strong>{{ storageStats.frameMemory.hits }}</strong></div>
                      <div>未命中：<strong>{{ storageStats.frameMemory.misses }}</strong></div>
                      <div>命中率：<strong>{{ (storageStats.frameMemory.hitRate * 100).toFixed(1) }}%</strong></div>
                      <div>淘汰：<strong>{{ storageStats.frameMemory.evictions }}</strong></div>
                    </div>
                  </div>
                  <!-- L1 文本缓存 -->
                  <div class="pf-panel-section">
                    <div class="pf-panel-label">L1 文本缓存（内存 LRU）</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px">
                      <div>条目数：<strong>{{ storageStats.textMemory.entries }}</strong></div>
                      <div>占用：<strong>{{ formatBytes(storageStats.textMemory.bytes) }}</strong> / {{ formatBytes(storageStats.textMemory.maxBytes) }}</div>
                      <div>命中：<strong>{{ storageStats.textMemory.hits }}</strong></div>
                      <div>未命中：<strong>{{ storageStats.textMemory.misses }}</strong></div>
                      <div>命中率：<strong>{{ (storageStats.textMemory.hitRate * 100).toFixed(1) }}%</strong></div>
                      <div>淘汰：<strong>{{ storageStats.textMemory.evictions }}</strong></div>
                    </div>
                  </div>
                  <!-- L2 OPFS -->
                  <div class="pf-panel-section">
                    <div class="pf-panel-label">L2 OPFS 文件存储</div>
                    <div style="font-size: 13px">
                      状态：<strong :style="{ color: storageStats.opfsAvailable ? 'var(--accent-green, #22c55e)' : 'var(--accent-red, #ef4444)' }">
                        {{ storageStats.opfsAvailable ? '可用' : '不可用（已降级）' }}
                      </strong>
                    </div>
                  </div>
                  <!-- L3 数据库路径 -->
                  <div class="pf-panel-section">
                    <div class="pf-panel-label">L3 Redb 数据库</div>
                    <div style="font-size: 13px; word-break: break-all">
                      <span v-if="storagePath">{{ storagePath }}</span>
                      <span v-else style="color: var(--text-secondary)">浏览器环境未启用（需 Tauri 桌面运行时）</span>
                    </div>
                  </div>
                </template>
                <div v-else class="pf-canvas-placeholder">无统计数据</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <StatusBar
      :save-status="saveStatus"
      :last-saved-time="lastSavedTime"
      :resolution="resolution"
      :frame-rate="frameRate"
    />

    <ExportModal
      :is-open="isExportOpen"
      :resolution="resolution"
      :frame-rate="frameRate"
      :duration="TOTAL_DURATION"
      @close="isExportOpen = false"
    />

    <SettingsModal
      :is-open="isSettingsOpen"
      :theme="theme"
      :auto-save-enabled="autoSaveEnabled"
      :last-saved-time="lastSavedTime"
      @close="isSettingsOpen = false"
      @select-theme="store.setTheme"
      @toggle-auto-save="(enabled) => autoSaveEnabled = enabled"
      @force-save="store.handleForceSave"
      @reset-project="store.handleResetProject"
    />
  </div>
</template>
