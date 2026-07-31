import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { TuningParams, ElementTag, IRTreeNode, Clip, Track, ParameterTrack } from '../types';
import {
  initialPromptText,
  initialElements,
  initialTuningParams,
  initialIRTree,
} from '../data/presetData';
import { TOTAL_DURATION, FPS, initialTracks, initialClips } from '../data';
import { unifiedStore } from '@/storage';
import { CommandHistory, type Command } from '@/utils/commandHistory';
import { evaluateAllTracks } from '@/utils/keyframe';
import { useAssetStore } from '@/assets/assetStore';
import type { Asset } from '@/assets/types';

// ─── Types ─────────────────────────────────────────────
export interface AppStateSnapshot {
  promptText: string;
  tuningParams: TuningParams;
  elements: ElementTag[];
}

export interface HistoryRecord {
  id: string;
  timestamp: string;
  actionName: string;
  state: AppStateSnapshot;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'custom';
  modelId: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  /** 模型元数据（从 API 拉取或静态数据库查询得到） */
  metadata?: ModelMetadata;
}

/**
 * 模型元数据（上下文窗口、思考能力、限流等）。
 * 与 authoring/llm/modelRegistry 中的 ModelMetadata 结构一致，
 * 但在此独立定义以避免 store 层直接依赖 authoring 层。
 */
export interface ModelMetadata {
  /** 展示名称 */
  displayName: string;
  /** 上下文窗口大小（token 数），0 表示未知 */
  contextWindow: number;
  /** 最大输出 token 数，0 表示未知 */
  maxOutputTokens: number;
  /** 是否支持思考/推理模式 */
  supportsThinking: boolean;
  /** 是否支持视觉输入 */
  supportsVision: boolean;
  /** 是否支持函数调用 */
  supportsFunctionCalling: boolean;
  /** 是否支持图片生成 */
  supportsImageGeneration?: boolean;
  /** 是否支持视频生成 */
  supportsVideoGeneration?: boolean;
  /** 是否支持音频/音乐生成 */
  supportsAudioGeneration?: boolean;
  /** 请求频率限制（RPM） */
  rpmLimit?: number;
  /** Token 频率限制（TPM） */
  tpmLimit?: number;
}

export interface AccentColors {
  settings: string;
  image: string;
  video: string;
}

const DEFAULT_ACCENT: AccentColors = { settings: '', image: '', video: '' };

/** 将 hex 色值加深 */
function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const AUTOSAVE_KEY = 'pixelforge_autosave_v2';
const MAX_HISTORY_LENGTH = 50;

function loadSavedData() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

export const useAppStore = defineStore('app', () => {
  // ─── History State ──────────────────────────────────
  const loadedData = loadSavedData();

  const history = ref<HistoryRecord[]>([
    {
      id: 'init-0',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      actionName: '初始项目状态',
      state: {
        promptText: loadedData?.promptText ?? initialPromptText,
        elements: loadedData?.elements ?? initialElements,
        tuningParams: loadedData?.tuningParams ?? initialTuningParams,
      },
    },
  ]);
  const currentIndex = ref(0);

  const activeSnapshot = computed(() => history.value[currentIndex.value]?.state ?? history.value[0].state);
  const canUndo = computed(() => currentIndex.value > 0);
  const canRedo = computed(() => currentIndex.value < history.value.length - 1);

  // ─── App State ──────────────────────────────────────
  const activeTopTab = ref<'creation' | 'timeline' | 'preview'>('creation');
  const activeLeftTab = ref<'input' | 'image' | 'elements' | 'effects' | 'history' | 'render' | 'performance' | 'settings'>('image');

  const livePromptText = ref(activeSnapshot.value.promptText);
  let promptDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  const resolution = ref(loadedData?.resolution || '1920 × 1080');
  const frameRate = ref(loadedData?.frameRate || '30 fps');
  const treeData = ref<IRTreeNode[]>(
    Array.isArray(loadedData?.treeData) ? loadedData.treeData : initialIRTree
  );

  const currentTime = ref(0);
  const isPlaying = ref(false);
  const isExportOpen = ref(false);
  const isSettingsOpen = ref(false);
  const theme = ref(loadedData?.theme || 'dark');
  const isGenerating = ref(false);

  // ─── 全局时间轴显示开关 ─────────────────────────────
  /** 是否在底部显示全局时间轴面板（跨 Tab 可用） */
  const showTimeline = ref(false);

  /** 切换时间轴显示 */
  function toggleTimeline(): void {
    showTimeline.value = !showTimeline.value;
  }

  const autoSaveEnabled = ref(true);
  const autoSaveInterval = ref(1500);
  const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved');
  const lastSavedTime = ref<string | null>(loadedData?.savedTime || null);
  let isInitialMount = true;

  // ─── Accent Colors (per-section custom accent) ────
  const accentColors = ref<AccentColors>(
    loadedData?.accentColors ?? { ...DEFAULT_ACCENT }
  );

  function setAccentColor(section: keyof AccentColors, color: string): void {
    accentColors.value = { ...accentColors.value, [section]: color };
  }

  function resetAccentColors(): void {
    accentColors.value = { ...DEFAULT_ACCENT };
  }

  /** 根据自定义 accent 生成需要覆盖的 CSS 变量（用于 inline style） */
  function buildAccentVars(hex: string): Record<string, string> | undefined {
    if (!hex) return undefined;
    return {
      '--accent': hex,
      '--accent-hover': darkenHex(hex, 20),
      '--accent-pressed': darkenHex(hex, 40),
    };
  }

  // ─── Model Configs ──────────────────────────────────
  const modelConfigs = ref<ModelConfig[]>(
    Array.isArray(loadedData?.modelConfigs) ? loadedData.modelConfigs : []
  );
  /** 当前选中的模型配置 ID（供 AIChatPanel / ControlPanel 共享） */
  const selectedModelId = ref<string | null>(
    loadedData?.selectedModelId ?? null
  );

  /** 当前选中的模型配置对象 */
  const selectedModelConfig = computed<ModelConfig | null>(() =>
    selectedModelId.value
      ? modelConfigs.value.find((m) => m.id === selectedModelId.value) ?? null
      : null
  );

  function addModelConfig(config: Omit<ModelConfig, 'id'>): string {
    const id = `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    modelConfigs.value.push({ ...config, id });
    // 若之前没有选中模型，自动选中新添加的
    if (!selectedModelId.value) selectedModelId.value = id;
    return id;
  }

  function updateModelConfig(id: string, patch: Partial<Omit<ModelConfig, 'id'>>): void {
    const idx = modelConfigs.value.findIndex((m) => m.id === id);
    if (idx !== -1) {
      modelConfigs.value[idx] = { ...modelConfigs.value[idx], ...patch };
    }
  }

  function removeModelConfig(id: string): void {
    modelConfigs.value = modelConfigs.value.filter((m) => m.id !== id);
    // 若删除的正是当前选中模型，自动切换到第一个
    if (selectedModelId.value === id) {
      selectedModelId.value = modelConfigs.value[0]?.id ?? null;
    }
  }

  function setSelectedModel(id: string): void {
    selectedModelId.value = id;
  }

  // ─── Timeline State ────────────────────────────────
  const tracks = ref<Track[]>([...initialTracks]);
  const clips = ref<Clip[]>([...initialClips]);
  const selectedClipIds = ref<Set<string>>(new Set());

  /** Timeline 专用 CommandHistory（与 app-level history 分开） */
  const timelineHistory = new CommandHistory();
  const timelineHistoryVersion = ref(0); // 触发响应式更新

  const canUndoTimeline = computed(() => {
    void timelineHistoryVersion.value;
    return timelineHistory.canUndo();
  });
  const canRedoTimeline = computed(() => {
    void timelineHistoryVersion.value;
    return timelineHistory.canRedo();
  });

  // ─── Keyframe Animation State ─────────────────────
  const paramTracks = ref<ParameterTrack[]>([]);
  const selectedTrackId = ref<string | null>(null);

  // ─── History Actions ────────────────────────────────
  function pushState(newState: AppStateSnapshot, actionName: string) {
    const record: HistoryRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      actionName,
      state: newState,
    };

    const truncated = history.value.slice(0, currentIndex.value + 1);
    const next = [...truncated, record];
    if (next.length > MAX_HISTORY_LENGTH) {
      history.value = next.slice(next.length - MAX_HISTORY_LENGTH);
    } else {
      history.value = next;
    }
    currentIndex.value = Math.min(currentIndex.value + 1, MAX_HISTORY_LENGTH - 1);
  }

  function undo() {
    if (canUndo.value) {
      currentIndex.value--;
      livePromptText.value = activeSnapshot.value.promptText;
    }
  }

  function redo() {
    if (canRedo.value) {
      currentIndex.value++;
      livePromptText.value = activeSnapshot.value.promptText;
    }
  }

  function jumpTo(index: number) {
    if (index >= 0 && index < history.value.length) {
      currentIndex.value = index;
      livePromptText.value = activeSnapshot.value.promptText;
    }
  }

  function clearHistory() {
    const freshRecord: HistoryRecord = {
      id: `reset-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      actionName: '重置所有历史记录',
      state: activeSnapshot.value,
    };
    history.value = [freshRecord];
    currentIndex.value = 0;
  }

  // ─── Theme ──────────────────────────────────────────
  function setTheme(t: 'light' | 'dark') {
    theme.value = t;
  }

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
  }

  // ─── Playback ───────────────────────────────────────
  let rafId: number | null = null;

  function startPlayback() {
    if (!isPlaying.value) return;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      const next = currentTime.value + delta;
      if (next >= TOTAL_DURATION) {
        currentTime.value = TOTAL_DURATION;
        isPlaying.value = false;
        return;
      }
      currentTime.value = next;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopPlayback() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value;
  }

  function seek(time: number) {
    currentTime.value = Math.max(0, Math.min(TOTAL_DURATION, time));
  }

  function stepForward() {
    currentTime.value = Math.min(TOTAL_DURATION, currentTime.value + 1 / FPS);
  }

  function stepBackward() {
    currentTime.value = Math.max(0, currentTime.value - 1 / FPS);
  }

  function resetTime() {
    currentTime.value = 0;
  }

  // ─── Timeline Actions ─────────────────────────────

  /** 执行时间轴命令（入 undo/redo 栈） */
  function executeTimelineCommand(cmd: Command): void {
    timelineHistory.execute(cmd);
    timelineHistoryVersion.value++;
  }

  /** 时间轴撤销 */
  function undoTimeline(): void {
    timelineHistory.undo();
    timelineHistoryVersion.value++;
  }

  /** 时间轴重做 */
  function redoTimeline(): void {
    timelineHistory.redo();
    timelineHistoryVersion.value++;
  }

  /** 设置 clips（供 Command 使用） */
  function setClips(newClips: Clip[]): void {
    clips.value = newClips;
  }

  /** 设置 tracks */
  function setTracks(newTracks: Track[]): void {
    tracks.value = newTracks;
  }

  /** 选中 / 取消选中 Clip */
  function selectClip(clipId: string, multi = false): void {
    if (multi) {
      if (selectedClipIds.value.has(clipId)) {
        selectedClipIds.value.delete(clipId);
      } else {
        selectedClipIds.value.add(clipId);
      }
      selectedClipIds.value = new Set(selectedClipIds.value);
    } else {
      selectedClipIds.value = new Set([clipId]);
    }
  }

  /** 清除选择 */
  function clearSelection(): void {
    selectedClipIds.value = new Set();
  }

  /** 批量删除选中 Clip */
  function deleteSelectedClips(): void {
    if (selectedClipIds.value.size === 0) return;
    const toDelete = [...selectedClipIds.value];
    const snapshot = clips.value;
    const cmd: Command = {
      label: `删除 ${toDelete.length} 个片段`,
      execute() { clips.value = snapshot.filter((c) => !toDelete.includes(c.id)); },
      undo() { clips.value = snapshot; },
    };
    executeTimelineCommand(cmd);
    clearSelection();
  }

  /** 切换轨道属性 */
  function toggleTrackProp(trackId: string, prop: 'muted' | 'soloed' | 'locked' | 'visible'): void {
    tracks.value = tracks.value.map((t) =>
      t.id === trackId ? { ...t, [prop]: !t[prop] } : t,
    );
  }

  // ─── Keyframe Actions ──────────────────────────────

  /** 添加参数轨道 */
  function addParamTrack(label: string, layerId: string, parameter: string): string {
    const id = `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    paramTracks.value.push({ id, label, layerId, parameter, keyframes: [] });
    return id;
  }

  /** 删除参数轨道 */
  function removeParamTrack(trackId: string): void {
    paramTracks.value = paramTracks.value.filter((t) => t.id !== trackId);
  }

  /** 在指定时间添加关键帧 */
  function addKeyframe(trackId: string, time: number, value: number, interpolation: import('../types').Interpolation = 'linear'): void {
    const track = paramTracks.value.find((t) => t.id === trackId);
    if (!track) return;
    const existing = track.keyframes.find((k) => k.time === time);
    if (existing) {
      existing.value = value;
      return;
    }
    const id = `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    track.keyframes.push({ id, time, value, interpolation });
    track.keyframes.sort((a, b) => a.time - b.time);
  }

  /** 更新关键帧 */
  function updateKeyframe(trackId: string, keyframeId: string, time: number, value: number): void {
    const track = paramTracks.value.find((t) => t.id === trackId);
    if (!track) return;
    const kf = track.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    kf.time = Math.max(0, time);
    kf.value = value;
    track.keyframes.sort((a, b) => a.time - b.time);
  }

  /** 删除关键帧 */
  function removeKeyframe(trackId: string, keyframeId: string): void {
    const track = paramTracks.value.find((t) => t.id === trackId);
    if (!track) return;
    track.keyframes = track.keyframes.filter((k) => k.id !== keyframeId);
  }

  /** 求值当前时间的所有参数轨道 */
  function evaluateParamTracks(time: number): Array<{ track: ParameterTrack; value: number }> {
    return evaluateAllTracks(paramTracks.value, time);
  }

  // ─── Prompt / Elements / Tuning ─────────────────────
  function handlePromptTextChange(newText: string) {
    livePromptText.value = newText;
    if (promptDebounceTimer) clearTimeout(promptDebounceTimer);
    promptDebounceTimer = setTimeout(() => {
      if (newText !== activeSnapshot.value.promptText) {
        pushState(
          {
            promptText: newText,
            elements: activeSnapshot.value.elements,
            tuningParams: activeSnapshot.value.tuningParams,
          },
          '修改场景描述词'
        );
        // 持久化 prompt 历史到三层存储（L1+L2+L3）
        const ts = Date.now();
        void unifiedStore.writePrompt(ts, newText).catch((e) => {
          console.warn('[AppStore] prompt 历史写入失败', e);
        });
      }
    }, 500);
  }

  function toggleElement(id: string) {
    const updated = activeSnapshot.value.elements.map((item) =>
      item.id === id ? { ...item, active: !item.active } : item
    );
    pushState(
      {
        promptText: livePromptText.value,
        elements: updated,
        tuningParams: activeSnapshot.value.tuningParams,
      },
      '切换元素'
    );
  }

  function setTuningParams(updater: (prev: TuningParams) => TuningParams) {
    const next = updater(activeSnapshot.value.tuningParams);
    pushState(
      {
        promptText: livePromptText.value,
        elements: activeSnapshot.value.elements,
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
  /** 简单字符串 hash，用作 shader 缓存键 */
  function hashString(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return `h_${(h >>> 0).toString(16)}`;
  }

  function createGeneratedImageAsset(prompt: string): Asset | null {
    if (typeof document === 'undefined') return null;

    const width = 512;
    const height = 512;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // 基于 prompt hash 生成稳定色调
    const hash = hashString(prompt);
    const hue = parseInt(hash.slice(2, 5), 16) % 360;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${hue}, 70%, 22%)`);
    gradient.addColorStop(0.5, `hsl(${(hue + 30) % 360}, 60%, 35%)`);
    gradient.addColorStop(1, `hsl(${(hue + 70) % 360}, 70%, 25%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 随机散点模拟星空/粒子
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

    // 提示词文本
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

  function handleGenerate() {
    isGenerating.value = true;

    // 生成产物写入三层存储（L1+L2+L3）
    const prompt = livePromptText.value;
    const timestamp = Date.now();

    // 1. WGSL 着色器源码（模拟编译产物）
    const shaderHash = hashString(prompt);
    const wgslCode = `// Auto-generated WGSL for prompt: ${prompt.slice(0, 80)}\n@vertex\nfn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {\n  return vec4f(0.0, 0.0, 0.0, 1.0);\n}\n@fragment\nfn fs_main() -> @location(0) vec4f {\n  return vec4f(1.0, 0.5, 0.3, 1.0);\n}`;

    // 2. RenderIR 快照（模拟 IR 树序列化）
    const irJson = JSON.stringify({
      frame: 0,
      timestampMs: timestamp,
      prompt: prompt.slice(0, 200),
      layers: [{ id: 'layer-1', opacity: 1.0, visible: true }],
      generatedAt: new Date(timestamp).toISOString(),
    });

    // 3. 帧像素数据（模拟 4x4 RGBA 像素）
    const pixels = new Uint8Array([
      255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,
      255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,
      255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,
      255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,  255, 128, 64, 255,
    ]);

    Promise.all([
      unifiedStore.writeShader(shaderHash, wgslCode),
      unifiedStore.writeIR(0, irJson),
      unifiedStore.writeFrame(0, pixels),
      unifiedStore.writePrompt(timestamp, prompt),
    ])
      .catch((e) => {
        console.warn('[Generate] 产物写入存储失败', e);
      });

    setTimeout(() => {
      // 4. 将生成图片加入资源库，供 ResourceManagerPanel 展示
      const asset = createGeneratedImageAsset(prompt);
      if (asset) {
        const assetStore = useAssetStore();
        assetStore.add(asset);
      }
      isGenerating.value = false;
    }, 1200);
  }

  // ─── Save / Reset ───────────────────────────────────

  /** 将项目快照写入三层统一存储（L1 LRU + L2 OPFS + L3 Redb） */
  function saveToUnifiedStore(time: string) {
    const payload = JSON.stringify({
      promptText: livePromptText.value,
      elements: activeSnapshot.value.elements,
      tuningParams: activeSnapshot.value.tuningParams,
      treeData: treeData.value,
      resolution: resolution.value,
      frameRate: frameRate.value,
      theme: theme.value,
      modelConfigs: modelConfigs.value,
      selectedModelId: selectedModelId.value,
      accentColors: accentColors.value,
      savedTime: time,
    });
    void unifiedStore.writeMetadata(AUTOSAVE_KEY, payload).catch((e) => {
      console.warn('[AppStore] 统一存储写入失败', e);
    });
  }

  function handleForceSave() {
    saveStatus.value = 'saving';
    try {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const payload = JSON.stringify({
        promptText: livePromptText.value,
        elements: activeSnapshot.value.elements,
        tuningParams: activeSnapshot.value.tuningParams,
        treeData: treeData.value,
        resolution: resolution.value,
        frameRate: frameRate.value,
        theme: theme.value,
      modelConfigs: modelConfigs.value,
      selectedModelId: selectedModelId.value,
      accentColors: accentColors.value,
      savedTime: time,
    });
      // 同步写 localStorage（向后兼容，保证刷新即恢复）
      localStorage.setItem(AUTOSAVE_KEY, payload);
      // 异步写三层统一存储（持久化 + 高性能读取）
      saveToUnifiedStore(time);
      saveStatus.value = 'saved';
      lastSavedTime.value = time;
    } catch (e) {
      console.error(e);
    }
  }

  function handleResetProject() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch (e) { /* ignore */ }
    // 同步清三层存储中的项目快照
    void unifiedStore.deleteMetadata(AUTOSAVE_KEY).catch(() => {});
    livePromptText.value = initialPromptText;
    treeData.value = initialIRTree;
    resolution.value = '1920 × 1080';
    frameRate.value = '30 fps';
    theme.value = 'dark';
    accentColors.value = { ...DEFAULT_ACCENT };
    modelConfigs.value = [];
    selectedModelId.value = null;
    lastSavedTime.value = null;
    saveStatus.value = 'saved';
    clearHistory();
  }

  function setAutoSaveInterval(ms: number) {
    autoSaveInterval.value = Math.max(500, Math.min(30000, ms));
  }

  // ─── Autosave ───────────────────────────────────────
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
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const payload = JSON.stringify({
          promptText: livePromptText.value,
          elements: activeSnapshot.value.elements,
          tuningParams: activeSnapshot.value.tuningParams,
          treeData: treeData.value,
          resolution: resolution.value,
          frameRate: frameRate.value,
          theme: theme.value,
        modelConfigs: modelConfigs.value,
        selectedModelId: selectedModelId.value,
        accentColors: accentColors.value,
        savedTime: time,
      });
        // 同步写 localStorage（向后兼容）
        localStorage.setItem(AUTOSAVE_KEY, payload);
        // 异步写三层统一存储
        saveToUnifiedStore(time);
        saveStatus.value = 'saved';
        lastSavedTime.value = time;
      } catch (e) {
        console.error(e);
      }
    }, autoSaveInterval.value);
  }

  /**
   * 从三层统一存储异步加载项目快照。
   * 在 initStorage() 完成后调用，优先使用 L3/L2 中的数据。
   * 若统一存储中无数据，保持 localStorage 的同步加载结果不变。
   */
  async function loadFromUnifiedStore(): Promise<void> {
    try {
      const json = await unifiedStore.readMetadata(AUTOSAVE_KEY);
      if (!json) return;
      const data = JSON.parse(json) as {
        promptText?: string;
        elements?: ElementTag[];
        tuningParams?: TuningParams;
        treeData?: IRTreeNode[];
        resolution?: string;
        frameRate?: string;
        theme?: string;
        modelConfigs?: ModelConfig[];
        selectedModelId?: string | null;
        accentColors?: AccentColors;
        savedTime?: string;
      };
      // 统一存储有数据，覆盖 localStorage 的同步加载结果
      if (data.promptText !== undefined) livePromptText.value = data.promptText;
      if (data.resolution !== undefined) resolution.value = data.resolution;
      if (data.frameRate !== undefined) frameRate.value = data.frameRate;
      if (data.theme !== undefined) theme.value = data.theme;
      if (data.treeData !== undefined) treeData.value = data.treeData;
      if (data.savedTime !== undefined) lastSavedTime.value = data.savedTime;
      if (data.modelConfigs !== undefined) modelConfigs.value = data.modelConfigs;
      if (data.selectedModelId !== undefined) selectedModelId.value = data.selectedModelId;
      if (data.accentColors !== undefined) accentColors.value = data.accentColors;
      // 将当前状态推入 history 作为初始快照
      if (data.promptText !== undefined || data.elements !== undefined) {
        history.value = [{
          id: 'init-0',
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          actionName: '初始项目状态',
          state: {
            promptText: data.promptText ?? initialPromptText,
            elements: data.elements ?? initialElements,
            tuningParams: data.tuningParams ?? initialTuningParams,
          },
        }];
        currentIndex.value = 0;
      }
    } catch (e) {
      console.warn('[AppStore] 从统一存储加载失败，使用 localStorage 数据', e);
    }
  }

  /** 查询 prompt 历史（从三层存储读取） */
  async function loadPromptHistory(): Promise<Array<{ timestampMs: number; text: string }>> {
    try {
      return await unifiedStore.listPrompts();
    } catch (e) {
      console.warn('[AppStore] 加载 prompt 历史失败', e);
      return [];
    }
  }

  return {
    // State
    history,
    currentIndex,
    activeTopTab,
    activeLeftTab,
    livePromptText,
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
    selectedModelConfig,
    accentColors,
    // Timeline State
    tracks,
    clips,
    selectedClipIds,
    paramTracks,
    selectedTrackId,

    // Getters
    activeSnapshot,
    canUndo,
    canRedo,
    canUndoTimeline,
    canRedoTimeline,

    // Actions
    pushState,
    undo,
    redo,
    jumpTo,
    clearHistory,
    setTheme,
    toggleTheme,
    toggleTimeline,
    startPlayback,
    stopPlayback,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    resetTime,
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
    addModelConfig,
    updateModelConfig,
    removeModelConfig,
    setSelectedModel,
    setAccentColor,
    resetAccentColors,
    buildAccentVars,
    // Timeline Actions
    executeTimelineCommand,
    undoTimeline,
    redoTimeline,
    setClips,
    setTracks,
    selectClip,
    clearSelection,
    deleteSelectedClips,
    toggleTrackProp,
    // Keyframe Actions
    addParamTrack,
    removeParamTrack,
    addKeyframe,
    updateKeyframe,
    removeKeyframe,
    evaluateParamTracks,
  };
});
