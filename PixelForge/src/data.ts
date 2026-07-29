import type { Clip, Track } from './types';

export const FPS = 30;
export const TOTAL_DURATION = 120; // 2 minutes

export const initialTracks: Track[] = [
  { id: 'track-1', name: '主视频', type: 'video', muted: false, soloed: false, locked: false, visible: true },
  { id: 'track-2', name: 'B-Roll', type: 'video', muted: false, soloed: false, locked: false, visible: true },
  { id: 'track-3', name: '标题字幕', type: 'text', muted: false, soloed: false, locked: false, visible: true },
  { id: 'track-4', name: '旁白', type: 'audio', muted: false, soloed: false, locked: false, visible: true },
  { id: 'track-5', name: '背景音乐', type: 'audio', muted: false, soloed: false, locked: false, visible: true },
  { id: 'track-6', name: '音效', type: 'audio', muted: false, soloed: false, locked: false, visible: true },
];

function makeClip(id: string, trackId: string, name: string, start: number, duration: number, type: Clip['type']): Clip {
  return { id, trackId, name, start, duration, type };
}

export const initialClips: Clip[] = [
  // Track 1 - Main video
  makeClip('clip-1', 'track-1', '开场镜头', 0, 15, 'video'),
  makeClip('clip-2', 'track-1', '产品展示', 15, 22, 'video'),
  makeClip('clip-3', 'track-1', '用户访谈', 40, 28, 'video'),
  makeClip('clip-4', 'track-1', '结尾镜头', 75, 20, 'video'),
  // Track 2 - B-Roll
  makeClip('clip-5', 'track-2', '特写镜头', 5, 8, 'video'),
  makeClip('clip-6', 'track-2', '环境空镜', 20, 12, 'video'),
  makeClip('clip-7', 'track-2', '过渡镜头', 45, 10, 'video'),
  makeClip('clip-8', 'track-2', '素材补充', 80, 14, 'video'),
  // Track 3 - Text/Titles
  makeClip('clip-9', 'track-3', '片头标题', 2, 6, 'text'),
  makeClip('clip-10', 'track-3', '产品名称', 18, 8, 'text'),
  makeClip('clip-11', 'track-3', '受访者姓名', 42, 5, 'text'),
  makeClip('clip-12', 'track-3', '结束语', 78, 8, 'text'),
  // Track 4 - Voiceover
  makeClip('clip-13', 'track-4', '旁白 - 引言', 0, 14, 'audio'),
  makeClip('clip-14', 'track-4', '旁白 - 产品介绍', 16, 20, 'audio'),
  makeClip('clip-15', 'track-4', '旁白 - 总结', 75, 18, 'audio'),
  // Track 5 - Background Music
  makeClip('clip-16', 'track-5', '背景音乐 A', 0, 40, 'audio'),
  makeClip('clip-17', 'track-5', '背景音乐 B', 42, 38, 'audio'),
  makeClip('clip-18', 'track-5', '片尾音乐', 82, 18, 'audio'),
  // Track 6 - SFX
  makeClip('clip-19', 'track-6', 'whoosh', 14, 2, 'audio'),
  makeClip('clip-20', 'track-6', 'ding', 20, 1.5, 'audio'),
  makeClip('clip-21', 'track-6', 'transition', 38, 2, 'audio'),
  makeClip('clip-22', 'track-6', 'impact', 55, 1.5, 'audio'),
  makeClip('clip-23', 'track-6', 'chime', 78, 2, 'audio'),
];

/** Format time as MM:SS:FF (minutes:seconds:frames) */
export function formatTimecode(time: number, fps: number): {
  mm: string;
  ss: string;
  ff: string;
} {
  const totalFrames = Math.round(time * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return {
    mm: String(minutes).padStart(2, '0'),
    ss: String(seconds).padStart(2, '0'),
    ff: String(frames).padStart(2, '0'),
  };
}
