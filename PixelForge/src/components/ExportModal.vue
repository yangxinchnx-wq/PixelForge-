<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { modalEnter, modalLeave } from '../composables/useAnime';
import { useAssetStore } from '@/assets/assetStore';
import type { Clip, Track, ElementTag, TuningParams, IRTreeNode } from '../types';

const props = defineProps<{
  isOpen: boolean;
  resolution: string;
  frameRate: string;
  duration: number;
  clips: Clip[];
  tracks: Track[];
  promptText: string;
  elements: ElementTag[];
  tuningParams: TuningParams;
  irTree: IRTreeNode[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const assetStore = useAssetStore();

// 内部可见状态:支持离开动画
const internalVisible = ref(false);
const overlayRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);

// ─── 导出格式 ──────────────────────────────────────────
type ExportFormat = 'json' | 'png' | 'jpeg' | 'mp4' | 'webm';
const exportFormat = ref<ExportFormat>('json');
const outputName = ref('PixelForge_Export');
const isExporting = ref(false);
const exportProgress = ref(0);
const exportDone = ref(false);
const exportError = ref<string | null>(null);

// ─── 视频导出参数 ──────────────────────────────────────
type VideoQuality = 'max' | 'high' | 'medium' | 'low';
const videoQuality = ref<VideoQuality>('high');
const perImageDuration = ref(2); // 每张图展示秒数

const formatOptions: { value: ExportFormat; label: string; desc: string }[] = [
  { value: 'json', label: 'JSON 项目文件', desc: '包含轨道、片段、提示词等完整项目数据' },
  { value: 'png', label: 'PNG 图片', desc: '导出当前画布预览为 PNG（无损）' },
  { value: 'jpeg', label: 'JPEG 图片', desc: '导出当前画布预览为 JPEG（压缩）' },
  { value: 'mp4', label: 'MP4 视频 (H.264)', desc: '将资源库图片序列编码为 H.264 MP4 视频' },
  { value: 'webm', label: 'WebM 视频 (VP9)', desc: '将资源库图片序列编码为 VP9 WebM 视频' },
];

const qualityOptions: { value: VideoQuality; label: string }[] = [
  { value: 'max', label: '最高' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

const isVideoFormat = computed(() => exportFormat.value === 'mp4' || exportFormat.value === 'webm');

// 可用图片数（视频导出帧源）
const availableImageCount = computed(() => assetStore.images.length);

// 解析分辨率
const parsedResolution = computed(() => {
  const match = props.resolution.match(/(\d+)\s*[×x]\s*(\d+)/);
  if (match) return { width: parseInt(match[1]), height: parseInt(match[2]) };
  return { width: 1920, height: 1080 };
});

// 解析帧率
const parsedFps = computed(() => {
  const match = props.frameRate.match(/(\d+)/);
  return match ? parseInt(match[1]) : 30;
});

// 估算文件大小
const estimatedSize = computed(() => {
  if (exportFormat.value === 'json') {
    const base = 500;
    const clipsSize = props.clips.length * 200;
    const tracksSize = props.tracks.length * 100;
    const promptSize = props.promptText.length * 2;
    const total = base + clipsSize + tracksSize + promptSize;
    return total < 1024 ? `${total} B` : `${(total / 1024).toFixed(1)} KB`;
  }
  if (exportFormat.value === 'png') {
    const raw = parsedResolution.value.width * parsedResolution.value.height * 4 * 0.5;
    return raw < 1024 * 1024 ? `${(raw / 1024).toFixed(0)} KB` : `${(raw / 1024 / 1024).toFixed(1)} MB`;
  }
  if (exportFormat.value === 'jpeg') {
    const raw = parsedResolution.value.width * parsedResolution.value.height * 0.15;
    return raw < 1024 * 1024 ? `${(raw / 1024).toFixed(0)} KB` : `${(raw / 1024 / 1024).toFixed(1)} MB`;
  }
  // 视频估算: 码率 × 时长
  const imgCount = Math.max(1, availableImageCount.value);
  const totalDuration = imgCount * perImageDuration.value;
  const bitrate = computeBitrate(parsedResolution.value.width, parsedResolution.value.height, parsedFps.value);
  const raw = bitrate * totalDuration / 8;
  return raw < 1024 * 1024 ? `${(raw / 1024).toFixed(0)} KB` : `${(raw / 1024 / 1024).toFixed(1)} MB`;
});

watch(
  () => props.isOpen,
  async (open) => {
    if (open) {
      internalVisible.value = true;
      exportDone.value = false;
      exportError.value = null;
      exportProgress.value = 0;
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

// ─── 获取当前画布图片元素 ────────────────────────────────
function getCanvasImage(): HTMLImageElement | HTMLVideoElement | null {
  const img = document.querySelector('.pf-canvas-image') as HTMLImageElement | null;
  if (img && img.complete && img.naturalWidth > 0) return img;
  const video = document.querySelector('.pf-canvas-video') as HTMLVideoElement | null;
  if (video && video.readyState >= 2) return video;
  return null;
}

// ─── 下载 Blob 工具函数 ────────────────────────────────
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── 计算视频码率 ──────────────────────────────────────
function computeBitrate(width: number, height: number, fps: number): number {
  // 基于像素量和帧率的经验公式: ~0.1 bits/pixel/frame
  return Math.round(width * height * fps * 0.1);
}

// ─── 导出 JSON 项目文件 ────────────────────────────────
function exportJSON(): Blob {
  const projectData = {
    version: '1.0.0',
    appName: 'PixelForge',
    exportedAt: new Date().toISOString(),
    settings: {
      resolution: props.resolution,
      frameRate: props.frameRate,
      fps: parsedFps.value,
      duration: props.duration,
    },
    prompt: props.promptText,
    elements: props.elements,
    tuningParams: props.tuningParams,
    irTree: props.irTree,
    tracks: props.tracks,
    clips: props.clips,
  };
  const jsonStr = JSON.stringify(projectData, null, 2);
  return new Blob([jsonStr], { type: 'application/json' });
}

// ─── 导出图片（PNG / JPEG）────────────────────────────
function exportImage(format: 'png' | 'jpeg'): Promise<Blob> {
  const source = getCanvasImage();
  if (!source) {
    return Promise.reject(new Error('画布上没有可导出的图片或视频'));
  }

  const { width, height } = parsedResolution.value;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  if (format === 'jpeg') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
  }

  ctx.drawImage(source, 0, 0, width, height);

  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  const quality = format === 'jpeg' ? 0.92 : undefined;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('图片生成失败'));
      },
      mimeType,
      quality,
    );
  });
}

// ─── 导出视频（MP4 / WebM）────────────────────────────
async function exportVideo(format: 'mp4' | 'webm'): Promise<Blob> {
  const images = assetStore.images;
  if (images.length === 0) {
    throw new Error('资源库中没有图片，请先生成或导入图片');
  }

  const { width, height } = parsedResolution.value;
  const fps = parsedFps.value;
  const bitrate = computeBitrate(width, height, fps);

  // 动态导入编码器（避免 mp4-muxer/webm-muxer 重型依赖在启动时加载）
  const { encodeImagesToVideo } = await import('@/media/video/encoder/videoEncoder');

  const imageUrls = images.map((a) => a.url);
  const codecFormat = format === 'mp4' ? 'h264' : 'vp9';

  return encodeImagesToVideo({
    imageUrls,
    width,
    height,
    fps,
    perImageDuration: perImageDuration.value,
    bitrate,
    format: codecFormat,
    quality: videoQuality.value,
    onProgress: (p) => {
      exportProgress.value = p;
    },
  });
}

// ─── 执行导出 ──────────────────────────────────────────
async function doExport() {
  if (isExporting.value) return;
  isExporting.value = true;
  exportDone.value = false;
  exportError.value = null;
  exportProgress.value = 0;

  try {
    let blob: Blob;
    let ext: string;

    if (exportFormat.value === 'json') {
      // JSON 不需要进度模拟
      blob = exportJSON();
      ext = 'json';
      exportProgress.value = 100;
    } else if (exportFormat.value === 'png' || exportFormat.value === 'jpeg') {
      const source = getCanvasImage();
      if (!source) {
        throw new Error('画布上没有可导出的图片或视频，请先在画布中加载素材');
      }
      // 图片导出用轻量进度模拟
      const progressTimer = setInterval(() => {
        exportProgress.value = Math.min(exportProgress.value + Math.random() * 15 + 5, 90);
      }, 100);
      blob = await exportImage(exportFormat.value);
      clearInterval(progressTimer);
      ext = exportFormat.value === 'png' ? 'png' : 'jpg';
      exportProgress.value = 100;
    } else {
      // 视频导出：进度由编码器回调驱动
      blob = await exportVideo(exportFormat.value);
      ext = exportFormat.value;
    }

    const filename = `${outputName.value || 'PixelForge_Export'}.${ext}`;
    downloadBlob(blob, filename);

    setTimeout(() => {
      isExporting.value = false;
      exportDone.value = true;
    }, 500);
  } catch (e) {
    isExporting.value = false;
    exportError.value = (e as Error).message;
  }
}
</script>

<template>
  <div v-if="internalVisible" ref="overlayRef" class="pf-modal-overlay" @click="emit('close')">
    <div ref="modalRef" class="pf-modal glass-surface pf-export-modal" @click.stop>
      <div class="pf-modal-header">
        <span class="pf-modal-title">导出</span>
        <button class="btn btn-icon" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="pf-modal-body">
        <!-- 项目信息摘要 -->
        <div class="pf-export-summary">
          <div class="pf-export-summary-item">
            <span class="pf-export-summary-label">分辨率</span>
            <span class="pf-export-summary-val">{{ resolution }}</span>
          </div>
          <div class="pf-export-summary-item">
            <span class="pf-export-summary-label">帧率</span>
            <span class="pf-export-summary-val">{{ frameRate }}</span>
          </div>
          <div class="pf-export-summary-item">
            <span class="pf-export-summary-label">时长</span>
            <span class="pf-export-summary-val">{{ duration.toFixed(1) }} 秒</span>
          </div>
          <div class="pf-export-summary-item">
            <span class="pf-export-summary-label">片段</span>
            <span class="pf-export-summary-val">{{ clips.length }} 个</span>
          </div>
        </div>

        <!-- 导出格式选择 -->
        <div class="pf-panel-section">
          <div class="pf-panel-label">导出格式</div>
          <div class="pf-export-formats">
            <button
              v-for="opt in formatOptions"
              :key="opt.value"
              class="pf-export-format-btn"
              :class="{ active: exportFormat === opt.value }"
              :disabled="isExporting"
              @click="exportFormat = opt.value"
            >
              <div class="pf-export-format-radio" :class="{ checked: exportFormat === opt.value }" />
              <div class="pf-export-format-info">
                <span class="pf-export-format-name">{{ opt.label }}</span>
                <span class="pf-export-format-desc">{{ opt.desc }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- 文件名 -->
        <div class="pf-panel-section">
          <div class="pf-panel-label">文件名</div>
          <input
            v-model="outputName"
            class="pf-export-input"
            type="text"
            placeholder="输入文件名"
            :disabled="isExporting"
          />
        </div>

        <!-- 视频参数（仅视频格式显示） -->
        <template v-if="isVideoFormat">
          <div class="pf-panel-section">
            <div class="pf-panel-label">画质</div>
            <div class="pf-export-quality-row">
              <button
                v-for="q in qualityOptions"
                :key="q.value"
                class="pf-export-quality-btn"
                :class="{ active: videoQuality === q.value }"
                :disabled="isExporting"
                @click="videoQuality = q.value"
              >
                {{ q.label }}
              </button>
            </div>
          </div>

          <div class="pf-panel-section">
            <div class="pf-panel-label">每张图展示时长（秒）</div>
            <input
              v-model.number="perImageDuration"
              class="pf-export-input"
              type="number"
              min="0.5"
              max="60"
              step="0.5"
              :disabled="isExporting"
            />
          </div>

          <div class="pf-export-info-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="8" />
            </svg>
            <span>将使用资源库中的 {{ availableImageCount }} 张图片作为帧序列</span>
          </div>
        </template>

        <!-- 估算大小 -->
        <div class="pf-export-size-row">
          <span class="pf-export-size-label">预估大小</span>
          <span class="pf-export-size-val">{{ estimatedSize }}</span>
        </div>

        <!-- 导出进度 -->
        <div v-if="isExporting" class="pf-export-progress">
          <div class="pf-export-progress-bar">
            <div class="pf-export-progress-fill" :style="{ width: exportProgress + '%' }" />
          </div>
          <span class="pf-export-progress-text">{{ Math.round(exportProgress) }}%</span>
        </div>

        <!-- 导出完成 -->
        <div v-if="exportDone" class="pf-export-success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>导出成功！文件已开始下载</span>
        </div>

        <!-- 导出错误 -->
        <div v-if="exportError" class="pf-export-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12" y2="16" />
          </svg>
          <span>{{ exportError }}</span>
        </div>
      </div>

      <div class="pf-modal-footer">
        <button class="btn" :disabled="isExporting" @click="emit('close')">取消</button>
        <button
          class="btn-primary"
          :disabled="isExporting"
          @click="doExport"
        >
          {{ isExporting ? '导出中…' : '导出' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf-export-modal {
  width: 480px;
  max-width: 90vw;
}

/* ── Summary ── */
.pf-export-summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px;
  background: var(--track-bg);
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
}

.pf-export-summary-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pf-export-summary-label {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pf-export-summary-val {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* ── Format Selection ── */
.pf-export-formats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pf-export-format-btn {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all 150ms var(--ease-out);
  text-align: left;
}

.pf-export-format-btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  border-color: var(--separator-strong);
}

.pf-export-format-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--glass-bg));
}

.pf-export-format-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pf-export-format-radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--separator-strong);
  flex-shrink: 0;
  margin-top: 2px;
  transition: all 150ms ease;
  position: relative;
}

.pf-export-format-radio.checked {
  border-color: var(--accent);
}

.pf-export-format-radio.checked::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.pf-export-format-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pf-export-format-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.pf-export-format-desc {
  font-size: 10px;
  color: var(--text-tertiary);
}

/* ── Input ── */
.pf-export-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  color: var(--text-primary);
  border-radius: var(--radius-xs);
  font-size: 12px;
  outline: none;
  transition: border-color 150ms ease;
}

.pf-export-input:focus {
  border-color: var(--accent);
}

.pf-export-input:disabled {
  opacity: 0.5;
}

/* ── Size Row ── */
.pf-export-size-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--track-bg);
  border-radius: var(--radius-xs);
  margin-top: 4px;
}

.pf-export-size-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.pf-export-size-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

/* ── Progress ── */
.pf-export-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.pf-export-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--separator-strong);
  border-radius: 3px;
  overflow: hidden;
}

.pf-export-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 150ms ease;
}

.pf-export-progress-text {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  min-width: 36px;
  text-align: right;
}

/* ── Success ── */
.pf-export-success {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 12px;
  background: color-mix(in srgb, #22c55e 12%, transparent);
  border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 500;
  color: #22c55e;
}

/* ── Error ── */
.pf-export-error {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 12px;
  background: color-mix(in srgb, #ef4444 12%, transparent);
  border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 500;
  color: #ef4444;
}

/* ── Video Quality ── */
.pf-export-quality-row {
  display: flex;
  gap: 4px;
}

.pf-export-quality-btn {
  flex: 1;
  height: 30px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 150ms var(--ease-out);
}

.pf-export-quality-btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.pf-export-quality-btn.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--glass-bg));
  color: var(--accent);
}

.pf-export-quality-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Info Row ── */
.pf-export-info-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  margin-top: 4px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
  border-radius: var(--radius-xs);
  font-size: 11px;
  color: var(--text-secondary);
}

.pf-export-info-row svg {
  color: var(--accent);
  flex-shrink: 0;
}

/* ── Footer ── */
.pf-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--separator);
}

.pf-modal-footer .btn {
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 150ms var(--ease-out);
}

.pf-modal-footer .btn:hover:not(:disabled) {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.pf-modal-footer .btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
