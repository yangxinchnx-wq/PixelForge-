/**
 * PixelForge - WDL Compiler(Step 37.3)
 *
 * 职责:
 * - 将 WDL AST( SceneNode )编译为 RenderIR
 * - 处理 opcode 名称 → Opcode enum 映射
 * - 处理 blendMode 字符串 → BlendMode 类型
 * - 处理 effect type 字符串 → EffectType
 * - 处理 region bounds 数组 → BoundingBox
 * - 处理 region layers 数组 → layerRefs
 * - 将 WDL 参数值转换为 JsonLiteral(RenderIR params 要求)
 *
 * 编译规则:
 *   - layer 必须有 opcode 参数,否则抛 CompileError
 *   - layer 的 name 直接作为 layer.id
 *   - effect 的 name 直接作为 effect.id
 *   - region 的 name 直接作为 region.id
 *   - 缺省字段使用合理默认值(visible=true / source='system_default' 等)
 *   - canvas 缺省为 1920x1080
 */
import type { SceneNode, LayerNode, EffectNode, RegionNode, ValueNode, ParamNode } from './wdlParser'
import { parse } from './wdlParser'
import type { RenderIR, Layer, Effect, Region } from '@/compiler/ir/renderIR'
import type {
  Opcode,
  BlendMode,
  SourceKind,
  ParamOwnership,
  BoundingBox,
  CompileHints,
  JsonLiteral,
} from '@/shared/types'
import { Opcode as OpcodeEnum } from '@/shared/types'

// ============================================================================
// 1. CompileError
// ============================================================================

/** WDL 编译错误 */
export class CompileError extends Error {
  line: number
  column: number

  constructor(message: string, line: number, column: number) {
    super(`WDL Compile Error (line ${line}, col ${column}): ${message}`)
    this.name = 'CompileError'
    this.line = line
    this.column = column
  }
}

// ============================================================================
// 2. 映射表
// ============================================================================

/** opcode 名称 → Opcode enum 映射 */
const OPCODE_MAP: Record<string, Opcode> = {
  SOLID_COLOR: OpcodeEnum.SOLID_COLOR,
  LINEAR_GRADIENT: OpcodeEnum.LINEAR_GRADIENT,
  NOISE: OpcodeEnum.NOISE,
  BLEND: OpcodeEnum.BLEND,
  CIRCLE_SHAPE: OpcodeEnum.CIRCLE_SHAPE,
  IMAGE_TEXTURE: OpcodeEnum.IMAGE_TEXTURE,
}

/** blendMode 字符串 → BlendMode 类型(暂用 string 联合) */
const BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'add', 'subtract',
])

/** 默认 canvas 尺寸 */
const DEFAULT_CANVAS = { width: 1920, height: 1080 }

/** 默认 CompileHints */
const DEFAULT_COMPILE_HINTS: CompileHints = {
  preferredProfile: 'region',
}

// ============================================================================
// 3. 值转换
// ============================================================================

/**
 * 将 ValueNode 转换为 JsonLiteral。
 * RenderIR 的 params 要求所有值都是 JsonLiteral。
 */
function valueToJsonLiteral(value: ValueNode): JsonLiteral {
  switch (value.kind) {
    case 'number':
      return value.value
    case 'string':
      return value.value
    case 'boolean':
      return value.value
    case 'ident':
      // 标识符作为字符串处理(如 'normal' / 'add')
      return value.value
    case 'array':
      return value.elements.map(valueToJsonLiteral)
    default:
      return null
  }
}

/**
 * 从参数列表中查找指定参数,返回 ValueNode 或 undefined。
 */
function findParam(params: ParamNode[], key: string): ParamNode | undefined {
  return params.find((p) => p.key === key)
}

// ============================================================================
// 4. Layer 编译
// ============================================================================

/** 编译 LayerNode → RenderIR Layer */
function compileLayer(node: LayerNode): Layer {
  const opcodeParam = findParam(node.params, 'opcode')
  if (!opcodeParam) {
    throw new CompileError(
      `layer "${node.name}" 缺少 opcode 参数`,
      node.line,
      node.column,
    )
  }

  // opcode 值必须是 ident
  const opcodeValue = opcodeParam.value
  if (opcodeValue.kind !== 'ident' && opcodeValue.kind !== 'string') {
    throw new CompileError(
      `layer "${node.name}" 的 opcode 必须是标识符或字符串`,
      opcodeValue.line,
      opcodeValue.column,
    )
  }

  const opcodeName = opcodeValue.value
  const opcode = OPCODE_MAP[opcodeName]
  if (opcode === undefined) {
    throw new CompileError(
      `layer "${node.name}" 的 opcode "${opcodeName}" 不合法`,
      opcodeValue.line,
      opcodeValue.column,
    )
  }

  // 收集 params(排除 opcode,因为 opcode 是独立字段)
  const params: Record<string, JsonLiteral> = {}
  const paramOwnership: ParamOwnership = {}
  for (const param of node.params) {
    if (param.key === 'opcode') continue
    if (param.key === 'blendMode') continue // blendMode 是独立字段
    if (param.key === 'visible') continue   // visible 是独立字段
    params[param.key] = valueToJsonLiteral(param.value)
    paramOwnership[param.key] = 'l2_user'
  }

  // blendMode(可选)
  const blendModeParam = findParam(node.params, 'blendMode')
  let blendMode: BlendMode | undefined
  if (blendModeParam) {
    const bmValue = blendModeParam.value
    if (bmValue.kind === 'ident' || bmValue.kind === 'string') {
      if (!BLEND_MODES.has(bmValue.value)) {
        throw new CompileError(
          `layer "${node.name}" 的 blendMode "${bmValue.value}" 不合法`,
          bmValue.line,
          bmValue.column,
        )
      }
      blendMode = bmValue.value as BlendMode
    }
  }

  // visible(可选,默认 true)
  const visibleParam = findParam(node.params, 'visible')
  let visible = true
  if (visibleParam && visibleParam.value.kind === 'boolean') {
    visible = visibleParam.value.value
  }

  return {
    id: node.name,
    opcode,
    params,
    source: 'system_default' as SourceKind,
    paramOwnership,
    visible,
    blendMode,
  }
}

// ============================================================================
// 5. Effect 编译
// ============================================================================

/** 编译 EffectNode → RenderIR Effect */
function compileEffect(node: EffectNode): Effect {
  const typeParam = findParam(node.params, 'type')
  if (!typeParam) {
    throw new CompileError(
      `effect "${node.name}" 缺少 type 参数`,
      node.line,
      node.column,
    )
  }

  const typeValue = typeParam.value
  if (typeValue.kind !== 'ident' && typeValue.kind !== 'string') {
    throw new CompileError(
      `effect "${node.name}" 的 type 必须是标识符或字符串`,
      typeValue.line,
      typeValue.column,
    )
  }

  // 收集 params(排除 type / target / targetRegion)
  const params: Record<string, JsonLiteral> = {}
  for (const param of node.params) {
    if (param.key === 'type') continue
    if (param.key === 'target') continue
    if (param.key === 'targetRegion') continue
    params[param.key] = valueToJsonLiteral(param.value)
  }

  // target(可选,指向 layer 名)
  const targetParam = findParam(node.params, 'target')
  let targetLayer: string | undefined
  if (targetParam) {
    if (targetParam.value.kind === 'string') {
      targetLayer = targetParam.value.value
    } else if (targetParam.value.kind === 'ident') {
      targetLayer = targetParam.value.value
    }
  }

  // targetRegion(可选)
  const targetRegionParam = findParam(node.params, 'targetRegion')
  let targetRegion: string | undefined
  if (targetRegionParam) {
    if (targetRegionParam.value.kind === 'string') {
      targetRegion = targetRegionParam.value.value
    } else if (targetRegionParam.value.kind === 'ident') {
      targetRegion = targetRegionParam.value.value
    }
  }

  return {
    id: node.name,
    type: typeValue.value,
    params,
    targetLayer,
    targetRegion,
  }
}

// ============================================================================
// 6. Region 编译
// ============================================================================

/** 编译 RegionNode → RenderIR Region */
function compileRegion(node: RegionNode): Region {
  // bounds(必须,4 元素数组 [x, y, width, height])
  const boundsParam = findParam(node.params, 'bounds')
  if (!boundsParam) {
    throw new CompileError(
      `region "${node.name}" 缺少 bounds 参数`,
      node.line,
      node.column,
    )
  }

  if (boundsParam.value.kind !== 'array' || boundsParam.value.elements.length !== 4) {
    throw new CompileError(
      `region "${node.name}" 的 bounds 必须是 4 元素数组 [x, y, width, height]`,
      boundsParam.value.line,
      boundsParam.value.column,
    )
  }

  const boundsElements = boundsParam.value.elements
  const bounds: BoundingBox = {
    x: (boundsElements[0] as { value: number }).value,
    y: (boundsElements[1] as { value: number }).value,
    width: (boundsElements[2] as { value: number }).value,
    height: (boundsElements[3] as { value: number }).value,
  }

  // layers(必须,字符串数组)
  const layersParam = findParam(node.params, 'layers')
  if (!layersParam) {
    throw new CompileError(
      `region "${node.name}" 缺少 layers 参数`,
      node.line,
      node.column,
    )
  }

  if (layersParam.value.kind !== 'array') {
    throw new CompileError(
      `region "${node.name}" 的 layers 必须是数组`,
      layersParam.value.line,
      layersParam.value.column,
    )
  }

  const layerRefs: string[] = []
  for (const elem of layersParam.value.elements) {
    if (elem.kind !== 'string' && elem.kind !== 'ident') {
      throw new CompileError(
        `region "${node.name}" 的 layers 数组元素必须是字符串`,
        elem.line,
        elem.column,
      )
    }
    layerRefs.push(elem.value)
  }

  return {
    id: node.name,
    bounds,
    layerRefs,
    source: 'system_default' as SourceKind,
  }
}

// ============================================================================
// 7. 主编译入口
// ============================================================================

/**
 * 将 WDL AST 编译为 RenderIR。
 *
 * @param ast WDL AST(SceneNode)
 * @returns RenderIR
 * @throws CompileError 编译错误
 */
export function compile(ast: SceneNode): RenderIR {
  const canvas = ast.canvas ?? DEFAULT_CANVAS

  const layers: Layer[] = []
  for (const layerNode of ast.layers) {
    layers.push(compileLayer(layerNode))
  }

  const effects: Effect[] = []
  for (const effectNode of ast.effects) {
    effects.push(compileEffect(effectNode))
  }

  const regions: Region[] = []
  for (const regionNode of ast.regions) {
    regions.push(compileRegion(regionNode))
  }

  return {
    canvas,
    layers,
    regions,
    effects,
    compileHints: DEFAULT_COMPILE_HINTS,
  }
}

// ============================================================================
// 8. 一站式编译(源码 → RenderIR)
// ============================================================================

/**
 * 将 WDL 源码一站式编译为 RenderIR。
 *
 * 内部串联: Lexer → Parser → Compiler
 *
 * @param source WDL 源码
 * @returns RenderIR
 * @throws LexerError / ParseError / CompileError
 */
export function compileSource(source: string): RenderIR {
  const ast = parse(source)
  return compile(ast)
}
