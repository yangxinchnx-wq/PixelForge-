<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { Layer } from '@/compiler/ir/renderIR'
import { getGroupsForOpcode } from '@/editor/inspector/propertySchemas'
import { Opcode } from '@/shared/types'
import { useRuntimeStore } from '@/stores/runtime'

import LayerTree from './LayerTree.vue'
import PropertyGroup from './PropertyGroup.vue'

const runtime = useRuntimeStore()

// 用户在 UI 上选中的 layer id(本地状态,不污染 store)
// 优先用本地选中;store 的 currentLayerId 变化时跟随(如切换场景/回放帧)
const userSelectedLayerId = ref<string | null>(null)

watch(
  () => runtime.currentLayerId,
  (newId) => {
    if (newId) userSelectedLayerId.value = newId
  },
  { immediate: true },
)

const selectedLayer = computed<Layer | null>(() => {
  const layers = runtime.currentIr.layers
  const id = userSelectedLayerId.value
  if (id) {
    const found = layers.find((l) => l.id === id)
    if (found) return found
  }
  return layers[0] ?? null
})

/** 当前选中 layer 的属性分组 schema(按 opcode 派发) */
const groups = computed(() => {
  const layer = selectedLayer.value
  if (!layer) return []
  // Opcode 是数字 enum,用反向映射取出字符串名(如 'SOLID_COLOR')
  const opcodeName = Opcode[layer.opcode] ?? 'UNKNOWN'
  return getGroupsForOpcode(opcodeName)
})

/**
 * 把 layer 转成 PropertyGroup 需要的 values 映射。
 *
 * 特殊 key 处理:
 * - __opcode__    → layer.opcode(字符串,只读)
 * - __blendMode__ → layer.blendMode(字符串)
 * - __visible__   → layer.visible(布尔)
 *
 * 其他 key 直接从 layer.params 取。
 */
const groupValues = computed<Record<string, unknown>>(() => {
  const layer = selectedLayer.value
  if (!layer) return {}
  const map: Record<string, unknown> = { ...layer.params }
  map.__opcode__ = Opcode[layer.opcode] ?? 'UNKNOWN'
  map.__blendMode__ = layer.blendMode ?? 'normal'
  map.__visible__ = layer.visible
  return map
})

/**
 * 属性变更 → 路由到对应的 runtime patch 入口。
 *
 * - __blendMode__ → StructuralPatch(field='blendMode')
 * - __visible__   → StructuralPatch(field='visible')
 * - __opcode__ 只读,忽略
 * - 其他走 applyValuePatch
 */
function onPropertyChange(key: string, value: number | number[] | string | boolean) {
  const layer = selectedLayer.value
  if (!layer) return

  if (key === '__opcode__') return // 只读

  if (key === '__blendMode__') {
    runtime.applyStructuralPatch(layer.id, 'blendMode', value as string)
    return
  }

  if (key === '__visible__') {
    runtime.applyStructuralPatch(layer.id, 'visible', value as boolean)
    return
  }

  runtime.applyValuePatch(layer.id, key, value as number | number[])
}

function onSelectLayer(layerId: string) {
  userSelectedLayerId.value = layerId
}

function onToggleVisible(layerId: string) {
  const layer = runtime.currentIr.layers.find((l) => l.id === layerId)
  if (layer) {
    runtime.applyStructuralPatch(layerId, 'visible', !layer.visible)
  }
}
</script>

<template>
  <div class="inspector">
    <div class="inspector-head">
      <span class="head-title">Inspector</span>
      <span class="head-sub">属性面板</span>
    </div>

    <LayerTree
      :layers="runtime.currentIr.layers"
      :selected-layer-id="selectedLayer?.id ?? null"
      @select="onSelectLayer"
      @toggle-visible="onToggleVisible"
    />

    <div v-if="selectedLayer" class="layer-info">
      <div class="info-row">
        <span class="info-label">图层 ID</span>
        <strong class="mono">{{ selectedLayer.id }}</strong>
      </div>
      <div class="info-row">
        <span class="info-label">opcode</span>
        <strong class="mono accent">{{ selectedLayer.opcode }}</strong>
      </div>
    </div>

    <div v-else class="empty-state">
      <span>未选中图层</span>
    </div>

    <!-- 属性分组 -->
    <div class="group-list">
      <PropertyGroup
        v-for="g in groups"
        :key="g.name"
        :group="g"
        :values="groupValues"
        @change="onPropertyChange"
      />
    </div>

    <!-- 最近 Patch -->
    <div class="patch-result">
      <div class="sub-label">最近 Patch</div>
      <div class="info-row">
        <span class="info-label">patchId</span>
        <strong class="mono">{{ runtime.lastPatchId ?? '无' }}</strong>
      </div>
      <div class="info-row">
        <span class="info-label">摘要</span>
        <strong class="mono">{{ runtime.lastPatchSummary ?? '无' }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inspector {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xl);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.inspector::-webkit-scrollbar { width: 6px; }
.inspector::-webkit-scrollbar-track { background: transparent; }
.inspector::-webkit-scrollbar-thumb {
  background: var(--pf-line-strong);
  border-radius: 999px;
}

.inspector-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px;
  flex-shrink: 0;
}
.head-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
}
.head-sub {
  font-size: 10.5px;
  color: var(--pf-ink-muted);
}

.layer-info {
  background: var(--pf-surface-soft);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-md);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11.5px;
}
.info-label { color: var(--pf-ink-muted); }
.info-row strong { font-size: 11.5px; color: var(--pf-ink); font-weight: 600; }
.mono { font-family: 'JetBrains Mono', monospace; }
.mono.accent { color: var(--pf-accent); }

.empty-state {
  padding: 24px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--pf-ink-faint);
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-md);
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.patch-result {
  background: var(--pf-surface-soft);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-md);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}
.sub-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--pf-ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--pf-line);
}
</style>
