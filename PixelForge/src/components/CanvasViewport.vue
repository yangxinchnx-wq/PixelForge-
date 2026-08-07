<script setup lang="ts">
import { computed, ref, watch, onUnmounted, nextTick } from 'vue';
import { useAssetStore } from '@/assets/assetStore';
import { loadImages, loadVideo } from '@/assets/assetLoader';

const props = defineProps<{
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  /** 外部传入的选中资源 ID（可选，用于资源管理面板联动） */
  externalSelectedId?: string | null;
  /** 隐藏资源缩略图条（可选，当资源管理在独立面板时使用） */
  hideAssetStrip?: boolean;
}>();

const emit = defineEmits<{
  togglePlay: [];
  stepForward: [];
  stepBackward: [];
  reset: [];
}>();

// ─── Asset Store ──────────────────────────────────────
const assetStore = useAssetStore();

// ─── Local State ──────────────────────────────────────
const selectedAssetId = ref<string | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const isLoading = ref(false);
const lastError = ref<string | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);

// ─── Computed ─────────────────────────────────────────
const selectedAsset = computed(() => {
  if (!selectedAssetId.value) return null;
  return assetStore.getById(selectedAssetId.value) ?? null;
});

const isVideo = computed(() => selectedAsset.value?.type === 'video');
const isImage = computed(() => selectedAsset.value?.type === 'image' || selectedAsset.value?.type === 'texture');
const hasAssets = computed(() => assetStore.items.length > 0);

// ─── Auto-select logic ────────────────────────────────
// 当资源列表变化时,自动选中第一个或保持当前选中
watch(
  () => assetStore.items.length,
  () => {
    if (assetStore.items.length > 0 && !selectedAssetId.value) {
      selectedAssetId.value = assetStore.items[0].id;
    }
    // 如果选中的资源被删除,选中第一个可用的
    if (selectedAssetId.value && !assetStore.getById(selectedAssetId.value)) {
      selectedAssetId.value = assetStore.items[0]?.id ?? null;
    }
  },
);

// ─── External selection sync ──────────────────────────
// 当外部传入选中 ID 时，同步内部选中状态（用于资源管理面板联动）
watch(
  () => props.externalSelectedId,
  (id) => {
    if (id !== undefined && id !== null && id !== selectedAssetId.value) {
      if (assetStore.getById(id)) {
        selectedAssetId.value = id;
      }
    }
  },
);

// ─── Video playback sync ──────────────────────────────
// 同步视频元素的播放/暂停状态
watch(
  () => props.isPlaying,
  (playing) => {
    const video = videoRef.value;
    if (!video || !isVideo.value) return;
    if (playing) {
      void video.play().catch(() => {
        // 自动播放策略可能阻止,忽略错误
      });
    } else {
      video.pause();
    }
  },
);

// 同步视频 currentTime(非播放状态下 seek)
watch(
  () => props.currentTime,
  (time) => {
    const video = videoRef.value;
    if (!video || !isVideo.value) return;
    if (!props.isPlaying) {
      // 仅在差异较大时 seek,避免微调抖动
      if (Math.abs(video.currentTime - time) > 0.15) {
        video.currentTime = Math.min(time, video.duration || time);
      }
    }
  },
);

// 当切换到视频资源时,等待 video 元素挂载后同步状态
watch(selectedAssetId, async (id) => {
  if (!id) return;
  const asset = assetStore.getById(id);
  if (asset?.type === 'video') {
    await nextTick();
    const video = videoRef.value;
    if (video) {
      video.currentTime = Math.min(props.currentTime, video.duration || props.currentTime);
      if (props.isPlaying) {
        void video.play().catch(() => {});
      }
    }
  }
});

// ─── Cleanup ──────────────────────────────────────────
onUnmounted(() => {
  const video = videoRef.value;
  if (video) {
    video.pause();
    video.src = '';
  }
});

// ─── File Import ──────────────────────────────────────
function triggerFileInput() {
  fileInputRef.value?.click();
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  await importFiles(files);
  input.value = '';
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragLeave() {
  isDragOver.value = false;
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;
  const files = Array.from(event.dataTransfer?.files ?? []).filter(
    (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
  );
  if (files.length === 0) return;
  await importFiles(files);
}

/** 批量导入文件(图片 + 视频) */
async function importFiles(files: File[]) {
  isLoading.value = true;
  lastError.value = null;
  try {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));

    // 图片批量导入
    if (imageFiles.length > 0) {
      const { assets, errors } = await loadImages(imageFiles);
      assetStore.addMany(assets);
      if (assets.length > 0) {
        selectedAssetId.value = assets[assets.length - 1].id;
      }
      if (errors.length > 0) {
        lastError.value = `${errors.length} 个图片导入失败: ${errors[0].error}`;
      }
    }

    // 视频逐个导入
    for (const file of videoFiles) {
      try {
        const asset = await loadVideo(file);
        assetStore.add(asset);
        selectedAssetId.value = asset.id;
      } catch (e) {
        lastError.value = `视频导入失败: ${(e as Error).message}`;
      }
    }
  } catch (e) {
    lastError.value = (e as Error).message;
  } finally {
    isLoading.value = false;
  }
}

// ─── Asset Selection ──────────────────────────────────
function selectAsset(id: string) {
  selectedAssetId.value = id;
}

function removeAsset(id: string) {
  assetStore.remove(id);
}

// ─── Format Helpers ───────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>

<template>
  <div class="pf-panel glass-surface pf-panel-center">
    <!-- Canvas Area -->
    <div
      class="pf-canvas-area"
      :class="{ 'drag-over': isDragOver, loading: isLoading }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <!-- 资源类型标识(当选中资源时显示) -->
      <div v-if="selectedAsset" class="pf-canvas-type-badge">
        <span v-if="isVideo" class="type-tag type-video">视频</span>
        <span v-else class="type-tag type-image">图片</span>
        <span class="asset-name-label">{{ selectedAsset.name }}</span>
      </div>

      <!-- 空状态:拖拽导入区 -->
      <div v-if="!selectedAsset" class="pf-canvas-empty" @click="triggerFileInput">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*,video/*"
          multiple
          class="pf-canvas-file-input"
          @change="onFileChange"
        />
        <div class="pf-canvas-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      </div>

      <!-- 图片预览 -->
      <div v-else-if="isImage" class="pf-canvas-preview">
        <img
          :src="selectedAsset.url"
          :alt="selectedAsset.name"
          class="pf-canvas-image"
        />
      </div>

      <!-- 视频预览 -->
      <div v-else-if="isVideo" class="pf-canvas-preview">
        <video
          ref="videoRef"
          :src="selectedAsset.url"
          class="pf-canvas-video"
          playsinline
          @click="emit('togglePlay')"
        />
      </div>

      <!-- 加载遮罩 -->
      <div v-if="isLoading" class="pf-canvas-loading">
        <div class="pf-canvas-spinner" />
        <span>导入中…</span>
      </div>

      <!-- 错误提示 -->
      <div v-if="lastError" class="pf-canvas-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12" y2="16" />
        </svg>
        <span>{{ lastError }}</span>
        <button class="pf-canvas-error-close" @click="lastError = null">×</button>
      </div>
    </div>

    <!-- Asset Strip(资源缩略图条) -->
    <div v-if="hasAssets && !hideAssetStrip" class="pf-canvas-asset-strip">
      <div
        v-for="asset in assetStore.items"
        :key="asset.id"
        class="pf-canvas-asset-thumb"
        :class="{ active: asset.id === selectedAssetId }"
        @click="selectAsset(asset.id)"
      >
        <img
          v-if="asset.thumbnail"
          :src="asset.thumbnail"
          :alt="asset.name"
          class="strip-thumb-img"
        />
        <img
          v-else-if="asset.type === 'image'"
          :src="asset.url"
          :alt="asset.name"
          class="strip-thumb-img"
        />
        <div v-else class="strip-thumb-placeholder">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
        <span class="strip-thumb-type" :class="{ video: asset.type === 'video' }">
          {{ asset.type === 'video' ? '视频' : '图片' }}
        </span>
        <button
          class="strip-thumb-remove"
          title="移除"
          @click.stop="removeAsset(asset.id)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div class="strip-thumb-info">
          <span class="strip-thumb-name" :title="asset.name">{{ asset.name }}</span>
          <span class="strip-thumb-meta">
            {{ asset.width }}×{{ asset.height }}
            <template v-if="asset.type === 'video' && asset.duration">
              · {{ formatDuration(asset.duration) }}
            </template>
            · {{ formatSize(asset.size) }}
          </span>
        </div>
      </div>

      <!-- 添加按钮 -->
      <div class="pf-canvas-asset-add" @click="triggerFileInput">
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          class="pf-canvas-file-input"
          @change="onFileChange"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Canvas Area ────────────────────────────────── */
.pf-canvas-area {
  flex: 1;
  background: var(--canvas-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  min-height: 0;
  transition: background 200ms ease;
}

.pf-canvas-area.drag-over {
  background: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, var(--canvas-bg));
}

.pf-canvas-area.loading {
  pointer-events: none;
  opacity: 0.7;
}

/* ── 资源类型标识 ────────────────────────────────── */
.pf-canvas-type-badge {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 6px;
  border: 1px solid var(--separator);
  font-size: 11px;
  z-index: 10;
}

.type-tag {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
}
.type-tag.type-video {
  background: var(--type-video-bg);
  color: var(--type-video);
}
.type-tag.type-image {
  background: var(--type-text-bg);
  color: var(--type-text);
}

.asset-name-label {
  color: var(--text-secondary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 空状态 / 拖拽区 ──────────────────────────────── */
.pf-canvas-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  padding: 40px;
  border-radius: 12px;
  transition: all 200ms ease;
}

.pf-canvas-empty:hover {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.pf-canvas-empty-icon {
  color: var(--text-tertiary);
  opacity: 0.5;
  transition: all 200ms ease;
}

.pf-canvas-empty:hover .pf-canvas-empty-icon {
  color: var(--accent);
  opacity: 1;
  transform: scale(1.05);
}

.pf-canvas-empty-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
}

.pf-canvas-empty-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.pf-canvas-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

/* ── 图片/视频预览 ────────────────────────────────── */
.pf-canvas-preview {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.pf-canvas-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.pf-canvas-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}

/* ── 加载遮罩 ────────────────────────────────────── */
.pf-canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: color-mix(in srgb, var(--canvas-bg) 80%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 20;
  font-size: 13px;
  color: var(--text-secondary);
}

.pf-canvas-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--separator);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: canvasSpin 0.8s linear infinite;
}

@keyframes canvasSpin {
  to { transform: rotate(360deg); }
}

/* ── 错误提示 ────────────────────────────────────── */
.pf-canvas-error {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: color-mix(in srgb, #ef4444 15%, var(--glass-bg));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
  border-radius: 8px;
  font-size: 12px;
  color: #ef4444;
  max-width: 80%;
  z-index: 20;
}

.pf-canvas-error-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
  line-height: 1;
}
.pf-canvas-error-close:hover { opacity: 1; }

/* ── 资源缩略图条 ────────────────────────────────── */
.pf-canvas-asset-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-top: 1px solid var(--separator);
  overflow-x: auto;
  flex-shrink: 0;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.pf-canvas-asset-strip::-webkit-scrollbar {
  height: 4px;
}
.pf-canvas-asset-strip::-webkit-scrollbar-thumb {
  background: var(--text-quaternary);
  border-radius: 4px;
}

.pf-canvas-asset-thumb {
  position: relative;
  flex-shrink: 0;
  width: 88px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  background: var(--track-bg);
}

.pf-canvas-asset-thumb:hover {
  border-color: var(--separator-strong);
  transform: translateY(-1px);
}

.pf-canvas-asset-thumb.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 2px 8px color-mix(in srgb, var(--accent) 25%, transparent);
}

.strip-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.strip-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--type-video-bg);
  color: var(--type-video);
}

.strip-thumb-type {
  position: absolute;
  bottom: 2px;
  left: 2px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 600;
  background: color-mix(in srgb, var(--glass-bg) 90%, transparent);
  color: var(--text-secondary);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.strip-thumb-type.video {
  background: color-mix(in srgb, var(--type-video) 80%, transparent);
  color: white;
}

.strip-thumb-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: none;
  background: color-mix(in srgb, black 50%, transparent);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms ease;
}

.pf-canvas-asset-thumb:hover .strip-thumb-remove {
  opacity: 1;
}

.strip-thumb-remove:hover {
  background: #ef4444;
}

.strip-thumb-info {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 2px 4px;
  background: linear-gradient(transparent, color-mix(in srgb, black 70%, transparent));
  display: none;
  flex-direction: column;
  gap: 1px;
}

.pf-canvas-asset-thumb:hover .strip-thumb-info {
  display: flex;
}

.strip-thumb-name {
  font-size: 9px;
  color: white;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.strip-thumb-meta {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 添加按钮 ────────────────────────────────────── */
.pf-canvas-asset-add {
  position: relative;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 6px;
  border: 1.5px dashed var(--separator-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: all 180ms ease;
}

.pf-canvas-asset-add:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}
</style>
