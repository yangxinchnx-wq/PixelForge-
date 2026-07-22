<script setup lang="ts">
/**
 * SettingsDialog(Step 40.1)— 设置面板模态弹窗。
 *
 * 分区:
 * - 外观:主题切换(dark/light/auto)
 * - 编辑器:默认画布尺寸 / 性能监控开关 / 启动恢复
 * - 自动保存:间隔调节
 * - 关于:版本信息
 *
 * 动画:iOS 风格 180ms cubic-bezier(0.22, 1, 0.36, 1)
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useSettingsStore } from '@/preferences/settingsStore'
import { type ThemeMode } from '@/preferences/theme'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

// —— Tab 切换 ——
type Tab = 'appearance' | 'editor' | 'autosave' | 'about'
const activeTab = ref<Tab>('appearance')
const tabs: { id: Tab; label: string }[] = [
  { id: 'appearance', label: '外观' },
  { id: 'editor', label: '编辑器' },
  { id: 'autosave', label: '自动保存' },
  { id: 'about', label: '关于' },
]

// —— 主题选项 ——
const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'auto', label: '跟随系统' },
]

// —— 自动保存滑块 ——
const autosaveSeconds = computed({
  get: () => settings.autosaveIntervalSeconds,
  set: (v: number) => settings.setAutosaveInterval(v * 1000),
})

// —— 画布预设 ——
const canvasPresets = [
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1080 × 1080', w: 1080, h: 1080 },
  { label: '3840 × 2160', w: 3840, h: 2160 },
]

function applyCanvasPreset(w: number, h: number) {
  settings.setDefaultCanvasSize(w, h)
}

// —— 背景点击关闭 ——
function onBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

// —— Esc 关闭 ——
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) {
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

// —— 弹窗动画控制 ——
const showContent = ref(false)
async function onOpenChange(open: boolean) {
  if (open) {
    await nextTick()
    showContent.value = true
  } else {
    showContent.value = false
  }
}
// 监听 open 变化
import { watch } from 'vue'
watch(() => props.open, onOpenChange)
</script>

<template>
  <Transition name="settings-fade">
    <div v-if="open" class="settings-backdrop" @click="onBackdropClick">
      <Transition name="settings-pop" appear>
        <div v-if="open" class="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
          <!-- 标题栏 -->
          <header class="settings-header">
            <h2>设置</h2>
            <button class="close-btn" @click="emit('close')" aria-label="关闭">✕</button>
          </header>

          <!-- Tab 导航 -->
          <nav class="settings-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              :class="['tab-btn', { active: activeTab === tab.id }]"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </nav>

          <!-- 内容区 -->
          <div class="settings-body">
            <!-- 外观 -->
            <section v-if="activeTab === 'appearance'" class="tab-panel">
              <div class="setting-row">
                <div class="setting-label">
                  <strong>主题</strong>
                  <span class="setting-desc">选择应用界面颜色方案</span>
                </div>
                <div class="theme-options">
                  <button
                    v-for="opt in themeOptions"
                    :key="opt.value"
                    :class="['theme-btn', { active: settings.theme === opt.value }]"
                    @click="settings.setTheme(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                </div>
              </div>
              <div class="setting-info">
                当前生效:{{ settings.resolvedTheme === 'dark' ? '深色' : '浅色' }}
                <span v-if="settings.isAutoTheme">(跟随系统)</span>
              </div>
            </section>

            <!-- 编辑器 -->
            <section v-if="activeTab === 'editor'" class="tab-panel">
              <div class="setting-row">
                <div class="setting-label">
                  <strong>默认画布尺寸</strong>
                  <span class="setting-desc">新建项目时的默认分辨率</span>
                </div>
                <div class="canvas-presets">
                  <button
                    v-for="preset in canvasPresets"
                    :key="preset.label"
                    :class="['preset-btn', {
                      active: settings.defaultCanvasWidth === preset.w && settings.defaultCanvasHeight === preset.h
                    }]"
                    @click="applyCanvasPreset(preset.w, preset.h)"
                  >
                    {{ preset.label }}
                  </button>
                </div>
              </div>
              <div class="setting-row">
                <div class="setting-label">
                  <strong>性能监控</strong>
                  <span class="setting-desc">显示帧率 / GPU / 内存悬浮窗</span>
                </div>
                <button
                  :class="['toggle', { on: settings.showPerformanceMonitor }]"
                  @click="settings.setShowPerformanceMonitor(!settings.showPerformanceMonitor)"
                  :aria-pressed="settings.showPerformanceMonitor"
                >
                  <span class="toggle-knob"></span>
                </button>
              </div>
              <div class="setting-row">
                <div class="setting-label">
                  <strong>启动恢复</strong>
                  <span class="setting-desc">启动时自动恢复上次项目</span>
                </div>
                <button
                  :class="['toggle', { on: settings.restoreOnStartup }]"
                  @click="settings.setRestoreOnStartup(!settings.restoreOnStartup)"
                  :aria-pressed="settings.restoreOnStartup"
                >
                  <span class="toggle-knob"></span>
                </button>
              </div>
            </section>

            <!-- 自动保存 -->
            <section v-if="activeTab === 'autosave'" class="tab-panel">
              <div class="setting-row column">
                <div class="setting-label">
                  <strong>自动保存间隔</strong>
                  <span class="setting-desc">{{ autosaveSeconds }} 秒(范围 1~300)</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="300"
                  step="1"
                  v-model.number="autosaveSeconds"
                  class="slider"
                />
              </div>
            </section>

            <!-- 关于 -->
            <section v-if="activeTab === 'about'" class="tab-panel">
              <div class="about-info">
                <h3>PixelForge</h3>
                <p>可视化编程生成艺术引擎</p>
                <dl>
                  <dt>版本</dt><dd>0.4.0</dd>
                  <dt>引擎</dt><dd>WebGPU + WGSL</dd>
                  <dt>框架</dt><dd>Vue 3 + TypeScript + Tauri</dd>
                </dl>
              </div>
            </section>
          </div>

          <!-- 底部操作 -->
          <footer class="settings-footer">
            <button class="footer-btn reset" @click="settings.resetToDefaults">恢复默认</button>
            <button class="footer-btn primary" @click="emit('close')">完成</button>
          </footer>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
/* —— 背景遮罩 —— */
.settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

/* —— 弹窗主体 —— */
.settings-dialog {
  width: 520px;
  max-height: 80vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
}

/* —— 标题栏 —— */
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px;
  border-bottom: 1px solid var(--pf-line);
}
.settings-header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--pf-ink);
}
.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--pf-ink-muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: var(--pf-r-sm);
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1), color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.close-btn:hover {
  background: var(--pf-surface-soft);
  color: var(--pf-ink);
}

/* —— Tab 导航 —— */
.settings-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.tab-btn {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--pf-ink-muted);
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  border-radius: var(--pf-r-sm);
  transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1), background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.tab-btn:hover {
  color: var(--pf-ink);
  background: var(--pf-surface-soft);
}
.tab-btn.active {
  color: var(--pf-accent);
  background: var(--pf-accent-soft);
}

/* —— 内容区 —— */
.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.tab-panel {
  padding: 16px 24px;
}

/* —— 设置行 —— */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--pf-line);
}
.setting-row.column {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
.setting-row:last-child {
  border-bottom: none;
}
.setting-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.setting-label strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--pf-ink);
}
.setting-desc {
  font-size: 11px;
  color: var(--pf-ink-muted);
}
.setting-info {
  padding: 8px 0 4px;
  font-size: 11px;
  color: var(--pf-ink-muted);
  font-family: 'JetBrains Mono', monospace;
}

/* —— 主题按钮组 —— */
.theme-options, .canvas-presets {
  display: flex;
  gap: 6px;
}
.theme-btn, .preset-btn {
  padding: 6px 12px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink-soft);
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  border-radius: var(--pf-r-sm);
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.theme-btn:hover, .preset-btn:hover {
  border-color: var(--pf-line-strong);
  color: var(--pf-ink);
}
.theme-btn.active, .preset-btn.active {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
  background: var(--pf-accent-soft);
}

/* —— Toggle 开关(iOS 风格) —— */
.toggle {
  width: 44px;
  height: 26px;
  border: none;
  border-radius: 13px;
  background: var(--pf-surface-sunk);
  position: relative;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
  flex-shrink: 0;
}
.toggle.on {
  background: var(--pf-accent);
}
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle.on .toggle-knob {
  transform: translateX(18px);
}

/* —— 滑块 —— */
.slider {
  width: 100%;
  height: 4px;
  appearance: none;
  background: var(--pf-surface-sunk);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--pf-accent);
  cursor: pointer;
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

/* —— 关于 —— */
.about-info {
  text-align: center;
  padding: 20px 0;
}
.about-info h3 {
  margin: 0 0 4px;
  font-size: 20px;
  color: var(--pf-ink);
}
.about-info p {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--pf-ink-muted);
}
.about-info dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 16px;
  justify-content: center;
  font-size: 12px;
  font-family: 'JetBrains Mono', monospace;
}
.about-info dt {
  color: var(--pf-ink-muted);
  text-align: right;
}
.about-info dd {
  margin: 0;
  color: var(--pf-ink-soft);
  text-align: left;
}

/* —— 底部操作 —— */
.settings-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 24px;
  border-top: 1px solid var(--pf-line);
}
.footer-btn {
  padding: 8px 18px;
  border: 1px solid var(--pf-line);
  background: var(--pf-surface);
  color: var(--pf-ink-soft);
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  border-radius: var(--pf-r-sm);
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.footer-btn:hover {
  border-color: var(--pf-line-strong);
  color: var(--pf-ink);
}
.footer-btn.primary {
  border-color: var(--pf-accent);
  background: var(--pf-accent);
  color: #fff;
}
.footer-btn.primary:hover {
  background: var(--pf-accent-deep);
}
.footer-btn.reset {
  margin-right: auto;
}

/* —— 动画 —— */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}
.settings-pop-enter-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.settings-pop-leave-active {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.settings-pop-enter-from,
.settings-pop-leave-to {
  transform: scale(0.95) translateY(8px);
  opacity: 0;
}
</style>
