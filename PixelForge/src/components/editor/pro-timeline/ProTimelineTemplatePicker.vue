<script setup lang="ts">
/**
 * ProTimelineTemplatePicker(Step 31.9)— Sequence 模板选择器。
 *
 * 功能:
 * - 弹出面板列出所有可用模板(内置 + 自定义)
 * - 点击模板 → 从模板创建新 Sequence 并切换
 * - "保存当前为模板"按钮 → 输入名称后保存
 * - 自定义模板可删除(悬停显示删除按钮)
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 中文文字标签,JetBrains Mono 用于数字
 */
import { ref, computed } from 'vue'

import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'
import type { SequenceTemplate } from '@/editor/timeline/core/sequenceTemplate'

const store = useProTimelineStore()

const visible = ref(false)
const savingMode = ref(false)
const saveName = ref('')
const saveDesc = ref('')
const justCreatedId = ref<string | null>(null)

/** 所有模板(内置 + 自定义,响应式) */
const allTemplates = computed<SequenceTemplate[]>(() => store.listTemplates())

const builtinTemplates = computed(() =>
  allTemplates.value.filter((t) => t.category === 'builtin'),
)
const customTemplates = computed(() =>
  allTemplates.value.filter((t) => t.category === 'custom'),
)

function toggle() {
  visible.value = !visible.value
  savingMode.value = false
  saveName.value = ''
  saveDesc.value = ''
}

function close() {
  visible.value = false
  savingMode.value = false
  justCreatedId.value = null
}

/** 从模板创建新 Sequence 并切换到它 */
function applyTemplate(template: SequenceTemplate) {
  const newId = store.createSequenceFromTemplate(template)
  if (newId) {
    store.switchSequence(newId)
    justCreatedId.value = newId
    // 短暂高亮后关闭
    setTimeout(() => {
      close()
    }, 300)
  }
}

/** 进入保存模式 */
function startSave() {
  savingMode.value = true
  saveName.value = store.activeSequence?.name ?? ''
  saveDesc.value = ''
}

/** 确认保存 */
function confirmSave() {
  const seqId = store.activeSequenceId
  const saved = store.saveSequenceAsTemplate(seqId, saveName.value, saveDesc.value)
  if (saved) {
    savingMode.value = false
    saveName.value = ''
    saveDesc.value = ''
  }
}

/** 取消保存 */
function cancelSave() {
  savingMode.value = false
}

/** 删除自定义模板 */
function deleteTemplate(templateId: string) {
  store.deleteCustomTemplate(templateId)
}

/** 格式化分辨率显示 */
function formatResolution(t: SequenceTemplate): string {
  return `${t.width}×${t.height}`
}

/** 格式化轨道摘要 */
function formatTracks(t: SequenceTemplate): string {
  const counts: Record<string, number> = {}
  for (const tr of t.tracks) {
    const label = tr.type === 'video' ? '视频' :
                  tr.type === 'audio' ? '音频' :
                  tr.type === 'text' ? '文字' : '特效'
    counts[label] = (counts[label] ?? 0) + 1
  }
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ')
}
</script>

<template>
  <div class="template-picker">
    <button class="tp-btn" data-tip="从模板创建新序列" @click="toggle">
      模板库
    </button>

    <Transition name="tp-panel">
      <div v-if="visible" class="tp-panel" @click.self="close">
        <div class="tp-panel-inner">
          <!-- 头部 -->
          <div class="tp-header">
            <span class="tp-title">Sequence 模板库</span>
            <button class="tp-close" @click="close">关闭</button>
          </div>

          <!-- 保存模式 -->
          <div v-if="savingMode" class="tp-save-form">
            <div class="tp-save-row">
              <label class="tp-label">模板名称</label>
              <input
                v-model="saveName"
                class="tp-input"
                placeholder="输入模板名称"
                @keyup.enter="confirmSave"
              />
            </div>
            <div class="tp-save-row">
              <label class="tp-label">描述(可选)</label>
              <input
                v-model="saveDesc"
                class="tp-input"
                placeholder="简短描述"
              />
            </div>
            <div class="tp-save-actions">
              <button class="tp-btn-action primary" @click="confirmSave">保存</button>
              <button class="tp-btn-action" @click="cancelSave">取消</button>
            </div>
          </div>

          <!-- 模板列表 -->
          <div v-else class="tp-content">
            <!-- 保存按钮 -->
            <button class="tp-save-btn" @click="startSave">
              + 将当前序列保存为模板
            </button>

            <!-- 内置模板 -->
            <div class="tp-section">
              <div class="tp-section-title">内置模板</div>
              <div class="tp-grid">
                <div
                  v-for="t in builtinTemplates"
                  :key="t.id"
                  class="tp-card builtin"
                  :class="{ 'just-created': justCreatedId === t.id }"
                  @click="applyTemplate(t)"
                >
                  <div class="tp-card-header">
                    <span class="tp-card-name">{{ t.name }}</span>
                    <span class="tp-card-badge">内置</span>
                  </div>
                  <div class="tp-card-desc">{{ t.description }}</div>
                  <div class="tp-card-meta">
                    <span class="tp-meta-res">{{ formatResolution(t) }}</span>
                    <span class="tp-meta-fps">{{ t.fps }} fps</span>
                    <span class="tp-meta-dur">{{ t.durationSec }}s</span>
                  </div>
                  <div class="tp-card-tracks">{{ formatTracks(t) }}</div>
                </div>
              </div>
            </div>

            <!-- 自定义模板 -->
            <div v-if="customTemplates.length > 0" class="tp-section">
              <div class="tp-section-title">自定义模板</div>
              <div class="tp-grid">
                <div
                  v-for="t in customTemplates"
                  :key="t.id"
                  class="tp-card custom"
                  @click="applyTemplate(t)"
                >
                  <div class="tp-card-header">
                    <span class="tp-card-name">{{ t.name }}</span>
                    <button
                      class="tp-card-delete"
                      data-tip="删除模板"
                      @click.stop="deleteTemplate(t.id)"
                    >×</button>
                  </div>
                  <div class="tp-card-desc">{{ t.description }}</div>
                  <div class="tp-card-meta">
                    <span class="tp-meta-res">{{ formatResolution(t) }}</span>
                    <span class="tp-meta-fps">{{ t.fps }} fps</span>
                    <span class="tp-meta-dur">{{ t.durationSec }}s</span>
                  </div>
                  <div class="tp-card-tracks">{{ formatTracks(t) }}</div>
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
.template-picker {
  position: relative;
  display: inline-block;
}

.tp-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.tp-panel {
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

.tp-panel-inner {
  width: 680px;
  max-height: 80vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.tp-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.tp-close {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-close:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}

.tp-content {
  padding: 16px;
  overflow-y: auto;
}

.tp-save-btn {
  width: 100%;
  padding: 8px;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--pf-accent);
  background: var(--pf-accent-soft);
  border: 1px dashed var(--pf-accent);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-save-btn:hover {
  background: var(--pf-accent);
  color: white;
}

.tp-section {
  margin-bottom: 16px;
}
.tp-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-ink-muted);
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--pf-line);
}

.tp-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.tp-card {
  padding: 10px 12px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 6px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-card:hover {
  border-color: var(--pf-accent);
  box-shadow: 0 2px 8px rgba(184, 92, 46, 0.12);
}
.tp-card.just-created {
  border-color: var(--pf-success);
  box-shadow: 0 0 0 2px rgba(74, 122, 62, 0.3);
}

.tp-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.tp-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
}
.tp-card-badge {
  font-size: 9px;
  padding: 1px 6px;
  color: var(--pf-ink-muted);
  background: var(--pf-line);
  border-radius: 3px;
}
.tp-card-delete {
  width: 18px;
  height: 18px;
  font-size: 14px;
  line-height: 1;
  color: var(--pf-ink-faint);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 3px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-card-delete:hover {
  color: var(--pf-danger, #ff4d4f);
  border-color: var(--pf-danger, #ff4d4f);
}

.tp-card-desc {
  font-size: 11px;
  color: var(--pf-ink-muted);
  margin-bottom: 6px;
  line-height: 1.4;
}

.tp-card-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-faint);
}
.tp-card-tracks {
  font-size: 10px;
  color: var(--pf-ink-faint);
}

/* 保存表单 */
.tp-save-form {
  padding: 16px;
}
.tp-save-row {
  margin-bottom: 12px;
}
.tp-label {
  display: block;
  font-size: 12px;
  color: var(--pf-ink-muted);
  margin-bottom: 4px;
}
.tp-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  outline: none;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-input:focus {
  border-color: var(--pf-accent);
}
.tp-save-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.tp-btn-action {
  padding: 6px 16px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-btn-action:hover {
  border-color: var(--pf-ink-muted);
}
.tp-btn-action.primary {
  color: white;
  background: var(--pf-accent);
  border-color: var(--pf-accent);
}
.tp-btn-action.primary:hover {
  opacity: 0.9;
}

/* 过渡动画 */
.tp-panel-enter-active,
.tp-panel-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tp-panel-enter-from,
.tp-panel-leave-to {
  opacity: 0;
}
</style>
