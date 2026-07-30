<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue';
import { useAppStore } from '../stores/app';
import PfSelect from './ui/PfSelect.vue';

const store = useAppStore();

// ─── Chat Messages ────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const messages = ref<ChatMessage[]>([
  {
    id: 'welcome',
    role: 'assistant',
    content: '你好！我是 AI 创作助手。描述你想要生成的图片，我来帮你实现。',
    timestamp: Date.now(),
  },
]);

const inputText = ref('');
const isGenerating = computed(() => store.isGenerating);
const messagesRef = ref<HTMLElement | null>(null);

// ─── Model Selection ───────────────────────────────────
const models = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku' },
  { value: 'claude-3-opus', label: 'Claude 3 Opus' },
];
const selectedModel = ref(models[0].value);

// ─── Send Message ─────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isGenerating.value) return;

  // 添加用户消息
  messages.value.push({
    id: `user-${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });
  inputText.value = '';

  // 更新 store 中的 prompt
  store.handlePromptTextChange(text);

  // 滚动到底部
  await nextTick();
  scrollToBottom();

  // 模拟 AI 回复
  setTimeout(() => {
    messages.value.push({
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: `已收到你的描述："${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"。点击下方"生成"按钮开始创作。`,
      timestamp: Date.now(),
    });
    scrollToBottom();
  }, 600);
}

// ─── Generate ─────────────────────────────────────────
function handleGenerate() {
  if (!store.livePromptText) return;
  store.handleGenerate();

  // 添加生成中的消息
  messages.value.push({
    id: `gen-${Date.now()}`,
    role: 'assistant',
    content: '正在生成图片，请稍候…',
    timestamp: Date.now(),
  });
  scrollToBottom();

  // 生成完成后添加结果消息
  setTimeout(() => {
    const lastMsg = messages.value[messages.value.length - 1];
    if (lastMsg && lastMsg.content.includes('正在生成')) {
      lastMsg.content = '图片已生成完成！你可以在画布中查看效果。';
    }
    scrollToBottom();
  }, 1300);
}

// ─── Quick Prompts ────────────────────────────────────
const quickPrompts = [
  '夕阳下的山脉',
  '城市夜景霓虹',
  '森林晨雾',
  '海洋日落',
];

function useQuickPrompt(prompt: string) {
  inputText.value = prompt;
}

// ─── Helpers ──────────────────────────────────────────
function scrollToBottom() {
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// ─── Enter to send (Shift+Enter for newline) ──────────
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// 监听 isGenerating 变化，滚动到底部
watch(isGenerating, () => {
  nextTick(scrollToBottom);
});
</script>

<template>
  <div class="pf-panel pf-panel-left pf-chat-panel">
    <!-- Header -->
    <div class="pf-panel-header">
      <span class="pf-panel-title">AI 对话</span>
      <div class="pf-chat-status">
        <span class="pf-chat-status-dot" :class="{ active: isGenerating }" />
        <span class="pf-chat-status-text">{{ isGenerating ? '生成中' : '就绪' }}</span>
      </div>
    </div>

    <!-- Messages -->
    <div class="pf-chat-messages" ref="messagesRef">
      <div
        v-for="msg in messages"
        :key="msg.id"
        class="pf-chat-msg"
        :class="'pf-chat-msg-' + msg.role"
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
          <span class="pf-chat-msg-time">{{ formatTime(msg.timestamp) }}</span>
        </div>
      </div>
    </div>

    <!-- Quick Prompts -->
    <div class="pf-chat-quick">
      <button
        v-for="prompt in quickPrompts"
        :key="prompt"
        class="pf-chat-quick-btn"
        @click="useQuickPrompt(prompt)"
      >
        {{ prompt }}
      </button>
    </div>

    <!-- Input Area -->
    <div class="pf-chat-input-area">
      <textarea
        v-model="inputText"
        class="pf-chat-input"
        placeholder="描述你想要生成的图片…  (Enter 发送 · Shift+Enter 换行)"
        rows="3"
        @keydown="onKeydown"
      />
      <div class="pf-chat-input-actions">
        <PfSelect
          v-model="selectedModel"
          :options="models"
          size="small"
          :block="false"
          title="选择模型"
          class="pf-chat-model-select"
        />
        <button
          class="btn-primary pf-chat-send-btn"
          :disabled="!inputText.trim() || isGenerating"
          @click="sendMessage"
        >
          <span class="pf-chat-btn-text">发送</span>
        </button>
        <button
          class="btn-primary pf-chat-generate-btn"
          :disabled="isGenerating"
          @click="handleGenerate"
        >
          <span class="pf-chat-btn-text">{{ isGenerating ? '生成中…' : '生成' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf-chat-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ── Status indicator ── */
.pf-chat-status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.pf-chat-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-quaternary);
  transition: background 200ms ease;
}

.pf-chat-status-dot.active {
  background: var(--toggle-solo);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.pf-chat-status-text {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-tertiary);
}

/* ── Messages ── */
.pf-chat-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pf-chat-messages::-webkit-scrollbar {
  width: 6px;
}

.pf-chat-messages::-webkit-scrollbar-thumb {
  background: var(--text-quaternary);
  border-radius: 3px;
}

.pf-chat-msg {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  animation: chatMsgEnter 300ms var(--ease-out);
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

.pf-chat-msg-user {
  flex-direction: row-reverse;
}

.pf-chat-msg-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--track-bg);
  color: var(--text-secondary);
}

.pf-chat-msg-user .pf-chat-msg-avatar {
  background: var(--accent);
  color: var(--accent-text);
}

.pf-chat-msg-bubble {
  max-width: 75%;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--track-bg);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pf-chat-msg-user .pf-chat-msg-bubble {
  background: var(--accent);
  color: var(--accent-text);
}

.pf-chat-msg-assistant .pf-chat-msg-bubble {
  background: var(--glass-bg-hover);
  border: 1px solid var(--separator);
}

.pf-chat-msg-text {
  font-size: 12px;
  line-height: 1.5;
  color: inherit;
  word-wrap: break-word;
}

.pf-chat-msg-user .pf-chat-msg-text {
  color: var(--accent-text);
}

.pf-chat-msg-time {
  font-size: 9px;
  color: var(--text-tertiary);
  align-self: flex-end;
}

.pf-chat-msg-user .pf-chat-msg-time {
  color: rgba(255, 255, 255, 0.6);
}

/* ── Quick Prompts ── */
.pf-chat-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.pf-chat-quick-btn {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--separator);
  background: var(--glass-bg);
  color: var(--text-secondary);
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: 10px;
  font-weight: 500;
  transition: all 150ms var(--ease-out);
  white-space: nowrap;
}

.pf-chat-quick-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
  border-color: var(--separator-strong);
}

.pf-chat-quick-btn:active {
  transform: scale(0.96);
}

/* ── Input Area ── */
.pf-chat-input-area {
  flex-shrink: 0;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--separator);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pf-chat-input {
  width: 100%;
  min-height: 56px;
  max-height: 100px;
  padding: 8px 10px;
  background: var(--track-bg);
  border: 1px solid var(--separator);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out);
}

.pf-chat-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.12);
}

.pf-chat-input::placeholder {
  color: var(--text-tertiary);
}

.pf-chat-input-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pf-chat-send-btn,
.pf-chat-generate-btn {
  flex: 1 1 0;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  font-size: 11px;
  justify-content: center;
  overflow: hidden;
}

.pf-chat-btn-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pf-chat-send-btn:disabled,
.pf-chat-generate-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pf-chat-model-select {
  flex-shrink: 0;
  max-width: 140px;
  height: 30px;
  font-size: 11px;
}
</style>
