/**
 * PixelForge - WDL Completion Provider(Step 38.2)
 *
 * 职责:
 * - 为 Monaco Editor 提供 WDL 语言的智能补全
 * - 基于上下文(光标位置 + 已输入文本)给出合适的补全项
 * - 7 类补全:块关键字 / 参数关键字 / opcode 值 / blendMode 值 / 布尔值 / 图层 ID 引用 / 参数名
 *
 * 上下文检测策略:
 * 1. 解析当前行 + 上一行,判断光标所在 block 类型(scene/layer/effect/region/root)
 * 2. 检查光标前是否是 "key:" 模式 — 是则补全值,否则补全 key
 * 3. 收集已声明的 layer/effect/region 名(用于引用补全)
 *
 * 用法:
 *   import { registerWDLCompletion } from '@/world/wdl/wdlCompletion'
 *   registerWDLCompletion(monaco)  // 在 registerWDLLanguage 之后调用
 */
import type * as Monaco from 'monaco-editor'
import { WDL_LANGUAGE_ID } from './wdlMonarch'
import {
  WDL_MONARCH_KEYWORDS,
  WDL_MONARCH_OPCODES,
  WDL_MONARCH_BLEND_MODES,
  WDL_MONARCH_BOOLEANS,
} from './wdlMonarch'

// ============================================================================
// 1. 参数名补全表(按 block 类型)
// ============================================================================

/** scene 块内的参数名 */
const SCENE_PARAMS: WDLCompletionItem[] = [
  { label: 'canvas', insertText: 'canvas: ', detail: '画布尺寸(如 1920x1080)', kind: 'property' },
]

/** layer 块内的参数名 */
const LAYER_PARAMS: WDLCompletionItem[] = [
  { label: 'opcode', insertText: 'opcode: ', detail: '图层操作类型(必填)', kind: 'property' },
  { label: 'blendMode', insertText: 'blendMode: ', detail: '混合模式', kind: 'property' },
  { label: 'visible', insertText: 'visible: ', detail: '是否可见(默认 true)', kind: 'property' },
  { label: 'color', insertText: 'color: ', detail: '主颜色 RGBA (0-1),如 [1, 0, 0, 1]', kind: 'property' },
  { label: 'color2', insertText: 'color2: ', detail: '渐变终止色 RGBA (0-1)', kind: 'property' },
  { label: 'angle', insertText: 'angle: ', detail: '渐变角度(度)', kind: 'property' },
  { label: 'scale', insertText: 'scale: ', detail: '缩放 (0-1)', kind: 'property' },
  { label: 'intensity', insertText: 'intensity: ', detail: '强度 (0-1)', kind: 'property' },
  { label: 'radius', insertText: 'radius: ', detail: '半径 (0-1)', kind: 'property' },
  { label: 'seed', insertText: 'seed: ', detail: '随机种子', kind: 'property' },
  { label: 'position', insertText: 'position: ', detail: '位置 [x, y] (0-1)', kind: 'property' },
]

/** effect 块内的参数名 */
const EFFECT_PARAMS: WDLCompletionItem[] = [
  { label: 'type', insertText: 'type: ', detail: '效果类型(必填)', kind: 'property' },
  { label: 'target', insertText: 'target: ', detail: '目标图层 ID', kind: 'property' },
  { label: 'targetRegion', insertText: 'targetRegion: ', detail: '目标区域 ID', kind: 'property' },
  { label: 'intensity', insertText: 'intensity: ', detail: '强度 (0-1)', kind: 'property' },
  { label: 'radius', insertText: 'radius: ', detail: '半径/模糊核大小', kind: 'property' },
  { label: 'color', insertText: 'color: ', detail: '颜色 RGBA (0-1)', kind: 'property' },
  { label: 'threshold', insertText: 'threshold: ', detail: '阈值 (0-1)', kind: 'property' },
  { label: 'exposure', insertText: 'exposure: ', detail: '曝光 (0-2)', kind: 'property' },
  { label: 'saturation', insertText: 'saturation: ', detail: '饱和度 (0-2)', kind: 'property' },
  { label: 'contrast', insertText: 'contrast: ', detail: '对比度 (0-2)', kind: 'property' },
  { label: 'hueShift', insertText: 'hueShift: ', detail: '色相偏移 (0-360)', kind: 'property' },
]

/** region 块内的参数名 */
const REGION_PARAMS: WDLCompletionItem[] = [
  { label: 'bounds', insertText: 'bounds: ', detail: '边界 [x, y, width, height] (必填,0-1)', kind: 'property' },
  { label: 'layers', insertText: 'layers: ', detail: '图层 ID 列表(必填)', kind: 'property' },
]

// ============================================================================
// 2. 补全项类型(独立于 Monaco,便于测试)
// ============================================================================

/** 补全项类型(简化版,对应 monaco.languages.CompletionItemKind) */
export type WDLCompletionKind = 'keyword' | 'property' | 'value' | 'snippet' | 'reference'

/** 补全项(独立于 Monaco 运行时,便于测试) */
export interface WDLCompletionItem {
  /** 显示标签 */
  label: string
  /** 插入文本(不含光标位置) */
  insertText: string
  /** 描述/文档 */
  detail?: string
  /** 补全类型 */
  kind: WDLCompletionKind
}

// ============================================================================
// 3. 上下文检测
// ============================================================================

/** block 类型 */
export type BlockType = 'root' | 'scene' | 'layer' | 'effect' | 'region'

/** 上下文检测结果 */
export interface WDLCompletionContext {
  /** 光标所在的 block 类型 */
  block: BlockType
  /** 光标前是否刚输入了冒号(即等待值补全) */
  afterColon: boolean
  /** 光标前最后一个 "key:" 的 key(用于值补全) */
  lastKey?: string
  /** 已声明的 layer ID 列表 */
  declaredLayers: string[]
  /** 已声明的 effect ID 列表 */
  declaredEffects: string[]
  /** 已声明的 region ID 列表 */
  declaredRegions: string[]
}

/**
 * 分析源码,推断光标位置的补全上下文。
 *
 * @param source 完整源码
 * @param line 光标行(1-based)
 * @param column 光标列(1-based)
 * @returns 补全上下文
 */
export function analyzeCompletionContext(
  source: string,
  line: number,
  column: number,
): WDLCompletionContext {
  const lines = source.split('\n')
  // 当前行光标前的文本
  const currentLine = lines[line - 1] ?? ''
  const beforeCursor = currentLine.substring(0, column - 1)

  // 检测 afterColon:光标前是否是 "key:" 模式(可能含空格)
  const colonMatch = beforeCursor.match(/(\w+)\s*:\s*$/)
  const afterColon = colonMatch !== null
  const lastKey = colonMatch?.[1]

  // 向上查找最近的块声明(scene/layer/effect/region "name" {)
  let block: BlockType = 'root'
  let depth = 0
  for (let i = line - 1; i >= 0; i--) {
    const l = lines[i] ?? ''
    // 统计 { } 深度
    const opens = (l.match(/{/g) ?? []).length
    const closes = (l.match(/}/g) ?? []).length
    depth += opens - closes

    // 检测块声明
    const blockMatch = l.match(/^\s*(scene|layer|effect|region)\s+"/)
    if (blockMatch) {
      // 如果当前深度 > 0,说明光标在这个块内
      if (depth > 0 || i === line - 1) {
        block = blockMatch[1] as BlockType
        break
      }
    }
    // scene 块特殊:canvas 是 scene 块内的参数
    const sceneMatch = l.match(/^\s*scene\s+"/)
    if (sceneMatch && depth >= 0) {
      block = 'scene'
      break
    }
  }

  // 收集已声明的 layer/effect/region ID
  const declaredLayers: string[] = []
  const declaredEffects: string[] = []
  const declaredRegions: string[] = []
  const layerRegex = /layer\s+"([^"]+)"/g
  const effectRegex = /effect\s+"([^"]+)"/g
  const regionRegex = /region\s+"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = layerRegex.exec(source)) !== null) declaredLayers.push(m[1])
  while ((m = effectRegex.exec(source)) !== null) declaredEffects.push(m[1])
  while ((m = regionRegex.exec(source)) !== null) declaredRegions.push(m[1])

  return { block, afterColon, lastKey, declaredLayers, declaredEffects, declaredRegions }
}

// ============================================================================
// 4. 补全项生成
// ============================================================================

/**
 * 基于上下文生成补全项列表(纯函数,便于测试)。
 *
 * @param ctx 补全上下文
 * @returns 补全项列表
 */
export function generateCompletions(ctx: WDLCompletionContext): WDLCompletionItem[] {
  // —— 值补全(afterColon 且有 lastKey)——
  if (ctx.afterColon && ctx.lastKey) {
    return generateValueCompletions(ctx.lastKey, ctx)
  }

  // —— key 补全(根据 block 类型)——
  switch (ctx.block) {
    case 'root':
      // root 层只补全块关键字
      return WDL_MONARCH_KEYWORDS
        .filter((kw) => ['scene', 'layer', 'effect', 'region'].includes(kw))
        .map((kw) => ({
          label: kw,
          insertText: `${kw} "\${1:name}" {\n  \n}`,
          detail: BLOCK_DESCRIPTIONS[kw],
          kind: 'snippet' as WDLCompletionKind,
        }))

    case 'scene':
      return SCENE_PARAMS

    case 'layer':
      return LAYER_PARAMS

    case 'effect':
      return EFFECT_PARAMS

    case 'region':
      return REGION_PARAMS

    default:
      return []
  }
}

/** 块关键字描述 */
const BLOCK_DESCRIPTIONS: Record<string, string> = {
  scene: '场景块(顶层)',
  layer: '图层块',
  effect: '效果块',
  region: '区域块',
}

/**
 * 基于 key 生成值补全项。
 */
function generateValueCompletions(key: string, ctx: WDLCompletionContext): WDLCompletionItem[] {
  switch (key) {
    case 'opcode':
      return WDL_MONARCH_OPCODES.map((op) => ({
        label: op,
        insertText: op,
        detail: OPCODE_DESCRIPTIONS[op] ?? `${op} 操作`,
        kind: 'value' as WDLCompletionKind,
      }))

    case 'blendMode':
      return WDL_MONARCH_BLEND_MODES.map((bm) => ({
        label: bm,
        insertText: bm,
        detail: `混合模式: ${bm}`,
        kind: 'value' as WDLCompletionKind,
      }))

    case 'visible':
      return WDL_MONARCH_BOOLEANS.map((b) => ({
        label: b,
        insertText: b,
        detail: b === 'true' ? '可见(默认)' : '隐藏',
        kind: 'value' as WDLCompletionKind,
      }))

    case 'target':
    case 'targetRegion':
      // 引用已声明的 layer/region
      if (key === 'target') {
        return ctx.declaredLayers.map((id) => ({
          label: `"${id}"`,
          insertText: `"${id}"`,
          detail: '图层引用',
          kind: 'reference' as WDLCompletionKind,
        }))
      }
      return ctx.declaredRegions.map((id) => ({
        label: `"${id}"`,
        insertText: `"${id}"`,
        detail: '区域引用',
        kind: 'reference' as WDLCompletionKind,
      }))

    case 'type':
      // effect type 值
      return EFFECT_TYPES.map((t) => ({
        label: t,
        insertText: t,
        detail: EFFECT_TYPE_DESCRIPTIONS[t] ?? `${t} 效果`,
        kind: 'value' as WDLCompletionKind,
      }))

    default:
      // 普通参数值(数字/数组)— 不提供补全,让用户自由输入
      return []
  }
}

/** opcode 中文描述(与 directorContext.ts OPCODE_DESCRIPTION 对齐) */
const OPCODE_DESCRIPTIONS: Record<string, string> = {
  SOLID_COLOR: '纯色填充',
  LINEAR_GRADIENT: '线性渐变',
  NOISE: '噪声纹理',
  BLEND: '混合',
  CIRCLE_SHAPE: '圆形形状',
  IMAGE_TEXTURE: '图片纹理',
}

/** effect type 值(常见效果类型) */
const EFFECT_TYPES = [
  'vignette', 'blur', 'bloom', 'glitch', 'colorCorrect',
  'chromaticAberration', 'filmGrain', 'posterize',
]

/** effect type 中文描述 */
const EFFECT_TYPE_DESCRIPTIONS: Record<string, string> = {
  vignette: '暗角效果',
  blur: '模糊',
  bloom: '泛光',
  glitch: '故障艺术',
  colorCorrect: '色彩校正',
  chromaticAberration: '色差',
  filmGrain: '胶片颗粒',
  posterize: '色调分离',
}

// ============================================================================
// 5. Monaco 注册
// ============================================================================

/** WDLCompletionKind → Monaco CompletionItemKind 映射(使用传入的 monaco 实例) */
function toMonacoKind(
  kind: WDLCompletionKind,
  monaco: typeof Monaco,
): Monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'keyword': return monaco.languages.CompletionItemKind.Keyword
    case 'property': return monaco.languages.CompletionItemKind.Property
    case 'value': return monaco.languages.CompletionItemKind.Value
    case 'snippet': return monaco.languages.CompletionItemKind.Snippet
    case 'reference': return monaco.languages.CompletionItemKind.Reference
    default: return monaco.languages.CompletionItemKind.Text
  }
}

/**
 * 在 Monaco 实例上注册 WDL 自动补全。
 *
 * 幂等:多次调用安全(由 Monaco 内部去重)。
 */
export function registerWDLCompletion(monaco: typeof Monaco): void {
  monaco.languages.registerCompletionItemProvider(WDL_LANGUAGE_ID, {
    triggerCharacters: [':', ' ', '"', ','],

    provideCompletionItems(
      model: Monaco.editor.ITextModel,
      position: Monaco.Position,
    ): Monaco.languages.ProviderResult<Monaco.languages.CompletionList> {
      const source = model.getValue()
      const ctx = analyzeCompletionContext(source, position.lineNumber, position.column)
      const items = generateCompletions(ctx)

      // 计算补全范围(当前单词)
      const wordUntil = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: wordUntil.startColumn,
        endColumn: wordUntil.endColumn,
      }

      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind: toMonacoKind(item.kind, monaco),
          insertText: item.insertText,
          insertTextRules: item.kind === 'snippet'
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : monaco.languages.CompletionItemInsertTextRule.None,
          detail: item.detail,
          range,
        })),
      }
    },
  })
}
