<script setup lang="ts">
/**
 * ProTimelineAssetBrowser(Step 35.6)— 资产浏览器面板。
 *
 * 功能:
 * - 资产列表(按大类分组:媒体 / 着色器 / 场景 / 配置)
 * - 搜索框(名称 + 标签 + 描述,大小写不敏感)
 * - 标签筛选
 * - 资产详情(选中后显示元数据)
 * - 引用关系展示(出边 + 入边数量)
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 中文文字标签,JetBrains Mono 用于数字
 */
import { ref, computed } from 'vue'

import { useAssetRegistryStore } from '@/editor/asset-genome/assetRegistryStore'
import { useReferenceGraphStore } from '@/editor/asset-genome/referenceGraphStore'
import {
  type AssetCategory,
  CATEGORY_DISPLAY_NAME,
  KIND_DISPLAY_NAME,
  ALL_ASSET_CATEGORIES,
} from '@/editor/asset-genome/assetRegistry'

const assetStore = useAssetRegistryStore()
const refStore = useReferenceGraphStore()

const visible = ref(false)
const searchQuery = ref('')
const selectedId = ref<string | null>(null)
const filterCategory = ref<AssetCategory | 'all'>('all')

/** 按搜索 + 大类筛选后的资产列表 */
const filteredAssets = computed(() => {
  let list = assetStore.all
  if (filterCategory.value !== 'all') {
    list = list.filter((a) => a.category === filterCategory.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter((a) => {
      const nameMatch = a.name.toLowerCase().includes(q)
      const descMatch = a.description?.toLowerCase().includes(q) ?? false
      const tagMatch = a.tags.some((t) => t.toLowerCase().includes(q))
      return nameMatch || descMatch || tagMatch
    })
  }
  return list
})

/** 按大类分组 */
const groupedAssets = computed(() => {
  const groups: Record<AssetCategory, typeof filteredAssets.value> = {
    media: [],
    shader: [],
    scene: [],
    config: [],
  }
  for (const asset of filteredAssets.value) {
    groups[asset.category].push(asset)
  }
  return groups
})

/** 选中的资产详情 */
const selectedAsset = computed(() => {
  if (!selectedId.value) return null
  return assetStore.getById(selectedId.value) ?? null
})

/** 选中资产的出边引用数 */
const selectedOutDegree = computed(() => {
  if (!selectedId.value) return 0
  return refStore.outDegree(selectedId.value)
})

/** 选中资产的入边引用数 */
const selectedInDegree = computed(() => {
  if (!selectedId.value) return 0
  return refStore.inDegree(selectedId.value)
})

/** 全部标签 */
const allTags = computed(() => {
  const set = new Set<string>()
  for (const asset of assetStore.all) {
    for (const tag of asset.tags) set.add(tag)
  }
  return Array.from(set).sort()
})

function toggle() {
  visible.value = !visible.value
}

function close() {
  visible.value = false
}

function selectAsset(id: string) {
  selectedId.value = id
}

function clearSelection() {
  selectedId.value = null
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 格式化文件大小 */
function formatSize(size?: number): string {
  if (size === undefined) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <div class="ab-panel">
    <button class="ab-btn" @click="toggle">资产浏览器</button>

    <Transition name="ab-modal">
      <div v-if="visible" class="ab-modal" @click.self="close">
        <div class="ab-modal-inner">
          <!-- 头部 -->
          <div class="ab-header">
            <span class="ab-title">资产浏览器</span>
            <div class="ab-header-info">
              <span class="ab-count">{{ assetStore.count }} 个资产</span>
              <button class="ab-close" @click="close">关闭</button>
            </div>
          </div>

          <div class="ab-content">
            <!-- 搜索 + 筛选 -->
            <div class="ab-toolbar">
              <input
                v-model="searchQuery"
                type="text"
                class="ab-search"
                placeholder="搜索名称 / 标签 / 描述..."
              />
              <select v-model="filterCategory" class="ab-filter">
                <option value="all">全部分类</option>
                <option v-for="cat in ALL_ASSET_CATEGORIES" :key="cat" :value="cat">
                  {{ CATEGORY_DISPLAY_NAME[cat] }}({{ assetStore.countByCategory[cat] }})
                </option>
              </select>
            </div>

            <!-- 标签栏 -->
            <div v-if="allTags.length > 0" class="ab-tags">
              <span
                v-for="tag in allTags.slice(0, 10)"
                :key="tag"
                class="ab-tag-chip"
                @click="searchQuery = tag"
              >{{ tag }}</span>
            </div>

            <div class="ab-main">
              <!-- 资产列表 -->
              <div class="ab-list">
                <div v-if="filteredAssets.length === 0" class="ab-empty">
                  无匹配资产
                </div>
                <div v-else>
                  <div
                    v-for="cat in ALL_ASSET_CATEGORIES"
                    :key="cat"
                    class="ab-group"
                  >
                    <div v-if="groupedAssets[cat].length > 0" class="ab-group-header">
                      {{ CATEGORY_DISPLAY_NAME[cat] }}({{ groupedAssets[cat].length }})
                    </div>
                    <div
                      v-for="asset in groupedAssets[cat]"
                      :key="asset.id"
                      class="ab-item"
                      :class="{ selected: asset.id === selectedId }"
                      @click="selectAsset(asset.id)"
                    >
                      <div class="ab-item-thumb">
                        <img v-if="asset.thumbnail" :src="asset.thumbnail" alt="" />
                        <span v-else class="ab-item-kind">{{ KIND_DISPLAY_NAME[asset.kind] }}</span>
                      </div>
                      <div class="ab-item-info">
                        <div class="ab-item-name">{{ asset.name }}</div>
                        <div class="ab-item-meta">
                          <span class="ab-item-kind-label">{{ KIND_DISPLAY_NAME[asset.kind] }}</span>
                          <span v-if="asset.version > 1" class="ab-item-version">v{{ asset.version }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 详情面板 -->
              <div class="ab-detail">
                <div v-if="!selectedAsset" class="ab-detail-empty">
                  选择一个资产查看详情
                </div>
                <div v-else class="ab-detail-content">
                  <div class="ab-detail-header">
                    <span class="ab-detail-name">{{ selectedAsset.name }}</span>
                    <button class="ab-detail-close" @click="clearSelection">×</button>
                  </div>

                  <!-- 缩略图 -->
                  <div v-if="selectedAsset.thumbnail" class="ab-detail-thumb">
                    <img :src="selectedAsset.thumbnail" alt="" />
                  </div>

                  <!-- 元数据 -->
                  <div class="ab-detail-meta">
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">ID</span>
                      <span class="ab-meta-value ab-mono">{{ selectedAsset.id }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">种类</span>
                      <span class="ab-meta-value">{{ KIND_DISPLAY_NAME[selectedAsset.kind] }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">大类</span>
                      <span class="ab-meta-value">{{ CATEGORY_DISPLAY_NAME[selectedAsset.category] }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">来源</span>
                      <span class="ab-meta-value">{{ selectedAsset.source }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">版本</span>
                      <span class="ab-meta-value ab-mono">v{{ selectedAsset.version }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">大小</span>
                      <span class="ab-meta-value ab-mono">{{ formatSize(selectedAsset.size) }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">创建</span>
                      <span class="ab-meta-value ab-mono">{{ formatTime(selectedAsset.createdAt) }}</span>
                    </div>
                    <div class="ab-meta-row">
                      <span class="ab-meta-label">更新</span>
                      <span class="ab-meta-value ab-mono">{{ formatTime(selectedAsset.updatedAt) }}</span>
                    </div>
                  </div>

                  <!-- 标签 -->
                  <div v-if="selectedAsset.tags.length > 0" class="ab-detail-tags">
                    <span
                      v-for="tag in selectedAsset.tags"
                      :key="tag"
                      class="ab-tag-chip"
                    >{{ tag }}</span>
                  </div>

                  <!-- 引用关系 -->
                  <div class="ab-detail-refs">
                    <div class="ab-ref-row">
                      <span class="ab-ref-label">引用(出边)</span>
                      <span class="ab-ref-value ab-mono">{{ selectedOutDegree }}</span>
                    </div>
                    <div class="ab-ref-row">
                      <span class="ab-ref-label">被引用(入边)</span>
                      <span class="ab-ref-value ab-mono">{{ selectedInDegree }}</span>
                    </div>
                  </div>

                  <!-- 描述 -->
                  <div v-if="selectedAsset.description" class="ab-detail-desc">
                    <div class="ab-desc-label">描述</div>
                    <div class="ab-desc-text">{{ selectedAsset.description }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ab-panel {
  position: relative;
  display: inline-block;
}

.ab-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ab-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.ab-modal {
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

.ab-modal-inner {
  width: 900px;
  max-width: 95vw;
  max-height: 85vh;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line-strong);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ab-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.ab-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.ab-header-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ab-count {
  font-size: 12px;
  color: var(--pf-ink-faint);
}
.ab-close {
  padding: 2px 10px;
  font-size: 12px;
  color: var(--pf-ink-muted);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ab-close:hover {
  color: var(--pf-ink);
  border-color: var(--pf-ink-muted);
}

.ab-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ab-toolbar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--pf-line);
}
.ab-search {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-bg, var(--pf-surface));
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  outline: none;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ab-search:focus {
  border-color: var(--pf-accent);
}
.ab-filter {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-bg, var(--pf-surface));
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  font-family: 'JetBrains Mono', monospace;
}

.ab-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 16px 8px;
}
.ab-tag-chip {
  padding: 2px 8px;
  font-size: 10px;
  color: var(--pf-accent);
  background: var(--pf-bg, var(--pf-surface));
  border: 1px solid var(--pf-line);
  border-radius: 10px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ab-tag-chip:hover {
  border-color: var(--pf-accent);
  background: var(--pf-accent);
  color: white;
}

.ab-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.ab-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  border-right: 1px solid var(--pf-line);
}

.ab-empty {
  text-align: center;
  color: var(--pf-ink-faint);
  font-size: 13px;
  padding: 32px;
}

.ab-group {
  margin-bottom: 8px;
}
.ab-group-header {
  font-size: 11px;
  font-weight: 600;
  color: var(--pf-ink-faint);
  padding: 4px 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ab-item:hover {
  background: var(--pf-bg, rgba(0, 0, 0, 0.05));
}
.ab-item.selected {
  background: var(--pf-accent);
}
.ab-item.selected .ab-item-name,
.ab-item.selected .ab-item-kind-label,
.ab-item.selected .ab-item-version {
  color: white;
}

.ab-item-thumb {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pf-bg, rgba(0, 0, 0, 0.1));
  flex-shrink: 0;
}
.ab-item-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ab-item-kind {
  font-size: 9px;
  color: var(--pf-ink-faint);
}

.ab-item-info {
  flex: 1;
  min-width: 0;
}
.ab-item-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--pf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ab-item-meta {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.ab-item-kind-label {
  font-size: 10px;
  color: var(--pf-ink-faint);
}
.ab-item-version {
  font-size: 10px;
  color: var(--pf-accent);
  font-family: 'JetBrains Mono', monospace;
}

.ab-detail {
  width: 280px;
  overflow-y: auto;
  padding: 12px;
}
.ab-detail-empty {
  text-align: center;
  color: var(--pf-ink-faint);
  font-size: 13px;
  padding: 32px 8px;
}
.ab-detail-content {
  font-size: 12px;
}
.ab-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.ab-detail-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.ab-detail-close {
  width: 20px;
  height: 20px;
  font-size: 16px;
  color: var(--pf-ink-faint);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.ab-detail-close:hover {
  color: var(--pf-ink);
}

.ab-detail-thumb {
  width: 100%;
  height: 120px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
  background: var(--pf-bg, rgba(0, 0, 0, 0.1));
}
.ab-detail-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ab-detail-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.ab-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}
.ab-meta-label {
  font-size: 11px;
  color: var(--pf-ink-faint);
}
.ab-meta-value {
  font-size: 11px;
  color: var(--pf-ink);
}
.ab-mono {
  font-family: 'JetBrains Mono', monospace;
}

.ab-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.ab-detail-refs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--pf-bg, rgba(0, 0, 0, 0.05));
  border-radius: 4px;
  margin-bottom: 8px;
}
.ab-ref-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ab-ref-label {
  font-size: 11px;
  color: var(--pf-ink-faint);
}
.ab-ref-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-accent);
}

.ab-detail-desc {
  margin-top: 8px;
}
.ab-desc-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--pf-ink-faint);
  margin-bottom: 4px;
}
.ab-desc-text {
  font-size: 11px;
  color: var(--pf-ink);
  line-height: 1.5;
}
</style>
