/**
 * FrameLoop — 60FPS 帧调度器（纯 rAF 循环）。
 *
 * 从 src/animation/scheduler.ts 迁移至 utils/，因为它是通用工具而非动画专用。
 *
 * 职责:
 * - startFrameLoop:   启动 requestAnimationFrame 循环，每帧调用 callback(dt)
 * - stopFrameLoop:    停止循环
 * - FrameLoopControl: 控制句柄(start / stop / isRunning)
 */

export interface FrameLoopControl {
  stop: () => void;
  start: () => void;
  isRunning: () => boolean;
  getFps: () => number;
}

export type FrameCallback = (dt: number, now: number) => void;

export function startFrameLoop(
  callback: FrameCallback,
  options: { autoStart?: boolean } = {},
): FrameLoopControl {
  const { autoStart = true } = options;
  let rafId: number | null = null;
  let lastTs = 0;

  const frameTimes: number[] = [];
  const MAX_FRAME_SAMPLES = 60;
  let currentFps = 0;

  function frame(now: number) {
    if (lastTs === 0) {
      lastTs = now;
      rafId = requestAnimationFrame(frame);
      return;
    }

    let delta = now - lastTs;
    lastTs = now;

    if (delta > 100) delta = 100;
    if (delta < 0) delta = 0;

    const dt = delta / 1000;

    frameTimes.push(delta);
    if (frameTimes.length > MAX_FRAME_SAMPLES) {
      frameTimes.shift();
    }
    const avgDelta = frameTimes.reduce((s, d) => s + d, 0) / frameTimes.length;
    currentFps = avgDelta > 0 ? 1000 / avgDelta : 0;

    try {
      callback(dt, now);
    } catch (e) {
      console.error('[FrameLoop] callback error:', e);
    }

    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (rafId !== null) return;
    lastTs = 0;
    frameTimes.length = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    lastTs = 0;
  }

  function isRunning() {
    return rafId !== null;
  }

  function getFps() {
    return currentFps;
  }

  if (autoStart) start();

  return { stop, start, isRunning, getFps };
}

export function startFixedTimestepLoop(
  callback: (dt: number) => void,
  fixedDt: number = 1 / 60,
  maxSteps: number = 5,
): FrameLoopControl {
  let accumulator = 0;
  return startFrameLoop((dt) => {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= fixedDt && steps < maxSteps) {
      callback(fixedDt);
      accumulator -= fixedDt;
      steps++;
    }
    if (steps >= maxSteps) accumulator = 0;
  });
}
