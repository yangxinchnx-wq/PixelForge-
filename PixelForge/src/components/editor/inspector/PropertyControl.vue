<script setup lang="ts">
import { computed } from 'vue'

import type { PropertySchema } from '@/editor/inspector/inspectorTypes'

interface Props {
  property: PropertySchema
  /** 当前值(标量 / 数组 / 字符串 / 布尔) */
  value: number | number[] | string | boolean | undefined
}

const props = defineProps<Props>()

const emit = defineEmits<{
  change: [value: number | number[] | string | boolean]
}>()

/** 是否为数组类型(color / 多分量向量) */
const isArray = computed(() => Array.isArray(props.value))

/** 数组转 hex 颜色字符串(用于 color input) */
function arrayToHex(arr: number[]): string {
  const r = Math.round(Math.max(0, Math.min(1, arr[0] ?? 0)) * 255)
  const g = Math.round(Math.max(0, Math.min(1, arr[1] ?? 0)) * 255)
  const b = Math.round(Math.max(0, Math.min(1, arr[2] ?? 0)) * 255)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** hex 颜色字符串转数组 [r, g, b, a] */
function hexToArray(hex: string): number[] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const a = Array.isArray(props.value) ? (props.value[3] ?? 1) : 1
  return [r, g, b, a]
}

const colorHex = computed(() => {
  if (!isArray.value) return '#000000'
  return arrayToHex(props.value as number[])
})

function onSlider(event: Event) {
  emit('change', Number((event.target as HTMLInputElement).value))
}

function onNumber(event: Event) {
  emit('change', Number((event.target as HTMLInputElement).value))
}

function onSelect(event: Event) {
  const target = event.target as HTMLSelectElement
  const raw = target.value
  // 数字字符串自动转 number
  const parsed = /^\d+$/.test(raw) ? Number(raw) : raw
  emit('change', parsed)
}

function onColor(event: Event) {
  const hex = (event.target as HTMLInputElement).value
  emit('change', hexToArray(hex))
}

function onToggle(event: Event) {
  emit('change', (event.target as HTMLInputElement).checked)
}

/** 数组值的展示文本(供数组类型在控件右侧显示) */
const arrayDisplay = computed(() => {
  if (!isArray.value) return ''
  const arr = props.value as number[]
  return `[${arr.map((v) => v.toFixed(2)).join(', ')}]`
})

/** 标量值的展示文本 */
const scalarDisplay = computed(() => {
  if (isArray.value) return ''
  if (typeof props.value === 'number') return props.value.toFixed(2)
  return String(props.value ?? '')
})
</script>

<template>
  <div class="property" :class="{ readonly: property.readonly }">
    <label class="prop-label">
      <span class="prop-name">{{ property.label }}</span>
      <span class="prop-value mono">
        {{ isArray ? arrayDisplay : scalarDisplay }}
      </span>
    </label>

    <!-- slider -->
    <input
      v-if="property.type === 'slider'"
      type="range"
      class="ctrl-slider"
      :min="property.min ?? 0"
      :max="property.max ?? 1"
      :step="property.step ?? 0.01"
      :value="value as number"
      :disabled="property.readonly"
      @input="onSlider"
    />

    <!-- number -->
    <input
      v-else-if="property.type === 'number'"
      type="number"
      class="ctrl-number"
      :min="property.min"
      :max="property.max"
      :step="property.step ?? 1"
      :value="value as number"
      :disabled="property.readonly"
      @change="onNumber"
    />

    <!-- color (rgba 数组) -->
    <div v-else-if="property.type === 'color'" class="ctrl-color-wrap">
      <input
        type="color"
        class="ctrl-color"
        :value="colorHex"
        :disabled="property.readonly"
        @input="onColor"
      />
      <span class="color-hex mono">{{ colorHex }}</span>
    </div>

    <!-- select -->
    <select
      v-else-if="property.type === 'select'"
      class="ctrl-select"
      :value="String(value ?? '')"
      :disabled="property.readonly"
      @change="onSelect"
    >
      <option v-for="opt in property.options" :key="String(opt.value)" :value="String(opt.value)">
        {{ opt.label }}
      </option>
    </select>

    <!-- toggle -->
    <label v-else-if="property.type === 'toggle'" class="ctrl-toggle">
      <input
        type="checkbox"
        :checked="Boolean(value)"
        :disabled="property.readonly"
        @change="onToggle"
      />
      <span class="toggle-track">
        <span class="toggle-thumb"></span>
      </span>
    </label>
  </div>
</template>

<style scoped>
.property {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-sm);
  transition: background 160ms ease;
}
.property:hover { background: var(--pf-surface-sunk); }
.property.readonly { opacity: 0.7; }
.property.readonly .ctrl-slider,
.property.readonly .ctrl-number,
.property.readonly .ctrl-color,
.property.readonly .ctrl-select,
.property.readonly .ctrl-toggle input { cursor: not-allowed; }

.prop-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.prop-name {
  font-size: 11.5px;
  color: var(--pf-ink-soft);
  font-weight: 500;
}
.prop-value {
  font-size: 11px;
  color: var(--pf-ink);
  font-weight: 600;
}
.mono { font-family: 'JetBrains Mono', monospace; }

/* slider */
.ctrl-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--pf-surface-sunk);
  border-radius: 999px;
  outline: none;
  cursor: pointer;
}
.ctrl-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--pf-accent);
  border: 2px solid var(--pf-surface);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(184, 92, 46, 0.4);
  transition: transform 160ms ease;
}
.ctrl-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
.ctrl-slider::-webkit-slider-thumb:active { transform: scale(0.95); }
.ctrl-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--pf-accent);
  border: 2px solid var(--pf-surface);
  cursor: pointer;
}

/* number */
.ctrl-number {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  background: var(--pf-surface);
  font: inherit;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--pf-ink);
  outline: none;
  transition: border-color 160ms ease;
}
.ctrl-number:focus { border-color: var(--pf-accent); }
.ctrl-number::-webkit-inner-spin-button { opacity: 0.4; }

/* color */
.ctrl-color-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ctrl-color {
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  background: transparent;
  cursor: pointer;
}
.ctrl-color::-webkit-color-swatch-wrapper { padding: 2px; }
.ctrl-color::-webkit-color-swatch { border: 0; border-radius: 3px; }
.color-hex {
  font-size: 11px;
  color: var(--pf-ink-muted);
  text-transform: uppercase;
}

/* select */
.ctrl-select {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xs);
  background: var(--pf-surface);
  font: inherit;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  color: var(--pf-ink);
  cursor: pointer;
  outline: none;
  transition: border-color 160ms ease;
}
.ctrl-select:focus { border-color: var(--pf-accent); }
.ctrl-select:disabled { cursor: not-allowed; opacity: 0.7; }

/* toggle (iOS 风格) */
.ctrl-toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  height: 28px;
}
.ctrl-toggle input { display: none; }
.toggle-track {
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: var(--pf-surface-sunk);
  position: relative;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--pf-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: left 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ctrl-toggle input:checked + .toggle-track {
  background: var(--pf-accent);
}
.ctrl-toggle input:checked + .toggle-track .toggle-thumb {
  left: 18px;
}
.ctrl-toggle input:disabled + .toggle-track { opacity: 0.5; cursor: not-allowed; }
</style>
