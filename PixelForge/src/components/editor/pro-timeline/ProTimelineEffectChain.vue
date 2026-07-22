<script setup lang="ts">
/**
 * ProTimelineEffectChain(Step 34)— 视频效果链面板。
 *
 * 功能:
 * - 显示当前选中 Clip 的效果链(有序列表)
 * - 添加效果(按大类分组的下拉菜单)
 * - 启用/禁用、删除、上移/下移、重命名、折叠
 * - 效果参数编辑(根据类型显示不同控件)
 * - 应用内置预设
 * - 清空所有效果
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 中文文字标签,JetBrains Mono 用于数字
 */
import { ref, computed, watch } from 'vue'

import { useClipSelectionStore } from '@/editor/timeline/store/selectionStore'
import { useEffectChainStore } from '@/editor/effects/effectChainStore'
import {
  type VideoEffectType,
  type VideoEffectCategory,
  type VideoEffect,
  getEffectDisplayName,
  getCategoryDisplayName,
  getEffectCategory,
} from '@/editor/effects/effectChain'

const selectionStore = useClipSelectionStore()
const effectStore = useEffectChainStore()

const visible = ref(false)

/** 当前选中 Clip ID */
const selectedClipId = computed(() => selectionStore.primaryId)

/** 同步选中 Clip 到 effectStore */
watch(
  selectedClipId,
  (id) => {
    effectStore.setCurrentClip(id ?? null)
  },
  { immediate: true },
)

/** 当前效果列表 */
const effects = computed(() => effectStore.currentEffects)

/** 添加效果下拉菜单可见 */
const addMenuVisible = ref(false)

/** 预设下拉菜单可见 */
const presetMenuVisible = ref(false)

/** 按大类分组的效果类型 */
const effectTypesByCategory = computed(() => {
  const allTypes: VideoEffectType[] = [
    'brightness_contrast',
    'hue_saturation',
    'color_temperature',
    'levels',
    'curves',
    'gaussian_blur',
    'radial_blur',
    'motion_blur',
    'transform',
    'crop',
    'sharpen',
    'noise',
    'vignette',
    'chromatic_aberration',
    'blend_mode',
    'mask',
    'keyer',
  ]
  const groups: Record<VideoEffectCategory, VideoEffectType[]> = {
    color: [],
    blur: [],
    transform: [],
    stylize: [],
    composite: [],
  }
  for (const t of allTypes) {
    groups[getEffectCategory(t)].push(t)
  }
  return groups
})

/** 预设列表 */
const presets = computed(() => effectStore.presets)

function toggle() {
  visible.value = !visible.value
}

function close() {
  visible.value = false
  addMenuVisible.value = false
  presetMenuVisible.value = false
}

function toggleAddMenu() {
  addMenuVisible.value = !addMenuVisible.value
  presetMenuVisible.value = false
}

function togglePresetMenu() {
  presetMenuVisible.value = !presetMenuVisible.value
  addMenuVisible.value = false
}

function addEffect(type: VideoEffectType) {
  effectStore.addEffect(type)
  addMenuVisible.value = false
}

function applyPreset(presetId: string) {
  effectStore.applyPresetToCurrent(presetId)
  presetMenuVisible.value = false
}

function deleteEffect(effectId: string) {
  effectStore.deleteEffect(effectId)
}

function moveUp(effectId: string) {
  effectStore.moveEffectOrder(effectId, 'up')
}

function moveDown(effectId: string) {
  effectStore.moveEffectOrder(effectId, 'down')
}

function toggleEnabled(effectId: string) {
  effectStore.toggleEffect(effectId)
}

function toggleCollapsed(effectId: string) {
  effectStore.toggleCollapsed(effectId)
}

function clearAll() {
  effectStore.clearAllEffects()
}

/** 编辑名称 */
function onRename(effectId: string, event: Event) {
  const target = event.target as HTMLInputElement
  effectStore.setEffectName(effectId, target.value)
}

/** 更新数值参数 */
function setNumParam(
  effectId: string,
  group: string,
  key: string,
  value: number,
) {
  const effect = effects.value.find((e) => e.id === effectId)
  if (!effect) return
  const currentGroup = (effect.params as Record<string, Record<string, unknown> | undefined>)[group]
  const updated = currentGroup ? { [group]: { ...currentGroup, [key]: value } } : {}
  effectStore.setEffectParams(effectId, updated)
}

/** 获取数值参数 */
function getNumParam(effect: VideoEffect, group: string, key: string): number {
  const g = (effect.params as Record<string, Record<string, unknown> | undefined>)[group]
  if (!g) return 0
  return Number(g[key] ?? 0)
}

/** 获取布尔参数 */
function getBoolParam(effect: VideoEffect, group: string, key: string): boolean {
  const g = (effect.params as Record<string, Record<string, unknown> | undefined>)[group]
  if (!g) return false
  return Boolean(g[key])
}

/** 设置布尔参数 */
function setBoolParam(
  effectId: string,
  group: string,
  key: string,
  value: boolean,
) {
  const effect = effects.value.find((e) => e.id === effectId)
  if (!effect) return
  const currentGroup = (effect.params as Record<string, Record<string, unknown> | undefined>)[group]
  const updated = currentGroup ? { [group]: { ...currentGroup, [key]: value } } : {}
  effectStore.setEffectParams(effectId, updated)
}
</script>

<template>
  <div class="ec-panel">
    <button class="ec-btn" @click="toggle">效果链</button>

    <Transition name="ec-modal">
      <div v-if="visible" class="ec-modal" @click.self="close">
        <div class="ec-modal-inner">
          <!-- 头部 -->
          <div class="ec-header">
            <span class="ec-title">视频效果链</span>
            <div class="ec-header-actions">
              <button class="ec-add-btn" @click="toggleAddMenu">添加效果</button>
              <button class="ec-preset-btn" @click="togglePresetMenu">预设</button>
              <button
                v-if="effects.length > 0"
                class="ec-clear-btn"
                @click="clearAll"
              >
                清空
              </button>
              <button class="ec-close" @click="close">关闭</button>
            </div>
          </div>

          <div class="ec-content">
            <!-- 无选中 Clip 提示 -->
            <div v-if="!selectedClipId" class="ec-empty">
              请先在时间轴上选中一个 Clip。
            </div>

            <!-- 无效果提示 -->
            <div v-else-if="effects.length === 0" class="ec-empty">
              当前 Clip 暂无效果。点击「添加效果」或「预设」开始。
            </div>

            <!-- 效果列表 -->
            <div v-else class="ec-list">
              <div
                v-for="(effect, idx) in effects"
                :key="effect.id"
                class="ec-item"
                :class="{ 'is-disabled': !effect.enabled }"
              >
                <!-- 效果头部 -->
                <div class="ec-item-header">
                  <div class="ec-item-left">
                    <span class="ec-idx">{{ idx + 1 }}</span>
                    <button
                      class="ec-toggle"
                      :class="{ 'is-on': effect.enabled }"
                      @click="toggleEnabled(effect.id)"
                    >
                      {{ effect.enabled ? '开' : '关' }}
                    </button>
                    <button
                      class="ec-collapse"
                      @click="toggleCollapsed(effect.id)"
                    >
                      {{ effect.collapsed ? '展开' : '收起' }}
                    </button>
                    <input
                      class="ec-name"
                      :value="effect.name"
                      @change="onRename(effect.id, $event)"
                    />
                    <span class="ec-cat">{{ effect.category }}</span>
                  </div>
                  <div class="ec-item-right">
                    <button
                      class="ec-move"
                      :disabled="idx === 0"
                      @click="moveUp(effect.id)"
                    >
                      上移
                    </button>
                    <button
                      class="ec-move"
                      :disabled="idx === effects.length - 1"
                      @click="moveDown(effect.id)"
                    >
                      下移
                    </button>
                    <button class="ec-del" @click="deleteEffect(effect.id)">
                      删除
                    </button>
                  </div>
                </div>

                <!-- 效果参数(折叠时隐藏) -->
                <div v-if="!effect.collapsed" class="ec-params">
                  <!-- 亮度对比度 -->
                  <template v-if="effect.type === 'brightness_contrast'">
                    <label class="ec-param">
                      <span>亮度</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'brightness_contrast', 'brightness')"
                        @input="setNumParam(effect.id, 'brightness_contrast', 'brightness', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'brightness_contrast', 'brightness') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>对比度</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'brightness_contrast', 'contrast')"
                        @input="setNumParam(effect.id, 'brightness_contrast', 'contrast', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'brightness_contrast', 'contrast') }}</span>
                    </label>
                  </template>

                  <!-- 色相饱和度 -->
                  <template v-else-if="effect.type === 'hue_saturation'">
                    <label class="ec-param">
                      <span>色相</span>
                      <input
                        type="range"
                        min="-180"
                        max="180"
                        :value="getNumParam(effect, 'hue_saturation', 'hue')"
                        @input="setNumParam(effect.id, 'hue_saturation', 'hue', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'hue_saturation', 'hue') }}°</span>
                    </label>
                    <label class="ec-param">
                      <span>饱和度</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'hue_saturation', 'saturation')"
                        @input="setNumParam(effect.id, 'hue_saturation', 'saturation', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'hue_saturation', 'saturation') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>明度</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'hue_saturation', 'lightness')"
                        @input="setNumParam(effect.id, 'hue_saturation', 'lightness', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'hue_saturation', 'lightness') }}</span>
                    </label>
                  </template>

                  <!-- 高斯模糊 -->
                  <template v-else-if="effect.type === 'gaussian_blur'">
                    <label class="ec-param">
                      <span>半径</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        :value="getNumParam(effect, 'gaussian_blur', 'radius')"
                        @input="setNumParam(effect.id, 'gaussian_blur', 'radius', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'gaussian_blur', 'radius') }}px</span>
                    </label>
                  </template>

                  <!-- 暗角 -->
                  <template v-else-if="effect.type === 'vignette'">
                    <label class="ec-param">
                      <span>强度</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'vignette', 'amount')"
                        @input="setNumParam(effect.id, 'vignette', 'amount', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'vignette', 'amount') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>范围</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        :value="getNumParam(effect, 'vignette', 'size')"
                        @input="setNumParam(effect.id, 'vignette', 'size', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'vignette', 'size') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>羽化</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        :value="getNumParam(effect, 'vignette', 'feather')"
                        @input="setNumParam(effect.id, 'vignette', 'feather', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'vignette', 'feather') }}</span>
                    </label>
                  </template>

                  <!-- 锐化 -->
                  <template v-else-if="effect.type === 'sharpen'">
                    <label class="ec-param">
                      <span>数量</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        :value="getNumParam(effect, 'sharpen', 'amount')"
                        @input="setNumParam(effect.id, 'sharpen', 'amount', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'sharpen', 'amount') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>半径</span>
                      <input
                        type="range"
                        min="0"
                        max="10"
                        step="0.1"
                        :value="getNumParam(effect, 'sharpen', 'radius')"
                        @input="setNumParam(effect.id, 'sharpen', 'radius', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'sharpen', 'radius') }}px</span>
                    </label>
                  </template>

                  <!-- 色温 -->
                  <template v-else-if="effect.type === 'color_temperature'">
                    <label class="ec-param">
                      <span>色温</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'color_temperature', 'temperature')"
                        @input="setNumParam(effect.id, 'color_temperature', 'temperature', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'color_temperature', 'temperature') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>色调</span>
                      <input
                        type="range"
                        min="-100"
                        max="100"
                        :value="getNumParam(effect, 'color_temperature', 'tint')"
                        @input="setNumParam(effect.id, 'color_temperature', 'tint', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'color_temperature', 'tint') }}</span>
                    </label>
                  </template>

                  <!-- 噪点 -->
                  <template v-else-if="effect.type === 'noise'">
                    <label class="ec-param">
                      <span>数量</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        :value="getNumParam(effect, 'noise', 'amount')"
                        @input="setNumParam(effect.id, 'noise', 'amount', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'noise', 'amount') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>单色</span>
                      <input
                        type="checkbox"
                        :checked="getBoolParam(effect, 'noise', 'monochrome')"
                        @change="setBoolParam(effect.id, 'noise', 'monochrome', ($event.target as HTMLInputElement).checked)"
                      />
                    </label>
                  </template>

                  <!-- 色差 -->
                  <template v-else-if="effect.type === 'chromatic_aberration'">
                    <label class="ec-param">
                      <span>数量</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        :value="getNumParam(effect, 'chromatic_aberration', 'amount')"
                        @input="setNumParam(effect.id, 'chromatic_aberration', 'amount', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span class="ec-val">{{ getNumParam(effect, 'chromatic_aberration', 'amount') }}</span>
                    </label>
                    <label class="ec-param">
                      <span>径向</span>
                      <input
                        type="checkbox"
                        :checked="getBoolParam(effect, 'chromatic_aberration', 'radial')"
                        @change="setBoolParam(effect.id, 'chromatic_aberration', 'radial', ($event.target as HTMLInputElement).checked)"
                      />
                    </label>
                  </template>

                  <!-- 变换 -->
                  <template v-else-if="effect.type === 'transform'">
                    <label class="ec-param">
                      <span>X</span>
                      <input
                        type="number"
                        :value="getNumParam(effect, 'transform', 'x')"
                        @input="setNumParam(effect.id, 'transform', 'x', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                    <label class="ec-param">
                      <span>Y</span>
                      <input
                        type="number"
                        :value="getNumParam(effect, 'transform', 'y')"
                        @input="setNumParam(effect.id, 'transform', 'y', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                    <label class="ec-param">
                      <span>缩放</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        max="100"
                        :value="getNumParam(effect, 'transform', 'scale')"
                        @input="setNumParam(effect.id, 'transform', 'scale', Number(($event.target as HTMLInputElement).value))"
                      />
                    </label>
                    <label class="ec-param">
                      <span>旋转</span>
                      <input
                        type="number"
                        :value="getNumParam(effect, 'transform', 'rotation')"
                        @input="setNumParam(effect.id, 'transform', 'rotation', Number(($event.target as HTMLInputElement).value))"
                      />
                      <span>°</span>
                    </label>
                  </template>

                  <!-- 其他类型:显示 JSON(调试用) -->
                  <template v-else>
                    <pre class="ec-raw">{{ JSON.stringify(effect.params, null, 2) }}</pre>
                  </template>
                </div>
              </div>
            </div>

            <!-- 添加效果下拉菜单 -->
            <Transition name="ec-dropdown">
              <div v-if="addMenuVisible" class="ec-dropdown">
                <div
                  v-for="(types, cat) in effectTypesByCategory"
                  :key="cat"
                  class="ec-dropdown-group"
                >
                  <div class="ec-dropdown-title">{{ getCategoryDisplayName(cat as VideoEffectCategory) }}</div>
                  <button
                    v-for="t in types"
                    :key="t"
                    class="ec-dropdown-item"
                    @click="addEffect(t)"
                  >
                    {{ getEffectDisplayName(t) }}
                  </button>
                </div>
              </div>
            </Transition>

            <!-- 预设下拉菜单 -->
            <Transition name="ec-dropdown">
              <div v-if="presetMenuVisible" class="ec-dropdown">
                <div class="ec-dropdown-group">
                  <div class="ec-dropdown-title">内置预设</div>
                  <button
                    v-for="p in presets"
                    :key="p.id"
                    class="ec-dropdown-item"
                    @click="applyPreset(p.id)"
                  >
                    {{ p.name }}
                  </button>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ec-panel {
  position: relative;
  display: inline-block;
}

.ec-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.ec-modal {
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

.ec-modal-inner {
  width: 640px;
  max-height: 85vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ec-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.ec-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.ec-header-actions {
  display: flex;
  gap: 8px;
}
.ec-add-btn,
.ec-preset-btn,
.ec-clear-btn,
.ec-close {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-add-btn:hover,
.ec-preset-btn:hover,
.ec-clear-btn:hover,
.ec-close:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}

.ec-content {
  padding: 16px;
  overflow-y: auto;
  position: relative;
}

.ec-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--pf-ink-muted);
  font-size: 13px;
}

.ec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ec-item {
  background: var(--pf-bg);
  border: 1px solid var(--pf-line);
  border-radius: 6px;
  overflow: hidden;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-item.is-disabled {
  opacity: 0.5;
}

.ec-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--pf-surface);
  border-bottom: 1px solid var(--pf-line);
}
.ec-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ec-idx {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink-muted);
  min-width: 20px;
}
.ec-toggle {
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--pf-line);
  border-radius: 3px;
  cursor: pointer;
  background: var(--pf-surface);
  color: var(--pf-ink-muted);
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-toggle.is-on {
  color: var(--pf-accent);
  border-color: var(--pf-accent);
}
.ec-collapse {
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--pf-line);
  border-radius: 3px;
  cursor: pointer;
  background: var(--pf-surface);
  color: var(--pf-ink-muted);
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-collapse:hover {
  color: var(--pf-ink);
}
.ec-name {
  font-size: 12px;
  color: var(--pf-ink);
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  min-width: 120px;
  padding: 2px 4px;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-name:hover,
.ec-name:focus {
  border-bottom-color: var(--pf-line);
  outline: none;
}
.ec-cat {
  font-size: 10px;
  color: var(--pf-ink-muted);
  padding: 1px 6px;
  background: var(--pf-bg);
  border-radius: 3px;
}

.ec-item-right {
  display: flex;
  gap: 4px;
}
.ec-move,
.ec-del {
  padding: 1px 8px;
  font-size: 11px;
  border: 1px solid var(--pf-line);
  border-radius: 3px;
  cursor: pointer;
  background: var(--pf-surface);
  color: var(--pf-ink-muted);
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-move:hover:not(:disabled),
.ec-del:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}
.ec-move:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.ec-del:hover {
  color: #e55;
  border-color: #e55;
}

.ec-params {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ec-param {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--pf-ink-muted);
}
.ec-param span {
  min-width: 50px;
}
.ec-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink);
  min-width: 40px;
  text-align: right;
}
.ec-param input[type='range'] {
  flex: 1;
  height: 4px;
  cursor: pointer;
  accent-color: var(--pf-accent);
}
.ec-param input[type='number'] {
  width: 70px;
  padding: 2px 4px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 3px;
}
.ec-param input[type='checkbox'] {
  cursor: pointer;
}

.ec-raw {
  font-size: 10px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink-muted);
  background: var(--pf-bg);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}

.ec-dropdown {
  position: absolute;
  top: 60px;
  right: 16px;
  width: 200px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 10;
  padding: 4px;
}
.ec-dropdown-group {
  padding: 4px 0;
}
.ec-dropdown-group + .ec-dropdown-group {
  border-top: 1px solid var(--pf-line);
}
.ec-dropdown-title {
  font-size: 10px;
  color: var(--pf-ink-muted);
  padding: 4px 8px;
  text-transform: uppercase;
}
.ec-dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--pf-ink);
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-dropdown-item:hover {
  background: var(--pf-bg);
}

.ec-modal-enter-active,
.ec-modal-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-modal-enter-from,
.ec-modal-leave-to {
  opacity: 0;
}

.ec-dropdown-enter-active,
.ec-dropdown-leave-active {
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ec-dropdown-enter-from,
.ec-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
