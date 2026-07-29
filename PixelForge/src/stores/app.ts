import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { TuningParams, ElementTag, IRTreeNode } from '../types';
import {
  initialPromptText,
  initialElements,
  initialTuningParams,
  initialIRTree,
} from '../data/presetData';
import { TOTAL_DURATION, FPS } from '../data';

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
  const activeLeftTab = ref<'input' | 'scene' | 'elements' | 'effects' | 'history' | 'render' | 'performance' | 'settings'>('input');

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

  const autoSaveEnabled = ref(true);
  const saveStatus = ref<'saved' | 'saving' | 'unsaved'>('saved');
  const lastSavedTime = ref<string | null>(loadedData?.savedTime || null);
  let isInitialMount = true;

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
  function handleGenerate() {
    isGenerating.value = true;
    setTimeout(() => {
      isGenerating.value = false;
    }, 1200);
  }

  // ─── Save / Reset ───────────────────────────────────
  function handleForceSave() {
    saveStatus.value = 'saving';
    try {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          promptText: livePromptText.value,
          elements: activeSnapshot.value.elements,
          tuningParams: activeSnapshot.value.tuningParams,
          treeData: treeData.value,
          resolution: resolution.value,
          frameRate: frameRate.value,
          theme: theme.value,
          savedTime: time,
        })
      );
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
    livePromptText.value = initialPromptText;
    treeData.value = initialIRTree;
    resolution.value = '1920 × 1080';
    frameRate.value = '30 fps';
    theme.value = 'dark';
    lastSavedTime.value = null;
    saveStatus.value = 'saved';
    clearHistory();
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
        localStorage.setItem(
          AUTOSAVE_KEY,
          JSON.stringify({
            promptText: livePromptText.value,
            elements: activeSnapshot.value.elements,
            tuningParams: activeSnapshot.value.tuningParams,
            treeData: treeData.value,
            resolution: resolution.value,
            frameRate: frameRate.value,
            theme: theme.value,
            savedTime: time,
          })
        );
        saveStatus.value = 'saved';
        lastSavedTime.value = time;
      } catch (e) {
        console.error(e);
      }
    }, 1500);
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
    autoSaveEnabled,
    saveStatus,
    lastSavedTime,

    // Getters
    activeSnapshot,
    canUndo,
    canRedo,

    // Actions
    pushState,
    undo,
    redo,
    jumpTo,
    clearHistory,
    setTheme,
    toggleTheme,
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
    triggerAutosave,
  };
});
