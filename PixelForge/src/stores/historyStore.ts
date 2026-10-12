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
  /** 机器可读的创建时间(Date.now()),用于与 patch 制历史的撤销仲裁 */
  ts: number;
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
      ts: Date.now(),
      actionName: '初始项目状态',
      state: {
        promptText: loadedData?.promptText ?? initialPromptText,
        elements: loadedData?.elements ?? initialElements,
        tuningParams: loadedData?.tuningParams ?? initialTuningParams,
      },
    },
  ]);
  const currentIndex = ref(0);
  /**
   * 历史导航代际:undo/redo/jumpTo/clearHistory/resetWithData 发生时递增。
   * prompt 输入防抖提交调度时记录代际,回调时若代际已变,说明本次编辑已被
   * 撤销/跳转/重置回退,不能再把旧文本推回历史栈(修复防抖窗口内撤销的竞态)
   */
  const historyEpoch = ref(0);

  const activeSnapshot = computed(() => history.value[currentIndex.value]?.state ?? history.value[0].state);
  const canUndo = computed(() => currentIndex.value > 0);
  const canRedo = computed(() => currentIndex.value < history.value.length - 1);

  /** 当前状态记录的产生时间(undo 时的待撤销条目),无则为 0 */
  const lastEditTs = computed(() => history.value[currentIndex.value]?.ts ?? 0);
  /** 下一条记录的产生时间(redo 时的待重做条目),无则为 0 */
  const nextRedoTs = computed(() => history.value[currentIndex.value + 1]?.ts ?? 0);

  function pushState(newState: AppStateSnapshot, actionName: string) {
    const record: HistoryRecord = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      ts: Date.now(),
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
      historyEpoch.value++;
    }
  }

  function redo() {
    if (canRedo.value) {
      currentIndex.value++;
      historyEpoch.value++;
    }
  }

  function jumpTo(index: number) {
    if (index >= 0 && index < history.value.length && index !== currentIndex.value) {
      currentIndex.value = index;
      historyEpoch.value++;
    }
  }

  function clearHistory() {
    const freshRecord: HistoryRecord = {
      id: `reset-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      ts: Date.now(),
      actionName: '重置所有历史记录',
      state: activeSnapshot.value,
    };
    history.value = [freshRecord];
    currentIndex.value = 0;
    historyEpoch.value++;
  }

  /** 从外部数据重置 history（用于 loadFromUnifiedStore） */
  function resetWithData(promptText: string, elements: ElementTag[], tuningParams: TuningParams) {
    history.value = [{
      id: 'init-0',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      ts: Date.now(),
      actionName: '初始项目状态',
      state: { promptText, elements, tuningParams },
    }];
    currentIndex.value = 0;
    historyEpoch.value++;
  }

  return {
    history,
    currentIndex,
    historyEpoch,
    activeSnapshot,
    canUndo,
    canRedo,
    lastEditTs,
    nextRedoTs,
    pushState,
    undo,
    redo,
    jumpTo,
    clearHistory,
    resetWithData,
  };
});
