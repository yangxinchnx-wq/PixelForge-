/**
 * 时间工具函数 — 格式化、转换、运算。
 *
 * 当前系统使用 number（秒）作为时间单位。
 * 提取自 ProTimeline 的 bigint 微秒工具，适配为 number 秒版本。
 */

/** 格式化为 HH:MM:SS.mmm 字符串 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/** 格式化为 HH:MM:SS:FF（帧号，用于视频编辑器显示） */
export function formatTimecode(seconds: number, fps: number): string {
  const totalFrames = Math.round(seconds * fps);
  const fpsInt = Math.floor(fps);
  const totalSeconds = Math.floor(totalFrames / fpsInt);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const f = totalFrames % fpsInt;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

/** 格式化为 MM:SS:FF 对象（用于 TimelinePanel 显示） */
export function formatTimecodeParts(seconds: number, fps: number): {
  mm: string;
  ss: string;
  ff: string;
} {
  const totalFrames = Math.round(seconds * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  return {
    mm: String(m).padStart(2, '0'),
    ss: String(s).padStart(2, '0'),
    ff: String(frames).padStart(2, '0'),
  };
}

/** 秒 → 帧号 */
export function secondsToFrame(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/** 帧号 → 秒 */
export function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

/** 钳制: min <= value <= max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 线性插值 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 将 0-1 的值映射到 UI 百分比字符串 */
export function toPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return (value / total) * 100;
}
