/**
 * 创作需求澄清主入口(Step 23)。
 *
 * 与 src/authoring/clarify/requirementClarifier.ts 的职责区分:
 * - clarify/requirementClarifier:  处理结构化 prompt("纯色：红色\n渐变：从红到蓝")
 *                                  → ParsedIntent → RenderIR
 * - clarifier/clarifier:           处理自由文本 prompt("做一个电影感宇宙")
 *                                  → CreativeRequirement → (Step 24)RenderIR Generator
 *
 * 三态输出(与 clarify/ 一致,便于 UI 复用):
 *   - 'auto_resolved':  意图完整,无缺失字段,可直接生成 RenderIR
 *   - 'needs_clarify':  存在缺失字段,需用户作答(返回 questions)
 *   - 'rejected':       意图不合法(如 subject 为空)
 *
 * 数据流:
 *   prompt
 *     → analyzeIntent(prompt)              [提取 subject / style / elements / camera / motion]
 *     → if subject 空: return rejected
 *     → detectMissing(requirement)          [检查缺失字段]
 *     → if missing.length > 0:
 *         return needs_clarify + questions
 *     → else:
 *         return auto_resolved + requirement
 *
 * 用户作答后:
 *   answers
 *     → mergeAnswers(requirement, answers)  [合并答案]
 *     → 再次 detectMissing → 应为空(完整)
 *     → auto_resolved(供 Step 24 RenderIR Generator 使用)
 */

import { analyzeIntent, summarizeRequirement } from './intentAnalyzer'
import { detectMissing } from './missingDetector'
import { generateQuestions, mergeAnswers } from './questionGenerator'
import type {
  ClarifyAnswer,
  ClarifierResult,
  CreativeRequirement,
} from './types'

/**
 * Clarify 主入口(异步,与 clarify/requirementClarifier 接口一致)。
 *
 * @param prompt 用户输入的自由文本
 * @returns ClarifierResult(三态)
 */
export async function clarify(prompt: string): Promise<ClarifierResult> {
  // —— 1. 空输入 → rejected ——
  if (!prompt || prompt.trim().length === 0) {
    return {
      status: 'rejected',
      requirement: { subject: '', elements: [] },
      questions: [],
      reason: 'prompt 为空',
    }
  }

  // —— 2. 意图分析 ——
  const requirement = analyzeIntent(prompt)

  // —— 3. subject 为空 → rejected ——
  if (!requirement.subject) {
    return {
      status: 'rejected',
      requirement,
      questions: [],
      reason: `无法识别创作主题。支持的主题:宇宙 / 森林 / 海洋 / 城市 / 人物 / 抽象 / 山水`,
    }
  }

  // —— 4. 缺失字段检测 ——
  const missing = detectMissing(requirement)

  if (missing.length > 0) {
    const questions = generateQuestions(missing)
    const warnings: string[] = []
    // 若已识别到部分字段,加入 warning(告知用户哪些被自动识别)
    const summary = summarizeRequirement(requirement)
    if (summary && summary !== '(未识别到任何创作意图)') {
      warnings.push(`已识别: ${summary}`)
    }
    return {
      status: 'needs_clarify',
      requirement,
      questions,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  // —— 5. 完整需求 → auto_resolved ——
  return {
    status: 'auto_resolved',
    requirement,
    questions: [],
  }
}

/**
 * 把用户答案合并回需求,生成最终完整需求。
 *
 * 流程:
 *   1. mergeAnswers(requirement, answers) → 合并答案
 *   2. 再次 detectMissing → 检查是否还有缺失
 *   3. 若仍有缺失 → 返回 needs_clarify(理论上不应发生,除非用户跳过)
 *   4. 若完整 → 返回 auto_resolved
 *
 * @param requirement 原始需求(来自 clarify 的初次返回)
 * @param answers 用户作答列表
 */
export async function applyAnswers(
  requirement: CreativeRequirement,
  answers: ClarifyAnswer[],
): Promise<ClarifierResult> {
  const { requirement: merged, warnings } = mergeAnswers(requirement, answers)

  // 再次检测缺失字段
  const stillMissing = detectMissing(merged)

  if (stillMissing.length > 0) {
    const questions = generateQuestions(stillMissing)
    return {
      status: 'needs_clarify',
      requirement: merged,
      questions,
      warnings: warnings.length > 0 ? warnings : undefined,
    }
  }

  return {
    status: 'auto_resolved',
    requirement: merged,
    questions: [],
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * 跳过追问,使用默认值补全需求(用户选择"使用默认值"时调用)。
 *
 * 策略:
 *   - 把每个 MissingField 的 defaultValue 作为答案,调用 applyAnswers
 */
export async function skipWithDefaults(
  requirement: CreativeRequirement,
): Promise<ClarifierResult> {
  const missing = detectMissing(requirement)
  const defaultAnswers: ClarifyAnswer[] = missing
    .filter((m) => m.defaultValue !== undefined)
    .map((m) => ({
      id: m.key,
      value: m.defaultValue as string | number,
    }))
  return applyAnswers(requirement, defaultAnswers)
}
