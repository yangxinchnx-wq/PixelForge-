<script setup lang="ts">
import type { DataSection } from './types'

defineProps<{
  sections: DataSection[]
}>()
</script>

<template>
  <aside class="inspector-panel">
    <section v-for="section in sections" :key="section.title" class="inspector-section">
      <header class="inspector-header">
        <p class="section-kicker">检查面板</p>
        <h3>{{ section.title }}</h3>
      </header>

      <dl class="inspector-list">
        <div v-for="row in section.rows" :key="row.label" class="inspector-row">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>
  </aside>
</template>
