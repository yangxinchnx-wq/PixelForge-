import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { callLLM } from '../authoring/llm/callLLM';
import type { LLMProviderConfig } from '../authoring/llm/types';

const AUTOSAVE_KEY = 'pixelforge_autosave_v2';

function loadSavedData() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

export interface AccentColors {
  settings: string;
  image: string;
  video: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'custom';
  modelId: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  metadata?: ModelMetadata;
}

export interface ModelMetadata {
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsImageGeneration?: boolean;
  supportsVideoGeneration?: boolean;
  supportsAudioGeneration?: boolean;
  rpmLimit?: number;
  tpmLimit?: number;
}

/**
 * Model Config Store — LLM 模型配置 + 请求桥接。
 *
 * 管理多模型配置列表、选中模型、以及 ModelConfig → callLLM 的桥接。
 */
export const useModelConfigStore = defineStore('modelConfig', () => {
  const loadedData = loadSavedData();

  const modelConfigs = ref<ModelConfig[]>(
    Array.isArray(loadedData?.modelConfigs) ? loadedData.modelConfigs : []
  );
  const selectedModelId = ref<string | null>(
    loadedData?.selectedModelId ?? null
  );

  const selectedModelConfig = computed<ModelConfig | null>(() =>
    selectedModelId.value
      ? modelConfigs.value.find((m) => m.id === selectedModelId.value) ?? null
      : null
  );

  function addModelConfig(config: Omit<ModelConfig, 'id'>): string {
    const id = `model-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    modelConfigs.value.push({ ...config, id });
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
    if (selectedModelId.value === id) {
      selectedModelId.value = modelConfigs.value[0]?.id ?? null;
    }
  }

  function setSelectedModel(id: string): void {
    selectedModelId.value = id;
  }

  /** 将 store 的 ModelConfig 转换为 callLLM 所需的 LLMProviderConfig */
  function modelConfigToLLMConfig(config: ModelConfig): LLMProviderConfig | null {
    let provider: 'openai' | 'anthropic';
    let baseUrl = config.baseUrl || undefined;

    if (config.provider === 'anthropic') {
      provider = 'anthropic';
    } else {
      // openai / google / custom 统一走 OpenAI 兼容协议
      provider = 'openai';
      // Google Gemini 使用 OpenAI 兼容端点
      if (config.provider === 'google' && !baseUrl) {
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai';
      }
    }

    if (!config.apiKey || !config.modelId) return null;
    return {
      provider,
      apiKey: config.apiKey,
      baseUrl,
      defaultModel: config.modelId,
    };
  }

  /** 调用当前选中的模型，返回 LLM 文本响应（失败时返回 null） */
  async function callSelectedModel(prompt: string, systemPrompt?: string): Promise<string | null> {
    const config = selectedModelConfig.value;
    if (!config) return null;
    const llmConfig = modelConfigToLLMConfig(config);
    if (!llmConfig) return null;
    try {
      const response = await callLLM(
        { prompt, systemPrompt, maxTokens: 4096 },
        llmConfig,
        null,
      );
      return response.content;
    } catch (e) {
      console.error('[ModelConfigStore] LLM 调用失败', e);
      return null;
    }
  }

  return {
    modelConfigs,
    selectedModelId,
    selectedModelConfig,
    addModelConfig,
    updateModelConfig,
    removeModelConfig,
    setSelectedModel,
    modelConfigToLLMConfig,
    callSelectedModel,
  };
});
