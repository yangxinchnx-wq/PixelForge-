/**
 * useExportSettings — 导出设置状态 + 逻辑（从 App.vue 提取）。
 *
 * 管理格式选择、质量等级、编解码器检测、导出执行、进度追踪。
 */

import { ref, computed, reactive, watch } from 'vue';
import { useAssetStore } from '@/assets/assetStore';
import { useRuntimeStore } from '@/stores/runtime';
import { usePlaybackStore } from '@/stores/playbackStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useRenderStore } from '@/editor/render/renderStore';
import { createRuntimeFrameRenderer } from '@/editor/render/runtimeFrameRenderer';
import { seconds } from '@/editor/render/timelineTypes';
import type { RenderConfig } from '@/editor/render/renderConfig';
import type { FrameExporter } from '@/editor/render/renderPipeline';
import {
  EXPORT_FORMATS,
  QUALITY_PRESETS,
  getQualityPreset,
  detectCodecSupport,
  downloadBlob,
  type ExportFormatId,
  type QualityLevel,
} from '@/media/video/encoder/videoEncoderTypes';

export type ExportSource = 'assets' | 'runtime';

export function useExportSettings(resolution: { value: string }, frameRate: { value: string }) {
  const assetStore = useAssetStore();
  const runtimeStore = useRuntimeStore();
  const playbackStore = usePlaybackStore();
  const timelineStore = useTimelineStore();
  const renderStore = useRenderStore();

  const renderFormat = ref<ExportFormatId>('h264');
  const renderQuality = ref<QualityLevel>('high');
  const renderTargetBitrate = ref(10);
  const renderPerImageDuration = ref(3);
  const renderOutputName = ref('PixelForge_Export');
  const isExporting = ref(false);
  const exportProgress = ref(0);
  const exportError = ref<string | null>(null);
  const exportDone = ref(false);

  // ── Runtime 逐帧渲染导出状态 ──
  /** 渲染源：资源库图片序列 / WebGPU 画布逐帧渲染 */
  const renderSource = ref<ExportSource>('assets');
  /** Runtime 导出时长（秒），默认取统一时间轴时长（上限 30s 控制导出规模） */
  const runtimeDuration = ref(Math.min(timelineStore.timelineContent.duration || 5, 30));
  /** Runtime 是否就绪 */
  const runtimeReady = computed(() => runtimeStore.isReady);

  const codecSupport = reactive<Record<ExportFormatId, boolean>>({
    h264: true,
    hevc: true,
    av1: true,
    vp9: true,
  });
  const isCodecDetecting = ref(true);

  const formatOpts = computed(() =>
    EXPORT_FORMATS.map((fmt) => ({
      value: fmt.id,
      label: codecSupport[fmt.id] ? fmt.label : `${fmt.label}（当前设备不支持）`,
      disabled: !codecSupport[fmt.id],
    })),
  );

  const qualityOpts = computed(() =>
    QUALITY_PRESETS.map((p) => ({
      value: p.id,
      label: p.label,
      tooltip: p.tooltip,
    })),
  );

  const parsedResolution = computed(() => {
    const m = resolution.value.match(/(\d+)\s*[×x]\s*(\d+)/);
    return m ? { w: parseInt(m[1]), h: parseInt(m[2]) } : { w: 1920, h: 1080 };
  });

  const parsedFps = computed(() => {
    const m = frameRate.value.match(/(\d+)/);
    return m ? parseInt(m[1]) : 30;
  });

  const exportDuration = computed(() => {
    if (renderSource.value === 'runtime') return runtimeDuration.value;
    const imageCount = assetStore.images.length;
    if (imageCount === 0) return 0;
    return imageCount * renderPerImageDuration.value;
  });

  /** Runtime 导出预计帧数（按导出帧率） */
  const runtimeFrameCount = computed(() =>
    Math.max(1, Math.ceil(runtimeDuration.value * parsedFps.value)),
  );

  const currentFormatInfo = computed(() =>
    EXPORT_FORMATS.find((f) => f.id === renderFormat.value),
  );

  const estimatedFileSize = computed(() => {
    const duration = exportDuration.value;
    if (duration === 0) return '—';
    const qualityPreset = getQualityPreset(renderQuality.value);
    const actualBitrate = renderTargetBitrate.value * qualityPreset.bitrateMultiplier;
    const sizeMB = (actualBitrate * duration) / 8;
    if (sizeMB >= 1024) return `${(sizeMB / 1024).toFixed(2)} GB`;
    return `${sizeMB.toFixed(1)} MB`;
  });

  const canExport = computed(() => {
    if (isExporting.value || isCodecDetecting.value) return false;
    if (!codecSupport[renderFormat.value]) return false;
    if (renderSource.value === 'runtime') return runtimeReady.value && runtimeDuration.value > 0;
    return assetStore.images.length > 0;
  });

  const exportBtnTooltip = computed(() => {
    if (isCodecDetecting.value) return '正在检测硬件编码支持…';
    if (!codecSupport[renderFormat.value]) return '当前设备不支持此编码格式';
    if (renderSource.value === 'runtime') {
      if (!runtimeReady.value) return 'WebGPU Runtime 未就绪，请先在「图片」页初始化画布';
      return '';
    }
    if (assetStore.images.length === 0) return '没有可导出的图片，请先导入或生成图片';
    return '';
  });

  async function detectHardwareSupport() {
    isCodecDetecting.value = true;
    try {
      const { w, h } = parsedResolution.value;
      const bitrate = renderTargetBitrate.value * 1_000_000;
      const support = await detectCodecSupport(w, h, bitrate);
      for (const fmt of EXPORT_FORMATS) {
        codecSupport[fmt.id] = support.get(fmt.id) ?? false;
      }
      if (!codecSupport[renderFormat.value]) {
        const firstSupported = EXPORT_FORMATS.find((f) => codecSupport[f.id]);
        if (firstSupported) renderFormat.value = firstSupported.id;
      }
    } catch (e) {
      console.error('[Export] 编解码器检测失败:', e);
    } finally {
      isCodecDetecting.value = false;
    }
  }

  async function startExport() {
    if (isExporting.value) return;
    if (renderSource.value === 'runtime') {
      await startRuntimeExport();
      return;
    }
    if (assetStore.images.length === 0) {
      exportError.value = '没有可导出的图片，请先在画布中导入或生成图片';
      return;
    }
    isExporting.value = true;
    exportProgress.value = 0;
    exportError.value = null;
    exportDone.value = false;
    try {
      const formatInfo = currentFormatInfo.value;
      if (!formatInfo) throw new Error('未知的导出格式');
      const { w, h } = parsedResolution.value;
      const imageUrls = assetStore.images.map((a) => a.url);
      const { encodeImagesToVideo } = await import('@/media/video/encoder/videoEncoder');
      const blob = await encodeImagesToVideo({
        imageUrls,
        width: w,
        height: h,
        fps: parsedFps.value,
        perImageDuration: renderPerImageDuration.value,
        bitrate: renderTargetBitrate.value * 1_000_000,
        format: renderFormat.value,
        quality: renderQuality.value,
        onProgress: (p) => { exportProgress.value = p; },
      });
      const filename = `${renderOutputName.value || 'PixelForge_Export'}.${formatInfo.ext}`;
      downloadBlob(blob, filename);
      exportDone.value = true;
    } catch (e) {
      exportError.value = (e as Error).message;
      console.error('[Export] 导出失败:', e);
    } finally {
      isExporting.value = false;
    }
  }

  /**
   * Runtime 逐帧渲染导出：
   *   统一时间轴 → createRuntimeFrameRenderer（设时间 → 求值 → 补丁 → GPU 渲染 → 抓帧）
   *   → RenderPipeline/RenderStore 状态机逐帧调度 → WebCodecs 编码 → 下载
   */
  async function startRuntimeExport() {
    if (!runtimeReady.value) {
      exportError.value = 'WebGPU Runtime 未就绪，请先在「图片」页初始化画布';
      return;
    }

    isExporting.value = true;
    exportProgress.value = 0;
    exportError.value = null;
    exportDone.value = false;

    // 暂停播放，避免逐帧渲染期间画布被实时播放扰动
    const wasPlaying = playbackStore.isPlaying;
    playbackStore.isPlaying = false;
    playbackStore.stopPlayback();

    const frameUrls: string[] = [];
    let adapter: ReturnType<typeof createRuntimeFrameRenderer> | null = null;

    try {
      const formatInfo = currentFormatInfo.value;
      if (!formatInfo) throw new Error('未知的导出格式');
      const { w, h } = parsedResolution.value;
      const fps = parsedFps.value;
      const duration = Math.max(runtimeDuration.value, 1 / fps);

      const config: RenderConfig = {
        outputWidth: w,
        outputHeight: h,
        fps,
        format: formatInfo.container === 'webm' ? 'webm' : 'mp4',
        quality: 'standard',
        startTime: seconds(0),
        endTime: seconds(duration),
        outputName: renderOutputName.value || 'PixelForge_Runtime',
        alpha: false,
        bitrateKbps: Math.round(renderTargetBitrate.value * 1000),
      };

      adapter = createRuntimeFrameRenderer(runtimeStore, {
        timeline: timelineStore.timelineContent,
        restoreAfterRender: true,
      });

      // 收集每帧 PNG（blob URL），编码阶段统一消费
      const collectExporter: FrameExporter = async (frame) => {
        // new Uint8Array(...) 做一次拷贝，得到独立的 ArrayBuffer 以满足 BlobPart 类型
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(frame.data)], { type: 'image/png' }),
        );
        frameUrls.push(url);
        return `frame_${String(frame.frameIndex).padStart(6, '0')}.png`;
      };

      const started = renderStore.startRender(
        config.outputName,
        config,
        adapter.frameRenderer,
        collectExporter,
      );
      if (!started) throw new Error('渲染任务启动失败（可能已有渲染任务在运行）');

      // 等待 RenderPipeline 终态；帧采集进度映射到 0-60%
      await new Promise<void>((resolve, reject) => {
        const stopStatus = watch(() => renderStore.status, (s) => {
          if (s === 'completed') {
            stopWatchers();
            resolve();
          } else if (s === 'failed' || s === 'cancelled') {
            stopWatchers();
            reject(new Error(renderStore.error ?? (s === 'failed' ? '渲染失败' : '渲染已取消')));
          }
        });
        const stopProgress = watch(() => renderStore.progress, (p) => {
          exportProgress.value = Math.round(p * 0.6);
        });
        const stopWatchers = () => {
          stopStatus();
          stopProgress();
        };
        // 兜底：任务在 watcher 挂载前已进入终态
        const s = renderStore.status;
        if (s === 'completed') {
          stopWatchers();
          resolve();
        } else if (s === 'failed' || s === 'cancelled') {
          stopWatchers();
          reject(new Error(renderStore.error ?? '渲染已终止'));
        }
      });

      if (frameUrls.length === 0) throw new Error('没有渲染出任何帧');

      // WebCodecs 编码（进度映射到 60-100%），每帧恰好对应一个视频帧
      const { encodeImagesToVideo } = await import('@/media/video/encoder/videoEncoder');
      const blob = await encodeImagesToVideo({
        imageUrls: frameUrls,
        width: w,
        height: h,
        fps,
        perImageDuration: 1 / fps,
        bitrate: renderTargetBitrate.value * 1_000_000,
        format: renderFormat.value,
        quality: renderQuality.value,
        onProgress: (p) => {
          exportProgress.value = 60 + p * 0.4;
        },
      });

      const filename = `${renderOutputName.value || 'PixelForge_Runtime'}.${formatInfo.ext}`;
      downloadBlob(blob, filename);
      exportDone.value = true;
    } catch (e) {
      exportError.value = (e as Error).message;
      console.error('[Export] Runtime 逐帧导出失败:', e);
    } finally {
      // 恢复播放、画布与渲染任务状态
      if (wasPlaying) playbackStore.isPlaying = true;
      try {
        await adapter?.restore();
      } catch {
        // 恢复失败不阻断导出结果
      }
      for (const url of frameUrls) URL.revokeObjectURL(url);
      renderStore.clearJob();
      isExporting.value = false;
    }
  }

  let detectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch([resolution, renderTargetBitrate], () => {
    if (detectDebounceTimer) clearTimeout(detectDebounceTimer);
    detectDebounceTimer = setTimeout(() => {
      void detectHardwareSupport();
      detectDebounceTimer = null;
    }, 600);
  }, { immediate: true });

  return {
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
    codecSupport,
    isCodecDetecting,
    formatOpts,
    qualityOpts,
    parsedResolution,
    parsedFps,
    exportDuration,
    currentFormatInfo,
    estimatedFileSize,
    canExport,
    exportBtnTooltip,
    detectHardwareSupport,
    startExport,
  };
}
