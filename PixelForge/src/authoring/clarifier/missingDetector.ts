/**
 * 缺失字段检测器(Step 23)。
 *
 * 输入 CreativeRequirement,检查哪些关键字段尚未识别,
 * 输出 MissingField[](每项含问题文本 + 选项 + 默认值)。
 *
 * 检测策略(按优先级):
 *   1. style.color   缺失 → 追问色调(必问,影响整体配色)
 *   2. style.tone    缺失 → 追问调性(必问,影响 shader 选择)
 *   3. camera.movement 缺失 → 追问镜头运动(影响 timeline 动画)
 *   4. camera.angle  缺失 → 追问视角(可选,有默认值)
 *   5. motion.speed  缺失 → 追问运动速度(可选,有默认值)
 *
 * 注意:
 * - subject 由 clarifier.ts 在更早阶段判定(空 → rejected,不会进入 detectMissing)
 * - elements 为空时,这里不追问(由 requirementGenerator 根据 subject 派生)
 * - 问题数量上限 5(避免 UI 过载)
 */

import type { CreativeRequirement, MissingField } from './types'

/** 单次最多追问的问题数(避免 UI 过载) */
const MAX_MISSING_FIELDS = 5

/**
 * 检测 CreativeRequirement 中缺失的字段。
 *
 * @param requirement 已解析的需求(可能不完整)
 * @returns MissingField[](空数组表示需求已完整,可走 auto_resolved 路径)
 */
export function detectMissing(requirement: CreativeRequirement): MissingField[] {
  const missing: MissingField[] = []

  // —— 1. style.color(必问) ——
  if (!requirement.style?.color) {
    missing.push({
      key: 'style.color',
      type: 'choice',
      question: '希望使用什么主色调?',
      options: ['蓝紫色', '金黄色', '红色', '黑白', '暖色', '冷色'],
      defaultValue: '蓝紫色',
    })
  }

  // —— 2. style.tone(必问) ——
  if (!requirement.style?.tone) {
    missing.push({
      key: 'style.tone',
      type: 'choice',
      question: '希望什么整体调性?',
      options: ['cinematic', 'anime', 'oil-painting', 'cyberpunk', 'minimal', 'dreamy'],
      defaultValue: 'cinematic',
    })
  }

  // —— 3. camera.movement(影响 timeline,必问) ——
  if (!requirement.camera?.movement) {
    missing.push({
      key: 'camera.movement',
      type: 'choice',
      question: '镜头运动方式?',
      options: ['缓慢推进', '旋转环绕', '固定镜头', '拉近', '拉远', '平移'],
      defaultValue: '缓慢推进',
    })
  }

  // —— 4. camera.angle(可选) ——
  if (!requirement.camera?.angle) {
    missing.push({
      key: 'camera.angle',
      type: 'choice',
      question: '视角?',
      options: ['平视', '俯视', '仰视'],
      defaultValue: '平视',
    })
  }

  // —— 5. motion.speed(可选) ——
  if (requirement.motion?.direction && requirement.motion.speed === undefined) {
    // 仅在已识别到方向但未识别到速度时追问
    missing.push({
      key: 'motion.speed',
      type: 'choice',
      question: '运动速度?',
      options: ['慢速', '中速', '快速'],
      defaultValue: '中速',
    })
  }

  // 限制最大问题数(优先保留排在前面的必问字段)
  return missing.slice(0, MAX_MISSING_FIELDS)
}

/**
 * 判断需求是否已完整(无缺失字段)。
 */
export function isRequirementComplete(requirement: CreativeRequirement): boolean {
  return detectMissing(requirement).length === 0
}
