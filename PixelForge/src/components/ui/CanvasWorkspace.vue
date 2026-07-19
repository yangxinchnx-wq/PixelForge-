<script setup lang="ts">
defineProps<{
  title: string
  status: 'idle' | 'initializing' | 'ready' | 'error'
  canvasFormat: string | null
  canvasSize: { width: number; height: number } | null
  currentScenario: string
  currentLayerId: string | null
  currentOpcode: string | null
  error: string | null
}>()

defineEmits<{
  warmPatch: []
  coolPatch: []
  reset: []
}>()

function formatStatus(status: 'idle' | 'initializing' | 'ready' | 'error') {
  switch (status) {
    case 'idle':
      return '空闲'
    case 'initializing':
      return '初始化中'
    case 'ready':
      return '就绪'
    case 'error':
      return '错误'
  }
}
</script>

<template>
  <section class="workspace-panel">
    <header class="workspace-topbar">
      <div>
        <p class="section-kicker">主工作区</p>
        <h2 class="workspace-title">{{ title }}</h2>
      </div>

      <div class="workspace-status">
        <span class="status-indicator" :data-status="status">{{ formatStatus(status) }}</span>
      </div>
    </header>

    <div class="workspace-metrics">
      <article class="metric-tile">
        <span>当前场景</span>
        <strong>{{ currentScenario }}</strong>
      </article>
      <article class="metric-tile">
        <span>当前图层</span>
        <strong>{{ currentLayerId ?? '无' }}</strong>
      </article>
      <article class="metric-tile">
        <span>当前指令</span>
        <strong>{{ currentOpcode ?? '无' }}</strong>
      </article>
      <article class="metric-tile">
        <span>画布尺寸</span>
        <strong>{{ canvasSize ? `${canvasSize.width} × ${canvasSize.height}` : '无' }}</strong>
      </article>
      <article class="metric-tile">
        <span>输出格式</span>
        <strong>{{ canvasFormat ?? '无' }}</strong>
      </article>
    </div>

    <div class="canvas-stage">
      <slot name="canvas" />
      <div class="canvas-overlay">
        <span>补丁 -> 编译 -> 渲染</span>
      </div>
    </div>

    <footer class="workspace-toolbar">
      <div class="button-group">
        <button type="button" class="tool-button primary" @click="$emit('warmPatch')">暖色补丁</button>
        <button type="button" class="tool-button primary" @click="$emit('coolPatch')">冷色补丁</button>
        <button type="button" class="tool-button" @click="$emit('reset')">重置当前帧</button>
      </div>

      <p v-if="error" class="workspace-error">{{ error }}</p>
    </footer>
  </section>
</template>
