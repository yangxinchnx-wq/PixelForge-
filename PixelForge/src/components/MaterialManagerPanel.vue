<script setup lang="ts">
/**
 * MaterialManagerPanel — 材质管理面板。
 *
 * 功能模块:
 * 1. 材质列表 — 网格卡片视图，搜索/筛选/排序
 * 2. 创建材质 — 从预设创建或创建空白材质
 * 3. 材质详情 — 查看/编辑 PBR 参数、元数据
 * 4. 材质导出 — .pfmat / .gltf / .mtl 三种格式
 * 5. 材质导入 — 拖拽或点击导入，支持多格式自动检测
 *
 * 数据源: useMaterialAssetStore (Pinia)
 */
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useMaterialAssetStore } from '../material/materialAssetStore';
import { useRuntimeStore } from '../stores/runtime';
import { useAppStore } from '../stores/app';
import {
  MATERIAL_EXPORT_FORMATS,
  type MaterialExportFormat,
  type MaterialCategory,
  type MaterialAsset,
} from '../material/materialAsset';
import { listPresetKeys, getPreset } from '../material/materialPresets';

// ─── Store ─────────────────────────────────────────────
const store = useMaterialAssetStore();
const runtimeStore = useRuntimeStore();
const appStore = useAppStore();
const {
  assets,
  filteredAssets,
  selectedAsset,
  selectedAssetId,
  searchQuery,
  filterCategory,
  sortBy,
  sortOrder,
  assetCount,
} = storeToRefs(store);

// ─── 本地状态 ──────────────────────────────────────────
const fileInputRef = ref<HTMLInputElement | null>(null);
const isDragOver = ref(false);
const isImporting = ref(false);
const importMessage = ref<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
const showCreateMenu = ref(false);
const showExportMenu = ref<string | null>(null); // 导出菜单关联的材质 ID
const editingName = ref<string | null>(null);
const tempName = ref('');
const detailTab = ref<'info' | 'pbr' | 'graph'>('info');

// ─── 应用材质到当前图层 ───────────────────────────────────
function applyMaterialToCurrentLayer(materialId: string) {
  const ir = runtimeStore.currentIr;
  if (!ir || ir.layers.length === 0) {
    console.warn('[MaterialManager] 无法应用材质：当前 IR 为空或没有图层');
    return;
  }

  // 找到当前选中的图层（或第一个可见图层）
  const targetLayer = ir.layers.find((l) => l.id === runtimeStore.currentLayerId)
    ?? ir.layers.find((l) => l.visible);
  if (!targetLayer) {
    console.warn('[MaterialManager] 无法应用材质：没有可见图层');
    return;
  }

  console.log('[MaterialManager] 应用材质到图层:', targetLayer.id, '材质:', materialId);

  // 在目标图层上设置 materialId
  // regionCompiler 检测到 materialId 后将该层编译为 IMAGE_TEXTURE opcode
  // MaterialRenderBridge 在 renderCurrentIR 中预渲染材质为 GPUTexture
  // evaluator 的 compute shader 通过 textureLoad 采样该纹理
  const newIr = {
    ...ir,
    layers: ir.layers.map((l) =>
      l.id === targetLayer.id
        ? { ...l, materialId }
        : l
    ),
  };
  runtimeStore.setRenderIR(newIr);
  // 切换到画布 tab，让用户能看到材质渲染效果
  appStore.activeLeftTab = 'image';
  console.log('[MaterialManager] setRenderIR 已调用，已切换到画布');
}

const categoryOptions: Array<{ value: MaterialCategory | 'all'; label: string }> = [
  { value: 'all', label: '全部分类' },
  { value: 'procedural', label: '程序化' },
  { value: 'pbr', label: 'PBR 标准' },
  { value: 'stylized', label: '风格化' },
  { value: 'custom', label: '自定义' },
];

// ─── 预设列表 ──────────────────────────────────────────
const presetList = computed(() => {
  return listPresetKeys().map((key) => {
    const p = getPreset(key);
    return { key, label: p?.label ?? key, description: p?.description ?? '', subjects: p?.subjects ?? [] };
  });
});

// ─── 创建材质 ──────────────────────────────────────────
function createBlankMaterial() {
  const id = store.createMaterial('新材质', {
    category: 'custom',
    pbr: undefined,
    graph: null,
  });
  store.selectMaterial(id);
  showCreateMenu.value = false;
  startEditName(id);
}

function createFromPreset(presetKey: string) {
  const id = store.createMaterialFromPreset(presetKey);
  if (id) {
    store.selectMaterial(id);
    showCreateMenu.value = false;
  }
}

// ─── 编辑名称 ──────────────────────────────────────────
function startEditName(id: string) {
  const asset = store.getMaterial(id);
  if (!asset) return;
  editingName.value = id;
  tempName.value = asset.name;
}

function commitEditName() {
  if (editingName.value && tempName.value.trim()) {
    store.renameMaterial(editingName.value, tempName.value.trim());
  }
  editingName.value = null;
}

function cancelEditName() {
  editingName.value = null;
}

// ─── 导入 ──────────────────────────────────────────────
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
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  await importFiles(files);
}

async function importFiles(files: File[]) {
  isImporting.value = true;
  importMessage.value = null;
  let successCount = 0;
  let failCount = 0;
  const allWarnings: string[] = [];

  for (const file of files) {
    try {
      const results = await store.importFromFile(file);
      for (const result of results) {
        if (result.ok) {
          successCount++;
          allWarnings.push(...result.warnings);
        } else {
          failCount++;
          importMessage.value = {
            type: 'error',
            text: `导入失败: ${result.error}`,
          };
        }
      }
    } catch (e) {
      failCount++;
      importMessage.value = {
        type: 'error',
        text: `导入文件 ${file.name} 时出错: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  if (successCount > 0) {
    importMessage.value = {
      type: failCount > 0 ? 'warning' : 'success',
      text: `成功导入 ${successCount} 个材质${failCount > 0 ? `，${failCount} 个失败` : ''}`,
    };
  }

  // 3 秒后清除消息
  setTimeout(() => {
    importMessage.value = null;
  }, 3000);

  isImporting.value = false;
}

// ─── 导出 ──────────────────────────────────────────────
function toggleExportMenu(id: string) {
  showExportMenu.value = showExportMenu.value === id ? null : id;
}

function doExport(id: string, format: MaterialExportFormat) {
  store.exportMaterialById(id, format);
  showExportMenu.value = null;
}

// ─── PBR 参数编辑 ─────────────────────────────────────
function updatePBRField(field: keyof MaterialAsset['pbr'], value: number | number[] | string | boolean) {
  if (!selectedAsset.value) return;
  const pbr = { ...selectedAsset.value.pbr };
  if (field === 'baseColorFactor' && Array.isArray(value)) {
    pbr.baseColorFactor = value as [number, number, number, number];
  } else if (field === 'emissiveFactor' && Array.isArray(value)) {
    pbr.emissiveFactor = value as [number, number, number];
  } else if (field === 'alphaMode' && typeof value === 'string') {
    pbr.alphaMode = value as MaterialAsset['pbr']['alphaMode'];
  } else if (field === 'doubleSided' && typeof value === 'boolean') {
    pbr.doubleSided = value;
  } else if (typeof value === 'number') {
    (pbr as Record<string, unknown>)[field] = value;
  }
  store.updatePBR(selectedAsset.value.id, pbr);
}

// ─── 工具函数 ──────────────────────────────────────────
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function formatId(id: string): string {
  if (id.length <= 30) return id;
  return id.substring(0, 15) + '...' + id.substring(id.length - 12);
}

function getCategoryColor(cat: MaterialCategory): string {
  switch (cat) {
    case 'procedural': return '#5b8def';
    case 'pbr': return '#e8a838';
    case 'stylized': return '#a855f7';
    case 'custom': return '#22c55e';
    default: return '#888';
  }
}

function getCategoryLabel(cat: MaterialCategory): string {
  switch (cat) {
    case 'procedural': return '程序化';
    case 'pbr': return 'PBR';
    case 'stylized': return '风格化';
    case 'custom': return '自定义';
    default: return cat;
  }
}

// ─── 初始化 ────────────────────────────────────────────
onMounted(() => {
  store.init();
});

// ─── 排序选项 ──────────────────────────────────────────
const sortOptions = [
  { value: 'modifiedAt', label: '修改时间' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'name', label: '名称' },
];
</script>

<template>
  <div class="pf-mat-manager">
    <!-- 顶部工具栏 -->
    <div class="pf-mat-toolbar">
      <div class="pf-mat-toolbar-left">
        <h2 class="pf-mat-title">材质管理</h2>
        <span class="pf-mat-count">{{ assetCount }} 个材质</span>
      </div>
      <div class="pf-mat-toolbar-right">
        <!-- 创建按钮 -->
        <div class="pf-mat-create-wrap">
          <button class="pf-mat-btn pf-mat-btn-primary" @click="showCreateMenu = !showCreateMenu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>创建材质</span>
          </button>
          <div v-if="showCreateMenu" class="pf-mat-dropdown">
            <button class="pf-mat-dropdown-item" @click="createBlankMaterial">
              <span class="pf-mat-dropdown-icon">□</span>
              <span>空白材质</span>
            </button>
            <div class="pf-mat-dropdown-divider"></div>
            <div class="pf-mat-dropdown-label">从预设创建</div>
            <button
              v-for="preset in presetList"
              :key="preset.key"
              class="pf-mat-dropdown-item"
              @click="createFromPreset(preset.key)"
            >
              <span class="pf-mat-dropdown-icon">◆</span>
              <div class="pf-mat-dropdown-text">
                <span>{{ preset.label }}</span>
                <small>{{ preset.description }}</small>
              </div>
            </button>
          </div>
        </div>

        <!-- 导入按钮 -->
        <button class="pf-mat-btn" @click="triggerFileInput" :disabled="isImporting">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M12 3v10" />
            <path d="M8 7l4-4 4 4" />
            <path d="M4 13v5a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" />
          </svg>
          <span>{{ isImporting ? '导入中...' : '导入' }}</span>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          accept=".pfmat,.gltf,.glb,.mtl,application/json,text/plain"
          multiple
          style="display: none"
          @change="onFileChange"
        />
      </div>
    </div>

    <!-- 搜索 + 筛选栏 -->
    <div class="pf-mat-filterbar">
      <div class="pf-mat-search-wrap">
        <svg class="pf-mat-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="searchQuery"
          class="pf-mat-search-input"
          type="text"
          placeholder="搜索材质名称、标签..."
        />
      </div>
      <select v-model="filterCategory" class="pf-mat-select">
        <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <select v-model="sortBy" class="pf-mat-select">
        <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">排序: {{ opt.label }}</option>
      </select>
      <button class="pf-mat-sort-btn" :title="sortOrder === 'asc' ? '升序' : '降序'" @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'">
        <svg v-if="sortOrder === 'asc'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M3 6h18M6 12h12M9 18h6" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M9 6h6M6 12h12M3 18h18" />
        </svg>
      </button>
    </div>

    <!-- 导入提示 -->
    <div v-if="importMessage" class="pf-mat-toast" :class="`pf-mat-toast-${importMessage.type}`">
      {{ importMessage.text }}
    </div>

    <!-- 主体区域：列表 + 详情 -->
    <div class="pf-mat-body">
      <!-- 左侧：材质列表 -->
      <div
        class="pf-mat-list-panel"
        :class="{ 'pf-mat-drag-over': isDragOver }"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div v-if="filteredAssets.length === 0" class="pf-mat-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" opacity="0.3">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <p v-if="assets.length === 0">还没有材质，点击「创建材质」开始</p>
          <p v-else>没有匹配的材质</p>
          <p v-if="assets.length === 0" class="pf-mat-empty-hint">或拖拽 .pfmat / .gltf / .mtl 文件到此处导入</p>
        </div>

        <div v-else class="pf-mat-grid">
          <div
            v-for="asset in filteredAssets"
            :key="asset.id"
            class="pf-mat-card"
            :class="{ active: selectedAssetId === asset.id }"
            @click="store.selectMaterial(asset.id)"
          >
            <!-- 缩略图区域 -->
            <div class="pf-mat-card-thumb">
              <img v-if="asset.thumbnail" :src="asset.thumbnail" alt="" :class="{ 'is-loading': store.isGeneratingThumbnail(asset.id) }" />
              <div v-else class="pf-mat-card-thumb-placeholder" :style="{ background: `rgb(${Math.round(asset.pbr.baseColorFactor[0] * 255)}, ${Math.round(asset.pbr.baseColorFactor[1] * 255)}, ${Math.round(asset.pbr.baseColorFactor[2] * 255)})` }">
                <span class="pf-mat-card-cat-badge" :style="{ background: getCategoryColor(asset.category) }">
                  {{ getCategoryLabel(asset.category) }}
                </span>
              </div>
              <!-- 分类徽章（缩略图存在时叠加显示） -->
              <span v-if="asset.thumbnail" class="pf-mat-card-cat-badge pf-mat-card-cat-overlay" :style="{ background: getCategoryColor(asset.category) }">
                {{ getCategoryLabel(asset.category) }}
              </span>
              <!-- 预览生成中指示器 -->
              <div v-if="store.isGeneratingThumbnail(asset.id)" class="pf-mat-card-thumb-loading">
                <div class="pf-mat-spinner"></div>
              </div>

              <!-- 导出菜单 -->
              <div class="pf-mat-card-export-wrap">
                <button
                  class="pf-mat-card-btn"
                  title="导出"
                  @click.stop="toggleExportMenu(asset.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <path d="M12 3v10" />
                    <path d="M8 7l4-4 4 4" />
                    <path d="M4 13v5a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-5" />
                  </svg>
                </button>
                <div v-if="showExportMenu === asset.id" class="pf-mat-dropdown pf-mat-export-menu" @click.stop>
                  <div class="pf-mat-dropdown-label">导出格式</div>
                  <button
                    v-for="fmt in MATERIAL_EXPORT_FORMATS"
                    :key="fmt.id"
                    class="pf-mat-dropdown-item"
                    @click="doExport(asset.id, fmt.id)"
                  >
                    <span class="pf-mat-dropdown-icon">{{ fmt.extension }}</span>
                    <div class="pf-mat-dropdown-text">
                      <span>{{ fmt.label }}</span>
                      <small>{{ fmt.description }}</small>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <!-- 信息区域 -->
            <div class="pf-mat-card-info">
              <div v-if="editingName === asset.id" class="pf-mat-card-name-edit">
                <input
                  v-model="tempName"
                  class="pf-mat-name-input"
                  @keyup.enter="commitEditName"
                  @keyup.escape="cancelEditName"
                  @blur="commitEditName"
                  ref="nameInputRef"
                />
              </div>
              <div v-else class="pf-mat-card-name" @dblclick.stop="startEditName(asset.id)" :title="asset.name">
                {{ asset.name }}
              </div>
              <div class="pf-mat-card-meta">
                <span class="pf-mat-card-id" :title="asset.id">{{ formatId(asset.id) }}</span>
                <span class="pf-mat-card-date">{{ formatDate(asset.modifiedAt) }}</span>
              </div>
              <div v-if="asset.tags.length > 0" class="pf-mat-card-tags">
                <span v-for="tag in asset.tags.slice(0, 3)" :key="tag" class="pf-mat-tag">{{ tag }}</span>
                <span v-if="asset.tags.length > 3" class="pf-mat-tag pf-mat-tag-more">+{{ asset.tags.length - 3 }}</span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="pf-mat-card-actions">
              <button class="pf-mat-card-btn pf-mat-card-btn-apply" title="应用到当前图层" @click.stop="applyMaterialToCurrentLayer(asset.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
                </svg>
              </button>
              <button class="pf-mat-card-btn" title="复制" @click.stop="store.duplicateMaterial(asset.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
              <button class="pf-mat-card-btn pf-mat-card-btn-danger" title="删除" @click.stop="store.deleteMaterial(asset.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧：材质详情 -->
      <div v-if="selectedAsset" class="pf-mat-detail-panel">
        <div class="pf-mat-detail-header">
          <h3 class="pf-mat-detail-title">{{ selectedAsset.name }}</h3>
          <button class="pf-mat-card-btn" title="关闭" @click="store.selectMaterial(null)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <!-- Tab 切换 -->
        <div class="pf-mat-detail-tabs">
          <button
            v-for="tab in [
              { id: 'info', label: '信息' },
              { id: 'pbr', label: 'PBR 参数' },
              { id: 'graph', label: '节点图' },
            ]"
            :key="tab.id"
            class="pf-mat-tab"
            :class="{ active: detailTab === tab.id }"
            @click="detailTab = tab.id as 'info' | 'pbr' | 'graph'"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="pf-mat-detail-body">
          <!-- 信息 Tab -->
          <div v-if="detailTab === 'info'" class="pf-mat-detail-section">
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">材质 ID</span>
              <span class="pf-mat-detail-value pf-mat-detail-mono">{{ selectedAsset.id }}</span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">分类</span>
              <span class="pf-mat-detail-value">
                <span class="pf-mat-card-cat-badge" :style="{ background: getCategoryColor(selectedAsset.category) }">
                  {{ getCategoryLabel(selectedAsset.category) }}
                </span>
              </span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">版本</span>
              <span class="pf-mat-detail-value">{{ selectedAsset.version }}</span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">作者</span>
              <span class="pf-mat-detail-value">{{ selectedAsset.author }}</span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">创建时间</span>
              <span class="pf-mat-detail-value">{{ formatDate(selectedAsset.createdAt) }}</span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">修改时间</span>
              <span class="pf-mat-detail-value">{{ formatDate(selectedAsset.modifiedAt) }}</span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">描述</span>
              <span class="pf-mat-detail-value">{{ selectedAsset.description || '—' }}</span>
            </div>
            <div class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">标签</span>
              <div class="pf-mat-detail-tags">
                <span v-for="tag in selectedAsset.tags" :key="tag" class="pf-mat-tag">
                  {{ tag }}
                  <button class="pf-mat-tag-remove" @click="store.removeTag(selectedAsset.id, tag)">×</button>
                </span>
                <button class="pf-mat-tag-add" @click="store.addTag(selectedAsset.id, prompt('输入标签名') || '')">+ 添加标签</button>
              </div>
            </div>
            <div v-if="selectedAsset.textures.length > 0" class="pf-mat-detail-row">
              <span class="pf-mat-detail-label">纹理</span>
              <div class="pf-mat-detail-textures">
                <div v-for="(tex, i) in selectedAsset.textures" :key="i" class="pf-mat-texture-item">
                  <span class="pf-mat-texture-usage">{{ tex.usage }}</span>
                  <span class="pf-mat-texture-uri">{{ tex.uri.substring(0, 50) }}{{ tex.uri.length > 50 ? '...' : '' }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- PBR 参数 Tab -->
          <div v-if="detailTab === 'pbr'" class="pf-mat-detail-section">
            <div class="pf-mat-pbr-group">
              <div class="pf-mat-pbr-group-title">基础色 (Base Color)</div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">R</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.baseColorFactor[0]" @input="updatePBRField('baseColorFactor', [$event.target ? parseFloat(($event.target as HTMLInputElement).value) : 0, selectedAsset.pbr.baseColorFactor[1], selectedAsset.pbr.baseColorFactor[2], selectedAsset.pbr.baseColorFactor[3]])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.baseColorFactor[0].toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">G</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.baseColorFactor[1]" @input="updatePBRField('baseColorFactor', [selectedAsset.pbr.baseColorFactor[0], $event.target ? parseFloat(($event.target as HTMLInputElement).value) : 0, selectedAsset.pbr.baseColorFactor[2], selectedAsset.pbr.baseColorFactor[3]])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.baseColorFactor[1].toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">B</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.baseColorFactor[2]" @input="updatePBRField('baseColorFactor', [selectedAsset.pbr.baseColorFactor[0], selectedAsset.pbr.baseColorFactor[1], $event.target ? parseFloat(($event.target as HTMLInputElement).value) : 0, selectedAsset.pbr.baseColorFactor[3]])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.baseColorFactor[2].toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">A</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.baseColorFactor[3]" @input="updatePBRField('baseColorFactor', [selectedAsset.pbr.baseColorFactor[0], selectedAsset.pbr.baseColorFactor[1], selectedAsset.pbr.baseColorFactor[2], $event.target ? parseFloat(($event.target as HTMLInputElement).value) : 0])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.baseColorFactor[3].toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-color-preview" :style="{ background: `rgba(${selectedAsset.pbr.baseColorFactor[0] * 255}, ${selectedAsset.pbr.baseColorFactor[1] * 255}, ${selectedAsset.pbr.baseColorFactor[2] * 255}, ${selectedAsset.pbr.baseColorFactor[3]})` }"></div>
            </div>

            <div class="pf-mat-pbr-group">
              <div class="pf-mat-pbr-group-title">金属度 & 粗糙度</div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">Metallic</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.metallicFactor" @input="updatePBRField('metallicFactor', parseFloat(($event.target as HTMLInputElement).value))" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.metallicFactor.toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">Roughness</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.roughnessFactor" @input="updatePBRField('roughnessFactor', parseFloat(($event.target as HTMLInputElement).value))" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.roughnessFactor.toFixed(3) }}</span>
              </div>
            </div>

            <div class="pf-mat-pbr-group">
              <div class="pf-mat-pbr-group-title">自发光 (Emissive)</div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">R</label>
                <input type="range" min="0" max="2" step="0.01" :value="selectedAsset.pbr.emissiveFactor[0]" @input="updatePBRField('emissiveFactor', [parseFloat(($event.target as HTMLInputElement).value), selectedAsset.pbr.emissiveFactor[1], selectedAsset.pbr.emissiveFactor[2]])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.emissiveFactor[0].toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">G</label>
                <input type="range" min="0" max="2" step="0.01" :value="selectedAsset.pbr.emissiveFactor[1]" @input="updatePBRField('emissiveFactor', [selectedAsset.pbr.emissiveFactor[0], parseFloat(($event.target as HTMLInputElement).value), selectedAsset.pbr.emissiveFactor[2]])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.emissiveFactor[1].toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">B</label>
                <input type="range" min="0" max="2" step="0.01" :value="selectedAsset.pbr.emissiveFactor[2]" @input="updatePBRField('emissiveFactor', [selectedAsset.pbr.emissiveFactor[0], selectedAsset.pbr.emissiveFactor[1], parseFloat(($event.target as HTMLInputElement).value)])" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.emissiveFactor[2].toFixed(3) }}</span>
              </div>
            </div>

            <div class="pf-mat-pbr-group">
              <div class="pf-mat-pbr-group-title">透明 & 渲染</div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">Alpha 模式</label>
                <select :value="selectedAsset.pbr.alphaMode" @change="updatePBRField('alphaMode', ($event.target as HTMLSelectElement).value)" class="pf-mat-select pf-mat-select-sm">
                  <option value="OPAQUE">OPAQUE</option>
                  <option value="MASK">MASK</option>
                  <option value="BLEND">BLEND</option>
                </select>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">Alpha 截断</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.alphaCutoff" @input="updatePBRField('alphaCutoff', parseFloat(($event.target as HTMLInputElement).value))" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.alphaCutoff.toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">法线缩放</label>
                <input type="range" min="0" max="5" step="0.01" :value="selectedAsset.pbr.normalScale" @input="updatePBRField('normalScale', parseFloat(($event.target as HTMLInputElement).value))" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.normalScale.toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">AO 强度</label>
                <input type="range" min="0" max="1" step="0.01" :value="selectedAsset.pbr.occlusionStrength" @input="updatePBRField('occlusionStrength', parseFloat(($event.target as HTMLInputElement).value))" class="pf-mat-slider" />
                <span class="pf-mat-pbr-val">{{ selectedAsset.pbr.occlusionStrength.toFixed(3) }}</span>
              </div>
              <div class="pf-mat-pbr-row">
                <label class="pf-mat-pbr-label">双面渲染</label>
                <button
                  class="pf-mat-toggle"
                  :class="{ on: selectedAsset.pbr.doubleSided }"
                  @click="updatePBRField('doubleSided', !selectedAsset.pbr.doubleSided)"
                >
                  <span class="pf-mat-toggle-knob"></span>
                </button>
              </div>
            </div>
          </div>

          <!-- 节点图 Tab -->
          <div v-if="detailTab === 'graph'" class="pf-mat-detail-section">
            <div v-if="selectedAsset.graph" class="pf-mat-graph-info">
              <div class="pf-mat-detail-row">
                <span class="pf-mat-detail-label">节点数</span>
                <span class="pf-mat-detail-value">{{ selectedAsset.graph.nodes.length }}</span>
              </div>
              <div class="pf-mat-detail-row">
                <span class="pf-mat-detail-label">连接数</span>
                <span class="pf-mat-detail-value">{{ selectedAsset.graph.edges.length }}</span>
              </div>
              <div class="pf-mat-detail-row">
                <span class="pf-mat-detail-label">画布尺寸</span>
                <span class="pf-mat-detail-value">{{ selectedAsset.graph.canvas.width }} × {{ selectedAsset.graph.canvas.height }}</span>
              </div>
              <div class="pf-mat-graph-nodes">
                <div class="pf-mat-pbr-group-title">节点列表</div>
                <div v-for="node in selectedAsset.graph.nodes" :key="node.id" class="pf-mat-graph-node">
                  <span class="pf-mat-graph-node-type">{{ node.type }}</span>
                  <span class="pf-mat-graph-node-name">{{ node.name }}</span>
                  <span class="pf-mat-graph-node-id">{{ node.id }}</span>
                </div>
              </div>
            </div>
            <div v-else class="pf-mat-empty">
              <p>该材质没有节点图</p>
              <p class="pf-mat-empty-hint">PBR 参数驱动的材质不需要节点图</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf-mat-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 12px;
  padding: 4px;
}

/* ─── 工具栏 ─── */
.pf-mat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 0 4px;
}

.pf-mat-toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pf-mat-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}

.pf-mat-count {
  font-size: 12px;
  color: var(--text-tertiary);
}

.pf-mat-toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ─── 按钮 ─── */
.pf-mat-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.pf-mat-btn:hover { background: var(--glass-bg-hover); }
.pf-mat-btn:active { background: var(--glass-bg-pressed); }
.pf-mat-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.pf-mat-btn-primary {
  background: var(--accent, #5b8def);
  color: white;
  border-color: transparent;
}
.pf-mat-btn-primary:hover { filter: brightness(1.1); }

/* ─── 下拉菜单 ─── */
.pf-mat-create-wrap, .pf-mat-card-export-wrap {
  position: relative;
}

.pf-mat-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 220px;
  max-width: 320px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 100;
  padding: 4px;
  overflow: hidden;
}

.pf-mat-dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-xs);
  transition: background 0.1s;
}
.pf-mat-dropdown-item:hover { background: var(--glass-bg-hover); }

.pf-mat-dropdown-icon {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: monospace;
  line-height: 1.4;
}

.pf-mat-dropdown-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pf-mat-dropdown-text small {
  font-size: 10px;
  color: var(--text-tertiary);
}

.pf-mat-dropdown-divider {
  height: 1px;
  background: var(--glass-border);
  margin: 4px 0;
}

.pf-mat-dropdown-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 6px 10px 4px;
}

.pf-mat-export-menu {
  min-width: 260px;
}

/* ─── 筛选栏 ─── */
.pf-mat-filterbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 0 4px;
}

.pf-mat-search-wrap {
  position: relative;
  flex: 1;
  max-width: 320px;
}

.pf-mat-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  pointer-events: none;
}

.pf-mat-search-input {
  width: 100%;
  padding: 7px 12px 7px 32px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  outline: none;
  transition: border-color 0.15s;
}
.pf-mat-search-input:focus { border-color: var(--accent, #5b8def); }
.pf-mat-search-input::placeholder { color: var(--text-tertiary); }

.pf-mat-select {
  padding: 7px 10px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  outline: none;
  cursor: pointer;
}

.pf-mat-select-sm {
  padding: 4px 8px;
  font-size: 11px;
}

.pf-mat-sort-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
}
.pf-mat-sort-btn:hover { background: var(--glass-bg-hover); }

/* ─── Toast ─── */
.pf-mat-toast {
  padding: 8px 14px;
  font-size: 12px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.pf-mat-toast-success { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.pf-mat-toast-error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.pf-mat-toast-warning { background: rgba(234, 179, 8, 0.15); color: #eab308; }

/* ─── 主体 ─── */
.pf-mat-body {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

/* ─── 列表面板 ─── */
.pf-mat-list-panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  border-radius: var(--radius-lg);
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  padding: 12px;
  position: relative;
  transition: border-color 0.2s;
}

.pf-mat-drag-over {
  border-color: var(--accent, #5b8def);
  border-style: dashed;
}

/* ─── 空状态 ─── */
.pf-mat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  gap: 8px;
  color: var(--text-tertiary);
}
.pf-mat-empty p { margin: 0; font-size: 13px; }
.pf-mat-empty-hint { font-size: 11px !important; color: var(--text-quaternary, rgba(128, 128, 128, 0.4)); }

/* ─── 网格 ─── */
.pf-mat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

/* ─── 材质卡片 ─── */
.pf-mat-card {
  position: relative;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--glass-bg);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pf-mat-card:hover {
  border-color: var(--text-quaternary, rgba(128, 128, 128, 0.3));
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.pf-mat-card.active {
  border-color: var(--accent, #5b8def);
  box-shadow: 0 0 0 1px var(--accent, #5b8def);
}

.pf-mat-card-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.05);
}
.pf-mat-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
}
.pf-mat-card-thumb img.is-loading {
  opacity: 0.5;
}
.pf-mat-card-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 8px;
}

.pf-mat-card-cat-overlay {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.pf-mat-card-thumb-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  z-index: 2;
}

.pf-mat-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: pf-mat-spin 0.8s linear infinite;
}

@keyframes pf-mat-spin {
  to { transform: rotate(360deg); }
}

.pf-mat-card-cat-badge {
  display: inline-block;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  color: white;
  border-radius: var(--radius-pill);
  letter-spacing: 0.02em;
}

.pf-mat-card-export-wrap {
  position: absolute;
  top: 6px;
  right: 6px;
}

.pf-mat-card-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: none;
  border-radius: var(--radius-xs);
  color: white;
  cursor: pointer;
  transition: background 0.15s;
}
.pf-mat-card-btn:hover { background: rgba(0, 0, 0, 0.6); }
.pf-mat-card-btn-danger:hover { background: rgba(239, 68, 68, 0.7); }

.pf-mat-card-btn-apply {
  color: var(--accent, #5b8def);
}
.pf-mat-card-btn-apply:hover {
  background: var(--glass-bg-hover);
  color: var(--accent, #5b8def);
  filter: brightness(1.2);
}

.pf-mat-card-info {
  padding: 8px 10px;
}

.pf-mat-card-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}

.pf-mat-card-name-edit {
  padding: 0;
}

.pf-mat-name-input {
  width: 100%;
  padding: 2px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  background: var(--glass-bg);
  border: 1px solid var(--accent, #5b8def);
  border-radius: var(--radius-xs);
  outline: none;
}

.pf-mat-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-tertiary);
}

.pf-mat-card-id {
  font-family: monospace;
  font-size: 9px;
  opacity: 0.7;
}

.pf-mat-card-date {
  font-size: 10px;
}

.pf-mat-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 6px;
}

.pf-mat-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--text-secondary);
  background: var(--glass-bg-hover);
  border-radius: var(--radius-pill);
}

.pf-mat-tag-more {
  opacity: 0.6;
}

.pf-mat-tag-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 0;
}
.pf-mat-tag-remove:hover { color: var(--text-primary); }

.pf-mat-tag-add {
  background: none;
  border: 1px dashed var(--glass-border);
  color: var(--text-tertiary);
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  cursor: pointer;
}
.pf-mat-tag-add:hover { color: var(--text-primary); border-color: var(--text-tertiary); }

.pf-mat-card-actions {
  display: flex;
  gap: 4px;
  padding: 6px 10px;
  border-top: 1px solid var(--glass-border);
}
.pf-mat-card-actions .pf-mat-card-btn {
  background: var(--glass-bg);
  color: var(--text-secondary);
  width: 26px;
  height: 26px;
}
.pf-mat-card-actions .pf-mat-card-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

/* ─── 详情面板 ─── */
.pf-mat-detail-panel {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  overflow: hidden;
}

.pf-mat-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--glass-border);
}
.pf-mat-detail-header .pf-mat-card-btn {
  background: var(--glass-bg);
  color: var(--text-secondary);
}
.pf-mat-detail-header .pf-mat-card-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
}

.pf-mat-detail-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pf-mat-detail-tabs {
  display: flex;
  gap: 2px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--glass-border);
}

.pf-mat-tab {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all 0.15s;
}
.pf-mat-tab:hover { color: var(--text-primary); background: var(--glass-bg-hover); }
.pf-mat-tab.active {
  color: var(--accent, #5b8def);
  background: var(--glass-bg-hover);
}

.pf-mat-detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.pf-mat-detail-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-mat-detail-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.pf-mat-detail-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pf-mat-detail-value {
  font-size: 12px;
  color: var(--text-primary);
  word-break: break-all;
}

.pf-mat-detail-mono {
  font-family: monospace;
  font-size: 10px;
  color: var(--text-secondary);
}

.pf-mat-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.pf-mat-detail-textures {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pf-mat-texture-item {
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  background: var(--glass-bg-hover);
  border-radius: var(--radius-xs);
}
.pf-mat-texture-usage {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent, #5b8def);
}
.pf-mat-texture-uri {
  font-size: 10px;
  color: var(--text-tertiary);
  font-family: monospace;
  word-break: break-all;
}

/* ─── PBR 参数 ─── */
.pf-mat-pbr-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--glass-bg-hover);
  border-radius: var(--radius-sm);
}

.pf-mat-pbr-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.pf-mat-pbr-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pf-mat-pbr-label {
  width: 70px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.pf-mat-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--glass-border);
  border-radius: 2px;
  outline: none;
}
.pf-mat-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent, #5b8def);
  cursor: pointer;
}
.pf-mat-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent, #5b8def);
  cursor: pointer;
  border: none;
}

.pf-mat-pbr-val {
  width: 42px;
  font-size: 11px;
  font-family: monospace;
  color: var(--text-secondary);
  text-align: right;
  flex-shrink: 0;
}

.pf-mat-pbr-color-preview {
  width: 100%;
  height: 32px;
  border-radius: var(--radius-xs);
  margin-top: 4px;
  border: 1px solid var(--glass-border);
}

/* ─── Toggle ─── */
.pf-mat-toggle {
  width: 36px;
  height: 20px;
  background: var(--glass-border);
  border: none;
  border-radius: var(--radius-pill);
  position: relative;
  cursor: pointer;
  transition: background 0.2s;
}
.pf-mat-toggle.on {
  background: var(--accent, #5b8def);
}
.pf-mat-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}
.pf-mat-toggle.on .pf-mat-toggle-knob {
  transform: translateX(16px);
}

/* ─── 节点图信息 ─── */
.pf-mat-graph-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-mat-graph-nodes {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pf-mat-graph-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--glass-bg-hover);
  border-radius: var(--radius-xs);
}

.pf-mat-graph-node-type {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent, #5b8def);
  font-family: monospace;
  min-width: 60px;
}

.pf-mat-graph-node-name {
  font-size: 11px;
  color: var(--text-primary);
  flex: 1;
}

.pf-mat-graph-node-id {
  font-size: 9px;
  color: var(--text-tertiary);
  font-family: monospace;
}

/* ─── 响应式 ─── */
@media (max-width: 900px) {
  .pf-mat-detail-panel {
    width: 300px;
  }
  .pf-mat-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
}

@media (max-width: 700px) {
  .pf-mat-body {
    flex-direction: column;
  }
  .pf-mat-detail-panel {
    width: 100%;
    max-height: 300px;
  }
}
</style>
