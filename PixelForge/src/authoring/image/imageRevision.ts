/**
 * PixelForge - 以图生图修改管线（技术路线 §21 以图生图 + §21.7 用户修改）
 *
 * 完整链路：
 *   用户上传图片 + 修改指令（如"换成动作和颜色"）
 *     → analyzeImage(image) 获取色块树
 *     → colorBlockTree.toLLMView() 生成 LLM 可读视图
 *     → callLLM(色块视图 + 修改指令) 获取修改后的 LLMOutput
 *     → convertLLMOutputToIntent(LLMOutput) 转为 ParsedIntent
 *     → 调用方负责 ParsedIntent → RenderIR → GPU 渲染
 *
 * 安全约束（对齐 llmParser.ts）：
 *   - LLM 输出必须通过 validateLLMOutput schema 校验
 *   - 转换为 ParsedIntent 后需通过 validateParsedIntent 校验
 *   - LLM 失败时回退：用色块树叶子的主色生成纯色图层
 */

import type { ParsedIntent, ParsedLayerIntent } from '@/authoring/types'
import type { LLMOutput, LLMProviderConfig, LLMRequest, SemanticElement } from '@/authoring/llm/types'
import { Opcode } from '@/shared/types'
import type { JsonLiteral, BlendMode } from '@/shared/types'
import { callLLM } from '@/authoring/llm/callLLM'
import { validateLLMOutput } from '@/authoring/schema/schemas'
import { validateParsedIntent } from '@/authoring/schema/schemas'
import { convertLLMOutputToIntent } from '@/authoring/llm/llmParser'
import { analyzeImage, type AnalyzeOptions } from '@/authoring/image/analyzer'
import type { ColorBlockTree, ColorBlockNode } from '@/authoring/image/colorBlockTree'
import { collectLeafNodes } from '@/authoring/image/colorBlockTree'

// ============================================================================
// ImageRevisionRequest — 修改请求
// ============================================================================

/**
 * 图片修改请求。
 *
 * @param image 已解码的 HTMLImageElement（用户上传的原图）
 * @param instruction 用户的修改指令（如"换成动作和颜色"）
 * @param analyzeOptions 图片分析配置（可选）
 */
export interface ImageRevisionRequest {
  image: HTMLImageElement
  instruction: string
  analyzeOptions?: AnalyzeOptions
}

// ============================================================================
// ImageRevisionResult — 修改结果
// ============================================================================

/**
 * 图片修改结果。
 */
export interface ImageRevisionResult {
  /** 修改后的 ParsedIntent（供调用方转为 RenderIR） */
  intent: ParsedIntent
  /** 图片分析耗时（ms） */
  analysisMs: number
  /** LLM 调用耗时（ms），0 表示回退未调用 LLM */
  llmMs: number
  /** 是否使用了 LLM */
  usedLLM: boolean
  /** 警告信息 */
  warnings: string[]
  /** 色块树（供 UI 展示分析结果） */
  colorBlockTree: ColorBlockTree
  /** LLM 原始输出（如果使用了 LLM） */
  llmOutput?: LLMOutput
}

// ============================================================================
// 系统提示词
// ============================================================================

/**
 * 以图生图修改的系统提示词。
 *
 * 与 llmParser.ts 的 SYSTEM_PROMPT 区别：
 *   - llmParser：从自然语言 prompt 直接生成场景描述
 *   - imageRevision：基于已有色块树结构 + 修改指令，输出修改后的场景
 */
const IMAGE_REVISION_SYSTEM_PROMPT = `You are a visual scene revisor for a procedural rendering engine called PixelForge.

Your task: Given an image's color block structure (spatial tree of color regions) and a revision instruction, output a structured JSON object describing the MODIFIED scene as layers of semantic elements.

Output format (strict JSON):
{
  "scene": "<short description of the modified scene>",
  "style": "<optional style: realistic / abstract / watercolor / minimalist / etc.>",
  "elements": [
    {
      "type": "<element type: background | gradient | circle | noise | starfield | texture>",
      "description": "<natural language description of this element>",
      "color": [r, g, b],
      "layer": <non-negative integer, 0 = bottom>,
      "blend": "<optional: normal | multiply | screen | overlay | add | subtract>",
      "params": { <optional additional parameters> }
    }
  ],
  "dominantColors": [[r, g, b], ...]
}

Rules:
1. "color" is [r, g, b] with values 0-255.
2. "layer" determines draw order: 0 = bottom, higher = on top.
3. Element types map to render operations:
   - "background" or "solid": solid color fill
   - "gradient": linear gradient (include "params": {"direction": "vertical"|"horizontal"|"diagonal", "color2": [r,g,b]})
   - "circle": circle shape (include "params": {"cx": 0.5, "cy": 0.5, "radius": 0.3})
   - "noise": procedural noise (include "params": {"scale": 24, "intensity": 0.8})
   - "starfield": star field (include "params": {"density": 0.5, "size": 2})
   - "texture": image texture (include "params": {"url": "..."})
4. Keep elements between 1 and 16.
5. Apply the user's revision instruction to modify the scene. Change colors, actions, and composition as instructed.
6. Preserve the spatial structure from the color block tree where it makes sense, but modify properties as instructed.
7. Output ONLY the JSON object, no markdown, no explanation.`

// ============================================================================
// reviseImage — 主接口
// ============================================================================

/**
 * 以图生图修改主接口。
 *
 * 完整流程：
 *   1. analyzeImage(image) → ColorBlockTree + ImageAnalysisResult
 *   2. colorBlockTree.toLLMView() → LLM 可读的树形文本
 *   3. callLLM(色块树视图 + 修改指令) → LLMOutput
 *   4. validateLLMOutput(LLMOutput) → 校验
 *   5. convertLLMOutputToIntent(LLMOutput) → ParsedIntent
 *   6. validateParsedIntent(ParsedIntent) → 校验
 *   7. 失败时回退：用色块树叶子的主色生成纯色图层 ParsedIntent
 *
 * @param request 修改请求（图片 + 指令）
 * @param providerConfig LLM 服务商配置
 * @returns 修改结果（包含 ParsedIntent 供调用方转为 RenderIR）
 */
export async function reviseImage(
  request: ImageRevisionRequest,
  providerConfig?: LLMProviderConfig | null,
): Promise<ImageRevisionResult> {
  const warnings: string[] = []

  // Step 1: 分析图片
  const analysisStart = performance.now()
  const analysis = await analyzeImage(request.image, request.analyzeOptions)
  const analysisMs = performance.now() - analysisStart

  console.log('[ImageRevision] 图片分析完成:', {
    duration: `${analysisMs.toFixed(0)}ms`,
    nodeCount: analysis.budgetCheck.nodeCount,
    regions: analysis.regions.length,
  })

  // Step 2: 生成 LLM 可读视图
  const llmView = analysis.colorBlockTree.toLLMView(4)

  // Step 3: 调用 LLM 进行修改
  const llmStart = performance.now()
  let llmOutput: LLMOutput | undefined
  let usedLLM = false

  try {
    if (!providerConfig) {
      throw new Error('未配置 LLM 服务商')
    }

    // 构造 LLM 请求
    const userPrompt = buildRevisionPrompt(llmView, request.instruction)
    const llmRequest: LLMRequest = {
      prompt: userPrompt,
      systemPrompt: IMAGE_REVISION_SYSTEM_PROMPT,
      temperature: 0.4,
      maxTokens: 8000,
    }

    const response = await callLLM(llmRequest, providerConfig, undefined)

    if (!response.parsed) {
      throw new Error('LLM 返回内容不是合法 JSON')
    }

    // Step 4: schema 校验
    validateLLMOutput(response.parsed)
    llmOutput = response.parsed as LLMOutput

    // Step 5: 转换为 ParsedIntent
    const intent = convertLLMOutputToIntent(llmOutput, request.instruction)

    // Step 6: ParsedIntent 校验
    validateParsedIntent(intent)

    usedLLM = true

    return {
      intent,
      analysisMs,
      llmMs: performance.now() - llmStart,
      usedLLM,
      warnings,
      colorBlockTree: analysis.colorBlockTree,
      llmOutput,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    warnings.push(`LLM 修改失败，回退到色块直接转换: ${reason}`)

    // Step 7: 回退 — 用色块树叶子的主色生成纯色图层
    const fallbackIntent = fallbackFromColorBlockTree(analysis.colorBlockTree)

    return {
      intent: fallbackIntent,
      analysisMs,
      llmMs: performance.now() - llmStart,
      usedLLM,
      warnings,
      colorBlockTree: analysis.colorBlockTree,
    }
  }
}

// ============================================================================
// buildRevisionPrompt — 构造修改请求 prompt
// ============================================================================

/**
 * 构造以图生图修改的 LLM prompt。
 *
 * 将色块树视图和用户修改指令组合成完整的 prompt。
 */
function buildRevisionPrompt(llmView: string, instruction: string): string {
  return `# Image Color Block Structure

The following is a spatial tree analysis of the input image. Each node represents a color region with its bounds, average color, variance, and pixel count.

${llmView}

# Revision Instruction

${instruction}

# Task

Based on the color block structure above, apply the revision instruction to generate a MODIFIED scene. Output the modified scene as a structured JSON object following the format specified in the system prompt.`
}

// ============================================================================
// fallbackFromColorBlockTree — 回退：从色块树生成 ParsedIntent
// ============================================================================

/**
 * 回退策略：从色块树叶节点提取颜色，生成纯色图层 ParsedIntent。
 *
 * 每个叶子节点 → 一个 SOLID_COLOR 图层，保留原始空间位置和颜色。
 */
function fallbackFromColorBlockTree(tree: ColorBlockTree): ParsedIntent {
  const leaves = collectLeafNodes(tree.root)

  // 按面积从大到小排序，大块在底
  const sorted = [...leaves].sort((a, b) => {
    const areaA = a.bounds.width * a.bounds.height
    const areaB = b.bounds.width * b.bounds.height
    return areaB - areaA
  })

  // 取最多 8 个色块（避免图层数过多）
  const selected = sorted.slice(0, 8)

  const layers: ParsedLayerIntent[] = selected.map((node, i) => {
    const [r, g, b] = node.dominantColor
    const params: Record<string, JsonLiteral> = {
      color: [r / 255, g / 255, b / 255, 1.0],
    }
    return {
      opcode: Opcode.SOLID_COLOR,
      params,
      blendMode: 'normal' as BlendMode,
      label: `color_block_${i}`,
    }
  })

  return {
    layers,
    rawPrompt: 'image_revision_fallback',
  }
}

// ============================================================================
// localReviseImage — 本地智能修改（不依赖 LLM）
// ============================================================================

/**
 * 本地以图生图修改：代替 LLM 完成图片修改。
 *
 * 当没有配置 LLM 或 LLM 调用失败时，使用此函数进行本地智能修改。
 * 它分析图片的色块树结构，根据修改指令进行：
 *   - 颜色变换：色相旋转、饱和度调整、明度调整
 *   - 动作变换：重构图层为渐变、圆形、噪声等动态元素
 *
 * @param request 修改请求（图片 + 指令）
 * @returns 修改结果（包含 ParsedIntent 供调用方转为 RenderIR）
 */
export async function localReviseImage(
  request: ImageRevisionRequest,
): Promise<ImageRevisionResult> {
  const warnings: string[] = ['使用本地智能修改（未调用 LLM）']

  // Step 1: 分析图片
  const analysisStart = performance.now()
  const analysis = await analyzeImage(request.image, request.analyzeOptions)
  const analysisMs = performance.now() - analysisStart

  console.log('[LocalRevision] 图片分析完成:', {
    duration: `${analysisMs.toFixed(0)}ms`,
    nodeCount: analysis.budgetCheck.nodeCount,
    regions: analysis.regions.length,
  })

  // Step 2: 提取色块树叶节点
  const leaves = collectLeafNodes(analysis.colorBlockTree.root)

  // Step 3: 解析修改指令，确定变换参数
  const transform = parseRevisionInstruction(request.instruction)

  console.log('[LocalRevision] 修改指令解析:', transform)

  // Step 4: 生成 LLMOutput（本地智能生成）
  const llmStart = performance.now()
  const llmOutput = generateLocalLLMOutput(
    leaves,
    transform,
    request.instruction,
    analysis.colorBlockTree,
  )

  // Step 5: schema 校验
  validateLLMOutput(llmOutput)

  // Step 6: 转换为 ParsedIntent
  const intent = convertLLMOutputToIntent(llmOutput, request.instruction)

  // Step 7: ParsedIntent 校验
  validateParsedIntent(intent)

  return {
    intent,
    analysisMs,
    llmMs: performance.now() - llmStart,
    usedLLM: false,
    warnings,
    colorBlockTree: analysis.colorBlockTree,
    llmOutput,
  }
}

// ============================================================================
// RevisionTransform — 修改指令解析结果
// ============================================================================

/**
 * 从用户修改指令中解析出的变换参数。
 */
interface RevisionTransform {
  /** 色相旋转角度（0-360）
   * 0 = 不变，180 = 互补色 */
  hueShift: number
  /** 饱和度倍率（1 = 不变，0 = 灰度，2 = 双倍饱和） */
  saturationMul: number
  /** 明度倍率（1 = 不变，0.5 = 变暗，1.5 = 变亮） */
  brightnessMul: number
  /** 是否添加动态元素（噪声/星空） */
  addDynamicElements: boolean
  /** 是否将纯色块转为渐变 */
  convertToGradient: boolean
  /** 是否添加圆形元素 */
  addCircleElements: boolean
  /** 场景描述 */
  sceneDescription: string
  /** 风格描述 */
  style: string
}

/**
 * 解析用户修改指令，确定变换参数。
 *
 * 支持的中文关键词：
 *   - 颜色 → 色相旋转 + 饱和度调整
 *   - 动作 → 添加动态元素（噪声、星空）
 *   - 暖色/冷色 → 色相偏向暖/冷
 *   - 渐变 → 将纯色转为渐变
 *   *   圆形/圆 → 添加圆形元素
 */
function parseRevisionInstruction(instruction: string): RevisionTransform {
  const text = instruction.toLowerCase().trim()

  // 默认变换
  const transform: RevisionTransform = {
    hueShift: 0,
    saturationMul: 1,
    brightnessMul: 1,
    addDynamicElements: false,
    convertToGradient: false,
    addCircleElements: false,
    sceneDescription: '修改后的场景',
    style: 'abstract',
  }

  // 检测"颜色"关键词 → 进行色相旋转
  if (text.includes('颜色') || text.includes('color')) {
    // 随机但确定性的色相旋转（基于指令长度）
    transform.hueShift = (instruction.length * 37 + 120) % 360
    transform.saturationMul = 1.3
    transform.sceneDescription = '色彩变换后的场景'
  }

  // 检测"动作"关键词 → 添加动态元素
  if (text.includes('动作') || text.includes('action') || text.includes('动态') || text.includes('运动')) {
    transform.addDynamicElements = true
    transform.brightnessMul = 1.1
    transform.sceneDescription = '充满动感的效果场景'
  }

  // 检测"换"关键词 → 强变换
  if (text.includes('换') || text.includes('change')) {
    if (transform.hueShift === 0) transform.hueShift = 180
    transform.saturationMul = 1.5
    transform.convertToGradient = true
    transform.addCircleElements = true
    transform.sceneDescription = '完全重构的场景'
  }

  // 检测暖色/冷色
  if (text.includes('暖') || text.includes('warm')) {
    transform.hueShift = 30
    transform.saturationMul = 1.4
    transform.brightnessMul = 1.1
  }
  if (text.includes('冷') || text.includes('cool')) {
    transform.hueShift = 210
    transform.saturationMul = 0.9
    transform.brightnessMul = 0.9
  }

  // 检测渐变
  if (text.includes('渐变') || text.includes('gradient')) {
    transform.convertToGradient = true
  }

  // 检测圆形/圆
  if (text.includes('圆') || text.includes('circle') || text.includes('球')) {
    transform.addCircleElements = true
  }

  // 如果没有任何关键词被命中，执行默认的"颜色 + 动作"变换
  if (transform.hueShift === 0 && !transform.addDynamicElements && !transform.convertToGradient && !transform.addCircleElements) {
    transform.hueShift = 150
    transform.saturationMul = 1.3
    transform.addDynamicElements = true
    transform.convertToGradient = true
    transform.addCircleElements = true
    transform.sceneDescription = '色彩与动感变换的场景'
  }

  return transform
}

// ============================================================================
// generateLocalLLMOutput — 从色块树生成 LLMOutput
// ============================================================================

/**
 * 从色块树叶节点生成修改后的 LLMOutput。
 *
 * 策略：
 *   1. 按面积排序，取最大的 N 个色块
 *   2. 对每个色块应用颜色变换（色相旋转、饱和度、明度）
 *   3. 根据变换参数，将纯色块转为渐变/圆形/噪声等元素
 *   4. 如果 addDynamicElements，在最顶层添加噪声层
 *   5. 如果 addCircleElements，在主要色块上方添加圆形元素
 */
function generateLocalLLMOutput(
  leaves: ColorBlockNode[],
  transform: RevisionTransform,
  _instruction: string,
  _tree: ColorBlockTree,
): LLMOutput {
  // 按面积从大到小排序
  const sorted = [...leaves].sort((a, b) => {
    const areaA = a.bounds.width * a.bounds.height
    const areaB = b.bounds.width * b.bounds.height
    return areaB - areaA
  })

  // 取最多 6 个色块作为基础图层
  const maxBaseBlocks = Math.min(6, sorted.length)
  const baseBlocks = sorted.slice(0, maxBaseBlocks)

  const elements: SemanticElement[] = []
  const dominantColors: [number, number, number][] = []

  // 为每个基础色块生成语义元素
  for (let i = 0; i < baseBlocks.length; i++) {
    const node = baseBlocks[i]
    const [origR, origG, origB] = node.dominantColor

    // 应用颜色变换
    const [newR, newG, newB] = transformColor(
      origR, origG, origB,
      transform.hueShift,
      transform.saturationMul,
      transform.brightnessMul,
    )

    dominantColors.push([newR, newG, newB])

    // 决定元素类型
    const isLargeBlock = node.bounds.width > 0.3 && node.bounds.height > 0.3
    const isTopHalf = node.bounds.y < 0.5

    if (transform.convertToGradient && isLargeBlock) {
      // 大块 → 渐变层
      // 渐变终止色：原色补色
      const [c2R, c2G, c2B] = transformColor(
        255 - origR, 255 - origG, 255 - origB,
        transform.hueShift,
        transform.saturationMul,
        transform.brightnessMul,
      )
      elements.push({
        type: 'gradient',
        description: `gradient_block_${i}`,
        color: [newR, newG, newB],
        layer: i,
        blend: i === 0 ? 'normal' : 'overlay',
        params: {
          direction: isTopHalf ? 'vertical' : 'diagonal',
          color2: [c2R, c2G, c2B],
        },
      })
    } else {
      // 小块 → 纯色层
      elements.push({
        type: 'background',
        description: `color_block_${i}`,
        color: [newR, newG, newB],
        layer: i,
        blend: i === 0 ? 'normal' : 'normal',
      })
    }
  }

  // 添加圆形元素（如果指令要求）
  if (transform.addCircleElements && baseBlocks.length > 0) {
    // 在最大色块的中心位置添加一个圆形
    const mainBlock = baseBlocks[0]
    const cx = mainBlock.bounds.x + mainBlock.bounds.width / 2
    const cy = mainBlock.bounds.y + mainBlock.bounds.height / 2
    const [origR, origG, origB] = mainBlock.dominantColor
    // 圆形使用对比色
    const [circleR, circleG, circleB] = transformColor(
      255 - origR, 255 - origG, 255 - origB,
      0, // 不额外旋转
      1.5, // 更饱和
      1.2, // 更亮
    )
    elements.push({
      type: 'circle',
      description: 'dynamic_circle',
      color: [circleR, circleG, circleB],
      layer: baseBlocks.length,
      blend: 'screen',
      params: {
        cx: Math.max(0.1, Math.min(0.9, cx)),
        cy: Math.max(0.1, Math.min(0.9, cy)),
        radius: 0.25,
      },
    })
    dominantColors.push([circleR, circleG, circleB])
  }

  // 添加噪声/星空动态元素（如果指令要求）
  if (transform.addDynamicElements) {
    // 噪声层：使用图片平均色的变换色
    const avgColor = sorted[0]?.dominantColor ?? [128, 128, 128]
    const [noiseR, noiseG, noiseB] = transformColor(
      avgColor[0], avgColor[1], avgColor[2],
      transform.hueShift + 60,
      transform.saturationMul,
      transform.brightnessMul,
    )
    elements.push({
      type: 'noise',
      description: 'dynamic_noise_texture',
      color: [noiseR, noiseG, noiseB],
      layer: elements.length,
      blend: 'overlay',
      params: {
        scale: 8,
        intensity: 0.6,
      },
    })

    // 星空层（点状高光）
    const [starR, starG, starB] = transformColor(
      255, 255, 240,
      transform.hueShift,
      1.0,
      1.0,
    )
    elements.push({
      type: 'starfield',
      description: 'starfield_overlay',
      color: [starR, starG, starB],
      layer: elements.length,
      blend: 'add',
      params: {
        density: 0.4,
        size: 2,
      },
    })
    dominantColors.push([starR, starG, starB])
  }

  return {
    scene: transform.sceneDescription,
    style: transform.style,
    elements,
    dominantColors,
  }
}

// ============================================================================
// transformColor — RGB 颜色变换（色相旋转 + 饱和度 + 明度）
// ============================================================================

/**
 * 对 RGB 颜色进行变换：色相旋转 + 饱和度调整 + 明度调整。
 *
 * @param r 红 (0-255)
 * @param g 绿 (0-255)
 * @param b 蓝 (0-255)
 * @param hueShift 色相旋转角度 (0-360)
 * @param satMul 饱和度倍率
 * @param briMul 明度倍率
 * @returns 变换后的 [r, g, b] (0-255)
 */
function transformColor(
  r: number, g: number, b: number,
  hueShift: number,
  satMul: number,
  briMul: number,
): [number, number, number] {
  // RGB → HSL
  const nr = r / 255
  const ng = g / 255
  const nb = b / 255

  const max = Math.max(nr, ng, nb)
  const min = Math.min(nr, ng, nb)
  const delta = max - min

  // 亮度
  let l = (max + min) / 2

  // 饱和度
  let s = 0
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
  }

  // 色相
  let h = 0
  if (delta !== 0) {
    if (max === nr) {
      h = ((ng - nb) / delta) % 6
    } else if (max === ng) {
      h = (nb - nr) / delta + 2
    } else {
      h = (nr - ng) / delta + 4
    }
    h *= 60
    if (h < 0) h += 360
  }

  // 应用变换
  h = (h + hueShift) % 360
  if (h < 0) h += 360
  s = Math.max(0, Math.min(1, s * satMul))
  l = Math.max(0, Math.min(1, l * briMul))

  // HSL → RGB
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let rr = 0, gg = 0, bb = 0
  if (h < 60) { rr = c; gg = x; bb = 0 }
  else if (h < 120) { rr = x; gg = c; bb = 0 }
  else if (h < 180) { rr = 0; gg = c; bb = x }
  else if (h < 240) { rr = 0; gg = x; bb = c }
  else if (h < 300) { rr = x; gg = 0; bb = c }
  else { rr = c; gg = 0; bb = x }

  return [
    Math.round(Math.max(0, Math.min(255, (rr + m) * 255))),
    Math.round(Math.max(0, Math.min(255, (gg + m) * 255))),
    Math.round(Math.max(0, Math.min(255, (bb + m) * 255))),
  ]
}
