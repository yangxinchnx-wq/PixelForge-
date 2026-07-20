<script setup lang="ts">
/**
 * AnimationTrack — 单条动画轨道行。
 *
 * 结构:
 *   [标签+值+模式] [关键帧条]
 *
 * - 标签:track.label(中文)+ nodeId.property(灰色小字)
 * - 值:  当前时间下的 evaluateTrack 结果
 * - 模式:KEYFRAME / EXPRESSION 徽章
 * - 关键帧条:
 *   - 双击空白处 → addKeyframe(当前时间, 当前值)
 *   - 拖动关键帧 → updateKeyframe(time)
 *   - 右键关键帧 → removeKeyframe
 *
 * 与 frame-based ParameterTrack.vue 区别:
 * - 基于 time(秒)+ useAnimationStore
 * - 支持 EXPRESSION 模式
 * - 关键帧形状区分 linear/bezier/step
 */
import { computed, ref } from 'vue'

import type { AnimationTrack as Track } from '@/animation/types'
import { useAnimationStore } from '@/animation/timeline'
import { evaluateTrack } from '@/animation/evaluator'

import AnimationKeyframe from './AnimationKeyframe.vue'

interface Props {
  track: Track
}

const props = defineProps<Props>()

const store = useAnimationStore()

const stripRef = ref<HTMLElement | null>(null)
const draggingId = ref<string | null>(null)

/** 当前时间下的求值结果(显示在标签右侧) */
const currentValue = computed(() => {
  const v = evaluateTrack(props.track, store.currentTime)
  if (v === null) return '—'
  if (Math.abs(v) < 0.01) return '0.00'
  if (Math.abs(v) >= 100) return v.toFixed(1)
  return v.toFixed(3)
})

/** 排序后的关键帧(避免修改原数组) */
const sortedKeyframes = computed(() =>
  [...props.track.keyframes].sort((a, b) => a.time - b.time),
)

/** time → 百分比位置 */
function timeToPercent(time: number): string {
  if (store.duration <= 0) return '0%'
  return Math.max(0, Math.min(100, (time / store.duration) * 100)) + '%'
}

/** 双击空白处添加关键帧 */
function onStripDblClick(event: MouseEvent) {
  if (props.track.mode !== 'KEYFRAME') return
  if (!stripRef.value || store.duration <= 0) return
  const rect = stripRef.value.getBoundingClientRect()
  const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
  const time = (x / rect.width) * store.duration
  // 用当前求值作为初始 value(若求值失败用 0)
  const v = evaluateTrack(props.track, time)
  store.addKeyframe(props.track.id, time, v ?? 0)
}

/** 关键帧拖动 */
function onKeyframeMouseDown(kfId: string, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  draggingId.value = kfId

  const onMove = (e: MouseEvent) => {
    if (!stripRef.value || store.duration <= 0) return
    const rect = stripRef.value.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const time = (x / rect.width) * store.duration
    store.updateKeyframe(props.track.id, kfId, { time })
  }

  const onUp = () => {
    draggingId.value = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/** 右键关键帧删除 */
function onKeyframeContextMenu(kfId: string, event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
  store.removeKeyframe(props.track.id, kfId)
}

/** 模式徽章文字 */
const modeLabel = computed(() => {
  switch (props.track.mode) {
    case 'KEYFRAME':
      return '关键帧'
    case 'EXPRESSION':
      return '表达式'
    case 'PHYSICS':
      return '物理'
    default:
      return props.track.mode
  }
})

/** 切换启用状态 */
function toggleEnabled() {
  store.setTrackEnabled(props.track.id, !props.track.enabled)
}

/** 选中轨道 */
function selectTrack() {
  store.selectTrack(props.track.id)
}

/**
 * 关键帧之间的 SVG 路径(简化:linear 直线 / step 阶梯)。
 *
 * 注:bezier 在条上不画控制点(仅关键帧形状区分),路径用直线连接。
 *      y 全部画在中间(50% 中线),仅作视觉提示。
 */
const curvePath = computed(() => {
  if (props.track.mode !== 'KEYFRAME') return ''
  const kfs = sortedKeyframes.value
  if (kfs.length < 2 || store.duration <= 0) return ''
  const x = (t: number) => (t / store.duration) * 100
  const y = 50
  let d = `M ${x(kfs[0].time).toFixed(2)} ${y}`
  for (let i = 1; i < kfs.length; i++) {
    const prev = kfs[i - 1]
    const curr = kfs[i]
    if (prev.interpolation === 'step') {
      d += ` L ${x(curr.time).toFixed(2)} ${y} L ${x(curr.time).toFixed(2)} ${y}`
    } else {
      d += ` L ${x(curr.time).toFixed(2)} ${y}`
    }
  }
  return d
})
</script>

<template>
  <div
    class="anim-track"
    :class="{
      selected: store.selectedTrackId === track.id,
      disabled: !track.enabled,
    }"
    @mousedown="selectTrack"
  >
    <!-- 左侧:标签 + 当前值 + 模式徽章 + 启用切换 -->
    <div class="track-head">
      <button
        class="enable-btn"
        :class="{ on: track.enabled }"
        :data-tip="track.enabled ? '点击禁用' : '点击启用'"
        @click.stop="toggleEnabled"
      ></button>
      <div class="track-label">
        <span class="label-zh">{{ track.label }}</span>
        <span class="label-en">{{ track.nodeId }}.{{ track.property }}</span>
      </div>
      <span class="track-mode" :class="'mode-' + track.mode.toLowerCase()">{{ modeLabel }}</span>
      <span class="track-value">{{ currentValue }}</span>
    </div>

    <!-- 右侧:关键帧条 -->
    <div
      ref="stripRef"
      class="track-strip"
      :class="{ 'expr-mode': track.mode === 'EXPRESSION' }"
      @dblclick="onStripDblClick"
    >
      <!-- 网格背景 -->
      <div class="strip-grid"></div>

      <!-- 关键帧之间的连接线(SVG) -->
      <svg
        v-if="track.mode === 'KEYFRAME' && sortedKeyframes.length >= 2"
        class="strip-curve"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <path :d="curvePath" />
      </svg>

      <!-- 表达式模式:显示代码片段 -->
      <div v-if="track.mode === 'EXPRESSION'" class="expr-hint">
        {{ track.expression || '(空表达式)' }}
      </div>

      <!-- 关键帧点 -->
      <AnimationKeyframe
        v-for="kf in sortedKeyframes"
        :key="kf.id"
        :keyframe="kf"
        :left="timeToPercent(kf.time)"
        :selected="store.selectedTrackId === track.id"
        :dragging="kf.id === draggingId"
        :color="track.color"
        @mousedown="onKeyframeMouseDown(kf.id, $event)"
        @contextmenu="onKeyframeContextMenu(kf.id, $event)"
      />

      <!-- 选中态:在条上显示提示 -->
      <div v-if="track.mode === 'KEYFRAME' && sortedKeyframes.length === 0" class="empty-hint">
        双击此处添加关键帧
      </div>
    </div>
  </div>
</template>

<style scoped>
.anim-track {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-radius: var(--pf-r-sm);
  background: var(--pf-surface-soft);
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 180ms ease;
  cursor: default;
}
.anim-track:hover {
  background: var(--pf-surface-sunk);
}
.anim-track.selected {
  background: var(--pf-accent-soft);
  box-shadow: inset 0 0 0 1px var(--pf-accent);
}
.anim-track.disabled {
  opacity: 0.5;
}

/* —— 左侧头部 —— */
.track-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px 0 6px;
  min-width: 0;
}
.enable-btn {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1.5px solid var(--pf-line-strong);
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.enable-btn.on {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
}
.enable-btn:hover {
  transform: scale(1.15);
}

.track-label {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}
.label-zh {
  font-size: 12px;
  font-weight: 500;
  color: var(--pf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.label-en {
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  color: var(--pf-ink-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.track-mode {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  background: var(--pf-surface);
  color: var(--pf-ink-muted);
}
.mode-keyframe {
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
}
.mode-expression {
  background: rgba(74, 158, 255, 0.15);
  color: #4a9eff;
}
.mode-physics {
  background: rgba(180, 100, 200, 0.15);
  color: #b464c8;
}

.track-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--pf-accent);
  text-align: right;
  min-width: 48px;
  flex-shrink: 0;
}

/* —— 右侧关键帧条 —— */
.track-strip {
  position: relative;
  height: 36px;
  background: var(--pf-surface);
  border-radius: var(--pf-r-sm);
  border: 1px solid var(--pf-line);
  overflow: hidden;
  cursor: crosshair;
}
.track-strip.expr-mode {
  cursor: text;
}
.strip-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(90deg, rgba(30, 25, 20, 0.04) 1px, transparent 1px);
  background-size: 10% 100%;
  pointer-events: none;
}
.strip-curve {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.4;
}
.strip-curve path {
  fill: none;
  stroke: var(--pf-accent);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.expr-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink-muted);
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  color: var(--pf-ink-faint);
  pointer-events: none;
  letter-spacing: 0.02em;
}

[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%) scale(0.95);
  padding: 5px 10px;
  background: var(--pf-ink);
  color: var(--pf-paper);
  font-size: 11px;
  border-radius: 7px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after {
  opacity: 1;
  transform: translateX(-50%) scale(1);
}
</style>
