/**
 * PixelForge - Unified Timeline compatibility helpers.
 *
 * TimelineContent is the only authoritative animation model used by the
 * runtime, Director and render pipeline. The old ParameterTrack shape is kept
 * here only as a file/API compatibility boundary for older projects and MCP
 * callers.
 */
import type { ParameterTrack, Interpolation } from '@/types'
import type { JsonLiteral } from '@/shared/types'
import type { TimelineContent, TimelineKeyframe, TimelineTrack } from '../types'
import { createTimeline, addTrack } from './timelineManager'

export interface LegacyTimelineSnapshot {
  currentFrame?: number
  totalFrames?: number
  fps?: number
  tracks?: ParameterTrack[]
}

export function cloneTimelineContent(content: TimelineContent): TimelineContent {
  return JSON.parse(JSON.stringify(content)) as TimelineContent
}

export function normalizeTimelineContent(
  content: TimelineContent,
  fallback: { duration?: number; fps?: number } = {},
): TimelineContent {
  const fps = Number.isFinite(content.fps) && content.fps > 0 ? content.fps : (fallback.fps ?? 30)
  const duration = Number.isFinite(content.duration) && content.duration >= 0
    ? content.duration
    : (fallback.duration ?? 0)

  return {
    ...cloneTimelineContent(content),
    id: content.id || `timeline_${Date.now().toString(36)}`,
    tracks: content.tracks.map((track) => ({
      ...track,
      keyframes: [...track.keyframes].sort((a, b) => a.time - b.time),
    })),
    duration,
    fps,
    loop: Boolean(content.loop),
  }
}

export function createDefaultUnifiedTimeline(
  duration = 120,
  fps = 30,
): TimelineContent {
  return createTimeline(duration, fps, false)
}

export function currentFrameForTime(time: number, fps: number): number {
  return Math.max(0, Math.round(time * fps))
}

export function totalFramesForTimeline(timeline: TimelineContent): number {
  return Math.max(0, Math.ceil(timeline.duration * timeline.fps))
}

export function legacyInterpolationToUnified(
  interpolation: Interpolation | undefined,
): TimelineKeyframe['interpolation'] {
  switch (interpolation) {
    case 'ease':
      return 'bezier'
    case 'step':
    case 'hold':
      return interpolation
    default:
      return 'linear'
  }
}

export function unifiedInterpolationToLegacy(
  interpolation: TimelineKeyframe['interpolation'],
): Interpolation {
  return interpolation === 'bezier' ? 'ease' : interpolation
}

export function legacyTrackToUnified(track: ParameterTrack): TimelineTrack {
  return {
    id: track.id,
    name: track.label,
    targetEntity: 'layer',
    targetId: track.layerId,
    paramKey: track.parameter,
    enabled: true,
    keyframes: track.keyframes.map((keyframe) => ({
      id: keyframe.id,
      time: Math.max(0, keyframe.time),
      value: keyframe.value,
      interpolation: legacyInterpolationToUnified(keyframe.interpolation),
      ...(keyframe.cp1 && keyframe.cp2
        ? { bezierControl: {
            cp1: [keyframe.cp1.x, keyframe.cp1.y] as [number, number],
            cp2: [keyframe.cp2.x, keyframe.cp2.y] as [number, number],
          } }
        : {}),
    })),
  }
}

function toLegacyNumber(value: JsonLiteral): number {
  return typeof value === 'number' ? value : 0
}

export function unifiedTrackToLegacy(track: TimelineTrack): ParameterTrack {
  return {
    id: track.id,
    label: track.name,
    layerId: track.targetId,
    parameter: track.paramKey,
    keyframes: track.keyframes.map((keyframe) => ({
      id: keyframe.id,
      time: keyframe.time,
      value: toLegacyNumber(keyframe.value),
      interpolation: unifiedInterpolationToLegacy(keyframe.interpolation),
      ...(keyframe.bezierControl
        ? {
            cp1: {
              x: keyframe.bezierControl.cp1[0],
              y: keyframe.bezierControl.cp1[1],
            },
            cp2: {
              x: keyframe.bezierControl.cp2[0],
              y: keyframe.bezierControl.cp2[1],
            },
          }
        : {}),
    })),
  }
}

export function timelineFromLegacySnapshot(
  snapshot: LegacyTimelineSnapshot,
): TimelineContent {
  const fps = Number.isFinite(snapshot.fps) && (snapshot.fps ?? 0) > 0 ? snapshot.fps! : 30
  const totalFrames = Math.max(0, snapshot.totalFrames ?? 0)
  const duration = totalFrames > 0
    ? totalFrames / fps
    : Math.max(0, ...(snapshot.tracks ?? []).flatMap((track) => track.keyframes.map((kf) => kf.time)))

  let timeline = createTimeline(duration, fps, false)
  for (const legacyTrack of snapshot.tracks ?? []) {
    const track = legacyTrackToUnified(legacyTrack)
    timeline = addTrack(timeline, track)
  }
  return timeline
}

export function timelineToLegacyTracks(timeline: TimelineContent): ParameterTrack[] {
  return timeline.tracks.map(unifiedTrackToLegacy)
}

export function timelineHasKeyframes(timeline: TimelineContent | null): boolean {
  return Boolean(timeline?.tracks.some((track) => track.keyframes.length > 0))
}
