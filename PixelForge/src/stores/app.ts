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
import { darkenHex, hashString } from '@/utils/colorUtils';
import { buildPersistPayload, persistAll, loadPersistedData, clearPersistedData } from '@/composables/usePersist';

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
  function createGeneratedImageAsset(prompt: string): Asset | null {
    if (typeof document === 'undefined') return null;

    const width = 512;
    const height = 512;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const hash = hashString(prompt);
    const hue = parseInt(hash.slice(2, 5), 16) % 360;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${hue}, 70%, 22%)`);
    gradient.addColorStop(0.5, `hsl(${(hue + 30) % 360}, 60%, 35%)`);
    gradient.addColorStop(1, `hsl(${(hue + 70) % 360}, 70%, 25%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    let seed = parseInt(hash.slice(5, 10), 16) || 1;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 80; i++) {
      const x = rnd() * width;
      const y = rnd() * height;
      const r = rnd() * 1.8 + 0.4;
      ctx.globalAlpha = rnd() * 0.7 + 0.3;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = 'bold 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayPrompt = prompt.length > 18 ? prompt.slice(0, 18) + '…' : prompt || 'AI Generated';
    ctx.fillText(displayPrompt, width / 2, height / 2 - 12);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.font = '14px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('512 × 512 · PixelForge', width / 2, height / 2 + 22);

    const dataUrl = canvas.toDataURL('image/png');
    const binary = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const timestamp = Date.now();
    return {
      id: `gen-${timestamp}`,
      name: `AI生成_${new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })}.png`,
      type: 'image',
      url: dataUrl,
      thumbnail: dataUrl,
      width,
      height,
      size: bytes.length,
      createdAt: timestamp,
      mimeType: 'image/png',
    };
  }

  async function handleGenerate() {
    isGenerating.value = true;

    const prompt = livePromptText.value;
    const timestamp = Date.now();

    await modelConfigStore.callSelectedModel(
      prompt,
      '你是一个创意图片生成助手。请根据用户的描述，生成一段简洁的创意说明文字。',
    );

    const shaderHash = hashString(prompt);
    const wgslCode = `// Auto-generated WGSL for prompt: ${prompt.slice(0, 80)}\n@vertex\nfn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {\n  return vec4f(0.0, 0.0, 0.0, 1.0);\n}\n@fragment\nfn fs_main() -> @location(0) vec4f {\n  return vec4f(1.0, 0.5, 0.3, 1.0);\n}`;

    const irJson = JSON.stringify({
      frame: 0,
      timestampMs: timestamp,
      prompt: prompt.slice(0, 200),
      layers: [{ id: 'layer-1', opacity: 1.0, visible: true }],
      generatedAt: new Date(timestamp).toISOString(),
    });

    const pixels = new Uint8Array([
      255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255,
      255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255,
      255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255,
      255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255, 255, 128, 64, 255,
    ]);

    Promise.all([
      unifiedStore.writeShader(shaderHash, wgslCode),
      unifiedStore.writeIR(0, irJson),
      unifiedStore.writeFrame(0, pixels),
      unifiedStore.writePrompt(timestamp, prompt),
    ]).catch((e) => {
      console.warn('[Generate] 产物写入存储失败', e);
    });

    setTimeout(() => {
      const asset = createGeneratedImageAsset(prompt);
      if (asset) {
        const assetStore = useAssetStore();
        assetStore.add(asset);
      }
      isGenerating.value = false;
    }, 1200);
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
