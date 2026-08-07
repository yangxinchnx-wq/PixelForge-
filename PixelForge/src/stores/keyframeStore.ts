import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ParameterTrack, Interpolation } from '../types';
import { evaluateAllTracks } from '@/utils/keyframe';

/**
 * Keyframe Store — 参数轨道关键帧动画管理。
 *
 * 管理 paramTracks 的 CRUD 和关键帧求值。
 */
export const useKeyframeStore = defineStore('keyframe', () => {
  const paramTracks = ref<ParameterTrack[]>([]);
  const selectedTrackId = ref<string | null>(null);

  function addParamTrack(label: string, layerId: string, parameter: string): string {
    const id = `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    paramTracks.value.push({ id, label, layerId, parameter, keyframes: [] });
    return id;
  }

  function removeParamTrack(trackId: string): void {
    paramTracks.value = paramTracks.value.filter((t) => t.id !== trackId);
  }

  function addKeyframe(trackId: string, time: number, value: number, interpolation: Interpolation = 'linear'): void {
    const track = paramTracks.value.find((t) => t.id === trackId);
    if (!track) return;
    const existing = track.keyframes.find((k) => k.time === time);
    if (existing) {
      existing.value = value;
      return;
    }
    const id = `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    track.keyframes.push({ id, time, value, interpolation });
    track.keyframes.sort((a, b) => a.time - b.time);
  }

  function updateKeyframe(trackId: string, keyframeId: string, time: number, value: number): void {
    const track = paramTracks.value.find((t) => t.id === trackId);
    if (!track) return;
    const kf = track.keyframes.find((k) => k.id === keyframeId);
    if (!kf) return;
    kf.time = Math.max(0, time);
    kf.value = value;
    track.keyframes.sort((a, b) => a.time - b.time);
  }

  function removeKeyframe(trackId: string, keyframeId: string): void {
    const track = paramTracks.value.find((t) => t.id === trackId);
    if (!track) return;
    track.keyframes = track.keyframes.filter((k) => k.id !== keyframeId);
  }

  function evaluateParamTracks(time: number): Array<{ track: ParameterTrack; value: number }> {
    return evaluateAllTracks(paramTracks.value, time);
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
