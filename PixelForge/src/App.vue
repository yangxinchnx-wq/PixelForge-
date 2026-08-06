<script setup lang="ts">
import { watch, onMounted, onUnmounted, ref, nextTick, computed, reactive, defineAsyncComponent } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore } from './stores/app';
import { useRuntimeStore } from './stores/runtime';
import { useMaterialAssetStore } from './material/materialAssetStore';
import { disposeMaterialRenderBridge } from './material/materialRenderBridge';
import { useErrorStore } from './stores/errorStore';
import type { RenderIR } from './compiler/ir/renderIR';
import type { IRTreeNode } from './types';
import { Opcode } from './shared/types';
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
import PfSelect from './components/ui/PfSelect.vue';
import { pageEnter } from './composables/useAnime';
import { TOTAL_DURATION } from './data';
import { useAssetStore } from './assets/assetStore';
import {
  EXPORT_FORMATS,
  QUALITY_PRESETS,
  getQualityPreset,
  detectCodecSupport,
  downloadBlob,
  type ExportFormatId,
  type QualityLevel,
} from './media/video/encoder/videoEncoderTypes';

// ─── 异步加载重型组件（按需加载，不阻塞初始渲染）──────────
const GraphEditor = defineAsyncComponent(() => import('./components/editor/graph/GraphEditor.vue'));
const MaterialManagerPanel = defineAsyncComponent(() => import('./components/MaterialManagerPanel.vue'));
const ExportModal = defineAsyncComponent(() => import('./components/ExportModal.vue'));
const SettingsModal = defineAsyncComponent(() => import('./components/SettingsModal.vue'));

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
  showTimeline,
  autoSaveEnabled,
  autoSaveInterval,
  saveStatus,
  lastSavedTime,
  modelConfigs,
  selectedModelId,
  accentColors,
  history,
  currentIndex,
  canUndo,
  canRedo,
} = storeToRefs(store);

// ─── 其他 Pinia stores（必须在 watcher 之前初始化） ──────
const runtimeStore = useRuntimeStore();
const materialAssetStore = useMaterialAssetStore();
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
  // 检测当前设备的硬件编码能力
  void detectHardwareSupport();
  // 初始化材质资产管理
  materialAssetStore.init();
  // 初始化 WebGPU 运行时（等 DOM 渲染完成后拿 canvas ref）
  nextTick(() => { void ensureGpuCanvasInitialized(); });
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('click', onTuningDocClick);
  store.stopPlayback();
  // 销毁材质渲染桥接器（释放 GPU 纹理缓存）
  disposeMaterialRenderBridge();
});

// ─── Autosave ─────────────────────────────────────────
// 拆分 deep watcher：主 watcher 使用浅层监听（标量 / 引用变化即可检测），
// modelConfigs 单独 deep watch（因为 updateModelConfig 会原地修改数组元素的属性）
// 这样避免了 deep:true 对整个 watch 列表 11 个源做深度遍历的开销
watch(
  [livePromptText, () => activeSnapshot.value.elements, () => activeSnapshot.value.tuningParams, treeData, resolution, frameRate, theme, autoSaveEnabled, () => modelConfigs.value.length, selectedModelId, accentColors],
  () => {
    store.triggerAutosave();
  },
);
// modelConfigs 属性级变更（如修改 API Key / baseUrl）
watch(
  () => modelConfigs.value,
  () => {
    store.triggerAutosave();
  },
  { deep: true },
);

// ─── Material Asset Store ↔ GPU Device 同步 ─────────────
// 当 runtime store 的 GPU 设备初始化完成后，注入到材质 store 以启用 WebGPU 预览
watch(
  () => runtimeStore.runtime,
  (rt) => {
    if (rt?.gpu?.device) {
      materialAssetStore.setGpuDevice(rt.gpu.device as unknown as GPUDevice);
    } else {
      materialAssetStore.setGpuDevice(null);
    }
  },
  { immediate: true },
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

// ─── 可视化编程引擎（Graph Editor 浮层）──────────────────
const showGraphEditor = ref(false);

/** Opcode → 中文名称映射（用于 IR 树展示） */
const OPCODE_LABELS: Record<number, string> = {
  [Opcode.SOLID_COLOR]: '纯色填充',
  [Opcode.LINEAR_GRADIENT]: '线性渐变',
  [Opcode.NOISE]: '噪声',
  [Opcode.BLEND]: '混合',
  [Opcode.CIRCLE_SHAPE]: '圆形',
  [Opcode.IMAGE_TEXTURE]: '图片纹理',
};

/** 将 RenderIR 转换为 IRTreeNode[]（供 IRPreviewPanel 展示） */
function renderIRToTreeNodes(ir: RenderIR): IRTreeNode[] {
  const layerNodes: IRTreeNode[] = ir.layers.map((layer, i) => ({
    id: layer.id,
    name: `${OPCODE_LABELS[layer.opcode] ?? '图层'} ${i + 1}`,
    type: 'layer',
    visible: layer.visible,
    opcode: layer.opcode,
    blendMode: layer.blendMode,
    params: layer.params,
  }));

  const effectNodes: IRTreeNode[] = ir.effects.map((effect, i) => ({
    id: effect.id,
    name: `效果 ${i + 1} (${effect.type})`,
    type: 'effect',
    targetLayer: effect.targetLayer,
    params: effect.params,
  }));

  const nodes: IRTreeNode[] = [];
  if (layerNodes.length > 0) {
    nodes.push({
      id: 'layers-group',
      name: `图层 (${layerNodes.length})`,
      type: 'group',
      children: layerNodes,
    });
  }
  if (effectNodes.length > 0) {
    nodes.push({
      id: 'effects-group',
      name: `效果 (${effectNodes.length})`,
      type: 'group',
      children: effectNodes,
    });
  }
  if (nodes.length === 0) {
    nodes.push({
      id: 'empty',
      name: '空 IR（无图层）',
      type: 'empty',
    });
  }
  return nodes;
}

/** GraphEditor 编译产物 → runtime store + IR 树更新 */
function handleApplyIR(ir: RenderIR) {
  try {
    // 1. 推送到 runtime store（触发 GPU 重渲染）
    runtimeStore.setRenderIR(ir);

    // 2. 更新 appStore 的 IR 树（供 IRPreviewPanel 展示）
    treeData.value = renderIRToTreeNodes(ir);

    // 3. 关闭 Graph Editor 浮层
    showGraphEditor.value = false;
  } catch (e) {
    errorStore.push(e, '可视化编程引擎编译产物应用失败');
    showGraphEditor.value = false;
  }
}

/** WorkflowPanel 步骤点击 → 打开对应功能 */
function handleWorkflowStepClick(stepId: string) {
  switch (stepId) {
    case 'input':
      // 跳转到 AI 对话面板
      activeLeftTab.value = 'image';
      break;
    case 'parse':
      // 打开可视化编程引擎
      showGraphEditor.value = true;
      break;
    case 'generate':
      // 触发生成
      void store.handleGenerate();
      break;
    case 'postprocess':
      // 切换到效果页面（如果有效果 tab）或跳转到 input tab 的调参面板
      activeLeftTab.value = 'input';
      break;
    case 'export':
      // 打开导出面板
      activeLeftTab.value = 'render';
      break;
  }
}

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

// ─── 渲染/导出设置 (WebCodecs 硬件加速) ────────────────
const assetStore = useAssetStore();

const renderFormat = ref<ExportFormatId>('h264');
const renderQuality = ref<QualityLevel>('high');
const renderTargetBitrate = ref(10); // Mbps
const renderPerImageDuration = ref(3); // 每张图片展示秒数
const renderOutputName = ref('PixelForge_Export');
const isExporting = ref(false);
const exportProgress = ref(0);
const exportError = ref<string | null>(null);
const exportDone = ref(false);

/** 编解码器硬件支持状态 */
const codecSupport = reactive<Record<ExportFormatId, boolean>>({
  h264: true,
  hevc: true,
  av1: true,
  vp9: true,
});
const isCodecDetecting = ref(true);

/** PfSelect 选项：格式（不支持的自动禁用并标注） */
const formatOpts = computed(() =>
  EXPORT_FORMATS.map((fmt) => ({
    value: fmt.id,
    label: codecSupport[fmt.id] ? fmt.label : `${fmt.label}（当前设备不支持）`,
    disabled: !codecSupport[fmt.id],
  })),
);

/** PfSelect 选项：质量等级（鼠标悬停显示详细说明） */
const qualityOpts = computed(() =>
  QUALITY_PRESETS.map((p) => ({
    value: p.id,
    label: p.label,
    tooltip: p.tooltip,
  })),
);

/** 解析分辨率字符串为数值 */
const parsedResolution = computed(() => {
  const m = resolution.value.match(/(\d+)\s*[×x]\s*(\d+)/);
  return m ? { w: parseInt(m[1]), h: parseInt(m[2]) } : { w: 1920, h: 1080 };
});

/** 解析帧率字符串为数值 */
const parsedFps = computed(() => {
  const m = frameRate.value.match(/(\d+)/);
  return m ? parseInt(m[1]) : 30;
});

/** 导出总时长（基于图片数量 × 每张展示时长） */
const exportDuration = computed(() => {
  const imageCount = assetStore.images.length;
  if (imageCount === 0) return 0;
  return imageCount * renderPerImageDuration.value;
});

/** 当前选择的格式信息 */
const currentFormatInfo = computed(() =>
  EXPORT_FORMATS.find((f) => f.id === renderFormat.value),
);

const estimatedFileSize = computed(() => {
  const duration = exportDuration.value;
  if (duration === 0) return '—';
  // 实际码率 = 用户设定码率 × 质量等级倍率
  const qualityPreset = getQualityPreset(renderQuality.value);
  const actualBitrate = renderTargetBitrate.value * qualityPreset.bitrateMultiplier;
  const sizeMB = (actualBitrate * duration) / 8; // Mbps * seconds / 8 = MB
  if (sizeMB >= 1024) return `${(sizeMB / 1024).toFixed(2)} GB`;
  return `${sizeMB.toFixed(1)} MB`;
});

/** 导出按钮是否可用 */
const canExport = computed(() => {
  return (
    !isExporting.value &&
    !isCodecDetecting.value &&
    assetStore.images.length > 0 &&
    codecSupport[renderFormat.value]
  );
});

/** 导出按钮提示文本 */
const exportBtnTooltip = computed(() => {
  if (isCodecDetecting.value) return '正在检测硬件编码支持…';
  if (assetStore.images.length === 0) return '没有可导出的图片，请先导入或生成图片';
  if (!codecSupport[renderFormat.value]) return '当前设备不支持此编码格式';
  return '';
});

/** 运行时检测硬件编码能力 */
async function detectHardwareSupport() {
  isCodecDetecting.value = true;
  try {
    const { w, h } = parsedResolution.value;
    const bitrate = renderTargetBitrate.value * 1_000_000; // Mbps → bps
    const support = await detectCodecSupport(w, h, bitrate);
    for (const fmt of EXPORT_FORMATS) {
      codecSupport[fmt.id] = support.get(fmt.id) ?? false;
    }
    // 如果当前选中的格式不支持，自动切换到第一个支持的格式
    if (!codecSupport[renderFormat.value]) {
      const firstSupported = EXPORT_FORMATS.find((f) => codecSupport[f.id]);
      if (firstSupported) {
        renderFormat.value = firstSupported.id;
      }
    }
  } catch (e) {
    console.error('[Export] 编解码器检测失败:', e);
  } finally {
    isCodecDetecting.value = false;
  }
}

/** 执行真实导出 */
async function startExport() {
  if (isExporting.value) return;
  if (assetStore.images.length === 0) {
    exportError.value = '没有可导出的图片，请先在画布中导入或生成图片';
    return;
  }

  isExporting.value = true;
  exportProgress.value = 0;
  exportError.value = null;
  exportDone.value = false;

  try {
    const formatInfo = currentFormatInfo.value;
    if (!formatInfo) throw new Error('未知的导出格式');

    const { w, h } = parsedResolution.value;
    const imageUrls = assetStore.images.map((a) => a.url);

    // 动态加载重型视频编码模块（mp4-muxer / webm-muxer 仅在导出时加载）
    const { encodeImagesToVideo } = await import('./media/video/encoder/videoEncoder');
    const blob = await encodeImagesToVideo({
      imageUrls,
      width: w,
      height: h,
      fps: parsedFps.value,
      perImageDuration: renderPerImageDuration.value,
      bitrate: renderTargetBitrate.value * 1_000_000, // Mbps → bps
      format: renderFormat.value,
      quality: renderQuality.value,
      onProgress: (p) => {
        exportProgress.value = p;
      },
    });

    const filename = `${renderOutputName.value || 'PixelForge_Export'}.${formatInfo.ext}`;
    downloadBlob(blob, filename);

    exportDone.value = true;
  } catch (e) {
    exportError.value = (e as Error).message;
    console.error('[Export] 导出失败:', e);
  } finally {
    isExporting.value = false;
  }
}

// 分辨率变化时重新检测硬件支持（码率变化用防抖，避免滑块拖动时风暴）
let detectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch([resolution, renderTargetBitrate], () => {
  if (detectDebounceTimer) clearTimeout(detectDebounceTimer);
  detectDebounceTimer = setTimeout(() => {
    void detectHardwareSupport();
    detectDebounceTimer = null;
  }, 600);
});
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
        <div v-show="activeLeftTab === 'image'" class="pf-workspace" :style="store.buildAccentVars(accentColors.image)">
          <div class="pf-workspace-top">
            <!-- 左侧：AI 对话 -->
            <AIChatPanel />

            <!-- 中间：画布 -->
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

            <!-- 右侧：资源管理 -->
            <div style="width: var(--panel-right-width); flex-shrink: 0; min-height: 0">
              <ResourceManagerPanel @select-asset="onResourceSelect" />
            </div>
          </div>

          <!-- 底部：工作流（贯穿整个底部） -->
          <WorkflowPanel @step-click="handleWorkflowStepClick" />
        </div>

        <!-- Elements Page — Material Manager -->
        <div v-show="activeLeftTab === 'elements'" class="pf-page">
          <MaterialManagerPanel style="flex: 1; min-height: 0;" />
        </div>

        <!-- Effects Page -->
        <div v-show="activeLeftTab === 'effects'" class="pf-page">
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
        <div v-show="activeLeftTab === 'history'" class="pf-page">
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
          v-show="activeLeftTab === 'performance'"
        />

        <!-- Render Page — WebCodecs 硬件加速导出界面 -->
        <div v-show="activeLeftTab === 'render'" class="pf-render">
          <!-- 左栏：设置区 -->
          <div class="pf-render-settings">
            <!-- 格式 -->
            <div class="pf-panel">
              <div class="pf-panel-header">
                <span class="pf-panel-title">格式</span>
                <span v-if="isCodecDetecting" class="pf-render-detect-hint">检测硬件支持中…</span>
              </div>
              <div class="pf-panel-body">
                <div class="pf-render-row">
                  <label class="pf-render-label">导出格式</label>
                  <PfSelect v-model="renderFormat" :options="formatOpts" />
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">质量等级</label>
                  <PfSelect v-model="renderQuality" :options="qualityOpts" />
                </div>
              </div>
            </div>

            <!-- 视频设置 -->
            <div class="pf-panel">
              <div class="pf-panel-header">
                <span class="pf-panel-title">视频</span>
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
                  <label class="pf-render-label">每张图片时长</label>
                  <div class="pf-render-bitrate">
                    <input type="range" class="pf-slider" min="0.5" max="10" step="0.5" v-model.number="renderPerImageDuration" />
                    <span class="pf-render-bitrate-val">{{ renderPerImageDuration }} 秒</span>
                  </div>
                </div>
                <div class="pf-render-row">
                  <label class="pf-render-label">目标码率</label>
                  <div class="pf-render-bitrate">
                    <input type="range" class="pf-slider" min="1" max="50" step="0.5" v-model.number="renderTargetBitrate" />
                    <span class="pf-render-bitrate-val">{{ renderTargetBitrate }} Mbps</span>
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
                    <span class="pf-render-summary-val">{{ currentFormatInfo?.label ?? '—' }}</span>
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
                    <span class="pf-render-summary-label">图片数</span>
                    <span class="pf-render-summary-val">{{ assetStore.images.length }} 张</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">时长</span>
                    <span class="pf-render-summary-val">{{ exportDuration.toFixed(1) }} s</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">质量</span>
                    <span class="pf-render-summary-val">{{ getQualityPreset(renderQuality).label }}</span>
                  </div>
                  <div class="pf-render-summary-item">
                    <span class="pf-render-summary-label">实际码率</span>
                    <span class="pf-render-summary-val">{{ (renderTargetBitrate * getQualityPreset(renderQuality).bitrateMultiplier).toFixed(1) }} Mbps</span>
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

                <!-- 错误信息 -->
                <div v-if="exportError" class="pf-render-export-error">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{{ exportError }}</span>
                </div>

                <!-- 成功提示 -->
                <div v-if="exportDone && !isExporting" class="pf-render-export-success">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>导出完成，文件已开始下载</span>
                </div>

                <button
                  class="btn-primary pf-render-export-btn"
                  :disabled="!canExport"
                  :title="exportBtnTooltip"
                  @click="startExport"
                >
                  <svg v-if="!isExporting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                  </svg>
                  <svg v-else class="pf-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {{ isExporting ? '编码中…' : '开始导出' }}
                </button>
                <p v-if="assetStore.images.length === 0 && !isCodecDetecting" class="pf-render-hint">
                  请先在「图片」页面导入或生成图片
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Performance Page (moved to PerformancePanel component above) -->
      </div>
    </div>

    <!-- 全局时间轴面板（通过 TopHeader 按钮控制，跨 Tab 可用） -->
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

    <!-- 可视化编程引擎（Graph Editor 浮层）— v-if 确保首次使用时才加载异步 chunk -->
    <GraphEditor
      v-if="showGraphEditor"
      :visible="showGraphEditor"
      @update:visible="showGraphEditor = $event"
      @apply-i-r="handleApplyIR"
    />
</div>
</template>
