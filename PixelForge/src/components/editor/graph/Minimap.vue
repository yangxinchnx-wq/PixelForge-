<script setup lang="ts">
/**
 * Minimap(Step 27.17)— 右下角缩略图。
 *
 * 职责:
 * - 在固定尺寸(180×120)内显示所有节点的缩略位置
 * - 显示当前视口(visible area)的矩形框
 * - 点击 / 拖动缩略图 → 移动视口到对应位置
 *
 * 数据来源:
 * - graph.nodes:节点位置(世界坐标)
 * - ui.zoom / ui.offset:当前视口参数
 * - 画布尺寸:由父组件通过 props 传入
 *
 * 坐标变换:
 * - world → minimap: minimap = (world - bounds.min) × scale + padding
 * - minimap → world: world = (minimap - padding) / scale + bounds.min
 * - viewport rect: 由 ui.offset / ui.zoom / canvasSize 计算
 */

import { computed, ref } from 'vue'

import { useGraphStore } from '@/graph/graphStore'
import { useGraphUIStore } from '@/graph/uiStore'
import { computeNodeBounds } from '@/graph/layout'
import { NODE_SIZE } from '@/graph/types'

interface Props {
  /** 画布尺寸(像素,screen 系,用于计算视口矩形) */
  canvasSize: { width: number; height: number }
}

const props = defineProps<Props>()

const graph = useGraphStore()
const ui = useGraphUIStore()

/** 缩略图尺寸(固定) */
const MINIMAP_W = 180
const MINIMAP_H = 120
const PADDING = 8

const svgEl = ref<SVGSVGElement | null>(null)

/** 节点边界(世界坐标) */
const bounds = computed(() => {
  if (graph.nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 800, maxY: 400 }
  }
  return computeNodeBounds(graph.nodes)
})

/** 缩放比(world → minimap) */
const scale = computed(() => {
  const bw = bounds.value.maxX - bounds.value.minX
  const bh = bounds.value.maxY - bounds.value.minY
  if (bw <= 0 || bh <= 0) return 1
  const sx = (MINIMAP_W - PADDING * 2) / bw
  const sy = (MINIMAP_H - PADDING * 2) / bh
  return Math.min(sx, sy, 0.5)  // 上限 0.5,避免缩略图过大
})

/** world → minimap 坐标转换 */
function worldToMinimap(wx: number, wy: number): { x: number; y: number } {
  return {
    x: (wx - bounds.value.minX) * scale.value + PADDING,
    y: (wy - bounds.value.minY) * scale.value + PADDING,
  }
}

/** minimap → world 坐标转换 */
function minimapToWorld(mx: number, my: number): { x: number; y: number } {
  return {
    x: (mx - PADDING) / scale.value + bounds.value.minX,
    y: (my - PADDING) / scale.value + bounds.value.minY,
  }
}

/** 节点矩形(minimap 坐标) */
const nodeRects = computed(() => {
  return graph.nodes.map((node) => {
    const p = worldToMinimap(node.position.x, node.position.y)
    return {
      id: node.id,
      x: p.x,
      y: p.y,
      w: Math.max(2, NODE_SIZE.width * scale.value),
      h: Math.max(2, (NODE_SIZE.headerHeight + 60) * scale.value),
      selected: ui.isNodeSelected(node.id),
      type: node.type,
    }
  })
})

/** 视口矩形(minimap 坐标) */
const viewportRect = computed(() => {
  // 视口在 world 系的矩形:
  //   左上角 = (-offset.x / zoom, -offset.y / zoom)
  //   尺寸  = (canvasSize.width / zoom, canvasSize.height / zoom)
  const worldX = -ui.offset.x / ui.zoom
  const worldY = -ui.offset.y / ui.zoom
  const worldW = props.canvasSize.width / ui.zoom
  const worldH = props.canvasSize.height / ui.zoom
  const p = worldToMinimap(worldX, worldY)
  return {
    x: p.x,
    y: p.y,
    w: Math.max(4, worldW * scale.value),
    h: Math.max(4, worldH * scale.value),
  }
})

/** 节点类型颜色(与 GraphNode.vue 对齐) */
function nodeColor(type: string): string {
  switch (type) {
    case 'REGION':
      return 'var(--pf-accent, #b85c2e)'
    case 'EFFECT':
      return '#7c3aed'
    case 'COMPOSITE':
      return '#0891b2'
    case 'OUTPUT':
      return 'var(--pf-success, #16a34a)'
    case 'INPUT':
      return 'var(--pf-ink-soft)'
    default:
      return 'var(--pf-ink-soft)'
  }
}

/** 点击 / 拖动 minimap → 移动视口中心到对应 world 位置 */
function handleNavigate(e: MouseEvent): void {
  if (!svgEl.value) return
  const rect = svgEl.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const world = minimapToWorld(mx, my)
  // 把视口中心移到 world 位置
  // screen = (world + offset) × zoom → offset = screen/zoom - world
  // 视口中心 screen = (canvasSize.width/2, canvasSize.height/2)
  ui.setOffset(
    props.canvasSize.width / 2 / ui.zoom - world.x,
    props.canvasSize.height / 2 / ui.zoom - world.y,
  )
}

/** 拖动状态 */
let isDragging = false

function handleMouseDown(e: MouseEvent): void {
  isDragging = true
  handleNavigate(e)
  window.addEventListener('mousemove', handleNavigate)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMouseUp(): void {
  isDragging = false
  window.removeEventListener('mousemove', handleNavigate)
  window.removeEventListener('mouseup', handleMouseUp)
}
</script>

<template>
  <div class="minimap-container">
    <svg
      ref="svgEl"
      :width="MINIMAP_W"
      :height="MINIMAP_H"
      class="minimap-svg"
      :class="{ 'minimap-dragging': isDragging }"
      @mousedown="handleMouseDown"
    >
      <!-- 背景 -->
      <rect
        :x="0"
        :y="0"
        :width="MINIMAP_W"
        :height="MINIMAP_H"
        fill="rgba(250, 247, 240, 0.9)"
      />

      <!-- 节点矩形 -->
      <rect
        v-for="node in nodeRects"
        :key="node.id"
        :x="node.x"
        :y="node.y"
        :width="node.w"
        :height="node.h"
        :rx="1"
        :fill="nodeColor(node.type)"
        :stroke="node.selected ? 'var(--pf-accent)' : 'transparent'"
        :stroke-width="node.selected ? 1.5 : 0"
        opacity="0.8"
      />

      <!-- 视口矩形 -->
      <rect
        :x="viewportRect.x"
        :y="viewportRect.y"
        :width="viewportRect.w"
        :height="viewportRect.h"
        fill="none"
        stroke="var(--pf-accent)"
        stroke-width="1.2"
        opacity="0.9"
      />
    </svg>
  </div>
</template>

<style scoped>
.minimap-container {
  position: absolute;
  right: 16px;
  bottom: 16px;
  pointer-events: auto;
  border-radius: var(--pf-r-md, 10px);
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(20, 18, 14, 0.12);
  border: 1px solid var(--pf-line);
}

.minimap-svg {
  display: block;
  cursor: pointer;
}

.minimap-svg.minimap-dragging {
  cursor: grabbing;
}
</style>
