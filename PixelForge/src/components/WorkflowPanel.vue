<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAppStore } from '../stores/app';

const store = useAppStore();

// ─── Workflow Steps ───────────────────────────────────
type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface WorkflowStep {
  id: string;
  label: string;
  icon: string;
  status: StepStatus;
  /** 步骤描述（hover 时显示） */
  hint: string;
}

const steps = ref<WorkflowStep[]>([
  { id: 'input', label: '描述输入', icon: 'chat', status: 'pending', hint: '输入创作描述' },
  { id: 'parse', label: 'AI 解析', icon: 'brain', status: 'pending', hint: 'AI 解析意图 → 打开可视化编程引擎' },
  { id: 'generate', label: '图片生成', icon: 'sparkle', status: 'pending', hint: '生成画面' },
  { id: 'postprocess', label: '后处理', icon: 'wand', status: 'pending', hint: '效果链与画面调节' },
  { id: 'export', label: '导出', icon: 'download', status: 'pending', hint: '渲染导出' },
]);

// ─── Sync with store.isGenerating ─────────────────────
watch(
  () => store.isGenerating,
  (generating) => {
    if (generating) {
      // 开始生成：重置所有步骤，然后启动流水线动画
      steps.value.forEach((s) => (s.status = 'pending'));

      // 步骤 1: 描述输入 → done
      steps.value[0].status = 'done';
      // 步骤 2: AI 解析 → active
      steps.value[1].status = 'active';

      // 步骤 2 → done, 步骤 3 → active (300ms后)
      setTimeout(() => {
        steps.value[1].status = 'done';
        steps.value[2].status = 'active';
      }, 300);

      // 步骤 3 → done, 步骤 4 → active (700ms后)
      setTimeout(() => {
        steps.value[2].status = 'done';
        steps.value[3].status = 'active';
      }, 700);

      // 步骤 4 → done, 步骤 5 → active (1000ms后)
      setTimeout(() => {
        steps.value[3].status = 'done';
        steps.value[4].status = 'active';
      }, 1000);
    } else {
      // 生成完成：所有步骤标记为 done
      setTimeout(() => {
        steps.value.forEach((s) => {
          if (s.status === 'active') s.status = 'done';
        });
      }, 200);
    }
  },
);

// ─── Step click — 打开对应功能面板 ─────────────────────
const emit = defineEmits<{
  /** 步骤被点击 */
  stepClick: [stepId: string];
}>();

function clickStep(step: WorkflowStep) {
  emit('stepClick', step.id);
}

// ─── Icons (inline SVG) ───────────────────────────────
const iconPaths: Record<string, string> = {
  chat: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  brain: 'M12 2a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0-1 5.87V17a3 3 0 0 0 3 3 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 3-3v-3.13A3 3 0 0 0 18 8a3 3 0 0 0-3-3 3 3 0 0 0-3-3z',
  sparkle: 'M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
};

// ─── Computed: progress percentage ────────────────────
const progressPercent = computed(() => {
  const done = steps.value.filter((s) => s.status === 'done').length;
  return (done / steps.value.length) * 100;
});
</script>

<template>
  <div class="pf-panel pf-workflow-panel">
    <!-- Header -->
    <div class="pf-panel-header">
      <span class="pf-panel-title">工作流</span>
      <div class="pf-workflow-progress">
        <div class="pf-workflow-progress-bar">
          <div class="pf-workflow-progress-fill" :style="{ width: progressPercent + '%' }" />
        </div>
        <span class="pf-workflow-progress-text">{{ Math.round(progressPercent) }}%</span>
      </div>
    </div>

    <!-- Workflow Steps -->
    <div class="pf-workflow-body">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="pf-workflow-step"
        :class="'status-' + step.status"
        :title="step.hint"
        @click="clickStep(step)"
      >
        <!-- Connector Line (before step, except first) -->
        <div v-if="index > 0" class="pf-workflow-connector" :class="{ filled: steps[index - 1].status === 'done' }" />

        <!-- Step Circle -->
        <div class="pf-workflow-step-circle">
          <!-- Done icon -->
          <svg v-if="step.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <!-- Active spinner -->
          <div v-else-if="step.status === 'active'" class="pf-workflow-step-spinner" />
          <!-- Step icon (pending) -->
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path :d="iconPaths[step.icon] || ''" />
          </svg>
        </div>

        <!-- Step Label -->
        <span class="pf-workflow-step-label">{{ step.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf-workflow-panel {
  height: var(--timeline-height);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Progress Bar (in header) ── */
.pf-workflow-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.pf-workflow-progress-bar {
  width: 80px;
  height: 4px;
  background: var(--separator-strong);
  border-radius: 2px;
  overflow: hidden;
}

.pf-workflow-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 400ms var(--ease-out);
}

.pf-workflow-progress-text {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 28px;
  text-align: right;
}

/* ── Workflow Body ── */
.pf-workflow-body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  gap: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.pf-workflow-body::-webkit-scrollbar {
  height: 4px;
}

.pf-workflow-body::-webkit-scrollbar-thumb {
  background: var(--text-quaternary);
  border-radius: 2px;
}

/* ── Step ── */
.pf-workflow-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  flex-shrink: 0;
  min-width: 80px;
  cursor: pointer;
  transition: opacity 200ms ease, transform 200ms ease;
}

.pf-workflow-step:hover {
  transform: translateY(-2px);
}

.pf-workflow-step.status-pending {
  opacity: 0.45;
}

.pf-workflow-step.status-pending:hover {
  opacity: 0.7;
}

/* ── Connector Line ── */
.pf-workflow-connector {
  position: absolute;
  top: 13px;
  right: 50%;
  width: 100%;
  height: 2px;
  background: var(--separator-strong);
  z-index: 0;
  transition: background 300ms ease;
}

.pf-workflow-connector.filled {
  background: var(--accent);
}

/* ── Step Circle ── */
.pf-workflow-step-circle {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
  transition: all 300ms var(--ease-out);
  background: var(--track-bg);
  border: 2px solid var(--separator-strong);
  color: var(--text-tertiary);
}

.pf-workflow-step:hover .pf-workflow-step-circle {
  border-color: var(--text-quaternary);
}

.pf-workflow-step.status-active .pf-workflow-step-circle {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 20%, transparent);
}

.pf-workflow-step.status-done .pf-workflow-step-circle {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-text);
}

.pf-workflow-step.status-error .pf-workflow-step-circle {
  background: #ef4444;
  border-color: #ef4444;
  color: white;
}

/* ── Step Label ── */
.pf-workflow-step-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  white-space: nowrap;
  transition: color 200ms ease;
}

.pf-workflow-step:hover .pf-workflow-step-label {
  color: var(--text-secondary);
}

.pf-workflow-step.status-active .pf-workflow-step-label {
  color: var(--accent);
  font-weight: 600;
}

.pf-workflow-step.status-done .pf-workflow-step-label {
  color: var(--text-primary);
}

/* ── Spinner (active step) ── */
.pf-workflow-step-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: workflowSpin 0.7s linear infinite;
}

@keyframes workflowSpin {
  to { transform: rotate(360deg); }
}

/* ── Responsive: compact on narrow ── */
@media (max-width: 600px) {
  .pf-workflow-step {
    min-width: 60px;
  }

  .pf-workflow-step-label {
    font-size: 10px;
  }
}
</style>
