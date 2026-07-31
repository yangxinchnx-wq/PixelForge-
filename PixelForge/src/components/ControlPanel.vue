<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { ElementTag, TuningParams } from '../types';
import { useAppStore } from '../stores/app';
import { storeToRefs } from 'pinia';
import PfSelect from './ui/PfSelect.vue';

const props = defineProps<{
  promptText: string;
  elements: ElementTag[];
  tuningParams: TuningParams;
  isGenerating: boolean;
}>();

const emit = defineEmits<{
  'update:promptText': [text: string];
  toggleElement: [id: string];
  'update:tuningParams': [updater: (prev: TuningParams) => TuningParams];
  generate: [];
}>();

const store = useAppStore();
const { modelConfigs, selectedModelId } = storeToRefs(store);

// ─── 大模型选项（对接设置页面的模型配置）───────────────
const modelOptions = computed(() =>
  modelConfigs.value
    .filter((m) => m.enabled)
    .map((m) => ({ value: m.id, label: m.name || m.modelId || '未配置' }))
);
const selectedModel = computed({
  get: () => selectedModelId.value ?? '',
  set: (val: string) => store.setSelectedModel(val),
});

const selects = [
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

function onSelectChange(key: keyof TuningParams, value: string) {
  const parsed = parseFloat(value);
  emit('update:tuningParams', (prev) => ({ ...prev, [key]: parsed }));
}

const isTuningOpen = ref(false);
const tuningWrapRef = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (!isTuningOpen.value) return;
  const wrap = tuningWrapRef.value;
  if (wrap && !wrap.contains(e.target as Node)) {
    isTuningOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div class="pf-panel pf-panel-left">
    <div class="pf-panel-header">
      <PfSelect v-if="modelOptions.length > 0" v-model="selectedModel" :options="modelOptions" size="small" />
      <span v-else class="pf-panel-no-model" title="请在设置中添加模型">未配置模型</span>
    </div>

    <div class="pf-panel-body">
      <!-- Prompt -->
      <div class="pf-panel-section">
        <div class="pf-panel-label">场景描述</div>
        <textarea
          class="pf-textarea"
          :value="promptText"
          @input="emit('update:promptText', ($event.target as HTMLTextAreaElement).value)"
          placeholder="描述你想要生成的场景…"
          rows="4"
        />
      </div>

      <!-- Elements -->
      <div class="pf-panel-section">
        <div class="pf-panel-label">图层元素</div>
        <div class="pf-chips">
          <button
            v-for="el in elements"
            :key="el.id"
            class="pf-chip"
            :class="{ active: el.active }"
            @click="emit('toggleElement', el.id)"
          >
            <span class="pf-chip-dot" />
            {{ el.name }}
          </button>
        </div>
      </div>

      <!-- Tuning -->
      <div class="pf-panel-section" ref="tuningWrapRef" style="position: relative">
        <div class="pf-panel-label">画面调节</div>
        <button class="pf-tuning-trigger" @click="isTuningOpen = !isTuningOpen">
          <span>调整画面参数</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <!-- Tuning Floating Panel -->
        <div v-if="isTuningOpen" class="pf-popover">
          <div class="pf-popover-header">
            <span class="pf-popover-title">画面调节</span>
            <button class="btn btn-icon" title="关闭" @click="isTuningOpen = false">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="pf-popover-body">
            <div v-for="sel in selects" :key="sel.key" class="pf-tuning-row">
              <label class="pf-tuning-label">{{ sel.label }}</label>
              <PfSelect
                :model-value="String(tuningParams[sel.key])"
                :options="sel.options.map((o) => ({ value: String(o.value), label: o.label }))"
                @update:model-value="onSelectChange(sel.key, $event)"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Generate -->
      <div class="pf-panel-section">
        <button
          class="btn-primary"
          :disabled="isGenerating || modelOptions.length === 0"
          style="width: 100%; justify-content: center"
          @click="emit('generate')"
        >
          {{ isGenerating ? '生成中…' : '开始生成' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf-panel-no-model {
  font-size: 12px;
  color: var(--text-quaternary);
  white-space: nowrap;
}
</style>
