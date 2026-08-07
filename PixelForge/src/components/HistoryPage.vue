<script setup lang="ts">
/**
 * HistoryPage — 操作历史 + Prompt 历史面板（从 App.vue 提取）。
 */
import { ref, watch } from 'vue';

const props = defineProps<{
  /** 操作历史记录 */
  history: Array<{ id: string; actionName: string; timestamp: string }>;
  /** 当前历史索引 */
  currentIndex: number;
  /** 当前激活的左侧 Tab */
  activeTab: string;
  /** 加载 prompt 历史的函数 */
  loadPromptHistory: () => Promise<Array<{ timestampMs: number; text: string }>>;
}>();

const emit = defineEmits<{
  'jump-to': [index: number];
  'apply-prompt': [text: string];
}>();

const promptHistory = ref<Array<{ timestampMs: number; text: string }>>([]);

async function refreshPromptHistory() {
  promptHistory.value = await props.loadPromptHistory();
}

function formatPromptTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
}

function truncateText(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// 切换到历史页时自动加载数据
watch(() => props.activeTab, (tab) => {
  if (tab === 'history') void refreshPromptHistory();
});
</script>

<template>
  <div class="pf-page">
    <div class="pf-page-body" style="display: flex; gap: 12px">
      <!-- 操作历史 -->
      <div class="pf-panel glass-surface" style="flex: 1; min-height: 0">
        <div class="pf-panel-header">
          <span class="pf-panel-title">操作历史</span>
        </div>
        <div class="pf-panel-body">
          <div
            v-for="(record, i) in history"
            :key="record.id"
            class="pf-tree-row"
            :style="{ cursor: 'pointer', opacity: i === currentIndex ? 1 : 0.5, fontWeight: i === currentIndex ? 600 : 400 }"
            @click="emit('jump-to', i)"
          >
            <span class="pf-tree-label">{{ record.actionName }}</span>
            <span class="pf-tree-badge">{{ record.timestamp }}</span>
          </div>
        </div>
      </div>

      <!-- Prompt 历史 -->
      <div class="pf-panel glass-surface" style="flex: 1; min-height: 0">
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
            @click="emit('apply-prompt', item.text)"
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
</template>
