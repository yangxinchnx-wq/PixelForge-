<script setup lang="ts">
/**
 * ProTimelineInspector(Step 31.4)— 片段属性面板。
 *
 * 显示当前主选中 clip 的属性,支持实时编辑(通过 store.updateClipProperty)。
 *
 * 字段:
 * - 标签(label):文本输入
 * - 类型(kind):只读
 * - 位置(timelineStart):时间码显示 + 数字输入(秒)
 * - 时长(duration):时间码显示 + 数字输入(秒)
 * - 源区间(sourceStart → sourceEnd):只读
 * - 速度(speed):0.1-10 滑块
 * - 音量(volume):0-1 滑块
 * - 启用(enabled):开关
 * - 锁定(locked):开关
 * - 群组(groupId):显示 + 解组按钮
 * - 变换(transform):x/y/scale/rotation/opacity 数字输入
 *
 * 多选时:
 * - 若多选且主选中 clip 存在,只显示主选中 clip 属性
 * - 顶部显示"已选中 N 个片段"提示
 */
import { computed, watch, ref } from 'vue'

import type { Clip, ClipTransform } from '@/editor/timeline/core/clip'
import { getClipEnd } from '@/editor/timeline/core/clip'
import { toSeconds, formatTimecode } from '@/editor/timeline/core/time'
import { useProTimelineStore } from '@/editor/timeline/store/timelineStore'
import { useClipSelectionStore } from '@/editor/timeline/store/selectionStore'

const props = defineProps<{
  fps: number
}>()

const store = useProTimelineStore()
const selectionStore = useClipSelectionStore()

// ============================================================================
// 1. 当前选中 clip(主选中)
// ============================================================================

const primaryClip = computed<Clip | null>(() => {
  const pid = selectionStore.primaryId
  if (!pid) return null
  for (const track of store.tracks) {
    const found = track.clips.find((c) => c.id === pid)
    if (found) return found
  }
  return null
})

const hasSelection = computed(() => selectionStore.hasSelection)
const selectionCount = computed(() => selectionStore.count)
const isMulti = computed(() => selectionStore.isMulti)

// ============================================================================
// 2. 编辑字段(本地 v-model + commit on blur/enter)
// ============================================================================

const labelInput = ref('')
const speedInput = ref(1)
const volumeInput = ref(1)
const transformX = ref(0)
const transformY = ref(0)
const transformScale = ref(1)
const transformRotation = ref(0)
const transformOpacity = ref(1)

// 监听 primaryClip 变化,同步编辑字段
watch(
  primaryClip,
  (clip) => {
    if (!clip) return
    labelInput.value = clip.label ?? ''
    speedInput.value = clip.speed
    volumeInput.value = clip.volume
    transformX.value = clip.transform.x
    transformY.value = clip.transform.y
    transformScale.value = clip.transform.scale
    transformRotation.value = clip.transform.rotation
    transformOpacity.value = clip.transform.opacity
  },
  { immediate: true },
)

// ============================================================================
// 3. 提交修改(通过 store.updateClipProperty,进入 history)
// ============================================================================

function commitLabel() {
  if (!primaryClip.value) return
  const trimmed = labelInput.value.trim()
  if (trimmed !== (primaryClip.value.label ?? '')) {
    store.updateClipProperty(primaryClip.value.id, 'label', trimmed)
  }
}

function commitSpeed() {
  if (!primaryClip.value) return
  const clamped = Math.max(0.1, Math.min(10, Number(speedInput.value) || 1))
  if (clamped !== primaryClip.value.speed) {
    store.updateClipProperty(primaryClip.value.id, 'speed', clamped)
  }
}

function commitVolume() {
  if (!primaryClip.value) return
  const clamped = Math.max(0, Math.min(1, Number(volumeInput.value) ?? 1))
  if (clamped !== primaryClip.value.volume) {
    store.updateClipProperty(primaryClip.value.id, 'volume', clamped)
  }
}

function commitTransform(field: keyof ClipTransform) {
  if (!primaryClip.value) return
  const patch: Partial<ClipTransform> = {}
  if (field === 'x') patch.x = Number(transformX.value) || 0
  else if (field === 'y') patch.y = Number(transformY.value) || 0
  else if (field === 'scale') patch.scale = Math.max(0.01, Number(transformScale.value) || 1)
  else if (field === 'rotation') patch.rotation = Number(transformRotation.value) || 0
  else if (field === 'opacity') patch.opacity = Math.max(0, Math.min(1, Number(transformOpacity.value) ?? 1))
  store.updateClipProperty(primaryClip.value.id, 'transform', patch)
}

function toggleEnabled() {
  if (!primaryClip.value) return
  store.updateClipProperty(primaryClip.value.id, 'enabled', !primaryClip.value.enabled)
}

function toggleLocked() {
  if (!primaryClip.value) return
  store.updateClipProperty(primaryClip.value.id, 'locked', !primaryClip.value.locked)
}

// ============================================================================
// 4. 群组操作
// ============================================================================

const groupId = computed(() => primaryClip.value?.groupId)

function onUngroup() {
  if (!groupId.value) return
  store.ungroupClips(groupId.value)
}

// ============================================================================
// 5. 多选批量操作
// ============================================================================

const selectedClipIds = computed(() => selectionStore.selectedIds)

function onMultiDelete() {
  if (selectedClipIds.value.length === 0) return
  store.deleteClips(selectedClipIds.value)
  selectionStore.clear()
}

function onMultiDuplicate() {
  if (selectedClipIds.value.length === 0) return
  store.duplicateClips(selectedClipIds.value)
}

function onMultiGroup() {
  if (selectedClipIds.value.length < 2) return
  store.groupClips(selectedClipIds.value)
}

function onMultiCopy() {
  if (selectedClipIds.value.length === 0) return
  const clipsData = store.getClipsByIds(selectedClipIds.value)
  store.copyClips(clipsData)
}

function onMultiPaste() {
  store.pasteClips(store.currentTime)
}

// ============================================================================
// 6. 显示辅助
// ============================================================================

const startTc = computed(() =>
  primaryClip.value ? formatTimecode(primaryClip.value.timelineStart, props.fps) : '--',
)
const endTc = computed(() =>
  primaryClip.value ? formatTimecode(getClipEnd(primaryClip.value), props.fps) : '--',
)
const durationSec = computed(() =>
  primaryClip.value ? toSeconds(primaryClip.value.duration).toFixed(3) + 's' : '--',
)
const sourceRangeTc = computed(() => {
  if (!primaryClip.value) return '--'
  const s = formatTimecode(primaryClip.value.sourceStart, props.fps)
  const e = formatTimecode(primaryClip.value.sourceEnd, props.fps)
  return `${s} → ${e}`
})

const kindLabel = computed(() => {
  if (!primaryClip.value) return ''
  switch (primaryClip.value.kind) {
    case 'video': return '视频'
    case 'audio': return '音频'
    case 'image': return '图片'
    case 'text': return '文字'
    case 'effect': return '特效'
    default: return '片段'
  }
})
</script>

<template>
  <div class="pro-inspector">
    <!-- 空状态 -->
    <div v-if="!hasSelection" class="empty-state">
      <p class="empty-tip">未选中任何片段</p>
      <p class="empty-hint">在时间轴上点击片段以查看属性</p>
    </div>

    <!-- 多选状态 -->
    <div v-else class="inspector-content">
      <!-- 顶部:选中计数 + 批量操作 -->
      <div class="inspector-section">
        <div class="section-title">
          <span>选中</span>
          <span class="count-badge">{{ selectionCount }}</span>
        </div>
        <div class="multi-actions">
          <button class="action-btn" data-tip="复制(Ctrl+C)" @click="onMultiCopy">复制</button>
          <button class="action-btn" data-tip="粘贴(Ctrl+V)" @click="onMultiPaste">粘贴</button>
          <button class="action-btn" data-tip="原位复制(Ctrl+D)" @click="onMultiDuplicate">复制片段</button>
          <button
            class="action-btn"
            data-tip="群组化(Ctrl+G,需多选)"
            :disabled="!isMulti"
            @click="onMultiGroup"
          >群组</button>
          <button class="action-btn danger" data-tip="删除(Del)" @click="onMultiDelete">删除</button>
        </div>
      </div>

      <!-- 主选中 clip 属性 -->
      <div v-if="primaryClip" class="primary-section">
        <div class="section-title">
          <span>主选中片段</span>
        </div>

        <!-- 基本信息 -->
        <div class="prop-group">
          <div class="prop-row">
            <label class="prop-label">标签</label>
            <input
              v-model="labelInput"
              class="prop-input"
              type="text"
              placeholder="未命名"
              @blur="commitLabel"
              @keydown.enter="commitLabel"
            />
          </div>
          <div class="prop-row">
            <label class="prop-label">类型</label>
            <span class="prop-value-readonly">{{ kindLabel }}</span>
          </div>
          <div class="prop-row">
            <label class="prop-label">位置</label>
            <span class="prop-value-mono">{{ startTc }}</span>
          </div>
          <div class="prop-row">
            <label class="prop-label">结束</label>
            <span class="prop-value-mono">{{ endTc }}</span>
          </div>
          <div class="prop-row">
            <label class="prop-label">时长</label>
            <span class="prop-value-mono">{{ durationSec }}</span>
          </div>
          <div class="prop-row">
            <label class="prop-label">源区间</label>
            <span class="prop-value-mono">{{ sourceRangeTc }}</span>
          </div>
        </div>

        <!-- 播放属性 -->
        <div class="prop-group">
          <div class="section-subtitle">播放</div>
          <div class="prop-row">
            <label class="prop-label">速度</label>
            <input
              v-model.number="speedInput"
              class="prop-input"
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              @blur="commitSpeed"
              @keydown.enter="commitSpeed"
            />
          </div>
          <div class="prop-row">
            <label class="prop-label">音量</label>
            <input
              v-model.number="volumeInput"
              class="prop-input"
              type="number"
              min="0"
              max="1"
              step="0.05"
              @blur="commitVolume"
              @keydown.enter="commitVolume"
            />
          </div>
        </div>

        <!-- 变换 -->
        <div class="prop-group">
          <div class="section-subtitle">变换</div>
          <div class="prop-row">
            <label class="prop-label">X</label>
            <input
              v-model.number="transformX"
              class="prop-input"
              type="number"
              step="1"
              @blur="commitTransform('x')"
              @keydown.enter="commitTransform('x')"
            />
          </div>
          <div class="prop-row">
            <label class="prop-label">Y</label>
            <input
              v-model.number="transformY"
              class="prop-input"
              type="number"
              step="1"
              @blur="commitTransform('y')"
              @keydown.enter="commitTransform('y')"
            />
          </div>
          <div class="prop-row">
            <label class="prop-label">缩放</label>
            <input
              v-model.number="transformScale"
              class="prop-input"
              type="number"
              min="0.01"
              step="0.1"
              @blur="commitTransform('scale')"
              @keydown.enter="commitTransform('scale')"
            />
          </div>
          <div class="prop-row">
            <label class="prop-label">旋转</label>
            <input
              v-model.number="transformRotation"
              class="prop-input"
              type="number"
              step="1"
              @blur="commitTransform('rotation')"
              @keydown.enter="commitTransform('rotation')"
            />
          </div>
          <div class="prop-row">
            <label class="prop-label">不透明</label>
            <input
              v-model.number="transformOpacity"
              class="prop-input"
              type="number"
              min="0"
              max="1"
              step="0.05"
              @blur="commitTransform('opacity')"
              @keydown.enter="commitTransform('opacity')"
            />
          </div>
        </div>

        <!-- 状态开关 -->
        <div class="prop-group">
          <div class="section-subtitle">状态</div>
          <div class="prop-row">
            <label class="prop-label">启用</label>
            <button
              class="toggle-btn"
              :class="{ on: primaryClip.enabled }"
              @click="toggleEnabled"
            >{{ primaryClip.enabled ? '已启用' : '已禁用' }}</button>
          </div>
          <div class="prop-row">
            <label class="prop-label">锁定</label>
            <button
              class="toggle-btn"
              :class="{ on: primaryClip.locked }"
              @click="toggleLocked"
            >{{ primaryClip.locked ? '已锁定' : '未锁定' }}</button>
          </div>
        </div>

        <!-- 群组 -->
        <div v-if="groupId" class="prop-group">
          <div class="section-subtitle">群组</div>
          <div class="prop-row">
            <label class="prop-label">群组 ID</label>
            <span class="prop-value-mono group-id">{{ groupId.slice(0, 16) }}</span>
          </div>
          <div class="prop-row">
            <button class="action-btn danger" @click="onUngroup">解除群组</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pro-inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
  background: var(--pf-surface);
  font-family: 'Inter', system-ui, sans-serif;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--pf-ink-faint);
}
.empty-tip {
  font-size: 13px;
  font-weight: 500;
  color: var(--pf-ink-muted);
  margin: 0;
}
.empty-hint {
  font-size: 11px;
  margin: 0;
}

.inspector-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.inspector-section,
.primary-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--pf-ink-muted);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--pf-line);
}
.section-subtitle {
  font-size: 10px;
  font-weight: 600;
  color: var(--pf-ink-faint);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-top: 4px;
}
.count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 4px;
  background: var(--pf-accent);
  color: var(--pf-surface);
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
}

.multi-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.action-btn {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink-soft);
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.action-btn:hover:not(:disabled) {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}
.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.action-btn.danger {
  color: var(--pf-danger);
}
.action-btn.danger:hover {
  background: rgba(212, 75, 75, 0.08);
  border-color: var(--pf-danger);
}

.prop-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--pf-surface-soft);
  border-radius: 6px;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}
.prop-label {
  flex: 0 0 60px;
  font-size: 11px;
  color: var(--pf-ink-muted);
  font-weight: 500;
}
.prop-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink);
  font-size: 11px;
  border-radius: 3px;
  outline: none;
  font-family: 'JetBrains Mono', monospace;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.prop-input:focus {
  border-color: var(--pf-accent);
}
.prop-value-readonly {
  flex: 1;
  font-size: 11px;
  color: var(--pf-ink-soft);
}
.prop-value-mono {
  flex: 1;
  font-size: 11px;
  color: var(--pf-ink);
  font-family: 'JetBrains Mono', monospace;
}
.group-id {
  color: var(--pf-ink-muted);
  font-size: 10px;
}

.toggle-btn {
  height: 22px;
  padding: 0 10px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink-soft);
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-btn.on {
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  border-color: var(--pf-accent);
}
</style>
