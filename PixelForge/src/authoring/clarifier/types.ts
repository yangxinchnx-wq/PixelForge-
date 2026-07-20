/**
 * 创作需求澄清模块类型定义(Step 23)。
 *
 * 与已有 src/authoring/clarify/requirementClarifier.ts 的区别:
 * - clarify/:  处理"结构化" prompt("纯色：红色\n渐变：从红到蓝")
 *              → 直接解析为 ParsedIntent → RenderIR
 * - clarifier/:处理"自由文本" prompt("做一个电影感宇宙")
 *              → 意图分析 → 缺失检测 → 自动追问 → CreativeRequirement
 *
 * 数据流:
 *   prompt
 *     → analyzeIntent(prompt)            [关键词提取 subject / style / elements]
 *     → detectMissing(requirement)       [检查哪些字段需要补充]
 *     → generateQuestions(missing)        [生成 UI 问题 + 选项]
 *     → 用户作答
 *     → mergeAnswers(requirement, answers) [合并答案生成最终需求]
 *     → CreativeRequirement
 *     → (Step 24)RenderIR Generator → Layer[]
 */

/**
 * 创作风格描述。
 * - tone: 整体调性(如 'cinematic' / 'anime' / 'oil-painting')
 * - color: 主色调(如 '蓝紫色' / '金黄色' / '黑白')
 * - lighting: 光照风格(如 '柔和' / '高对比' / '逆光')
 */
export interface CreativeStyle {
  tone?: string
  color?: string
  lighting?: string
}

/**
 * 镜头/视角描述。
 * - movement: 镜头运动(如 '缓慢推进' / '旋转环绕' / '固定')
 * - angle: 视角(如 '俯视' / '平视' / '仰视')
 * - depth: 景深(0-1,0 = 无景深,1 = 强景深)
 */
export interface CreativeCamera {
  movement?: string
  angle?: string
  depth?: number
}

/**
 * 运动/动态描述。
 * - speed: 速度(0-1,0 = 静止,1 = 高速)
 * - direction: 方向(如 '顺时针' / '逆时针' / '向上')
 */
export interface CreativeMotion {
  speed?: number
  direction?: string
}

/**
 * 创作需求规格(完整描述用户想要生成的画面)。
 *
 * 字段说明:
 * - subject: 主题(必填,如 '宇宙' / '森林' / '人物')
 * - style: 风格(可选,但通常需要)
 * - camera: 镜头(可选)
 * - motion: 运动(可选)
 * - elements: 构成元素列表(如 ['星空', '星云', '银河'])
 *
 * 缺失检测策略:
 * - subject 必填,缺失 → rejected
 * - style.color 缺失 → 追问
 * - camera.movement 缺失 → 追问(影响 timeline 动画)
 * - elements 为空 → 默认根据 subject 派生
 */
export interface CreativeRequirement {
  subject: string
  style?: CreativeStyle
  camera?: CreativeCamera
  motion?: CreativeMotion
  elements: string[]
}

/**
 * 缺失字段类型(决定 UI 问题样式)。
 * - 'choice': 单选(从 options 中选)
 * - 'number': 数值输入
 * - 'text':   自由文本输入
 */
export type MissingFieldType = 'choice' | 'number' | 'text'

/**
 * 缺失字段描述。
 *
 * - key: 字段路径(如 'style.color' / 'camera.movement'),用于 mergeAnswers 时定位
 * - type: 问题类型(choice/number/text)
 * - question: 展示给用户的问题
 * - options: 选项列表(type='choice' 时使用)
 * - defaultValue: 默认值(用户跳过时使用)
 */
export interface MissingField {
  key: string
  type: MissingFieldType
  question: string
  options?: string[]
  defaultValue?: string | number
}

/**
 * UI 问题(由 MissingField 转换而来,更适合渲染)。
 *
 * - id: 问题 ID(等于 MissingField.key)
 * - title: 问题标题
 * - type: 问题类型
 * - options: 选项(type='choice' 时)
 * - defaultValue: 默认值
 */
export interface ClarifyQuestion {
  id: string
  title: string
  type: MissingFieldType
  options?: string[]
  defaultValue?: string | number
}

/**
 * 用户对一个问题作答的答案。
 * - id: 问题 ID(对应 ClarifyQuestion.id)
 * - value: 用户选择的值(字符串或数值)
 */
export interface ClarifyAnswer {
  id: string
  value: string | number
}

/**
 * Clarifier 主入口返回结果。
 *
 * 三态:
 * - 'auto_resolved':  意图清晰,无缺失字段,可直接生成 RenderIR
 * - 'needs_clarify':  存在缺失字段,需用户作答
 * - 'rejected':       意图不合法(如 subject 为空),拒绝执行
 */
export type ClarifierStatus =
  | 'auto_resolved'
  | 'needs_clarify'
  | 'rejected'

export interface ClarifierResult {
  status: ClarifierStatus
  /** 解析出的需求(可能不完整,需用户补全) */
  requirement: CreativeRequirement
  /** 需要用户回答的问题(status='needs_clarify' 时非空) */
  questions: ClarifyQuestion[]
  /** 拒绝原因(status='rejected' 时非空) */
  reason?: string
  /** 警告(不影响主流程) */
  warnings?: string[]
}
