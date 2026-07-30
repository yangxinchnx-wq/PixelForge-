<script setup lang="ts">
interface LlmResult {
  name: string
  tag: string
}

interface Preset {
  name: string
  value: number
}

interface Props {
  prompt: string
  llmResults: LlmResult[]
  presets: Preset[]
  parseStatus?: 'idle' | 'parsing' | 'success' | 'error'
  parseMessage?: string | null
  /** 快速生成状�?Step 22 promptParser 路径) */
  quickParseStatus?: 'idle' | 'parsing' | 'success' | 'error'
  quickParseMessage?: string | null
  /** 快速生成结果来�?'rule' / 'llm' / �? */
  quickParseSource?: 'rule' | 'llm' | null
  /** 快速生成置信度(0-1) */
  quickParseConfidence?: number | null
}

defineProps<Props>()

const emit = defineEmits<{
  'update:prompt': [value: string]
  parse: []
  /** 触发快速生�?Step 22 promptParser 路径) */
  quickParse: []
  /** 触发需求澄�?Step 23 clarifier 路径:自由文本 �?CreativeRequirement) */
  clarify: []
  /** 打开节点图编辑器(Step 25:Requirement �?RenderGraph �?DAG 编辑 �?编译�?RenderIR) */
  openGraph: []
}>()

function onInput(event: Event) {
  emit('update:prompt', (event.target as HTMLTextAreaElement).value)
}

/** �?0-1 置信度转成百分比展示 */
function formatConfidence(c: number | null | undefined): string {
  if (c === null || c === undefined) return '-'
  return `${Math.round(c * 100)}%`
}
</script>

<template>
  <aside class="prompt-panel">
    <div class="panel-title">
      语义创作
      <sub>LLM 驱动</sub>
    </div>

    <textarea
      class="prompt-area"
      :value="prompt"
      placeholder="描述你想生成的画�?..&#10;支持:星空 / 漩涡 / 渐变 / 圆形 / 纯色 + 颜色(�?�?#hex/[r,g,b,a])"
      @input="onInput"
    ></textarea>

    <div class="btn-row">
      <button
        class="btn btn-accent"
        data-tip="调用 clarify + ruleParser 生成完整 RenderIR"
        @click="emit('parse')"
        :disabled="parseStatus === 'parsing'"
      >
        {{ parseStatus === 'parsing' ? '解析�?..' : '确认并解�? }}
      </button>
      <button
        class="btn btn-ghost"
        data-tip="关键词快速路�?命中即追�?Layer(rule 优先,LLM 兜底)"
        @click="emit('quickParse')"
        :disabled="quickParseStatus === 'parsing' || !prompt.trim()"
      >
        {{ quickParseStatus === 'parsing' ? '生成�?..' : '快速生�? }}
      </button>
      <button
        class="btn btn-ghost"
        data-tip="需求澄�?自由文本 �?意图分析 �?追问补全 �?CreativeRequirement"
        @click="emit('clarify')"
        :disabled="!prompt.trim()"
      >
        需求澄�?
      </button>
    </div>

    <button
      class="btn btn-block"
      data-tip="节点图编�?Step 25):Requirement �?RenderGraph �?DAG 编辑 �?编译�?RenderIR"
      @click="emit('openGraph')"
      :disabled="!prompt.trim()"
    >
      节点图编�?
    </button>

    <div v-if="parseMessage" class="parse-status" :class="parseStatus">
      {{ parseMessage }}
    </div>

    <div v-if="quickParseMessage" class="parse-status" :class="quickParseStatus">
      <span class="status-source" v-if="quickParseSource">{{ quickParseSource.toUpperCase() }}</span>
      <span class="status-confidence" v-if="quickParseConfidence !== null && quickParseConfidence !== undefined">
        置信�?{{ formatConfidence(quickParseConfidence) }}
      </span>
      <span>{{ quickParseMessage }}</span>
    </div>

    <div class="sub-card">
      <div class="group-label">
        LLM 解析结果
        <span class="pill accent">{{ llmResults.length }} �?/span>
      </div>
      <div v-for="item in llmResults" :key="item.name" class="llm-item">
        <span class="llm-item-name">
          <span class="llm-item-dot"></span>
          {{ item.name }}
        </span>
        <span class="llm-item-tag">{{ item.tag }}</span>
      </div>
    </div>

    <div class="sub-card">
      <div class="group-label">参数预设</div>
      <div v-for="item in presets" :key="item.name" class="llm-item">
        <span class="llm-item-name">{{ item.name }}</span>
        <span class="llm-item-tag">{{ item.value.toFixed(2) }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.prompt-panel {
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 12px 4px 4px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.panel-title sub { font-size: 11px; font-weight: 400; color: var(--text-tertiary); }

.prompt-area {
  width: 100%;
  min-height: 130px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  resize: vertical;
  transition: all 160ms ease;
}
.prompt-area:focus { outline: none; border-color: var(--accent); background: var(--glass-bg); }
.prompt-area::placeholder { color: var(--text-quaternary); }

.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
}
.btn:hover { border-color: var(--separator-strong); transform: translateY(-1px); }
.btn:active { transform: translateY(0) scale(0.98); }
.btn-accent { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-accent:hover { background: var(--accent-pressed); border-color: var(--accent-pressed); }
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--separator);
}
.btn-ghost:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
  border-color: var(--separator-strong);
}
.btn-block { width: 100%; }

.btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

/* 双按钮行布局 */
.btn-row {
  display: flex;
  gap: 8px;
}
.btn-row .btn { flex: 1; }

.parse-status {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.parse-status.success { background: rgba(74, 122, 62, 0.08); color: var(--toggle-lock); border: 1px solid rgba(74, 122, 62, 0.2); }
.parse-status.error { background: rgba(212, 75, 75, 0.08); color: var(--toggle-mute); border: 1px solid rgba(212, 75, 75, 0.2); }
.parse-status.parsing { background: rgba(10, 132, 255, 0.12); color: var(--accent); border: 1px solid rgba(184, 92, 46, 0.2); }

.status-source {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.05em;
}
.status-confidence {
  font-size: 10.5px;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
}

.sub-card {
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
  border-radius: var(--radius-md);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.group-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-quaternary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}
.pill.accent { background: rgba(10, 132, 255, 0.12); color: var(--accent); }

.llm-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg);
  font-size: 12.5px;
  transition: all 160ms ease;
  cursor: pointer;
}
.llm-item:hover { background: var(--track-bg); }
.llm-item-name { display: flex; align-items: center; gap: 8px; color: var(--text-primary); font-weight: 500; }
.llm-item-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--accent); }
.llm-item-tag {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--accent);
  padding: 2px 8px;
  border-radius: 5px;
  background: rgba(10, 132, 255, 0.12);
  font-weight: 500;
}

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
