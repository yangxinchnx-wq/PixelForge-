<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useAppStore } from '../stores/app';
import type { Clip, Track } from '../types';
import { TOTAL_DURATION, FPS, formatTimecode } from '../data';
import { collectSnapTargets, snapOrDefault, DEFAULT_SNAP_THRESHOLD } from '../utils/snapEngine';
import { resolveCollision, clampResizeLeft, clampResizeRight } from '../utils/collision';
import type { Command } from '../utils/commandHistory';
import AudioMixerPanel from './AudioMixerPanel.vue';
import DirectorPanel from './DirectorPanel.vue';

const props = defineProps<{
  currentTime: number;
  isPlaying: boolean;
}>();

const emit = defineEmits<{
  seek: [time: number];
  togglePlay: [];
}>();

const store = useAppStore();

// ─── State (from store) ──────────────────────────────
const tracks = computed(() => store.tracks);
const clips = computed(() => store.clips);
const selectedClipIds = computed(() => store.selectedClipIds);
const hasSelectedClips = computed(() => selectedClipIds.value.size > 0);
const canUndoTimeline = computed(() => store.canUndoTimeline);
const canRedoTimeline = computed(() => store.canRedoTimeline);

const pps = ref(30);

// ─── 音频混音器面板 ───────────────────────────────────
const showMixer = ref(false);

// ─── AI Director 面板 ───────────────────────────────
const showDirector = ref(false);

// ─── Snap indicator ──────────────────────────────────
const dragLineStart = ref<number | null>(null);
const dragLineEnd = ref<number | null>(null);

// ─── Drag snapshot (for undo/redo) ───────────────────
let dragBeforeClips: Clip[] | null = null;

type DragState =
  | { type: 'playhead' }
  | { type: 'clip-move'; clipId: string; grabOffsetX: number; selectedIds: Set<string> }
  | { type: 'clip-resize-left'; clipId: string; originalStart: number; originalDuration: number }
  | { type: 'clip-resize-right'; clipId: string }
  | { type: 'ruler-seek' }
  | null;

const dragState = ref<DragState>(null);
const tracksScrollRef = ref<HTMLElement | null>(null);
const trackHeadersListRef = ref<HTMLElement | null>(null);
const tracksScrollTop = ref(0);
const zoomSliderRef = ref<HTMLElement | null>(null);

// ─── Context menu ─────────────────────────────────────
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuRef = ref<HTMLElement | null>(null);
const contextMenuTrackId = ref<string>('');
const contextMenuPasteTime = ref(0);
const contextMenuHasClip = ref(false);

// ─── Clipboard ────────────────────────────────────────
let clipboard: Clip[] | null = null;

// ─── Clip warning modal (叹号图标弹窗) ──────────────────
const warningModalVisible = ref(false);
const warningModalClipId = ref<string | null>(null);
const warningModalClip = computed(() => {
  if (!warningModalClipId.value) return null;
  return clips.value.find(c => c.id === warningModalClipId.value) ?? null;
});

// ─── Constants ────────────────────────────────────────
const MIN_PPS = 8;
const MAX_PPS = 120;
const MIN_CLIP_DURATION = 0.5;
const SNAP_THRESHOLD = DEFAULT_SNAP_THRESHOLD;

// ─── Keyboard ─────────────────────────────────────────
function handleKeyDown(e: KeyboardEvent) {
  const activeTag = document.activeElement?.tagName;
  const isEditingText = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

  if (e.code === 'Space' && !isEditingText) {
    e.preventDefault();
    emit('togglePlay');
  } else if (e.key === 'ArrowLeft' && !isEditingText) {
    e.preventDefault();
    emit('seek', Math.max(0, props.currentTime - (e.shiftKey ? 1 : 1 / FPS)));
  } else if (e.key === 'ArrowRight' && !isEditingText) {
    e.preventDefault();
    emit('seek', Math.min(TOTAL_DURATION, props.currentTime + (e.shiftKey ? 1 : 1 / FPS)));
  } else if (e.key === 'Home' && !isEditingText) {
    e.preventDefault();
    emit('seek', 0);
  } else if (e.key === 'End' && !isEditingText) {
    e.preventDefault();
    emit('seek', TOTAL_DURATION);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditingText) {
    if (hasSelectedClips.value) {
      e.preventDefault();
      store.deleteSelectedClips();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isEditingText) {
    e.preventDefault();
    if (e.shiftKey) {
      store.redoTimeline();
    } else {
      store.undoTimeline();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'y' && !isEditingText) {
    e.preventDefault();
    store.redoTimeline();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('click', closeContextMenu);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('click', closeContextMenu);
});

// ─── Helper: set clips via store ─────────────────────
function updateClips(newClips: Clip[]): void {
  store.setClips(newClips);
}

// ─── Pointer move (drag) ──────────────────────────────
function handlePointerMove(e: PointerEvent) {
  const ds = dragState.value;
  if (!ds) return;
  const scrollEl = tracksScrollRef.value;
  if (!scrollEl) return;
  const scrollRect = scrollEl.getBoundingClientRect();
  const x = e.clientX - scrollRect.left + scrollEl.scrollLeft;
  const timeFromX = (px: number) => Math.max(0, px / pps.value);

  if (ds.type === 'playhead' || ds.type === 'ruler-seek') {
    emit('seek', Math.min(TOTAL_DURATION, timeFromX(x)));
    return;
  }

  if (ds.type === 'clip-move') {
    const clip = clips.value.find(c => c.id === ds.clipId);
    if (!clip) return;

    let newStart = Math.max(0, timeFromX(x - ds.grabOffsetX));
    newStart = Math.min(newStart, TOTAL_DURATION - clip.duration);

    // ── 吸附引擎（对拖动片段的左边缘和右边缘进行吸附） ──
    const snapTargets = collectSnapTargets(
      clips.value,
      ds.clipId,
      props.currentTime,
    );

    const clipEnd = newStart + clip.duration;
    const snappedStart = snapOrDefault(newStart, snapTargets, SNAP_THRESHOLD);
    const snappedEnd = snapOrDefault(clipEnd, snapTargets, SNAP_THRESHOLD);

    if (snappedStart !== newStart) {
      newStart = snappedStart;
    } else if (snappedEnd !== clipEnd) {
      newStart = snappedEnd - clip.duration;
    }

    // ── 计算位移量，应用到所有选中片段 ──
    const delta = newStart - clip.start;

    // ── 碰撞检测：检查选中片段移动后是否与非选中片段碰撞 ──
    const selectedClips = clips.value.filter(c => ds.selectedIds.has(c.id));
    const otherClips = clips.value.filter(c => !ds.selectedIds.has(c.id));
    const movedClips = selectedClips.map(c => ({ ...c, start: c.start + delta }));

    let hasOverlap = false;
    for (const mc of movedClips) {
      for (const oc of otherClips) {
        if (oc.trackId !== mc.trackId) continue;
        if (mc.start < oc.start + oc.duration && oc.start < mc.start + mc.duration) {
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) break;
    }

    if (!hasOverlap) {
      updateClips(
        clips.value.map(c =>
          ds.selectedIds.has(c.id)
            ? { ...c, start: c.start + delta }
            : c
        ),
      );
      const minStart = Math.min(...movedClips.map(c => c.start));
      const maxEnd = Math.max(...movedClips.map(c => c.start + c.duration));
      dragLineStart.value = minStart;
      dragLineEnd.value = maxEnd;
    } else {
      // 碰撞时只移动单个 clip（用 resolveCollision）
      newStart = resolveCollision(clips.value, ds.clipId, newStart, TOTAL_DURATION);
      updateClips(
        clips.value.map((c) =>
          c.id === ds.clipId ? { ...c, start: newStart } : c,
        ),
      );
      dragLineStart.value = newStart;
      dragLineEnd.value = newStart + clip.duration;
    }
    return;
  }

  if (ds.type === 'clip-resize-left') {
    let newStart = Math.max(0, timeFromX(x));
    const maxStart = ds.originalStart + ds.originalDuration - MIN_CLIP_DURATION;
    newStart = Math.min(newStart, maxStart);

    // ── 吸附左边缘 ──
    const snapTargets = collectSnapTargets(
      clips.value,
      ds.clipId,
      props.currentTime,
    );
    newStart = snapOrDefault(newStart, snapTargets, SNAP_THRESHOLD);

    // ── 碰撞检测：不允许左边缘越过同轨道其他 Clip 的右边缘 ──
    const fixedEnd = ds.originalStart + ds.originalDuration;
    newStart = clampResizeLeft(clips.value, ds.clipId, newStart, fixedEnd);

    const newDuration = fixedEnd - newStart;
    if (newDuration < MIN_CLIP_DURATION) return;
    updateClips(
      clips.value.map((c) =>
        c.id === ds.clipId ? { ...c, start: newStart, duration: newDuration } : c,
      ),
    );
    dragLineStart.value = newStart;
    dragLineEnd.value = null;
    return;
  }

  if (ds.type === 'clip-resize-right') {
    let newEnd = timeFromX(x);
    const clip = clips.value.find((c) => c.id === ds.clipId);
    if (!clip) return;
    let newDuration = Math.max(MIN_CLIP_DURATION, newEnd - clip.start);
    newDuration = Math.min(newDuration, TOTAL_DURATION - clip.start);

    // ── 吸附右边缘 ──
    const snapTargets = collectSnapTargets(
      clips.value,
      ds.clipId,
      props.currentTime,
    );
    const snappedEnd = snapOrDefault(clip.start + newDuration, snapTargets, SNAP_THRESHOLD);
    if (snappedEnd !== clip.start + newDuration) {
      newDuration = Math.max(MIN_CLIP_DURATION, snappedEnd - clip.start);
    }

    // ── 碰撞检测：不允许右边缘侵入同轨道其他 Clip ──
    newDuration = clampResizeRight(clips.value, ds.clipId, clip.start, newDuration);
    if (newDuration < MIN_CLIP_DURATION) return;

    updateClips(
      clips.value.map((c) =>
        c.id === ds.clipId ? { ...c, duration: newDuration } : c,
      ),
    );
    dragLineStart.value = null;
    dragLineEnd.value = clip.start + newDuration;
    return;
  }
}

function handlePointerUp() {
  const ds = dragState.value;

  // ── 提交 undo/redo 命令 ──
  if (ds && dragBeforeClips) {
    const before = dragBeforeClips;
    const after = [...clips.value];

    // 检查是否有实际变化
    const changed = before.some((b, i) => {
      const a = after[i];
      return !a || b.start !== a.start || b.duration !== a.duration;
    }) || before.length !== after.length;

    if (changed) {
      const labelMap: Record<string, string> = {
        'clip-move': '移动片段',
        'clip-resize-left': '修剪片段（左）',
        'clip-resize-right': '修剪片段（右）',
      };
      const label = ds.type in labelMap ? labelMap[ds.type] : '编辑片段';
      const cmd: Command = {
        label,
        execute() { store.setClips([...after]); },
        undo() { store.setClips([...before]); },
      };
      store.executeTimelineCommand(cmd);
    }
  }

  dragBeforeClips = null;
  dragLineStart.value = null;
  dragLineEnd.value = null;
  dragState.value = null;
}

// Watch dragState to add/remove window listeners
watch(dragState, (newVal) => {
  if (newVal) {
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  } else {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }
});

onUnmounted(() => {
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointermove', handleZoomSliderPointerMove);
  window.removeEventListener('pointerup', handleZoomSliderPointerUp);
});

// ─── Ruler seek ───────────────────────────────────────
function handleRulerPointerDown(e: PointerEvent) {
  e.preventDefault();
  const scrollEl = tracksScrollRef.value;
  if (!scrollEl) return;
  const scrollRect = scrollEl.getBoundingClientRect();
  const x = e.clientX - scrollRect.left + scrollEl.scrollLeft;
  emit('seek', Math.min(TOTAL_DURATION, Math.max(0, x / pps.value)));
  dragState.value = { type: 'ruler-seek' };
}

// ─── Playhead drag ────────────────────────────────────
function handlePlayheadPointerDown(e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  dragState.value = { type: 'playhead' };
}

// ─── Clip drag ────────────────────────────────────────
function handleClipPointerDown(e: PointerEvent, clip: Clip) {
  e.preventDefault();
  e.stopPropagation();

  // ── 多选支持（Shift 或 Ctrl/Cmd+点击逐个添加/取消） ──
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    store.selectClip(clip.id, true);
  } else if (!selectedClipIds.value.has(clip.id)) {
    store.selectClip(clip.id, false);
  }

  const clipEl = e.currentTarget as HTMLElement;
  const clipRect = clipEl.getBoundingClientRect();
  const grabOffsetX = e.clientX - clipRect.left;

  const target = e.target as HTMLElement;
  if (target.classList.contains('clip-handle-left')) {
    dragBeforeClips = [...clips.value];
    dragState.value = {
      type: 'clip-resize-left',
      clipId: clip.id,
      originalStart: clip.start,
      originalDuration: clip.duration,
    };
    return;
  }
  if (target.classList.contains('clip-handle-right')) {
    dragBeforeClips = [...clips.value];
    dragState.value = { type: 'clip-resize-right', clipId: clip.id };
    return;
  }

  // ── 记录当前选中片段（拖动时整体移动） ──
  const selectedIds = new Set(selectedClipIds.value);
  if (selectedIds.size === 0) selectedIds.add(clip.id);

  dragBeforeClips = [...clips.value];
  dragState.value = { type: 'clip-move', clipId: clip.id, grabOffsetX, selectedIds };
}

// ─── Track toggle ─────────────────────────────────────
function toggleTrack(trackId: string, prop: 'muted' | 'soloed' | 'locked' | 'visible') {
  store.toggleTrackProp(trackId, prop);
}

// ─── Zoom ─────────────────────────────────────────────
function handleZoom(dir: 'in' | 'out') {
  const next = dir === 'in' ? pps.value * 1.25 : pps.value / 1.25;
  pps.value = Math.max(MIN_PPS, Math.min(MAX_PPS, next));
}

function updateZoomFromClientX(clientX: number) {
  const slider = zoomSliderRef.value;
  if (!slider) return;
  const rect = slider.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  pps.value = MIN_PPS + ratio * (MAX_PPS - MIN_PPS);
}

function handleZoomSliderPointerDown(e: PointerEvent) {
  e.preventDefault();
  updateZoomFromClientX(e.clientX);
  window.addEventListener('pointermove', handleZoomSliderPointerMove);
  window.addEventListener('pointerup', handleZoomSliderPointerUp);
}

function handleZoomSliderPointerMove(e: PointerEvent) {
  updateZoomFromClientX(e.clientX);
}

function handleZoomSliderPointerUp() {
  window.removeEventListener('pointermove', handleZoomSliderPointerMove);
  window.removeEventListener('pointerup', handleZoomSliderPointerUp);
}

// ─── Track header / lane scroll sync ──────────────────
function handleTracksScroll() {
  const scrollEl = tracksScrollRef.value;
  const headersEl = trackHeadersListRef.value;
  if (scrollEl) tracksScrollTop.value = scrollEl.scrollTop;
  if (!scrollEl || !headersEl) return;
  headersEl.scrollTop = scrollEl.scrollTop;
}

// ─── Wheel: left=vertical, right=horizontal ───────────
function handleHeadersWheel(e: WheelEvent) {
  e.preventDefault();
  const scrollEl = tracksScrollRef.value;
  if (!scrollEl) return;
  scrollEl.scrollTop += e.deltaY;
}

function handleTracksWheel(e: WheelEvent) {
  e.preventDefault();
  const scrollEl = tracksScrollRef.value;
  if (!scrollEl) return;
  // 垂直滚轮 → 水平滚动；触控板水平滚动(deltaX)也直接使用
  scrollEl.scrollLeft += e.deltaY || e.deltaX;
}

// ─── Cut (with undo/redo) ─────────────────────────────
function handleCut() {
  const selectedId = [...selectedClipIds.value][0];
  if (!selectedId) return;
  const clip = clips.value.find((c) => c.id === selectedId);
  if (!clip) return;
  if (props.currentTime <= clip.start || props.currentTime >= clip.start + clip.duration) return;

  const before = [...clips.value];
  const firstHalf: Clip = { ...clip, duration: props.currentTime - clip.start };
  const secondHalf: Clip = {
    ...clip,
    id: clip.id + '-split-' + Date.now().toString(36),
    start: props.currentTime,
    duration: clip.start + clip.duration - props.currentTime,
  };
  const after = clips.value.flatMap((c) =>
    c.id === selectedId ? [firstHalf, secondHalf] : [c],
  );

  const cmd: Command = {
    label: '切割片段',
    execute() { store.setClips([...after]); },
    undo() { store.setClips([...before]); },
  };
  store.executeTimelineCommand(cmd);
  store.selectClip(secondHalf.id, false);
}

// ─── Undo / Redo ──────────────────────────────────────
function handleUndo() {
  store.undoTimeline();
}

function handleRedo() {
  store.redoTimeline();
}

// ─── Background click (clear selection) ───────────────
function handleBackgroundClick() {
  store.clearSelection();
}

// ─── Derived ──────────────────────────────────────────
const hasSolo = computed(() => tracks.value.some((t) => t.soloed));

function isTrackActive(track: Track): boolean {
  if (track.locked) return false;
  if (hasSolo.value) return track.soloed;
  return !track.muted;
}

const tc = computed(() => formatTimecode(props.currentTime, FPS));
const projectDuration = computed(() => {
  if (clips.value.length === 0) return 0;
  return Math.max(...clips.value.map(c => c.start + c.duration));
});
const totalTc = computed(() => formatTimecode(projectDuration.value, FPS));

// ─── Ruler ticks ──────────────────────────────────────
const tickInterval = computed(() => {
  if (pps.value < 15) return 10;
  if (pps.value < 30) return 5;
  if (pps.value < 60) return 2;
  return 1;
});

const ticks = computed(() => {
  const result: { time: number; major: boolean }[] = [];
  const interval = tickInterval.value;
  for (let t = 0; t <= TOTAL_DURATION; t += interval) {
    result.push({ time: t, major: true });
  }
  const minorInterval = interval / 5;
  for (let t = 0; t <= TOTAL_DURATION; t += minorInterval) {
    if (t % interval !== 0) {
      result.push({ time: t, major: false });
    }
  }
  return result;
});

// ─── Waveform ─────────────────────────────────────────
function generateWaveformBars(count: number, seed: number): number[] {
  const bars: number[] = [];
  let s = seed;
  for (let i = 0; i < count; i++) {
    s = (s * 9301 + 49297) % 233280;
    bars.push(0.2 + (s / 233280) * 0.8);
  }
  return bars;
}

function getWaveBars(clip: Clip): number[] {
  if (clip.type !== 'audio') return [];
  const width = clip.duration * pps.value;
  return generateWaveformBars(Math.max(8, Math.floor(width / 4)), clip.id.length * 17);
}

function getThumbnailCount(clip: Clip): number {
  if (clip.type !== 'video') return 0;
  const width = clip.duration * pps.value;
  return Math.max(2, Math.floor(width / 30));
}

function clipsForTrack(trackId: string): Clip[] {
  return clips.value.filter((c) => c.trackId === trackId);
}

function clipCountForTrack(trackId: string): number {
  return clips.value.filter((c) => c.trackId === trackId).length;
}

function isDragging(clipId: string): boolean {
  const ds = dragState.value;
  if (!ds) return false;
  return (
    (ds.type === 'clip-move' || ds.type === 'clip-resize-left' || ds.type === 'clip-resize-right') &&
    ds.clipId === clipId
  );
}

/** 拖动时，该 clip 是否属于选中集（用于显示选中轮廓） */
function isInDragGroup(clipId: string): boolean {
  return selectedClipIds.value.has(clipId);
}

// ─── Context menu helpers ────────────────────────────

/** 将鼠标 X 坐标转换为轨道上的时间 */
function clientXToTrackTime(clientX: number): number {
  const scrollEl = tracksScrollRef.value;
  if (!scrollEl) return 0;
  const scrollRect = scrollEl.getBoundingClientRect();
  const x = clientX - scrollRect.left + scrollEl.scrollLeft;
  return Math.max(0, x / pps.value);
}

/** 显示右键菜单（限制在轨道区域内，始终优先向上展开） */
function showContextMenuAt(clientX: number, clientY: number) {
  contextMenuX.value = clientX;
  contextMenuY.value = clientY;
  contextMenuVisible.value = true;

  nextTick(() => {
    const menuEl = contextMenuRef.value;
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();

    // 以轨道滚动区域作为边界约束
    const scrollEl = tracksScrollRef.value;
    const bounds = scrollEl
      ? scrollEl.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

    // 水平：右边界溢出 → 向左偏移，左边界不溢出
    let x = clientX;
    if (x + rect.width > bounds.right - 4) {
      x = Math.max(bounds.left + 4, bounds.right - rect.width - 4);
    }
    if (x < bounds.left + 4) {
      x = bounds.left + 4;
    }

    // 垂直：始终向上展开，菜单底部贴在点击位置，永远不回退到向下
    let y = clientY - rect.height;
    // 上边界：不超出轨道区域顶部
    if (y < bounds.top + 4) {
      y = bounds.top + 4;
    }
    // 底部：不超出轨道区域底部（仅当菜单比区域还高时才上移贴底）
    if (y + rect.height > bounds.bottom - 4) {
      y = Math.max(bounds.top + 4, bounds.bottom - rect.height - 4);
    }

    contextMenuX.value = x;
    contextMenuY.value = y;
  });
}

// ─── Context menu handlers ────────────────────────────
function handleClipContextMenu(e: MouseEvent, clip: Clip) {
  e.preventDefault();
  e.stopPropagation();

  // 如果右键的片段未被选中，则只选中它
  if (!selectedClipIds.value.has(clip.id)) {
    store.selectClip(clip.id, false);
  }

  contextMenuTrackId.value = clip.trackId;
  contextMenuHasClip.value = true;
  contextMenuPasteTime.value = clientXToTrackTime(e.clientX);

  showContextMenuAt(e.clientX, e.clientY);
}

/** 右键轨道空白区域：不选中片段，但允许粘贴 */
function handleTrackContextMenu(e: MouseEvent, trackId: string) {
  e.preventDefault();
  e.stopPropagation();

  contextMenuTrackId.value = trackId;
  contextMenuHasClip.value = false;
  contextMenuPasteTime.value = clientXToTrackTime(e.clientX);

  showContextMenuAt(e.clientX, e.clientY);
}

function closeContextMenu() {
  contextMenuVisible.value = false;
}

// ─── 删除选中片段（带 undo/redo） ──
function contextMenuDelete() {
  closeContextMenu();
  store.deleteSelectedClips();
}

// ─── 合并选中片段（同轨道相邻/重叠的合并为一个） ──
function contextMenuMerge() {
  closeContextMenu();
  const selected = clips.value.filter(c => selectedClipIds.value.has(c.id));
  if (selected.length < 2) return;

  // 按轨道分组
  const byTrack = new Map<string, Clip[]>();
  for (const c of selected) {
    if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
    byTrack.get(c.trackId)!.push(c);
  }

  const before = [...clips.value];
  let after = [...clips.value];

  for (const [, trackClips] of byTrack) {
    trackClips.sort((a, b) => a.start - b.start);
    const first = trackClips[0];
    const last = trackClips[trackClips.length - 1];
    const mergedClip: Clip = {
      ...first,
      start: first.start,
      duration: (last.start + last.duration) - first.start,
    };
    // 用第一个 clip 的 ID 作为合并后的 ID
    const idsToRemove = new Set(trackClips.map(c => c.id));
    after = after
      .filter(c => !idsToRemove.has(c.id) || c.id === first.id)
      .map(c => c.id === first.id ? mergedClip : c);
  }

  const cmd: Command = {
    label: '合并片段',
    execute() { store.setClips([...after]); },
    undo() { store.setClips([...before]); },
  };
  store.executeTimelineCommand(cmd);
  // 选中合并后的第一个片段
  const newFirstId = [...byTrack.values()][0][0].id;
  store.selectClip(newFirstId, false);
}

// ─── 复制选中片段到剪贴板 ──
function contextMenuCopy() {
  closeContextMenu();
  const selected = clips.value.filter(c => selectedClipIds.value.has(c.id));
  if (selected.length === 0) return;
  clipboard = selected.map(c => ({ ...c }));
}

// ─── 粘贴剪贴板片段（禁止覆盖，自适应/顺延） ──
function contextMenuPaste() {
  closeContextMenu();
  if (!clipboard || clipboard.length === 0) return;
  if (!contextMenuTrackId.value) return;

  const targetTrackId = contextMenuTrackId.value;
  const pasteTime = contextMenuPasteTime.value;
  const before = [...clips.value];
  let after = [...clips.value];
  const pastedIds: string[] = [];

  for (const cbClip of clipboard) {
    const origDuration = cbClip.duration;
    // 取目标轨道上已有片段（含已粘贴的），按 start 排序
    const trackClips = after
      .filter(c => c.trackId === targetTrackId)
      .sort((a, b) => a.start - b.start);

    // 找到 pasteTime 落在哪个区间
    let gapStart = 0;
    let gapEnd = TOTAL_DURATION;
    let foundGap = false;
    let onClip: Clip | null = null;

    for (let i = 0; i <= trackClips.length; i++) {
      const clip = trackClips[i];
      const prevClip = i > 0 ? trackClips[i - 1] : null;
      const prevEnd = prevClip ? prevClip.start + prevClip.duration : 0;
      const clipStart = clip ? clip.start : TOTAL_DURATION;

      if (pasteTime >= prevEnd && pasteTime < clipStart) {
        // pasteTime 落在间隙中
        gapStart = prevEnd;
        gapEnd = clipStart;
        foundGap = true;
        break;
      } else if (clip && pasteTime >= clip.start && pasteTime < clip.start + clip.duration) {
        // pasteTime 落在某个片段上
        onClip = clip;
        break;
      }
    }

    const newId = `clip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    pastedIds.push(newId);

    if (foundGap) {
      // 间隙中 → 自适应填充
      const gapSize = gapEnd - gapStart;
      const fitDuration = Math.min(origDuration, gapSize);
      const newClip: Clip = {
        ...cbClip,
        id: newId,
        trackId: targetTrackId,
        start: gapStart,
        duration: fitDuration,
        originalDuration: fitDuration < origDuration ? origDuration : undefined,
      };
      after = [...after, newClip];
    } else if (onClip) {
      // 在片段上 → 顺延：插在该片段之后，后续片段全部后推
      const insertAt = onClip.start + onClip.duration;
      const pushAmount = origDuration;
      // 把同轨道 start >= insertAt 的片段后推（排除 onClip 自身）
      after = after.map(c => {
        if (c.trackId === targetTrackId && c.start >= insertAt && c.id !== onClip!.id) {
          return { ...c, start: c.start + pushAmount };
        }
        return c;
      });
      const newClip: Clip = {
        ...cbClip,
        id: newId,
        trackId: targetTrackId,
        start: insertAt,
        duration: origDuration,
      };
      after = [...after, newClip];
    } else {
      // 在最后一个片段之后 → 直接追加
      const lastEnd = trackClips.length > 0
        ? trackClips[trackClips.length - 1].start + trackClips[trackClips.length - 1].duration
        : 0;
      const placeStart = Math.max(lastEnd, pasteTime);
      const newClip: Clip = {
        ...cbClip,
        id: newId,
        trackId: targetTrackId,
        start: placeStart,
        duration: origDuration,
      };
      after = [...after, newClip];
    }
  }

  const cmd: Command = {
    label: '粘贴片段',
    execute() { store.setClips([...after]); },
    undo() { store.setClips([...before]); },
  };
  store.executeTimelineCommand(cmd);
  // 选中新粘贴的片段
  store.clearSelection();
  pastedIds.forEach(id => store.selectClip(id, true));
}

// ─── 判断片段是否被缩短 ──
function isClipShortened(clip: Clip): boolean {
  return clip.originalDuration !== undefined && clip.originalDuration > clip.duration;
}

// ─── 叹号图标点击：弹出原始数据 + 选项框 ──
function handleWarningClick(e: MouseEvent, clip: Clip) {
  e.stopPropagation();
  e.preventDefault();
  warningModalClipId.value = clip.id;
  warningModalVisible.value = true;
}

function closeWarningModal() {
  warningModalVisible.value = false;
  warningModalClipId.value = null;
}

// ─── 选项1：保持原样（不做任何修改） ──
function warningKeepAsIs() {
  closeWarningModal();
}

// ─── 选项2：自适应（展开原始时长，推后后续片段，头尾吸附） ──
function warningAutoFit() {
  const clipId = warningModalClipId.value;
  if (!clipId) { closeWarningModal(); return; }

  const clip = clips.value.find(c => c.id === clipId);
  if (!clip || !clip.originalDuration) { closeWarningModal(); return; }

  const before = [...clips.value];
  const targetDuration = clip.originalDuration;

  // 同轨道片段按 start 排序
  const trackClips = clips.value
    .filter(c => c.trackId === clip.trackId)
    .sort((a, b) => a.start - b.start);
  const idx = trackClips.findIndex(c => c.id === clipId);
  const prevClip = idx > 0 ? trackClips[idx - 1] : null;
  const prevEnd = prevClip ? prevClip.start + prevClip.duration : 0;

  // 头部吸附：如果展开后与前一个片段重叠，则把 start 移到前一个片段之后
  let newStart = clip.start;
  if (clip.start < prevEnd) {
    newStart = prevEnd;
  }

  // 推后量 = 新末尾 - 旧末尾（同时考虑位移和展开）
  const oldEnd = clip.start + clip.duration;
  const newEnd = newStart + targetDuration;
  const pushAmount = Math.max(0, newEnd - oldEnd);

  // 推后同轨道 start >= clip.start 的后续片段（排除自身），尾部自动吸附
  const after = clips.value.map(c => {
    if (c.id === clipId) {
      return { ...c, start: newStart, duration: targetDuration, originalDuration: undefined };
    }
    if (c.trackId === clip.trackId && c.start >= clip.start && c.id !== clipId) {
      return { ...c, start: c.start + pushAmount };
    }
    return c;
  });

  const cmd: Command = {
    label: '自适应恢复片段',
    execute() { store.setClips([...after]); },
    undo() { store.setClips([...before]); },
  };
  store.executeTimelineCommand(cmd);
  closeWarningModal();
}

const zoomPercent = computed(() => ((pps.value - MIN_PPS) / (MAX_PPS - MIN_PPS)) * 100);

// ─── 右键菜单：复制是否可用 ──
const canCopyInMenu = computed(() => contextMenuHasClip.value && hasSelectedClips.value);
const canPasteInMenu = computed(() => clipboard !== null && clipboard.length > 0);
</script>

<template>
  <div class="pf-timeline">
    <!-- ─── Toolbar ─── -->
    <div class="toolbar">
      <div class="toolbar-section">
        <button class="btn btn-icon" title="跳到开头" @click="emit('seek', 0)">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 6v12h2V6H6zm3.5 6l8.5 6V6l-8.5 6z" />
          </svg>
        </button>
        <button class="btn btn-icon" title="上一帧" @click="emit('seek', Math.max(0, props.currentTime - 1 / FPS))">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M18 6v12l-8.5-6 8.5-6z" />
          </svg>
        </button>
        <button class="btn btn-primary" :title="isPlaying ? '暂停' : '播放'" @click="emit('togglePlay')">
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button class="btn btn-icon" title="下一帧" @click="emit('seek', Math.min(TOTAL_DURATION, props.currentTime + 1 / FPS))">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M6 6v12l8.5-6L6 6z" />
          </svg>
        </button>
        <button class="btn btn-icon" title="跳到结尾" @click="emit('seek', TOTAL_DURATION)">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M16 6v12h2V6h-2zm-3.5 6L4 6v12l8.5-6z" />
          </svg>
        </button>
      </div>

      <div class="toolbar-divider" />

      <div class="toolbar-section">
        <div class="time-display">
          <span>{{ tc.mm }}</span>
          <span class="time-separator">:</span>
          <span>{{ tc.ss }}</span>
          <span class="time-separator">:</span>
          <span class="time-frame">{{ tc.ff }}</span>
          <span class="time-separator time-slash">/</span>
          <span>{{ totalTc.mm }}</span>
          <span class="time-separator">:</span>
          <span>{{ totalTc.ss }}</span>
          <span class="time-separator">:</span>
          <span class="time-frame">{{ totalTc.ff }}</span>
        </div>
      </div>

      <div class="toolbar-divider" />

      <!-- Undo / Redo -->
      <div class="toolbar-section">
        <button
          class="btn btn-icon"
          :disabled="!canUndoTimeline"
          :class="{ 'btn-disabled': !canUndoTimeline }"
          title="撤销 (Ctrl+Z)"
          @click="handleUndo"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button
          class="btn btn-icon"
          :disabled="!canRedoTimeline"
          :class="{ 'btn-disabled': !canRedoTimeline }"
          title="重做 (Ctrl+Shift+Z)"
          @click="handleRedo"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
          </svg>
        </button>
      </div>

      <div class="toolbar-divider" />

      <div class="toolbar-section">
        <button class="btn btn-icon" title="剪切" @click="handleCut">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="6" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <line x1="20" y1="4" x2="8.12" y2="15.88" />
            <line x1="14.47" y1="14.48" x2="20" y2="20" />
            <line x1="8.12" y1="8.12" x2="12" y2="12" />
          </svg>
        </button>
        <button
          class="btn btn-icon"
          :disabled="!hasSelectedClips"
          :class="{ 'btn-disabled': !hasSelectedClips }"
          title="删除选中"
          @click="store.deleteSelectedClips()"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <path d="M3 6h18" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      <div class="toolbar-spacer" />

      <div class="toolbar-section">
        <button
          class="btn btn-icon"
          :class="{ 'btn-active': showMixer }"
          title="音频混音器"
          @click="showMixer = !showMixer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>
        <button
          class="btn btn-icon"
          :class="{ 'btn-active': showDirector }"
          title="AI Director · 时间轴动画"
          @click="showDirector = !showDirector"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0-1 5.87V17a3 3 0 0 0 3 3 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 3-3v-3.13A3 3 0 0 0 18 8a3 3 0 0 0-3-3 3 3 0 0 0-3-3z" />
          </svg>
        </button>
      </div>

      <div class="toolbar-section">
        <div class="zoom-control">
          <button class="zoom-btn" title="缩小" @click="handleZoom('out')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="11" cy="11" r="7" />
              <line x1="8" y1="11" x2="14" y2="11" />
              <line x1="16" y1="16" x2="21" y2="21" />
            </svg>
          </button>
          <div class="zoom-slider" ref="zoomSliderRef" @pointerdown="handleZoomSliderPointerDown">
            <div class="zoom-slider-fill" :style="{ width: zoomPercent + '%' }" />
            <div class="zoom-slider-thumb" :style="{ left: zoomPercent + '%' }" />
          </div>
          <button class="zoom-btn" title="放大" @click="handleZoom('in')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <circle cx="11" cy="11" r="7" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
              <line x1="16" y1="16" x2="21" y2="21" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- ─── Timeline Body ─── -->
    <div class="timeline-container">
      <div class="timeline-body">
        <!-- Track Headers -->
        <div class="track-headers">
          <div class="track-headers-ruler-spacer">
            <span>轨道</span>
          </div>
          <div class="track-headers-list" ref="trackHeadersListRef" @wheel.prevent="handleHeadersWheel">
            <div v-for="track in tracks" :key="track.id" class="track-header">
              <div class="track-header-top">
                <span class="track-header-name">{{ track.name }}</span>
                <div class="track-header-controls">
                  <button
                    v-if="track.type === 'video'"
                    class="track-toggle"
                    :class="{ 'active-vis': track.visible }"
                    :title="track.visible ? '隐藏' : '显示'"
                    @click="toggleTrack(track.id, 'visible')"
                  >
                    <PhEye v-if="track.visible" :size="14" weight="regular" />
                    <PhEyeSlash v-else :size="14" weight="regular" />
                  </button>
                  <button
                    v-if="track.type === 'audio'"
                    class="track-toggle"
                    :class="{ 'active-mute': track.muted }"
                    :title="track.muted ? '取消静音' : '静音'"
                    @click="toggleTrack(track.id, 'muted')"
                  >
                    M
                  </button>
                  <button
                    class="track-toggle"
                    :class="{ 'active-solo': track.soloed }"
                    title="独奏"
                    @click="toggleTrack(track.id, 'soloed')"
                  >
                    S
                  </button>
                  <button
                    class="track-toggle"
                    :class="{ 'active-lock': track.locked }"
                    :title="track.locked ? '解锁' : '锁定'"
                    @click="toggleTrack(track.id, 'locked')"
                  >
                    L
                  </button>
                </div>
              </div>
              <div class="track-header-meta">
                <span class="track-type-badge" :class="'track-type-' + track.type">
                  {{ track.type === 'video' ? '视频' : track.type === 'audio' ? '音频' : '文字' }}
                </span>
                <span>{{ clipCountForTrack(track.id) }} 个片段</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline Tracks -->
        <div class="timeline-tracks">
          <div class="tracks-scroll" ref="tracksScrollRef" @scroll="handleTracksScroll" @wheel.prevent="handleTracksWheel">
            <div
              class="tracks-inner"
              :style="{ width: TOTAL_DURATION * pps + 'px' }"
              @click.self="handleBackgroundClick"
            >
              <!-- Ruler -->
              <div class="timeline-ruler" @pointerdown="handleRulerPointerDown">
                <template v-for="(tick, i) in ticks" :key="i">
                  <div
                    class="ruler-tick"
                    :class="{ major: tick.major }"
                    :style="{ left: tick.time * pps + 'px', height: tick.major ? '100%' : '50%' }"
                  />
                  <div
                    v-if="tick.major"
                    class="ruler-label"
                    :style="{ left: tick.time * pps + 'px' }"
                  >
                    {{ String(Math.floor(tick.time / 60)).padStart(2, '0') }}:{{ String(tick.time % 60).padStart(2, '0') }}
                  </div>
                </template>
              </div>

              <!-- Tracks -->
              <div class="tracks-content" @click.self="handleBackgroundClick">
                <div
                  v-for="track in tracks"
                  :key="track.id"
                  class="track"
                  :class="{ dimmed: !isTrackActive(track) }"
                  @click.self="handleBackgroundClick"
                  @contextmenu.prevent="handleTrackContextMenu($event, track.id)"
                >
                  <div
                    v-for="clip in clipsForTrack(track.id)"
                    :key="clip.id"
                    class="clip"
                    :class="{
                      'clip-selected': selectedClipIds.has(clip.id) || isInDragGroup(clip.id),
                      'dragging': isDragging(clip.id)
                    }"
                    :style="{ left: clip.start * pps + 'px', width: clip.duration * pps + 'px' }"
                    @pointerdown="handleClipPointerDown($event, clip)"
                    @contextmenu.prevent="handleClipContextMenu($event, clip)"
                  >
                    <div class="clip-handle clip-handle-left">
                      <div class="clip-handle-grip" />
                    </div>
                    <div class="clip-header">
                      <span style="overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0">{{ clip.name }}</span>
                      <!-- 叹号图标：片段被缩短时显示 -->
                      <div
                        v-if="isClipShortened(clip)"
                        class="clip-warning-icon"
                        title="片段已被缩短，点击查看选项"
                        @click="handleWarningClick($event, clip)"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </div>
                    </div>
                    <div class="clip-body">
                      <!-- Audio waveform -->
                      <div v-if="clip.type === 'audio'" class="clip-waveform">
                        <svg width="100%" height="100%" preserveAspectRatio="none" :viewBox="`0 0 ${getWaveBars(clip).length * 4} 100`">
                          <rect
                            v-for="(h, i) in getWaveBars(clip)"
                            :key="i"
                            :x="i * 4"
                            :y="(100 - h * 80) / 2"
                            width="2"
                            :height="h * 80"
                            fill="currentColor"
                            opacity="0.7"
                            rx="1"
                          />
                        </svg>
                      </div>
                      <!-- Video thumbnails -->
                      <div v-if="clip.type === 'video'" class="clip-thumbnails">
                        <div
                          v-for="i in getThumbnailCount(clip)"
                          :key="i"
                          class="clip-thumbnail"
                        />
                      </div>
                      <!-- Text clip -->
                      <div v-if="clip.type === 'text'" style="font-size: 10px; opacity: 0.4; font-weight: 400">T</div>
                    </div>
                    <div class="clip-handle clip-handle-right">
                      <div class="clip-handle-grip" />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Drag indicator lines -->
              <div
                v-if="dragLineStart !== null"
                class="drag-line"
                :style="{ left: dragLineStart * pps + 'px' }"
              />
              <div
                v-if="dragLineEnd !== null"
                class="drag-line"
                :style="{ left: dragLineEnd * pps + 'px' }"
              />

              <!-- Playhead -->
              <div class="playhead" :style="{ left: currentTime * pps + 'px' }">
                <div class="playhead-handle" :style="{ top: tracksScrollTop + 'px' }" @pointerdown="handlePlayheadPointerDown" />
                <div class="playhead-line" :style="{ top: tracksScrollTop + 14 + 'px' }" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 音频混音器面板 -->
  <AudioMixerPanel v-model:visible="showMixer" />

  <!-- AI Director 面板 -->
  <DirectorPanel v-model:visible="showDirector" />

  <!-- 片段右键上下文菜单（Teleport 到 body 以脱离 .pf-timeline 层叠上下文） -->
  <Teleport to="body">
    <div
      v-if="contextMenuVisible"
      class="pf-clip-context-menu"
      ref="contextMenuRef"
      :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }"
      @click.stop
      @contextmenu.prevent
    >
    <button class="ctx-menu-item" @click="contextMenuDelete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
      <span>删除</span>
    </button>
    <button class="ctx-menu-item" @click="contextMenuMerge">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 7l-4 4 4 4" />
        <path d="M17 7l4 4-4 4" />
        <path d="M3 11h6" />
        <path d="M15 11h6" />
        <path d="M10 4v16" />
      </svg>
      <span>合并</span>
    </button>
    <button
      class="ctx-menu-item"
      :class="{ 'ctx-menu-item-disabled': !canCopyInMenu }"
      :disabled="!canCopyInMenu"
      @click="canCopyInMenu && contextMenuCopy()"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span>复制</span>
    </button>
    <button
      class="ctx-menu-item"
      :class="{ 'ctx-menu-item-disabled': !canPasteInMenu }"
      :disabled="!canPasteInMenu"
      @click="canPasteInMenu && contextMenuPaste()"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      </svg>
      <span>粘贴</span>
    </button>
    </div>
  </Teleport>

  <!-- 叹号图标弹窗：原始数据 + 选项 -->
  <Teleport to="body">
    <div v-if="warningModalVisible" class="pf-warning-overlay" @click.self="closeWarningModal">
      <div class="pf-warning-modal" @click.stop>
        <div class="pf-warning-modal-header">
          <span class="pf-warning-modal-title">片段已缩短</span>
          <button class="pf-warning-modal-close" @click="closeWarningModal">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div v-if="warningModalClip" class="pf-warning-modal-body">
          <div class="pf-warning-info">
            <div class="pf-warning-info-row">
              <span class="pf-warning-info-label">片段名称</span>
              <span class="pf-warning-info-value">{{ warningModalClip.name }}</span>
            </div>
            <div class="pf-warning-info-row">
              <span class="pf-warning-info-label">当前时长</span>
              <span class="pf-warning-info-value">{{ warningModalClip.duration.toFixed(2) }}s</span>
            </div>
            <div class="pf-warning-info-row">
              <span class="pf-warning-info-label">原始时长</span>
              <span class="pf-warning-info-value pf-warning-info-original">{{ warningModalClip.originalDuration?.toFixed(2) }}s</span>
            </div>
            <div class="pf-warning-info-row">
              <span class="pf-warning-info-label">起始位置</span>
              <span class="pf-warning-info-value">{{ warningModalClip.start.toFixed(2) }}s</span>
            </div>
          </div>
          <div class="pf-warning-actions">
            <button class="pf-warning-btn pf-warning-btn-secondary" @click="warningKeepAsIs">
              保持原样
            </button>
            <button class="pf-warning-btn pf-warning-btn-primary" @click="warningAutoFit">
              自适应
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
