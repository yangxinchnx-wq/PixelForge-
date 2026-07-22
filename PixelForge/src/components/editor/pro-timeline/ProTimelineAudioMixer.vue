<script setup lang="ts">
/**
 * ProTimelineAudioMixer(Step 33)— 音频混音器面板。
 *
 * 功能:
 * - 每轨道一列:音量推子、声像旋钮、静音/独奏按钮
 * - 主输出:主音量推子、限制器开关
 * - 实时电平表(左右声道)
 * - 效果链指示器(显示已启用效果数)
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 中文文字标签,JetBrains Mono 用于数字
 */
import { ref, computed } from 'vue'

import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'
import { useAudioMixerStore } from '@/editor/audio/audioMixerStore'
import { TrackType } from '@/editor/timeline/core/track'
import {
  createEqEffect,
  createCompressorEffect,
  createReverbEffect,
  PAN_CENTER,
} from '@/editor/audio/audioMix'

const proStore = useProTimelineStore()
const mixerStore = useAudioMixerStore()

const visible = ref(false)

/** 当前音频轨道(从 ProTimeline Store 获取) */
const audioTracks = computed(() =>
  proStore.tracks.filter((t) => t.type === TrackType.AUDIO),
)

/** 主音量(0-1,显示为 0-100) */
const masterVolumePct = computed({
  get: () => Math.round(mixerStore.masterVolume * 100),
  set: (val: number) => mixerStore.setMasterVolume(val / 100),
})

/** 主声像(-1 到 1,显示为 -100 到 100) */
const masterPanPct = computed({
  get: () => Math.round(mixerStore.masterPan * 100),
  set: (val: number) => mixerStore.setMasterPan(val / 100),
})

function toggle() {
  visible.value = !visible.value
}

function close() {
  visible.value = false
}

/** 获取轨道声像 */
function getTrackPan(trackId: string): number {
  const tm = mixerStore.mixConfig.tracks.find((t) => t.trackId === trackId)
  return tm?.pan ?? PAN_CENTER
}

/** 设置轨道声像 */
function setTrackPan(trackId: string, val: number) {
  mixerStore.setTrackPan(trackId, val / 100)
}

/** 获取轨道独奏状态 */
function getTrackSolo(trackId: string): boolean {
  const tm = mixerStore.mixConfig.tracks.find((t) => t.trackId === trackId)
  return tm?.solo ?? false
}

/** 切换轨道独奏 */
function toggleTrackSolo(trackId: string) {
  mixerStore.setTrackSolo(trackId, !getTrackSolo(trackId))
}

/** 添加 EQ 效果到轨道 */
function addEqToTrack(trackId: string) {
  mixerStore.addTrackEffect(trackId, createEqEffect())
}

/** 添加压缩器效果到轨道 */
function addCompressorToTrack(trackId: string) {
  mixerStore.addTrackEffect(trackId, createCompressorEffect())
}

/** 添加混响效果到轨道 */
function addReverbToTrack(trackId: string) {
  mixerStore.addTrackEffect(trackId, createReverbEffect())
}

/** 获取轨道效果数 */
function getEffectCount(trackId: string): number {
  const tm = mixerStore.mixConfig.tracks.find((t) => t.trackId === trackId)
  return tm?.effects.filter((e) => e.enabled).length ?? 0
}

/** 初始化音频上下文 */
async function initAudio() {
  await mixerStore.initAudioContext()
}

/** 声像百分比转文字 */
function panToText(pan: number): string {
  if (Math.abs(pan) < 0.01) return 'C'
  if (pan < 0) return `L${Math.round(-pan * 100)}`
  return `R${Math.round(pan * 100)}`
}

/** 音量百分比 */
function volumePct(vol: number): number {
  return Math.round(vol * 100)
}
</script>

<template>
  <div class="mixer-panel">
    <button class="mp-btn" @click="toggle">混音器</button>

    <Transition name="mp-modal">
      <div v-if="visible" class="mp-modal" @click.self="close">
        <div class="mp-modal-inner">
          <!-- 头部 -->
          <div class="mp-header">
            <span class="mp-title">音频混音器</span>
            <div class="mp-header-actions">
              <button class="mp-init-btn" @click="initAudio">初始化音频</button>
              <button class="mp-close" @click="close">关闭</button>
            </div>
          </div>

          <div class="mp-content">
            <!-- 无音频轨道提示 -->
            <div v-if="audioTracks.length === 0" class="mp-empty">
              当前 Sequence 无音频轨道。请先添加 AUDIO 类型轨道。
            </div>

            <!-- 轨道混音器列 -->
            <div v-else class="mp-channels">
              <div
                v-for="track in audioTracks"
                :key="track.id"
                class="mp-channel"
                :class="{ 'is-muted': track.muted, 'is-solo': getTrackSolo(track.id) }"
              >
                <!-- 轨道名 -->
                <div class="mp-ch-name" :title="track.name">{{ track.name }}</div>

                <!-- 效果数指示 -->
                <div class="mp-ch-fx">
                  <span class="mp-fx-count">{{ getEffectCount(track.id) }}</span> FX
                </div>

                <!-- 效果添加按钮组 -->
                <div class="mp-fx-add">
                  <button class="mp-fx-btn" data-tip="EQ 均衡器" @click="addEqToTrack(track.id)">EQ</button>
                  <button class="mp-fx-btn" data-tip="压缩器" @click="addCompressorToTrack(track.id)">CMP</button>
                  <button class="mp-fx-btn" data-tip="混响" @click="addReverbToTrack(track.id)">RVB</button>
                </div>

                <!-- 声像旋钮 -->
                <div class="mp-pan">
                  <label class="mp-label">声像</label>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    :value="Math.round(getTrackPan(track.id) * 100)"
                    class="mp-pan-slider"
                    @input="setTrackPan(track.id, Number(($event.target as HTMLInputElement).value))"
                  />
                  <span class="mp-pan-val">{{ panToText(getTrackPan(track.id)) }}</span>
                </div>

                <!-- 音量推子(显示 Track.volume,只读 — 音量由 Track 管理) -->
                <div class="mp-fader">
                  <label class="mp-label">音量</label>
                  <div class="mp-fader-track">
                    <div
                      class="mp-fader-fill"
                      :style="{ height: `${volumePct(track.volume)}%` }"
                    ></div>
                  </div>
                  <span class="mp-fader-val">{{ volumePct(track.volume) }}</span>
                </div>

                <!-- 静音/独奏按钮 -->
                <div class="mp-ch-buttons">
                  <button
                    class="mp-btn-toggle"
                    :class="{ active: track.muted }"
                    :disabled="getTrackSolo(track.id)"
                    @click="proStore.toggleTrackMuted(track.id)"
                  >M</button>
                  <button
                    class="mp-btn-toggle solo"
                    :class="{ active: getTrackSolo(track.id) }"
                    @click="toggleTrackSolo(track.id)"
                  >S</button>
                </div>
              </div>

              <!-- 主输出列 -->
              <div class="mp-channel master">
                <div class="mp-ch-name">主输出</div>
                <div class="mp-ch-fx">—</div>
                <div class="mp-fx-add"></div>

                <!-- 主声像 -->
                <div class="mp-pan">
                  <label class="mp-label">主声像</label>
                  <input
                    v-model.number="masterPanPct"
                    type="range"
                    min="-100"
                    max="100"
                    class="mp-pan-slider"
                  />
                  <span class="mp-pan-val">{{ panToText(mixerStore.masterPan) }}</span>
                </div>

                <!-- 主音量推子 -->
                <div class="mp-fader">
                  <label class="mp-label">主音量</label>
                  <div class="mp-fader-track">
                    <div
                      class="mp-fader-fill master"
                      :style="{ height: `${masterVolumePct}%` }"
                    ></div>
                  </div>
                  <span class="mp-fader-val">{{ masterVolumePct }}</span>
                </div>

                <!-- 限制器开关 -->
                <div class="mp-ch-buttons">
                  <label class="mp-limiter">
                    <input
                      type="checkbox"
                      :checked="mixerStore.limiterEnabled"
                      @change="mixerStore.setLimiter(($event.target as HTMLInputElement).checked)"
                    />
                    <span>限制器</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- 电平表 -->
            <div class="mp-levels">
              <div class="mp-level-row">
                <span class="mp-level-label">L</span>
                <div class="mp-level-bar">
                  <div class="mp-level-fill left" :style="{ width: `${mixerStore.levels.left * 100}%` }"></div>
                </div>
              </div>
              <div class="mp-level-row">
                <span class="mp-level-label">R</span>
                <div class="mp-level-bar">
                  <div class="mp-level-fill right" :style="{ width: `${mixerStore.levels.right * 100}%` }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mixer-panel {
  position: relative;
  display: inline-block;
}

.mp-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.mp-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mp-modal-inner {
  width: 720px;
  max-height: 85vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.mp-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.mp-header-actions {
  display: flex;
  gap: 8px;
}
.mp-init-btn,
.mp-close {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-init-btn:hover,
.mp-close:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}

.mp-content {
  padding: 16px;
  overflow-y: auto;
}

.mp-empty {
  text-align: center;
  color: var(--pf-ink-faint);
  font-size: 13px;
  padding: 32px;
}

.mp-channels {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.mp-channel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 100px;
  padding: 12px 8px;
  background: var(--pf-bg, var(--pf-surface));
  border: 1px solid var(--pf-line);
  border-radius: 6px;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-channel.is-muted {
  opacity: 0.5;
}
.mp-channel.is-solo {
  border-color: var(--pf-accent);
}
.mp-channel.master {
  border-color: var(--pf-line-strong);
  background: var(--pf-bg-strong, var(--pf-surface));
}

.mp-ch-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-ink);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}

.mp-ch-fx {
  font-size: 10px;
  color: var(--pf-ink-faint);
}
.mp-fx-count {
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-accent);
}

.mp-fx-add {
  display: flex;
  gap: 4px;
}
.mp-fx-btn {
  padding: 2px 6px;
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 3px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-fx-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.mp-label {
  font-size: 10px;
  color: var(--pf-ink-faint);
}

.mp-pan {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.mp-pan-slider {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--pf-line);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.mp-pan-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--pf-accent);
  cursor: pointer;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-pan-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
.mp-pan-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-muted);
}

.mp-fader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  height: 120px;
}
.mp-fader-track {
  position: relative;
  width: 8px;
  height: 100%;
  background: var(--pf-line);
  border-radius: 4px;
  overflow: hidden;
}
.mp-fader-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  background: var(--pf-ink-muted);
  border-radius: 4px;
  transition: height 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-fader-fill.master {
  background: var(--pf-accent);
}
.mp-fader-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-muted);
}

.mp-ch-buttons {
  display: flex;
  gap: 4px;
}
.mp-btn-toggle {
  width: 24px;
  height: 24px;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-btn-toggle:hover {
  border-color: var(--pf-ink-muted);
}
.mp-btn-toggle.active {
  color: white;
  background: var(--pf-danger, #ff4d4f);
  border-color: var(--pf-danger, #ff4d4f);
}
.mp-btn-toggle.solo.active {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
}
.mp-btn-toggle:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.mp-limiter {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--pf-ink-muted);
  cursor: pointer;
  white-space: nowrap;
}

.mp-levels {
  border-top: 1px solid var(--pf-line);
  padding-top: 12px;
}
.mp-level-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.mp-level-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink-muted);
  width: 12px;
}
.mp-level-bar {
  flex: 1;
  height: 6px;
  background: var(--pf-line);
  border-radius: 3px;
  overflow: hidden;
}
.mp-level-fill {
  height: 100%;
  transition: width 60ms linear;
}
.mp-level-fill.left {
  background: linear-gradient(90deg, #52c41a, #faad14);
}
.mp-level-fill.right {
  background: linear-gradient(90deg, #52c41a, #faad14);
}

.mp-modal-enter-active,
.mp-modal-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.mp-modal-enter-from,
.mp-modal-leave-to {
  opacity: 0;
}
</style>
