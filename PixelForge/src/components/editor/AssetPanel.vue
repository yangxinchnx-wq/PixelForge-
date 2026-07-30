<script setup lang="ts">
import { computed, ref } from 'vue'

import { loadImages } from '@/assets/assetLoader'
import { assetToLayer, layerReferencesAsset } from '@/assets/assetToLayer'
import { useAssetStore } from '@/assets/assetStore'
import { useRuntimeStore } from '@/stores/runtime'

const assetStore = useAssetStore()
const runtime = useRuntimeStore()

const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)
const isLoading = ref(false)
const lastError = ref<string | null>(null)
const lastAddedAssetId = ref<string | null>(null)

const totalCount = computed(() => assetStore.totalCount)
const isEmpty = computed(() => assetStore.items.length === 0)

/** 格式化文件大�?*/
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 触发文件选择 */
function triggerFileInput() {
  fileInputRef.value?.click()
}

/** 文件选择回调 */
async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length === 0) return

  await importFiles(files)
  // 重置 input(允许重复选同一文件)
  input.value = ''
}

/** 拖拽进入 */
function onDragOver(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = true
}

/** 拖拽离开 */
function onDragLeave() {
  isDragOver.value = false
}

/** 拖拽放下 */
async function onDrop(event: DragEvent) {
  event.preventDefault()
  isDragOver.value = false
  const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
    f.type.startsWith('image/'),
  )
  if (files.length === 0) return
  await importFiles(files)
}

/** 批量导入文件 */
async function importFiles(files: File[]) {
  isLoading.value = true
  lastError.value = null
  try {
    const { assets, errors } = await loadImages(files)
    assetStore.addMany(assets)
    if (assets.length > 0) {
      lastAddedAssetId.value = assets[assets.length - 1].id
    }
    if (errors.length > 0) {
      lastError.value = `${errors.length} 个文件导入失�?${errors[0].error}`
    }
  } catch (e) {
    lastError.value = (e as Error).message
  } finally {
    isLoading.value = false
  }
}

/** �?Asset 添加�?Layer(添加到当�?RenderIR) */
function addAsLayer(assetId: string) {
  const asset = assetStore.getById(assetId)
  if (!asset) return

  const layer = assetToLayer(asset)
  // 直接 push �?currentIr.layers(�?immutable 替换以触发响应式)
  runtime.currentIr = {
    ...runtime.currentIr,
    layers: [...runtime.currentIr.layers, layer],
  }
  void runtime.renderCurrentIR()
}

/** 移除资源(同时移除引用该资源的 Layer) */
function removeAsset(assetId: string) {
  // 联动移除引用�?Asset �?Layer
  const layersToRemove = runtime.currentIr.layers.filter((l) =>
    layerReferencesAsset(l, assetId),
  )
  if (layersToRemove.length > 0) {
    runtime.currentIr = {
      ...runtime.currentIr,
      layers: runtime.currentIr.layers.filter((l) => !layerReferencesAsset(l, assetId)),
    }
    void runtime.renderCurrentIR()
  }
  assetStore.remove(assetId)
}

/** 检�?Asset 是否已作�?Layer 添加 */
function isAddedAsLayer(assetId: string): boolean {
  return runtime.currentIr.layers.some((l) => layerReferencesAsset(l, assetId))
}
</script>

<template>
  <div class="asset-panel">
    <div class="panel-head">
      <span class="head-title">资源</span>
      <span class="head-count">{{ totalCount }}</span>
    </div>

    <!-- 拖拽�?/ 上传按钮 -->
    <div
      class="dropzone"
      :class="{ active: isDragOver, loading: isLoading }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="triggerFileInput"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept="image/*"
        multiple
        class="file-input"
        @change="onFileChange"
      />
      <div class="dz-content">
        <span class="dz-icon">�?/span>
        <span class="dz-text">{{ isDragOver ? '释放以导�? : '拖入图片或点击选择' }}</span>
        <span class="dz-hint">支持 PNG / JPEG / WebP / GIF / BMP</span>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="lastError" class="error-banner">
      <span>{{ lastError }}</span>
    </div>

    <!-- 资源列表 -->
    <div class="asset-list" v-if="!isEmpty">
      <div
        v-for="asset in assetStore.items"
        :key="asset.id"
        class="asset-item"
        :class="{ added: isAddedAsLayer(asset.id), 'last-added': asset.id === lastAddedAssetId }"
      >
        <div class="thumb-wrap">
          <img
            v-if="asset.thumbnail"
            :src="asset.thumbnail"
            class="thumb"
            :alt="asset.name"
          />
          <div v-else class="thumb-placeholder">
            <img :src="asset.url" class="thumb" :alt="asset.name" />
          </div>
        </div>

        <div class="asset-info">
          <span class="asset-name" :title="asset.name">{{ asset.name }}</span>
          <div class="asset-meta">
            <span class="meta-dim">{{ asset.width }} × {{ asset.height }}</span>
            <span class="meta-size">{{ formatSize(asset.size) }}</span>
          </div>
        </div>

        <div class="asset-actions">
          <button
            class="action-btn primary"
            :data-tip="isAddedAsLayer(asset.id) ? '已添加到图层' : '添加到图�?"
            :disabled="isAddedAsLayer(asset.id)"
            @click.stop="addAsLayer(asset.id)"
          >
            {{ isAddedAsLayer(asset.id) ? '�? : '+' }}
          </button>
          <button
            class="action-btn danger"
            data-tip="删除资源"
            @click.stop="removeAsset(asset.id)"
          >×</button>
        </div>
      </div>
    </div>

    <!-- 空状�?-->
    <div v-else class="empty-state">
      <span class="empty-icon">🖼</span>
      <span class="empty-text">暂无资源</span>
      <span class="empty-hint">拖入图片或点击上方区域导�?/span>
    </div>
  </div>
</template>

<style scoped>
.asset-panel {
  background: var(--glass-bg);
  border: 1px solid var(--separator);
  border-radius: 0;
  padding: 10px 4px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
  flex-shrink: 0;
}
.head-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.head-count {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--glass-bg-hover);
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}

/* 拖拽�?*/
.dropzone {
  position: relative;
  border: 1.5px dashed var(--separator-strong);
  border-radius: var(--radius-md);
  padding: 18px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  background: var(--glass-bg-hover);
  flex-shrink: 0;
}
.dropzone:hover {
  border-color: var(--accent);
  background: rgba(10, 132, 255, 0.12);
}
.dropzone.active {
  border-color: var(--accent);
  background: rgba(10, 132, 255, 0.12);
  transform: scale(1.02);
}
.dropzone.loading {
  opacity: 0.6;
  pointer-events: none;
}
.file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.dz-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}
.dz-icon {
  font-size: 20px;
  color: var(--text-tertiary);
  line-height: 1;
}
.dz-text {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.dz-hint {
  font-size: 10px;
  color: var(--text-quaternary);
}

/* 错误提示 */
.error-banner {
  background: var(--toggle-mute));
  border: 1px solid var(--toggle-mute);
  border-radius: var(--radius-xs);
  padding: 6px 10px;
  font-size: 11px;
  color: var(--toggle-mute);
  flex-shrink: 0;
}

/* 资源列表 */
.asset-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.asset-list::-webkit-scrollbar { width: 4px; }
.asset-list::-webkit-scrollbar-thumb { background: var(--separator-strong); border-radius: 999px; }

.asset-item {
  display: grid;
  grid-template-columns: 56px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 6px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg-hover);
  border: 1px solid transparent;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.asset-item:hover {
  background: var(--track-bg);
  border-color: var(--separator);
}
.asset-item.added {
  background: rgba(10, 132, 255, 0.12);
}
.asset-item.last-added {
  animation: pulseHighlight 600ms ease-out;
}
@keyframes pulseHighlight {
  0%   { background: var(--accent); }
  100% { background: rgba(10, 132, 255, 0.12); }
}

.thumb-wrap {
  width: 56px;
  height: 42px;
  border-radius: var(--radius-xs);
  overflow: hidden;
  background: var(--track-bg);
  flex-shrink: 0;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.asset-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.asset-name {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.asset-meta {
  display: flex;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 9.5px;
  color: var(--text-tertiary);
}
.meta-dim, .meta-size { letter-spacing: 0.02em; }

.asset-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.action-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  border-radius: var(--radius-xs);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 160ms ease;
}
.action-btn:hover:not(:disabled) {
  border-color: var(--separator-strong);
  color: var(--text-primary);
  transform: scale(1.05);
}
.action-btn:active:not(:disabled) { transform: scale(0.95); }
.action-btn.primary { color: var(--accent); border-color: var(--accent); }
.action-btn.primary:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}
.action-btn.primary:disabled {
  background: rgba(10, 132, 255, 0.12);
  color: var(--accent);
  border-color: rgba(10, 132, 255, 0.12);
  cursor: default;
  opacity: 0.8;
}
.action-btn.danger:hover {
  background: var(--toggle-mute);
  border-color: var(--toggle-mute);
  color: #fff;
}

/* 空状�?*/
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 32px 12px;
  text-align: center;
  flex: 1;
}
.empty-icon { font-size: 28px; opacity: 0.4; }
.empty-text { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
.empty-hint { font-size: 10.5px; color: var(--text-quaternary); }

/* tooltip */
[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 5px);
  left: 50%;
  transform: translateX(-50%) scale(0.95);
  padding: 4px 8px;
  background: var(--text-primary);
  color: var(--base-bg);
  font-size: 10.5px;
  border-radius: 5px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) scale(1); }
</style>
