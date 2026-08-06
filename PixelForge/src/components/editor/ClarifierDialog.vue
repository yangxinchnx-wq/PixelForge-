<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type {
  ClarifyAnswer,
  ClarifyQuestion,
  CreativeRequirement,
} from '@/authoring/clarifier/types'
import { summarizeRequirement } from '@/authoring/clarifier/intentAnalyzer'

interface Props {
  visible: boolean
  questions: ClarifyQuestion[]
  requirement: CreativeRequirement
  warnings?: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  submit: [answers: ClarifyAnswer[]]
  skip: []
  cancel: []
}>()

// 用户作答状态(以 question.id 为 key)
const answers = ref<Record<string, string | number | undefined>>({})

// —— 当 questions 变化时,初始化 answers 为默认值 ——
watch(
  () => props.questions,
  (newQuestions) => {
    const next: Record<string, string | number | undefined> = {}
    for (const q of newQuestions) {
      // 优先保留已有答案,否则用默认值
      next[q.id] = answers.value[q.id] ?? q.defaultValue
    }
    answers.value = next
  },
  { immediate: true },
)

// —— 当弹窗关闭再打开时,重置 answers ——
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      const next: Record<string, string | number | undefined> = {}
      for (const q of props.questions) {
        next[q.id] = q.defaultValue
      }
      answers.value = next
    }
  },
)

// 已识别字段的可读汇总
const recognizedSummary = computed(() => summarizeRequirement(props.requirement))

// 是否所有问题都已作答(非 undefined)
const allAnswered = computed(() => {
  return props.questions.every((q) => answers.value[q.id] !== undefined)
})

// 已回答数量
const answeredCount = computed(() => {
  return props.questions.filter((q) => answers.value[q.id] !== undefined).length
})

function selectOption(qId: string, option: string | number) {
  answers.value[qId] = option
}

function handleClose() {
  emit('update:visible', false)
  emit('cancel')
}

function handleSubmit() {
  const result: ClarifyAnswer[] = props.questions.map((q) => ({
    id: q.id,
    value: answers.value[q.id] ?? q.defaultValue ?? '',
  }))
  emit('submit', result)
  emit('update:visible', false)
}

function handleSkip() {
  emit('skip')
  emit('update:visible', false)
}
</script>

<template>
  <Transition name="clarifier-fade">
    <div v-if="visible" class="clarifier-overlay" @click.self="handleClose">
      <Transition name="clarifier-pop" appear>
        <div v-if="visible" class="clarifier-dialog" role="dialog" aria-modal="true">
          <!-- 标题栏 -->
          <header class="clarifier-header">
            <div class="header-title">
              <span class="title-text">需求澄清</span>
              <span class="title-count">{{ answeredCount }} / {{ questions.length }}</span>
            </div>
            <button class="close-btn" data-tip="取消澄清" @click="handleClose">×</button>
          </header>

          <!-- 已识别字段汇总(让用户知道哪些信息已被自动识别) -->
          <section v-if="recognizedSummary && recognizedSummary !== '(未识别到任何创作意图)'" class="recognized-section">
            <div class="section-label">已识别</div>
            <div class="recognized-text">{{ recognizedSummary }}</div>
          </section>

          <!-- 警告信息 -->
          <section v-if="warnings && warnings.length > 0" class="warnings-section">
            <div v-for="(w, i) in warnings" :key="i" class="warning-item">{{ w }}</div>
          </section>

          <!-- 问题列表 -->
          <section class="questions-section">
            <div v-for="q in questions" :key="q.id" class="question-card">
              <div class="question-title">{{ q.title }}</div>
              <div class="question-options">
                <button
                  v-for="opt in q.options"
                  :key="String(opt)"
                  class="option-chip"
                  :class="{ active: answers[q.id] === opt }"
                  @click="selectOption(q.id, opt)"
                >
                  {{ opt }}
                </button>
              </div>
            </div>
          </section>

          <!-- 底部操作栏 -->
          <footer class="clarifier-footer">
            <button class="btn btn-ghost" data-tip="使用默认值补全需求" @click="handleSkip">
              使用默认值
            </button>
            <button class="btn btn-accent" :disabled="!allAnswered" data-tip="提交答案并生成需求" @click="handleSubmit">
              确认生成
            </button>
          </footer>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* —— 遮罩层 —— */
.clarifier-overlay {
  position: fixed;
  inset: 0;
  background: rgba(20, 18, 14, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}

/* —— 弹窗主体 —— */
.clarifier-dialog {
  width: 100%;
  max-width: 540px;
  max-height: 85vh;
  background: var(--pf-surface);
  border-radius: var(--pf-r-xl);
  border: 1px solid var(--pf-line);
  box-shadow:
    0 20px 60px rgba(20, 18, 14, 0.18),
    0 4px 12px rgba(20, 18, 14, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
}

/* —— 标题栏 —— */
.clarifier-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 14px;
  border-bottom: 1px solid var(--pf-line);
}

.header-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.title-text {
  font-size: 17px;
  font-weight: 600;
  color: var(--pf-ink);
  letter-spacing: 0.01em;
}

.title-count {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--pf-ink-muted);
  font-family: 'JetBrains Mono', monospace;
}

.close-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--pf-ink-muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  background: var(--pf-surface-soft);
  color: var(--pf-ink);
}

/* —— 已识别字段汇总 —— */
.recognized-section {
  padding: 14px 24px;
  background: var(--pf-accent-soft);
  border-bottom: 1px solid rgba(184, 92, 46, 0.12);
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--pf-accent);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.recognized-text {
  font-size: 13px;
  color: var(--pf-ink-soft);
  line-height: 1.6;
}

/* —— 警告 —— */
.warnings-section {
  padding: 10px 24px;
  background: rgba(184, 132, 36, 0.06);
  border-bottom: 1px solid rgba(184, 132, 36, 0.12);
}

.warning-item {
  font-size: 12px;
  color: var(--pf-warning);
  line-height: 1.5;
}

/* —— 问题列表 —— */
.questions-section {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.question-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.question-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--pf-ink);
  line-height: 1.4;
}

.question-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option-chip {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink-soft);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  user-select: none;
}

.option-chip:hover {
  border-color: var(--pf-line-strong);
  color: var(--pf-ink);
  transform: translateY(-1px);
}

.option-chip.active {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
  transform: translateY(0);
  box-shadow: 0 4px 12px rgba(184, 92, 46, 0.24);
}

/* —— 底部操作栏 —— */
.clarifier-footer {
  display: flex;
  gap: 10px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--pf-line);
  background: var(--pf-surface);
}

.clarifier-footer .btn {
  flex: 1;
  height: 40px;
}

/* —— 按钮(与 PromptPanel 风格一致) —— */
.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--pf-surface-soft);
  border: 1px solid var(--pf-line);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--pf-ink);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.btn:hover {
  border-color: var(--pf-line-strong);
  transform: translateY(-1px);
}

.btn:active {
  transform: translateY(0) scale(0.98);
}

.btn-accent {
  background: var(--pf-accent);
  color: #fff;
  border-color: var(--pf-accent);
}

.btn-accent:hover {
  background: var(--pf-accent-deep);
  border-color: var(--pf-accent-deep);
}

.btn-ghost {
  background: transparent;
  color: var(--pf-ink-soft);
  border-color: var(--pf-line);
}

.btn-ghost:hover {
  background: var(--pf-surface-soft);
  color: var(--pf-ink);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

/* —— 过渡动画(iOS 风格) —— */
.clarifier-fade-enter-active,
.clarifier-fade-leave-active {
  transition: opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.clarifier-fade-enter-from,
.clarifier-fade-leave-to {
  opacity: 0;
}

.clarifier-pop-enter-active {
  transition:
    transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.clarifier-pop-leave-active {
  transition:
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.clarifier-pop-enter-from {
  opacity: 0;
  transform: scale(0.94) translateY(8px);
}

.clarifier-pop-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(4px);
}
</style>
