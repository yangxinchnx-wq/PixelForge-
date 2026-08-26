<script setup lang="ts">
/**
 * RenderPage — WebCodecs 硬件加速导出界面（从 App.vue 提取）。
 *
 * 包含格式选择、视频参数、输出摘要、导出按钮、进度显示。
 */
import { computed } from 'vue';
import PfSelect from './ui/PfSelect.vue';
import { useAssetStore } from '@/assets/assetStore';
import { useExportSettings } from '@/composables/useExportSettings';
import { getQualityPreset } from '@/media/video/encoder/videoEncoderTypes';

const props = defineProps<{
  resolution: string;
  frameRate: string;
}>();

const emit = defineEmits<{
  'update:resolution': [value: string];
  'update:frame-rate': [value: string];
}>();

const assetStore = useAssetStore();

const {
  renderFormat,
  renderQuality,
  renderTargetBitrate,
  renderPerImageDuration,
  renderOutputName,
  renderSource,
  runtimeDuration,
  runtimeReady,
  runtimeFrameCount,
  isExporting,
  exportProgress,
  exportError,
  exportDone,
  isCodecDetecting,
  formatOpts,
  qualityOpts,
  exportDuration,
  currentFormatInfo,
  estimatedFileSize,
  canExport,
  exportBtnTooltip,
  startExport,
} = useExportSettings(
  computed(() => props.resolution),
  computed(() => props.frameRate),
);
</script>

<template>
  <div class="pf-render">
    <!-- 左栏：设置区 -->
    <div class="pf-render-settings">
      <!-- 格式 -->
      <div class="pf-panel glass-surface">
        <div class="pf-panel-header">
          <span class="pf-panel-title">格式</span>
          <span v-if="isCodecDetecting" class="pf-render-detect-hint">检测硬件支持中…</span>
        </div>
        <div class="pf-panel-body">
          <div class="pf-render-row">
            <label class="pf-render-label">渲染源</label>
            <div class="pf-seg">
              <button class="pf-seg-btn" :class="{ active: renderSource === 'assets' }" @click="renderSource = 'assets'">资源库图片</button>
              <button class="pf-seg-btn" :class="{ active: renderSource === 'runtime' }" @click="renderSource = 'runtime'">画布逐帧渲染</button>
            </div>
          </div>
          <div class="pf-render-row">
            <label class="pf-render-label">导出格式</label>
            <PfSelect v-model="renderFormat" :options="formatOpts" />
          </div>
          <div class="pf-render-row">
            <label class="pf-render-label">质量等级</label>
            <PfSelect v-model="renderQuality" :options="qualityOpts" />
          </div>
        </div>
      </div>

      <!-- 视频设置 -->
      <div class="pf-panel glass-surface">
        <div class="pf-panel-header">
          <span class="pf-panel-title">视频</span>
        </div>
        <div class="pf-panel-body">
          <div class="pf-render-row">
            <label class="pf-render-label">分辨率</label>
            <div class="pf-seg">
              <button class="pf-seg-btn" :class="{ active: resolution === '1280 × 720' }" @click="emit('update:resolution', '1280 × 720')">720p</button>
              <button class="pf-seg-btn" :class="{ active: resolution === '1920 × 1080' }" @click="emit('update:resolution', '1920 × 1080')">1080p</button>
              <button class="pf-seg-btn" :class="{ active: resolution === '3840 × 2160' }" @click="emit('update:resolution', '3840 × 2160')">4K</button>
            </div>
          </div>
          <div class="pf-render-row">
            <label class="pf-render-label">帧率</label>
            <div class="pf-seg">
              <button class="pf-seg-btn" :class="{ active: frameRate === '24 fps' }" @click="emit('update:frame-rate', '24 fps')">24</button>
              <button class="pf-seg-btn" :class="{ active: frameRate === '30 fps' }" @click="emit('update:frame-rate', '30 fps')">30</button>
              <button class="pf-seg-btn" :class="{ active: frameRate === '60 fps' }" @click="emit('update:frame-rate', '60 fps')">60</button>
            </div>
          </div>
          <div v-if="renderSource === 'assets'" class="pf-render-row">
            <label class="pf-render-label">每张图片时长</label>
            <div class="pf-render-bitrate">
              <input type="range" class="pf-slider" min="0.5" max="10" step="0.5" v-model.number="renderPerImageDuration" />
              <span class="pf-render-bitrate-val">{{ renderPerImageDuration }} 秒</span>
            </div>
          </div>
          <div v-else class="pf-render-row">
            <label class="pf-render-label">导出时长</label>
            <div class="pf-render-bitrate">
              <input
                type="range"
                class="pf-slider"
                min="0.5"
                max="30"
                step="0.5"
                :disabled="isExporting"
                v-model.number="runtimeDuration"
              />
              <span class="pf-render-bitrate-val">{{ runtimeDuration.toFixed(1) }} 秒</span>
            </div>
          </div>
          <div v-if="renderSource === 'runtime'" class="pf-render-row">
            <label class="pf-render-label">渲染引擎</label>
            <span class="pf-render-engine-status" :class="{ ready: runtimeReady }">
              {{ runtimeReady ? 'WebGPU Runtime 就绪' : 'WebGPU Runtime 未就绪' }}
            </span>
          </div>
          <div class="pf-render-row">
            <label class="pf-render-label">目标码率</label>
            <div class="pf-render-bitrate">
              <input type="range" class="pf-slider" min="1" max="50" step="0.5" v-model.number="renderTargetBitrate" />
              <span class="pf-render-bitrate-val">{{ renderTargetBitrate }} Mbps</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 右栏：输出摘要 -->
    <div class="pf-render-summary">
      <div class="pf-panel glass-surface">
        <div class="pf-panel-header">
          <span class="pf-panel-title">输出</span>
        </div>
        <div class="pf-panel-body">
          <div class="pf-render-row">
            <label class="pf-render-label">文件名</label>
            <input v-model="renderOutputName" class="pf-input" type="text" />
          </div>
          <div class="pf-render-summary-grid">
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">格式</span>
              <span class="pf-render-summary-val">{{ currentFormatInfo?.label ?? '—' }}</span>
            </div>
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">分辨率</span>
              <span class="pf-render-summary-val">{{ resolution }}</span>
            </div>
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">帧率</span>
              <span class="pf-render-summary-val">{{ frameRate }}</span>
            </div>
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">{{ renderSource === 'runtime' ? '帧数' : '图片数' }}</span>
              <span class="pf-render-summary-val">{{ renderSource === 'runtime' ? `${runtimeFrameCount} 帧` : `${assetStore.images.length} 张` }}</span>
            </div>
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">时长</span>
              <span class="pf-render-summary-val">{{ exportDuration.toFixed(1) }} s</span>
            </div>
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">质量</span>
              <span class="pf-render-summary-val">{{ getQualityPreset(renderQuality).label }}</span>
            </div>
            <div class="pf-render-summary-item">
              <span class="pf-render-summary-label">实际码率</span>
              <span class="pf-render-summary-val">{{ (renderTargetBitrate * getQualityPreset(renderQuality).bitrateMultiplier).toFixed(1) }} Mbps</span>
            </div>
            <div class="pf-render-summary-item pf-render-summary-highlight">
              <span class="pf-render-summary-label">预估大小</span>
              <span class="pf-render-summary-val">{{ estimatedFileSize }}</span>
            </div>
          </div>

          <!-- 导出进度 -->
          <div v-if="isExporting" class="pf-render-progress">
            <div class="pf-render-progress-bar">
              <div class="pf-render-progress-fill" :style="{ width: exportProgress + '%' }" />
            </div>
            <span class="pf-render-progress-text">{{ Math.round(exportProgress) }}%</span>
          </div>

          <!-- 错误信息 -->
          <div v-if="exportError" class="pf-render-export-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{{ exportError }}</span>
          </div>

          <!-- 成功提示 -->
          <div v-if="exportDone && !isExporting" class="pf-render-export-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>导出完成，文件已开始下载</span>
          </div>

          <button
            class="btn-primary pf-render-export-btn"
            :disabled="!canExport"
            :title="exportBtnTooltip"
            @click="startExport"
          >
            <svg v-if="!isExporting" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
            </svg>
            <svg v-else class="pf-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {{ isExporting ? '渲染中…' : '开始导出' }}
          </button>
          <p v-if="renderSource === 'assets' && assetStore.images.length === 0 && !isCodecDetecting" class="pf-render-hint">
            请先在「图片」页面导入或生成图片
          </p>
          <p v-if="renderSource === 'runtime' && !runtimeReady && !isCodecDetecting" class="pf-render-hint">
            请先在「图片」页面初始化 WebGPU 画布
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
