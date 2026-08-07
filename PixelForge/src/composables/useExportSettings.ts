/**
 * useExportSettings — 导出设置状态 + 逻辑（从 App.vue 提取）。
 *
 * 管理格式选择、质量等级、编解码器检测、导出执行、进度追踪。
 */

import { ref, computed, reactive, watch } from 'vue';
import { useAssetStore } from '@/assets/assetStore';
import {
  EXPORT_FORMATS,
  QUALITY_PRESETS,
  getQualityPreset,
  detectCodecSupport,
  downloadBlob,
  type ExportFormatId,
  type QualityLevel,
} from '@/media/video/encoder/videoEncoderTypes';

export function useExportSettings(resolution: { value: string }, frameRate: { value: string }) {
  const assetStore = useAssetStore();

  const renderFormat = ref<ExportFormatId>('h264');
  const renderQuality = ref<QualityLevel>('high');
  const renderTargetBitrate = ref(10);
  const renderPerImageDuration = ref(3);
  const renderOutputName = ref('PixelForge_Export');
  const isExporting = ref(false);
  const exportProgress = ref(0);
  const exportError = ref<string | null>(null);
  const exportDone = ref(false);

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
    const imageCount = assetStore.images.length;
    if (imageCount === 0) return 0;
    return imageCount * renderPerImageDuration.value;
  });

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

  const canExport = computed(() =>
    !isExporting.value &&
    !isCodecDetecting.value &&
    assetStore.images.length > 0 &&
    codecSupport[renderFormat.value],
  );

  const exportBtnTooltip = computed(() => {
    if (isCodecDetecting.value) return '正在检测硬件编码支持…';
    if (assetStore.images.length === 0) return '没有可导出的图片，请先导入或生成图片';
    if (!codecSupport[renderFormat.value]) return '当前设备不支持此编码格式';
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

  let detectDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  watch([resolution, renderTargetBitrate], () => {
    if (detectDebounceTimer) clearTimeout(detectDebounceTimer);
    detectDebounceTimer = setTimeout(() => {
      void detectHardwareSupport();
      detectDebounceTimer = null;
    }, 600);
  });

  return {
    renderFormat,
    renderQuality,
    renderTargetBitrate,
    renderPerImageDuration,
    renderOutputName,
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
