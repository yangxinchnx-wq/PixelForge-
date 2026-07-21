<script setup lang="ts">
/**
 * ProTimelineRenderPanel(Step 32)— 渲染导出面板。
 *
 * 功能:
 * - 渲染配置(分辨率/帧率/格式/质量/区间)
 * - 预设选择(快速套用常用配置)
 * - 开始/暂停/恢复/取消 渲染
 * - 实时进度条 + 帧数显示
 * - 完成后显示输出文件列表
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 中文文字标签,JetBrains Mono 用于数字
 */
import { ref, computed, watch } from 'vue'

import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'
import { useRenderStore } from '@/editor/render/renderStore'
import { RENDER_PRESETS, type RenderFormat, type RenderQuality } from '@/editor/render/renderConfig'
import { createMockFrameRenderer, createMockFrameExporter } from '@/editor/render/renderPipeline'
import type { Sequence } from '@/editor/timeline/core/sequence'
import { seconds } from '@/editor/timeline/core/time'

const proStore = useProTimelineStore()
const renderStore = useRenderStore()

const visible = ref(false)
const selectedPresetId = ref('')

/** 当前活跃 Sequence */
const activeSeq = computed<Sequence | null>(() => proStore.activeSequence)

/** 渲染配置(本地编辑状态) */
const outputWidth = ref(1920)
const outputHeight = ref(1080)
const fps = ref(30)
const format = ref<RenderFormat>('png-sequence')
const quality = ref<RenderQuality>('standard')
const startSec = ref(0)
const endSec = ref(60)
const outputName = ref('render')
const alpha = ref(false)
const bitrateKbps = ref(8000)

// 当 Sequence 变化时同步默认配置
watch(
  activeSeq,
  (seq) => {
    if (!seq) return
    outputWidth.value = seq.width
    outputHeight.value = seq.height
    fps.value = seq.fps
    endSec.value = Number(seq.duration) / 1_000_000
    outputName.value = seq.name || 'render'
  },
  { immediate: true },
)

function toggle() {
  visible.value = !visible.value
}

function close() {
  visible.value = false
}

/** 套用预设 */
function applyPreset(presetId: string) {
  const preset = RENDER_PRESETS.find((p) => p.id === presetId)
  if (!preset) return
  outputWidth.value = preset.config.outputWidth
  outputHeight.value = preset.config.outputHeight
  fps.value = preset.config.fps
  format.value = preset.config.format
  quality.value = preset.config.quality
  alpha.value = preset.config.alpha
  bitrateKbps.value = preset.config.bitrateKbps
}

/** 开始渲染 */
function startRender() {
  const seq = activeSeq.value
  if (!seq) return
  const config = {
    outputWidth: outputWidth.value,
    outputHeight: outputHeight.value,
    fps: fps.value,
    format: format.value,
    quality: quality.value,
    startTime: seconds(startSec.value),
    endTime: seconds(endSec.value),
    outputName: outputName.value,
    alpha: alpha.value,
    bitrateKbps: bitrateKbps.value,
  }
  renderStore.startRender(
    seq.id,
    config,
    createMockFrameRenderer(),
    createMockFrameExporter(),
  )
}

/** 预估总帧数 */
const estimatedFrames = computed(() => {
  const dur = endSec.value - startSec.value
  return Math.max(0, Math.ceil(dur * fps.value))
})

/** 进度条宽度 */
const progressWidth = computed(() => `${renderStore.progress}%`)

/** 状态文字 */
const statusText = computed(() => {
  switch (renderStore.status) {
    case 'idle': return '空闲'
    case 'rendering': return '渲染中'
    case 'paused': return '已暂停'
    case 'completed': return '已完成'
    case 'cancelled': return '已取消'
    case 'failed': return '失败'
    default: return renderStore.status
  }
})

/** 是否可以编辑配置(非渲染中) */
const canEdit = computed(() => !renderStore.isRendering && !renderStore.isPaused)
</script>

<template>
  <div class="render-panel">
    <button class="rp-btn" data-tip="渲染导出" @click="toggle">
      渲染导出
    </button>

    <Transition name="rp-modal">
      <div v-if="visible" class="rp-modal" @click.self="close">
        <div class="rp-modal-inner">
          <!-- 头部 -->
          <div class="rp-header">
            <span class="rp-title">渲染导出</span>
            <button class="rp-close" @click="close">关闭</button>
          </div>

          <div class="rp-content">
            <!-- 预设选择 -->
            <div class="rp-section">
              <label class="rp-label">预设</label>
              <select
                v-model="selectedPresetId"
                class="rp-select"
                :disabled="!canEdit"
                @change="applyPreset(selectedPresetId)"
              >
                <option value="">— 选择预设 —</option>
                <option v-for="p in RENDER_PRESETS" :key="p.id" :value="p.id">
                  {{ p.name }}
                </option>
              </select>
            </div>

            <!-- 分辨率 + 帧率 -->
            <div class="rp-row">
              <div class="rp-field">
                <label class="rp-label">宽度</label>
                <input v-model.number="outputWidth" type="number" class="rp-input" :disabled="!canEdit" />
              </div>
              <div class="rp-field">
                <label class="rp-label">高度</label>
                <input v-model.number="outputHeight" type="number" class="rp-input" :disabled="!canEdit" />
              </div>
              <div class="rp-field">
                <label class="rp-label">帧率</label>
                <input v-model.number="fps" type="number" class="rp-input" :disabled="!canEdit" />
              </div>
            </div>

            <!-- 格式 + 质量 -->
            <div class="rp-row">
              <div class="rp-field">
                <label class="rp-label">格式</label>
                <select v-model="format" class="rp-select" :disabled="!canEdit">
                  <option value="png-sequence">PNG 序列</option>
                  <option value="webm">WebM 视频</option>
                  <option value="mp4">MP4 视频</option>
                </select>
              </div>
              <div class="rp-field">
                <label class="rp-label">质量</label>
                <select v-model="quality" class="rp-select" :disabled="!canEdit">
                  <option value="draft">草稿</option>
                  <option value="standard">标准</option>
                  <option value="high">高质量</option>
                </select>
              </div>
            </div>

            <!-- 时间区间 -->
            <div class="rp-row">
              <div class="rp-field">
                <label class="rp-label">起始(秒)</label>
                <input v-model.number="startSec" type="number" step="0.1" class="rp-input" :disabled="!canEdit" />
              </div>
              <div class="rp-field">
                <label class="rp-label">结束(秒)</label>
                <input v-model.number="endSec" type="number" step="0.1" class="rp-input" :disabled="!canEdit" />
              </div>
            </div>

            <!-- 文件名 + 选项 -->
            <div class="rp-row">
              <div class="rp-field rp-grow">
                <label class="rp-label">文件名</label>
                <input v-model="outputName" type="text" class="rp-input" :disabled="!canEdit" />
              </div>
              <div class="rp-field rp-check" v-if="format === 'png-sequence'">
                <label>
                  <input v-model="alpha" type="checkbox" :disabled="!canEdit" />
                  <span>透明背景</span>
                </label>
              </div>
            </div>

            <!-- 预估帧数 -->
            <div class="rp-estimate">
              预估总帧数:<span class="rp-num">{{ estimatedFrames }}</span>
            </div>

            <!-- 渲染控制 -->
            <div class="rp-controls">
              <button
                v-if="canEdit"
                class="rp-btn-action primary"
                @click="startRender"
              >开始渲染</button>
              <button
                v-if="renderStore.canPause"
                class="rp-btn-action"
                @click="renderStore.pauseRender()"
              >暂停</button>
              <button
                v-if="renderStore.canResume"
                class="rp-btn-action primary"
                @click="renderStore.resumeRender()"
              >恢复</button>
              <button
                v-if="renderStore.canCancel"
                class="rp-btn-action danger"
                @click="renderStore.cancelRender()"
              >取消</button>
              <button
                v-if="renderStore.isCompleted || renderStore.isCancelled || renderStore.isFailed"
                class="rp-btn-action"
                @click="renderStore.clearJob()"
              >清除</button>
            </div>

            <!-- 进度 -->
            <div v-if="renderStore.hasJob" class="rp-progress-section">
              <div class="rp-progress-header">
                <span class="rp-status" :class="renderStore.status">{{ statusText }}</span>
                <span class="rp-progress-text">
                  <span class="rp-num">{{ renderStore.completedFrames }}</span>
                  / <span class="rp-num">{{ renderStore.totalFrames }}</span> 帧
                  (<span class="rp-num">{{ renderStore.progress }}</span>%)
                </span>
              </div>
              <div class="rp-progress-bar">
                <div class="rp-progress-fill" :style="{ width: progressWidth }"></div>
              </div>
              <div v-if="renderStore.error" class="rp-error">{{ renderStore.error }}</div>
            </div>

            <!-- 输出文件 -->
            <div v-if="renderStore.outputFiles.length > 0" class="rp-output">
              <div class="rp-output-title">输出文件({{ renderStore.outputFiles.length }})</div>
              <div class="rp-output-list">
                <div v-for="(file, i) in renderStore.outputFiles.slice(0, 10)" :key="i" class="rp-output-item">
                  {{ file }}
                </div>
                <div v-if="renderStore.outputFiles.length > 10" class="rp-output-more">
                  ...还有 {{ renderStore.outputFiles.length - 10 }} 个文件
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
.render-panel {
  position: relative;
  display: inline-block;
}

.rp-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.rp-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.rp-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.rp-modal-inner {
  width: 520px;
  max-height: 85vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.rp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.rp-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.rp-close {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.rp-close:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}

.rp-content {
  padding: 16px;
  overflow-y: auto;
}

.rp-section {
  margin-bottom: 12px;
}

.rp-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.rp-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rp-field.rp-grow {
  flex: 2;
}
.rp-field.rp-check {
  justify-content: flex-end;
}
.rp-label {
  font-size: 11px;
  color: var(--pf-ink-muted);
}
.rp-input,
.rp-select {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  outline: none;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.rp-input:focus,
.rp-select:focus {
  border-color: var(--pf-accent);
}
.rp-input:disabled,
.rp-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rp-check label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  cursor: pointer;
}

.rp-estimate {
  font-size: 11px;
  color: var(--pf-ink-faint);
  margin-bottom: 12px;
}
.rp-num {
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink-muted);
}

.rp-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.rp-btn-action {
  padding: 6px 16px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.rp-btn-action:hover {
  border-color: var(--pf-ink-muted);
}
.rp-btn-action.primary {
  color: white;
  background: var(--pf-accent);
  border-color: var(--pf-accent);
}
.rp-btn-action.primary:hover {
  opacity: 0.9;
}
.rp-btn-action.danger {
  color: var(--pf-danger, #ff4d4f);
  border-color: var(--pf-danger, #ff4d4f);
}
.rp-btn-action.danger:hover {
  background: var(--pf-danger, #ff4d4f);
  color: white;
}

.rp-progress-section {
  margin-bottom: 12px;
}
.rp-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.rp-status {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-ink-muted);
}
.rp-status.rendering {
  color: var(--pf-accent);
}
.rp-status.completed {
  color: var(--pf-success, #52c41a);
}
.rp-status.failed {
  color: var(--pf-danger, #ff4d4f);
}
.rp-status.cancelled {
  color: var(--pf-ink-faint);
}
.rp-progress-text {
  font-size: 11px;
  color: var(--pf-ink-faint);
}
.rp-progress-bar {
  width: 100%;
  height: 8px;
  background: var(--pf-line);
  border-radius: 4px;
  overflow: hidden;
}
.rp-progress-fill {
  height: 100%;
  background: var(--pf-accent);
  transition: width 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.rp-error {
  margin-top: 8px;
  padding: 6px 8px;
  font-size: 11px;
  color: var(--pf-danger, #ff4d4f);
  background: rgba(255, 77, 79, 0.1);
  border-radius: 4px;
}

.rp-output {
  margin-top: 12px;
}
.rp-output-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-ink-muted);
  margin-bottom: 4px;
}
.rp-output-list {
  max-height: 120px;
  overflow-y: auto;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  padding: 4px;
}
.rp-output-item {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-faint);
  padding: 2px 4px;
}
.rp-output-more {
  font-size: 10px;
  color: var(--pf-ink-faint);
  padding: 2px 4px;
  font-style: italic;
}

.rp-modal-enter-active,
.rp-modal-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.rp-modal-enter-from,
.rp-modal-leave-to {
  opacity: 0;
}
</style>
