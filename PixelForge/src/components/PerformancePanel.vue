<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, toRef } from 'vue';
import { useAppStore } from '../stores/app';
import { unifiedStore, type UnifiedStoreStats } from '../storage/unifiedStore';
import { getDbPath } from '../storage/tauriDb';
import { TOTAL_DURATION, FPS } from '../data';

const store = useAppStore();
const resolution = toRef(store, 'resolution');
const frameRate = toRef(store, 'frameRate');
const currentTime = toRef(store, 'currentTime');
const isPlaying = toRef(store, 'isPlaying');
const isGenerating = toRef(store, 'isGenerating');

// ─── 实时 FPS / 帧时间监控 ────────────────────────────
const fps = ref(0);
const frameTime = ref(0);
const fpsHistory = ref<number[]>(new Array(60).fill(0));

let rafId = 0;
let lastFrameTime = 0;
let frameCount = 0;
let fpsAccumulator = 0;

function tick(timestamp: number) {
  if (lastFrameTime > 0) {
    const delta = timestamp - lastFrameTime;
    fpsAccumulator += delta;
    frameCount++;
    if (fpsAccumulator >= 500) {
      const avgFrameTime = fpsAccumulator / frameCount;
      fps.value = Math.round(1000 / avgFrameTime);
      frameTime.value = Math.round(avgFrameTime * 10) / 10;
      fpsHistory.value.shift();
      fpsHistory.value.push(fps.value);
      fpsAccumulator = 0;
      frameCount = 0;
    }
  }
  lastFrameTime = timestamp;
  rafId = requestAnimationFrame(tick);
}

// ─── 内存监控 ──────────────────────────────────────────
interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

const memInfo = ref<MemoryInfo | null>(null);
const memSupported = ref(false);

function pollMemory() {
  const perf = performance as Performance & { memory?: MemoryInfo };
  if (perf.memory) {
    memSupported.value = true;
    memInfo.value = {
      usedJSHeapSize: perf.memory.usedJSHeapSize,
      totalJSHeapSize: perf.memory.totalJSHeapSize,
      jsHeapSizeLimit: perf.memory.jsHeapSizeLimit,
    };
  }
}

// ─── 定时刷新 ──────────────────────────────────────────
let pollTimer = 0;

// ─── 存储统计 ──────────────────────────────────────────
const storageStats = ref<UnifiedStoreStats | null>(null);
const storagePath = ref<string | null>(null);
const isStorageLoading = ref(false);

async function refreshStorageStats() {
  isStorageLoading.value = true;
  try {
    const [stats, path] = await Promise.all([
      unifiedStore.stats(),
      getDbPath(),
    ]);
    storageStats.value = stats;
    storagePath.value = path;
  } catch (e) {
    console.warn('[PerformancePanel] 存储统计加载失败', e);
  } finally {
    isStorageLoading.value = false;
  }
}

// ─── 项目统计 ──────────────────────────────────────────
const clipCount = computed(() => store.clips.length);
const trackCount = computed(() => store.tracks.length);
const historyCount = computed(() => store.history.length);

// ─── 渲染概览 ──────────────────────────────────────────
const fpsNum = computed(() => parseInt(frameRate.value) || FPS);
const totalFrames = computed(() => Math.round(TOTAL_DURATION * fpsNum.value));
const currentFrame = computed(() => Math.min(totalFrames.value, Math.floor(currentTime.value * fpsNum.value)));
const playbackPercent = computed(() => (currentTime.value / TOTAL_DURATION) * 100);

const resolutionParts = computed(() => {
  const m = resolution.value.match(/(\d+)\s*[×x]\s*(\d+)/);
  return m ? { w: parseInt(m[1]), h: parseInt(m[2]) } : { w: 0, h: 0 };
});
const pixelCount = computed(() => resolutionParts.value.w * resolutionParts.value.h);
const pixelThroughput = computed(() => pixelCount.value * fpsNum.value);

const videoClips = computed(() => store.clips.filter(c => c.type === 'video').length);
const audioClips = computed(() => store.clips.filter(c => c.type === 'audio').length);
const textClips = computed(() => store.clips.filter(c => c.type === 'text').length);
const videoTracks = computed(() => store.tracks.filter(t => t.type === 'video').length);
const audioTracks = computed(() => store.tracks.filter(t => t.type === 'audio').length);
const textTracks = computed(() => store.tracks.filter(t => t.type === 'text').length);

const totalClipDuration = computed(() =>
  store.clips.reduce((sum, c) => sum + c.duration, 0)
);
const estimatedRenderTime = computed(() => {
  if (fps.value <= 0) return 0;
  return totalFrames.value / fps.value;
});

const renderStatus = computed(() => {
  if (isGenerating.value) return { label: '生成中', cls: 'pf-perf-badge-gen' };
  if (isPlaying.value) return { label: '播放中', cls: 'pf-perf-badge-ok' };
  return { label: '待机', cls: 'pf-perf-badge-idle' };
});

function formatPixelCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MP`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} K`;
  return `${n}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── 格式化辅助 ────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

// ─── FPS 历史图 SVG path ──────────────────────────────
const fpsChartPath = computed(() => {
  const values = fpsHistory.value;
  const w = 100;
  const h = 30;
  const maxFps = 120;
  const step = w / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = h - Math.min(h, (v / maxFps) * h);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
});

// ─── 内存占比 ──────────────────────────────────────────
const memUsedPercent = computed(() => {
  if (!memInfo.value) return 0;
  return (memInfo.value.usedJSHeapSize / memInfo.value.jsHeapSizeLimit) * 100;
});

const memTotalPercent = computed(() => {
  if (!memInfo.value) return 0;
  return (memInfo.value.totalJSHeapSize / memInfo.value.jsHeapSizeLimit) * 100;
});

onMounted(() => {
  rafId = requestAnimationFrame(tick);
  pollTimer = window.setInterval(pollMemory, 1000);
  pollMemory();
  void refreshStorageStats();
});

onUnmounted(() => {
  cancelAnimationFrame(rafId);
  clearInterval(pollTimer);
});
</script>

<template>
  <div class="pf-page">
    <div class="pf-perf-body">
      <!-- 左栏：实时资源监控 -->
      <div class="pf-perf-left">
        <!-- FPS & 帧时间 -->
        <div class="pf-panel glass-surface">
          <div class="pf-panel-header">
            <span class="pf-panel-title">渲染性能</span>
          </div>
          <div class="pf-panel-body">
            <div class="pf-perf-metric-row">
              <div class="pf-perf-metric">
                <span class="pf-perf-metric-label">FPS</span>
                <span class="pf-perf-metric-value" :class="{ 'pf-perf-warn': fps < 30 && fps > 0 }">{{ fps }}</span>
              </div>
              <div class="pf-perf-metric">
                <span class="pf-perf-metric-label">帧时间</span>
                <span class="pf-perf-metric-value">{{ frameTime }} ms</span>
              </div>
            </div>
            <!-- FPS 折线图 -->
            <div class="pf-perf-chart">
              <svg viewBox="0 0 100 30" preserveAspectRatio="none" width="100%" height="40">
                <defs>
                  <linearGradient id="fpsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
                    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path :d="fpsChartPath + ` L100,30 L0,30 Z`" fill="url(#fpsGrad)" />
                <path :d="fpsChartPath" fill="none" stroke="var(--accent)" stroke-width="0.8" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        <!-- 内存监控 -->
        <div class="pf-panel glass-surface">
          <div class="pf-panel-header">
            <span class="pf-panel-title">内存</span>
          </div>
          <div class="pf-panel-body">
            <template v-if="memSupported && memInfo">
              <div class="pf-perf-bar-group">
                <div class="pf-perf-bar-row">
                  <span class="pf-perf-bar-label">已用</span>
                  <span class="pf-perf-bar-value">{{ formatBytes(memInfo.usedJSHeapSize) }}</span>
                </div>
                <div class="pf-perf-bar">
                  <div class="pf-perf-bar-fill pf-perf-bar-used" :style="{ width: memUsedPercent + '%' }" />
                </div>
              </div>
              <div class="pf-perf-bar-group">
                <div class="pf-perf-bar-row">
                  <span class="pf-perf-bar-label">已分配</span>
                  <span class="pf-perf-bar-value">{{ formatBytes(memInfo.totalJSHeapSize) }}</span>
                </div>
                <div class="pf-perf-bar">
                  <div class="pf-perf-bar-fill pf-perf-bar-allocated" :style="{ width: memTotalPercent + '%' }" />
                </div>
              </div>
              <div class="pf-perf-bar-group">
                <div class="pf-perf-bar-row">
                  <span class="pf-perf-bar-label">上限</span>
                  <span class="pf-perf-bar-value">{{ formatBytes(memInfo.jsHeapSizeLimit) }}</span>
                </div>
              </div>
            </template>
            <div v-else class="pf-perf-unsupported">
              <PhWarningCircle :size="16" weight="duotone" />
              <span>当前环境不支持内存监控 API</span>
            </div>
          </div>
        </div>

        <!-- 项目资源统计 -->
        <div class="pf-panel glass-surface">
          <div class="pf-panel-header">
            <span class="pf-panel-title">项目资源</span>
          </div>
          <div class="pf-panel-body">
            <div class="pf-perf-stat-grid">
              <div class="pf-perf-stat-item">
                <span class="pf-perf-stat-num">{{ clipCount }}</span>
                <span class="pf-perf-stat-label">片段</span>
              </div>
              <div class="pf-perf-stat-item">
                <span class="pf-perf-stat-num">{{ trackCount }}</span>
                <span class="pf-perf-stat-label">轨道</span>
              </div>
              <div class="pf-perf-stat-item">
                <span class="pf-perf-stat-num">{{ historyCount }}</span>
                <span class="pf-perf-stat-label">历史记录</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 渲染概览 -->
        <div class="pf-panel glass-surface">
          <div class="pf-panel-header">
            <span class="pf-panel-title">渲染概览</span>
            <span class="pf-perf-badge" :class="renderStatus.cls" style="margin-left: auto">
              {{ renderStatus.label }}
            </span>
          </div>
          <div class="pf-panel-body">
            <!-- 输出配置 -->
            <div class="pf-perf-stat-grid">
              <div class="pf-perf-stat-item">
                <span class="pf-perf-stat-num">{{ resolution }}</span>
                <span class="pf-perf-stat-label">分辨率</span>
              </div>
              <div class="pf-perf-stat-item">
                <span class="pf-perf-stat-num">{{ frameRate }}</span>
                <span class="pf-perf-stat-label">帧率</span>
              </div>
              <div class="pf-perf-stat-item">
                <span class="pf-perf-stat-num">{{ formatDuration(TOTAL_DURATION) }}</span>
                <span class="pf-perf-stat-label">总时长</span>
              </div>
            </div>

            <!-- 帧进度 -->
            <div class="pf-perf-bar-group">
              <div class="pf-perf-bar-row">
                <span class="pf-perf-bar-label">播放进度</span>
                <span class="pf-perf-bar-value">{{ currentFrame }} / {{ totalFrames }} 帧</span>
              </div>
              <div class="pf-perf-bar">
                <div class="pf-perf-bar-fill pf-perf-bar-used" :style="{ width: playbackPercent + '%' }" />
              </div>
            </div>

            <!-- 像素吞吐 -->
            <div class="pf-perf-info-row">
              <div class="pf-perf-info-item">
                <span class="pf-perf-info-label">每帧像素</span>
                <span class="pf-perf-info-value">{{ formatPixelCount(pixelCount) }}</span>
              </div>
              <div class="pf-perf-info-item">
                <span class="pf-perf-info-label">像素吞吐</span>
                <span class="pf-perf-info-value">{{ formatPixelCount(pixelThroughput) }}/s</span>
              </div>
              <div class="pf-perf-info-item">
                <span class="pf-perf-info-label">预估渲染</span>
                <span class="pf-perf-info-value">{{ estimatedRenderTime > 0 ? formatDuration(estimatedRenderTime) : '—' }}</span>
              </div>
            </div>

            <!-- 轨道分布 -->
            <div class="pf-perf-info-row">
              <div class="pf-perf-info-item">
                <span class="pf-perf-info-label">视频轨道</span>
                <span class="pf-perf-info-value">{{ videoTracks }} <span class="pf-perf-info-sub">({{ videoClips }} 片段)</span></span>
              </div>
              <div class="pf-perf-info-item">
                <span class="pf-perf-info-label">音频轨道</span>
                <span class="pf-perf-info-value">{{ audioTracks }} <span class="pf-perf-info-sub">({{ audioClips }} 片段)</span></span>
              </div>
              <div class="pf-perf-info-item">
                <span class="pf-perf-info-label">文字轨道</span>
                <span class="pf-perf-info-value">{{ textTracks }} <span class="pf-perf-info-sub">({{ textClips }} 片段)</span></span>
              </div>
            </div>

            <!-- 总素材时长 -->
            <div class="pf-perf-bar-group" style="margin-bottom: 0">
              <div class="pf-perf-bar-row">
                <span class="pf-perf-bar-label">素材总时长</span>
                <span class="pf-perf-bar-value">{{ formatDuration(totalClipDuration) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右栏：存储统计 -->
      <div class="pf-perf-right">
        <div class="pf-panel glass-surface" style="height: 100%">
          <div class="pf-panel-header">
            <span class="pf-panel-title">存储消耗</span>
            <button class="btn btn-icon" title="刷新" @click="refreshStorageStats" style="margin-left: auto">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
          <div class="pf-panel-body">
            <div v-if="isStorageLoading" class="pf-canvas-placeholder">加载中…</div>
            <template v-else-if="storageStats">
              <!-- L1 帧缓存 -->
              <div class="pf-panel-section">
                <div class="pf-panel-label">L1 帧缓存（内存 LRU）</div>
                <div class="pf-perf-stat-grid">
                  <div class="pf-perf-stat-item">
                    <span class="pf-perf-stat-num">{{ storageStats.frameMemory.entries }}</span>
                    <span class="pf-perf-stat-label">条目</span>
                  </div>
                  <div class="pf-perf-stat-item">
                    <span class="pf-perf-stat-num">{{ formatBytes(storageStats.frameMemory.bytes) }}</span>
                    <span class="pf-perf-stat-label">已用</span>
                  </div>
                  <div class="pf-perf-stat-item">
                    <span class="pf-perf-stat-num">{{ formatBytes(storageStats.frameMemory.maxBytes) }}</span>
                    <span class="pf-perf-stat-label">上限</span>
                  </div>
                </div>
                <div class="pf-perf-bar">
                  <div
                    class="pf-perf-bar-fill pf-perf-bar-used"
                    :style="{ width: formatPercent(storageStats.frameMemory.bytes, storageStats.frameMemory.maxBytes) }"
                  />
                </div>
                <div class="pf-perf-stat-mini">
                  <span>命中 {{ storageStats.frameMemory.hits }}</span>
                  <span>未命中 {{ storageStats.frameMemory.misses }}</span>
                  <span>命中率 {{ (storageStats.frameMemory.hitRate * 100).toFixed(1) }}%</span>
                  <span>淘汰 {{ storageStats.frameMemory.evictions }}</span>
                </div>
              </div>

              <!-- L1 文本缓存 -->
              <div class="pf-panel-section">
                <div class="pf-panel-label">L1 文本缓存（内存 LRU）</div>
                <div class="pf-perf-stat-grid">
                  <div class="pf-perf-stat-item">
                    <span class="pf-perf-stat-num">{{ storageStats.textMemory.entries }}</span>
                    <span class="pf-perf-stat-label">条目</span>
                  </div>
                  <div class="pf-perf-stat-item">
                    <span class="pf-perf-stat-num">{{ formatBytes(storageStats.textMemory.bytes) }}</span>
                    <span class="pf-perf-stat-label">已用</span>
                  </div>
                  <div class="pf-perf-stat-item">
                    <span class="pf-perf-stat-num">{{ formatBytes(storageStats.textMemory.maxBytes) }}</span>
                    <span class="pf-perf-stat-label">上限</span>
                  </div>
                </div>
                <div class="pf-perf-bar">
                  <div
                    class="pf-perf-bar-fill pf-perf-bar-allocated"
                    :style="{ width: formatPercent(storageStats.textMemory.bytes, storageStats.textMemory.maxBytes) }"
                  />
                </div>
                <div class="pf-perf-stat-mini">
                  <span>命中 {{ storageStats.textMemory.hits }}</span>
                  <span>未命中 {{ storageStats.textMemory.misses }}</span>
                  <span>命中率 {{ (storageStats.textMemory.hitRate * 100).toFixed(1) }}%</span>
                  <span>淘汰 {{ storageStats.textMemory.evictions }}</span>
                </div>
              </div>

              <!-- L2 OPFS -->
              <div class="pf-panel-section">
                <div class="pf-panel-label">L2 OPFS 文件存储</div>
                <div class="pf-perf-status-row">
                  <span
                    class="pf-perf-badge"
                    :class="storageStats.opfsAvailable ? 'pf-perf-badge-ok' : 'pf-perf-badge-err'"
                  >
                    {{ storageStats.opfsAvailable ? '可用' : '不可用（已降级）' }}
                  </span>
                </div>
              </div>

              <!-- L3 Redb -->
              <div class="pf-panel-section">
                <div class="pf-panel-label">L3 Redb 数据库</div>
                <div class="pf-perf-path">
                  <span v-if="storagePath">{{ storagePath }}</span>
                  <span v-else class="pf-perf-path-na">浏览器环境未启用（需 Tauri 桌面运行时）</span>
                </div>
              </div>
            </template>
            <div v-else class="pf-canvas-placeholder">无统计数据</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
