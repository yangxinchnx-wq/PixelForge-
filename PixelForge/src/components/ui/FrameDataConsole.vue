<script setup lang="ts">
import { computed, ref } from 'vue'

import type { DataSection, FrameSnapshot } from './types'
import { createCsvExport, createDebugExport, createSnapshotExport } from '@/services/frame/adapter'

const props = defineProps<{
  frame: FrameSnapshot | undefined
  sections: DataSection[]
}>()

const expanded = ref(false)
const exportMenuOpen = ref(false)

const exportPayload = computed(() => {
  return JSON.stringify(
    {
      frame: props.frame,
      sections: props.sections,
    },
    null,
    2,
  )
})

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function exportSnapshot() {
  exportMenuOpen.value = false
  const content = createSnapshotExport(props.frame)
  downloadFile(content, `frame-${props.frame?.frame ?? 'snapshot'}-summary.json`, 'application/json')
}

function exportDebug() {
  exportMenuOpen.value = false
  const content = createDebugExport(props.frame)
  downloadFile(content, `frame-${props.frame?.frame ?? 'snapshot'}-debug.json`, 'application/json')
}

function exportCsv() {
  exportMenuOpen.value = false
  const content = createCsvExport(props.frame)
  downloadFile(content, `frame-${props.frame?.frame ?? 'snapshot'}.csv`, 'text/csv')
}

function exportLegacy() {
  exportMenuOpen.value = false
  downloadFile(exportPayload.value, `frame-${props.frame?.frame ?? 'snapshot'}-full.json`, 'application/json')
}
</script>

<template>
  <section class="data-console">
    <header class="console-header">
      <div>
        <p class="section-kicker">帧数据</p>
        <h3>当前帧信息</h3>
      </div>

      <div class="console-actions">
        <button type="button" class="tool-button" @click="expanded = !expanded">
          {{ expanded ? '收起详情' : '展开详情' }}
        </button>
        <div class="console-export-wrapper">
          <button
            type="button"
            class="tool-button primary"
            @click="exportMenuOpen = !exportMenuOpen"
          >
            导出数据
          </button>
          <div v-if="exportMenuOpen" class="console-export-menu">
            <button type="button" class="console-export-option" @click="exportSnapshot">
              <span class="console-export-title">快照导出</span>
              <span class="console-export-desc">摘要字段 JSON</span>
            </button>
            <button type="button" class="console-export-option" @click="exportDebug">
              <span class="console-export-title">调试导出</span>
              <span class="console-export-desc">完整帧数据 JSON</span>
            </button>
            <button type="button" class="console-export-option" @click="exportCsv">
              <span class="console-export-title">CSV 导出</span>
              <span class="console-export-desc">表格格式 CSV</span>
            </button>
            <button type="button" class="console-export-option" @click="exportLegacy">
              <span class="console-export-title">完整导出</span>
              <span class="console-export-desc">含面板数据 JSON</span>
            </button>
          </div>
        </div>
      </div>
    </header>

    <div class="console-summary">
      <span>帧 {{ frame?.frame ?? '—' }}</span>
      <span>{{ frame?.patchSummary ?? '暂无补丁信息' }}</span>
      <span>{{ frame ? frame.durationMs.toFixed(1) : '0.0' }} 毫秒</span>
      <span>{{ frame?.status ?? '空闲' }}</span>
    </div>

    <div v-if="expanded" class="console-details">
      <section v-for="section in sections" :key="section.title" class="console-section">
        <h4>{{ section.title }}</h4>
        <dl>
          <div v-for="row in section.rows" :key="row.label" class="console-row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </section>
</template>
