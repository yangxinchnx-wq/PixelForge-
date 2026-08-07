/**
 * App Store — 顶层编排器。
 *
 * 职责拆分为子 store 后，此文件仅保留：
 *   - UI 全局状态（tab / theme / modal / resolution 等）
 *   - Prompt + 元素 + 画面参数管理
 *   - IR 树状态
 *   - 生成（handleGenerate）
 *   - 持久化编排（autosave / forceSave / loadFromUnifiedStore）
 *   - Accent 颜色主题
 *
 * 子 store 通过 `useXxxStore()` 在 setup 函数内调用并代理其属性，
 * 保证 `useAppStore()` 的所有现有消费者零改动即可继续工作。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TuningParams, IRTreeNode } from '../types';
import { initialPromptText, initialElements, initialTuningParams, initialIRTree } from '../data/presetData';
import { unifiedStore } from '@/storage';
import { useAssetStore } from '@/assets/assetStore';
import type { Asset } from '@/assets/types';
import { darkenHex } from '@/utils/colorUtils';
import { buildPersistPayload, persistAll, loadPersistedData, clearPersistedData } from '@/composables/usePersist';
import { llmParse } from '@/authoring/llm/llmParser';
import { generateDefaultRegion } from '@/authoring/generator/renderIRGenerator';
import { stableLayerId, stableRegionId } from '@/shared/ids';
import type { RenderIR, Layer, Region, Effect } from '@/compiler/ir/renderIR';
import type { ParsedIntent } from '@/authoring/types';
import type { BlendMode, SourceKind } from '@/shared/types';
import { useRuntimeStore } from './runtime';

// ─── 子 store 引入 ─────────────────────────────────────
import { useHistoryStore, type AppStateSnapshot, type HistoryRecord } from './historyStore';
import { usePlaybackStore } from './playbackStore';
import { useTimelineStore } from './timelineStore';
import { useKeyframeStore } from './keyframeStore';
import { useModelConfigStore, type ModelConfig, type ModelMetadata, type AccentColors } from './modelConfigStore';

// 重新导出子 store 类型，保持向后兼容
export type { AppStateSnapshot, HistoryRecord, ModelConfig, ModelMetadata, AccentColors };

const AUTOSAVE_KEY = 'pixelforge_autosave_v2';

const DEFAULT_ACCENT: AccentColors = { settings: '', image: '', video: '' };

function loadSavedData() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

export const useAppStore = defineStore('app', () => {
  // ─── 子 store 初始化 ────────────────────────────────
  const historyStore = useHistoryStore();
  const playbackStore = usePlaybackStore();
  const timelineStore = useTimelineStore();
  const keyframeStore = useKeyframeStore();
  const modelConfigStore = useModelConfigStore();

  const loadedData = loadSavedData();

  // ─── UI 全局状态（本 store 自有）────────────────────
  const activeTopTab = ref<'creation' | 'timeline' | 'preview'>('creation');
  const activeLeftTab = ref<'input' | 'image' | 'elements' | 'effects' | 'history' | 'render' | 'performance' | 'settings'>('image');

  const livePromptText = ref(historyStore.activeSnapshot.promptText);
  let promptDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const resolution = ref(loadedData?.resolution || '1920 × 1080');
  const frameRate = ref(loadedData?.frameRate || '30 fps');
  const treeData = ref<IRTreeNode[]>(
    Array.isArray(loadedData?.treeData) ? loadedData.treeData : initialIRTree
  );

  const isExportOpen = ref(false);
  const isSettingsOpen = ref(false);
  const theme = ref(loadedData?.theme || 'dark');
  const isGenerating = ref(false);

  // ─── Accent Colors ──────────────────────────────────
  const accentColors = ref<AccentColors>(
    loadedData?.accentColors ?? { ...DEFAULT_ACCENT }
  );

  function setAccentColor(section: keyof AccentColors, color: string): void {
    accentColors.value = { ...accentColors.value, [section]: color };
  }

  function resetAccentColors(): void {
    accentColors.value = { ...DEFAULT_ACCENT };
  }

  function buildAccentVars(hex: string): Record<string, string> | undefined {
    if (!hex) return undefined;
    return {
      '--accent': hex,
      '--accent-hover': darkenHex(hex, 20),
      '--accent-pressed': darkenHex(hex, 40),
    };
  }

  // ─── 持久化状态 ─────────────────────────────────────
  const autoSaveEnabled = ref(true);
  const autoSaveInterval = ref(1500);
  const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved');
  const lastSavedTime = ref<string | null>(loadedData?.savedTime || null);
  let isInitialMount = true;

  // ─── Theme ──────────────────────────────────────────
  function setTheme(t: 'light' | 'dark') {
    theme.value = t;
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  // ─── Prompt / Elements / Tuning ─────────────────────
  function handlePromptTextChange(newText: string) {
    livePromptText.value = newText;
    if (promptDebounceTimer) clearTimeout(promptDebounceTimer);
    promptDebounceTimer = setTimeout(() => {
      if (newText !== historyStore.activeSnapshot.promptText) {
        historyStore.pushState(
          {
            promptText: newText,
            elements: historyStore.activeSnapshot.elements,
            tuningParams: historyStore.activeSnapshot.tuningParams,
          },
          '修改场景描述词'
        );
        const ts = Date.now();
        void unifiedStore.writePrompt(ts, newText).catch((e) => {
          console.warn('[AppStore] prompt 历史写入失败', e);
        });
      }
    }, 500);
  }

  function toggleElement(id: string) {
    const updated = historyStore.activeSnapshot.elements.map((item) =>
      item.id === id ? { ...item, active: !item.active } : item
    );
    historyStore.pushState(
      {
        promptText: livePromptText.value,
        elements: updated,
        tuningParams: historyStore.activeSnapshot.tuningParams,
      },
      '切换元素'
    );
  }

  function setTuningParams(updater: (prev: TuningParams) => TuningParams) {
    const next = updater(historyStore.activeSnapshot.tuningParams);
    historyStore.pushState(
      {
        promptText: livePromptText.value,
        elements: historyStore.activeSnapshot.elements,
        tuningParams: next,
      },
      '调整画面参数'
    );
  }

  function toggleIRVisibility(id: string) {
    const toggle = (nodes: IRTreeNode[]): IRTreeNode[] =>
      nodes.map((n) =>
        n.id === id
          ? { ...n, visible: !n.visible }
          : n.children
          ? { ...n, children: toggle(n.children) }
          : n
      );
    treeData.value = toggle(treeData.value);
  }

  // ─── Generate ───────────────────────────────────────

  /**
   * 从 GPU canvas 截图的 dataURL 创建 Asset 记录。
   * 替代旧的占位图生成逻辑，使用真实渲染结果。
   */
  function createAssetFromCanvas(
    dataUrl: string,
    prompt: string,
    width: number,
    height: number,
  ): Asset | null {
    // 计算文件大小（dataURL base64 解码后的字节数）
    const base64 = dataUrl.split(',')[1] ?? '';
    const size = Math.floor(base64.length * 0.75);

    const timestamp = Date.now();
    const displayPrompt = prompt.length > 20 ? prompt.slice(0, 20) + '…' : (prompt || 'AI Generated');
    return {
      id: `gen-${timestamp}`,
      name: `${displayPrompt}_${new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })}.png`,
      type: 'image',
      url: dataUrl,
      thumbnail: dataUrl,
      width,
      height,
      size,
      createdAt: timestamp,
      mimeType: 'image/png',
    };
  }

  /**
   * ParsedIntent → RenderIR 转换器。
   *
   * 将 LLM 解析出的结构化图层描述转为完整的渲染指令，
   * 包括 Layer（含稳定 ID）、Region（全画布）和 Effect。
   */
  function parsedIntentToRenderIR(intent: ParsedIntent): RenderIR {
    const canvasW = parseInt(resolution.value.split('×')[0].trim()) || 1920;
    const canvasH = parseInt(resolution.value.split('×')[1].trim()) || 1080;

    // ParsedLayerIntent → Layer
    const layers: Layer[] = intent.layers.map((li, i) => {
      const contentKey = `${i}_${li.opcode}_${li.label ?? ''}_${JSON.stringify(li.params)}`;
      const paramOwnership: Record<string, string> = {};
      for (const key of Object.keys(li.params)) {
        paramOwnership[key] = 'l2_parser';
      }
      return {
        id: stableLayerId('llm_parser', contentKey),
        opcode: li.opcode,
        params: li.params,
        source: 'llm_parser' as SourceKind,
        paramOwnership: paramOwnership as never,
        visible: true,
        blendMode: (li.blendMode ?? 'normal') as BlendMode,
      };
    });

    // 默认 Region（覆盖全画布，引用所有 Layer）
    const regions: Region[] = [];
    if (layers.length > 0) {
      regions.push(generateDefaultRegion(layers));
    }

    // ParsedEffectIntent → Effect
    const effects: Effect[] = (intent.effects ?? []).map((ei, i) => {
      const contentKey = `${i}_${ei.type}_${JSON.stringify(ei.params)}`;
      return {
        id: stableRegionId('llm_parser', contentKey), // 复用 stableRegionId
        type: ei.type as string,
        params: ei.params,
        targetLayer: ei.targetLayer ?? layers[0]?.id ?? '',
        targetRegion: ei.targetRegion ?? regions[0]?.id ?? '',
      } as Effect;
    });

    return {
      canvas: { width: canvasW, height: canvasH },
      layers,
      regions,
      effects,
      compileHints: {},
    };
  }

  async function handleGenerate() {
    isGenerating.value = true;

    const prompt = livePromptText.value;
    const timestamp = Date.now();

    try {
      // 获取当前模型的 LLM 配置
      const selectedConfig = modelConfigStore.selectedModelConfig;
      const providerConfig = selectedConfig
        ? modelConfigStore.modelConfigToLLMConfig(selectedConfig)
        : null;

      // 调用 LLM 解析管线：自然语言 → ParsedIntent
       const parseResult = await llmParse(prompt, {
         providerConfig: providerConfig ?? undefined,
         temperature: 0.3,
         maxTokens: 8000, // 推理模型需要更多 token
       });

      console.log('[Generate] LLM 解析结果:', {
        usedLLM: parseResult.usedLLM,
        layerCount: parseResult.intent.layers.length,
        warnings: parseResult.warnings,
      });

      // ParsedIntent → RenderIR
      const ir = parsedIntentToRenderIR(parseResult.intent);

      // 驱动 GPU 渲染（等待完成后再截图）
      const runtimeStore = useRuntimeStore();
      await runtimeStore.setRenderIR(ir);

      // 持久化产物
      const irJson = JSON.stringify(ir);
      Promise.all([
        unifiedStore.writeIR(0, irJson),
        unifiedStore.writePrompt(timestamp, prompt),
      ]).catch((e) => {
        console.warn('[Generate] 产物写入存储失败', e);
      });

      // 截取真实 GPU 渲染画面作为资产
      const dataUrl = await runtimeStore.captureCanvas();
      if (dataUrl) {
        const asset = createAssetFromCanvas(dataUrl, prompt, ir.canvas.width, ir.canvas.height);
        if (asset) {
          const assetStore = useAssetStore();
          assetStore.add(asset);
        }
      }
    } catch (e) {
      console.error('[Generate] 生成失败:', e);
    } finally {
      isGenerating.value = false;
    }
  }

  // ─── 持久化（统一使用 buildPersistPayload + persistAll）──

  /** 收集当前可持久化状态 */
  function _collectPayload() {
    return {
      promptText: livePromptText.value,
      elements: historyStore.activeSnapshot.elements,
      tuningParams: historyStore.activeSnapshot.tuningParams,
      treeData: treeData.value,
      resolution: resolution.value,
      frameRate: frameRate.value,
      theme: theme.value,
      modelConfigs: modelConfigStore.modelConfigs,
      selectedModelId: modelConfigStore.selectedModelId,
      accentColors: accentColors.value,
    };
  }

  function handleForceSave() {
    saveStatus.value = 'saving';
    try {
      const payload = buildPersistPayload(_collectPayload());
      const { time } = persistAll(payload);
      saveStatus.value = 'saved';
      lastSavedTime.value = time;
    } catch (e) {
      console.error(e);
    }
  }

  function handleResetProject() {
    void clearPersistedData();
    livePromptText.value = initialPromptText;
    treeData.value = initialIRTree;
    resolution.value = '1920 × 1080';
    frameRate.value = '30 fps';
    theme.value = 'dark';
    accentColors.value = { ...DEFAULT_ACCENT };
    modelConfigStore.modelConfigs = [];
    modelConfigStore.selectedModelId = null;
    lastSavedTime.value = null;
    saveStatus.value = 'saved';
    historyStore.clearHistory();
  }

  function setAutoSaveInterval(ms: number) {
    autoSaveInterval.value = Math.max(500, Math.min(30000, ms));
  }

  function triggerAutosave() {
    if (isInitialMount) {
      isInitialMount = false;
      return;
    }
    if (!autoSaveEnabled.value) return;
    saveStatus.value = 'unsaved';
    setTimeout(() => {
      saveStatus.value = 'saving';
      try {
        const payload = buildPersistPayload(_collectPayload());
        const { time } = persistAll(payload);
        saveStatus.value = 'saved';
        lastSavedTime.value = time;
      } catch (e) {
        console.error(e);
      }
    }, autoSaveInterval.value);
  }

  async function loadFromUnifiedStore(): Promise<void> {
    try {
      const data = await loadPersistedData();
      if (!data) return;
      if (data.promptText !== undefined) livePromptText.value = data.promptText;
      if (data.resolution !== undefined) resolution.value = data.resolution;
      if (data.frameRate !== undefined) frameRate.value = data.frameRate;
      if (data.theme !== undefined) theme.value = data.theme;
      if (data.treeData !== undefined) treeData.value = data.treeData;
      if (data.savedTime !== undefined) lastSavedTime.value = data.savedTime;
      if (data.modelConfigs !== undefined) modelConfigStore.modelConfigs = data.modelConfigs;
      if (data.selectedModelId !== undefined) modelConfigStore.selectedModelId = data.selectedModelId;
      if (data.accentColors !== undefined) accentColors.value = data.accentColors;
      if (data.promptText !== undefined || data.elements !== undefined) {
        historyStore.resetWithData(
          data.promptText ?? initialPromptText,
          data.elements ?? initialElements,
          data.tuningParams ?? initialTuningParams,
        );
      }
    } catch (e) {
      console.warn('[AppStore] 从统一存储加载失败，使用 localStorage 数据', e);
    }
  }

  async function loadPromptHistory(): Promise<Array<{ timestampMs: number; text: string }>> {
    try {
      return await unifiedStore.listPrompts();
    } catch (e) {
      console.warn('[AppStore] 加载 prompt 历史失败', e);
      return [];
    }
  }

  // ─── 导出：本 store 自有 + 子 store 代理 ─────────────
  return {
    // ── 本 store 自有状态 ──
    activeTopTab,
    activeLeftTab,
    livePromptText,
    resolution,
    frameRate,
    treeData,
    isExportOpen,
    isSettingsOpen,
    theme,
    isGenerating,
    autoSaveEnabled,
    autoSaveInterval,
    saveStatus,
    lastSavedTime,
    accentColors,

    // ── 本 store 自有 actions ──
    setTheme,
    toggleTheme,
    handlePromptTextChange,
    toggleElement,
    setTuningParams,
    toggleIRVisibility,
    handleGenerate,
    handleForceSave,
    handleResetProject,
    setAutoSaveInterval,
    triggerAutosave,
    loadFromUnifiedStore,
    loadPromptHistory,
    setAccentColor,
    resetAccentColors,
    buildAccentVars,

    // ── History Store 代理（直接赋值 ref，Pinia 自动解包）──
    history: historyStore.history,
    currentIndex: historyStore.currentIndex,
    activeSnapshot: historyStore.activeSnapshot,
    canUndo: historyStore.canUndo,
    canRedo: historyStore.canRedo,
    pushState: historyStore.pushState,
    undo: historyStore.undo,
    redo: historyStore.redo,
    jumpTo: historyStore.jumpTo,
    clearHistory: historyStore.clearHistory,

    // ── Playback Store 代理 ──
    currentTime: playbackStore.currentTime,
    isPlaying: playbackStore.isPlaying,
    startPlayback: playbackStore.startPlayback,
    stopPlayback: playbackStore.stopPlayback,
    togglePlay: playbackStore.togglePlay,
    seek: playbackStore.seek,
    stepForward: playbackStore.stepForward,
    stepBackward: playbackStore.stepBackward,
    resetTime: playbackStore.resetTime,

    // ── Timeline Store 代理 ──
    tracks: timelineStore.tracks,
    clips: timelineStore.clips,
    selectedClipIds: timelineStore.selectedClipIds,
    showTimeline: timelineStore.showTimeline,
    canUndoTimeline: timelineStore.canUndoTimeline,
    canRedoTimeline: timelineStore.canRedoTimeline,
    toggleTimeline: timelineStore.toggleTimeline,
    executeTimelineCommand: timelineStore.executeTimelineCommand,
    undoTimeline: timelineStore.undoTimeline,
    redoTimeline: timelineStore.redoTimeline,
    setClips: timelineStore.setClips,
    setTracks: timelineStore.setTracks,
    selectClip: timelineStore.selectClip,
    clearSelection: timelineStore.clearSelection,
    deleteSelectedClips: timelineStore.deleteSelectedClips,
    toggleTrackProp: timelineStore.toggleTrackProp,

    // ── Keyframe Store 代理 ──
    paramTracks: keyframeStore.paramTracks,
    selectedTrackId: keyframeStore.selectedTrackId,
    addParamTrack: keyframeStore.addParamTrack,
    removeParamTrack: keyframeStore.removeParamTrack,
    addKeyframe: keyframeStore.addKeyframe,
    updateKeyframe: keyframeStore.updateKeyframe,
    removeKeyframe: keyframeStore.removeKeyframe,
    evaluateParamTracks: keyframeStore.evaluateParamTracks,

    // ── Model Config Store 代理 ──
    modelConfigs: modelConfigStore.modelConfigs,
    selectedModelId: modelConfigStore.selectedModelId,
    selectedModelConfig: modelConfigStore.selectedModelConfig,
    addModelConfig: modelConfigStore.addModelConfig,
    updateModelConfig: modelConfigStore.updateModelConfig,
    removeModelConfig: modelConfigStore.removeModelConfig,
    setSelectedModel: modelConfigStore.setSelectedModel,
    callSelectedModel: modelConfigStore.callSelectedModel,
  };
});
