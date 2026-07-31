/**
 * PixelForge — 已知模型元数据库
 *
 * 各 provider 的 /models 端点只返回模型 ID 列表，不包含上下文窗口、
 * 思考能力、最大输出 token 等关键信息。本文件维护一份静态元数据库，
 * 供 modelDiscovery 在拉取模型列表后合并补充。
 *
 * 数据来源：各官方文档（截至 2025-07）
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 模型元数据。
 */
export interface ModelMetadata {
  /** 模型 ID（如 "gpt-4o"） */
  id: string
  /** 展示名称 */
  displayName: string
  /** 上下文窗口大小（token 数） */
  contextWindow: number
  /** 最大输出 token 数 */
  maxOutputTokens: number
  /** 是否支持思考/推理模式 */
  supportsThinking: boolean
  /** 是否支持视觉输入 */
  supportsVision: boolean
  /** 是否支持函数调用 */
  supportsFunctionCalling: boolean
  /** 是否支持图片生成 */
  supportsImageGeneration?: boolean
  /** 是否支持视频生成 */
  supportsVideoGeneration?: boolean
  /** 是否支持音频/音乐生成 */
  supportsAudioGeneration?: boolean
  /** 请求频率限制（RPM，requests per minute） */
  rpmLimit?: number
  /** Token 频率限制（TPM，tokens per minute） */
  tpmLimit?: number
}

// ============================================================================
// OpenAI 已知模型
// ============================================================================

const OPENAI_MODELS: ModelMetadata[] = [
  {
    id: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 150_000,
  },
  {
    id: 'gpt-4o-2024-11-20',
    displayName: 'GPT-4o (2024-11-20)',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'gpt-4o-2024-08-06',
    displayName: 'GPT-4o (2024-08-06)',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'o1',
    displayName: 'o1',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    supportsVision: true,
    supportsFunctionCalling: false,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'o1-mini',
    displayName: 'o1-mini',
    contextWindow: 128_000,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsVision: false,
    supportsFunctionCalling: false,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'o1-preview',
    displayName: 'o1-preview',
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    supportsThinking: true,
    supportsVision: false,
    supportsFunctionCalling: false,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'o3-mini',
    displayName: 'o3-mini',
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    supportsVision: false,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'gpt-4.1',
    displayName: 'GPT-4.1',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'gpt-4.1-mini',
    displayName: 'GPT-4.1 mini',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 150_000,
  },
  {
    id: 'gpt-4.1-nano',
    displayName: 'GPT-4.1 nano',
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 150_000,
  },
  {
    id: 'gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'gpt-4-turbo-preview',
    displayName: 'GPT-4 Turbo Preview',
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 500,
    tpmLimit: 30_000,
  },
  {
    id: 'gpt-3.5-turbo',
    displayName: 'GPT-3.5 Turbo',
    contextWindow: 16_385,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsVision: false,
    supportsFunctionCalling: true,
    rpmLimit: 3500,
    tpmLimit: 200_000,
  },
]

// ============================================================================
// Anthropic 已知模型
// ============================================================================

const ANTHROPIC_MODELS: ModelMetadata[] = [
  {
    id: 'claude-opus-4-0-20250514',
    displayName: 'Claude Opus 4.0',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    supportsThinking: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 50,
    tpmLimit: 40_000,
  },
  {
    id: 'claude-sonnet-4-0-20250514',
    displayName: 'Claude Sonnet 4.0',
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    supportsThinking: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 50,
    tpmLimit: 40_000,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    displayName: 'Claude 3.5 Sonnet',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 50,
    tpmLimit: 40_000,
  },
  {
    id: 'claude-3-5-sonnet-20240620',
    displayName: 'Claude 3.5 Sonnet (2024-06-20)',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 50,
    tpmLimit: 40_000,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 100,
    tpmLimit: 100_000,
  },
  {
    id: 'claude-3-opus-20240229',
    displayName: 'Claude 3 Opus',
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 50,
    tpmLimit: 40_000,
  },
  {
    id: 'claude-3-sonnet-20240229',
    displayName: 'Claude 3 Sonnet',
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 50,
    tpmLimit: 40_000,
  },
  {
    id: 'claude-3-haiku-20240307',
    displayName: 'Claude 3 Haiku',
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 100,
    tpmLimit: 100_000,
  },
]

// ============================================================================
// Google 已知模型
// ============================================================================

const GOOGLE_MODELS: ModelMetadata[] = [
  {
    id: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 1000,
    tpmLimit: 1_000_000,
  },
  {
    id: 'gemini-2.0-flash-thinking-exp',
    displayName: 'Gemini 2.0 Flash Thinking',
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    supportsVision: true,
    supportsFunctionCalling: false,
    rpmLimit: 1000,
    tpmLimit: 1_000_000,
  },
  {
    id: 'gemini-1.5-pro',
    displayName: 'Gemini 1.5 Pro',
    contextWindow: 2_097_152,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 360,
    tpmLimit: 1_000_000,
  },
  {
    id: 'gemini-1.5-flash',
    displayName: 'Gemini 1.5 Flash',
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 1000,
    tpmLimit: 1_000_000,
  },
  {
    id: 'gemini-1.5-flash-8b',
    displayName: 'Gemini 1.5 Flash 8B',
    contextWindow: 1_048_576,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    rpmLimit: 4000,
    tpmLimit: 4_000_000,
  },
]

// ============================================================================
// 查找表
// ============================================================================

const REGISTRY: Record<string, ModelMetadata[]> = {
  openai: OPENAI_MODELS,
  anthropic: ANTHROPIC_MODELS,
  google: GOOGLE_MODELS,
}

/**
 * 按 provider + modelId 查找已知元数据。
 * 支持模糊匹配（modelId 包含已知 ID 的前缀）。
 */
export function lookupModelMetadata(
  provider: string,
  modelId: string,
): ModelMetadata | undefined {
  const models = REGISTRY[provider]
  if (!models) return undefined

  // 精确匹配
  let meta = models.find((m) => m.id === modelId)
  if (meta) return meta

  // 前缀匹配（如 "gpt-4o-2024-11-20" 匹配 "gpt-4o"）
  // 按长度降序排列，优先匹配最长的前缀
  const sorted = [...models].sort((a, b) => b.id.length - a.id.length)
  meta = sorted.find((m) => modelId.startsWith(m.id))
  return meta
}

/**
 * 获取指定 provider 的全部已知模型列表。
 */
export function getKnownModels(provider: string): ModelMetadata[] {
  return REGISTRY[provider] ?? []
}

// ============================================================================
// 启发式能力推断（用于 API 返回但 registry 中无元数据的模型）
// ============================================================================

/** 图片生成模型 ID 关键词 */
const IMAGE_KEYWORDS = ['dall-e', 'dalle', 'stable-diffusion', 'sdxl', 'flux', 'imagen', 'midjourney', 'paint', 'draw', 'image-gen', 'text-to-image']
/** 视频生成模型 ID 关键词 */
const VIDEO_KEYWORDS = ['sora', 'video', 'runway', 'pika', 'kling', 'text-to-video', 'video-gen']
/** 音频/音乐生成模型 ID 关键词 */
const AUDIO_KEYWORDS = ['tts', 'music', 'audio', 'suno', 'elevenlabs', 'voice', 'text-to-speech', 'text-to-audio']

/** 根据模型 ID 推断能力（生图/视频/音频） */
export function inferCapabilities(modelId: string): {
  supportsImageGeneration: boolean
  supportsVideoGeneration: boolean
  supportsAudioGeneration: boolean
} {
  const lower = modelId.toLowerCase()
  return {
    supportsImageGeneration: IMAGE_KEYWORDS.some((k) => lower.includes(k)),
    supportsVideoGeneration: VIDEO_KEYWORDS.some((k) => lower.includes(k)),
    supportsAudioGeneration: AUDIO_KEYWORDS.some((k) => lower.includes(k)),
  }
}
