<script setup lang="ts">
/**
 * ConnectionLine(Step 25.8)— 节点间的连接线(SVG 贝塞尔曲线)。
 *
 * 职责:
 * - 渲染 edge(from 节点的输出端口 → to 节点的输入端口)
 * - 支持点击选中(emit selectEdge)
 * - 支持删除(选中后按 Delete,由父组件处理)
 * - 临时连线(用户正在拖拽但未松开时,from 固定,to 跟随鼠标)
 *
 * 路径计算:
 * - 起点:from 节点的 output 端口中心(节点右边界中点)
 * - 终点:to 节点的 input 端口中心(节点左边界中点)
 * - 控制点:水平偏移(让曲线更平滑)
 *
 * 注意:节点位置由 graphStore 管理,本组件通过 props 接收端点坐标,
 *       不直接依赖 graphStore(便于复用与测试)。
 */

import { computed } from 'vue'

interface Props {
  /** 起点 x(像素,相对于画布原点) */
  fromX: number
  /** 起点 y */
  fromY: number
  /** 终点 x */
  toX: number
  /** 终点 y */
  toY: number
  /** 是否选中 */
  selected?: boolean
  /** 是否临时连线(用户正在拖拽) */
  temporary?: boolean
  /** edge id(用于点击选中) */
  edgeId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  selectEdge: [edgeId: string]
}>()

/** 贝塞尔曲线路径(水平方向控制点,产生平滑的 S 形曲线) */
const pathD = computed(() => {
  const { fromX, fromY, toX, toY } = props
  const dx = Math.abs(toX - fromX)
  const offset = Math.max(40, dx * 0.4)  // 控制点水平偏移
  return `M ${fromX} ${fromY} C ${fromX + offset} ${fromY}, ${toX - offset} ${toY}, ${toX} ${toY}`
})

const lineClass = computed(() => ({
  'connection-line': true,
  'line-selected': props.selected,
  'line-temporary': props.temporary,
}))

function handleClick() {
  if (props.edgeId) {
    emit('selectEdge', props.edgeId)
  }
}
</script>

<template>
  <path
    :d="pathD"
    :class="lineClass"
    fill="none"
    stroke-width="2"
    @click.stop="handleClick"
  />
</template>

<style scoped>
.connection-line {
  stroke: var(--pf-line);
  stroke-width: 2;
  fill: none;
  cursor: pointer;
  transition: stroke 180ms cubic-bezier(0.22, 1, 0.36, 1),
              stroke-width 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.connection-line:hover {
  stroke: var(--pf-accent);
  stroke-width: 3;
}

.line-selected {
  stroke: var(--pf-accent);
  stroke-width: 3;
  filter: drop-shadow(0 0 4px rgba(184, 92, 46, 0.35));
}

.line-temporary {
  stroke: var(--pf-accent);
  stroke-width: 2;
  stroke-dasharray: 6 4;
  pointer-events: none;
  opacity: 0.7;
}
</style>
