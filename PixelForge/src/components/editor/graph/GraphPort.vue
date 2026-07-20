<script setup lang="ts">
/**
 * GraphPort(Step 25.8 / 27.8)— 节点端口组件。
 *
 * 职责:
 * - 显示输入/输出端口(小圆点)
 * - mousedown 输出端口 → emit portStartConnect(开始连线)
 * - 在按钮元素上设置 data-port-* 属性(供 mouseup hit-test 用)
 * - 高亮当前可连接的端口
 *
 * 交互模式(Step 27 更新):
 * - 旧版:click 输出端口 → 进入"连线中" → click 输入端口 → 完成
 * - 新版:mousedown 输出端口 → 拖动 → mouseup 在输入端口上 → 完成
 *   (更符合 Blender / Unreal 的拖拽连线交互)
 * - 输入端口不需要 mousedown 处理(由 mouseup 时的 hit-test 检测)
 *
 * Hit-test 机制:
 * - 按钮元素设置 data-port-direction / data-port-node-id / data-port-id
 * - useGraphInteraction.handleConnectingEnd 读取 e.target.dataset 完成连线
 */

import { computed } from 'vue'
import type { Port } from '@/graph/types'

interface Props {
  port: Port
  /** 端口方向(input/output) */
  direction: 'input' | 'output'
  /** 节点 ID(用于 dataset 属性 + emit 时传递) */
  nodeId: string
  /** 是否被选中(当前正在连线中的目标端口) */
  active?: boolean
  /** 是否已连接(输入端口已被占用) */
  connected?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** mousedown 输出端口:开始连线 */
  portStartConnect: [nodeId: string, portId: string, direction: 'input' | 'output', clientX: number, clientY: number]
}>()

const portClass = computed(() => ({
  'graph-port': true,
  [`port-${props.direction}`]: true,
  'port-active': props.active,
  'port-connected': props.connected,
  'port-texture': props.port.type === 'texture',
  'port-value': props.port.type === 'value',
}))

/**
 * mousedown 处理:
 * - 输出端口:emit portStartConnect(开始连线)
 * - 输入端口:不做处理(由 mouseup hit-test 完成连线)
 */
function handleMouseDown(e: MouseEvent): void {
  if (e.button !== 0) return  // 仅左键
  e.stopPropagation()
  if (props.direction === 'output') {
    emit('portStartConnect', props.nodeId, props.port.id, props.direction, e.clientX, e.clientY)
  }
}
</script>

<template>
  <div class="port-row" :class="`port-row-${direction}`">
    <span v-if="direction === 'output'" class="port-label">{{ port.name }}</span>
    <button
      :class="portClass"
      :data-port-direction="direction"
      :data-port-node-id="nodeId"
      :data-port-id="port.id"
      :data-tip="`${direction === 'input' ? '输入' : '输出'}: ${port.name} (${port.type})`"
      @mousedown="handleMouseDown"
    />
    <span v-if="direction === 'input'" class="port-label">{{ port.name }}</span>
  </div>
</template>

<style scoped>
.port-row {
  display: flex;
  align-items: center;
  height: 22px;
  font-size: 11px;
  color: var(--pf-ink-soft);
}

.port-row-input {
  justify-content: flex-start;
  gap: 6px;
}

.port-row-output {
  justify-content: flex-end;
  gap: 6px;
}

.port-label {
  user-select: none;
  white-space: nowrap;
}

.graph-port {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--pf-line);
  background: var(--pf-surface);
  cursor: crosshair;
  padding: 0;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.graph-port:hover {
  transform: scale(1.2);
  border-color: var(--pf-accent);
}

/* texture 端口:蓝色 */
.port-texture {
  border-color: var(--pf-accent);
}

/* value 端口:橙色 */
.port-value {
  border-color: var(--pf-warning, #d97706);
}

/* 已连接:实心 */
.port-connected {
  background: var(--pf-accent);
}

/* 激活中:放大 + 发光 */
.port-active {
  background: var(--pf-accent);
  box-shadow: 0 0 0 4px rgba(184, 92, 46, 0.18);
  transform: scale(1.25);
}
</style>
