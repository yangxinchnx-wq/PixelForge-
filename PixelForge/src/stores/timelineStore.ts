import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import type { Clip, Track } from '../types';
import { initialTracks, initialClips, FPS, TOTAL_DURATION } from '../data';
import { CommandHistory, type Command } from '@/utils/commandHistory';
import type { TimelineContent, TimelineTrack, TimelineKeyframe } from '@/world/types';
import {
  createDefaultUnifiedTimeline,
  normalizeTimelineContent,
} from '@/world/timeline/unifiedTimeline';
import {
  addKeyframe as addUnifiedKeyframe,
  addTrack as addUnifiedTrackContent,
  removeKeyframe as removeUnifiedKeyframe,
  removeTrack as removeUnifiedTrack,
  updateKeyframe as updateUnifiedKeyframe,
  updateTrack as updateUnifiedTrack,
} from '@/world/timeline/timelineManager';
import { evaluateTimeline } from '@/world/timeline/evaluator';

/**
 * Timeline Store — 轨道/片段管理 + 时间轴命令历史。
 *
 * 管理 tracks/clips 的 CRUD、选择状态，以及独立的 Timeline undo/redo 栈。
 */
export const useTimelineStore = defineStore('timeline', () => {
  const tracks = ref<Track[]>([...initialTracks]);
  const clips = ref<Clip[]>([...initialClips]);
  const selectedClipIds = ref<Set<string>>(new Set());

  /** Unified TimelineContent is the authoritative animation model. */
  // TimelineContent is immutable at the store boundary. shallowRef prevents
  // Pinia/Vue from recursively expanding JsonLiteral while inferring this setup store.
  const timelineContent = shallowRef<TimelineContent>(
    createDefaultUnifiedTimeline(TOTAL_DURATION, FPS),
  );
  const currentTime = ref(0);
  const isPlaying = ref(false);

  /** 全局时间轴显示开关 */
  const showTimeline = ref(false);

  function toggleTimeline(): void {
    showTimeline.value = !showTimeline.value;
  }

  function setTimelineContent(content: TimelineContent): void {
    timelineContent.value = normalizeTimelineContent(content, {
      duration: TOTAL_DURATION,
      fps: FPS,
    });
    currentTime.value = Math.min(currentTime.value, timelineContent.value.duration);
  }

  function setTimelinePlaying(playing: boolean): void {
    isPlaying.value = playing;
  }

  function seekTimeline(time: number): void {
    currentTime.value = Math.max(0, Math.min(timelineContent.value.duration, time));
  }

  function addUnifiedTrack(track: TimelineTrack): void {
    const content: TimelineContent = timelineContent.value;
    const next = addUnifiedTrackToContent(content, track) as TimelineContent;
    timelineContent.value = next;
  }

  function removeUnifiedTrackById(trackId: string): void {
    const content: TimelineContent = timelineContent.value;
    const next = removeUnifiedTrack(content, trackId) as TimelineContent;
    timelineContent.value = next;
  }

  function updateUnifiedTrackById(
    trackId: string,
    updates: Partial<Omit<TimelineTrack, 'id'>>,
  ): void {
    const content: TimelineContent = timelineContent.value;
    const next = updateUnifiedTrack(content, trackId, updates) as TimelineContent;
    timelineContent.value = next;
  }

  function addUnifiedKeyframeById(
    trackId: string,
    keyframe: TimelineKeyframe,
  ): void {
    const content: TimelineContent = timelineContent.value;
    const next = addUnifiedKeyframe(content, trackId, keyframe) as TimelineContent;
    timelineContent.value = next;
  }

  function updateUnifiedKeyframeById(
    trackId: string,
    keyframeId: string,
    updates: Partial<Omit<TimelineKeyframe, 'id'>>,
  ): void {
    const content: TimelineContent = timelineContent.value;
    const next = updateUnifiedKeyframe(content, trackId, keyframeId, updates) as TimelineContent;
    timelineContent.value = next;
  }

  function removeUnifiedKeyframeById(trackId: string, keyframeId: string): void {
    const content: TimelineContent = timelineContent.value;
    const next = removeUnifiedKeyframe(content, trackId, keyframeId) as TimelineContent;
    timelineContent.value = next;
  }

  function evaluateUnifiedTimeline(time = currentTime.value) {
    const content: TimelineContent = timelineContent.value;
    return evaluateTimeline(content, time);
  }

  function applyTimelinePatchesAt(time: number, apply: (patch: ReturnType<typeof evaluateTimeline>['patches'][number]) => void): number {
    const content: TimelineContent = timelineContent.value;
    const evaluation = evaluateTimeline(content, time);
    for (const patch of evaluation.patches) apply(patch);
    return evaluation.patches.length;
  }

  function addUnifiedTrackToContent(
    content: TimelineContent,
    track: TimelineTrack,
  ): TimelineContent {
    return addUnifiedTrackContent(content, track);
  }

  // ─── Timeline Command History ───────────────────────
  const timelineHistory = new CommandHistory();
  const timelineHistoryVersion = ref(0);

  const canUndoTimeline = computed(() => {
    void timelineHistoryVersion.value;
    return timelineHistory.canUndo();
  });
  const canRedoTimeline = computed(() => {
    void timelineHistoryVersion.value;
    return timelineHistory.canRedo();
  });

  function executeTimelineCommand(cmd: Command): void {
    timelineHistory.execute(cmd);
    timelineHistoryVersion.value++;
  }

  function undoTimeline(): void {
    timelineHistory.undo();
    timelineHistoryVersion.value++;
  }

  function redoTimeline(): void {
    timelineHistory.redo();
    timelineHistoryVersion.value++;
  }

  // ─── Clips / Tracks CRUD ───────────────────────────

  function setClips(newClips: Clip[]): void {
    clips.value = newClips;
  }

  function setTracks(newTracks: Track[]): void {
    tracks.value = newTracks;
  }

  function selectClip(clipId: string, multi = false): void {
    if (multi) {
      if (selectedClipIds.value.has(clipId)) {
        selectedClipIds.value.delete(clipId);
      } else {
        selectedClipIds.value.add(clipId);
      }
      selectedClipIds.value = new Set(selectedClipIds.value);
    } else {
      selectedClipIds.value = new Set([clipId]);
    }
  }

  function clearSelection(): void {
    selectedClipIds.value = new Set();
  }

  function deleteSelectedClips(): void {
    if (selectedClipIds.value.size === 0) return;
    const toDelete = [...selectedClipIds.value];
    const snapshot = clips.value;
    const cmd: Command = {
      label: `删除 ${toDelete.length} 个片段`,
      execute() { clips.value = snapshot.filter((c) => !toDelete.includes(c.id)); },
      undo() { clips.value = snapshot; },
    };
    executeTimelineCommand(cmd);
    clearSelection();
  }

  function toggleTrackProp(trackId: string, prop: 'muted' | 'soloed' | 'locked' | 'visible'): void {
    tracks.value = tracks.value.map((t) =>
      t.id === trackId ? { ...t, [prop]: !t[prop] } : t,
    );
  }

  return {
    tracks,
    clips,
    selectedClipIds,
    timelineContent,
    currentTime,
    isPlaying,
    showTimeline,
    toggleTimeline,
    setTimelineContent,
    setTimelinePlaying,
    seekTimeline,
    addUnifiedTrack,
    removeUnifiedTrackById,
    updateUnifiedTrackById,
    addUnifiedKeyframeById,
    updateUnifiedKeyframeById,
    removeUnifiedKeyframeById,
    evaluateUnifiedTimeline,
    applyTimelinePatchesAt,
    canUndoTimeline,
    canRedoTimeline,
    executeTimelineCommand,
    undoTimeline,
    redoTimeline,
    setClips,
    setTracks,
    selectClip,
    clearSelection,
    deleteSelectedClips,
    toggleTrackProp,
  };
});
