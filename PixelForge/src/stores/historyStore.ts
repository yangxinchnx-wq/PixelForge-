import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { TuningParams, ElementTag } from '../types';
import {
  initialPromptText,
  initialElements,
  initialTuningParams,
} from '../data/presetData';

const AUTOSAVE_KEY = 'pixelforge_autosave_v2';
const MAX_HISTORY_LENGTH = 50;

function loadSavedData() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

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

/**
 * History Store — 操作历史 + 撤销/重做。
 *
 * 管理 AppStateSnapshot 历史栈，支持 push/undo/redo/jumpTo。
 */
export const useHistoryStore = defineStore('history', () => {
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
    }
  }

  function redo() {
    if (canRedo.value) {
      currentIndex.value++;
    }
  }

  function jumpTo(index: number) {
    if (index >= 0 && index < history.value.length) {
      currentIndex.value = index;
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

  /** 从外部数据重置 history（用于 loadFromUnifiedStore） */
  function resetWithData(promptText: string, elements: ElementTag[], tuningParams: TuningParams) {
    history.value = [{
      id: 'init-0',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      actionName: '初始项目状态',
      state: { promptText, elements, tuningParams },
    }];
    currentIndex.value = 0;
  }

  return {
    history,
    currentIndex,
    activeSnapshot,
    canUndo,
    canRedo,
    pushState,
    undo,
    redo,
    jumpTo,
    clearHistory,
    resetWithData,
  };
});
