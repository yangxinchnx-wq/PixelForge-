/**
 * 问题生成器(Step 23)— 把 MissingField[] 转换为 UI 友好的 ClarifyQuestion[]。
 *
 * MissingField 与 ClarifyQuestion 的区别:
 * - MissingField: 内部数据结构,含 key(字段路径) + type + question + options
 * - ClarifyQuestion: UI 渲染结构,含 id(=key) + title(=question) + type + options
 *
 * 两者字段几乎相同,但分开定义的原因:
 * - MissingField 未来可能增加 internalOnly / dependsOn 等内部字段
 * - ClarifyQuestion 未来可能增加 placeholder / hint / validation 等 UI 字段
 * - 保持 UI 层与逻辑层解耦
 *
 * 此外,本模块还提供:
 * - mergeAnswers: 把用户答案合并回 CreativeRequirement(生成最终需求)
 * - speedKeywordToValue: 把 '慢速'/'中速'/'快速' 转换为数值
 */

import type {
  ClarifyAnswer,
  ClarifyQuestion,
  CreativeRequirement,
  MissingField,
} from './types'

/**
 * 把 MissingField[] 转换为 ClarifyQuestion[]。
 *
 * 转换规则:
 * - key → id
 * - question → title
 * - type / options / defaultValue 直接透传
 */
export function generateQuestions(missing: MissingField[]): ClarifyQuestion[] {
  return missing.map((m) => ({
    id: m.key,
    title: m.question,
    type: m.type,
    options: m.options,
    defaultValue: m.defaultValue,
  }))
}

/** 速度关键词 → 数值(与 intentAnalyzer 的 MOTION_SPEED_KEYWORDS 保持一致) */
const SPEED_KEYWORD_VALUES: Record<string, number> = {
  '慢速': 0.2,
  '缓慢': 0.2,
  '中速': 0.5,
  '快速': 0.85,
  '高速': 0.95,
}

/**
 * 把速度关键词转换为数值。
 * - 若输入已是数字字符串(如 '0.5'),直接解析
 * - 若输入是关键词(如 '慢速'),查表
 * - 都失败时返回 undefined
 */
export function speedKeywordToValue(input: string | number): number | undefined {
  if (typeof input === 'number') return input
  // 数字字符串
  const num = Number(input)
  if (Number.isFinite(num)) return num
  // 关键词
  return SPEED_KEYWORD_VALUES[input]
}

/**
 * 把用户答案合并回 CreativeRequirement,生成最终需求。
 *
 * 支持的字段路径:
 * - 'style.color'   → requirement.style.color
 * - 'style.tone'    → requirement.style.tone
 * - 'style.lighting' → requirement.style.lighting
 * - 'camera.movement' → requirement.camera.movement
 * - 'camera.angle'    → requirement.camera.angle
 * - 'camera.depth'    → requirement.camera.depth
 * - 'motion.direction' → requirement.motion.direction
 * - 'motion.speed'    → requirement.motion.speed(自动转换关键词)
 *
 * 对于未识别的字段路径,记录到 warnings 数组(便于调试)。
 *
 * @returns { requirement: 完整需求, warnings: 警告列表 }
 */
export function mergeAnswers(
  requirement: CreativeRequirement,
  answers: ClarifyAnswer[],
): { requirement: CreativeRequirement; warnings: string[] } {
  // 深拷贝需求,避免修改原对象
  const result: CreativeRequirement = {
    subject: requirement.subject,
    elements: [...requirement.elements],
    style: requirement.style ? { ...requirement.style } : {},
    camera: requirement.camera ? { ...requirement.camera } : {},
    motion: requirement.motion ? { ...requirement.motion } : {},
  }

  const warnings: string[] = []

  for (const answer of answers) {
    const { id, value } = answer
    const [group, field] = id.split('.')

    if (!group || !field) {
      warnings.push(`答案 id 格式无效: ${id}`)
      continue
    }

    switch (group) {
      case 'style': {
        if (field === 'color' || field === 'tone' || field === 'lighting') {
          if (typeof value === 'string') {
            result.style = result.style ?? {}
            ;(result.style as Record<string, unknown>)[field] = value
          } else {
            warnings.push(`${id} 期望字符串,收到 ${typeof value}`)
          }
        } else {
          warnings.push(`未知 style 字段: ${field}`)
        }
        break
      }
      case 'camera': {
        if (field === 'movement' || field === 'angle') {
          if (typeof value === 'string') {
            result.camera = result.camera ?? {}
            ;(result.camera as Record<string, unknown>)[field] = value
          } else {
            warnings.push(`${id} 期望字符串,收到 ${typeof value}`)
          }
        } else if (field === 'depth') {
          const num = typeof value === 'number' ? value : Number(value)
          if (Number.isFinite(num)) {
            result.camera = result.camera ?? {}
            result.camera.depth = num
          } else {
            warnings.push(`${id} 期望数值,收到 ${value}`)
          }
        } else {
          warnings.push(`未知 camera 字段: ${field}`)
        }
        break
      }
      case 'motion': {
        if (field === 'direction') {
          if (typeof value === 'string') {
            result.motion = result.motion ?? {}
            result.motion.direction = value
          } else {
            warnings.push(`${id} 期望字符串,收到 ${typeof value}`)
          }
        } else if (field === 'speed') {
          const num = speedKeywordToValue(value)
          if (num !== undefined) {
            result.motion = result.motion ?? {}
            result.motion.speed = num
          } else {
            warnings.push(`${id} 无法解析速度值: ${value}`)
          }
        } else {
          warnings.push(`未知 motion 字段: ${field}`)
        }
        break
      }
      default:
        warnings.push(`未知字段组: ${group}`)
    }
  }

  // 清理空对象(保持序列化整洁)
  if (result.style && Object.keys(result.style).length === 0) {
    result.style = undefined
  }
  if (result.camera && Object.keys(result.camera).length === 0) {
    result.camera = undefined
  }
  if (result.motion && Object.keys(result.motion).length === 0) {
    result.motion = undefined
  }

  return { requirement: result, warnings }
}
