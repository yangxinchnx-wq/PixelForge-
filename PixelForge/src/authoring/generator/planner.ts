/**
 * 场景规划器(Step 24.5)。
 *
 * 职责:把 CreativeRequirement 转换为 ScenePlan。
 *
 * 流程:
 *   requirement
 *     → getTemplatesForSubject(requirement.subject)  [主题 → 模板 key 列表]
 *     → 每个模板 instantiateTemplate(key, params)     [合并默认参数 + 风格参数]
 *     → 按 role 排序(background → main → foreground → overlay)
 *     → 输出 ScenePlan { layers, global }
 *
 * 参数合并策略(由 parameterMapper 提供):
 *   模板默认参数 < 风格参数(style.color / tone / lighting)
 *   - 颜色参数(colorA / fill)会被 style.color 覆盖
 *   - 亮度 / 对比度(brightness / contrast)会被 style.tone 派生
 *   - 镜头 / 运动参数会被透传到 params,但 RenderIR Generator 会忽略非 opcode 参数
 *
 * 元素扩展(requirement.elements):
 *   若 elements 包含主题之外的元素(如 '流星' / '光晕'),
 *   会追加对应模板到 layers(目前仅识别 '粒子' / '光晕')。
 */

import type { CreativeRequirement } from '@/authoring/clarifier/types'
import type { JsonLiteral } from '@/shared/types'
import type { LayerRole, SceneLayer, ScenePlan } from './types'
import {
  getTemplate,
  getTemplatesForSubject,
  instantiateTemplate,
  type LayerTemplateKey,
} from './layerTemplates'
import { mapRequirementToParams } from './parameterMapper'

/** role 排序权重(数字越小越靠前) */
const ROLE_ORDER: Record<LayerRole, number> = {
  background: 0,
  main: 1,
  foreground: 2,
  overlay: 3,
}

/**
 * 元素关键词 → 模板 key 的扩展映射。
 *
 * 用于在主题模板之外,根据 requirement.elements 追加额外图层。
 * 例如 '宇宙' 主题默认生成 NEBULA + STAR_FIELD + GALAXY + PARTICLE,
 *      若 elements 还包含 '光晕',则追加 ORB 作为 overlay。
 */
const ELEMENT_TO_TEMPLATE: Record<string, LayerTemplateKey> = {
  '粒子': 'PARTICLE',
  '光晕': 'ORB',
  '光球': 'ORB',
  '球': 'ORB',
}

/**
 * 创建场景规划。
 *
 * @param requirement 已澄清的完整需求(必须含 subject)
 * @returns ScenePlan(layers 已按 role 排序,global 含 duration / fps)
 */
export function createScenePlan(
  requirement: CreativeRequirement,
): ScenePlan {
  // —— 1. 主题 → 模板 key 列表 ——
  const templateKeys = getTemplatesForSubject(requirement.subject)

  // —— 2. 风格 / 镜头 / 运动 → 参数字典 ——
  const styleParams = mapRequirementToParams(requirement)

  // —— 3. 实例化每个模板(合并默认参数 + 风格参数) ——
  const layers: SceneLayer[] = templateKeys.map((key) => {
    const tpl = getTemplate(key)
    // 针对性参数覆盖:颜色类参数根据 opcode 不同字段名不同
    const targetedParams = applyColorToTemplate(tpl.opcodeName, styleParams)
    return instantiateTemplate(key, targetedParams)
  })

  // —— 4. 根据 elements 追加额外图层(去重) ——
  const existingNames = new Set(layers.map((l) => l.name))
  for (const element of requirement.elements) {
    const tplKey = ELEMENT_TO_TEMPLATE[element]
    if (!tplKey) continue
    const tpl = getTemplate(tplKey)
    if (existingNames.has(tpl.label)) continue  // 已存在同名,跳过
    const targetedParams = applyColorToTemplate(tpl.opcodeName, styleParams)
    layers.push(instantiateTemplate(tplKey, targetedParams))
    existingNames.add(tpl.label)
  }

  // —— 5. 按 role 排序(background → main → foreground → overlay) ——
  layers.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])

  // —— 6. 全局参数 ——
  return {
    layers,
    global: {
      duration: 10,
      fps: 60,
    },
  }
}

/**
 * 把颜色参数按 opcode 类型分发到对应字段名。
 *
 * 不同 opcode 颜色字段名不同:
 *   SOLID_COLOR:    color
 *   LINEAR_GRADIENT: colorA / colorB(双色,style.color 覆盖 colorA)
 *   NOISE:           colorA / colorB(双色)
 *   CIRCLE_SHAPE:    fill
 *
 * 其他参数(brightness / contrast / motionScale)直接透传,
 * 由 RenderIR Generator 决定是否纳入最终 params(未知字段会被丢弃,不影响渲染)。
 */
function applyColorToTemplate(
  opcodeName: string,
  baseParams: Record<string, JsonLiteral>,
): Record<string, JsonLiteral> {
  const result: Record<string, JsonLiteral> = { ...baseParams }
  const color = baseParams.color

  if (Array.isArray(color)) {
    switch (opcodeName) {
      case 'SOLID_COLOR':
        result.color = color
        break
      case 'LINEAR_GRADIENT':
        // style.color 覆盖 colorA,colorB 保留模板默认(形成主色 + 高光双色)
        result.colorA = color
        break
      case 'NOISE':
        // style.color 覆盖 colorA(主色),colorB 保留模板默认(高光色)
        result.colorA = color
        break
      case 'CIRCLE_SHAPE':
        result.fill = color
        break
      // IMAGE_TEXTURE 不接受颜色参数
    }
  }

  return result
}

/**
 * 计算 ScenePlan 的可读摘要(用于 UI 反馈 / 调试)。
 */
export function summarizeScenePlan(plan: ScenePlan): string {
  if (plan.layers.length === 0) return '(空场景)'
  const parts = plan.layers.map(
    (l) => `${l.name}(${l.opcodeName}/${l.role})`,
  )
  return `${parts.join(' + ')} | ${plan.global.duration}s @ ${plan.global.fps}fps`
}
