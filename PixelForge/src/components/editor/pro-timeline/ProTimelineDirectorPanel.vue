<script setup lang="ts">
/**
 * ProTimelineDirectorPanel(Step 36.5)— AI Director 对话式面板。
 *
 * 功能:
 * - 对话式界面:用户输入 → Director 响应 → 显示决策
 * - 多轮对话:支持迭代修改("再亮一点")
 * - 决策预览:展示 Director 生成的 patches,确认后应用
 * - API 配置:设置 LLM provider / API key / model
 * - 模式指示:create / modify / animate / analyze
 *
 * 设计:
 * - --pf-* 设计令牌
 * - cubic-bezier(0.22, 1, 0.36, 1) 180ms 过渡
 * - 中文文字标签,JetBrains Mono 用于数字
 */
import { ref, shallowRef, computed } from 'vue'

import { useRuntimeStore } from '@/stores/runtime'
import {
  createConversation,
  converse,
  resetConversationIdCounter,
} from '@/world/director/directorConversation'
import type { ConversationSession, ConversationMessage } from '@/world/director/directorConversation'
import { parseEnhancedIntent } from '@/world/director/directorEnhanced'
import type { DirectorMode } from '@/world/director/directorEnhanced'
import type { LLMProviderConfig } from '@/authoring/llm/types'

const runtimeStore = useRuntimeStore()

const visible = ref(false)

// ============================================================================
// 对话状态
// ============================================================================

const session = shallowRef<ConversationSession>(createConversation())
const inputText = ref('')
const isThinking = ref(false)

// API 配置
const apiConfigVisible = ref(false)
const provider = ref<'openai' | 'anthropic'>('openai')
const apiKey = ref('')
const model = ref('')
const baseUrl = ref('')

// ============================================================================
// 计算属性
// ============================================================================

/** 当前 RenderIR(从 runtime store 获取) */
const currentIR = computed(() => runtimeStore.currentIr ?? null)

/** 对话消息列表(过滤只显示有内容的) */
const messages = computed(() => session.value.messages)

/** 消息总数 */
const messageCount = computed(() => session.value.messages.length)

/** 已应用 patches 总数 */
const appliedPatchCount = computed(() => session.value.appliedPatches.length)

/** 模式中文显示 */
const MODE_DISPLAY: Record<DirectorMode, string> = {
  create: '创建',
  modify: '修改',
  animate: '动画',
  analyze: '分析',
}

/** 检测当前输入的模式 */
const detectedMode = computed<DirectorMode>(() => {
  if (!inputText.value.trim()) return 'create'
  const intent = parseEnhancedIntent(inputText.value, currentIR.value)
  return intent.mode
})

// ============================================================================
// 操作
// ============================================================================

function toggle() {
  visible.value = !visible.value
}

function getMessageMode(msg: ConversationMessage): DirectorMode | null {
  return msg.intent?.mode ?? null
}

/** 发送消息 */
async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || isThinking.value) return

  inputText.value = ''
  isThinking.value = true

  try {
    const defaultModel = model.value || (provider.value === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022')
    const providerConfig: LLMProviderConfig | null = apiKey.value ? {
      provider: provider.value,
      apiKey: apiKey.value,
      defaultModel,
      baseUrl: baseUrl.value || undefined,
    } : null
    const ir = currentIR.value
    const updated: ConversationSession = await converse(
      session.value,
      text,
      ir,
      null,
      {
        providerConfig,
        disableCache: true,
      },
    )
    session.value = updated
  } finally {
    isThinking.value = false
  }
}

/** 清空对话 */
function handleClear() {
  resetConversationIdCounter()
  session.value = createConversation()
}

/** 按 Enter 发送 */
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <div class="director-panel-wrapper">
    <button class="director-toggle-btn" @click="toggle">
      AI Director
    </button>

    <Transition name="director-slide">
      <div v-if="visible" class="director-panel">
        <!-- 头部 -->
        <header class="director-header">
          <span class="director-title">AI Director</span>
          <div class="director-header-actions">
            <button class="icon-btn" @click="apiConfigVisible = !apiConfigVisible" title="API 配置">
              设置
            </button>
            <button class="icon-btn" @click="handleClear" title="清空对话">
              清空
            </button>
            <button class="icon-btn" @click="toggle" title="关闭">
              关闭
            </button>
          </div>
        </header>

        <!-- API 配置区 -->
        <Transition name="director-fade">
          <div v-if="apiConfigVisible" class="api-config">
            <div class="config-row">
              <label>服务商</label>
              <select v-model="provider" class="config-select">
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </div>
            <div class="config-row">
              <label>API Key</label>
              <input v-model="apiKey" type="password" placeholder="sk-..." class="config-input" />
            </div>
            <div class="config-row">
              <label>模型</label>
              <input v-model="model" type="text" :placeholder="provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-20241022'" class="config-input" />
            </div>
            <div class="config-row">
              <label>Base URL</label>
              <input v-model="baseUrl" type="text" placeholder="可选" class="config-input" />
            </div>
          </div>
        </Transition>

        <!-- 对话区 -->
        <div class="conversation-area">
          <div v-if="messages.length === 0" class="empty-hint">
            输入你的创意,AI Director 帮你实现
          </div>
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message-item"
            :class="msg.role"
          >
            <span class="message-role">{{ msg.role === 'user' ? '我' : 'Director' }}</span>
            <span v-if="getMessageMode(msg)" class="message-mode">{{ MODE_DISPLAY[getMessageMode(msg)!] }}</span>
            <div class="message-content">{{ msg.content }}</div>
            <div v-if="msg.decision && msg.decision.patches.length > 0" class="message-patches">
              <span class="patch-count">{{ msg.decision.patches.length }} 个修改</span>
              <div v-for="(p, i) in msg.decision.patches.slice(0, 3)" :key="i" class="patch-item">
                {{ p.targetId }}.{{ p.paramKey }} = {{ p.value }}
              </div>
              <span v-if="msg.decision.patches.length > 3" class="patch-more">
                ...共 {{ msg.decision.patches.length }} 个
              </span>
            </div>
          </div>
          <div v-if="isThinking" class="message-item director thinking">
            <span class="message-role">Director</span>
            <span class="thinking-dots">思考中...</span>
          </div>
        </div>

        <!-- 输入区 -->
        <footer class="director-input-area">
          <div class="mode-indicator">{{ MODE_DISPLAY[detectedMode] }}模式</div>
          <textarea
            v-model="inputText"
            class="director-input"
            placeholder="描述你的创意或修改意图..."
            rows="2"
            @keydown="onKeydown"
            :disabled="isThinking"
          ></textarea>
          <button
            class="send-btn"
            @click="sendMessage"
            :disabled="!inputText.trim() || isThinking"
          >
            发送
          </button>
        </footer>

        <!-- 统计 -->
        <div class="director-stats">
          <span>消息: {{ messageCount }}</span>
          <span>修改: {{ appliedPatchCount }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.director-panel-wrapper {
  display: inline-flex;
  align-items: center;
}

.director-toggle-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.director-toggle-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.director-panel {
  position: fixed;
  right: 16px;
  top: 60px;
  bottom: 16px;
  width: 380px;
  display: flex;
  flex-direction: column;
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
  border-radius: 8px;
  z-index: 100;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.director-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pf-line);
}
.director-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--pf-ink);
}
.director-header-actions {
  display: flex;
  gap: 4px;
}
.icon-btn {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--pf-ink);
  background: transparent;
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  cursor: pointer;
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.icon-btn:hover {
  border-color: var(--pf-accent);
  color: var(--pf-accent);
}

.api-config {
  padding: 10px 14px;
  border-bottom: 1px solid var(--pf-line);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.config-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.config-row label {
  font-size: 11px;
  color: var(--pf-ink);
  width: 60px;
  flex-shrink: 0;
}
.config-input,
.config-select {
  flex: 1;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--pf-ink);
  background: var(--pf-bg);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  outline: none;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.config-input:focus,
.config-select:focus {
  border-color: var(--pf-accent);
}

.conversation-area {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty-hint {
  color: var(--pf-ink);
  opacity: 0.5;
  font-size: 12px;
  text-align: center;
  padding-top: 40px;
}

.message-item {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
}
.message-item.user {
  background: var(--pf-accent);
  color: #fff;
  margin-left: 32px;
}
.message-item.director {
  background: var(--pf-bg);
  border: 1px solid var(--pf-line);
  color: var(--pf-ink);
  margin-right: 32px;
}
.message-role {
  font-size: 10px;
  font-weight: 600;
  opacity: 0.7;
  margin-right: 6px;
}
.message-mode {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
}
.message-item.director .message-mode {
  background: var(--pf-surface);
  border: 1px solid var(--pf-line);
}
.message-content {
  margin-top: 4px;
}
.message-patches {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
}
.message-item.director .message-patches {
  border-top-color: var(--pf-line);
}
.patch-count {
  font-weight: 600;
}
.patch-item {
  opacity: 0.8;
  margin-top: 2px;
}
.patch-more {
  opacity: 0.6;
}

.thinking-dots {
  font-size: 11px;
  opacity: 0.6;
}

.director-input-area {
  padding: 10px 14px;
  border-top: 1px solid var(--pf-line);
}
.mode-indicator {
  font-size: 10px;
  color: var(--pf-accent);
  margin-bottom: 4px;
}
.director-input {
  width: 100%;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--pf-ink);
  background: var(--pf-bg);
  border: 1px solid var(--pf-line);
  border-radius: 4px;
  resize: none;
  outline: none;
  transition: border-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.director-input:focus {
  border-color: var(--pf-accent);
}
.send-btn {
  margin-top: 6px;
  padding: 4px 16px;
  font-size: 12px;
  color: #fff;
  background: var(--pf-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.director-stats {
  display: flex;
  gap: 12px;
  padding: 6px 14px;
  border-top: 1px solid var(--pf-line);
  font-size: 10px;
  color: var(--pf-ink);
  opacity: 0.6;
  font-family: 'JetBrains Mono', monospace;
}

/* 过渡动画 */
.director-slide-enter-active,
.director-slide-leave-active {
  transition: all 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.director-slide-enter-from,
.director-slide-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.director-fade-enter-active,
.director-fade-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.director-fade-enter-from,
.director-fade-leave-to {
  opacity: 0;
}
</style>
