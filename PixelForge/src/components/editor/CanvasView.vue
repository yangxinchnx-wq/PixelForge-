<script setup lang="ts">
interface Hud {
  fps: number
  frame: number
  gpuMs: number
  memMb: number
}

interface Props {
  status: 'idle' | 'initializing' | 'ready' | 'error' | string
  hud: Hud
}

defineProps<Props>()

const emit = defineEmits<{
  init: []
  render: []
  batch: []
}>()
</script>

<template>
  <section class="canvas-view">
    <header class="canvas-head">
      <div>
        <span class="canvas-title">画布预览</span>
        <span class="canvas-tag">WebGPU · �?{{ hud.frame }}</span>
      </div>
      <div class="canvas-actions">
        <button class="btn" data-tip="store.initialize(canvas)" @click="emit('init')">初始�?/button>
        <button class="btn btn-dark" data-tip="store.renderCurrentIR()" @click="emit('render')">渲染当前</button>
        <button class="btn btn-accent" data-tip="批量生成" @click="emit('batch')">批量生成</button>
      </div>
    </header>

    <div class="canvas-frame">
      <slot name="canvas" />
      <div class="canvas-overlay"></div>
      <div class="canvas-grid"></div>
      <div class="canvas-corner">region-artifact-v2</div>
      <div class="canvas-readout">
        <div class="readout"><span>帧率</span><strong>{{ hud.fps.toFixed(1) }}</strong></div>
        <div class="readout accent"><span>帧号</span><strong>#{{ String(hud.frame).padStart(4, '0') }}</strong></div>
        <div class="readout"><span>GPU</span><strong>{{ hud.gpuMs.toFixed(1) }}ms</strong></div>
        <div class="readout"><span>显存</span><strong>{{ hud.memMb.toFixed(1) }}MB</strong></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.canvas-view {
  background: var(--glass-bg);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}
.canvas-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.canvas-title { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.canvas-tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(10, 132, 255, 0.12);
  margin-left: 8px;
}
.canvas-actions { display: flex; gap: 6px; }

.btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex; align-items: center; gap: 6px;
}
.btn:hover { border-color: var(--separator-strong); transform: translateY(-1px); }
.btn:active { transform: translateY(0) scale(0.98); }
.btn-accent { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-accent:hover { background: var(--accent-pressed); border-color: var(--accent-pressed); }
.btn-dark { background: var(--text-primary); color: var(--base-bg); border-color: var(--text-primary); }
.btn-dark:hover { background: #2a2620; }

.canvas-frame {
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-lg);
  background: #0d0c10;
  position: relative;
  overflow: hidden;
  box-shadow: 0 18px 40px rgba(20, 18, 14, 0.12);
}
.canvas-frame :deep(.runtime-canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.canvas-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 22% 28%, rgba(255, 200, 90, 0.18), transparent 0 34%),
    radial-gradient(circle at 78% 22%, rgba(90, 130, 220, 0.18), transparent 0 32%);
}
.canvas-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.85), rgba(0, 0, 0, 0.15));
}
.canvas-corner {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
}
.canvas-corner::before {
  content: '';
  width: 6px; height: 6px;
  border-radius: 999px;
  background: var(--accent);
}
.canvas-readout {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  gap: 6px;
}
.readout {
  padding: 7px 11px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.94);
  display: grid;
  gap: 1px;
  min-width: 68px;
}
.readout span {
  font-size: 9.5px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}
.readout strong {
  font-size: 12.5px;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-primary);
}
.readout.accent strong { color: var(--accent); }

[data-tip] { position: relative; }
[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%) scale(0.95);
  padding: 5px 10px;
  background: var(--text-primary);
  color: var(--base-bg);
  font-size: 11px;
  border-radius: 7px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 50;
}
[data-tip]:hover::after { opacity: 1; transform: translateX(-50%) scale(1); }
</style>
