import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ParameterTrack, Interpolation } from '../types';
import type { JsonLiteral } from '@/shared/types';
import { createKeyframe as createUnifiedKeyframe } from '@/world/timeline/timelineManager';
import {
  legacyInterpolationToUnified,
  timelineToLegacyTracks,
  unifiedTrackToLegacy,
} from '@/world/timeline/unifiedTimeline';
import { useTimelineStore } from './timelineStore';
import { evaluateTrack } from '@/world/timeline/evaluator';

/**
 * Keyframe Store — 兼容门面。
 *
 * TimelineContent 是唯一真实数据源；这里保留旧 paramTracks API，
 * 让旧 UI/MCP 调用者平滑迁移，而不会再维护第二份关键帧数据。
 */
export const useKeyframeStore = defineStore('keyframe', () => {
  const timelineStore = useTimelineStore();
  const selectedTrackId = ref<string | null>(null);

  const paramTracks = computed<ParameterTrack[]>(() =>
    timelineToLegacyTracks(timelineStore.timelineContent),
  );

  function addParamTrack(label: string, layerId: string, parameter: string): string {
    const id = `track_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    timelineStore.addUnifiedTrack({
      id,
      name: label,
      targetEntity: 'layer',
      targetId: layerId,
      paramKey: parameter,
      keyframes: [],
      enabled: true,
    });
    selectedTrackId.value = id;
    return id;
  }

  function removeParamTrack(trackId: string): void {
    timelineStore.removeUnifiedTrackById(trackId);
    if (selectedTrackId.value === trackId) selectedTrackId.value = null;
  }

  function addKeyframe(
    trackId: string,
    time: number,
    value: JsonLiteral,
    interpolation: Interpolation = 'linear',
  ): void {
    const track = timelineStore.timelineContent.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const existing = track.keyframes.find((keyframe) => keyframe.time === time);
    if (existing) {
      timelineStore.updateUnifiedKeyframeById(trackId, existing.id, {
        value,
        interpolation: legacyInterpolationToUnified(interpolation),
      });
      return;
    }
    const keyframe = createUnifiedKeyframe(
      Math.max(0, time),
      value,
      legacyInterpolationToUnified(interpolation),
    );
    timelineStore.addUnifiedKeyframeById(trackId, keyframe);
  }

  function updateKeyframe(
    trackId: string,
    keyframeId: string,
    time: number,
    value: JsonLiteral,
  ): void {
    timelineStore.updateUnifiedKeyframeById(trackId, keyframeId, {
      time: Math.max(0, time),
      value,
    });
  }

  function removeKeyframe(trackId: string, keyframeId: string): void {
    timelineStore.removeUnifiedKeyframeById(trackId, keyframeId);
  }

  function evaluateParamTracks(time: number): Array<{ track: ParameterTrack; value: number }> {
    return timelineStore.timelineContent.tracks.map((track) => ({
      track: unifiedTrackToLegacy(track),
      value: (() => {
        const value = evaluateTrack(track, time);
        return typeof value === 'number' ? value : 0;
      })(),
    }));
  }

  return {
    paramTracks,
    selectedTrackId,
    addParamTrack,
    removeParamTrack,
    addKeyframe,
    updateKeyframe,
    removeKeyframe,
    evaluateParamTracks,
  };
});
