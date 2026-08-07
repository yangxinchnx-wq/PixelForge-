<script setup lang="ts">
/**
 * EffectsPage — 画面调节面板（从 App.vue 提取）。
 *
 * 包含 tuning 参数的 popover 选择器。
 */
import { ref } from 'vue';
import PfSelect from './ui/PfSelect.vue';

const props = defineProps<{
  tuningParams: {
    starDensity: number;
    brightness: number;
    hue: number;
    contrast: number;
  };
}>();

const emit = defineEmits<{
  'update:tuning-params': [updater: (prev: typeof props.tuningParams) => typeof props.tuningParams];
  'go-back': [];
}>();

const tuningSelects = [
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

const isTuningPopoverOpen = ref(false);
const tuningPopoverWrapRef = ref<HTMLElement | null>(null);

function onTuningSelectChange(key: string, value: string) {
  const parsed = parseFloat(value);
  emit('update:tuning-params', (prev) => ({ ...prev, [key]: parsed }));
}

// 关闭 popover 的外部点击检测（父组件 document click 绑定）
function closePopover() {
  isTuningPopoverOpen.value = false;
}

defineExpose({ tuningPopoverWrapRef, closePopover });
</script>

<template>
  <div class="pf-page">
    <div class="pf-page-header">
      <button class="btn btn-icon" title="返回" @click="emit('go-back')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>
      <span class="pf-page-title">效果</span>
    </div>
    <div class="pf-page-body" style="display: flex">
      <div class="pf-panel glass-surface" style="flex: 1; min-height: 0; max-width: 400px">
        <div class="pf-panel-header">
          <span class="pf-panel-title">画面调节</span>
        </div>
        <div class="pf-panel-body" ref="tuningPopoverWrapRef" style="position: relative">
          <button class="pf-tuning-trigger" @click="isTuningPopoverOpen = !isTuningPopoverOpen">
            <span>调整画面参数</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <div v-if="isTuningPopoverOpen" class="pf-popover glass-surface">
            <div class="pf-popover-header">
              <span class="pf-popover-title">画面调节</span>
              <button class="btn btn-icon" title="关闭" @click="isTuningPopoverOpen = false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="pf-popover-body">
              <div v-for="sel in tuningSelects" :key="sel.key" class="pf-tuning-row">
                <label class="pf-tuning-label">{{ sel.label }}</label>
                <PfSelect
                  :model-value="String(tuningParams[sel.key])"
                  :options="sel.options.map((o) => ({ value: String(o.value), label: o.label }))"
                  @update:model-value="onTuningSelectChange(sel.key, $event)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
