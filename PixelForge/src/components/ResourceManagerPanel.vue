<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useAssetStore } from '@/assets/assetStore';
import { useAppStore } from '../stores/app';
import { loadImages, loadVideo } from '@/assets/assetLoader';

// ─── Asset Store ──────────────────────────────────────
const assetStore = useAssetStore();
const appStore = useAppStore();

// ─── Local State ──────────────────────────────────────
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const isLoading = ref(false);
const lastError = ref<string | null>(null);
const selectedAssetId = ref<string | null>(null);
const filterType = ref<'all' | 'image' | 'video'>('all');

// ─── Emits ────────────────────────────────────────────
const emit = defineEmits<{
  selectAsset: [id: string];
}>();

// ─── Computed ─────────────────────────────────────────
const filteredAssets = computed(() => {
  if (filterType.value === 'all') return assetStore.items;
  return assetStore.items.filter((a) => a.type === filterType.value || (filterType.value === 'image' && a.type === 'texture'));
});

// 当新资源加入（如 AI 生成完成）时，自动选中最新项
watch(
  () => assetStore.items.length,
  (newLength, oldLength) => {
    if (newLength > (oldLength ?? 0)) {
      const latest = assetStore.items[assetStore.items.length - 1];
      if (latest) {
        selectedAssetId.value = latest.id;
        emit('selectAsset', latest.id);
      }
    }
  },
);

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

async function importFiles(files: File[]) {
  isLoading.value = true;
  lastError.value = null;
  try {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));

    if (imageFiles.length > 0) {
      const { assets, errors } = await loadImages(imageFiles);
      assetStore.addMany(assets);
      if (assets.length > 0) {
        selectedAssetId.value = assets[assets.length - 1].id;
        emit('selectAsset', assets[assets.length - 1].id);
      }
      if (errors.length > 0) {
        lastError.value = `${errors.length} 个文件导入失败: ${errors[0].error}`;
      }
    }

    for (const file of videoFiles) {
      try {
        const asset = await loadVideo(file);
        assetStore.add(asset);
        selectedAssetId.value = asset.id;
        emit('selectAsset', asset.id);
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
  emit('selectAsset', id);
}

function removeAsset(id: string) {
  assetStore.remove(id);
  if (selectedAssetId.value === id) {
    selectedAssetId.value = assetStore.items[0]?.id ?? null;
    if (selectedAssetId.value) emit('selectAsset', selectedAssetId.value);
  }
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

// ─── Task Tree ────────────────────────────────────────
type TaskStatus = 'pending' | 'running' | 'done' | 'error';

interface TaskNode {
  id: string;
  label: string;
  status: TaskStatus;
  progress?: number; // 0-100
  children?: TaskNode[];
}

const taskTreeExpanded = ref<Record<string, boolean>>({
  'root-1': true,
  'root-2': false,
  'root-3': false,
});

function isTaskExpanded(node: TaskNode): boolean {
  return taskTreeExpanded.value[node.id] !== false;
}

function toggleTaskExpand(node: TaskNode) {
  if (node.children && node.children.length > 0) {
    taskTreeExpanded.value[node.id] = !isTaskExpanded(node);
  }
}

const taskTree = ref<TaskNode[]>([
  {
    id: 'root-1',
    label: '生成任务',
    status: 'done',
    progress: 100,
    children: [
      { id: 'task-1-1', label: '描述解析', status: 'done', progress: 100 },
      { id: 'task-1-2', label: '模型推理', status: 'done', progress: 100 },
      { id: 'task-1-3', label: '图片合成', status: 'done', progress: 100 },
    ],
  },
  {
    id: 'root-2',
    label: '后处理任务',
    status: 'pending',
    progress: 0,
    children: [
      { id: 'task-2-1', label: '色彩校正', status: 'pending', progress: 0 },
      { id: 'task-2-2', label: '锐化增强', status: 'pending', progress: 0 },
      { id: 'task-2-3', label: '降噪处理', status: 'pending', progress: 0 },
    ],
  },
  {
    id: 'root-3',
    label: '导出任务',
    status: 'pending',
    progress: 0,
    children: [
      { id: 'task-3-1', label: '格式转换', status: 'pending', progress: 0 },
      { id: 'task-3-2', label: '质量压缩', status: 'pending', progress: 0 },
    ],
  },
]);

// 当生成开始时，更新任务树状态
watch(
  () => appStore.isGenerating,
  (generating) => {
    if (generating) {
      // 重置任务树，开始执行
      taskTree.value[0].status = 'running';
      taskTree.value[0].progress = 0;
      taskTree.value[0].children?.forEach((c) => {
        c.status = 'pending';
        c.progress = 0;
      });
      taskTreeExpanded.value['root-1'] = true;

      // 模拟任务进度推进
      const steps = taskTree.value[0].children!;
      steps.forEach((step, i) => {
        setTimeout(() => {
          if (i > 0) steps[i - 1].status = 'done';
          step.status = 'running';
          taskTree.value[0].progress = Math.round(((i + 1) / steps.length) * 100);
        }, i * 350);
      });

      // 完成
      setTimeout(() => {
        steps.forEach((s) => { s.status = 'done'; s.progress = 100; });
        taskTree.value[0].status = 'done';
        taskTree.value[0].progress = 100;
        // 激活后处理任务
        taskTree.value[1].status = 'running';
        taskTree.value[1].progress = 30;
        taskTree.value[1].children![0].status = 'running';
      }, steps.length * 350 + 200);
    } else {
      // 生成完成后，后处理也完成
      setTimeout(() => {
        const post = taskTree.value[1];
        post.status = 'done';
        post.progress = 100;
        post.children?.forEach((c) => { c.status = 'done'; c.progress = 100; });
        // 激活导出任务
        const exp = taskTree.value[2];
        exp.status = 'running';
        exp.progress = 50;
        exp.children![0].status = 'running';
      }, 500);
    }
  },
);

// 当前活动任务数
const activeTaskCount = computed(() => {
  let count = 0;
  function countActive(nodes: TaskNode[]) {
    for (const n of nodes) {
      if (n.status === 'running') count++;
      if (n.children) countActive(n.children);
    }
  }
  countActive(taskTree.value);
  return count;
});
</script>

<template>
  <div
    class="pf-panel glass-surface pf-panel-right pf-resource-panel"
    :class="{ 'drag-over': isDragOver, loading: isLoading }"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- Header -->
    <div class="pf-panel-header">
      <span class="pf-panel-title">资源管理</span>
      <button class="pf-resource-import-btn" title="导入资源" @click="triggerFileInput">
        <input
          ref="fileInputRef"
          type="file"
          accept="image/*,video/*"
          multiple
          class="pf-resource-file-input"
          @change="onFileChange"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        导入
      </button>
    </div>

    <!-- Asset Items -->

    <!-- Asset List -->
    <div class="pf-resource-list">
      <!-- Empty State -->
      <div v-if="filteredAssets.length === 0" class="pf-resource-empty" @click="triggerFileInput">
        <div class="pf-resource-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
        <div class="pf-resource-empty-text">
          {{ isDragOver ? '释放以导入' : '拖入图片 / 视频到此处' }}
        </div>
        <div class="pf-resource-empty-hint">
          或点击"导入"按钮 · 支持 PNG / JPEG / WebP / MP4
        </div>
      </div>

      <!-- Asset Items -->
      <div
        v-for="asset in filteredAssets"
        :key="asset.id"
        class="pf-resource-item"
        :class="{ active: asset.id === selectedAssetId }"
        @click="selectAsset(asset.id)"
      >
        <!-- Thumbnail -->
        <div class="pf-resource-thumb">
          <img
            v-if="asset.thumbnail"
            :src="asset.thumbnail"
            :alt="asset.name"
            class="pf-resource-thumb-img"
          />
          <img
            v-else-if="asset.type === 'image'"
            :src="asset.url"
            :alt="asset.name"
            class="pf-resource-thumb-img"
          />
          <div v-else class="pf-resource-thumb-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <!-- Type Badge -->
          <span class="pf-resource-type-badge" :class="{ video: asset.type === 'video' }">
            {{ asset.type === 'video' ? '视频' : '图片' }}
          </span>
          <!-- Remove Button -->
          <button
            class="pf-resource-remove"
            title="移除"
            @click.stop="removeAsset(asset.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Info -->
        <div class="pf-resource-info">
          <span class="pf-resource-name" :title="asset.name">{{ asset.name }}</span>
          <span class="pf-resource-meta">
            {{ asset.width }}×{{ asset.height }}
            <template v-if="asset.type === 'video' && asset.duration">
              · {{ formatDuration(asset.duration) }}
            </template>
            · {{ formatSize(asset.size) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Task Tree Section -->
    <div class="pf-task-tree-section">
      <div class="pf-task-tree-header">
        <span class="pf-task-tree-title">任务树</span>
        <span v-if="activeTaskCount > 0" class="pf-task-tree-badge-active">
          {{ activeTaskCount }} 个进行中
        </span>
      </div>
      <div class="pf-task-tree-body">
        <template v-for="node in taskTree" :key="node.id">
          <div class="pf-task-node pf-task-root">
            <div class="pf-task-row" @click="toggleTaskExpand(node)">
              <div class="pf-task-toggle" :class="{ expanded: isTaskExpanded(node) }">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
              <!-- Status Icon -->
              <div class="pf-task-status-icon" :class="'status-' + node.status">
                <svg v-if="node.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="10" height="10">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <div v-else-if="node.status === 'running'" class="pf-task-mini-spinner" />
                <span v-else class="pf-task-status-dot" />
              </div>
              <span class="pf-task-label">{{ node.label }}</span>
              <span v-if="node.progress !== undefined" class="pf-task-progress-text">{{ node.progress }}%</span>
            </div>
            <!-- Progress bar for root task -->
            <div v-if="node.progress !== undefined && node.status === 'running'" class="pf-task-progress-bar">
              <div class="pf-task-progress-fill" :style="{ width: node.progress + '%' }" />
            </div>
            <!-- Children -->
            <div v-if="node.children && node.children.length > 0 && isTaskExpanded(node)" class="pf-task-children">
              <div v-for="child in node.children" :key="child.id" class="pf-task-node">
                <div class="pf-task-row pf-task-child-row">
                  <div class="pf-task-toggle-spacer" />
                  <div class="pf-task-status-icon" :class="'status-' + child.status">
                    <svg v-if="child.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="10" height="10">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <div v-else-if="child.status === 'running'" class="pf-task-mini-spinner" />
                    <span v-else class="pf-task-status-dot" />
                  </div>
                  <span class="pf-task-label pf-task-child-label">{{ child.label }}</span>
                  <span v-if="child.progress !== undefined && child.status !== 'pending'" class="pf-task-progress-text">{{ child.progress }}%</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Loading Overlay -->
    <div v-if="isLoading" class="pf-resource-loading">
      <div class="pf-resource-spinner" />
      <span>导入中…</span>
    </div>

    <!-- Error Toast -->
    <div v-if="lastError" class="pf-resource-error">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12" y2="16" />
      </svg>
      <span>{{ lastError }}</span>
      <button class="pf-resource-error-close" @click="lastError = null">×</button>
    </div>
  </div>
</template>

<style scoped>
.pf-resource-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  transition: background 200ms ease;
}

.pf-resource-panel.drag-over {
  background: color-mix(in srgb, var(--accent) 10%, var(--glass-bg));
}

.pf-resource-panel.loading {
  pointer-events: none;
  opacity: 0.8;
}

/* ── Import Button ── */
.pf-resource-import-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 150ms var(--ease-out);
  position: relative;
}

.pf-resource-import-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
  border-color: var(--separator-strong);
}

.pf-resource-import-btn:active {
  transform: scale(0.96);
}

.pf-resource-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.pf-resource-stat.active .pf-resource-stat-val {
  color: var(--accent);
}

/* ── Asset List ── */
.pf-resource-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pf-resource-list::-webkit-scrollbar {
  width: 6px;
}

.pf-resource-list::-webkit-scrollbar-thumb {
  background: var(--text-quaternary);
  border-radius: 3px;
}

/* ── Empty State ── */
.pf-resource-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  padding: 24px 16px;
  border-radius: var(--radius-sm);
  transition: all 200ms ease;
}

.pf-resource-empty:hover {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}

.pf-resource-empty-icon {
  color: var(--text-tertiary);
  opacity: 0.5;
  transition: all 200ms ease;
}

.pf-resource-empty:hover .pf-resource-empty-icon {
  color: var(--accent);
  opacity: 1;
  transform: scale(1.05);
}

.pf-resource-empty-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.pf-resource-empty-hint {
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: center;
}

/* ── Asset Item ── */
.pf-resource-item {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all 150ms var(--ease-out);
  border: 1px solid transparent;
}

.pf-resource-item:hover {
  background: var(--track-bg-hover);
}

.pf-resource-item.active {
  background: var(--track-bg);
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

/* ── Thumbnail ── */
.pf-resource-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-xs);
  overflow: hidden;
  flex-shrink: 0;
  background: var(--track-bg);
}

.pf-resource-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.pf-resource-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--type-video-bg);
  color: var(--type-video);
}

.pf-resource-type-badge {
  position: absolute;
  bottom: 2px;
  left: 2px;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 8px;
  font-weight: 600;
  background: color-mix(in srgb, var(--glass-bg) 90%, transparent);
  color: var(--text-secondary);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.pf-resource-type-badge.video {
  background: color-mix(in srgb, var(--type-video) 80%, transparent);
  color: white;
}

.pf-resource-remove {
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

.pf-resource-item:hover .pf-resource-remove {
  opacity: 1;
}

.pf-resource-remove:hover {
  background: #ef4444;
}

/* ── Info ── */
.pf-resource-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.pf-resource-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-resource-meta {
  font-size: 10px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Loading ── */
.pf-resource-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--glass-bg) 80%, transparent);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 20;
  font-size: 12px;
  color: var(--text-secondary);
}

.pf-resource-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--separator);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: resourceSpin 0.8s linear infinite;
}

@keyframes resourceSpin {
  to { transform: rotate(360deg); }
}

/* ── Error ── */
.pf-resource-error {
  position: absolute;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: color-mix(in srgb, #ef4444 15%, var(--glass-bg));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: #ef4444;
  max-width: 90%;
  z-index: 30;
}

.pf-resource-error-close {
  background: none;
  border: none;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
  line-height: 1;
}

.pf-resource-error-close:hover { opacity: 1; }

/* ── Task Tree Section ── */
.pf-task-tree-section {
  flex-shrink: 0;
  border-top: 1px solid var(--separator);
  display: flex;
  flex-direction: column;
  max-height: 240px;
}

.pf-task-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.pf-task-tree-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pf-task-tree-badge-active {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  background: rgba(10, 132, 255, 0.1);
}

.pf-task-tree-body {
  overflow-y: auto;
  overflow-x: hidden;
  padding: 2px 8px 8px;
  flex: 1;
  min-height: 0;
}

.pf-task-tree-body::-webkit-scrollbar {
  width: 4px;
}

.pf-task-tree-body::-webkit-scrollbar-thumb {
  background: var(--text-quaternary);
  border-radius: 2px;
}

/* ── Task Node ── */
.pf-task-node {
  display: flex;
  flex-direction: column;
}

.pf-task-row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 4px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background 150ms ease;
}

.pf-task-row:hover {
  background: var(--track-bg-hover);
}

.pf-task-toggle {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 200ms var(--ease-out);
}

.pf-task-toggle.expanded {
  transform: rotate(90deg);
}

.pf-task-toggle-spacer {
  width: 14px;
  flex-shrink: 0;
}

/* ── Task Status Icon ── */
.pf-task-status-icon {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pf-task-status-icon.status-done {
  color: var(--accent);
}

.pf-task-status-icon.status-running {
  color: var(--accent);
}

.pf-task-status-icon.status-error {
  color: #ef4444;
}

.pf-task-status-icon.status-pending {
  color: var(--text-quaternary);
}

.pf-task-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-quaternary);
}

.pf-task-mini-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid rgba(10, 132, 255, 0.2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: taskSpin 0.7s linear infinite;
}

@keyframes taskSpin {
  to { transform: rotate(360deg); }
}

/* ── Task Label & Progress ── */
.pf-task-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-task-child-label {
  font-weight: 400;
  color: var(--text-secondary);
  font-size: 10px;
}

.pf-task-progress-text {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* ── Task Progress Bar (root level) ── */
.pf-task-progress-bar {
  height: 2px;
  margin: 0 4px 2px 22px;
  background: var(--separator-strong);
  border-radius: 1px;
  overflow: hidden;
}

.pf-task-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 1px;
  transition: width 300ms var(--ease-out);
}

/* ── Task Children ── */
.pf-task-children {
  padding-left: 18px;
  display: flex;
  flex-direction: column;
}
</style>
