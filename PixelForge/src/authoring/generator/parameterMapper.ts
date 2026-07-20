/**
 * 参数映射器(Step 24.4)。
 *
 * 职责:把人类语言描述的 CreativeRequirement 字段(style / camera / motion)
 *      转换为 GPU 可消费的 JsonLiteral 参数(颜色 / 亮度 / 对比度 / 速度 ...)。
 *
 * 设计原则:
 * - 输入是 CreativeRequirement 的子字段(可选)
 * - 输出是扁平的 Record<string, JsonLiteral>(可被 LayerTemplate.defaultParams 合并)
 * - 不依赖 Opcode,纯参数映射(planner 会按图层类型决定哪些参数适用)
 *
 * 与 clarifier/questionGenerator.ts 的 speedKeywordToValue 的区别:
 * - speedKeywordToValue: 单值转换('慢速' → 0.2)
 * - mapMotionToParams:   返回参数字典({ speed: 0.2, motionScale: 0.4 })
 *
 * 颜色映射表与 intentAnalyzer.ts 的 STYLE_COLOR_KEYWORDS 对齐,
 * 保证用户在 clarifier 中选择的颜色描述能被准确还原。
 */

import type { JsonLiteral } from '@/shared/types'
import type {
  CreativeCamera,
  CreativeMotion,
  CreativeStyle,
} from '@/authoring/clarifier/types'

/**
 * 颜色名 → RGBA 归一化值(0-1,4 元素)。
 *
 * 与 intentAnalyzer.ts 的 STYLE_COLOR_KEYWORDS 输出值对齐。
 * 顺序:中文描述(蓝紫色 / 金黄色 / 红色 / 黑白 / 粉色 / 绿色 / 橙色 / 紫色 / 蓝色 / 暖色 / 冷色)。
 */
const COLOR_NAME_TO_RGBA: Record<string, [number, number, number, number]> = {
  '蓝紫色': [0.2, 0.3, 1.0, 1],
  '金黄色': [0.95, 0.78, 0.18, 1],
  '红色':   [0.9, 0.15, 0.15, 1],
  '黑白':   [0.05, 0.05, 0.05, 1],
  '粉色':   [0.95, 0.6, 0.75, 1],
  '绿色':   [0.2, 0.75, 0.35, 1],
  '橙色':   [0.95, 0.55, 0.18, 1],
  '紫色':   [0.55, 0.2, 0.85, 1],
  '蓝色':   [0.15, 0.4, 0.95, 1],
  '暖色':   [0.95, 0.65, 0.35, 1],
  '冷色':   [0.2, 0.45, 0.85, 1],
}

/**
 * 把颜色描述转换为 RGBA 数组。
 * 未知颜色返回 undefined(由调用方决定是否使用默认色)。
 *
 * @param color 颜色描述(如 '蓝紫色' / '金黄' / '#ff8800')
 * @returns [r, g, b, a] 或 undefined
 */
export function mapColorToRgba(
  color: string,
): [number, number, number, number] | undefined {
  // 1. 颜色名直接查表
  if (COLOR_NAME_TO_RGBA[color]) {
    return COLOR_NAME_TO_RGBA[color]
  }

  // 2. 短形式(如 '蓝紫' → '蓝紫色')
  if (COLOR_NAME_TO_RGBA[`${color}色`]) {
    return COLOR_NAME_TO_RGBA[`${color}色`]
  }

  // 3. 十六进制 #rrggbb
  const hexMatch = color.match(/^#?([0-9a-fA-F]{6})$/)
  if (hexMatch) {
    const hex = hexMatch[1]
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      1,
    ]
  }

  return undefined
}

/**
 * 把 style 描述转换为参数字典。
 *
 * 输出字段(全部可选,只输出识别到的):
 * - color:       [r, g, b, a]  从 style.color 解析
 * - brightness:  number (0-1)  从 style.tone / lighting 推导
 * - contrast:    number (1-2)  从 style.tone 推导
 * - lighting:    string        原 lighting 描述(透传,供 effect 生成用)
 *
 * @param style CreativeStyle(可选)
 */
export function mapStyleToParams(
  style: CreativeStyle | undefined,
): Record<string, JsonLiteral> {
  if (!style) return {}

  const params: Record<string, JsonLiteral> = {}

  // 颜色
  if (style.color) {
    const rgba = mapColorToRgba(style.color)
    if (rgba) {
      params.color = rgba as unknown as JsonLiteral
    }
  }

  // 调性 → 亮度 / 对比度
  if (style.tone) {
    switch (style.tone) {
      case 'cinematic':
        params.brightness = 0.65
        params.contrast = 1.3
        break
      case 'anime':
        params.brightness = 0.85
        params.contrast = 1.15
        break
      case 'oil-painting':
        params.brightness = 0.72
        params.contrast = 1.25
        break
      case 'cyberpunk':
        params.brightness = 0.55
        params.contrast = 1.45
        break
      case 'minimal':
        params.brightness = 0.9
        params.contrast = 1.05
        break
      case 'realistic':
        params.brightness = 0.78
        params.contrast = 1.18
        break
      case 'dreamy':
        params.brightness = 0.88
        params.contrast = 1.0
        break
      default:
        // 未知 tone 不映射,留给 effect 生成阶段处理
        break
    }
  }

  // 光照(透传描述,供 effect 生成阶段决定是否加 blur / vignette / bloom)
  if (style.lighting) {
    params.lighting = style.lighting as unknown as JsonLiteral
  }

  return params
}

/**
 * 把 camera 描述转换为参数字典。
 *
 * 输出字段(全部可选):
 * - depth:        number (0-1)  原 camera.depth(景深)
 * - cameraAngle:  string        原 camera.angle(供 effect 阶段参考)
 * - cameraMovement: string      原 camera.movement(供 timeline 阶段参考)
 *
 * 注意:镜头运动本身不直接进 RenderIR(RenderIR 静态边界,不含时间字段),
 *       但可作为参数透传给 timeline store / player 用于动画驱动。
 */
export function mapCameraToParams(
  camera: CreativeCamera | undefined,
): Record<string, JsonLiteral> {
  if (!camera) return {}

  const params: Record<string, JsonLiteral> = {}

  if (camera.depth !== undefined) {
    params.depth = camera.depth as unknown as JsonLiteral
  }
  if (camera.angle) {
    params.cameraAngle = camera.angle as unknown as JsonLiteral
  }
  if (camera.movement) {
    params.cameraMovement = camera.movement as unknown as JsonLiteral
  }

  return params
}

/**
 * 把 motion 描述转换为参数字典。
 *
 * 输出字段(全部可选):
 * - speed:        number (0-1)  原 motion.speed
 * - direction:    string        原 motion.direction
 * - motionScale:  number        根据 speed 派生的缩放系数(0.5-2.0,用于 noise scale)
 *
 * motionScale 派生规则:
 *   speed < 0.3  → 0.5(慢镜头,纹理放大)
 *   speed > 0.7  → 2.0(快镜头,纹理细化)
 *   其它         → 1.0
 */
export function mapMotionToParams(
  motion: CreativeMotion | undefined,
): Record<string, JsonLiteral> {
  if (!motion) return {}

  const params: Record<string, JsonLiteral> = {}

  if (motion.speed !== undefined) {
    params.speed = motion.speed as unknown as JsonLiteral
    // 派生 motionScale:慢 → 放大纹理,快 → 细化纹理
    if (motion.speed < 0.3) {
      params.motionScale = 0.5
    } else if (motion.speed > 0.7) {
      params.motionScale = 2.0
    } else {
      params.motionScale = 1.0
    }
  }
  if (motion.direction) {
    params.direction = motion.direction as unknown as JsonLiteral
  }

  return params
}

/**
 * 汇总三个映射器的输出(planner 调用,简化调用链)。
 *
 * 合并优先级:style / camera / motion 各自输出独立字段,
 * 互不覆盖(除非参数名冲突,这种情况以 style 为准)。
 */
export function mapRequirementToParams(requirement: {
  style?: CreativeStyle
  camera?: CreativeCamera
  motion?: CreativeMotion
}): Record<string, JsonLiteral> {
  return {
    ...mapCameraToParams(requirement.camera),
    ...mapMotionToParams(requirement.motion),
    ...mapStyleToParams(requirement.style),  // style 最后合并,字段冲突时优先
  }
}
