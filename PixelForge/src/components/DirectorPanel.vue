<script setup lang="ts">
/**
 * AI Director 面板 — 对话式创作辅助，与时间轴整合。
 *
 * 功能:
 * - 多轮对话：用户描述动画意图 → AI Director 生成时间轴轨道
 * - Timeline 注入：Director 生成的关键帧轨道直接注入到时间轴
 * - 上下文感知：Director 读取当前 RenderIR + Timeline 状态
 *
 * 数据流:
 *   用户输入 → converse() → LLM → DirectorDecision
 *   DirectorDecision → extractAnimationParams → createTimelineFromAnimations
 *   TimelineContent → 注入 appStore 的 paramTracks
 */
import { ref, computed, nextTick } from 'vue';
import { useAppStore } from '../stores/app';
import { useAssetStore } from '../assets/assetStore';
import {
  createConversation,
  addUserMessage,
  addDirectorMessage,
  serializeConversation,
  extractAnimationParams,
  createTimelineFromAnimations,
  generateTimelineFromLLM,
  type ConversationSession,
} from '../world/director/directorConversation';
import { parseEnhancedIntent } from '../world/director/directorEnhanced';
import type { LLMOutput } from '../authoring/llm/types';
import type { ParameterTrack, Keyframe } from '../types';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [val: boolean];
}>();

const appStore = useAppStore();

// ─── 对话状态 ──────────────────────────────────────────
const session = ref<ConversationSession>(createConversation());
const inputText = ref('');
const isProcessing = ref(false);
const messagesRef = ref<HTMLElement | null>(null);

// ─── 对话消息（从 session 提取用于显示）──────────────────
interface DisplayMessage {
  id: string;
  role: 'user' | 'director';
  content: string;
  timestamp: number;
  patchCount?: number;
}

const displayMessages = computed<DisplayMessage[]>(() =>
  session.value.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
    patchCount: m.decision?.patches.length,
  }))
);

// ─── 发送消息 ──────────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isProcessing.value) return;

  isProcessing.value = true;
  inputText.value = '';

  // 解析意图
  const intent = parseEnhancedIntent(text, null);

  // 添加用户消息到会话
  session.value = addUserMessage(session.value, intent);

  await nextTick();
  scrollToBottom();

  // 模拟 Director 决策（实际应调用 converse()，但需要 LLM 配置）
  // 这里使用演示模式：根据用户输入生成动画轨道
  setTimeout(() => {
    const demoOutput = generateDemoOutput(text);
    const animations = extractAnimationParams(demoOutput, null);

    let patchCount = 0;
    if (animations.length > 0) {
      // 生成时间轴轨道
      const timeline = createTimelineFromAnimations(animations, 60, true);

      // 注入到 appStore 的 paramTracks
      for (const track of timeline.tracks) {
        const paramTrack: ParameterTrack = {
          id: track.id,
          label: track.name,
          layerId: track.targetId,
          parameter: track.paramKey,
          keyframes: track.keyframes.map((kf): Keyframe => ({
            id: kf.id,
            time: kf.time,
            value: typeof kf.value === 'number' ? kf.value : 0,
            interpolation: kf.interpolation as 'linear' | 'ease' | 'hold' | 'bezier' | 'step',
          })),
        };
        appStore.addParamTrack(paramTrack);
        patchCount++;
      }
    }

    // 添加 Director 消息到会话
    const decision = {
      intentId: intent.id,
      patches: [],
      reasoning: animations.length > 0
        ? `已生成 ${animations.length} 个动画轨道并注入时间轴（${patchCount} 个参数轨道）`
        : '未检测到动画参数，请尝试描述如"从红色渐变到蓝色，持续2秒"',
    };
    session.value = addDirectorMessage(session.value, decision);

    isProcessing.value = false;
    scrollToBottom();
  }, 800);
}

// ─── 演示模式：根据用户输入生成模拟 LLM 输出 ────────────
function generateDemoOutput(prompt: string): LLMOutput {
  const lower = prompt.toLowerCase();

  // 检测颜色变化
  const colorMatch = prompt.match(/(\w+).*(?:到|→|->).*(\w+)/);
  if (lower.includes('颜色') || lower.includes('渐变') || colorMatch) {
    return {
      scene: '颜色动画',
      elements: [{
        type: 'background',
        color: [255, 0, 0],
        layer: 0,
        description: '颜色渐变动画',
        params: {
          animateFrom: [255, 0, 0],
          animateTo: [0, 0, 255],
          duration: 2.0,
        },
      }],
    };
  }

  // 检测亮度变化
  if (lower.includes('亮度') || lower.includes('闪烁')) {
    return {
      scene: '亮度动画',
      elements: [{
        type: 'background',
        color: [128, 128, 128],
        layer: 0,
        description: '亮度变化',
        params: {
          animateFrom: 0.3,
          animateTo: 0.9,
          duration: 1.5,
        },
      }],
    };
  }

  // 检测缩放
  if (lower.includes('缩放') || lower.includes('放大') || lower.includes('缩小')) {
    return {
      scene: '缩放动画',
      elements: [{
        type: 'circle',
        color: [100, 200, 255],
        layer: 0,
        description: '缩放效果',
        params: {
          animateFrom: 0.5,
          animateTo: 2.0,
          duration: 3.0,
        },
      }],
    };
  }

  return {
    scene: '无动画',
    elements: [{
      type: 'background',
      color: [0, 0, 0],
      layer: 0,
      description: '未检测到动画意图',
    }],
  };
}

// ─── 辅助 ──────────────────────────────────────────────
function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
    }
  });
}

function close() {
  emit('update:visible', false);
}

function clearConversation() {
  session.value = createConversation();
}

// ─── 快捷提示词 ────────────────────────────────────────
const quickPrompts = [
  '从红色渐变到蓝色，持续2秒',
  '亮度从暗到亮闪烁',
  '缩放从小到大',
];

function useQuickPrompt(text: string) {
  inputText.value = text;
}
</script>

<template>
  <Teleport to="body">
    <Transition name="director-slide">
      <div v-if="visible" class="pf-director-overlay" @click.self="close">
        <div class="pf-director-panel">
          <!-- Header -->
          <div class="pf-director-header">
            <div class="pf-director-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M12 2a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0-1 5.87V17a3 3 0 0 0 3 3 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 3-3v-3.13A3 3 0 0 0 18 8a3 3 0 0 0-3-3 3 3 0 0 0-3-3z" />
              </svg>
              <span>AI Director · 时间轴动画</span>
            </div>
            <div class="pf-director-header-actions">
              <button class="pf-director-btn small" title="清空对话" @click="clearConversation">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
              <button class="pf-director-btn small" title="关闭" @click="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Messages -->
          <div class="pf-director-messages" ref="messagesRef">
            <div v-if="displayMessages.length === 0" class="pf-director-welcome">
              <div class="pf-director-welcome-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" opacity="0.3">
                  <path d="M12 2a3 3 0 0 0-3 3 3 3 0 0 0-3 3 3 3 0 0 0-1 5.87V17a3 3 0 0 0 3 3 3 3 0 0 0 4 0 3 3 0 0 0 4 0 3 3 0 0 0 3-3v-3.13A3 3 0 0 0 18 8a3 3 0 0 0-3-3 3 3 0 0 0-3-3z" />
                </svg>
              </div>
              <h3>AI Director</h3>
              <p>描述你想要的动画效果，AI 会自动生成时间轴关键帧并注入到时间轴中。</p>
              <div class="pf-director-quick-prompts">
                <button
                  v-for="prompt in quickPrompts"
                  :key="prompt"
                  class="pf-director-quick-prompt"
                  @click="useQuickPrompt(prompt)"
                >{{ prompt }}</button>
              </div>
            </div>

            <div
              v-for="msg in displayMessages"
              :key="msg.id"
              class="pf-director-msg"
              :class="'role-' + msg.role"
            >
              <div class="pf-director-msg-avatar">
                {{ msg.role === 'user' ? '你' : 'AI' }}
              </div>
              <div class="pf-director-msg-content">
                <p>{{ msg.content }}</p>
                <div v-if="msg.role === 'director' && msg.patchCount" class="pf-director-msg-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  已注入 {{ msg.patchCount }} 个轨道到时间轴
                </div>
              </div>
            </div>

            <div v-if="isProcessing" class="pf-director-msg role-director">
              <div class="pf-director-msg-avatar">AI</div>
              <div class="pf-director-msg-content">
                <div class="pf-director-typing">
                  <span></span><span></span><span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick prompts -->
          <div v-if="displayMessages.length > 0" class="pf-director-quick-bar">
            <button
              v-for="prompt in quickPrompts"
              :key="prompt"
              class="pf-director-quick-prompt"
              @click="useQuickPrompt(prompt)"
            >{{ prompt }}</button>
          </div>

          <!-- Input -->
          <div class="pf-director-input-area">
            <input
              v-model="inputText"
              type="text"
              placeholder="描述动画效果..."
              class="pf-director-input"
              :disabled="isProcessing"
              @keyup.enter="sendMessage"
            />
            <button
              class="pf-director-send"
              :disabled="!inputText.trim() || isProcessing"
              @click="sendMessage"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>

          <!-- Status bar -->
          <div class="pf-director-status">
            <span class="pf-director-status-item">
              对话轮次: {{ Math.floor(displayMessages.length / 2) }}
            </span>
            <span class="pf-director-status-item">
              参数轨道: {{ appStore.paramTracks.length }}
            </span>
            <span v-if="isProcessing" class="pf-director-status-item active">处理中...</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.pf-director-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
  backdrop-filter: blur(4px);
}

.pf-director-panel {
  width: 380px;
  max-width: 90vw;
  height: 100%;
  background: var(--surface, #1a1a1a);
  border-left: 1px solid var(--separator-strong, #3a3a3a);
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.3);
}

/* ── Header ── */
.pf-director-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
}

.pf-director-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #fff);
}

.pf-director-header-actions {
  display: flex;
  gap: 4px;
}

.pf-director-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  min-width: 28px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-tertiary, #888);
  cursor: pointer;
  transition: all 160ms ease;
}

.pf-director-btn:hover {
  background: var(--surface-hover, #252525);
  color: var(--text-primary, #fff);
}

.pf-director-btn.small {
  height: 26px;
  min-width: 26px;
}

/* ── Messages ── */
.pf-director-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pf-director-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 40px 20px;
  color: var(--text-tertiary, #666);
}

.pf-director-welcome h3 {
  margin: 8px 0 4px;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.pf-director-welcome p {
  font-size: 12px;
  line-height: 1.5;
  max-width: 280px;
  margin: 0;
}

.pf-director-quick-prompts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
  width: 100%;
}

.pf-director-quick-prompt {
  padding: 8px 12px;
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 8px;
  font: inherit;
  font-size: 11px;
  color: var(--text-secondary, #aaa);
  cursor: pointer;
  transition: all 160ms ease;
  text-align: left;
}

.pf-director-quick-prompt:hover {
  border-color: var(--accent, #4a9eff);
  color: var(--accent, #4a9eff);
}

/* ── Message ── */
.pf-director-msg {
  display: flex;
  gap: 8px;
  max-width: 100%;
}

.pf-director-msg.role-user {
  flex-direction: row-reverse;
}

.pf-director-msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--surface-soft, #2a2a2a);
  color: var(--text-secondary, #aaa);
}

.pf-director-msg.role-director .pf-director-msg-avatar {
  background: color-mix(in srgb, var(--accent, #4a9eff) 20%, var(--surface-soft, #2a2a2a));
  color: var(--accent, #4a9eff);
}

.pf-director-msg-content {
  background: var(--surface-soft, #1e1e1e);
  border-radius: 10px;
  padding: 8px 12px;
  max-width: 80%;
}

.pf-director-msg.role-user .pf-director-msg-content {
  background: color-mix(in srgb, var(--accent, #4a9eff) 15%, var(--surface-soft, #1e1e1e));
}

.pf-director-msg-content p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #fff);
}

.pf-director-msg-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 3px 8px;
  background: color-mix(in srgb, #22c55e 15%, transparent);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #22c55e;
}

/* ── Typing indicator ── */
.pf-director-typing {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.pf-director-typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary, #666);
  animation: typingBounce 1.4s infinite ease-in-out both;
}

.pf-director-typing span:nth-child(1) { animation-delay: -0.32s; }
.pf-director-typing span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typingBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

/* ── Quick bar ── */
.pf-director-quick-bar {
  display: flex;
  gap: 4px;
  padding: 6px 16px;
  border-top: 1px solid var(--separator, #2a2a2a);
  overflow-x: auto;
  flex-shrink: 0;
}

.pf-director-quick-bar .pf-director-quick-prompt {
  white-space: nowrap;
  font-size: 10px;
  padding: 4px 8px;
}

/* ── Input ── */
.pf-director-input-area {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
}

.pf-director-input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 10px;
  color: var(--text-primary, #fff);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: border-color 160ms ease;
}

.pf-director-input:focus {
  border-color: var(--accent, #4a9eff);
}

.pf-director-input::placeholder {
  color: var(--text-quaternary, #555);
}

.pf-director-send {
  width: 36px;
  height: 36px;
  border: none;
  background: var(--accent, #4a9eff);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 160ms ease;
  flex-shrink: 0;
}

.pf-director-send:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent, #4a9eff) 80%, white);
}

.pf-director-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Status ── */
.pf-director-status {
  display: flex;
  gap: 12px;
  padding: 6px 16px;
  border-top: 1px solid var(--separator, #2a2a2a);
  background: var(--surface-soft, #1e1e1e);
  flex-shrink: 0;
}

.pf-director-status-item {
  font-size: 10px;
  color: var(--text-tertiary, #666);
  font-variant-numeric: tabular-nums;
}

.pf-director-status-item.active {
  color: #eab308;
}

/* ── Transition ── */
.director-slide-enter-active,
.director-slide-leave-active {
  transition: opacity 250ms ease;
}

.director-slide-enter-active .pf-director-panel,
.director-slide-leave-active .pf-director-panel {
  transition: transform 300ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.director-slide-enter-from,
.director-slide-leave-to {
  opacity: 0;
}

.director-slide-enter-from .pf-director-panel,
.director-slide-leave-to .pf-director-panel {
  transform: translateX(100%);
}
</style>
