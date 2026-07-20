/**
 * Clarifier 模块测试(Step 23)。
 *
 * 覆盖:
 *   - intentAnalyzer.ts: analyzeIntent / summarizeRequirement
 *   - missingDetector.ts: detectMissing / isRequirementComplete
 *   - questionGenerator.ts: generateQuestions / speedKeywordToValue / mergeAnswers
 *   - clarifier.ts: clarify / applyAnswers / skipWithDefaults
 */

import { describe, expect, it } from 'vitest'

import { analyzeIntent, summarizeRequirement } from './intentAnalyzer'
import { detectMissing, isRequirementComplete } from './missingDetector'
import { generateQuestions, mergeAnswers, speedKeywordToValue } from './questionGenerator'
import { applyAnswers, clarify, skipWithDefaults } from './clarifier'
import type { CreativeRequirement } from './types'

// ============================================================================
// intentAnalyzer.ts 测试
// ============================================================================

describe('intentAnalyzer.analyzeIntent', () => {
  it('I1 "宇宙" 关键词识别主题 + 派生元素', () => {
    const req = analyzeIntent('做一个宇宙')
    expect(req.subject).toBe('宇宙')
    expect(req.elements).toContain('星空')
    expect(req.elements).toContain('星云')
    expect(req.elements).toContain('银河')
  })

  it('I2 "电影感" 关键词识别 tone = cinematic', () => {
    const req = analyzeIntent('电影感宇宙')
    expect(req.style?.tone).toBe('cinematic')
  })

  it('I3 "蓝紫色" 关键词识别 color', () => {
    const req = analyzeIntent('蓝紫色宇宙')
    expect(req.style?.color).toBe('蓝紫色')
  })

  it('I4 "缓慢推进" 关键词识别 camera.movement', () => {
    const req = analyzeIntent('缓慢推进的宇宙')
    expect(req.camera?.movement).toBe('缓慢推进')
  })

  it('I5 "俯视" 关键词识别 camera.angle', () => {
    const req = analyzeIntent('俯视宇宙')
    expect(req.camera?.angle).toBe('俯视')
  })

  it('I6 "深景深" 关键词识别 camera.depth = 0.8', () => {
    const req = analyzeIntent('深景深宇宙')
    expect(req.camera?.depth).toBe(0.8)
  })

  it('I7 "浅景深" 关键词识别 camera.depth = 0.3', () => {
    const req = analyzeIntent('浅景深宇宙')
    expect(req.camera?.depth).toBe(0.3)
  })

  it('I8 "顺时针" 关键词识别 motion.direction', () => {
    const req = analyzeIntent('顺时针旋转宇宙')
    expect(req.motion?.direction).toBe('顺时针')
  })

  it('I9 "慢速" 关键词识别 motion.speed = 0.2', () => {
    const req = analyzeIntent('慢速宇宙')
    expect(req.motion?.speed).toBe(0.2)
  })

  it('I10 "森林" 主题派生 树木 / 雾气 / 光斑', () => {
    const req = analyzeIntent('一片森林')
    expect(req.subject).toBe('森林')
    expect(req.elements).toContain('树木')
    expect(req.elements).toContain('雾气')
    expect(req.elements).toContain('光斑')
  })

  it('I11 "海洋" 主题派生 海浪 / 泡沫', () => {
    const req = analyzeIntent('海洋场景')
    expect(req.subject).toBe('海洋')
    expect(req.elements).toContain('海浪')
    expect(req.elements).toContain('泡沫')
  })

  it('I12 "城市" 主题派生 建筑 / 灯光 / 街道', () => {
    const req = analyzeIntent('城市夜景')
    expect(req.subject).toBe('城市')
    expect(req.elements).toContain('建筑')
    expect(req.elements).toContain('灯光')
  })

  it('I13 未识别主题 → subject 为空', () => {
    const req = analyzeIntent('这是一个完全无法识别的描述')
    expect(req.subject).toBe('')
    expect(req.elements).toHaveLength(0)
  })

  it('I14 多关键词组合识别(电影感 + 蓝紫色 + 旋转)', () => {
    const req = analyzeIntent('电影感蓝紫色旋转宇宙')
    expect(req.subject).toBe('宇宙')
    expect(req.style?.tone).toBe('cinematic')
    expect(req.style?.color).toBe('蓝紫色')
    expect(req.camera?.movement).toBe('旋转环绕')
  })

  it('I15 英文关键词也命中(cinematic / slow)', () => {
    const req = analyzeIntent('cinematic slow cosmos')
    // "cosmos" 不在主题词表内,但 cinematic 应被识别
    expect(req.style?.tone).toBe('cinematic')
    expect(req.motion?.speed).toBe(0.2)
  })

  it('I16 额外元素关键词独立命中(粒子 / 光晕)', () => {
    const req = analyzeIntent('宇宙 粒子 光晕')
    expect(req.elements).toContain('粒子')
    expect(req.elements).toContain('光晕')
  })

  it('I17 无识别字段时 style/camera/motion 均为 undefined', () => {
    const req = analyzeIntent('宇宙')
    expect(req.style).toBeUndefined()
    expect(req.camera).toBeUndefined()
    expect(req.motion).toBeUndefined()
  })

  it('I18 "柔和" 光照关键词识别 lighting', () => {
    const req = analyzeIntent('柔和光线的森林')
    expect(req.style?.lighting).toBe('柔和')
  })

  it('I19 "动漫" tone 关键词识别', () => {
    const req = analyzeIntent('动漫风格宇宙')
    expect(req.style?.tone).toBe('anime')
  })

  it('I20 "赛博朋克" tone 关键词识别', () => {
    const req = analyzeIntent('赛博朋克城市')
    expect(req.style?.tone).toBe('cyberpunk')
    expect(req.subject).toBe('城市')
  })
})

describe('intentAnalyzer.summarizeRequirement', () => {
  it('S1 完整需求汇总', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: ['星空', '星云'],
      camera: { movement: '缓慢推进' },
      motion: { direction: '顺时针' },
    }
    const summary = summarizeRequirement(req)
    expect(summary).toContain('主题: 宇宙')
    expect(summary).toContain('调性: cinematic')
    expect(summary).toContain('色调: 蓝紫色')
    expect(summary).toContain('元素: 星空, 星云')
    expect(summary).toContain('镜头: 缓慢推进')
    expect(summary).toContain('方向: 顺时针')
  })

  it('S2 空需求汇总为"未识别到任何创作意图"', () => {
    const summary = summarizeRequirement({ subject: '', elements: [] })
    expect(summary).toBe('(未识别到任何创作意图)')
  })

  it('S3 仅主题的需求汇总', () => {
    const summary = summarizeRequirement({ subject: '宇宙', elements: ['星空'] })
    expect(summary).toContain('主题: 宇宙')
    expect(summary).toContain('元素: 星空')
    expect(summary).not.toContain('调性')
  })
})

// ============================================================================
// missingDetector.ts 测试
// ============================================================================

describe('missingDetector.detectMissing', () => {
  it('M1 完整需求 → 无缺失', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: ['星空'],
      camera: { movement: '缓慢推进', angle: '平视' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(0)
  })

  it('M2 缺 style.color → 追问', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic' },
      elements: [],
      camera: { movement: '缓慢推进', angle: '平视' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe('style.color')
    expect(missing[0].options).toContain('蓝紫色')
  })

  it('M3 缺 style.tone → 追问', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { color: '蓝紫色' },
      elements: [],
      camera: { movement: '缓慢推进', angle: '平视' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe('style.tone')
  })

  it('M4 缺 camera.movement → 追问', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: [],
      camera: { angle: '平视' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe('camera.movement')
  })

  it('M5 缺 camera.angle → 追问', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: [],
      camera: { movement: '缓慢推进' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe('camera.angle')
  })

  it('M6 缺 motion.speed(已有 direction)→ 追问', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: [],
      camera: { movement: '缓慢推进', angle: '平视' },
      motion: { direction: '顺时针' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(1)
    expect(missing[0].key).toBe('motion.speed')
  })

  it('M7 motion.direction 缺失时不追问 speed', () => {
    // 没有方向就不问速度
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: [],
      camera: { movement: '缓慢推进', angle: '平视' },
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(0)
  })

  it('M8 完全空需求 → 4 个缺失字段', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      elements: [],
    }
    const missing = detectMissing(req)
    expect(missing).toHaveLength(4)
    expect(missing.map((m) => m.key)).toEqual([
      'style.color',
      'style.tone',
      'camera.movement',
      'camera.angle',
    ])
  })

  it('M9 每个缺失字段都含 question + options + defaultValue', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const missing = detectMissing(req)
    for (const m of missing) {
      expect(m.question).toBeTruthy()
      expect(m.options).toBeDefined()
      expect(m.options!.length).toBeGreaterThan(0)
      expect(m.defaultValue).toBeDefined()
    }
  })
})

describe('missingDetector.isRequirementComplete', () => {
  it('M10 完整需求 → true', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      style: { tone: 'cinematic', color: '蓝紫色' },
      elements: [],
      camera: { movement: '缓慢推进', angle: '平视' },
    }
    expect(isRequirementComplete(req)).toBe(true)
  })

  it('M11 不完整需求 → false', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    expect(isRequirementComplete(req)).toBe(false)
  })
})

// ============================================================================
// questionGenerator.ts 测试
// ============================================================================

describe('questionGenerator.generateQuestions', () => {
  it('Q1 MissingField[] 转换为 ClarifyQuestion[]', () => {
    const missing = detectMissing({ subject: '宇宙', elements: [] })
    const questions = generateQuestions(missing)
    expect(questions).toHaveLength(missing.length)
    for (let i = 0; i < questions.length; i += 1) {
      expect(questions[i].id).toBe(missing[i].key)
      expect(questions[i].title).toBe(missing[i].question)
      expect(questions[i].type).toBe(missing[i].type)
      expect(questions[i].options).toEqual(missing[i].options)
      expect(questions[i].defaultValue).toEqual(missing[i].defaultValue)
    }
  })

  it('Q2 空数组输入返回空数组', () => {
    expect(generateQuestions([])).toEqual([])
  })
})

describe('questionGenerator.speedKeywordToValue', () => {
  it('Q3 "慢速" → 0.2', () => {
    expect(speedKeywordToValue('慢速')).toBe(0.2)
  })

  it('Q4 "中速" → 0.5', () => {
    expect(speedKeywordToValue('中速')).toBe(0.5)
  })

  it('Q5 "快速" → 0.85', () => {
    expect(speedKeywordToValue('快速')).toBe(0.85)
  })

  it('Q6 数字字符串 "0.7" → 0.7', () => {
    expect(speedKeywordToValue('0.7')).toBe(0.7)
  })

  it('Q7 数字 0.9 → 0.9', () => {
    expect(speedKeywordToValue(0.9)).toBe(0.9)
  })

  it('Q8 无法识别的关键词 → undefined', () => {
    expect(speedKeywordToValue('超光速')).toBeUndefined()
  })
})

describe('questionGenerator.mergeAnswers', () => {
  it('Q9 合并 style.color 答案', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { requirement, warnings } = mergeAnswers(req, [
      { id: 'style.color', value: '金黄色' },
    ])
    expect(requirement.style?.color).toBe('金黄色')
    expect(warnings).toHaveLength(0)
  })

  it('Q10 合并 camera.movement 答案', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { requirement } = mergeAnswers(req, [
      { id: 'camera.movement', value: '旋转环绕' },
    ])
    expect(requirement.camera?.movement).toBe('旋转环绕')
  })

  it('Q11 合并 motion.speed 答案(关键词转换)', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      elements: [],
      motion: { direction: '顺时针' },
    }
    const { requirement } = mergeAnswers(req, [
      { id: 'motion.speed', value: '快速' },
    ])
    expect(requirement.motion?.speed).toBe(0.85)
  })

  it('Q12 合并 motion.speed 答案(数字字符串)', () => {
    const req: CreativeRequirement = {
      subject: '宇宙',
      elements: [],
      motion: { direction: '顺时针' },
    }
    const { requirement } = mergeAnswers(req, [
      { id: 'motion.speed', value: '0.65' },
    ])
    expect(requirement.motion?.speed).toBe(0.65)
  })

  it('Q13 合并 camera.depth 答案(数值)', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { requirement } = mergeAnswers(req, [
      { id: 'camera.depth', value: 0.7 },
    ])
    expect(requirement.camera?.depth).toBe(0.7)
  })

  it('Q14 未知字段组产生 warning', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { warnings } = mergeAnswers(req, [
      { id: 'unknown.field', value: 'x' },
    ])
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toMatch(/未知字段组/)
  })

  it('Q15 答案 id 格式无效(无点)产生 warning', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { warnings } = mergeAnswers(req, [
      { id: 'invalid', value: 'x' },
    ])
    expect(warnings[0]).toMatch(/格式无效/)
  })

  it('Q16 类型不匹配(style.color 收到 number)产生 warning', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { warnings } = mergeAnswers(req, [
      { id: 'style.color', value: 123 },
    ])
    expect(warnings[0]).toMatch(/期望字符串/)
  })

  it('Q17 合并后不修改原对象(深拷贝)', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { requirement } = mergeAnswers(req, [
      { id: 'style.color', value: '红色' },
    ])
    expect(req.style).toBeUndefined()
    expect(requirement.style?.color).toBe('红色')
  })

  it('Q18 合并后空 style 对象被清理为 undefined', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { requirement } = mergeAnswers(req, [])
    expect(requirement.style).toBeUndefined()
  })

  it('Q19 多答案合并', () => {
    const req: CreativeRequirement = { subject: '宇宙', elements: [] }
    const { requirement } = mergeAnswers(req, [
      { id: 'style.color', value: '蓝紫色' },
      { id: 'style.tone', value: 'cinematic' },
      { id: 'camera.movement', value: '缓慢推进' },
      { id: 'camera.angle', value: '平视' },
    ])
    expect(requirement.style?.color).toBe('蓝紫色')
    expect(requirement.style?.tone).toBe('cinematic')
    expect(requirement.camera?.movement).toBe('缓慢推进')
    expect(requirement.camera?.angle).toBe('平视')
  })
})

// ============================================================================
// clarifier.ts 测试
// ============================================================================

describe('clarifier.clarify', () => {
  it('C1 空输入 → rejected', async () => {
    const result = await clarify('')
    expect(result.status).toBe('rejected')
    expect(result.reason).toMatch(/prompt 为空/)
  })

  it('C2 仅空白字符 → rejected', async () => {
    const result = await clarify('   \n\t  ')
    expect(result.status).toBe('rejected')
  })

  it('C3 无法识别主题 → rejected', async () => {
    const result = await clarify('这是一个完全无法识别的描述 xyz123')
    expect(result.status).toBe('rejected')
    expect(result.reason).toMatch(/无法识别创作主题/)
  })

  it('C4 "电影感宇宙" → needs_clarify(缺 color/movement/angle)', async () => {
    const result = await clarify('电影感宇宙')
    expect(result.status).toBe('needs_clarify')
    expect(result.requirement.subject).toBe('宇宙')
    expect(result.requirement.style?.tone).toBe('cinematic')
    expect(result.questions.length).toBeGreaterThan(0)
    // 应该追问 color(因为没识别到)
    expect(result.questions.some((q) => q.id === 'style.color')).toBe(true)
    // tone 已识别,不应追问
    expect(result.questions.some((q) => q.id === 'style.tone')).toBe(false)
  })

  it('C5 已识别字段出现在 warnings 中', async () => {
    const result = await clarify('电影感宇宙')
    expect(result.warnings).toBeDefined()
    expect(result.warnings!.some((w) => w.includes('已识别'))).toBe(true)
  })

  it('C6 完整描述 → auto_resolved(无缺失)', async () => {
    const result = await clarify('电影感蓝紫色宇宙,缓慢推进,平视')
    expect(result.status).toBe('auto_resolved')
    expect(result.requirement.subject).toBe('宇宙')
    expect(result.requirement.style?.tone).toBe('cinematic')
    expect(result.requirement.style?.color).toBe('蓝紫色')
    expect(result.requirement.camera?.movement).toBe('缓慢推进')
    expect(result.requirement.camera?.angle).toBe('平视')
    expect(result.questions).toHaveLength(0)
  })

  it('C7 questions 含 id/title/type/options/defaultValue', async () => {
    const result = await clarify('宇宙')
    for (const q of result.questions) {
      expect(q.id).toBeTruthy()
      expect(q.title).toBeTruthy()
      expect(q.type).toBe('choice')
      expect(q.options).toBeDefined()
      expect(q.options!.length).toBeGreaterThan(0)
      expect(q.defaultValue).toBeDefined()
    }
  })
})

describe('clarifier.applyAnswers', () => {
  it('C8 完整答案 → auto_resolved', async () => {
    const initial = await clarify('电影感宇宙')
    expect(initial.status).toBe('needs_clarify')

    // 用户作答所有缺失字段
    const answers = initial.questions.map((q) => ({
      id: q.id,
      value: q.defaultValue as string | number,
    }))
    const result = await applyAnswers(initial.requirement, answers)
    expect(result.status).toBe('auto_resolved')
    expect(result.questions).toHaveLength(0)
  })

  it('C9 部分答案 → 仍 needs_clarify', async () => {
    const initial = await clarify('宇宙')
    expect(initial.questions.length).toBeGreaterThan(1)

    // 只答一个问题
    const partial = [initial.questions[0]].map((q) => ({
      id: q.id,
      value: q.defaultValue as string | number,
    }))
    const result = await applyAnswers(initial.requirement, partial)
    expect(result.status).toBe('needs_clarify')
    expect(result.questions.length).toBeGreaterThan(0)
  })

  it('C10 合并后保留原识别字段', async () => {
    const initial = await clarify('电影感宇宙')
    const answers = initial.questions.map((q) => ({
      id: q.id,
      value: q.defaultValue as string | number,
    }))
    const result = await applyAnswers(initial.requirement, answers)
    expect(result.requirement.subject).toBe('宇宙')
    expect(result.requirement.style?.tone).toBe('cinematic') // 原识别字段保留
  })
})

describe('clarifier.skipWithDefaults', () => {
  it('C11 跳过追问 → 使用默认值补全 → auto_resolved', async () => {
    const initial = await clarify('宇宙')
    expect(initial.status).toBe('needs_clarify')

    const result = await skipWithDefaults(initial.requirement)
    expect(result.status).toBe('auto_resolved')
    expect(result.requirement.style?.color).toBe('蓝紫色') // 默认色
    expect(result.requirement.style?.tone).toBe('cinematic') // 默认调性
    expect(result.requirement.camera?.movement).toBe('缓慢推进') // 默认运动
    expect(result.requirement.camera?.angle).toBe('平视') // 默认视角
  })

  it('C12 跳过追问后 motion.speed 不被填充(因 direction 未识别)', async () => {
    const initial = await clarify('宇宙')
    const result = await skipWithDefaults(initial.requirement)
    // direction 未识别,detectMissing 不会追问 speed,所以 motion.speed 仍为 undefined
    expect(result.requirement.motion).toBeUndefined()
  })
})

describe('clarifier 完整流程', () => {
  it('C13 prompt → clarify → 作答 → auto_resolved → requirement 完整', async () => {
    // Step 1: clarify
    const initial = await clarify('电影感蓝紫色宇宙')
    // 已识别 tone + color,但缺 camera.movement + camera.angle
    expect(initial.status).toBe('needs_clarify')
    expect(initial.requirement.style?.tone).toBe('cinematic')
    expect(initial.requirement.style?.color).toBe('蓝紫色')

    // Step 2: 用户作答
    const answers = initial.questions.map((q) => ({
      id: q.id,
      value: q.defaultValue as string | number,
    }))
    const final = await applyAnswers(initial.requirement, answers)

    // Step 3: 验证完整需求
    expect(final.status).toBe('auto_resolved')
    expect(final.requirement.subject).toBe('宇宙')
    expect(final.requirement.style?.tone).toBe('cinematic')
    expect(final.requirement.style?.color).toBe('蓝紫色')
    expect(final.requirement.camera?.movement).toBe('缓慢推进')
    expect(final.requirement.camera?.angle).toBe('平视')
  })

  it('C14 skipWithDefaults 后再次 clarify 应仍是 auto_resolved', async () => {
    // 这是逆向验证:把默认值填回去后,新 prompt(把已识别字段拼成文本)应 auto_resolved
    const initial = await clarify('电影感蓝紫色宇宙')
    const filled = await skipWithDefaults(initial.requirement)
    expect(filled.status).toBe('auto_resolved')
    // 检测是否真的完整
    expect(isRequirementComplete(filled.requirement)).toBe(true)
  })
})
