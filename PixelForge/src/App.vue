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
import TopBar from './components/editor/TopBar.vue';
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
import { useTimelineStore } from './stores/timelineStore';
import { useHistoryStore as usePatchHistoryStore } from './stores/history';
import { useHistoryStore as useSnapshotHistoryStore } from './stores/historyStore';
import { useProjectStore } from './project/projectStore';
import { loadProjectFromFile, pickProjectFile, saveProjectToFile } from './project/fileSystem';
import type { TimelineStoreLike } from './project/types';
import { currentFrameForTime, totalFramesForTimeline } from './world/timeline/unifiedTimeline';

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
const timelineStore = useTimelineStore();
// patch 制历史(Inspector/LayerTree 参数修改),与快照制 store.undo() 是两套系统
const patchHistory = usePatchHistoryStore();
// 快照制历史(prompt/elements/tuningParams 全量状态,appStore 代理同一单例)
const snapshotHistory = useSnapshotHistoryStore();
const projectStore = useProjectStore();

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

// ─── TopBar 帧信息(以 TimelineContent 为权威模型推导) ───
const timelineFps = computed(() => timelineStore.timelineContent.fps);
const totalFrames = computed(() => totalFramesForTimeline(timelineStore.timelineContent));
const currentFrame = computed(() => currentFrameForTime(currentTime.value, timelineFps.value));

// ─── Undo / Redo(两套历史统一入口,按"最近编辑"仲裁) ────
// 快照制(snapshotHistory):prompt/elements/tuningParams 全量状态,经 appStore.undo/redo
// patch 制(patchHistory):runtime Inspector/LayerTree 参数增量
// 两栈均非空时撤销/重做时间戳更近的一方,使键盘 Ctrl+Z/Y 与 TopBar ↶↷ 行为一致
const canUndoAny = computed(() => canUndo.value || patchHistory.canUndo);
const canRedoAny = computed(() => canRedo.value || patchHistory.canRedo);

/** 下一次 undo 应作用的历史系统;都不可撤销返回 null */
function undoTarget(): 'patch' | 'snapshot' | null {
  if (!patchHistory.canUndo && !canUndo.value) return null;
  const patchTs = patchHistory.lastEntry?.timestamp ?? 0;
  if (patchHistory.canUndo && (!canUndo.value || patchTs > snapshotHistory.lastEditTs)) {
    return 'patch';
  }
  return 'snapshot';
}

/** 下一次 redo 应作用的历史系统;都不可重做返回 null */
function redoTarget(): 'patch' | 'snapshot' | null {
  if (!patchHistory.canRedo && !canRedo.value) return null;
  const patchTs = patchHistory.nextRedoEntry?.timestamp ?? 0;
  if (patchHistory.canRedo && (!canRedo.value || patchTs > snapshotHistory.nextRedoTs)) {
    return 'patch';
  }
  return 'snapshot';
}

function handleUndo() {
  const target = undoTarget();
  if (target === 'patch') {
    if (!patchHistory.undo(runtimeStore)) {
      errorStore.push(new Error('撤销操作应用失败'), '撤销失败');
    }
    return;
  }
  if (target === 'snapshot') {
    store.undo();
  }
}

function handleRedo() {
  const target = redoTarget();
  if (target === 'patch') {
    if (!patchHistory.redo(runtimeStore)) {
      errorStore.push(new Error('重做操作应用失败'), '重做失败');
    }
    return;
  }
  if (target === 'snapshot') {
    store.redo();
  }
}

const undoTip = computed(() => {
  if (undoTarget() === 'patch') {
    return `撤销 · ${patchHistory.lastEntry?.description ?? ''} (Ctrl+Z)`;
  }
  if (undoTarget() === 'snapshot') {
    const name = snapshotHistory.history[snapshotHistory.currentIndex]?.actionName;
    return name ? `撤销 · ${name} (Ctrl+Z)` : '无可撤销操作';
  }
  return '无可撤销操作';
});

const redoTip = computed(() => {
  if (redoTarget() === 'patch') {
    return `重做 · ${patchHistory.nextRedoEntry?.description ?? ''} (Ctrl+Y)`;
  }
  if (redoTarget() === 'snapshot') {
    const name = snapshotHistory.history[snapshotHistory.currentIndex + 1]?.actionName;
    return name ? `重做 · ${name} (Ctrl+Y)` : '无可重做操作';
  }
  return '无可重做操作';
});

function handleJumpStart() {
  store.seek(0);
}

function handleJumpEnd() {
  store.seek(timelineStore.timelineContent.duration);
}

// ─── 项目文件动作 ─────────────────────────────────────
// project 模块的 TimelineStoreLike 与 timelineStore 的 legacy tracks(Track[])形状不同,
// 用 getter/setter 适配:写入穿透到 store;legacy tracks 传空数组(序列化以 timelineContent 为准)
const timelineStoreLike: TimelineStoreLike = {
  get timelineContent() { return timelineStore.timelineContent },
  set timelineContent(content) { if (content) timelineStore.timelineContent = content },
  get currentTime() { return timelineStore.currentTime },
  set currentTime(time) { if (time !== undefined) timelineStore.currentTime = time },
  tracks: [],
};

function handleNewProject() {
  const name = window.prompt('新项目名称', '未命名项目');
  if (name === null) return;
  projectStore.newProject(name.trim() || '未命名项目');
  // newProject 只创建 metadata,runtime IR 需调用方重置到当前场景的初始状态
  runtimeStore.setScenario(runtimeStore.currentScenario);
  patchHistory.clear();
}

async function handleOpenProject() {
  try {
    const file = await pickProjectFile();
    if (!file) return;
    const project = await loadProjectFromFile(file);
    projectStore.openProject(project, runtimeStore, timelineStoreLike, patchHistory);
  } catch (e) {
    errorStore.push(e, '打开项目失败');
  }
}

async function handleSaveProject() {
  try {
    // 从未新建过项目时,保存即创建(避免保存按钮空转)
    if (!projectStore.hasProject) projectStore.newProject('未命名项目');
    const project = projectStore.snapshotCurrent(runtimeStore, timelineStoreLike, patchHistory);
    if (!project) {
      errorStore.push(new Error('没有可保存的项目内容'), '保存项目失败');
      return;
    }
    await saveProjectToFile(project);
    projectStore.dirty = false;
  } catch (e) {
    errorStore.push(e, '保存项目失败');
  }
}

// ─── Theme ────────────────────────────────────────────
watch(theme, (val) => {
  document.documentElement.dataset.theme = val;
}, { immediate: true });

// ─── Playback ─────────────────────────────────────────
watch(isPlaying, (playing) => {
  if (playing) store.startPlayback();
  else store.stopPlayback();
});

// ─── currentTime 双轨同步 ─────────────────────────────
// playback 轨(UI 权威):seek/step/rAF 驱动;timeline 轨(模型):项目序列化读取。
// 双向 watch + 等值守卫:任一侧变化即镜像到另一侧,相等则跳过,防止互激循环
watch(currentTime, (t) => {
  if (timelineStore.currentTime !== t) timelineStore.seekTimeline(t);
});
watch(() => timelineStore.currentTime, (t) => {
  if (store.currentTime !== t) store.seek(t);
});

// ─── 快照撤销/重做后同步 prompt 文本 ─────────────────
// historyStore.undo/redo/jumpTo 只移动 currentIndex;livePromptText 是独立 ref,
// 不跟随 activeSnapshot 变化,撤销后输入框与生成所用 prompt 会停留在旧值
// (elements/tuningParams 直接绑 activeSnapshot computed,无此问题)。
// 输入防抖期内两者相等,watch 不触发,无互激循环
watch(
  () => activeSnapshot.value.promptText,
  (text) => { if (livePromptText.value !== text) livePromptText.value = text },
);

// ─── 项目脏标记:快照制历史的编辑/导航动作即视为有未保存修改 ──
// pushState(prompt/elements/tuning 编辑)、undo/redo、jumpTo(历史面板跳转)
// 均会改变持久化 payload 内容;clearHistory(重置项目)/resetWithData(打开项目)
// 是项目生命周期动作,不标脏。pinia 对 setup store 的 action 统一包装,
// 经 appStore 代理(store.undo 等)调用同样触发本 hook
snapshotHistory.$onAction(({ name, after }) => {
  if (name === 'pushState' || name === 'undo' || name === 'redo' || name === 'jumpTo') {
    after(() => projectStore.markDirty());
  }
});

// ─── 项目脏标记:patch 制历史的编辑动作(推入条目/撤销/重做)同样标脏 ──
// 不用 watch(undoCount):openProject 直接 splice 历史栈会误触大切;
// $onAction 只捕获真实 action,pushEntry/undo/redo 之外的变更不标记
patchHistory.$onAction(({ name, after }) => {
  if (name === 'pushEntry' || name === 'undo' || name === 'redo') {
    after(() => projectStore.markDirty());
  }
});

// ─── Keyboard (undo/redo) ─────────────────────────────
function handleKeyDown(e: KeyboardEvent) {
  const activeTag = document.activeElement?.tagName;
  const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) {
      if (canRedoAny.value && !isEditingText) { e.preventDefault(); handleRedo(); }
    } else {
      if (canUndoAny.value && !isEditingText) { e.preventDefault(); handleUndo(); }
    }
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
    if (canRedoAny.value && !isEditingText) { e.preventDefault(); handleRedo(); }
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

    <TopBar
      :status="runtimeStore.status"
      :current-frame="currentFrame"
      :total-frames="totalFrames"
      :theme="theme"
      :is-playing="isPlaying"
      :resolution="resolution"
      :frame-rate="frameRate"
      :can-undo="canUndoAny"
      :can-redo="canRedoAny"
      :undo-tip="undoTip"
      :redo-tip="redoTip"
      @play="store.togglePlay"
      @pause="store.togglePlay"
      @step-forward="store.stepForward"
      @step-backward="store.stepBackward"
      @jump-start="handleJumpStart"
      @jump-end="handleJumpEnd"
      @undo="handleUndo"
      @redo="handleRedo"
      @new-project="handleNewProject"
      @open-project="handleOpenProject"
      @save-project="handleSaveProject"
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
