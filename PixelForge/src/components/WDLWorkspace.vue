<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import type { editor as MonacoEditorApi } from 'monaco-editor'
import type * as Monaco from 'monaco-editor'
import type { RenderGraph } from '@/graph/types'
import type { RenderIR } from '@/compiler/ir/renderIR'
import { registerWDLLanguage } from '@/world/wdl/wdlRegister'
import { WDL_THEME_ID } from '@/world/wdl/wdlTheme'
import { validateSource, type ValidationReport } from '@/world/wdl/wdlValidator'
import { compileSource } from '@/world/wdl/wdlCompiler'
import { applyMarkersToModel, reportToMarkers } from '@/world/wdl/wdlDiagnostics'
import { graphToWdl, wdlSourceToGraph } from '@/world/wdl/wdlGraphSync'
import { WDL_TEMPLATES } from '@/world/wdl/wdlTemplates'

const props = withDefaults(defineProps<{
  visible?: boolean
  initialSource?: string
}>(), {
  visible: true,
  initialSource: '',
})

const emit = defineEmits<{
  applyIR: [ir: RenderIR]
  graphSync: [graph: RenderGraph]
  sourceChange: [source: string]
}>()

const fallbackSource = WDL_TEMPLATES.find((template) => template.id === 'starry-night')?.source ?? ''
const source = ref(props.initialSource || fallbackSource)
const report = ref<ValidationReport | null>(null)
const compileError = ref<string | null>(null)
const editor = ref<MonacoEditorApi.IStandaloneCodeEditor | null>(null)
const monaco = ref<typeof Monaco | null>(null)
const isApplying = ref(false)

const statusLabel = computed(() => {
  if (compileError.value) return compileError.value
  if (!report.value) return '未校验'
  return report.value.valid
    ? `校验通过${report.value.warnings.length ? ` · ${report.value.warnings.length} 条警告` : ''}`
    : `${report.value.errors.length} 个错误`
})

function onBeforeMount(instance: typeof Monaco): void {
  monaco.value = instance
  registerWDLLanguage(instance)
}

function onMount(instance: MonacoEditorApi.IStandaloneCodeEditor): void {
  editor.value = instance
  void validateAndMark()
}

function onChange(value: string | undefined): void {
  source.value = value ?? ''
  emit('sourceChange', source.value)
  void validateAndMark()
}

async function validateAndMark(): Promise<ValidationReport> {
  await nextTick()
  const nextReport = validateSource(source.value)
  report.value = nextReport
  compileError.value = null
  const model = editor.value?.getModel()
  if (monaco.value && model) {
    applyMarkersToModel(
      monaco.value,
      model,
      reportToMarkers(nextReport, source.value.split('\n')),
    )
  }
  return nextReport
}

async function compileAndApply(): Promise<void> {
  isApplying.value = true
  try {
    const nextReport = await validateAndMark()
    if (!nextReport.valid) {
      compileError.value = 'WDL 含语义错误，已阻止应用'
      return
    }
    const ir = compileSource(source.value)
    emit('applyIR', ir)
  } catch (error) {
    compileError.value = error instanceof Error ? error.message : String(error)
  } finally {
    isApplying.value = false
  }
}

function syncToGraph(): void {
  try {
    const graph = wdlSourceToGraph(source.value)
    emit('graphSync', graph)
    compileError.value = null
  } catch (error) {
    compileError.value = error instanceof Error ? error.message : String(error)
  }
}

function loadTemplate(templateId: string): void {
  const template = WDL_TEMPLATES.find((candidate) => candidate.id === templateId)
  if (!template) return
  source.value = template.source
  editor.value?.setValue(template.source)
  void validateAndMark()
}

function updateFromGraph(graph: RenderGraph): void {
  const nextSource = graphToWdl(graph)
  source.value = nextSource
  editor.value?.setValue(nextSource)
  void validateAndMark()
}

watch(() => props.initialSource, (value) => {
  if (!value || value === source.value) return
  source.value = value
  editor.value?.setValue(value)
})

defineExpose({ updateFromGraph, compileAndApply, validateAndMark })
</script>

<template>
  <section v-if="visible" class="pf-wdl-workspace">
    <header class="pf-wdl-header">
      <div>
        <strong>WDL 场景编辑器</strong>
        <span class="pf-wdl-status" :class="{ error: compileError || (report && !report.valid) }">{{ statusLabel }}</span>
      </div>
      <div class="pf-wdl-actions">
        <select aria-label="WDL 模板" @change="loadTemplate(($event.target as HTMLSelectElement).value)">
          <option value="">模板</option>
          <option v-for="template in WDL_TEMPLATES" :key="template.id" :value="template.id">{{ template.name }}</option>
        </select>
        <button type="button" @click="syncToGraph">同步到节点图</button>
        <button type="button" :disabled="isApplying" @click="compileAndApply">{{ isApplying ? '应用中…' : '编译并应用到 Runtime' }}</button>
      </div>
    </header>
    <VueMonacoEditor
      v-model:value="source"
      language="wdl"
      :theme="WDL_THEME_ID"
      path="pixelforge://scene.wdl"
      :options="{ automaticLayout: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false }"
      width="100%"
      height="100%"
      @before-mount="onBeforeMount"
      @mount="onMount"
      @change="onChange"
    />
  </section>
</template>

<style scoped>
.pf-wdl-workspace { min-height: 0; height: 100%; display: flex; flex-direction: column; background: var(--glass-bg, #151922); border: 1px solid var(--separator, rgba(0,0,0,.1)); border-radius: 10px; overflow: hidden; }
.pf-wdl-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--separator, rgba(0,0,0,.1)); }
.pf-wdl-header > div:first-child { display: flex; align-items: center; gap: 10px; }
.pf-wdl-status { font-size: 11px; color: var(--text-secondary, #777); }
.pf-wdl-status.error { color: #c33; }
.pf-wdl-actions { display: flex; gap: 6px; }
.pf-wdl-actions button, .pf-wdl-actions select { border: 1px solid var(--separator, #ddd); border-radius: 6px; background: var(--surface, #fff); color: var(--text-primary, #222); padding: 5px 8px; font-size: 11px; }
.pf-wdl-workspace :deep(.monaco-editor) { flex: 1; }
</style>
