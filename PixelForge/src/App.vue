<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, nextTick, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from './stores/app';
import TopHeader from './components/TopHeader.vue';
import LeftRail from './components/LeftRail.vue';
import ControlPanel from './components/ControlPanel.vue';
import CanvasViewport from './components/CanvasViewport.vue';
import IRPreviewPanel from './components/IRPreviewPanel.vue';
import TimelinePanel from './components/TimelinePanel.vue';
import PerformancePanel from './components/PerformancePanel.vue';
import StatusBar from './components/StatusBar.vue';
import AIChatPanel from './components/AIChatPanel.vue';
import ResourceManagerPanel from './components/ResourceManagerPanel.vue';
import WorkflowPanel from './components/WorkflowPanel.vue';
import AmbientFluidCanvas from './components/AmbientFluidCanvas.vue';
import ExportModal from './components/ExportModal.vue';
import SettingsModal from './components/SettingsModal.vue';
import PfSelect from './components/ui/PfSelect.vue';
import { pageEnter } from './composables/useAnime';
import { TOTAL_DURATION } from './data';

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
  autoSaveInterval,
  saveStatus,
  lastSavedTime,
  modelConfigs,
  history,
  currentIndex,
  canUndo,
  canRedo,
} = storeToRefs(store);

// ─── 项目实际时长（基于 clips 计算，无 clips 时为 0） ──
const projectDuration = computed(() => {
  if (store.clips.length === 0) return 0;
  return Math.max(...store.clips.map(c => c.start + c.duration));
});

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
  document.addEventListener('click', onTuningDocClick);
  // 初始化完成后从三层统一存储异步加载项目快照（覆盖 localStorage 同步加载结果）
  void store.loadFromUnifiedStore();
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('click', onTuningDocClick);
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
const tuningSelects = [
  {
    key: 'starDensity' as const,
    label: '星空密度',
    options: [
      { value: 0, label: '关闭' },
      { value: 0.25, label: '低' },
      { value: 0.5, label: '中' },
      { value: 0.75, label: '高' },
      { value: 1, label: '满' },
    ],
  },
  {
    key: 'brightness' as const,
    label: '亮度',
    options: [
      { value: 0.2, label: '暗' },
      { value: 0.4, label: '偏暗' },
      { value: 0.6, label: '正常' },
      { value: 0.8, label: '明亮' },
      { value: 1, label: '最亮' },
    ],
  },
  {
    key: 'hue' as const,
    label: '色相',
    options: [
      { value: 0, label: '红色' },
      { value: 30, label: '橙色' },
      { value: 60, label: '黄色' },
      { value: 120, label: '绿色' },
      { value: 180, label: '青色' },
      { value: 240, label: '蓝色' },
      { value: 300, label: '紫色' },
    ],
  },
  {
    key: 'contrast' as const,
    label: '对比度',
    options: [
      { value: 0.25, label: '低' },
      { value: 0.5, label: '中' },
      { value: 0.75, label: '高' },
      { value: 1, label: '最大' },
    ],
  },
];

function onTuningSelectChange(key: string, value: string) {
const parsed = parseFloat(value);
store.setTuningParams((prev) => ({ ...prev, [key]: parsed }));
}

const isTuningPopoverOpen = ref(false);
const tuningPopoverWrapRef = ref<HTMLElement | null>(null);

function onTuningDocClick(e: MouseEvent) {
  if (!isTuningPopoverOpen.value) return;
  const wrap = tuningPopoverWrapRef.value;
  if (wrap && !wrap.contains(e.target as Node)) {
    isTuningPopoverOpen.value = false;
  }
}

function goBackToInput() {
  activeLeftTab.value = 'image';
}

// ─── 图片工作台：资源管理联动 ────────────────────────
const imageTabSelectedAssetId = ref<string | null>(null);

function onResourceSelect(id: string) {
  imageTabSelectedAssetId.value = id;
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

function applyPromptFromHistory(text: string) {
  store.handlePromptTextChange(text);
}

// 切换到历史页时自动加载数据
watch(activeLeftTab, (tab) => {
  if (tab === 'history') void refreshPromptHistory();
});

// ─── 渲染/导出设置 (Adobe Media Encoder 风格) ─────────
const renderFormat = ref('H.264');
const renderPreset = ref('Match Source - High');
const renderProfile = ref('High');
const renderLevel = ref('4.1');
const renderBitrateMode = ref<'CBR' | 'VBR 1-pass' | 'VBR 2-pass'>('VBR 1-pass');
const renderTargetBitrate = ref(10);
const renderMaxBitrate = ref(14);
const renderAudioCodec = ref('AAC');
const renderSampleRate = ref('48 kHz');
const renderAudioChannels = ref('Stereo');
const renderAudioBitrate = ref(320);
const renderOutputName = ref('PixelForge_Export');
const isExporting = ref(false);
const exportProgress = ref(0);

const formatOptions = ['H.264', 'HEVC (H.265)', 'ProRes 422 HQ', 'AV1', 'WebM VP9'];
const presetOptions = ['Match Source - High', 'Match Source - Medium', 'Match Source - Low', 'Custom'];
const profileOptions = ['High', 'Main', 'Baseline'];
const levelOptions = ['4.0', '4.1', '4.2', '5.0', '5.1', '5.2'];
const audioCodecOptions = ['AAC', 'MP3', 'PCM 24-bit'];
const sampleRateOptions = ['48 kHz', '44.1 kHz', '96 kHz'];
const channelOptions = ['Stereo', 'Mono', '5.1 Surround'];
const audioBitrateOptions = [320, 256, 192, 128, 96];

// PfSelect options (string value/label pairs)
const formatOpts = formatOptions.map((f) => ({ value: f, label: f }));
const presetOpts = presetOptions.map((p) => ({ value: p, label: p }));
const profileOpts = profileOptions.map((p) => ({ value: p, label: p }));
const levelOpts = levelOptions.map((l) => ({ value: l, label: `Level ${l}` }));
const audioCodecOpts = audioCodecOptions.map((c) => ({ value: c, label: c }));
const sampleRateOpts = sampleRateOptions.map((s) => ({ value: s, label: s }));
const channelOpts = channelOptions.map((c) => ({ value: c, label: c }));

const estimatedFileSize = computed(() => {
  const totalBitrate = renderTargetBitrate.value + renderAudioBitrate.value / 1000;
  const sizeMB = (totalBitrate * projectDuration.value) / 8; // Mbps * seconds / 8 = MB
  if (sizeMB >= 1024) return `${(sizeMB / 1024).toFixed(2)} GB`;
  return `${sizeMB.toFixed(1)} MB`;
});

function startExport() {
  if (isExporting.value) return;
  isExporting.value = true;
  exportProgress.value = 0;
  const timer = setInterval(() => {
    exportProgress.value += Math.random() * 4 + 1;
    if (exportProgress.value >= 100) {
      exportProgress.value = 100;
      clearInterval(timer);
      setTimeout(() => {
        isExporting.value = false;
        exportProgress.value = 0;
      }, 1500);
    }
  }, 200);
}
</script>

<template>
  <div class="pf-app">
    <AmbientFluidCanvas />

    <TopHeader
      :theme="theme"
      :is-generating="isGenerating"
      @toggle-theme="store.toggleTheme"
      @export="isExportOpen = true"
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
              :duration="projectDuration"
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

        <!-- 图片工作台 — 左AI对话 + 中画布 + 底部工作流 + 右资源管理 -->
        <div v-else-if="activeLeftTab === 'image'" class="pf-workspace">
          <div class="pf-workspace-top">
            <!-- 左侧：AI 对话 -->
            <AIChatPanel />

            <!-- 中间：画布 -->
            <div class="pf-image-center">
              <CanvasViewport
                :current-time="currentTime"
                :duration="TOTAL_DURATION"
                :is-playing="isPlaying"
                :external-selected-id="imageTabSelectedAssetId"
                :hide-asset-strip="true"
                @toggle-play="store.togglePlay"
                @step-forward="store.stepForward"
                @step-backward="store.stepBackward"
                @reset="store.resetTime"
              />
            </div>

            <!-- 右侧：资源管理 -->
            <div style="width: var(--panel-right-width); flex-shrink: 0; min-height: 0">
              <ResourceManagerPanel @select-asset="onResourceSelect" />
            </div>
          </div>

          <!-- 底部：工作流（贯穿整个底部） -->
          <WorkflowPanel />
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
              <div class="pf-panel-body" ref="tuningPopoverWrapRef" style="position: relative">
                <button class="pf-tuning-trigger" @click="isTuningPopoverOpen = !isTuningPopoverOpen">
                  <span>调整画面参数</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                <!-- Tuning Floating Panel -->
                <div v-if="isTuningPopoverOpen" class="pf-popover">
                  <div class="pf-popover-header">
                    <span class="pf-popover-title">画面调节</span>
                    <button class="btn btn-icon" title="关闭" @click="isTuningPopoverOpen = false">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  <div class="pf-popover-body">
                    <div v-for="sel in tuningSelects" :key="sel.key" class="pf-tuning-row">
                      <label class="pf-tuning-label">{{ sel.label }}</label>
                      <PfSelect
                        :model-value="String(activeSnapshot.tuningParams[sel.key])"
                        :options="sel.options.map((o) => ({ value: String(o.value), label: o.label }))"
                        @update:model-value="onTuningSelectChange(sel.key, $event)"
                      />
                    </div>
                  </div>
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

        <!-- Performance Page -->
        <PerformancePanel
          v-else-if="activeLeftTab === 'performance'"
          @back="goBackToInput"
        />

        <!-- Render Page — Adobe Media Encoder 风格导出界面 -->
        <div v-else-if="activeLeftTab === 'render'" class="pf-render">
          <!-- 左栏：设置区 -->
          <div class="pf-render-settings">
            <!-- 格式与预设 -->
            <div class="pf-panel">
              <div class="pf-panel-header">
                <span class="pf-panel-title">格式与预设</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-render-row">
                  <label class="pf-render-label">格式</label>
                  <PfSelect v-model="renderFormat" :options="formatOpts" />
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">预设</label>
                  <PfSelect v-model="renderPreset" :options="presetOpts" />
                </div>
              </div>
            </div>

            <!-- 视频设置 -->
            <div class="pf-panel">
              <div class="pf-panel-header">
                <span class="pf-panel-title">视频</span>
                <span class="pf-render-tab-active">视频</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-render-row">
                  <label class="pf-render-label">分辨率</label>
                  <div class="pf-seg">
                    <button class="pf-seg-btn" :class="{ active: resolution === '1280 × 720' }" @click="resolution = '1280 × 720'">720p</button>
                    <button class="pf-seg-btn" :class="{ active: resolution === '1920 × 1080' }" @click="resolution = '1920 × 1080'">1080p</button>
                    <button class="pf-seg-btn" :class="{ active: resolution === '3840 × 2160' }" @click="resolution = '3840 × 2160'">4K</button>
                  </div>
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">帧率</label>
                  <div class="pf-seg">
                    <button class="pf-seg-btn" :class="{ active: frameRate === '24 fps' }" @click="frameRate = '24 fps'">24</button>
                    <button class="pf-seg-btn" :class="{ active: frameRate === '30 fps' }" @click="frameRate = '30 fps'">30</button>
                    <button class="pf-seg-btn" :class="{ active: frameRate === '60 fps' }" @click="frameRate = '60 fps'">60</button>
                  </div>
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">编解码器配置</label>
                  <div style="display: flex; gap: 8px;">
                    <PfSelect v-model="renderProfile" :options="profileOpts" size="small" />
                    <PfSelect v-model="renderLevel" :options="levelOpts" size="small" />
                  </div>
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">码率模式</label>
                  <div class="pf-seg">
                    <button class="pf-seg-btn" :class="{ active: renderBitrateMode === 'CBR' }" @click="renderBitrateMode = 'CBR'">CBR</button>
                    <button class="pf-seg-btn" :class="{ active: renderBitrateMode === 'VBR 1-pass' }" @click="renderBitrateMode = 'VBR 1-pass'">VBR 1-pass</button>
                    <button class="pf-seg-btn" :class="{ active: renderBitrateMode === 'VBR 2-pass' }" @click="renderBitrateMode = 'VBR 2-pass'">VBR 2-pass</button>
                  </div>
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">目标码率</label>
                  <div class="pf-render-bitrate">
                    <input type="range" class="pf-slider" min="1" max="50" step="0.5" v-model.number="renderTargetBitrate" />
                    <span class="pf-render-bitrate-val">{{ renderTargetBitrate }} Mbps</span>
                  </div>
                </div>
                <div v-if="renderBitrateMode !== 'CBR'" class="pf-render-row">
                  <label class="pf-render-label">最大码率</label>
                  <div class="pf-render-bitrate">
                    <input type="range" class="pf-slider" min="1" max="60" step="0.5" v-model.number="renderMaxBitrate" />
                    <span class="pf-render-bitrate-val">{{ renderMaxBitrate }} Mbps</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 音频设置 -->
            <div class="pf-panel">
              <div class="pf-panel-header">
                <span class="pf-panel-title">音频</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-render-row">
                  <label class="pf-render-label">音频编解码器</label>
                  <PfSelect v-model="renderAudioCodec" :options="audioCodecOpts" />
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">采样率</label>
                  <PfSelect v-model="renderSampleRate" :options="sampleRateOpts" />
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">声道</label>
                  <PfSelect v-model="renderAudioChannels" :options="channelOpts" />
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">音频码率</label>
                  <div class="pf-seg">
                    <button
                      v-for="b in audioBitrateOptions"
                      :key="b"
                      class="pf-seg-btn"
                      :class="{ active: renderAudioBitrate === b }"
                      @click="renderAudioBitrate = b"
                    >{{ b }}k</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 右栏：输出摘要 -->
          <div class="pf-render-summary">
            <div class="pf-panel">
              <div class="pf-panel-header">
                <span class="pf-panel-title">输出</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-render-row">
                  <label class="pf-render-label">文件名</label>
                  <input v-model="renderOutputName" class="pf-input" type="text" />
                </div>
                <div class="pf-render-summary-grid">
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">格式</span>
                    <span class="pf-render-summary-val">{{ renderFormat }}</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">分辨率</span>
                    <span class="pf-render-summary-val">{{ resolution }}</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">帧率</span>
                    <span class="pf-render-summary-val">{{ frameRate }}</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">时长</span>
                    <span class="pf-render-summary-val">{{ projectDuration.toFixed(1) }} s</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">视频码率</span>
                    <span class="pf-render-summary-val">{{ renderTargetBitrate }} Mbps</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">音频码率</span>
                    <span class="pf-render-summary-val">{{ renderAudioBitrate }} kbps</span>
                  </div>
                  <div class="pf-render-summary-item pf-render-summary-highlight">
                    <span class="pf-render-summary-label">预估大小</span>
                    <span class="pf-render-summary-val">{{ estimatedFileSize }}</span>
                  </div>
                </div>

                <!-- 导出进度 -->
                <div v-if="isExporting" class="pf-render-progress">
                  <div class="pf-render-progress-bar">
                    <div class="pf-render-progress-fill" :style="{ width: exportProgress + '%' }" />
                  </div>
                  <span class="pf-render-progress-text">{{ Math.round(exportProgress) }}%</span>
                </div>

                <button
                  class="btn-primary pf-render-export-btn"
                  :disabled="isExporting"
                  @click="startExport"
                >
                  <PhPlay v-if="!isExporting" :size="14" weight="fill" />
                  <PhSpinner v-else :size="14" />
                  {{ isExporting ? '渲染中…' : '开始导出' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Performance Page (moved to PerformancePanel component above) -->
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
      :duration="projectDuration"
      :clips="store.clips"
      :tracks="store.tracks"
      :prompt-text="livePromptText"
      :elements="activeSnapshot.elements"
      :tuning-params="activeSnapshot.tuningParams"
      :ir-tree="treeData"
      @close="isExportOpen = false"
    />

    <SettingsModal
      :is-open="isSettingsOpen"
      :theme="theme"
      :auto-save-enabled="autoSaveEnabled"
      :auto-save-interval="autoSaveInterval"
      :last-saved-time="lastSavedTime"
      :model-configs="modelConfigs"
      @close="isSettingsOpen = false"
      @select-theme="store.setTheme"
      @toggle-auto-save="(enabled) => autoSaveEnabled = enabled"
      @update-auto-save-interval="store.setAutoSaveInterval"
      @force-save="store.handleForceSave"
      @add-model="store.addModelConfig"
      @update-model="store.updateModelConfig"
      @remove-model="store.removeModelConfig"
    />
  </div>
</template>
