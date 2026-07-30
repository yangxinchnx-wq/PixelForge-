<script setup lang="ts">
/**
 * ErrorBoundary(Step 40.4)�?Vue 组件级错误边界�?
 *
 * 功能:
 * - 使用 onErrorCaptured 捕获子组件树错误
 * - 错误推送到 errorStore(全局通知)
 * - 提供 fallback 插槽,错误时展示友�?UI 而非白屏
 * - 支持重试(重置错误状�?重新渲染子组�?
 *
 * 用法:
 *   <ErrorBoundary>
 *     <GraphEditor />
 *     <template #fallback="{ error, retry }">
 *       <div>加载失败: {{ error.message }}</div>
 *       <button @click="retry">重试</button>
 *     </template>
 *   </ErrorBoundary>
 *
 * 设计原则:
 * - 不吞掉错�?推送到 errorStore + console.error)
 * - 阻止错误继续冒泡(返回 false)
 * - fallback 插槽提供 error 对象 + retry 函数
 * - 默认 fallback 简洁友�?可自定义
 */
import { ref, onErrorCaptured } from 'vue'
import { useErrorStore } from '@/stores/errorStore'

const errorStore = useErrorStore()

const capturedError = ref<Error | null>(null)
const retryKey = ref(0)

onErrorCaptured((err) => {
  capturedError.value = err as Error
  // 推送到全局错误队列(展示 toast)
  errorStore.push(err, '组件渲染错误,可点击重试恢�?)
  // console 兜底(便于调试)
  console.error('[ErrorBoundary] 捕获错误:', err)
  // 阻止错误继续冒泡�?app.config.errorHandler
  return false
})

function retry() {
  capturedError.value = null
  retryKey.value++
}
</script>

<template>
  <slot v-if="!capturedError" :key="retryKey" />
  <slot
    v-else
    name="fallback"
    :error="capturedError"
    :retry="retry"
  >
    <div class="error-boundary-fallback">
      <div class="fallback-icon">�?/div>
      <div class="fallback-title">渲染出错</div>
      <div class="fallback-message">{{ capturedError.message }}</div>
      <button class="fallback-retry" @click="retry">重试</button>
    </div>
  </slot>
</template>

<style scoped>
.error-boundary-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  gap: 12px;
  min-height: 200px;
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
}

.fallback-icon {
  font-size: 36px;
  color: #f5a623;
}

.fallback-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.fallback-message {
  font-size: 12px;
  color: var(--text-tertiary);
  max-width: 400px;
  line-height: 1.5;
}

.fallback-retry {
  margin-top: 8px;
  padding: 6px 16px;
  border: 1px solid var(--separator);
  border-radius: var(--radius-sm);
  background: var(--glass-bg-hover);
  color: var(--text-primary);
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.fallback-retry:hover {
  background: rgba(10, 132, 255, 0.12);
  border-color: var(--accent);
}
</style>
