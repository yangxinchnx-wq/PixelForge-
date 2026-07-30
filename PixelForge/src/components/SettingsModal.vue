<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue';
import { modalEnter, modalLeave } from '../composables/useAnime';
import PfSelect from './ui/PfSelect.vue';
import type { ModelConfig, AccentColors } from '../stores/app';

const props = defineProps<{
  isOpen: boolean;
  theme: string;
  autoSaveEnabled: boolean;
  autoSaveInterval: number;
  lastSavedTime: string | null;
  modelConfigs: ModelConfig[];
  accentColors: AccentColors;
}>();

const emit = defineEmits<{
  close: [];
  selectTheme: [theme: 'light' | 'dark'];
  toggleAutoSave: [enabled: boolean];
  updateAutoSaveInterval: [ms: number];
  forceSave: [];
  addModel: [config: Omit<ModelConfig, 'id'>];
  updateModel: [id: string, patch: Partial<Omit<ModelConfig, 'id'>>];
  removeModel: [id: string];
  setAccentColor: [section: keyof AccentColors, color: string];
  resetAccentColors: [];
}>();

const internalVisible = ref(false);
const overlayRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);

// ─── 侧边栏导航 ─────────────────────────────────────────
type SettingsTab = 'appearance' | 'autosave' | 'models';
const activeTab = ref<SettingsTab>('appearance');

const navItems: { id: SettingsTab; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'autosave', label: '自动保存' },
  { id: 'models', label: '模型设置' },
];

// ─── 模型设置 ───────────────────────────────────────────
const providerOptions = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'custom', label: '自定义' },
];

const providerDefaultBaseUrl: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1',
  custom: '',
};

function handleAddModel() {
  emit('addModel', {
    name: '新模型',
    provider: 'openai',
    modelId: '',
    apiKey: '',
    baseUrl: providerDefaultBaseUrl['openai'],
    enabled: true,
  });
}

function handleUpdateModel(id: string, patch: Partial<Omit<ModelConfig, 'id'>>) {
  emit('updateModel', id, patch);
}

function handleRemoveModel(id: string) {
  emit('removeModel', id);
}

function handleProviderChange(id: string, provider: string) {
  const baseUrl = providerDefaultBaseUrl[provider] ?? '';
  handleUpdateModel(id, { provider: provider as ModelConfig['provider'], baseUrl });
}

// ─── 保存间隔显示 ───────────────────────────────────────
const autoSaveIntervalSeconds = computed(() => (props.autoSaveInterval / 1000).toFixed(1));

// ─── 主题色调 ─────────────────────────────────────────
const accentSections: { key: keyof AccentColors; label: string; desc: string }[] = [
  { key: 'settings', label: '设置', desc: '设置弹窗线框与按钮颜色' },
  { key: 'image', label: '图片', desc: '图片工作台强调色' },
  { key: 'video', label: '视频', desc: '视频工作台强调色' },
];

/** hex -> rgba */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** hex 加深 */
function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ─── 可拖拽缩放(四角) ─────────────────────────────────
type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_WIDTH = 640;
const MIN_HEIGHT = 500;
const MAX_WIDTH = 1200;
const MAX_HEIGHT = 900;

const hasCustomSize = ref(false);
const modalWidth = ref(820);
const modalHeight = ref(640);
const modalX = ref(0);
const modalY = ref(0);

const modalStyle = computed(() => {
  const base: Record<string, string> = {};
  // 应用设置页主题色调
  if (props.accentColors.settings) {
    const hex = props.accentColors.settings;
    base['--accent'] = hex;
    base['--accent-pressed'] = darkenHex(hex, 30);
  }
  if (!hasCustomSize.value) return base;
  return {
    ...base,
    position: 'absolute',
    left: `${modalX.value}px`,
    top: `${modalY.value}px`,
    width: `${modalWidth.value}px`,
    height: `${modalHeight.value}px`,
    maxWidth: 'none',
    maxHeight: 'none',
    margin: '0',
  };
});

function getCursorForCorner(corner: ResizeCorner): string {
  return (corner === 'tl' || corner === 'br') ? 'nwse-resize' : 'nesw-resize';
}

function startResize(corner: ResizeCorner, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  const modal = modalRef.value;
  const overlay = overlayRef.value;
  if (!modal || !overlay) return;

  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = modal.offsetWidth;
  const startHeight = modal.offsetHeight;
  const startLeft = modal.offsetLeft;
  const startTop = modal.offsetTop;

  if (!hasCustomSize.value) {
    hasCustomSize.value = true;
    modalWidth.value = startWidth;
    modalHeight.value = startHeight;
    modalX.value = startLeft;
    modalY.value = startTop;
  }

  function onMove(ev: MouseEvent) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    let newWidth = startWidth;
    let newHeight = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;

    if (corner === 'tl' || corner === 'bl') {
      newWidth = startWidth - dx;
      newLeft = startLeft + dx;
      if (newWidth < MIN_WIDTH) { newLeft = startLeft + (startWidth - MIN_WIDTH); newWidth = MIN_WIDTH; }
      if (newWidth > MAX_WIDTH) { newLeft = startLeft + (startWidth - MAX_WIDTH); newWidth = MAX_WIDTH; }
    } else {
      newWidth = startWidth + dx;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;
    }

    if (corner === 'tl' || corner === 'tr') {
      newHeight = startHeight - dy;
      newTop = startTop + dy;
      if (newHeight < MIN_HEIGHT) { newTop = startTop + (startHeight - MIN_HEIGHT); newHeight = MIN_HEIGHT; }
      if (newHeight > MAX_HEIGHT) { newTop = startTop + (startHeight - MAX_HEIGHT); newHeight = MAX_HEIGHT; }
    } else {
      newHeight = startHeight + dy;
      if (newHeight < MIN_HEIGHT) newHeight = MIN_HEIGHT;
      if (newHeight > MAX_HEIGHT) newHeight = MAX_HEIGHT;
    }

    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - newWidth));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - newHeight));

    modalWidth.value = newWidth;
    modalHeight.value = newHeight;
    modalX.value = newLeft;
    modalY.value = newTop;
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  document.body.style.cursor = getCursorForCorner(corner);
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function resetSize() { hasCustomSize.value = false; }

function onWindowResize() {
  if (!hasCustomSize.value) return;
  modalX.value = Math.max(0, Math.min(modalX.value, window.innerWidth - modalWidth.value));
  modalY.value = Math.max(0, Math.min(modalY.value, window.innerHeight - modalHeight.value));
}

onMounted(() => { window.addEventListener('resize', onWindowResize); });
onBeforeUnmount(() => { window.removeEventListener('resize', onWindowResize); });

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      internalVisible.value = true;
      activeTab.value = 'appearance';
      await nextTick();
      if (overlayRef.value && modalRef.value) {
        modalEnter(overlayRef.value, modalRef.value);
      }
    } else if (internalVisible.value) {
      if (overlayRef.value && modalRef.value) {
        await modalLeave(overlayRef.value, modalRef.value);
      }
      internalVisible.value = false;
    }
  },
);
</script>

<template>
  <div v-if="internalVisible" ref="overlayRef" class="pf-modal-overlay" @click="emit('close')">
    <div ref="modalRef" class="pf-modal pf-settings-modal" :style="modalStyle" @click.stop>
      <!-- 标题栏 -->
      <div class="pf-modal-header">
        <span class="pf-modal-title">设置</span>
        <button class="btn btn-icon" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- 主体：侧边栏 + 内容区 -->
      <div class="pf-settings-layout">
        <!-- 侧边栏导航 -->
        <nav class="pf-settings-nav">
          <button
            v-for="item in navItems"
            :key="item.id"
            type="button"
            class="pf-settings-nav-item"
            :class="{ active: activeTab === item.id }"
            @click="activeTab = item.id"
          >
            <span>{{ item.label }}</span>
          </button>
        </nav>

        <!-- 内容区 -->
        <div class="pf-settings-content">
          <!-- ── 外观 ── -->
          <section v-if="activeTab === 'appearance'" class="pf-settings-section">
            <h3 class="pf-settings-section-title">外观</h3>

            <div class="pf-setting-card">
              <div class="pf-setting-card-info">
                <div class="pf-setting-card-label">主题模式</div>
                <div class="pf-setting-card-desc">选择应用的界面颜色方案</div>
              </div>
              <div class="pf-theme-preview-group">
                <button
                  class="pf-theme-card"
                  :class="{ active: theme === 'light' }"
                  @click="emit('selectTheme', 'light')"
                >
                  <div class="pf-theme-card-preview pf-theme-light">
                    <div class="pf-theme-card-bar" />
                    <div class="pf-theme-card-bar short" />
                    <div class="pf-theme-card-bar" />
                  </div>
                  <span class="pf-theme-card-name">浅色</span>
                </button>
                <button
                  class="pf-theme-card"
                  :class="{ active: theme === 'dark' }"
                  @click="emit('selectTheme', 'dark')"
                >
                  <div class="pf-theme-card-preview pf-theme-dark">
                    <div class="pf-theme-card-bar" />
                    <div class="pf-theme-card-bar short" />
                    <div class="pf-theme-card-bar" />
                  </div>
                  <span class="pf-theme-card-name">深色</span>
                </button>
              </div>
            </div>

            <!-- 主题色调 -->
            <div class="pf-setting-card pf-setting-card-column">
              <div class="pf-setting-card-header-row">
                <div class="pf-setting-card-info">
                  <div class="pf-setting-card-label">主题色调</div>
                  <div class="pf-setting-card-desc">为不同模块自定义强调色（线框、按钮等）</div>
                </div>
                <button
                  v-if="accentSections.some(s => accentColors[s.key])"
                  class="pf-accent-reset-all"
                  @click="emit('resetAccentColors')"
                >
                  重置全部
                </button>
              </div>

              <div class="pf-accent-row" v-for="sec in accentSections" :key="sec.key">
                <div class="pf-accent-row-info">
                  <span class="pf-accent-row-label">{{ sec.label }}</span>
                  <span class="pf-accent-row-desc">{{ sec.desc }}</span>
                </div>
                <div class="pf-accent-row-controls">
                  <label class="pf-color-swatch" :class="{ active: !!accentColors[sec.key] }">
                    <input
                      type="color"
                      :value="accentColors[sec.key] || '#ef855d'"
                      @input="emit('setAccentColor', sec.key, ($event.target as HTMLInputElement).value)"
                    />
                    <span class="pf-color-swatch-dot" :style="{ background: accentColors[sec.key] || 'var(--accent)' }" />
                  </label>
                  <button
                    v-if="accentColors[sec.key]"
                    class="pf-accent-reset-btn"
                    title="重置"
                    @click="emit('setAccentColor', sec.key, '')"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </section>
          <section v-if="activeTab === 'autosave'" class="pf-settings-section">
            <h3 class="pf-settings-section-title">自动保存</h3>

            <div class="pf-setting-card">
              <div class="pf-setting-card-info">
                <div class="pf-setting-card-label">自动保存</div>
                <div class="pf-setting-card-desc">开启后项目变更将自动保存到本地存储</div>
              </div>
              <button
                class="pf-toggle-switch"
                :class="{ on: autoSaveEnabled }"
                @click="emit('toggleAutoSave', !autoSaveEnabled)"
              >
                <span class="pf-toggle-knob" />
              </button>
            </div>

            <div v-if="autoSaveEnabled" class="pf-setting-card pf-setting-card-column">
              <div class="pf-setting-card-header-row">
                <div class="pf-setting-card-info">
                  <div class="pf-setting-card-label">保存间隔</div>
                  <div class="pf-setting-card-desc">变更后等待多久自动保存</div>
                </div>
                <span class="pf-slider-value-badge">{{ autoSaveIntervalSeconds }}s</span>
              </div>
              <div class="pf-slider-row">
                <input
                  type="range"
                  class="pf-slider"
                  min="500"
                  max="30000"
                  step="500"
                  :value="autoSaveInterval"
                  @input="emit('updateAutoSaveInterval', Number(($event.target as HTMLInputElement).value))"
                />
                <div class="pf-slider-ticks">
                  <span>0.5s</span>
                  <span>15s</span>
                  <span>30s</span>
                </div>
              </div>
            </div>

            <div v-if="lastSavedTime" class="pf-setting-card">
              <div class="pf-setting-card-info">
                <div class="pf-setting-card-label">上次保存时间</div>
                <div class="pf-setting-card-desc">项目数据最近一次写入存储的时间</div>
              </div>
              <span class="pf-setting-card-value">{{ lastSavedTime }}</span>
            </div>

            <div class="pf-setting-card">
              <div class="pf-setting-card-info">
                <div class="pf-setting-card-label">手动保存</div>
                <div class="pf-setting-card-desc">立即将当前项目状态写入存储</div>
              </div>
              <button class="btn-primary pf-setting-action-btn" @click="emit('forceSave')">
                立即保存
              </button>
            </div>
          </section>

          <!-- ── 模型设置 ── -->
          <section v-if="activeTab === 'models'" class="pf-settings-section">
            <h3 class="pf-settings-section-title">模型设置</h3>

            <p class="pf-settings-section-desc">
              配置各大模型提供商的 API 信息，用于 AI 对话与图片生成。支持 OpenAI、Anthropic、Google 及自定义接口。
            </p>

            <div v-if="modelConfigs.length > 0" class="pf-model-list">
              <div
                v-for="model in modelConfigs"
                :key="model.id"
                class="pf-model-card"
              >
                <div class="pf-model-card-header">
                  <div class="pf-model-card-header-info">
                    <input
                      class="pf-model-name-input"
                      :value="model.name"
                      placeholder="模型名称"
                      @input="handleUpdateModel(model.id, { name: ($event.target as HTMLInputElement).value })"
                    />
                    <span class="pf-model-provider-tag">{{ providerOptions.find(p => p.value === model.provider)?.label ?? model.provider }}</span>
                  </div>
                  <div class="pf-model-card-actions">
                    <button
                      class="pf-toggle-switch"
                      :class="{ on: model.enabled }"
                      :title="model.enabled ? '已启用' : '已禁用'"
                      @click="handleUpdateModel(model.id, { enabled: !model.enabled })"
                    >
                      <span class="pf-toggle-knob" />
                    </button>
                    <button
                      class="btn btn-icon pf-model-delete-btn"
                      title="删除"
                      @click="handleRemoveModel(model.id)"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div class="pf-model-card-body">
                  <div class="pf-model-field">
                    <label class="pf-model-field-label">提供商</label>
                    <PfSelect
                      :model-value="model.provider"
                      :options="providerOptions"
                      size="small"
                      class="pf-model-field-select"
                      @update:model-value="(v: string) => handleProviderChange(model.id, v)"
                    />
                  </div>
                  <div class="pf-model-field">
                    <label class="pf-model-field-label">模型 ID</label>
                    <input
                      class="pf-model-field-input"
                      :value="model.modelId"
                      placeholder="如 gpt-4o, claude-3-5-sonnet"
                      @input="handleUpdateModel(model.id, { modelId: ($event.target as HTMLInputElement).value })"
                    />
                  </div>
                  <div class="pf-model-field">
                    <label class="pf-model-field-label">API Key</label>
                    <input
                      class="pf-model-field-input"
                      type="password"
                      :value="model.apiKey"
                      placeholder="sk-..."
                      @input="handleUpdateModel(model.id, { apiKey: ($event.target as HTMLInputElement).value })"
                    />
                  </div>
                  <div class="pf-model-field">
                    <label class="pf-model-field-label">Base URL</label>
                    <input
                      class="pf-model-field-input"
                      :value="model.baseUrl"
                      placeholder="https://api.example.com/v1"
                      @input="handleUpdateModel(model.id, { baseUrl: ($event.target as HTMLInputElement).value })"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="pf-model-empty">
              <span class="pf-model-empty-text">尚未配置任何模型</span>
              <span class="pf-model-empty-hint">点击下方按钮添加第一个大模型</span>
            </div>

            <button class="pf-model-add-btn" @click="handleAddModel">
              添加模型
            </button>
          </section>
        </div>
      </div>

      <!-- 四角拖拽缩放手柄 -->
      <div class="pf-resize-handle pf-resize-tl" title="拖拽调整大小（双击重置）" @mousedown="startResize('tl', $event)" @dblclick.prevent="resetSize" />
      <div class="pf-resize-handle pf-resize-tr" title="拖拽调整大小（双击重置）" @mousedown="startResize('tr', $event)" @dblclick.prevent="resetSize" />
      <div class="pf-resize-handle pf-resize-bl" title="拖拽调整大小（双击重置）" @mousedown="startResize('bl', $event)" @dblclick.prevent="resetSize" />
      <div class="pf-resize-handle pf-resize-br" title="拖拽调整大小（双击重置）" @mousedown="startResize('br', $event)" @dblclick.prevent="resetSize" />
    </div>
  </div>
</template>

<style scoped>
/* ==========================================================
   设置弹窗 — 尺寸覆盖
   ========================================================== */
.pf-settings-modal {
  width: 820px;
  height: 640px;
  max-width: 92vw;
  max-height: 88vh;
}

/* ==========================================================
   侧边栏 + 内容区 布局
   ========================================================== */
.pf-settings-layout {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

/* ─── 侧边栏 ─── */
.pf-settings-nav {
  width: 160px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  border-right: 1px solid var(--separator);
  overflow-y: auto;
  position: relative;
  z-index: 2;
}

.pf-settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 180ms var(--ease-out),
              color 180ms var(--ease-out);
  text-align: left;
  width: 100%;
  position: relative;
  z-index: 3;
}

.pf-settings-nav-item:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.pf-settings-nav-item.active {
  background: var(--accent);
  color: var(--accent-text);
}

/* ─── 内容区 ─── */
.pf-settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  min-width: 0;
  position: relative;
  z-index: 2;
}

.pf-settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pf-settings-section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
  letter-spacing: -0.01em;
}

.pf-settings-section-desc {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
  margin: 0 0 8px;
}

/* ==========================================================
   设置卡片 — 使用 --glass-bg-hover 确保可见性
   ========================================================== */
.pf-setting-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  transition: border-color 180ms var(--ease-out);
}

.pf-setting-card:hover {
  border-color: var(--separator-strong);
}

.pf-setting-card-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.pf-setting-card-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.pf-setting-card-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.pf-setting-card-value {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  white-space: nowrap;
}

.pf-setting-action-btn {
  font-size: 12px;
  padding: 6px 14px;
  white-space: nowrap;
}

/* ─── 卡片头部行（标签 + 右侧值） ─── */
.pf-setting-card-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.pf-slider-value-badge {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  flex-shrink: 0;
  padding: 2px 8px;
  background: rgba(10, 132, 255, 0.12);
  border-radius: var(--radius-xs);
  min-width: 48px;
  text-align: center;
}

/* ==========================================================
   滑块
   ========================================================== */
.pf-setting-card-column {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}

.pf-slider-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pf-slider {
  width: 100%;
  height: 4px;
  appearance: none;
  -webkit-appearance: none;
  background: var(--separator-strong);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.pf-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  transition: transform 180ms var(--ease-out);
}

.pf-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.pf-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}

.pf-slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}

/* ==========================================================
   主题预览卡片
   ========================================================== */
.pf-theme-preview-group {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.pf-theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border: 2px solid var(--separator);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition: border-color 180ms var(--ease-out);
}

.pf-theme-card:hover {
  border-color: var(--separator-strong);
}

.pf-theme-card.active {
  border-color: var(--accent);
}

.pf-theme-card-preview {
  width: 52px;
  height: 36px;
  border-radius: var(--radius-xs);
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow: hidden;
}

.pf-theme-light {
  background: #f0f0f5;
}

.pf-theme-dark {
  background: #1c1c1e;
}

.pf-theme-card-bar {
  height: 3px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.15);
}

.pf-theme-dark .pf-theme-card-bar {
  background: rgba(255, 255, 255, 0.2);
}

.pf-theme-card-bar.short {
  width: 60%;
}

.pf-theme-card-name {
  font-size: 11px;
  color: var(--text-secondary);
}

.pf-theme-card.active .pf-theme-card-name {
  color: var(--accent);
  font-weight: 500;
}

/* ==========================================================
   主题色调 — 颜色选择器
   ========================================================== */
.pf-accent-reset-all {
  height: 26px;
  padding: 0 12px;
  border: 1px solid var(--separator-strong);
  background: transparent;
  color: var(--text-tertiary);
  border-radius: var(--radius-xs);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pf-accent-reset-all:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}

.pf-accent-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--separator);
}

.pf-accent-row:first-of-type {
  border-top: none;
}

.pf-accent-row-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pf-accent-row-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.pf-accent-row-desc {
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.pf-accent-row-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.pf-color-swatch {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  border: 2px solid var(--separator);
  cursor: pointer;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pf-color-swatch:hover {
  border-color: var(--separator-strong);
}

.pf-color-swatch.active {
  border-color: var(--accent);
}

.pf-color-swatch input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  border: none;
}

.pf-color-swatch-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

.pf-accent-reset-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1),
              background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.pf-accent-reset-btn:hover {
  color: var(--toggle-mute);
  background: rgba(232, 121, 127, 0.1);
}

/* ==========================================================
   Toggle 开关
   ========================================================== */
.pf-toggle-switch {
  width: 44px;
  height: 26px;
  border: none;
  border-radius: 13px;
  background: var(--separator-strong);
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 180ms var(--ease-out);
}

.pf-toggle-switch.on {
  background: var(--accent);
}

.pf-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 180ms var(--ease-out);
}

.pf-toggle-switch.on .pf-toggle-knob {
  transform: translateX(18px);
}

/* ==========================================================
   模型设置
   ========================================================== */
.pf-model-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-model-card {
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color 180ms var(--ease-out);
}

.pf-model-card:hover {
  border-color: var(--separator-strong);
}

.pf-model-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--separator);
}

.pf-model-card-header-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.pf-model-name-input {
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  outline: none;
  min-width: 0;
  flex: 1;
  padding: 2px 0;
  border-bottom: 1px solid transparent;
  transition: border-color 150ms var(--ease-out);
}

.pf-model-name-input:focus {
  border-bottom-color: var(--accent);
}

.pf-model-name-input::placeholder {
  color: var(--text-tertiary);
  font-weight: 400;
}

.pf-model-provider-tag {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--accent);
  background: rgba(10, 132, 255, 0.12);
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  white-space: nowrap;
  flex-shrink: 0;
}

.pf-model-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.pf-model-delete-btn {
  width: 28px;
  height: 28px;
  color: var(--text-tertiary);
}

.pf-model-delete-btn:hover {
  color: var(--toggle-mute);
  background: rgba(255, 59, 48, 0.08);
}

.pf-model-card-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 14px;
  padding: 12px 14px;
}

.pf-model-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pf-model-field-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pf-model-field-input {
  height: 30px;
  padding: 0 10px;
  background: var(--track-bg);
  border: 1px solid var(--separator);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out);
}

.pf-model-field-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.12);
}

.pf-model-field-input::placeholder {
  color: var(--text-tertiary);
}

.pf-model-field-select {
  width: 100%;
}

/* ─── 空状态 ─── */
.pf-model-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 40px 20px;
  text-align: center;
}

.pf-model-empty-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.pf-model-empty-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ─── 添加按钮 ─── */
.pf-model-add-btn {
  height: 36px;
  border: 1px dashed var(--separator-strong);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 180ms var(--ease-out), color 180ms var(--ease-out), background 180ms var(--ease-out);
}

.pf-model-add-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(10, 132, 255, 0.04);
}

.pf-model-add-btn:active {
  transform: scale(0.98);
}

/* ==========================================================
   四角缩放手柄
   ========================================================== */
.pf-resize-handle {
  position: absolute;
  width: 18px;
  height: 18px;
  z-index: 10;
  transition: background 180ms var(--ease-out);
}
.pf-resize-handle:hover {
  background: var(--glass-bg-hover);
}
.pf-resize-tl { top: 0; left: 0; cursor: nwse-resize; border-top-left-radius: var(--radius-lg); }
.pf-resize-tr { top: 0; right: 0; cursor: nesw-resize; border-top-right-radius: var(--radius-lg); }
.pf-resize-bl { bottom: 0; left: 0; cursor: nesw-resize; border-bottom-left-radius: var(--radius-lg); }
.pf-resize-br { bottom: 0; right: 0; cursor: nwse-resize; border-bottom-right-radius: var(--radius-lg); }
</style>
