<script setup lang="ts">
import type { InspectorGroup, PropertySchema } from '@/editor/inspector/inspectorTypes'

import PropertyControl from './PropertyControl.vue'

interface Props {
  group: InspectorGroup
  /** 该组涉及的属性值映射: { [property.key]: value } */
  values: Record<string, unknown>
}

defineProps<Props>()

const emit = defineEmits<{
  change: [key: string, value: number | number[] | string | boolean]
}>()

function onChange(p: PropertySchema, value: number | number[] | string | boolean) {
  emit('change', p.key, value)
}
</script>

<template>
  <section class="group">
    <header class="group-head">
      <span class="group-name">{{ group.name }}</span>
      <span v-if="group.subtitle" class="group-subtitle">{{ group.subtitle }}</span>
    </header>
    <div class="group-body">
      <PropertyControl
        v-for="p in group.properties"
        :key="p.key"
        :property="p"
        :value="(values[p.key] as number | number[] | string | boolean | undefined)"
        @change="(v) => onChange(p, v)"
      />
    </div>
  </section>
</template>

<style scoped>
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 4px 4px;
  border-bottom: 1px solid var(--pf-line);
}
.group-name {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--pf-ink-faint);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.group-subtitle {
  font-size: 10px;
  color: var(--pf-ink-muted);
}
.group-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
