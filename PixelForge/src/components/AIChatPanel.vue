<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue';
import { useAppStore } from '../stores/app';
import { useGraphStore } from '@/graph/graphStore';
import type { RenderGraph } from '@/graph/types';
import PfSelect from './ui/PfSelect.vue';
import DirectorPanel from './DirectorPanel.vue';
import WDLWorkspace from './WDLWorkspace.vue';

const store = useAppStore();
const graphStore = useGraphStore();
const wdlWorkspaceRef = ref<InstanceType<typeof WDLWorkspace> | null>(null);

// ─── Chat Messages ────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const CHAT_STORAGE_KEY = 'pixelforge_chat_messages';

function loadChatMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [{
    id: 'welcome',
    role: 'assistant',
    content: '你好！我是 AI 创作助手。描述你想要生成的图片，我来帮你实现。',
    timestamp: Date.now(),
  }];
}

const messages = ref<ChatMessage[]>(loadChatMessages());

function saveChatMessages() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.value));
  } catch { /* ignore */ }
}

const inputText = ref('');
const isGenerating = computed(() => store.isGenerating);
const messagesRef = ref<HTMLElement | null>(null);
const showDirector = ref(true);
const showWdl = ref(false);

// 自动保存聊天记录
watch(messages, saveChatMessages, { deep: true });

// ─── Model Selection（对接 store 的模型配置）────────────
const modelOptions = computed(() =>
  store.modelConfigs
    .filter((m) => m.enabled)
    .map((m) => ({ value: m.id, label: m.name }))
);
const selectedModel = computed({
  get: () => store.selectedModelId ?? '',
  set: (val: string) => store.setSelectedModel(val),
});

// ─── 以最长模型名称为准，计算下拉框最小宽度 ───────────────
const modelSelectMinWidth = computed(() => {
  if (typeof document === 'undefined') return 'auto';
  const longestLabel = modelOptions.value.reduce(
    (longest, m) => (m.label.length > longest.length ? m.label : longest),
    '选择模型',
  );
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'auto';
  // 与 .pf-custom-select-sm 一致: 11px / system font
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  const textWidth = ctx.measureText(longestLabel).width;
  // padding 8px(left) + 24px(right) + 4px buffer
  return `${Math.ceil(textWidth) + 36}px`;
});

// ─── Send Message ─────────────────────────────────────
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isGenerating.value) return;
  if (!store.selectedModelConfig) return; // 未配置模型时阻止发送

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

  // 调用 LLM 获取回复
  const aiMsgId = `ai-${Date.now()}`;
  messages.value.push({
    id: aiMsgId,
    role: 'assistant',
    content: '正在思考…',
    timestamp: Date.now(),
  });
  await nextTick();
  scrollToBottom();

  try {
    const reply = await store.callSelectedModel(
      text,
      '你是一个创意图片生成助手。用户会描述想要生成的图片，请给出简洁、有创意的回复，帮助用户完善创意。回复不要太长，控制在100字以内。',
    );
    const aiMsg = messages.value.find((m) => m.id === aiMsgId);
    if (aiMsg) {
      aiMsg.content = reply ?? '抱歉，未能获取到回复，请检查模型配置后重试。';
    }
  } catch (e) {
    const aiMsg = messages.value.find((m) => m.id === aiMsgId);
    if (aiMsg) {
      aiMsg.content = `调用失败：${(e as Error).message}`;
    }
  }
  scrollToBottom();
}

// ─── Generate ─────────────────────────────────────────
function handleGenerate() {
  if (!store.livePromptText) return;
  if (!store.selectedModelConfig) return; // 未配置模型时阻止生成
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

// ─── Image Revision（以图生图修改）────────────────
const imageRevisionRef = ref<HTMLInputElement | null>(null);
const uploadedImageSrc = ref<string | null>(null);
const uploadedImageEl = ref<HTMLImageElement | null>(null);
const revisionInstruction = ref('换成动作和颜色');
const isRevising = ref(false);

/** 图片上传回调 */
function onImageFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // 创建 blob URL
  if (uploadedImageSrc.value?.startsWith('blob:')) {
    URL.revokeObjectURL(uploadedImageSrc.value);
  }
  uploadedImageSrc.value = URL.createObjectURL(file);
  // 创建 HTMLImageElement 供分析使用
  const img = new Image();
  img.onload = () => {
    uploadedImageEl.value = img;
  };
  img.src = uploadedImageSrc.value;
  input.value = '';
}

/** 触发图片选择 */
function triggerImageUpload() {
  imageRevisionRef.value?.click();
}

/** 执行图片修改 */
async function handleImageRevision() {
  if (!uploadedImageEl.value || !revisionInstruction.value.trim()) return;
  if (isRevising.value || isGenerating.value) return;

  isRevising.value = true;

  // 添加用户消息
  messages.value.push({
    id: `user-rev-${Date.now()}`,
    role: 'user',
    content: `[图片修改] ${revisionInstruction.value}`,
    timestamp: Date.now(),
  });
  await nextTick();
  scrollToBottom();

  // 添加 AI 处理中消息
  const aiMsgId = `ai-rev-${Date.now()}`;
  messages.value.push({
    id: aiMsgId,
    role: 'assistant',
    content: '正在分析图片并生成修改方案…',
    timestamp: Date.now(),
  });
  await nextTick();
  scrollToBottom();

  try {
    const result = await store.handleImageRevision(
      uploadedImageEl.value,
      revisionInstruction.value,
    );
    const aiMsg = messages.value.find((m) => m.id === aiMsgId);
    if (aiMsg) {
      if (result.success) {
        aiMsg.content = '图片修改完成！你可以在画布中查看效果。' +
          (result.warnings.length > 0 ? `\n提示: ${result.warnings.join('; ')}` : '');
      } else {
        aiMsg.content = `修改失败: ${result.warnings.join('; ')}`;
      }
    }
  } catch (e) {
    const aiMsg = messages.value.find((m) => m.id === aiMsgId);
    if (aiMsg) {
      aiMsg.content = `发生错误: ${(e as Error).message}`;
    }
  } finally {
    isRevising.value = false;
  }
  scrollToBottom();
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

function handleWdlGraphSync(graph: RenderGraph): void {
  graphStore.loadGraph(graph);
}

function handleGraphToWdl(): void {
  wdlWorkspaceRef.value?.updateFromGraph(graphStore.exportGraph());
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
  <div class="pf-panel glass-surface pf-panel-left pf-chat-panel">
    <!-- Header -->
    <div class="pf-panel-header">
      <span class="pf-panel-title">AI Director</span>
      <div class="pf-chat-header-actions">
        <button type="button" class="pf-chat-mode-btn" :class="{ active: showDirector }" @click="showDirector = !showDirector">决策</button>
        <button type="button" class="pf-chat-mode-btn" :class="{ active: showWdl }" @click="showWdl = !showWdl">WDL</button>
        <button v-if="showWdl" type="button" class="pf-chat-mode-btn" @click="handleGraphToWdl">图→WDL</button>
      </div>
    </div>
    <DirectorPanel v-if="showDirector" v-model:visible="showDirector" />
    <WDLWorkspace
      v-if="showWdl"
      ref="wdlWorkspaceRef"
      class="pf-inline-wdl"
      @apply-i-r="store.applyRenderIR"
      @graph-sync="handleWdlGraphSync"
    />

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

    <!-- Image Revision Area -->
    <div class="pf-chat-revision">
      <input
        ref="imageRevisionRef"
        type="file"
        accept="image/*"
        class="pf-chat-file-input"
        @change="onImageFileChange"
      />
      <div class="pf-chat-revision-row">
        <button
          class="pf-chat-upload-btn"
          :class="{ 'has-image': uploadedImageSrc }"
          @click="triggerImageUpload"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span>{{ uploadedImageSrc ? '更换图片' : '上传图片' }}</span>
        </button>
        <img
          v-if="uploadedImageSrc"
          :src="uploadedImageSrc"
          class="pf-chat-revision-thumb"
          alt="待修改图片"
        />
      </div>
      <div class="pf-chat-revision-input-row" v-if="uploadedImageSrc">
        <input
          v-model="revisionInstruction"
          class="pf-chat-revision-input"
          placeholder="输入修改指令，如：换成动作和颜色"
          @keydown.enter.prevent="handleImageRevision"
        />
        <button
          class="btn-primary pf-chat-revision-btn"
          :disabled="!revisionInstruction.trim() || isRevising || isGenerating"
          @click="handleImageRevision"
        >
          {{ isRevising ? '修改中…' : '执行修改' }}
        </button>
      </div>
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
          v-if="modelOptions.length > 0"
          v-model="selectedModel"
          :options="modelOptions"
          size="small"
          :block="false"
          title="选择模型"
          class="pf-chat-model-select"
          :style="{ minWidth: modelSelectMinWidth }"
          menu-match-selector=".pf-chat-input-area"
          menu-placement="top"
        />
        <span v-else class="pf-chat-no-model" title="请在设置中添加模型">未配置模型</span>
        <button
          class="btn-primary pf-chat-send-btn"
          :disabled="!inputText.trim() || isGenerating || !store.selectedModelConfig"
          @click="sendMessage"
        >
          <span class="pf-chat-btn-text">发送</span>
        </button>
        <button
          class="btn-primary pf-chat-generate-btn"
          :disabled="isGenerating || !store.selectedModelConfig"
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

.pf-inline-wdl {
  flex: 1 1 45%;
  min-height: 240px;
  margin: 0 12px 8px;
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

/* ── Image Revision ── */
.pf-chat-revision {
  flex-shrink: 0;
  padding: 8px 12px 4px;
  border-top: 1px solid var(--separator);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pf-chat-file-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.pf-chat-revision-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pf-chat-upload-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px dashed var(--separator-strong);
  background: var(--glass-bg);
  color: var(--text-secondary);
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 150ms var(--ease-out);
}

.pf-chat-upload-btn:hover {
  background: var(--glass-bg-hover);
  color: var(--text-primary);
  border-color: var(--accent);
}

.pf-chat-upload-btn.has-image {
  border-style: solid;
  border-color: var(--separator);
}

.pf-chat-revision-thumb {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: var(--radius-xs);
  border: 1px solid var(--separator);
  flex-shrink: 0;
}

.pf-chat-revision-input-row {
  display: flex;
  gap: 6px;
}

.pf-chat-revision-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  background: var(--track-bg);
  border: 1px solid var(--separator);
  border-radius: var(--radius-xs);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 11px;
  outline: none;
  transition: border-color 200ms var(--ease-out);
}

.pf-chat-revision-input:focus {
  border-color: var(--accent);
}

.pf-chat-revision-input::placeholder {
  color: var(--text-tertiary);
}

.pf-chat-revision-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  font-size: 11px;
  border-radius: var(--radius-xs);
}

.pf-chat-revision-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  height: 30px;
  font-size: 11px;
}

.pf-chat-no-model {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  font-size: 11px;
  color: var(--text-quaternary);
  white-space: nowrap;
}
</style>
