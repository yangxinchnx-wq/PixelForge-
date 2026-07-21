<script setup lang="ts">
/**
 * ProTimelineAddClipDialog(Step 31.2)— 添加 Clip 弹层。
 *
 * 表单字段:
 * - 轨道选择(下拉:列出当前 Sequence 中可添加 Clip 的轨道)
 * - 片段类型(video/audio/image/text/effect)
 * - 起始时间(秒,默认 = 当前播放头)
 * - 时长(秒,默认 = 5s)
 * - 显示名(可选)
 * - 资产 ID(可选,默认生成临时 ID)
 *
 * 提交时调用 createClip + store.addClip,并入 history。
 */
import { computed, ref, watch } from 'vue'

import type { Track } from '@/editor/timeline/core/track'
import { TrackType } from '@/editor/timeline/core/track'
import type { Time } from '@/editor/timeline/core/time'
import { seconds, toSeconds, formatTimecode } from '@/editor/timeline/core/time'
import type { ClipKind } from '@/editor/timeline/core/clip'

interface Props {
  visible: boolean
  tracks: Track[]
  defaultTrackId: string | null
  currentTime: Time
  fps: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [v: boolean]
  submit: [payload: {
    trackId: string
    kind: ClipKind
    timelineStart: Time
    durationSec: number
    label: string
    assetId: string
  }]
  cancel: []
}>()

const KIND_OPTIONS: { value: ClipKind; label: string }[] = [
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'image', label: '图片' },
  { value: 'text', label: '文字' },
  { value: 'effect', label: '特效' },
]

const form = ref({
  trackId: '',
  kind: 'video' as ClipKind,
  startSec: 0,
  durationSec: 5,
  label: '',
  assetId: '',
})

watch(
  () => props.visible,
  (v) => {
    if (v) {
      // 重置表单
      form.value = {
        trackId: props.defaultTrackId ?? props.tracks[0]?.id ?? '',
        kind: 'video',
        startSec: toSeconds(props.currentTime),
        durationSec: 5,
        label: '',
        assetId: `asset_${Date.now().toString(36)}`,
      }
    }
  },
  { immediate: true },
)

const availableTracks = computed(() =>
  props.tracks.filter((t) => t.type !== TrackType.EFFECT),
)

const startTimecode = computed(() => formatTimecode(seconds(form.value.startSec), props.fps))

const canSubmit = computed(() => {
  return (
    form.value.trackId &&
    form.value.startSec >= 0 &&
    form.value.durationSec > 0
  )
})

function onSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    trackId: form.value.trackId,
    kind: form.value.kind,
    timelineStart: seconds(form.value.startSec),
    durationSec: form.value.durationSec,
    label: form.value.label.trim(),
    assetId: form.value.assetId || `asset_${Date.now().toString(36)}`,
  })
  emit('update:visible', false)
}

function onCancel() {
  emit('cancel')
  emit('update:visible', false)
}

function onOverlayClick() {
  onCancel()
}
</script>

<template>
  <div
    v-if="visible"
    class="pro-dialog-overlay"
    @mousedown.self="onOverlayClick"
  >
    <div class="pro-dialog" role="dialog" aria-modal="true">
      <header class="dialog-header">
        <span class="dialog-title">添加片段</span>
        <button class="close-btn" data-tip="关闭" @click="onCancel">×</button>
      </header>

      <div class="dialog-body">
        <label class="form-row">
          <span class="form-label">轨道</span>
          <select v-model="form.trackId" class="form-select">
            <option v-for="t in availableTracks" :key="t.id" :value="t.id">
              {{ t.name }}({{ t.type === 'video' ? '视频' : t.type === 'audio' ? '音频' : t.type === 'text' ? '字幕' : '特效' }})
            </option>
          </select>
        </label>

        <label class="form-row">
          <span class="form-label">类型</span>
          <select v-model="form.kind" class="form-select">
            <option v-for="opt in KIND_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>

        <label class="form-row">
          <span class="form-label">起始时间</span>
          <input
            v-model.number="form.startSec"
            type="number"
            min="0"
            step="0.1"
            class="form-input"
          />
          <span class="form-tc">{{ startTimecode }}</span>
        </label>

        <label class="form-row">
          <span class="form-label">时长(秒)</span>
          <input
            v-model.number="form.durationSec"
            type="number"
            min="0.1"
            step="0.5"
            class="form-input"
          />
        </label>

        <label class="form-row">
          <span class="form-label">显示名(可选)</span>
          <input
            v-model="form.label"
            type="text"
            class="form-input"
            placeholder="留空使用默认名"
          />
        </label>
      </div>

      <footer class="dialog-footer">
        <button class="footer-btn" @click="onCancel">取消</button>
        <button
          class="footer-btn primary"
          :disabled="!canSubmit"
          @click="onSubmit"
        >添加</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pro-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(30, 25, 20, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  animation: overlay-fade 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes overlay-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.pro-dialog {
  width: 380px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-md);
  box-shadow: 0 12px 32px rgba(30, 25, 20, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dialog-pop 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes dialog-pop {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.dialog-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
}
.close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--pf-ink-muted);
  font-size: 18px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.close-btn:hover {
  background: var(--pf-surface-soft);
  color: var(--pf-ink);
}

.dialog-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.form-label {
  width: 90px;
  flex-shrink: 0;
  color: var(--pf-ink-soft);
  font-weight: 500;
}
.form-select,
.form-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  border-radius: var(--pf-r-sm);
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
  outline: none;
}
.form-select {
  cursor: pointer;
}
.form-input {
  cursor: text;
}
.form-select:hover,
.form-input:hover {
  border-color: var(--pf-line-strong);
}
.form-select:focus,
.form-input:focus {
  border-color: var(--pf-accent);
}
.form-tc {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  color: var(--pf-ink-faint);
  min-width: 80px;
  text-align: right;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--pf-line);
}
.footer-btn {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--pf-r-sm);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.footer-btn:hover {
  background: var(--pf-surface-sunk);
  border-color: var(--pf-line-strong);
}
.footer-btn.primary {
  background: var(--pf-accent);
  border-color: var(--pf-accent);
  color: #fff;
  font-weight: 600;
}
.footer-btn.primary:hover {
  filter: brightness(1.08);
}
.footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
