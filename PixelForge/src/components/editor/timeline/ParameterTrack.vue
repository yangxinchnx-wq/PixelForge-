<script setup lang="ts">
import { evaluateTrack } from '@/editor/timeline/evaluator'
import { useTimelineStore } from '@/stores/timeline'

import CurveCanvas from './CurveCanvas.vue'
import TrackHeader from './TrackHeader.vue'

const timeline = useTimelineStore()

/** 在当前帧添加关键帧(若已存在则更新值) */
function addAtCurrent(trackId: string) {
  const track = timeline.tracks.find((t) => t.id === trackId)
  if (!track) return
  const value = evaluateTrack(track, timeline.currentFrame)
  timeline.addKeyframe(trackId, timeline.currentFrame, value)
}

function reset(trackId: string) {
  timeline.resetTrack(trackId)
}
</script>

<template>
  <section class="param-track">
    <header class="pt-head">
      <div class="pt-title">
        主体轨道
        <sub>参数动画曲线 · {{ timeline.tracks.length }} 项</sub>
      </div>
      <div class="pt-meta">
        <span>范围 <strong>0 → {{ timeline.totalFrames }}</strong> 帧</span>
        <span>·</span>
        <span>当前 <strong>{{ timeline.currentFrame }}</strong></span>
        <span>·</span>
        <span class="pill" :class="timeline.isPlaying ? 'accent' : 'muted'">
          {{ timeline.isPlaying ? '播放中' : '已暂停' }}
        </span>
      </div>
    </header>

    <div class="pt-list">
      <div v-for="track in timeline.tracks" :key="track.id" class="pt-row">
        <TrackHeader
          :track="track"
          :current-value="evaluateTrack(track, timeline.currentFrame)"
          @add="addAtCurrent(track.id)"
          @reset="reset(track.id)"
        />
        <CurveCanvas :track="track" />
      </div>
    </div>

    <footer class="pt-foot">
      <span class="hint">双击曲线空白处添加关键帧 · 右键关键帧删除 · 拖动关键帧修改插值</span>
    </footer>
  </section>
</template>

<style scoped>
.param-track {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: var(--pf-r-xl);
  padding: 14px 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: hidden;
}

.pt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-shrink: 0;
}
.pt-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.pt-title sub { font-size: 11px; font-weight: 400; color: var(--pf-ink-muted); }
.pt-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: var(--pf-ink-muted);
}
.pt-meta strong {
  font-family: 'JetBrains Mono', monospace;
  color: var(--pf-ink);
  font-weight: 600;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}
.pill.muted { background: var(--pf-surface-soft); color: var(--pf-ink-soft); }
.pill.accent { background: var(--pf-accent-soft); color: var(--pf-accent); }

.pt-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.pt-list::-webkit-scrollbar { width: 6px; }
.pt-list::-webkit-scrollbar-track { background: transparent; }
.pt-list::-webkit-scrollbar-thumb {
  background: var(--pf-line-strong);
  border-radius: 999px;
}

.pt-row {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-radius: var(--pf-r-sm);
  background: var(--pf-surface-soft);
  transition: background 160ms ease;
}
.pt-row:hover { background: var(--pf-surface-sunk); }

.pt-foot {
  flex-shrink: 0;
  padding-top: 4px;
  border-top: 1px solid var(--pf-line);
}
.hint {
  font-size: 10.5px;
  color: var(--pf-ink-faint);
  letter-spacing: 0.01em;
}
</style>
