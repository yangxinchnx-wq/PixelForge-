<script setup lang="ts">
/**
 * ErrorToast(Step 40.4)— 全局错误通知 Toast 组件。
 *
 * 功能:
 * - 从 errorStore 读取 activeError,展示为右上角 Toast
 * - 三级样式:error(红色)/ warning(黄色)/ info(蓝色)
 * - 自动消失(info/warning 5s,error 需手动关闭)
 * - 支持点击关闭 + "查看详情"展开
 * - iOS 风格动画(180ms cubic-bezier)
 *
 * 用法:
 *   <ErrorToast />  // 在 App.vue 根挂载一次即可
 */
import { ref, watch } from 'vue'
import { useErrorStore } from '@/stores/errorStore'

const errorStore = useErrorStore()

const expanded = ref(false)
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null

// —— 自动消失逻辑 ——
watch(() => errorStore.activeError, (entry) => {
  // 清除旧定时器
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer)
    autoDismissTimer = null
  }
  expanded.value = false

  if (!entry) return

  // info / warning 自动消失,error 需手动关闭
  if (entry.level === 'info' || entry.level === 'warning') {
    autoDismissTimer = setTimeout(() => {
      errorStore.dismiss(entry.id)
    }, 5000)
  }
}, { immediate: true })

function handleClose() {
  if (errorStore.activeError) {
    errorStore.dismiss(errorStore.activeError.id)
  }
}

function toggleExpand() {
  expanded.value = !expanded.value
}

function levelIcon(level: string): string {
  if (level === 'error') return '✕'
  if (level === 'warning') return '!'
  return 'i'
}
</script>

<template>
  <Transition name="toast-slide">
    <div
      v-if="errorStore.activeError"
      :class="['error-toast', errorStore.activeError.level]"
      role="alert"
      aria-live="assertive"
    >
      <div class="toast-header" @click="toggleExpand">
        <span :class="['toast-icon', errorStore.activeError.level]">{{ levelIcon(errorStore.activeError.level) }}</span>
        <span class="toast-message">{{ errorStore.activeError.message }}</span>
        <button class="toast-close" @click.stop="handleClose" aria-label="关闭">×</button>
      </div>
      <Transition name="toast-expand">
        <div v-if="expanded" class="toast-detail">
          <div class="detail-row"><span class="detail-label">错误码</span><code>{{ errorStore.activeError.code }}</code></div>
          <div class="detail-row"><span class="detail-label">来源</span><span>{{ errorStore.activeError.source }}</span></div>
          <div class="detail-row"><span class="detail-label">可恢复</span><span>{{ errorStore.activeError.recoverable ? '是' : '否' }}</span></div>
          <div v-if="errorStore.activeError.userHint" class="detail-hint">{{ errorStore.activeError.userHint }}</div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.error-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  width: 380px;
  max-width: calc(100vw - 40px);
  border-radius: var(--pf-r-md, 10px);
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  z-index: 1200;
  font-family: 'JetBrains Mono', monospace;
}

/* —— 级别样式 —— */
.error-toast.error {
  background: #2a1517;
  border: 1px solid #5c2a2e;
}
.error-toast.warning {
  background: #2a2515;
  border: 1px solid #5c4a2a;
}
.error-toast.info {
  background: #15202a;
  border: 1px solid #2a4a5c;
}

/* —— 头部 —— */
.toast-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.toast-icon {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: #fff;
}
.toast-icon.error { background: #e5484d; }
.toast-icon.warning { background: #f5a623; color: #1a1a1a; }
.toast-icon.info { background: #4a9eff; }

.toast-message {
  flex: 1;
  font-size: 13px;
  color: var(--pf-ink, #e0e0e0);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.toast-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--pf-ink-muted, #888);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-close:hover {
  color: var(--pf-ink, #e0e0e0);
}

/* —— 详情面板 —— */
.toast-detail {
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}
.detail-label {
  color: var(--pf-ink-muted, #888);
  width: 60px;
  flex-shrink: 0;
}
.detail-row code {
  color: #f5a623;
  font-size: 11px;
}
.detail-row span {
  color: var(--pf-ink-soft, #b0b0b0);
}
.detail-hint {
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  font-size: 11px;
  color: var(--pf-ink-soft, #b0b0b0);
  line-height: 1.4;
}

/* —— 动画 —— */
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toast-slide-enter-from,
.toast-slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.toast-expand-enter-active,
.toast-expand-leave-active {
  transition: max-height 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
  max-height: 200px;
}
.toast-expand-enter-from,
.toast-expand-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
