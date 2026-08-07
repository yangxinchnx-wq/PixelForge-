import { defineStore } from 'pinia';
import { ref } from 'vue';
import { TOTAL_DURATION, FPS } from '../data';

/**
 * Playback Store — 播放控制（时间推进、暂停、逐帧）。
 *
 * 使用 rAF 驱动 currentTime 前进，支持 seek/step/reset。
 */
export const usePlaybackStore = defineStore('playback', () => {
  const currentTime = ref(0);
  const isPlaying = ref(false);

  let rafId: number | null = null;

  function startPlayback() {
    if (!isPlaying.value) return;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      const next = currentTime.value + delta;
      if (next >= TOTAL_DURATION) {
        currentTime.value = TOTAL_DURATION;
        isPlaying.value = false;
        return;
      }
      currentTime.value = next;
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function stopPlayback() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value;
  }

  function seek(time: number) {
    currentTime.value = Math.max(0, Math.min(TOTAL_DURATION, time));
  }

  function stepForward() {
    currentTime.value = Math.min(TOTAL_DURATION, currentTime.value + 1 / FPS);
  }

  function stepBackward() {
    currentTime.value = Math.max(0, currentTime.value - 1 / FPS);
  }

  function resetTime() {
    currentTime.value = 0;
  }

  return {
    currentTime,
    isPlaying,
    startPlayback,
    stopPlayback,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    resetTime,
  };
});
