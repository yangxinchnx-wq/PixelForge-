<script setup lang="ts">
/**
 * Asset Genome 面板（Step 35.6 UI）— 完整的资产基因组浏览器。
 *
 * 功能模块:
 * 1. 资产注册表浏览器 — 列表/搜索/筛选/分类/CRUD
 * 2. 引用图查看器 — 出边(引用了谁) / 入边(被谁引用) / 添加引用
 * 3. 影响分析 — 下游影响集 / 上游依赖集 / 循环检测
 * 4. 内容哈希去重 — 计算哈希 / 检测重复 / 去重建议
 * 5. 懒加载状态 — 加载状态表 / 按需加载
 * 6. 资产打包导出/导入
 *
 * 数据源:
 *   useAssetRegistryStore — 资产注册表
 *   useReferenceGraphStore — 引用图
 *   impactAnalysis.ts — 影响分析纯函数
 *   contentHash.ts — 内容哈希纯函数
 *   lazyLoader.ts — 懒加载纯函数
 *   assetPackaging.ts — 打包导出/导入
 */
import { ref, computed, watch } from 'vue';
import { useAssetRegistryStore } from '../editor/asset-genome/assetRegistryStore';
import { useReferenceGraphStore } from '../editor/asset-genome/referenceGraphStore';
import {
  CATEGORY_DISPLAY_NAME,
  KIND_DISPLAY_NAME,
  ALL_ASSET_KINDS,
  ALL_ASSET_CATEGORIES,
  type AssetKind,
  type AssetCategory,
  type AssetRecord,
} from '../editor/asset-genome/assetRegistry';
import {
  getDownstreamImpact,
  getUpstreamDependencies,
} from '../editor/asset-genome/impactAnalysis';
import {
  computeContentHash,
  findDuplicates,
} from '../editor/asset-genome/contentHash';
import {
  createLoadStatusTable,
  markLoading,
  markLoaded,
  type LoadState,
} from '../editor/asset-genome/lazyLoader';
import {
  createPackage,
  serializePackage,
} from '../editor/asset-genome/assetPackaging';

const registry = useAssetRegistryStore();
const refGraph = useReferenceGraphStore();

// ─── 搜索与筛选 ───────────────────────────────────────
const searchQuery = ref('');
const filterCategory = ref<AssetCategory | 'all'>('all');
const filterKind = ref<AssetKind | 'all'>('all');

const filteredAssets = computed<AssetRecord[]>(() => {
  let list = registry.all;
  if (filterCategory.value !== 'all') {
    list = list.filter((a) => a.category === filterCategory.value);
  }
  if (filterKind.value !== 'all') {
    list = list.filter((a) => a.kind === filterKind.value);
  }
  if (searchQuery.value.trim()) {
    list = registry.search(searchQuery.value);
  }
  return list;
});

// ─── 选中的资产 ────────────────────────────────────────
const selectedAssetId = ref<string | null>(null);
const selectedAsset = computed<AssetRecord | undefined>(() =>
  selectedAssetId.value ? registry.getById(selectedAssetId.value) : undefined
);

// ─── 详情面板 Tab ──────────────────────────────────────
type DetailTab = 'info' | 'references' | 'impact' | 'dedup';
const activeTab = ref<DetailTab>('info');

// ─── 引用图数据 ────────────────────────────────────────
const outgoingRefs = computed(() =>
  selectedAssetId.value ? refGraph.refsOf(selectedAssetId.value) : []
);
const incomingRefs = computed(() =>
  selectedAssetId.value ? refGraph.refBy(selectedAssetId.value) : []
);

// ─── 影响分析 ──────────────────────────────────────────
const downstreamImpact = computed(() =>
  selectedAssetId.value
    ? getDownstreamImpact(refGraph.graph, selectedAssetId.value)
    : new Set<string>()
);
const upstreamDeps = computed(() =>
  selectedAssetId.value
    ? getUpstreamDependencies(refGraph.graph, selectedAssetId.value)
    : new Set<string>()
);
const cycles = computed(() => detectCycles(refGraph.graph));

// ─── 去重分析 ──────────────────────────────────────────
const duplicates = computed(() => findDuplicates(registry.all));
const hasDuplicates = computed(() => duplicates.value.length > 0);

// ─── 懒加载状态表 ──────────────────────────────────────
const loadStatusTable = ref(createLoadStatusTable());

function getAssetLoadState(assetId: string): LoadState {
  return getLoadState(loadStatusTable.value, assetId) ?? 'unloaded';
}

function simulateLoad(assetId: string) {
  loadStatusTable.value = markLoading(loadStatusTable.value, assetId, 1);
  setTimeout(() => {
    loadStatusTable.value = markLoaded(loadStatusTable.value, assetId);
  }, 800);
}

// ─── 添加资产 ──────────────────────────────────────────
const showAddDialog = ref(false);
const newAssetKind = ref<AssetKind>('image');
const newAssetName = ref('');

function addAsset() {
  if (!newAssetName.value.trim()) return;
  const record = registry.create({
    kind: newAssetKind.value,
    name: newAssetName.value.trim(),
    source: 'user',
    tags: [],
  });
  // 自动计算内容哈希
  const hash = computeContentHash({
    kind: record.kind,
    name: record.name,
    size: record.size,
    payloadRef: record.payloadRef,
    tags: record.tags,
  });
  registry.update(record.id, { contentHash: hash });
  // 自动标记为已加载
  loadStatusTable.value = markLoaded(loadStatusTable.value, record.id);
  selectedAssetId.value = record.id;
  showAddDialog.value = false;
  newAssetName.value = '';
}

// ─── 添加引用 ──────────────────────────────────────────
const showRefDialog = ref(false);
const refTargetId = ref<string>('');
const refType = ref<'uses' | 'extends' | 'embeds'>('uses');

function addReference() {
  if (!selectedAssetId.value || !refTargetId.value) return;
  if (selectedAssetId.value === refTargetId.value) return;
  refGraph.add(selectedAssetId.value, refTargetId.value, refType.value);
  showRefDialog.value = false;
  refTargetId.value = '';
}

// ─── 打包导出 ──────────────────────────────────────────
function exportPackage() {
  const pkg = createPackage(
    'PixelForge Asset Package',
    registry.all,
    refGraph.all
  );
  const json = serializePackage(pkg);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pixelforge_assets_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 资产名称查找 ──────────────────────────────────────
function getAssetName(id: string): string {
  return registry.getById(id)?.name ?? id;
}

// ─── 格式化 ───────────────────────────────────────────
function formatSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

// ─── 选中资产时自动切换到 info tab ─────────────────────
watch(selectedAssetId, () => {
  activeTab.value = 'info';
});

// ─── 初始化示例数据（首次打开时）────────────────────────
const hasInitialized = ref(false);
function initSampleData() {
  if (hasInitialized.value || registry.count > 0) return;
  hasInitialized.value = true;

  // 添加几个示例资产
  const bg = registry.create({ kind: 'image', name: '星空背景', source: 'builtin', tags: ['背景', '夜景'] });
  const tex = registry.create({ kind: 'texture', name: '噪声纹理', source: 'builtin', tags: ['噪声', '程序化'] });
  const mat = registry.create({ kind: 'material', name: '发光材质', source: 'user', tags: ['发光'] });
  const seq = registry.create({ kind: 'sequence', name: '主序列', source: 'user', tags: ['主'] });

  // 计算哈希
  for (const a of [bg, tex, mat, seq]) {
    const hash = computeContentHash({ kind: a.kind, name: a.name, tags: a.tags });
    registry.update(a.id, { contentHash: hash });
    loadStatusTable.value = markLoaded(loadStatusTable.value, a.id);
  }

  // 添加引用关系
  refGraph.add(mat.id, tex.id, 'uses', '材质使用纹理');
  refGraph.add(seq.id, bg.id, 'uses', '序列使用背景');
  refGraph.add(seq.id, mat.id, 'uses', '序列使用材质');
}
</script>

<template>
  <div class="pf-genome" @vue:mounted="initSampleData">
    <!-- ─── 顶部工具栏 ─── -->
    <div class="pf-genome-toolbar">
      <div class="pf-genome-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索资产..."
          class="pf-genome-search-input"
        />
      </div>

      <div class="pf-genome-filters">
        <select v-model="filterCategory" class="pf-genome-select">
          <option value="all">全部分类</option>
          <option v-for="cat in ALL_ASSET_CATEGORIES" :key="cat" :value="cat">
            {{ CATEGORY_DISPLAY_NAME[cat] }}
          </option>
        </select>
        <select v-model="filterKind" class="pf-genome-select">
          <option value="all">全部类型</option>
          <option v-for="kind in ALL_ASSET_KINDS" :key="kind" :value="kind">
            {{ KIND_DISPLAY_NAME[kind] }}
          </option>
        </select>
      </div>

      <div class="pf-genome-toolbar-actions">
        <button class="pf-genome-btn" title="添加资产" @click="showAddDialog = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          添加
        </button>
        <button class="pf-genome-btn" title="导出资产包" @click="exportPackage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          导出
        </button>
      </div>
    </div>

    <!-- ─── 统计栏 ─── -->
    <div class="pf-genome-stats">
      <div class="pf-genome-stat">
        <span class="pf-genome-stat-value">{{ registry.count }}</span>
        <span class="pf-genome-stat-label">总资产</span>
      </div>
      <div class="pf-genome-stat" v-for="cat in ALL_ASSET_CATEGORIES" :key="cat">
        <span class="pf-genome-stat-value">{{ registry.countByCategory[cat] }}</span>
        <span class="pf-genome-stat-label">{{ CATEGORY_DISPLAY_NAME[cat] }}</span>
      </div>
      <div class="pf-genome-stat">
        <span class="pf-genome-stat-value">{{ refGraph.count }}</span>
        <span class="pf-genome-stat-label">引用关系</span>
      </div>
      <div class="pf-genome-stat" :class="{ warning: hasDuplicates }">
        <span class="pf-genome-stat-value">{{ duplicates.length }}</span>
        <span class="pf-genome-stat-label">重复项</span>
      </div>
      <div class="pf-genome-stat" :class="{ warning: cycles.length > 0 }">
        <span class="pf-genome-stat-value">{{ cycles.length }}</span>
        <span class="pf-genome-stat-label">循环引用</span>
      </div>
    </div>

    <!-- ─── 主体: 左列表 + 右详情 ─── -->
    <div class="pf-genome-main">
      <!-- 左侧: 资产列表 -->
      <div class="pf-genome-list">
        <div v-if="filteredAssets.length === 0" class="pf-genome-empty">
          <p>暂无资产</p>
          <button class="pf-genome-btn primary" @click="showAddDialog = true">添加第一个资产</button>
        </div>
        <div
          v-for="asset in filteredAssets"
          :key="asset.id"
          class="pf-genome-asset-card"
          :class="{ selected: selectedAssetId === asset.id }"
          @click="selectedAssetId = asset.id"
        >
          <div class="pf-genome-asset-icon" :class="'kind-' + asset.kind">
            {{ KIND_DISPLAY_NAME[asset.kind].charAt(0) }}
          </div>
          <div class="pf-genome-asset-info">
            <div class="pf-genome-asset-name">{{ asset.name }}</div>
            <div class="pf-genome-asset-meta">
              <span class="pf-genome-asset-kind">{{ KIND_DISPLAY_NAME[asset.kind] }}</span>
              <span>·</span>
              <span>{{ CATEGORY_DISPLAY_NAME[asset.category] }}</span>
              <span>·</span>
              <span class="pf-genome-asset-load" :class="'state-' + getAssetLoadState(asset.id)">
                {{ getAssetLoadState(asset.id) }}
              </span>
            </div>
          </div>
          <div class="pf-genome-asset-degrees">
            <span title="出度(引用)" class="pf-genome-degree out">{{ refGraph.outDegree(asset.id) }}</span>
            <span title="入度(被引用)" class="pf-genome-degree in">{{ refGraph.inDegree(asset.id) }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧: 资产详情 -->
      <div class="pf-genome-detail">
        <div v-if="!selectedAsset" class="pf-genome-detail-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" opacity="0.2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          <p>选择左侧资产查看详情</p>
        </div>

        <template v-else>
          <!-- 详情头部 -->
          <div class="pf-genome-detail-header">
            <div class="pf-genome-detail-title">
              <span class="pf-genome-detail-icon" :class="'kind-' + selectedAsset.kind">
                {{ KIND_DISPLAY_NAME[selectedAsset.kind].charAt(0) }}
              </span>
              <div>
                <h3>{{ selectedAsset.name }}</h3>
                <span class="pf-genome-detail-id">{{ selectedAsset.id }}</span>
              </div>
            </div>
            <div class="pf-genome-detail-actions">
              <button
                v-if="getAssetLoadState(selectedAsset.id) !== 'loaded'"
                class="pf-genome-btn small"
                @click="simulateLoad(selectedAsset.id)"
              >加载</button>
              <button class="pf-genome-btn small danger" @click="registry.unregister(selectedAsset.id); selectedAssetId = null">删除</button>
            </div>
          </div>

          <!-- Tab 切换 -->
          <div class="pf-genome-tabs">
            <button
              v-for="tab in (['info', 'references', 'impact', 'dedup'] as DetailTab[])"
              :key="tab"
              class="pf-genome-tab"
              :class="{ active: activeTab === tab }"
              @click="activeTab = tab"
            >
              {{ { info: '信息', references: '引用', impact: '影响分析', dedup: '去重' }[tab] }}
            </button>
          </div>

          <!-- Tab 内容 -->
          <div class="pf-genome-tab-content">
            <!-- ─── Info Tab ─── -->
            <div v-if="activeTab === 'info'" class="pf-genome-info-grid">
              <div class="pf-genome-info-row">
                <label>类型</label>
                <span>{{ KIND_DISPLAY_NAME[selectedAsset.kind] }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>分类</label>
                <span>{{ CATEGORY_DISPLAY_NAME[selectedAsset.category] }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>来源</label>
                <span>{{ { builtin: '内置', user: '用户', imported: '导入' }[selectedAsset.source] }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>版本</label>
                <span>v{{ selectedAsset.version }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>大小</label>
                <span>{{ formatSize(selectedAsset.size) }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>内容哈希</label>
                <span class="pf-genome-hash">{{ selectedAsset.contentHash ?? '未计算' }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>创建时间</label>
                <span>{{ formatTime(selectedAsset.createdAt) }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>更新时间</label>
                <span>{{ formatTime(selectedAsset.updatedAt) }}</span>
              </div>
              <div class="pf-genome-info-row" v-if="selectedAsset.tags.length > 0">
                <label>标签</label>
                <div class="pf-genome-tags">
                  <span v-for="tag in selectedAsset.tags" :key="tag" class="pf-genome-tag">{{ tag }}</span>
                </div>
              </div>
              <div class="pf-genome-info-row" v-if="selectedAsset.description">
                <label>描述</label>
                <span>{{ selectedAsset.description }}</span>
              </div>
              <div class="pf-genome-info-row">
                <label>加载状态</label>
                <span class="pf-genome-load-state" :class="'state-' + getAssetLoadState(selectedAsset.id)">
                  {{ getAssetLoadState(selectedAsset.id) }}
                </span>
              </div>
            </div>

            <!-- ─── References Tab ─── -->
            <div v-if="activeTab === 'references'" class="pf-genome-refs">
              <div class="pf-genome-refs-section">
                <div class="pf-genome-refs-header">
                  <h4>引用了 ({{ outgoingRefs.length }})</h4>
                  <button class="pf-genome-btn small" @click="showRefDialog = true">+ 添加引用</button>
                </div>
                <div v-if="outgoingRefs.length === 0" class="pf-genome-refs-empty">无出边引用</div>
                <div v-for="ref in outgoingRefs" :key="ref.id" class="pf-genome-ref-item">
                  <span class="pf-genome-ref-arrow">→</span>
                  <span class="pf-genome-ref-name">{{ getAssetName(ref.targetId) }}</span>
                  <span class="pf-genome-ref-type" :class="'type-' + ref.type">{{ ref.type }}</span>
                  <button class="pf-genome-ref-remove" @click="refGraph.remove(ref.id)">×</button>
                </div>
              </div>

              <div class="pf-genome-refs-section">
                <h4>被引用 ({{ incomingRefs.length }})</h4>
                <div v-if="incomingRefs.length === 0" class="pf-genome-refs-empty">无入边引用</div>
                <div v-for="ref in incomingRefs" :key="ref.id" class="pf-genome-ref-item">
                  <span class="pf-genome-ref-arrow">←</span>
                  <span class="pf-genome-ref-name">{{ getAssetName(ref.sourceId) }}</span>
                  <span class="pf-genome-ref-type" :class="'type-' + ref.type">{{ ref.type }}</span>
                </div>
              </div>
            </div>

            <!-- ─── Impact Tab ─── -->
            <div v-if="activeTab === 'impact'" class="pf-genome-impact">
              <div class="pf-genome-impact-section">
                <h4>下游影响（修改此资产会影响）</h4>
                <div v-if="downstreamImpact.size === 0" class="pf-genome-refs-empty">无下游影响</div>
                <div v-for="id in downstreamImpact" :key="id" class="pf-genome-impact-item warning">
                  <span class="pf-genome-ref-arrow">⚠</span>
                  <span>{{ getAssetName(id) }}</span>
                </div>
              </div>

              <div class="pf-genome-impact-section">
                <h4>上游依赖（此资产依赖）</h4>
                <div v-if="upstreamDeps.size === 0" class="pf-genome-refs-empty">无上游依赖</div>
                <div v-for="id in upstreamDeps" :key="id" class="pf-genome-impact-item">
                  <span class="pf-genome-ref-arrow">↑</span>
                  <span>{{ getAssetName(id) }}</span>
                </div>
              </div>

              <div v-if="cycles.length > 0" class="pf-genome-impact-section">
                <h4 class="danger">循环引用检测 ({{ cycles.length }})</h4>
                <div v-for="(cycle, i) in cycles" :key="i" class="pf-genome-cycle-item">
                  <span>循环 {{ i + 1 }}:</span>
                  <span v-for="id in cycle" :key="id" class="pf-genome-cycle-node">{{ getAssetName(id) }}</span>
                </div>
              </div>
            </div>

            <!-- ─── Dedup Tab ─── -->
            <div v-if="activeTab === 'dedup'" class="pf-genome-dedup">
              <div v-if="!hasDuplicates" class="pf-genome-refs-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32" style="opacity: 0.3; margin-bottom: 8px;">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <p>未检测到重复资产</p>
              </div>
              <template v-else>
                <div v-for="dup in duplicates" :key="dup.hash" class="pf-genome-dup-group">
                  <div class="pf-genome-dup-header">
                    <span class="pf-genome-dup-hash">{{ dup.hash }}</span>
                    <span class="pf-genome-dup-count">{{ dup.assets.length }} 个重复</span>
                  </div>
                  <div v-for="asset in dup.assets" :key="asset.id" class="pf-genome-dup-item">
                    <span>{{ asset.name }}</span>
                    <span class="pf-genome-dup-meta">{{ KIND_DISPLAY_NAME[asset.kind] }} · {{ formatTime(asset.createdAt) }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- ─── 添加资产对话框 ─── -->
    <Teleport to="body">
      <div v-if="showAddDialog" class="pf-genome-dialog-overlay" @click.self="showAddDialog = false">
        <div class="pf-genome-dialog">
          <h3>添加资产</h3>
          <div class="pf-genome-dialog-body">
            <div class="pf-genome-dialog-row">
              <label>名称</label>
              <input v-model="newAssetName" type="text" placeholder="资产名称" class="pf-genome-input" @keyup.enter="addAsset" />
            </div>
            <div class="pf-genome-dialog-row">
              <label>类型</label>
              <select v-model="newAssetKind" class="pf-genome-select">
                <option v-for="kind in ALL_ASSET_KINDS" :key="kind" :value="kind">
                  {{ KIND_DISPLAY_NAME[kind] }}
                </option>
              </select>
            </div>
          </div>
          <div class="pf-genome-dialog-actions">
            <button class="pf-genome-btn" @click="showAddDialog = false">取消</button>
            <button class="pf-genome-btn primary" @click="addAsset" :disabled="!newAssetName.trim()">确认添加</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ─── 添加引用对话框 ─── -->
    <Teleport to="body">
      <div v-if="showRefDialog" class="pf-genome-dialog-overlay" @click.self="showRefDialog = false">
        <div class="pf-genome-dialog">
          <h3>添加引用</h3>
          <div class="pf-genome-dialog-body">
            <div class="pf-genome-dialog-row">
              <label>源资产</label>
              <span>{{ selectedAsset?.name }}</span>
            </div>
            <div class="pf-genome-dialog-row">
              <label>目标资产</label>
              <select v-model="refTargetId" class="pf-genome-select">
                <option value="">选择目标...</option>
                <option
                  v-for="asset in registry.all.filter(a => a.id !== selectedAssetId)"
                  :key="asset.id"
                  :value="asset.id"
                >
                  {{ asset.name }} ({{ KIND_DISPLAY_NAME[asset.kind] }})
                </option>
              </select>
            </div>
            <div class="pf-genome-dialog-row">
              <label>引用类型</label>
              <select v-model="refType" class="pf-genome-select">
                <option value="uses">使用 (uses)</option>
                <option value="extends">继承 (extends)</option>
                <option value="embeds">嵌入 (embeds)</option>
              </select>
            </div>
          </div>
          <div class="pf-genome-dialog-actions">
            <button class="pf-genome-btn" @click="showRefDialog = false">取消</button>
            <button class="pf-genome-btn primary" @click="addReference" :disabled="!refTargetId">确认</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pf-genome {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 0;
}

/* ── Toolbar ── */
.pf-genome-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
}

.pf-genome-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  height: 32px;
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 8px;
  color: var(--text-tertiary, #666);
}

.pf-genome-search-input {
  border: none;
  background: transparent;
  outline: none;
  color: var(--text-primary, #fff);
  font: inherit;
  font-size: 12px;
  width: 160px;
}

.pf-genome-filters {
  display: flex;
  gap: 6px;
}

.pf-genome-select {
  height: 32px;
  padding: 0 8px;
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 8px;
  color: var(--text-secondary, #aaa);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

.pf-genome-toolbar-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.pf-genome-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--separator-strong, #3a3a3a);
  background: transparent;
  border-radius: 8px;
  color: var(--text-secondary, #aaa);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 160ms ease;
}

.pf-genome-btn:hover {
  border-color: var(--text-quaternary, #555);
  color: var(--text-primary, #fff);
}

.pf-genome-btn.primary {
  background: var(--accent, #4a9eff);
  border-color: var(--accent, #4a9eff);
  color: #fff;
}

.pf-genome-btn.primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pf-genome-btn.small {
  height: 26px;
  padding: 0 8px;
  font-size: 11px;
}

.pf-genome-btn.danger:hover {
  border-color: #ef4444;
  color: #ef4444;
}

/* ── Stats ── */
.pf-genome-stats {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
}

.pf-genome-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.pf-genome-stat-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #fff);
  font-variant-numeric: tabular-nums;
}

.pf-genome-stat-label {
  font-size: 10px;
  color: var(--text-tertiary, #666);
}

.pf-genome-stat.warning .pf-genome-stat-value {
  color: #eab308;
}

/* ── Main ── */
.pf-genome-main {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* ── List ── */
.pf-genome-list {
  width: 280px;
  border-right: 1px solid var(--separator, #2a2a2a);
  overflow-y: auto;
  padding: 8px;
  flex-shrink: 0;
}

.pf-genome-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-tertiary, #666);
}

.pf-genome-asset-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 160ms ease;
  margin-bottom: 4px;
}

.pf-genome-asset-card:hover {
  background: var(--surface-hover, #252525);
}

.pf-genome-asset-card.selected {
  background: color-mix(in srgb, var(--accent, #4a9eff) 15%, transparent);
  outline: 1px solid var(--accent, #4a9eff);
}

.pf-genome-asset-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--surface-soft, #2a2a2a);
  color: var(--text-secondary, #aaa);
}

.pf-genome-asset-info {
  flex: 1;
  min-width: 0;
}

.pf-genome-asset-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #fff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pf-genome-asset-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-tertiary, #666);
  margin-top: 2px;
}

.pf-genome-asset-load {
  text-transform: uppercase;
  font-weight: 600;
}

.pf-genome-asset-load.state-loaded { color: #22c55e; }
.pf-genome-asset-load.state-loading { color: #eab308; }
.pf-genome-asset-load.state-error { color: #ef4444; }
.pf-genome-asset-load.state-unloaded { color: var(--text-quaternary, #555); }

.pf-genome-asset-degrees {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.pf-genome-degree {
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 1px 4px;
  border-radius: 4px;
}

.pf-genome-degree.out { color: var(--accent, #4a9eff); }
.pf-genome-degree.in { color: #22c55e; }

/* ── Detail ── */
.pf-genome-detail {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}

.pf-genome-detail-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--text-tertiary, #666);
  font-size: 13px;
}

.pf-genome-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--separator, #2a2a2a);
}

.pf-genome-detail-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pf-genome-detail-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  background: var(--surface-soft, #2a2a2a);
  color: var(--text-secondary, #aaa);
}

.pf-genome-detail-title h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.pf-genome-detail-id {
  font-size: 10px;
  color: var(--text-quaternary, #555);
  font-family: 'JetBrains Mono', monospace;
}

.pf-genome-detail-actions {
  display: flex;
  gap: 6px;
}

/* ── Tabs ── */
.pf-genome-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--separator, #2a2a2a);
  padding: 0 16px;
}

.pf-genome-tab {
  padding: 8px 12px;
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary, #666);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 160ms ease;
}

.pf-genome-tab:hover {
  color: var(--text-primary, #fff);
}

.pf-genome-tab.active {
  color: var(--accent, #4a9eff);
  border-bottom-color: var(--accent, #4a9eff);
}

/* ── Tab Content ── */
.pf-genome-tab-content {
  padding: 14px 16px;
}

/* ── Info Grid ── */
.pf-genome-info-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-genome-info-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.pf-genome-info-row label {
  width: 80px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary, #666);
  flex-shrink: 0;
  padding-top: 1px;
}

.pf-genome-info-row span {
  font-size: 12px;
  color: var(--text-secondary, #aaa);
  word-break: break-all;
}

.pf-genome-hash {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-quaternary, #555);
}

.pf-genome-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pf-genome-tag {
  padding: 2px 8px;
  background: var(--surface-soft, #2a2a2a);
  border-radius: 4px;
  font-size: 10px;
  color: var(--text-secondary, #aaa);
}

.pf-genome-load-state {
  text-transform: uppercase;
  font-weight: 600;
  font-size: 11px;
}

.pf-genome-load-state.state-loaded { color: #22c55e; }
.pf-genome-load-state.state-loading { color: #eab308; }
.pf-genome-load-state.state-error { color: #ef4444; }
.pf-genome-load-state.state-unloaded { color: var(--text-quaternary, #555); }

/* ── References ── */
.pf-genome-refs {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pf-genome-refs-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pf-genome-refs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pf-genome-refs-header h4,
.pf-genome-refs-section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #aaa);
}

.pf-genome-refs-empty {
  font-size: 12px;
  color: var(--text-quaternary, #555);
  padding: 8px 0;
}

.pf-genome-ref-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-soft, #1e1e1e);
  border-radius: 6px;
  font-size: 12px;
}

.pf-genome-ref-arrow {
  color: var(--text-tertiary, #666);
  font-weight: 600;
}

.pf-genome-ref-name {
  flex: 1;
  color: var(--text-primary, #fff);
  font-weight: 500;
}

.pf-genome-ref-type {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.pf-genome-ref-type.type-uses { background: color-mix(in srgb, #4a9eff 20%, transparent); color: #4a9eff; }
.pf-genome-ref-type.type-extends { background: color-mix(in srgb, #a855f7 20%, transparent); color: #a855f7; }
.pf-genome-ref-type.type-embeds { background: color-mix(in srgb, #22c55e 20%, transparent); color: #22c55e; }

.pf-genome-ref-remove {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--text-tertiary, #666);
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.pf-genome-ref-remove:hover {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  color: #ef4444;
}

/* ── Impact ── */
.pf-genome-impact {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pf-genome-impact-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pf-genome-impact-section h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #aaa);
}

.pf-genome-impact-section h4.danger {
  color: #ef4444;
}

.pf-genome-impact-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-soft, #1e1e1e);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary, #fff);
}

.pf-genome-impact-item.warning {
  border-left: 3px solid #eab308;
}

.pf-genome-cycle-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: color-mix(in srgb, #ef4444 10%, transparent);
  border-radius: 6px;
  font-size: 12px;
  color: #ef4444;
  flex-wrap: wrap;
}

.pf-genome-cycle-node {
  background: color-mix(in srgb, #ef4444 20%, transparent);
  padding: 2px 6px;
  border-radius: 4px;
}

/* ── Dedup ── */
.pf-genome-dedup {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pf-genome-dup-group {
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 8px;
  overflow: hidden;
}

.pf-genome-dup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: color-mix(in srgb, #eab308 10%, transparent);
  border-bottom: 1px solid var(--separator, #2a2a2a);
}

.pf-genome-dup-hash {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #eab308;
}

.pf-genome-dup-count {
  font-size: 11px;
  font-weight: 600;
  color: #eab308;
}

.pf-genome-dup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary, #fff);
  border-bottom: 1px solid var(--separator, #2a2a2a);
}

.pf-genome-dup-item:last-child {
  border-bottom: none;
}

.pf-genome-dup-meta {
  font-size: 10px;
  color: var(--text-tertiary, #666);
}

/* ── Dialog ── */
.pf-genome-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.pf-genome-dialog {
  width: 400px;
  max-width: 90vw;
  background: var(--surface, #1a1a1a);
  border: 1px solid var(--separator-strong, #3a3a3a);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.pf-genome-dialog h3 {
  margin: 0 0 16px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.pf-genome-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pf-genome-dialog-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pf-genome-dialog-row label {
  width: 60px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary, #666);
  flex-shrink: 0;
}

.pf-genome-input {
  flex: 1;
  height: 32px;
  padding: 0 10px;
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 8px;
  color: var(--text-primary, #fff);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.pf-genome-input:focus {
  border-color: var(--accent, #4a9eff);
}

.pf-genome-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* ── Kind colors ── */
.kind-image { background: color-mix(in srgb, #3b82f6 20%, var(--surface-soft, #2a2a2a)); color: #60a5fa; }
.kind-texture { background: color-mix(in srgb, #8b5cf6 20%, var(--surface-soft, #2a2a2a)); color: #a78bfa; }
.kind-audio { background: color-mix(in srgb, #ec4899 20%, var(--surface-soft, #2a2a2a)); color: #f472b6; }
.kind-video { background: color-mix(in srgb, #ef4444 20%, var(--surface-soft, #2a2a2a)); color: #f87171; }
.kind-material { background: color-mix(in srgb, #14b8a6 20%, var(--surface-soft, #2a2a2a)); color: #2dd4bf; }
.kind-shader { background: color-mix(in srgb, #f59e0b 20%, var(--surface-soft, #2a2a2a)); color: #fbbf24; }
.kind-graph { background: color-mix(in srgb, #6366f1 20%, var(--surface-soft, #2a2a2a)); color: #818cf8; }
.kind-sequence { background: color-mix(in srgb, #22c55e 20%, var(--surface-soft, #2a2a2a)); color: #4ade80; }
.kind-template { background: color-mix(in srgb, #06b6d4 20%, var(--surface-soft, #2a2a2a)); color: #22d3ee; }
.kind-clip { background: color-mix(in srgb, #a855f7 20%, var(--surface-soft, #2a2a2a)); color: #c084fc; }
.kind-effectChain { background: color-mix(in srgb, #eab308 20%, var(--surface-soft, #2a2a2a)); color: #facc15; }
.kind-animation { background: color-mix(in srgb, #f97316 20%, var(--surface-soft, #2a2a2a)); color: #fb923c; }
.kind-renderConfig { background: color-mix(in srgb, #64748b 20%, var(--surface-soft, #2a2a2a)); color: #94a3b8; }
.kind-preset { background: color-mix(in srgb, #78716c 20%, var(--surface-soft, #2a2a2a)); color: #a8a29e; }
</style>
