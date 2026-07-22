<script setup lang="ts">
/**
 * ProTimelineWDLEditor(Step 37.5 + 38.1)— WDL 代码编辑器面板。
 *
 * Step 37.5 原始功能:
 * - 代码编辑区(textarea + 行号)
 * - 实时语法校验(lexer + parser + validator)
 * - 错误/警告列表(点击跳转行号)
 * - 编译预览(显示生成的 RenderIR 摘要)
 * - 应用到运行时(将 RenderIR 推送到 runtimeStore)
 * - 示例模板(星空夜景 / 纯色测试)
 *
 * Step 38.1 升级:
 * - textarea → Monaco Editor(语法高亮 / 括号匹配 / 注释切换 / 自动缩进)
 * - WDL Monarch tokenizer 着色(关键字 / opcode / 字符串 / 数字 / 尺寸 / 注释)
 * - pixelforge-dark 主题(对齐 --pf-* 设计令牌)
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - JetBrains Mono 用于代码字体
 */
import { ref, computed, shallowRef, watch, onBeforeUnmount } from 'vue'
import { VueMonacoEditor, loader } from '@guolao/vue-monaco-editor'
import { useRuntimeStore } from '@/stores/runtime'
import { validateSource } from '@/world/wdl/wdlValidator'
import { compileSource } from '@/world/wdl/wdlCompiler'
import { registerWDLLanguage } from '@/world/wdl/wdlRegister'
import { WDL_LANGUAGE_ID } from '@/world/wdl/wdlMonarch'
import { WDL_THEME_ID } from '@/world/wdl/wdlTheme'
import { validateSourceToMarkers, applyMarkersToModel, clearMarkersFromModel } from '@/world/wdl/wdlDiagnostics'
import type { ValidationReport } from '@/world/wdl/wdlValidator'
import type { RenderIR } from '@/compiler/ir/renderIR'
import type * as Monaco from 'monaco-editor'

// 配置 loader 使用本地 monaco-editor(不走 CDN)
import * as monacoEditor from 'monaco-editor'
loader.config({ monaco: monacoEditor })

const runtimeStore = useRuntimeStore()

const visible = ref(false)

// ============================================================================
// 默认模板
// ============================================================================

const STARRY_TEMPLATE = `scene "星空夜景" {
  canvas: 1920x1080

  layer "background" {
    opcode: SOLID_COLOR
    color: [0.02, 0.04, 0.12, 1.0]
    blendMode: normal
  }

  layer "stars" {
    opcode: NOISE
    scale: 0.8
    intensity: 0.9
    blendMode: add
  }

  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["background", "stars"]
  }
}`

/** 编辑器源码 */
const source = ref(STARRY_TEMPLATE)

/** 校验报告(shallowRef 避免 RenderIR 递归类型 TS2589) */
const report = shallowRef<ValidationReport>({ valid: false, errors: [], warnings: [] })

/** 编译后的 RenderIR */
const compiledIR = shallowRef<RenderIR | null>(null)

/** 编译错误 */
const compileError = ref<string | null>(null)

/** 是否在输入后自动校验 */
const autoValidate = ref(true)

/** Monaco editor 实例(shallowRef 避免深度响应) */
const editorInstance = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

/** Monaco 全局对象(用于 setModelMarkers) */
const monacoRef = shallowRef<typeof Monaco | null>(null)

/** 跳转目标行(用于点击消息后定位) */
const jumpLine = ref<number | null>(null)

// ============================================================================
// Monaco 编辑器配置
// ============================================================================

/** Monaco 编辑器选项 */
const editorOptions = computed<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({
  value: source.value,
  language: WDL_LANGUAGE_ID,
  theme: WDL_THEME_ID,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  lineNumbers: 'on',
  lineDecorationsWidth: 8,
  lineNumbersMinChars: 3,
  glyphMargin: true,
  folding: true,
  renderLineHighlight: 'all',
  scrollbar: {
    vertical: 'auto',
    horizontal: 'auto',
    verticalScrollbarSize: 8,
    horizontalScrollbarSize: 8,
  },
  padding: { top: 8, bottom: 8 },
}))

/** Monaco 加载前回调 — 注册 WDL 语言 */
function handleBeforeMount(monaco: typeof Monaco) {
  monacoRef.value = monaco
  registerWDLLanguage(monaco)
}

/** Monaco 挂载后回调 — 保存 editor 实例 */
function handleMount(editor: Monaco.editor.IStandaloneCodeEditor) {
  editorInstance.value = editor
  // 恢复跳转
  if (jumpLine.value !== null) {
    editor.revealLineInCenter(jumpLine.value)
    editor.setPosition({ lineNumber: jumpLine.value, column: 1 })
    jumpLine.value = null
  }
}

/** 编辑器内容变更 */
function handleEditorChange(value: string | undefined) {
  if (value !== undefined) {
    source.value = value
  }
}

// ============================================================================
// 校验和编译
// ============================================================================

/** 执行校验 */
function doValidate() {
  report.value = validateSource(source.value)
  // Step 38.3: 将错误/警告标记到 Monaco 编辑器(内联波浪线)
  const editor = editorInstance.value
  const monaco = monacoRef.value
  if (editor && monaco) {
    const model = editor.getModel()
    if (model) {
      const markers = validateSourceToMarkers(source.value)
      applyMarkersToModel(monaco, model, markers)
    }
  }
}

/** 执行编译 */
function doCompile() {
  compileError.value = null
  try {
    compiledIR.value = compileSource(source.value)
  } catch (e) {
    compiledIR.value = null
    compileError.value = e instanceof Error ? e.message : String(e)
  }
}

/** 执行校验 + 编译 */
function runAll() {
  doValidate()
  if (report.value.valid) {
    doCompile()
  } else {
    compiledIR.value = null
  }
}

/** 应用 RenderIR 到运行时 */
function applyToRuntime() {
  if (!compiledIR.value) return
  runtimeStore.setRenderIR(compiledIR.value)
}

// 自动校验
watch(source, () => {
  if (autoValidate.value) {
    runAll()
  }
}, { immediate: true })

// ============================================================================
// 错误列表
// ============================================================================

/** 合并 errors 和 warnings,按行号排序 */
const allMessages = computed(() => {
  const all = [
    ...report.value.errors,
    ...report.value.warnings,
  ]
  return all.sort((a, b) => a.line - b.line)
})

/** 跳转到指定行(Monaco editor) */
function jumpToLine(line: number) {
  const editor = editorInstance.value
  if (editor) {
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
  } else {
    jumpLine.value = line
  }
}

// ============================================================================
// 编辑器操作
// ============================================================================

/** 加载示例模板 */
function loadTemplate(name: 'starry' | 'solid' | 'empty') {
  switch (name) {
    case 'starry':
      source.value = STARRY_TEMPLATE
      break
    case 'solid':
      source.value = `scene "纯色测试" {
  canvas: 800x600
  layer "bg" {
    opcode: SOLID_COLOR
    color: [0.8, 0.2, 0.2, 1.0]
  }
  region "main" {
    bounds: [0, 0, 1, 1]
    layers: ["bg"]
  }
}`
      break
    case 'empty':
      source.value = `scene "新场景" {
  canvas: 1920x1080
}`
      break
  }
  // 同步到 Monaco editor
  if (editorInstance.value) {
    editorInstance.value.setValue(source.value)
  }
}

/** 清空编辑器 */
function clearEditor() {
  source.value = ''
  if (editorInstance.value) {
    editorInstance.value.setValue('')
  }
}

/** 格式化(简单:去除多余空行) */
function formatSource() {
  const formatted = source.value
    .split('\n')
    .filter((line, i, arr) => {
      const isEmpty = line.trim() === ''
      const prevEmpty = i > 0 && arr[i - 1].trim() === ''
      return !(isEmpty && prevEmpty)
    })
    .join('\n')
  source.value = formatted
  if (editorInstance.value) {
    editorInstance.value.setValue(formatted)
  }
}

function toggle() {
  visible.value = !visible.value
}

function close() {
  visible.value = false
}

// 组件卸载前销毁 editor + 清除 markers
onBeforeUnmount(() => {
  if (editorInstance.value && monacoRef.value) {
    const model = editorInstance.value.getModel()
    if (model) clearMarkersFromModel(monacoRef.value, model)
  }
  if (editorInstance.value) {
    editorInstance.value.dispose()
    editorInstance.value = null
  }
})
</script>

<template>
  <div class="wdl-panel">
    <button class="wdl-btn" @click="toggle">WDL</button>

    <Transition name="wdl-modal">
      <div v-if="visible" class="wdl-modal" @click.self="close">
        <div class="wdl-modal-inner">
          <!-- 头部 -->
          <div class="wdl-header">
            <span class="wdl-title">WDL 编辑器</span>
            <div class="wdl-header-actions">
              <select class="wdl-template-select" @change="loadTemplate(($event.target as HTMLSelectElement).value as 'starry' | 'solid' | 'empty')">
                <option value="">选择模板...</option>
                <option value="starry">星空夜景</option>
                <option value="solid">纯色测试</option>
                <option value="empty">空白场景</option>
              </select>
              <button class="wdl-action-btn" @click="formatSource">格式化</button>
              <button class="wdl-action-btn" @click="clearEditor">清空</button>
              <button class="wdl-close" @click="close">关闭</button>
            </div>
          </div>

          <div class="wdl-content">
            <!-- 编辑器区 -->
            <div class="wdl-editor-section">
              <div class="wdl-editor-toolbar">
                <label class="wdl-auto-validate">
                  <input type="checkbox" v-model="autoValidate" />
                  <span>自动校验</span>
                </label>
                <button class="wdl-run-btn" @click="runAll">校验 + 编译</button>
                <button
                  class="wdl-apply-btn"
                  :disabled="!compiledIR"
                  @click="applyToRuntime"
                >应用到运行时</button>
              </div>

              <!-- Monaco Editor(Step 38.1: 替换原 textarea + 行号) -->
              <div class="wdl-editor-area">
                <vue-monaco-editor
                  :value="source"
                  :options="editorOptions"
                  :language="WDL_LANGUAGE_ID"
                  :theme="WDL_THEME_ID"
                  width="100%"
                  height="100%"
                  @before-mount="handleBeforeMount"
                  @mount="handleMount"
                  @change="handleEditorChange"
                />
              </div>
            </div>

            <!-- 右侧:消息 + 预览 -->
            <div class="wdl-side-section">
              <!-- 消息列表 -->
              <div class="wdl-messages">
                <div class="wdl-section-title">
                  消息
                  <span class="wdl-count" :class="{ 'has-error': report.errors.length > 0 }">
                    {{ report.errors.length }} 错误 / {{ report.warnings.length }} 警告
                  </span>
                </div>
                <div class="wdl-message-list">
                  <div
                    v-for="(msg, i) in allMessages"
                    :key="i"
                    class="wdl-message"
                    :class="msg.severity"
                    @click="jumpToLine(msg.line)"
                  >
                    <span class="wdl-msg-line">L{{ msg.line }}</span>
                    <span class="wdl-msg-text">{{ msg.message }}</span>
                  </div>
                  <div v-if="allMessages.length === 0" class="wdl-no-messages">
                    无消息
                  </div>
                </div>
              </div>

              <!-- 编译预览 -->
              <div class="wdl-preview">
                <div class="wdl-section-title">
                  编译预览
                  <span class="wdl-count" :class="{ 'has-error': !!compileError }">
                    {{ compileError ? '失败' : (compiledIR ? '成功' : '未编译') }}
                  </span>
                </div>
                <div class="wdl-preview-content">
                  <div v-if="compileError" class="wdl-compile-error">
                    {{ compileError }}
                  </div>
                  <div v-else-if="compiledIR" class="wdl-ir-summary">
                    <div class="wdl-ir-row">
                      <span class="wdl-ir-key">canvas</span>
                      <span class="wdl-ir-val">{{ compiledIR.canvas.width }}x{{ compiledIR.canvas.height }}</span>
                    </div>
                    <div class="wdl-ir-row">
                      <span class="wdl-ir-key">layers</span>
                      <span class="wdl-ir-val">{{ compiledIR.layers.length }}</span>
                    </div>
                    <div class="wdl-ir-row">
                      <span class="wdl-ir-key">effects</span>
                      <span class="wdl-ir-val">{{ compiledIR.effects.length }}</span>
                    </div>
                    <div class="wdl-ir-row">
                      <span class="wdl-ir-key">regions</span>
                      <span class="wdl-ir-val">{{ compiledIR.regions.length }}</span>
                    </div>
                    <div v-if="compiledIR.layers.length > 0" class="wdl-ir-layers">
                      <div
                        v-for="layer in compiledIR.layers"
                        :key="layer.id"
                        class="wdl-ir-layer"
                      >
                        <span class="wdl-layer-id">{{ layer.id }}</span>
                        <span class="wdl-layer-op">{{ layer.opcode }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-else class="wdl-no-preview">
                    点击"校验 + 编译"生成预览
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.wdl-panel {
  position: relative;
  display: inline-block;
}

.wdl-btn {
  padding: 4px 12px;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.wdl-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.wdl-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0,0, 0.35);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wdl-modal-inner {
  width: 900px;
  height: 600px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wdl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.wdl-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.wdl-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.wdl-template-select,
.wdl-action-btn,
.wdl-close {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.wdl-template-select:hover,
.wdl-action-btn:hover,
.wdl-close:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}

.wdl-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.wdl-editor-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--pf-line);
}

.wdl-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--pf-line);
}
.wdl-auto-validate {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  cursor: pointer;
}
.wdl-run-btn,
.wdl-apply-btn {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.wdl-run-btn {
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
}
.wdl-run-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}
.wdl-apply-btn {
  color: white;
  background: var(--pf-accent);
  border: 1px solid var(--pf-accent);
}
.wdl-apply-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.wdl-apply-btn:not(:disabled):hover {
  opacity: 0.85;
}

.wdl-editor-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.wdl-side-section {
  width: 280px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wdl-messages {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--pf-line);
}
.wdl-section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-ink);
  border-bottom: 1px solid var(--pf-line);
}
.wdl-count {
  font-weight: 400;
  font-size: 11px;
  color: var(--pf-ink-faint);
}
.wdl-count.has-error {
  color: #e53935;
}
.wdl-message-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.wdl-message {
  display: flex;
  gap: 8px;
  padding: 4px 12px;
  font-size: 11px;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.wdl-message:hover {
  background: var(--pf-bg, rgba(255,255,255, 0.03));
}
.wdl-message.error .wdl-msg-text {
  color: #e53935;
}
.wdl-message.warning .wdl-msg-text {
  color: #f9a825;
}
.wdl-msg-line {
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink-faint);
  min-width: 32px;
}
.wdl-msg-text {
  flex: 1;
  word-break: break-word;
}
.wdl-no-messages {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--pf-ink-faint);
}

.wdl-preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.wdl-preview-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.wdl-compile-error {
  font-size: 12px;
  color: #e53935;
  word-break: break-word;
}
.wdl-ir-summary {
  font-size: 12px;
}
.wdl-ir-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  border-bottom: 1px solid var(--pf-line);
}
.wdl-ir-key {
  color: var(--pf-ink-muted);
}
.wdl-ir-val {
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink);
}
.wdl-ir-layers {
  margin-top: 8px;
}
.wdl-ir-layer {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 11px;
}
.wdl-layer-id {
  color: var(--pf-accent);
}
.wdl-layer-op {
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink-faint);
}
.wdl-no-preview {
  text-align: center;
  font-size: 12px;
  color: var(--pf-ink-faint);
  padding: 16px;
}

/* Transition */
.wdl-modal-enter-active,
.wdl-modal-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.wdl-modal-enter-from,
.wdl-modal-leave-to {
  opacity: 0;
}
</style>
