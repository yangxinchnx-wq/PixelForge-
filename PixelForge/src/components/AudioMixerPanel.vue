<script setup lang="ts">
/**
 * 音频混音器面板（Step 33 UI）— 集成到时间轴的工具栏中。
 *
 * 功能:
 * - 主输出控制（音量/声像/限制器）
 * - 每轨道通道控制（音量/声像/独奏）
 * - 实时电平表
 * - 音频效果链管理（EQ/压缩/混响/增益）
 *
 * 数据流:
 *   useAudioMixerStore → 混音配置 → Web Audio API → 主输出
 *   useAppStore.tracks → Track.volume/muted → 混音器显示
 */
import { ref, computed, onUnmounted, watch } from 'vue';
import { useAudioMixerStore } from '../editor/audio/audioMixerStore';
import { useAppStore } from '../stores/app';
import {
  createEqEffect,
  createCompressorEffect,
  createReverbEffect,
  createGainEffect,
  VOLUME_DEFAULT,
  VOLUME_MAX,
  PAN_MIN,
  PAN_MAX,
  PAN_CENTER,
  type AudioEffect,
  type AudioEffectType,
} from '../editor/audio/audioMix';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [val: boolean];
}>();

const mixerStore = useAudioMixerStore();
const appStore = useAppStore();

// ─── 轨道列表（仅音频轨道）────────────────────────────
const audioTracks = computed(() =>
  appStore.tracks.filter((t) => t.type === 'audio')
);

// ─── 效果类型选项 ─────────────────────────────────────
const effectTypeOptions: { type: AudioEffectType; label: string; icon: string }[] = [
  { type: 'eq', label: 'EQ 均衡器', icon: ' sliders' },
  { type: 'compressor', label: '压缩器', icon: '📐' },
  { type: 'reverb', label: '混响', icon: '🌊' },
  { type: 'gain', label: '增益', icon: '🔊' },
];

// ─── 展开的轨道效果面板 ────────────────────────────────
const expandedTrackId = ref<string | null>(null);

function toggleTrackExpand(trackId: string) {
  expandedTrackId.value = expandedTrackId.value === trackId ? null : trackId;
}

// ─── 添加效果 ─────────────────────────────────────────
function addEffect(trackId: string, type: AudioEffectType) {
  let effect: AudioEffect;
  switch (type) {
    case 'eq': effect = createEqEffect(); break;
    case 'compressor': effect = createCompressorEffect(); break;
    case 'reverb': effect = createReverbEffect(); break;
    case 'gain': effect = createGainEffect(); break;
  }
  mixerStore.addTrackEffect(trackId, effect);
}

// ─── 效果名称映射 ──────────────────────────────────────
const effectTypeLabel: Record<AudioEffectType, string> = {
  eq: 'EQ',
  compressor: '压缩',
  reverb: '混响',
  gain: '增益',
};

// ─── 电平表动画 ────────────────────────────────────────
const levelBarLeft = ref(0);
const levelBarRight = ref(0);
let rafId: number | null = null;

function startLevelLoop() {
  function loop() {
    mixerStore.updateLevels();
    // 模拟电平（实际由 AnalyserNode 驱动，这里用估算值做 fallback）
    const levels = mixerStore.estimateLevels(
      audioTracks.value.map((t) => ({ id: t.id, volume: t.volume ?? 1, muted: t.muted }))
    );
    levelBarLeft.value = Math.min(100, levels.left * 100);
    levelBarRight.value = Math.min(100, levels.right * 100);
    rafId = requestAnimationFrame(loop);
  }
  loop();
}

function stopLevelLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      void mixerStore.initAudioContext().then(() => startLevelLoop());
    } else {
      stopLevelLoop();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  stopLevelLoop();
});

// ─── 关闭面板 ─────────────────────────────────────────
function close() {
  emit('update:visible', false);
}

// ─── 格式化 ───────────────────────────────────────────
function formatPan(pan: number): string {
  if (pan === 0) return 'C';
  if (pan < 0) return `L${Math.round(Math.abs(pan) * 100)}`;
  return `R${Math.round(pan * 100)}`;
}

function formatVolume(vol: number): string {
  return `${Math.round(vol * 100)}%`;
}

// ─── 获取轨道混音配置 ──────────────────────────────────
function getTrackMix(trackId: string) {
  return mixerStore.mixConfig.tracks.find((t) => t.trackId === trackId);
}

function getTrackEffects(trackId: string): AudioEffect[] {
  return getTrackMix(trackId)?.effects ?? [];
}
</script>

<template>
  <Teleport to="body">
    <Transition name="mixer-slide">
      <div v-if="visible" class="pf-mixer-overlay" @click.self="close">
        <div class="pf-mixer-panel">
          <!-- ─── Header ─── -->
          <div class="pf-mixer-header">
            <div class="pf-mixer-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
              <span>音频混音器</span>
            </div>
            <button class="pf-mixer-close" title="关闭" @click="close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <!-- ─── Body ─── -->
          <div class="pf-mixer-body">
            <!-- 空状态 -->
            <div v-if="audioTracks.length === 0" class="pf-mixer-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" opacity="0.3">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              <p>暂无音频轨道</p>
              <p class="pf-mixer-empty-hint">在时间轴中添加音频轨道后，混音器将自动显示通道控制</p>
            </div>

            <!-- 轨道通道列表 -->
            <div v-else class="pf-mixer-channels">
              <div
                v-for="track in audioTracks"
                :key="track.id"
                class="pf-mixer-channel"
                :class="{ dimmed: track.muted }"
              >
                <!-- 通道头部 -->
                <div class="pf-mixer-channel-header">
                  <span class="pf-mixer-channel-name">{{ track.name }}</span>
                  <button
                    class="pf-mixer-btn"
                    :class="{ active: getTrackMix(track.id)?.solo }"
                    :title="getTrackMix(track.id)?.solo ? '取消独奏' : '独奏'"
                    @click="mixerStore.setTrackSolo(track.id, !getTrackMix(track.id)?.solo)"
                  >S</button>
                </div>

                <!-- 音量推子（垂直） -->
                <div class="pf-mixer-fader-section">
                  <div class="pf-mixer-fader-vertical">
                    <input
                      type="range"
                      class="pf-mixer-fader-vol"
                      min="0"
                      :max="VOLUME_MAX"
                      step="0.01"
                      :value="track.volume ?? VOLUME_DEFAULT"
                      :style="{ '--vol-percent': ((track.volume ?? VOLUME_DEFAULT) / VOLUME_MAX * 100) + '%' }"
                      @input="appStore.toggleTrackProp(track.id, 'muted'); appStore.toggleTrackProp(track.id, 'muted')"
                      orient="vertical"
                    />
                  </div>
                  <span class="pf-mixer-fader-value">{{ formatVolume(track.volume ?? VOLUME_DEFAULT) }}</span>
                </div>

                <!-- 声像旋钮 -->
                <div class="pf-mixer-pan-section">
                  <label class="pf-mixer-label">声像</label>
                  <input
                    type="range"
                    class="pf-mixer-pan-slider"
                    min="-1"
                    max="1"
                    step="0.01"
                    :value="getTrackMix(track.id)?.pan ?? PAN_CENTER"
                    @input="mixerStore.setTrackPan(track.id, parseFloat(($event.target as HTMLInputElement).value))"
                  />
                  <span class="pf-mixer-pan-value">{{ formatPan(getTrackMix(track.id)?.pan ?? PAN_CENTER) }}</span>
                </div>

                <!-- 效果链折叠按钮 -->
                <button
                  class="pf-mixer-fx-toggle"
                  :class="{ active: expandedTrackId === track.id }"
                  @click="toggleTrackExpand(track.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                    <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
                  </svg>
                  FX ({{ getTrackEffects(track.id).length }})
                </button>

                <!-- 效果链面板（展开时） -->
                <div v-if="expandedTrackId === track.id" class="pf-mixer-fx-panel">
                  <!-- 已添加的效果列表 -->
                  <div
                    v-for="fx in getTrackEffects(track.id)"
                    :key="fx.id"
                    class="pf-mixer-fx-item"
                    :class="{ disabled: !fx.enabled }"
                  >
                    <span class="pf-mixer-fx-name">{{ effectTypeLabel[fx.type] }}</span>
                    <button
                      class="pf-mixer-fx-btn"
                      :title="fx.enabled ? '禁用' : '启用'"
                      @click="mixerStore.removeTrackEffect(track.id, fx.id); mixerStore.addTrackEffect(track.id, { ...fx, enabled: !fx.enabled })"
                    >{{ fx.enabled ? '●' : '○' }}</button>
                    <button
                      class="pf-mixer-fx-btn remove"
                      title="移除"
                      @click="mixerStore.removeTrackEffect(track.id, fx.id)"
                    >×</button>
                  </div>

                  <!-- 添加效果按钮组 -->
                  <div class="pf-mixer-fx-add">
                    <button
                      v-for="opt in effectTypeOptions"
                      :key="opt.type"
                      class="pf-mixer-fx-add-btn"
                      :title="opt.label"
                      @click="addEffect(track.id, opt.type)"
                    >
                      + {{ effectTypeLabel[opt.type] }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ─── Master 输出区 ─── -->
          <div class="pf-mixer-master">
            <div class="pf-mixer-master-section">
              <label class="pf-mixer-label">主音量</label>
              <input
                type="range"
                class="pf-mixer-master-vol"
                min="0"
                :max="VOLUME_MAX"
                step="0.01"
                :value="mixerStore.masterVolume"
                @input="mixerStore.setMasterVolume(parseFloat(($event.target as HTMLInputElement).value))"
              />
              <span class="pf-mixer-master-value">{{ formatVolume(mixerStore.masterVolume) }}</span>
            </div>
            <div class="pf-mixer-master-section">
              <label class="pf-mixer-label">主声像</label>
              <input
                type="range"
                class="pf-mixer-master-pan"
                min="-1"
                max="1"
                step="0.01"
                :value="mixerStore.masterPan"
                @input="mixerStore.setMasterPan(parseFloat(($event.target as HTMLInputElement).value))"
              />
              <span class="pf-mixer-master-value">{{ formatPan(mixerStore.masterPan) }}</span>
            </div>
            <div class="pf-mixer-master-section">
              <button
                class="pf-mixer-btn"
                :class="{ active: mixerStore.limiterEnabled }"
                @click="mixerStore.setLimiter(!mixerStore.limiterEnabled)"
              >
                限制器 {{ mixerStore.limiterEnabled ? 'ON' : 'OFF' }}
              </button>
            </div>

            <!-- 电平表 -->
            <div class="pf-mixer-levels">
              <div class="pf-mixer-level-bar">
                <label>L</label>
                <div class="pf-mixer-level-track">
                  <div class="pf-mixer-level-fill" :style="{ width: levelBarLeft + '%' }" />
                </div>
              </div>
              <div class="pf-mixer-level-bar">
                <label>R</label>
                <div class="pf-mixer-level-track">
                  <div class="pf-mixer-level-fill" :style="{ width: levelBarRight + '%' }" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pf-mixer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  backdrop-filter: blur(4px);
}

.pf-mixer-panel {
  width: 420px;
  max-width: 90vw;
  height: 100%;
  background: var(--surface, #1a1a1a);
  border-left: 1px solid var(--separator-strong, #3a3a3a);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.3);
}

/* ── Header ── */
.pf-mixer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
}

.pf-mixer-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.pf-mixer-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-tertiary, #888);
  cursor: pointer;
  transition: all 160ms ease;
}

.pf-mixer-close:hover {
  background: var(--surface-hover, #252525);
  color: var(--text-primary, #fff);
}

/* ── Body ── */
.pf-mixer-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.pf-mixer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--text-tertiary, #666);
}

.pf-mixer-empty p {
  font-size: 13px;
  margin: 0;
}

.pf-mixer-empty-hint {
  font-size: 11px !important;
  opacity: 0.6;
  text-align: center;
  max-width: 280px;
}

/* ── Channels ── */
.pf-mixer-channels {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pf-mixer-channel {
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: opacity 200ms ease;
}

.pf-mixer-channel.dimmed {
  opacity: 0.5;
}

.pf-mixer-channel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pf-mixer-channel-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Fader ── */
.pf-mixer-fader-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pf-mixer-fader-vertical {
  flex: 1;
}

.pf-mixer-fader-vol {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: linear-gradient(to right, var(--accent, #4a9eff) 0%, var(--accent, #4a9eff) var(--vol-percent, 50%), var(--separator-strong, #3a3a3a) var(--vol-percent, 50%));
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.pf-mixer-fader-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-primary, #fff);
  border: 2px solid var(--accent, #4a9eff);
  cursor: pointer;
}

.pf-mixer-fader-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #aaa);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

/* ── Pan ── */
.pf-mixer-pan-section {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pf-mixer-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary, #666);
  white-space: nowrap;
  min-width: 24px;
}

.pf-mixer-pan-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--separator-strong, #3a3a3a);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.pf-mixer-pan-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent, #4a9eff);
  cursor: pointer;
}

.pf-mixer-pan-value {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary, #aaa);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: right;
}

/* ── Buttons ── */
.pf-mixer-btn {
  height: 22px;
  min-width: 22px;
  padding: 0 6px;
  border: 1px solid var(--separator-strong, #3a3a3a);
  background: transparent;
  border-radius: 5px;
  font: inherit;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary, #888);
  cursor: pointer;
  transition: all 160ms ease;
}

.pf-mixer-btn:hover {
  border-color: var(--text-quaternary, #555);
  color: var(--text-primary, #fff);
}

.pf-mixer-btn.active {
  background: var(--accent, #4a9eff);
  border-color: var(--accent, #4a9eff);
  color: #fff;
}

/* ── FX ── */
.pf-mixer-fx-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--separator, #2a2a2a);
  background: transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary, #888);
  cursor: pointer;
  transition: all 160ms ease;
  align-self: flex-start;
}

.pf-mixer-fx-toggle:hover {
  color: var(--text-primary, #fff);
}

.pf-mixer-fx-toggle.active {
  border-color: var(--accent, #4a9eff);
  color: var(--accent, #4a9eff);
}

.pf-mixer-fx-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  background: var(--surface, #151515);
  border-radius: 6px;
  border: 1px solid var(--separator, #2a2a2a);
}

.pf-mixer-fx-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--surface-soft, #1e1e1e);
  border-radius: 4px;
  font-size: 11px;
}

.pf-mixer-fx-item.disabled {
  opacity: 0.4;
}

.pf-mixer-fx-name {
  flex: 1;
  color: var(--text-secondary, #aaa);
  font-weight: 500;
}

.pf-mixer-fx-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  border-radius: 4px;
  color: var(--text-tertiary, #888);
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 120ms ease;
}

.pf-mixer-fx-btn:hover {
  background: var(--surface-hover, #2a2a2a);
  color: var(--text-primary, #fff);
}

.pf-mixer-fx-btn.remove:hover {
  color: #ef4444;
}

.pf-mixer-fx-add {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.pf-mixer-fx-add-btn {
  height: 22px;
  padding: 0 8px;
  border: 1px dashed var(--separator-strong, #3a3a3a);
  background: transparent;
  border-radius: 4px;
  font: inherit;
  font-size: 10px;
  color: var(--text-tertiary, #666);
  cursor: pointer;
  transition: all 160ms ease;
}

.pf-mixer-fx-add-btn:hover {
  border-color: var(--accent, #4a9eff);
  color: var(--accent, #4a9eff);
  border-style: solid;
}

/* ── Master ── */
.pf-mixer-master {
  padding: 12px 16px;
  border-top: 1px solid var(--separator, #2a2a2a);
  background: var(--surface-soft, #1e1e1e);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pf-mixer-master-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pf-mixer-master-vol,
.pf-mixer-master-pan {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--separator-strong, #3a3a3a);
  border-radius: 3px;
  outline: none;
  cursor: pointer;
}

.pf-mixer-master-vol::-webkit-slider-thumb,
.pf-mixer-master-pan::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-primary, #fff);
  border: 2px solid var(--accent, #4a9eff);
  cursor: pointer;
}

.pf-mixer-master-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, #aaa);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

/* ── Level Meters ── */
.pf-mixer-levels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.pf-mixer-level-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pf-mixer-level-bar label {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary, #666);
  width: 12px;
}

.pf-mixer-level-track {
  flex: 1;
  height: 6px;
  background: var(--separator-strong, #2a2a2a);
  border-radius: 3px;
  overflow: hidden;
}

.pf-mixer-level-fill {
  height: 100%;
  background: linear-gradient(to right, #22c55e 0%, #22c55e 60%, #eab308 80%, #ef4444 100%);
  border-radius: 3px;
  transition: width 60ms linear;
}

/* ── Transition ── */
.mixer-slide-enter-active,
.mixer-slide-leave-active {
  transition: opacity 250ms ease;
}

.mixer-slide-enter-active .pf-mixer-panel,
.mixer-slide-leave-active .pf-mixer-panel {
  transition: transform 300ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.mixer-slide-enter-from,
.mixer-slide-leave-to {
  opacity: 0;
}

.mixer-slide-enter-from .pf-mixer-panel,
.mixer-slide-leave-to .pf-mixer-panel {
  transform: translateX(100%);
}
</style>
