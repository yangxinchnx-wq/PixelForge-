<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, nextTick, computed, defineAsyncComponent, toRef } from 'vue';
import { useAppStore } from './stores/app';
import { useRuntimeStore } from './stores/runtime';
import { useMaterialAssetStore } from './material/materialAssetStore';
import { disposeMaterialRenderBridge } from './material/materialRenderBridge';
import { useAssetStore } from './assets/assetStore';
import { useErrorStore } from './stores/errorStore';
import type { RenderIR } from './compiler/ir/renderIR';
import { renderIRToTreeNodes } from './utils/irTreeUtils';
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
import EffectsPage from './components/EffectsPage.vue';
import HistoryPage from './components/HistoryPage.vue';
import RenderPage from './components/RenderPage.vue';
import { pageEnter } from './composables/useAnime';
import { TOTAL_DURATION } from './data';

// ─── 异步加载重型组件 ─────────────────────────────────
const GraphEditor = defineAsyncComponent(() => import('./components/editor/graph/GraphEditor.vue'));
const MaterialManagerPanel = defineAsyncComponent(() => import('./components/MaterialManagerPanel.vue'));
const ExportModal = defineAsyncComponent(() => import('./components/ExportModal.vue'));
const SettingsModal = defineAsyncComponent(() => import('./components/SettingsModal.vue'));

const store = useAppStore();

// 使用 toRef 保持对子 store 代理属性的响应性（storeToRefs 对子 store 代理不兼容）
const activeLeftTab = toRef(store, 'activeLeftTab');
const livePromptText = toRef(store, 'livePromptText');
const activeSnapshot = toRef(store, 'activeSnapshot');
const resolution = toRef(store, 'resolution');
const frameRate = toRef(store, 'frameRate');
const treeData = toRef(store, 'treeData');
const currentTime = toRef(store, 'currentTime');
const isPlaying = toRef(store, 'isPlaying');
const isExportOpen = toRef(store, 'isExportOpen');
const isSettingsOpen = toRef(store, 'isSettingsOpen');
const theme = toRef(store, 'theme');
const isGenerating = toRef(store, 'isGenerating');
const showTimeline = toRef(store, 'showTimeline');
const autoSaveEnabled = toRef(store, 'autoSaveEnabled');
const autoSaveInterval = toRef(store, 'autoSaveInterval');
const saveStatus = toRef(store, 'saveStatus');
const lastSavedTime = toRef(store, 'lastSavedTime');
const modelConfigs = toRef(store, 'modelConfigs');
const selectedModelId = toRef(store, 'selectedModelId');
const accentColors = toRef(store, 'accentColors');
const history = toRef(store, 'history');
const currentIndex = toRef(store, 'currentIndex');
const canUndo = toRef(store, 'canUndo');
const canRedo = toRef(store, 'canRedo');

const runtimeStore = useRuntimeStore();
const materialAssetStore = useMaterialAssetStore();
const assetStore = useAssetStore();
const errorStore = useErrorStore();

// ─── WebGPU 画布 ──────────────────────────────────────
const gpuCanvasRef = ref<HTMLCanvasElement | null>(null);
const gpuCanvasInitialized = ref(false);

async function ensureGpuCanvasInitialized() {
  if (gpuCanvasInitialized.value || !gpuCanvasRef.value) return;
  gpuCanvasInitialized.value = true;
  try {
    await runtimeStore.initialize(gpuCanvasRef.value);
    console.log('[App] WebGPU 运行时初始化成功');
  } catch (e) {
    console.error('[App] WebGPU 运行时初始化失败:', e);
  }
}

const projectDuration = computed(() => {
  if (store.clips.length === 0) return 0;
  return Math.max(...store.clips.map(c => c.start + c.duration));
});

// ─── Theme ────────────────────────────────────────────
watch(theme, (val) => {
  document.documentElement.dataset.theme = val;
}, { immediate: true });

// ─── Playback ─────────────────────────────────────────
watch(isPlaying, (playing) => {
  if (playing) store.startPlayback();
  else store.stopPlayback();
});

// ─── Keyboard (undo/redo) ─────────────────────────────
function handleKeyDown(e: KeyboardEvent) {
  const activeTag = document.activeElement?.tagName;
  const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) {
      if (canRedo.value) { e.preventDefault(); store.redo(); }
    } else {
      if (canUndo.value && !isEditingText) { e.preventDefault(); store.undo(); }
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    if (canRedo.value) { e.preventDefault(); store.redo(); }
  }
}

onMounted(() => {
  document.documentElement.dataset.theme = theme.value;
  window.addEventListener('keydown', handleKeyDown);
  void store.loadFromUnifiedStore();
  materialAssetStore.init();
  // 从 OPFS 恢复持久化的图片/视频资产
  void assetStore.init();
  nextTick(() => { void ensureGpuCanvasInitialized(); });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  store.stopPlayback();
  disposeMaterialRenderBridge();
});

// ─── Autosave ─────────────────────────────────────────
watch(
  [livePromptText, () => activeSnapshot.value.elements, () => activeSnapshot.value.tuningParams, treeData, resolution, frameRate, theme, autoSaveEnabled, () => modelConfigs.value.length, selectedModelId, accentColors],
  () => { store.triggerAutosave(); },
);
watch(
  () => modelConfigs.value,
  () => { store.triggerAutosave(); },
  { deep: true },
);

// ─── Material Asset Store ↔ GPU Device 同步 ───────────
watch(
  () => runtimeStore.runtime,
  (rt) => {
    materialAssetStore.setGpuDevice(rt?.gpu?.device ? (rt.gpu.device as unknown as GPUDevice) : null);
  },
  { immediate: true },
);

// ─── EffectsPage ref（用于 popover 外部点击检测）──────
const effectsPageRef = ref<InstanceType<typeof EffectsPage> | null>(null);
function onTuningDocClick(e: MouseEvent) {
  if (!effectsPageRef.value) return;
  const wrap = effectsPageRef.value.tuningPopoverWrapRef;
  if (wrap && !wrap.contains(e.target as Node)) {
    effectsPageRef.value.closePopover();
  }
}
onMounted(() => { document.addEventListener('click', onTuningDocClick); });
onUnmounted(() => { document.removeEventListener('click', onTuningDocClick); });

// ─── 图片工作台：资源管理联动 ────────────────────────
const imageTabSelectedAssetId = ref<string | null>(null);
function onResourceSelect(id: string) { imageTabSelectedAssetId.value = id; }

// ─── 页面切换动画 ─────────────────────────────────────
const contentRef = ref<HTMLElement | null>(null);
watch(activeLeftTab, async () => {
  await nextTick();
  if (contentRef.value) pageEnter(contentRef.value);
});

// ─── Graph Editor ─────────────────────────────────────
const showGraphEditor = ref(false);

async function handleApplyIR(ir: RenderIR): Promise<void> {
  try {
    await runtimeStore.setRenderIR(ir);
    treeData.value = renderIRToTreeNodes(ir);
    showGraphEditor.value = false;
  } catch (e) {
    errorStore.push(e, '可视化编程引擎编译产物应用失败');
    showGraphEditor.value = false;
  }
}

function handleWorkflowStepClick(stepId: string) {
  switch (stepId) {
    case 'input': activeLeftTab.value = 'image'; break;
    case 'parse': showGraphEditor.value = true; break;
    case 'generate': void store.handleGenerate(); break;
    case 'postprocess': activeLeftTab.value = 'input'; break;
    case 'export': activeLeftTab.value = 'render'; break;
  }
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
        <div v-show="activeLeftTab === 'input'" class="pf-workspace" :style="store.buildAccentVars(accentColors.video)">
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
              <IRPreviewPanel :tree-data="treeData" @toggle-visibility="store.toggleIRVisibility" />
            </div>
          </div>
          <TimelinePanel :current-time="currentTime" :is-playing="isPlaying" @seek="store.seek" @toggle-play="store.togglePlay" />
        </div>

        <!-- 图片工作台 -->
        <div v-show="activeLeftTab === 'image'" class="pf-workspace" :style="store.buildAccentVars(accentColors.image)">
          <div class="pf-workspace-top">
            <AIChatPanel />
            <div class="pf-image-center" style="position: relative;">
              <canvas
                ref="gpuCanvasRef"
                class="pf-gpu-canvas"
                :style="{
                  position: 'absolute',
                  top: 0, left: 0, width: '100%', height: '100%',
                  display: 'block',
                  opacity: runtimeStore.status === 'ready' ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  zIndex: 2,
                  pointerEvents: runtimeStore.status === 'ready' ? 'auto' : 'none',
                }"
              />
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
            <div style="width: var(--panel-right-width); flex-shrink: 0; min-height: 0">
              <ResourceManagerPanel @select-asset="onResourceSelect" />
            </div>
          </div>
          <WorkflowPanel @step-click="handleWorkflowStepClick" />
        </div>

        <!-- Elements Page -->
        <div v-show="activeLeftTab === 'elements'" class="pf-page">
          <MaterialManagerPanel style="flex: 1; min-height: 0;" />
        </div>

        <!-- Effects Page -->
        <EffectsPage
          v-show="activeLeftTab === 'effects'"
          ref="effectsPageRef"
          :tuning-params="activeSnapshot.tuningParams"
          @update:tuning-params="(updater) => store.setTuningParams(updater)"
          @go-back="activeLeftTab = 'image'"
        />

        <!-- History Page -->
        <HistoryPage
          v-show="activeLeftTab === 'history'"
          :history="history"
          :current-index="currentIndex"
          :active-tab="activeLeftTab"
          :load-prompt-history="store.loadPromptHistory"
          @jump-to="store.jumpTo"
          @apply-prompt="store.handlePromptTextChange"
        />

        <!-- Performance Page -->
        <PerformancePanel v-show="activeLeftTab === 'performance'" />

        <!-- Render Page -->
        <RenderPage
          v-show="activeLeftTab === 'render'"
          :resolution="resolution"
          :frame-rate="frameRate"
          @update:resolution="(v: string) => resolution = v"
          @update:frame-rate="(v: string) => frameRate = v"
        />
      </div>
    </div>

    <!-- 全局时间轴面板 -->
    <TimelinePanel
      v-if="showTimeline && activeLeftTab !== 'input'"
      :current-time="currentTime"
      :is-playing="isPlaying"
      @seek="store.seek"
      @toggle-play="store.togglePlay"
    />

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
      :accent-colors="accentColors"
      @close="isSettingsOpen = false"
      @select-theme="store.setTheme"
      @toggle-auto-save="(enabled) => autoSaveEnabled = enabled"
      @update-auto-save-interval="store.setAutoSaveInterval"
      @force-save="store.handleForceSave"
      @add-model="store.addModelConfig"
      @update-model="store.updateModelConfig"
      @remove-model="store.removeModelConfig"
      @set-accent-color="store.setAccentColor"
      @reset-accent-colors="store.resetAccentColors"
    />

    <!-- Graph Editor -->
    <GraphEditor
      v-if="showGraphEditor"
      :visible="showGraphEditor"
      @update:visible="showGraphEditor = $event"
      @apply-i-r="handleApplyIR"
    />
  </div>
</template>
