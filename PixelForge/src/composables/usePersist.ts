/**
 * usePersist — 统一持久化逻辑（消除 appStore 中的 DRY 违反）。
 *
 * 所有保存路径（手动保存、自动保存、强制保存）共用同一个 payload 构造 + 写入流程。
 */

import type { TuningParams, ElementTag, IRTreeNode } from '../types';
import type { ModelConfig, AccentColors } from '../stores/modelConfigStore';
import { unifiedStore } from '@/storage';

const AUTOSAVE_KEY = 'pixelforge_autosave_v2';

export interface PersistPayload {
  promptText: string;
  elements: ElementTag[];
  tuningParams: TuningParams;
  treeData: IRTreeNode[];
  resolution: string;
  frameRate: string;
  theme: string;
  modelConfigs: ModelConfig[];
  selectedModelId: string | null;
  accentColors: AccentColors;
  savedTime: string;
}

/** 构造统一的持久化 payload */
export function buildPersistPayload(deps: {
  promptText: string;
  elements: ElementTag[];
  tuningParams: TuningParams;
  treeData: IRTreeNode[];
  resolution: string;
  frameRate: string;
  theme: string;
  modelConfigs: ModelConfig[];
  selectedModelId: string | null;
  accentColors: AccentColors;
}): string {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return JSON.stringify({
    ...deps,
    savedTime: time,
  });
}

/** 同步写 localStorage + 异步写三层统一存储 */
export function persistAll(payload: string): { time: string } {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  localStorage.setItem(AUTOSAVE_KEY, payload);
  void unifiedStore.writeMetadata(AUTOSAVE_KEY, payload).catch((e) => {
    console.warn('[Persist] 统一存储写入失败', e);
  });
  return { time };
}

/** 从三层统一存储异步加载项目快照 */
export async function loadPersistedData(): Promise<Partial<PersistPayload> | null> {
  try {
    const json = await unifiedStore.readMetadata(AUTOSAVE_KEY);
    if (!json) return null;
    return JSON.parse(json) as Partial<PersistPayload>;
  } catch (e) {
    console.warn('[Persist] 从统一存储加载失败', e);
    return null;
  }
}

/** 删除持久化数据 */
export async function clearPersistedData(): Promise<void> {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (e) { /* ignore */ }
  await unifiedStore.deleteMetadata(AUTOSAVE_KEY).catch(() => {});
}
