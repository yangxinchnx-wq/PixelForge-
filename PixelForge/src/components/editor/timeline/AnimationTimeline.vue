<script setup lang="ts">
/**
 * AnimationTimeline — 时间轴主容器(Step 29 UI 入口)。
 *
 * 结构:
 *   ┌──────────────────────────────────────┐
 *   │ 工具栏:播放/暂停/停止/循环/速度 + 状态  │
 *   ├──────────────────────────────────────┤
 *   │ 标尺(秒)+ 播放头                      │
 *   ├──────────────────────────────────────┤
 *   │ 轨道列表(关键帧条对齐到标尺)            │
 *   └──────────────────────────────────────┘
 *
 * 设计:
 * - 直接读写 useAnimationStore(不持有本地状态)
 * - 播放控制(play/pause/stop/loop/speed)直接调用 store
 * - 标尺与轨道条共享同一条时间轴(duration 一致,百分比定位)
 * - 播放头覆盖在标尺 + 轨道区域之上
 *
 * 与 frame-based Timeline.vue 区别:
 * - 基于 time(秒),不是 frame(整数)
 * - 绑定 useAnimationStore,不是 useTimelineStore
 * - 支持 EXPRESSION 模式轨道
 * - 用户偏好:直接文字标签,不用纯图标
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useAnimationStore } from '@/animation/timeline'
import { startFrameLoop } from '@/animation/scheduler'
import type { FrameLoopControl } from '@/animation/scheduler'

import AnimationRuler from './AnimationRuler.vue'
import AnimationPlayhead from './AnimationPlayhead.vue'
import AnimationTrack from './AnimationTrack.vue'

const store = useAnimationStore()

// —— 帧循环(由本组件驱动 store.advanceTime)——
let frameLoop: FrameLoopControl | null = null

onMounted(() => {
  frameLoop = startFrameLoop((dt) => {
    if (store.isPlaying) {
      store.advanceTime(dt)
    }
  })
})

onBeforeUnmount(() => {
  frameLoop?.stop()
  frameLoop = null
})

// —— 播放控制 ——
function onPlayClick() {
  store.togglePlay()
}
function onStopClick() {
  store.stop()
}
function onJumpStart() {
  store.jumpToStart()
}
function onJumpEnd() {
  store.jumpToEnd()
}
function onStepBack() {
  store.stepBackward()
}
function onStepForward() {
  store.stepForward()
}
function onToggleLoop() {
  store.setLoop(!store.loop)
}

// —— 速度选择 ——
const speedOptions = [0.25, 0.5, 1, 1.5, 2, 4]
function onSpeedChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const v = parseFloat(target.value)
  if (Number.isFinite(v)) store.setSpeed(v)
}

// —— 时长编辑 ——
const durationInput = ref<string>(store.duration.toString())
function commitDuration() {
  const v = parseFloat(durationInput.value)
  if (Number.isFinite(v) && v > 0) {
    store.setDuration(v)
  } else {
    durationInput.value = store.duration.toString()
  }
}

// —— FPS 选择 ——
const fpsOptions = [24, 30, 60, 120]
function onFpsChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const v = parseInt(target.value, 10)
  if (Number.isFinite(v) && v > 0) store.setFps(v)
}

// —— 添加轨道(快速创建示例轨道)——
function onAddTrack() {
  // 默认创建一个 graph 类型的 density 轨道
  const id = store.addTrack('graph', 'noise01', 'density', '噪声密度')
  store.addKeyframe(id, 0, 0.2)
  store.addKeyframe(id, store.duration, 1.0)
}

// —— 状态展示 ——
const playheadPercent = computed(() => store.progress * 100)
const statusText = computed(() => {
  if (store.isPlaying) return '播放中'
  if (store.currentTime >= store.duration && store.duration > 0) return '已结束'
  return '已暂停'
})
</script>

<template>
  <section class="anim-timeline">
    <!-- 工具栏 -->
    <header class="tl-toolbar">
      <div class="tl-title">
        <span class="title-zh">动画时间轴</span>
        <sub class="title-sub">{{ store.trackCount }} 条轨道 · {{ store.keyframeCount }} 个关键帧</sub>
      </div>

      <div class="tl-controls">
        <!-- 跳到开头 -->
        <button
          class="tl-btn"
          data-tip="跳到开头"
          @click="onJumpStart"
        >|◀</button>

        <!-- 上一帧 -->
        <button
          class="tl-btn"
          data-tip="上一帧"
          @click="onStepBack"
        >◀</button>

        <!-- 播放 / 暂停(主按钮) -->
        <button
          class="tl-btn primary"
          :data-tip="store.isPlaying ? '暂停(空格)' : '播放(空格)'"
          @click="onPlayClick"
        >
          <span v-if="store.isPlaying">暂停</span>
          <span v-else>播放</span>
        </button>

        <!-- 下一帧 -->
        <button
          class="tl-btn"
          data-tip="下一帧"
          @click="onStepForward"
        >▶</button>

        <!-- 跳到末尾 -->
        <button
          class="tl-btn"
          data-tip="跳到末尾"
          @click="onJumpEnd"
        >▶|</button>

        <!-- 停止 -->
        <button
          class="tl-btn"
          data-tip="停止(回到开头)"
          @click="onStopClick"
        >■</button>

        <span class="divider"></span>

        <!-- 循环 -->
        <button
          class="tl-btn toggle"
          :class="{ on: store.loop }"
          :data-tip="store.loop ? '循环:开(点击关闭)' : '循环:关(点击开启)'"
          @click="onToggleLoop"
        >循环</button>

        <!-- 速度 -->
        <label class="field-label">
          速度
          <select
            class="field-select"
            :value="store.speed"
            @change="onSpeedChange"
          >
            <option v-for="s in speedOptions" :key="s" :value="s">{{ s }}x</option>
          </select>
        </label>

        <!-- FPS -->
        <label class="field-label">
          FPS
          <select
            class="field-select"
            :value="store.fps"
            @change="onFpsChange"
          >
            <option v-for="f in fpsOptions" :key="f" :value="f">{{ f }}</option>
          </select>
        </label>

        <!-- 时长 -->
        <label class="field-label">
          时长
          <input
            v-model="durationInput"
            class="field-input"
            type="number"
            min="0.1"
            step="0.5"
            @change="commitDuration"
          />
          <span class="field-unit">s</span>
        </label>
      </div>

      <div class="tl-status">
        <span class="status-time">
          <strong>{{ store.currentTime.toFixed(2) }}</strong>
          <span class="time-sep">/</span>
          <span class="time-total">{{ store.duration.toFixed(1) }}s</span>
        </span>
        <span class="status-pill" :class="{ playing: store.isPlaying }">{{ statusText }}</span>
      </div>
    </header>

    <!-- 标尺 + 播放头(共享同一时间轴) -->
    <div class="tl-ruler-wrap">
      <!-- 左侧占位(对齐轨道头) -->
      <div class="ruler-gutter"></div>
      <!-- 标尺 + 播放头 -->
      <div class="ruler-stage">
        <AnimationRuler />
        <AnimationPlayhead />
      </div>
    </div>

    <!-- 轨道列表 -->
    <div class="tl-tracks">
      <div v-if="store.tracks.length === 0" class="empty-state">
        <p class="empty-title">尚未创建动画轨道</p>
        <p class="empty-hint">在节点参数面板点击 "Animate" 按钮,或</p>
        <button class="add-track-btn" @click="onAddTrack">添加示例轨道</button>
      </div>

      <AnimationTrack
        v-for="track in store.tracks"
        :key="track.id"
        :track="track"
      />
    </div>

    <!-- 底部状态栏 -->
    <footer class="tl-footer">
      <span class="hint">提示:双击关键帧条空白处添加关键帧 · 拖动关键帧调整时间 · 右键删除</span>
      <span class="progress-text">进度 {{ playheadPercent.toFixed(1) }}%</span>
    </footer>
  </section>
</template>

<style scoped>
.anim-timeline {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xl);
  padding: 12px 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

/* —— 工具栏 —— */
.tl-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.tl-title {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.title-zh {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
}
.title-sub {
  font-size: 10.5px;
  color: var(--pf-ink-muted);
  font-weight: 400;
}

.tl-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tl-btn {
  height: 28px;
  min-width: 36px;
  padding: 0 10px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-size: 11.5px;
  font-weight: 500;
  border-radius: var(--pf-r-sm);
  cursor: pointer;
  transition: all 160ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tl-btn:hover {
  background: var(--pf-surface-sunk);
  border-color: var(--pf-line-strong);
}
.tl-btn:active {
  transform: scale(0.97);
}
.tl-btn.primary {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
  min-width: 56px;
  font-weight: 600;
}
.tl-btn.primary:hover {
  filter: brightness(1.08);
}
.tl-btn.toggle.on {
  background: var(--pf-accent-soft);
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.divider {
  width: 1px;
  height: 18px;
  background: var(--pf-line);
  margin: 0 4px;
}

.field-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--pf-ink-muted);
  user-select: none;
}
.field-select,
.field-input {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  border-radius: var(--pf-r-sm);
  cursor: pointer;
  transition: border-color 160ms ease;
  outline: none;
}
.field-select:hover,
.field-input:hover {
  border-color: var(--pf-line-strong);
}
.field-select:focus,
.field-input:focus {
  border-color: var(--pf-accent);
}
.field-input {
  width: 56px;
  cursor: text;
}
.field-unit {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--pf-ink-faint);
}

.tl-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  font-size: 11.5px;
  color: var(--pf-ink-muted);
}
.status-time {
  font-family: 'JetBrains Mono', monospace;
}
.status-time strong {
  color: var(--pf-ink);
  font-weight: 600;
}
.time-sep {
  margin: 0 2px;
  color: var(--pf-ink-faint);
}
.time-total {
  color: var(--pf-ink-muted);
}
.status-pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 500;
  background: var(--pf-surface-soft);
  color: var(--pf-ink-soft);
}
.status-pill.playing {
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
}

/* —— 标尺区 —— */
.tl-ruler-wrap {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
  flex-shrink: 0;
}
.ruler-gutter {
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-sm);
  border: 1px solid var(--pf-line);
  height: 36px;
}
.ruler-stage {
  position: relative;
  min-width: 0;
}
/* Playhead 是 .ruler-stage 的子元素,它会基于 stage 的 rect 计算位置 */
/* 注意:Playhead 的拖动用 parentElement.parentElement 找到 stage */

/* —— 轨道列表 —— */
.tl-tracks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
  padding-right: 4px;
}
.tl-tracks::-webkit-scrollbar {
  width: 6px;
}
.tl-tracks::-webkit-scrollbar-track {
  background: transparent;
}
.tl-tracks::-webkit-scrollbar-thumb {
  background: var(--pf-line-strong);
  border-radius: 999px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 16px;
  background: var(--pf-surface-soft);
  border-radius: var(--pf-r-sm);
  border: 1px dashed var(--pf-line-strong);
}
.empty-title {
  font-size: 12.5px;
  color: var(--pf-ink-muted);
  font-weight: 500;
}
.empty-hint {
  font-size: 10.5px;
  color: var(--pf-ink-faint);
}
.add-track-btn {
  margin-top: 4px;
  padding: 6px 14px;
  border: 1px solid var(--pf-accent);
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  font-size: 11.5px;
  font-weight: 500;
  border-radius: var(--pf-r-sm);
  cursor: pointer;
  transition: all 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
.add-track-btn:hover {
  background: var(--pf-accent);
  color: #fff;
}

/* —— 底部状态栏 —— */
.tl-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 6px;
  border-top: 1px solid var(--pf-line);
  font-size: 10.5px;
  color: var(--pf-ink-faint);
  flex-shrink: 0;
}
.progress-text {
  font-family: 'JetBrains Mono', monospace;
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
