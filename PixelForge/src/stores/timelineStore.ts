import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Clip, Track } from '../types';
import { initialTracks, initialClips } from '../data';
import { CommandHistory, type Command } from '@/utils/commandHistory';

/**
 * Timeline Store — 轨道/片段管理 + 时间轴命令历史。
 *
 * 管理 tracks/clips 的 CRUD、选择状态，以及独立的 Timeline undo/redo 栈。
 */
export const useTimelineStore = defineStore('timeline', () => {
  const tracks = ref<Track[]>([...initialTracks]);
  const clips = ref<Clip[]>([...initialClips]);
  const selectedClipIds = ref<Set<string>>(new Set());

  /** 全局时间轴显示开关 */
  const showTimeline = ref(false);

  function toggleTimeline(): void {
    showTimeline.value = !showTimeline.value;
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
    showTimeline,
    toggleTimeline,
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
