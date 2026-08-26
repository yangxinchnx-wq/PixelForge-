<script setup lang="ts">
/**
 * AI Director 面板 — 对话式图片创作辅助。
 *
 * 功能:
 * - 多轮对话：用户描述画面 → AI Director 调用生成引擎
 * - 结果输出：生成完成后图片进入资源管理面板
 * - 上下文感知：Director 读取当前 RenderIR 状态
 *
 * 数据流:
 *   用户输入 → converse() → DirectorDecision
 *   → l3_director ValuePatch / Unified Timeline
 *   → Runtime WebGPU + 时间轴
 */
import { ref, shallowRef, computed, nextTick } from 'vue';
import { useAppStore } from '../stores/app';
import { useAssetStore } from '../assets/assetStore';
import { useRuntimeStore } from '../stores/runtime';
import { useTimelineStore } from '../stores/timelineStore';
import {
  createConversation,
  converse,
  type ConversationSession,
} from '../world/director/directorConversation';
import { parseEnhancedIntent } from '../world/director/directorEnhanced';
import { toValuePatches } from '../world/director/director';
import type { DirectorDecision } from '../world/types';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [val: boolean];
}>();

const appStore = useAppStore();
const assetStore = useAssetStore();
const runtimeStore = useRuntimeStore();
const timelineStore = useTimelineStore();

// ─── 对话状态 ──────────────────────────────────────────
const session = shallowRef<ConversationSession>(createConversation());
const inputText = ref('');
const isProcessing = ref(false);
const messagesRef = ref<HTMLElement | null>(null);
const lastDecision = shallowRef<DirectorDecision | null>(null);
const lastError = ref<string | null>(null);

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

// ─── 发送消息：Director 是主决策入口 ───────────────────
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isProcessing.value) return;

  isProcessing.value = true;
  lastError.value = null;
  inputText.value = '';
  appStore.handlePromptTextChange(text);

  await nextTick();
  scrollToBottom();

  try {
    const currentIr = runtimeStore.currentIr;
    const currentTimeline = timelineStore.timelineContent;
    const intent = parseEnhancedIntent(text, currentIr);

    // converse 负责多轮历史和真实 DirectorDecision；它的结果是唯一 UI 决策来源。
    const nextSession = await converse(
      session.value,
      text,
      currentIr,
      currentTimeline,
      {
        providerConfig: appStore.selectedModelConfig
          ? appStore.modelConfigToLLMConfig(appStore.selectedModelConfig)
          : undefined,
        model: appStore.selectedModelConfig?.modelId,
      },
    );
    session.value = nextSession;
      const decision = nextSession.messages[nextSession.messages.length - 1]?.decision;
    if (decision) {
      lastDecision.value = decision;
      await applyDecision(decision, intent.id);
    }
  } catch (error) {
    lastError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isProcessing.value = false;
    await nextTick();
    scrollToBottom();
  }
}

async function applyDecision(decision: DirectorDecision, fallbackIntentId: string): Promise<void> {
  const intentId = decision.intentId || fallbackIntentId;
  const valuePatches = toValuePatches(decision.patches, intentId);
  const validPatches = valuePatches.filter((patch) =>
    patch.targetEntity === 'layer'
      ? runtimeStore.currentIr.layers.some((layer) => layer.id === patch.targetId)
      : runtimeStore.currentIr.effects.some((effect) => effect.id === patch.targetId),
  );

  if (validPatches.length > 0) {
    const result = runtimeStore.applyValuePatches(validPatches, {
      source: 'l3_director',
      skipHistory: false,
      render: false,
    });
    if (!result.success) throw new Error(result.error ?? 'Director 参数应用失败');
    await runtimeStore.renderCurrentIR();
  }

  if (decision.timeline) {
    timelineStore.setTimelineContent(decision.timeline);
  }

  const dataUrl = await runtimeStore.captureCanvas();
  if (dataUrl) {
    const asset = appStore.createAssetFromCanvas(
      dataUrl,
      appStore.livePromptText,
      runtimeStore.currentIr.canvas.width,
      runtimeStore.currentIr.canvas.height,
    );
    if (asset) assetStore.add(asset);
  }
}

// ─── 辅助 ──────────────────────────────────────────────
function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
    }
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function close() {
  emit('update:visible', false);
}

function clearConversation() {
  session.value = createConversation();
}

// ─── 快捷提示词 ────────────────────────────────────────
const quickPrompts = [
  '壮丽的高分辨率电影级夜景：静谧的水晶高山湖泊倒映星空',
  '赛博朋克风格未来都市街道，霓虹灯光，雨天反射',
  '极简主义白色空间中的抽象几何雕塑',
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
              <span>AI Director · 图片创作</span>
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
          <div class="pf-chat-messages" ref="messagesRef">
            <div v-if="displayMessages.length === 0" class="pf-director-welcome">
              <div class="pf-director-welcome-icon">
                <svg viewBox="0 0 24 24" fill="currentColor" width="40" height="40" opacity="0.3">
                  <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
                </svg>
              </div>
              <h3>AI Director</h3>
              <p>你好！我是 AI 创作助手。描述你想要生成的图片，我来帮你实现。</p>
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
              class="pf-chat-msg"
              :class="'pf-chat-msg-' + (msg.role === 'user' ? 'user' : 'assistant')"
            >
              <div class="pf-chat-msg-avatar">
                <template v-if="msg.role === 'user'">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5.5V21h18v-1.5c0-3-4-5.5-9-5.5z" />
                  </svg>
                </template>
                <template v-else>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
                  </svg>
                </template>
              </div>
              <div class="pf-chat-msg-bubble">
                <span class="pf-chat-msg-text">{{ msg.content }}</span>
                <div v-if="msg.role === 'director' && msg.patchCount" class="pf-director-msg-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  已注入 {{ msg.patchCount }} 个轨道到时间轴
                </div>
                <span class="pf-chat-msg-time">{{ formatTime(msg.timestamp) }}</span>
              </div>
            </div>

            <div v-if="isProcessing" class="pf-chat-msg pf-chat-msg-assistant">
              <div class="pf-chat-msg-avatar">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2l1.9 5.8L20 10l-6.1 2.2L12 18l-1.9-5.8L4 10l6.1-2.2L12 2z" />
                </svg>
              </div>
              <div class="pf-chat-msg-bubble">
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
            <textarea
              v-model="inputText"
              class="pf-textarea"
              placeholder="描述你想要生成的场景…"
              rows="4"
              :disabled="isProcessing"
              @keydown="onKeydown"
            ></textarea>
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
              已生成图片: {{ assetStore.imageCount }}
            </span>
            <span v-if="isProcessing" class="pf-director-status-item active">生成中...</span>
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
.pf-chat-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-chat-messages::-webkit-scrollbar {
  width: 6px;
}

.pf-chat-messages::-webkit-scrollbar-thumb {
  background: var(--text-quaternary, #555);
  border-radius: 3px;
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
.pf-chat-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  animation: chatMsgEnter 300ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}

.pf-chat-msg-user {
  flex-direction: row-reverse;
}

.pf-chat-msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-xs, 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--surface-soft, #2a2a2a);
  color: var(--text-secondary, #aaa);
}

.pf-chat-msg-user .pf-chat-msg-avatar {
  background: var(--accent, #4a9eff);
  color: #fff;
}

.pf-chat-msg-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: var(--radius-sm, 10px);
  background: var(--surface-soft, #1e1e1e);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pf-chat-msg-user .pf-chat-msg-bubble {
  background: color-mix(in srgb, var(--accent, #4a9eff) 15%, var(--surface-soft, #1e1e1e));
}

.pf-chat-msg-assistant .pf-chat-msg-bubble {
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
}

.pf-chat-msg-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #fff);
  word-wrap: break-word;
}

.pf-chat-msg-user .pf-chat-msg-text {
  color: var(--text-primary, #fff);
}

.pf-chat-msg-time {
  font-size: 9px;
  color: var(--text-tertiary, #666);
  align-self: flex-end;
}

.pf-chat-msg-user .pf-chat-msg-time {
  color: var(--text-tertiary, #666);
}

.pf-director-msg-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding: 3px 8px;
  background: color-mix(in srgb, #22c55e 15%, transparent);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: #22c55e;
}

@keyframes chatMsgEnter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
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
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--separator, #2a2a2a);
  flex-shrink: 0;
}

.pf-textarea {
  flex: 1;
  min-height: 80px;
  max-height: 140px;
  padding: 10px 12px;
  background: var(--surface-soft, #1e1e1e);
  border: 1px solid var(--separator, #2a2a2a);
  border-radius: 10px;
  color: var(--text-primary, #fff);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.pf-textarea:focus {
  border-color: var(--accent, #4a9eff);
  box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.12);
}

.pf-textarea::placeholder {
  color: var(--text-quaternary, #555);
}

.pf-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
