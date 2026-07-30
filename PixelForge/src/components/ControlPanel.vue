<script setup lang="ts">
import type { ElementTag, TuningParams } from '../types';

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

const sliders = [
  { key: 'starDensity' as const, label: '星空密度', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
  { key: 'brightness' as const, label: '亮度', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
  { key: 'hue' as const, label: '色相', min: 0, max: 360, step: 1, fmt: (v: number) => `${Math.round(v)}°` },
  { key: 'contrast' as const, label: '对比度', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
];

function onSliderChange(key: keyof TuningParams, event: Event) {
  const value = parseFloat((event.target as HTMLInputElement).value);
  emit('update:tuningParams', (prev) => ({ ...prev, [key]: value }));
}
</script>

<template>
  <div class="pf-panel pf-panel-left">
    <div class="pf-panel-header">
      <span class="pf-panel-title">控制台</span>
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
      <div class="pf-panel-section">
        <div class="pf-panel-label">画面调节</div>
        <div v-for="slider in sliders" :key="slider.key" class="pf-slider-row">
          <div class="pf-slider-header">
            <span class="pf-slider-label">{{ slider.label }}</span>
            <span class="pf-slider-value">{{ slider.fmt(tuningParams[slider.key]) }}</span>
          </div>
          <input
            type="range"
            class="pf-slider"
            :min="slider.min"
            :max="slider.max"
            :step="slider.step"
            :value="tuningParams[slider.key]"
            @input="onSliderChange(slider.key, $event)"
          />
        </div>
      </div>

      <!-- Generate -->
      <div class="pf-panel-section">
        <button
          class="btn-primary"
          :disabled="isGenerating"
          style="width: 100%; justify-content: center"
          @click="emit('generate')"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
          </svg>
          {{ isGenerating ? '生成中…' : '生成画面' }}
        </button>
      </div>
    </div>
  </div>
</template>
