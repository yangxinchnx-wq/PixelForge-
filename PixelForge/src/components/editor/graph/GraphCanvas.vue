<script setup lang="ts">
/**
 * GraphCanvas(Step 27.4)— 无限画布容器。
 *
 * 职责:
 * - 应用 world → screen 变换(translate + scale)
 * - 提供背景网格(点阵,随 zoom 缩放)
 * - 提供 SVG 连接线层(在节点层下方,绝对定位)
 * - 提供节点层 slot(由 GraphEditor 填充 GraphNode 列表)
 *
 * 不负责:
 * - 事件处理(由 useGraphInteraction 通过 canvasEl 监听)
 * - 状态管理(只读 uiStore)
 *
 * 坐标变换:
 *   screen = (world + offset) × zoom
 *
 * CSS 实现:
 *   .graph-world { transform: translate(offset.x, offset.y) scale(zoom); transform-origin: 0 0; }
 *
 * 用法:
 *   <GraphCanvas>
 *     <template #edges><ConnectionLine ... /></template>
 *     <GraphNode v-for="n in nodes" :node="n" />
 *   </GraphCanvas>
 */

import { computed } from 'vue'

import { useGraphUIStore } from '@/graph/uiStore'

const ui = useGraphUIStore()

/** world → screen 变换样式 */
const worldTransform = computed(() => ({
  transform: `translate(${ui.offset.x}px, ${ui.offset.y}px) scale(${ui.zoom})`,
  transformOrigin: '0 0',
}))

/** 背景网格大小(随 zoom 缩放,保持视觉密度) */
const gridSize = computed(() => {
  // 基础 20px,随 zoom 缩放
  const base = 20
  const scaled = base * ui.zoom
  // 当网格太小时(< 8px)跳到 2× 大小,避免视觉过密
  if (scaled < 8) return base * 2 * ui.zoom
  return scaled
})

/** 网格背景样式 */
const gridBackground = computed(() => {
  const size = gridSize.value
  return {
    backgroundImage: `radial-gradient(circle, var(--pf-line) 1px, transparent 1px)`,
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${ui.offset.x}px ${ui.offset.y}px`,
  }
})
</script>

<template>
  <div
    class="graph-canvas"
    :style="gridBackground"
  >
    <!-- World 层(应用变换) -->
    <div class="graph-world" :style="worldTransform">
      <!-- SVG 连接线层(slot,在节点下方) -->
      <slot name="edges" />

      <!-- 节点层(slot) -->
      <slot />
    </div>
  </div>
</template>

<style scoped>
.graph-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--pf-bg, #faf7f0);
  cursor: grab;
}

.graph-canvas:active {
  cursor: grabbing;
}

.graph-world {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  /* transform 由内联样式设置 */
}
</style>
