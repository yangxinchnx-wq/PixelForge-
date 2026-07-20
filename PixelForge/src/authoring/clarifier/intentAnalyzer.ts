/**
 * 意图分析器(Step 23)— 从自由文本中提取创作需求。
 *
 * 与 prompt/ruleParser.ts 的区别:
 * - ruleParser: 直接生成 Layer[](用于"快速生成"按钮)
 * - intentAnalyzer: 提取主题/风格/元素(用于"澄清"流程,后续生成完整 RenderIR Plan)
 *
 * 关键词识别策略(关键词命中即标记,可叠加):
 *   主题词: 宇宙 / 森林 / 海洋 / 城市 / 人物 / 抽象
 *   风格词: 电影感 / 动漫 / 油画 / 赛博朋克 / 极简
 *   元素词: 星空 / 星云 / 银河 / 树木 / 海浪 / 建筑
 *   颜色词: 蓝紫 / 金黄 / 红色 / 黑白 / 粉色
 *   镜头词: 缓慢推进 / 旋转环绕 / 固定镜头 / 俯视 / 仰视
 *   运动词: 旋转 / 漂浮 / 飞驰 / 静止
 *
 * 当主题无法识别时返回 subject='',由 clarifier.ts 判定 rejected。
 */

import type {
  CreativeCamera,
  CreativeMotion,
  CreativeRequirement,
  CreativeStyle,
} from './types'

/**
 * 主题关键词 → subject 名 + 默认元素列表。
 * 用于在主题识别后自动派生 elements。
 */
const SUBJECT_KEYWORDS: Array<{
  keyword: string
  subject: string
  elements: string[]
}> = [
  { keyword: '宇宙', subject: '宇宙', elements: ['星空', '星云', '银河'] },
  { keyword: '星空', subject: '宇宙', elements: ['星空'] },
  { keyword: '银河', subject: '宇宙', elements: ['银河'] },
  { keyword: '星云', subject: '宇宙', elements: ['星云'] },
  { keyword: '森林', subject: '森林', elements: ['树木', '雾气', '光斑'] },
  { keyword: '树林', subject: '森林', elements: ['树木', '雾气'] },
  { keyword: '海洋', subject: '海洋', elements: ['海浪', '泡沫', '天空'] },
  { keyword: '大海', subject: '海洋', elements: ['海浪', '天空'] },
  { keyword: '海浪', subject: '海洋', elements: ['海浪'] },
  { keyword: '城市', subject: '城市', elements: ['建筑', '灯光', '街道'] },
  { keyword: '都市', subject: '城市', elements: ['建筑', '灯光'] },
  { keyword: '人物', subject: '人物', elements: ['主体'] },
  { keyword: '人像', subject: '人物', elements: ['主体'] },
  { keyword: '抽象', subject: '抽象', elements: ['几何', '色彩'] },
  { keyword: '山水', subject: '山水', elements: ['山', '水', '雾'] },
  { keyword: '山', subject: '山水', elements: ['山'] },
]

/** 风格关键词 → tone 名 */
const STYLE_TONE_KEYWORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '电影', value: 'cinematic' },
  { keyword: '电影感', value: 'cinematic' },
  { keyword: 'cinematic', value: 'cinematic' },
  { keyword: '动漫', value: 'anime' },
  { keyword: '动画', value: 'anime' },
  { keyword: 'anime', value: 'anime' },
  { keyword: '油画', value: 'oil-painting' },
  { keyword: 'oil', value: 'oil-painting' },
  { keyword: '赛博朋克', value: 'cyberpunk' },
  { keyword: 'cyberpunk', value: 'cyberpunk' },
  { keyword: '极简', value: 'minimal' },
  { keyword: 'minimal', value: 'minimal' },
  { keyword: '写实', value: 'realistic' },
  { keyword: 'realistic', value: 'realistic' },
  { keyword: '梦幻', value: 'dreamy' },
  { keyword: 'dreamy', value: 'dreamy' },
]

/** 颜色关键词 → 色调描述 */
const STYLE_COLOR_KEYWORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '蓝紫', value: '蓝紫色' },
  { keyword: '蓝紫色', value: '蓝紫色' },
  { keyword: '金黄', value: '金黄色' },
  { keyword: '金黄色', value: '金黄色' },
  { keyword: '红色', value: '红色' },
  { keyword: '黑白', value: '黑白' },
  { keyword: '粉色', value: '粉色' },
  { keyword: '绿色', value: '绿色' },
  { keyword: '橙色', value: '橙色' },
  { keyword: '紫色', value: '紫色' },
  { keyword: '蓝色', value: '蓝色' },
  { keyword: '暖色', value: '暖色' },
  { keyword: '冷色', value: '冷色' },
]

/** 光照关键词 */
const STYLE_LIGHTING_KEYWORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '柔和', value: '柔和' },
  { keyword: '高对比', value: '高对比' },
  { keyword: '逆光', value: '逆光' },
  { keyword: '侧光', value: '侧光' },
  { keyword: '自然光', value: '自然光' },
  { keyword: '软光', value: '柔和' },
  { keyword: '硬光', value: '高对比' },
]

/** 镜头运动关键词 */
const CAMERA_MOVEMENT_KEYWORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '缓慢推进', value: '缓慢推进' },
  { keyword: '推进', value: '缓慢推进' },
  { keyword: '旋转环绕', value: '旋转环绕' },
  { keyword: '环绕', value: '旋转环绕' },
  { keyword: '旋转', value: '旋转环绕' },
  { keyword: '固定镜头', value: '固定镜头' },
  { keyword: '固定', value: '固定镜头' },
  { keyword: '静止', value: '固定镜头' },
  { keyword: '拉远', value: '拉远' },
  { keyword: '拉近', value: '拉近' },
  { keyword: '平移', value: '平移' },
  { keyword: 'pan', value: '平移' },
  { keyword: 'zoom', value: '拉近' },
]

/** 镜头角度关键词 */
const CAMERA_ANGLE_KEYWORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '俯视', value: '俯视' },
  { keyword: '俯拍', value: '俯视' },
  { keyword: '仰视', value: '仰视' },
  { keyword: '仰拍', value: '仰视' },
  { keyword: '平视', value: '平视' },
  { keyword: 'top-down', value: '俯视' },
]

/** 运动方向关键词 */
const MOTION_DIRECTION_KEYWORDS: Array<{ keyword: string; value: string }> = [
  { keyword: '顺时针', value: '顺时针' },
  { keyword: '逆时针', value: '逆时针' },
  { keyword: '向上', value: '向上' },
  { keyword: '向下', value: '向下' },
  { keyword: '向左', value: '向左' },
  { keyword: '向右', value: '向右' },
  { keyword: '漂浮', value: '漂浮' },
  { keyword: '飞驰', value: '飞驰' },
]

/** 运动速度关键词 → speed 数值(0-1) */
const MOTION_SPEED_KEYWORDS: Array<{ keyword: string; value: number }> = [
  { keyword: '慢速', value: 0.2 },
  { keyword: '缓慢', value: 0.2 },
  { keyword: 'slow', value: 0.2 },
  { keyword: '中速', value: 0.5 },
  { keyword: '快速', value: 0.85 },
  { keyword: '高速', value: 0.95 },
  { keyword: 'fast', value: 0.85 },
]

/** 额外元素关键词(独立于 subject 的派生) */
const ELEMENT_KEYWORDS: string[] = [
  '星空', '星云', '银河', '黑洞', '流星',
  '树木', '雾气', '光斑', '叶子',
  '海浪', '泡沫', '沙滩', '礁石',
  '建筑', '灯光', '街道', '霓虹',
  '山', '水', '云', '雨', '雪',
  '粒子', '光晕', '光柱',
]

/** 在文本中查找第一个命中的关键词,返回对应值 */
function findFirst<T>(
  text: string,
  table: Array<{ keyword: string; value: T }>,
): T | undefined {
  for (const entry of table) {
    if (text.includes(entry.keyword)) {
      return entry.value
    }
  }
  return undefined
}

/**
 * 意图分析主函数。
 *
 * @param prompt 用户输入的自由文本
 * @returns CreativeRequirement(subject 可能为空字符串,由调用方决定是否拒绝)
 */
export function analyzeIntent(prompt: string): CreativeRequirement {
  const text = prompt.toLowerCase()

  // —— 1. 主题识别 ——
  let subject = ''
  let elements: string[] = []

  for (const entry of SUBJECT_KEYWORDS) {
    if (prompt.includes(entry.keyword)) {
      subject = entry.subject
      // 合并该主题的默认元素
      for (const el of entry.elements) {
        if (!elements.includes(el)) elements.push(el)
      }
      break  // 只取第一个命中的主题
    }
  }

  // —— 2. 额外元素识别(在主题派生元素之外补充) ——
  for (const kw of ELEMENT_KEYWORDS) {
    if (prompt.includes(kw) && !elements.includes(kw)) {
      elements.push(kw)
    }
  }

  // —— 3. 风格识别 ——
  const style: CreativeStyle = {}
  // tone 需要同时检查原文与 lowercased(英文关键词如 'cinematic')
  const tone = findFirst(text, STYLE_TONE_KEYWORDS) ?? findFirst(prompt, STYLE_TONE_KEYWORDS)
  if (tone) style.tone = tone

  const color = findFirst(prompt, STYLE_COLOR_KEYWORDS)
  if (color) style.color = color

  const lighting = findFirst(prompt, STYLE_LIGHTING_KEYWORDS)
  if (lighting) style.lighting = lighting

  // —— 4. 镜头识别 ——
  const camera: CreativeCamera = {}
  const movement = findFirst(prompt, CAMERA_MOVEMENT_KEYWORDS)
  if (movement) camera.movement = movement

  const angle = findFirst(prompt, CAMERA_ANGLE_KEYWORDS)
  if (angle) camera.angle = angle

  // 景深关键词
  if (prompt.includes('深景深') || prompt.includes('浅景深')) {
    camera.depth = prompt.includes('深景深') ? 0.8 : 0.3
  }

  // —— 5. 运动识别 ——
  const motion: CreativeMotion = {}
  const direction = findFirst(prompt, MOTION_DIRECTION_KEYWORDS)
  if (direction) motion.direction = direction

  const speed = findFirst(text, MOTION_SPEED_KEYWORDS)
  if (speed !== undefined) motion.speed = speed

  // —— 6. 组装结果 ——
  const requirement: CreativeRequirement = {
    subject,
    elements,
  }

  // 仅在识别到至少一个字段时挂载 style / camera / motion
  if (Object.keys(style).length > 0) requirement.style = style
  if (Object.keys(camera).length > 0) requirement.camera = camera
  if (Object.keys(motion).length > 0) requirement.motion = motion

  return requirement
}

/**
 * 把已识别字段汇总成可读字符串(用于 UI 反馈)。
 */
export function summarizeRequirement(req: CreativeRequirement): string {
  const parts: string[] = []
  if (req.subject) parts.push(`主题: ${req.subject}`)
  if (req.style?.tone) parts.push(`调性: ${req.style.tone}`)
  if (req.style?.color) parts.push(`色调: ${req.style.color}`)
  if (req.elements.length > 0) parts.push(`元素: ${req.elements.join(', ')}`)
  if (req.camera?.movement) parts.push(`镜头: ${req.camera.movement}`)
  if (req.motion?.direction) parts.push(`方向: ${req.motion.direction}`)
  return parts.length > 0 ? parts.join(' | ') : '(未识别到任何创作意图)'
}
