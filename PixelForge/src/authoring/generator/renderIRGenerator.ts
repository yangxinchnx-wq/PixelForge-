/**
 * RenderIR 生成器主入口(Step 24.6)。
 *
 * 数据流:
 *   CreativeRequirement
 *     → createScenePlan(requirement)            [planner: 挑选模板 + 合并参数]
 *     → ScenePlan
 *     → generateRenderIR(plan / requirement)    [转 Layer[] + Region + Effect]
 *     → RenderIR
 *     → runtimeStore.setRenderIR(ir)            [GPU 重渲染]
 *
 * 转换职责:
 * - SceneLayer → Layer:补齐 id / source / paramOwnership / visible / blendMode
 * - 默认创建覆盖全画布的 Region(引用所有 Layer)
 * - 根据 style.tone / lighting 自动生成 Effect(cinematic → vignette, 高对比 → color_shift 等)
 * - 非法 opcodeName 抛错(避免运行时静默失败)
 *
 * 与 prompt/ruleParser.ts 的区别:
 * - ruleParser:  prompt → Layer[](追加式,只生成 layers,不创建 region / effect)
 * - generator:   requirement → 完整 RenderIR(替换式,含 layers / regions / effects)
 *
 * 稳定 ID 策略:
 * - source = 'llm_parser'(语义上属于 AI 生成,即使是规则驱动的)
 * - contentKey = `${index}_${opcodeName}_${name}_${JSON.stringify(params)}`
 * - 同一 requirement 多次生成得到相同 ID(便于 patch / 缓存)
 */

import type { CreativeRequirement } from '@/authoring/clarifier/types'
import type {
  Effect,
  Layer,
  Region,
  RenderIR,
} from '@/compiler/ir/renderIR'
import type {
  BlendMode,
  JsonLiteral,
  Opcode,
  ParameterOwner,
  SourceKind,
} from '@/shared/types'
import { Opcode as OpcodeEnum } from '@/shared/types'
import {
  stableEffectId,
  stableLayerId,
  stableRegionId,
} from '@/shared/ids'
import { createScenePlan } from './planner'
import type { GeneratorOptions, SceneLayer } from './types'
import { SUPPORTED_OPCODE_NAMES } from './types'

/**
 * opcodeName → Opcode enum 映射。
 *
 * 不在 SUPPORTED_OPCODE_NAMES 中的名称会抛错。
 */
const OPCODE_NAME_TO_VALUE: Record<string, Opcode> = {
  SOLID_COLOR: OpcodeEnum.SOLID_COLOR,
  LINEAR_GRADIENT: OpcodeEnum.LINEAR_GRADIENT,
  NOISE: OpcodeEnum.NOISE,
  CIRCLE_SHAPE: OpcodeEnum.CIRCLE_SHAPE,
  IMAGE_TEXTURE: OpcodeEnum.IMAGE_TEXTURE,
}

/**
 * 把 SceneLayer 转换为完整 Layer(含稳定 ID / source / paramOwnership)。
 *
 * @param planLayer ScenePlan 中的图层
 * @param index     在 plan.layers 中的索引(用于 contentKey 区分)
 * @returns 符合 RenderIR 规范的 Layer
 */
export function generateLayer(planLayer: SceneLayer, index: number): Layer {
  // 校验 opcodeName
  if (!SUPPORTED_OPCODE_NAMES.includes(planLayer.opcodeName as typeof SUPPORTED_OPCODE_NAMES[number])) {
    throw new Error(
      `不支持的 opcode 名: ${planLayer.opcodeName}。受支持: ${SUPPORTED_OPCODE_NAMES.join(', ')}`,
    )
  }

  const opcode = OPCODE_NAME_TO_VALUE[planLayer.opcodeName]
  if (opcode === undefined) {
    throw new Error(`opcodeName 映射失败: ${planLayer.opcodeName}`)
  }

  // 稳定 ID:相同输入产生相同 ID,便于 patch / 缓存命中
  const contentKey = `${index}_${planLayer.opcodeName}_${planLayer.name}_${JSON.stringify(planLayer.params)}`
  const id = stableLayerId('llm_parser', contentKey)

  // 所有参数的归属都标记为 'l2_parser'(AI 规划器)
  const paramOwnership: Record<string, ParameterOwner> = {}
  for (const key of Object.keys(planLayer.params)) {
    paramOwnership[key] = 'l2_parser'
  }

  return {
    id,
    opcode,
    params: planLayer.params,
    source: 'llm_parser' as SourceKind,
    paramOwnership,
    visible: true,
    blendMode: 'normal' as BlendMode,
  }
}

/**
 * 生成覆盖全画布的默认 Region(引用所有 Layer)。
 *
 * @param layers 已生成的 Layer 列表
 * @returns 单个 Region(bounds = {0,0,1,1},layerRefs = 所有 layer.id)
 */
export function generateDefaultRegion(layers: Layer[]): Region {
  const layerRefs = layers.map((l) => l.id)
  const contentKey = `default_${layerRefs.length}_${layerRefs.join(',')}`
  return {
    id: stableRegionId('llm_parser', contentKey),
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    layerRefs,
    source: 'llm_parser',
  }
}

/**
 * 根据 style / lighting 自动生成 Effect 列表。
 *
 * 策略:
 *   - tone === 'cinematic'    → 追加 vignette(晕影,强度 0.5)
 *   - lighting === '高对比'    → 追加 color_shift(色彩偏移,强度 0.3)
 *   - lighting === '柔和'      → 追加 blur(模糊,半径 0.003)
 *   - tone === 'dreamy'       → 追加 bloom(泛光,强度 0.4)
 *
 * Effect 的 targetLayer 指向 layers[0](主背景层),
 * targetRegion 指向默认 region(影响整个画布)。
 */
export function generateEffects(
  requirement: CreativeRequirement,
  layers: Layer[],
  regionId: string,
): Effect[] {
  const effects: Effect[] = []
  const targetLayer = layers[0]?.id
  if (!targetLayer) return effects

  const tone = requirement.style?.tone
  const lighting = requirement.style?.lighting

  const makeEffect = (
    type: string,
    params: Record<string, JsonLiteral>,
    index: number,
  ): Effect => ({
    id: stableEffectId('llm_parser', `${index}_${type}_${JSON.stringify(params)}`),
    type,
    params,
    targetLayer,
    targetRegion: regionId,
  })

  let index = 0

  // cinematic → vignette
  if (tone === 'cinematic') {
    effects.push(
      makeEffect(
        'vignette',
        { strength: 0.5 },
        index++,
      ),
    )
  }

  // dreamy → bloom
  if (tone === 'dreamy') {
    effects.push(
      makeEffect(
        'bloom',
        { strength: 0.4 },
        index++,
      ),
    )
  }

  // 高对比 → color_shift
  if (lighting === '高对比') {
    effects.push(
      makeEffect(
        'color_shift',
        { strength: 0.3 },
        index++,
      ),
    )
  }

  // 柔和 → blur(小半径)
  if (lighting === '柔和') {
    effects.push(
      makeEffect(
        'blur',
        { radius: 0.003 },
        index++,
      ),
    )
  }

  return effects
}

/**
 * 主入口:从 CreativeRequirement 生成完整 RenderIR。
 *
 * @param requirement 已澄清的完整需求
 * @param options     可选配置(画布尺寸 / 时长 / 是否创建 region / effect)
 * @returns 完整 RenderIR(可直接喂给 runtimeStore.setRenderIR)
 *
 * @example
 * const ir = generateRenderIR({
 *   subject: '宇宙',
 *   style: { color: '蓝紫色', tone: 'cinematic' },
 *   elements: ['星空', '星云', '银河'],
 * })
 * runtimeStore.setRenderIR(ir)
 */
export function generateRenderIR(
  requirement: CreativeRequirement,
  options: GeneratorOptions = {},
): RenderIR {
  const {
    canvasWidth = 1920,
    canvasHeight = 1080,
    createRegion = true,
    createEffects = true,
  } = options

  // —— 1. 创建场景规划 ——
  const plan = createScenePlan(requirement)

  // —— 2. SceneLayer → Layer ——
  const layers: Layer[] = plan.layers.map((pl, i) => generateLayer(pl, i))

  // —— 3. 创建默认 Region ——
  const regions: Region[] = []
  let defaultRegionId: string | undefined
  if (createRegion && layers.length > 0) {
    const region = generateDefaultRegion(layers)
    regions.push(region)
    defaultRegionId = region.id
  }

  // —— 4. 生成 Effect ——
  const effects: Effect[] = []
  if (createEffects && layers.length > 0 && defaultRegionId) {
    effects.push(...generateEffects(requirement, layers, defaultRegionId))
  }

  // —— 5. 组装 RenderIR ——
  return {
    canvas: { width: canvasWidth, height: canvasHeight },
    layers,
    regions,
    effects,
    compileHints: { preferredProfile: 'region' },
  }
}

/**
 * 计算 ScenePlan 的图层总数与 effect 总数(用于 UI 反馈)。
 */
export function summarizeGeneratedIR(ir: RenderIR): string {
  const layerCount = ir.layers.length
  const effectCount = ir.effects.length
  const regionCount = ir.regions.length
  return `${layerCount} 图层 / ${regionCount} 区域 / ${effectCount} 效果 @ ${ir.canvas.width}×${ir.canvas.height}`
}
