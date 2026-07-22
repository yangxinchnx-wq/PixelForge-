/**
 * PixelForge - WDL Validator(Step 37.4)
 *
 * 职责:
 * - 对 WDL AST 进行语义校验(语法校验由 Parser 完成)
 * - 检查 layer/effect/region 的 ID 唯一性
 * - 检查 effect.target 引用的 layer 是否存在
 * - 检查 region.layers 引用的 layer 是否存在
 * - 检查必填参数是否存在(layer.opcode / effect.type / region.bounds + layers)
 * - 检查参数值类型是否合法(如 bounds 必须是 4 数字数组)
 * - 收集所有错误而非遇到第一个就停止(支持多错误报告)
 *
 * 校验不抛异常,返回 ValidationReport(含 errors 和 warnings 数组)。
 */
import type { SceneNode, LayerNode, EffectNode, RegionNode } from './wdlParser'
import { parse } from './wdlParser'

// ============================================================================
// 1. 校验报告类型
// ============================================================================

/** 校验错误严重级别 */
export type Severity = 'error' | 'warning'

/** 校验消息 */
export interface ValidationMessage {
  /** 严重级别 */
  severity: Severity
  /** 消息内容 */
  message: string
  /** 行号 */
  line: number
  /** 列号 */
  column: number
}

/** 校验报告 */
export interface ValidationReport {
  /** 是否通过(无 error) */
  valid: boolean
  /** 错误列表 */
  errors: ValidationMessage[]
  /** 警告列表 */
  warnings: ValidationMessage[]
}

// ============================================================================
// 2. Validator 实现
// ============================================================================

/**
 * WDL 语义校验器。
 *
 * 用法:
 *   const report = validate(ast)
 *   if (!report.valid) {
 *     for (const err of report.errors) console.error(err.message)
 *   }
 */
export class Validator {
  private errors: ValidationMessage[] = []
  private warnings: ValidationMessage[] = []

  /**
   * 校验 AST 节点。
   *
   * @param ast WDL AST(SceneNode)
   * @returns 校验报告
   */
  validate(ast: SceneNode): ValidationReport {
    this.errors = []
    this.warnings = []

    this.validateScene(ast)

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    }
  }

  // --------------------------------------------------------------------------
  // 场景校验
  // --------------------------------------------------------------------------

  private validateScene(scene: SceneNode): void {
    // 场景名非空
    if (!scene.name || scene.name.trim() === '') {
      this.addError('场景名称不能为空', scene.line, scene.column)
    }

    // canvas 尺寸校验
    if (scene.canvas) {
      if (scene.canvas.width <= 0 || scene.canvas.height <= 0) {
        this.addError(
          `canvas 尺寸必须为正数,当前 ${scene.canvas.width}x${scene.canvas.height}`,
          scene.line,
          scene.column,
        )
      }
      if (scene.canvas.width > 8192 || scene.canvas.height > 8192) {
        this.addWarning(
          `canvas 尺寸 ${scene.canvas.width}x${scene.canvas.height} 过大,可能影响性能`,
          scene.line,
          scene.column,
        )
      }
    }

    // 收集所有 layer ID(用于引用校验)
    const layerIds = new Set<string>()
    for (const layer of scene.layers) {
      if (layerIds.has(layer.name)) {
        this.addError(`图层 ID "${layer.name}" 重复`, layer.line, layer.column)
      }
      layerIds.add(layer.name)
    }

    // 收集所有 effect ID
    const effectIds = new Set<string>()
    for (const effect of scene.effects) {
      if (effectIds.has(effect.name)) {
        this.addError(`效果 ID "${effect.name}" 重复`, effect.line, effect.column)
      }
      effectIds.add(effect.name)
    }

    // 收集所有 region ID
    const regionIds = new Set<string>()
    for (const region of scene.regions) {
      if (regionIds.has(region.name)) {
        this.addError(`区域 ID "${region.name}" 重复`, region.line, region.column)
      }
      regionIds.add(region.name)
    }

    // 校验每个 layer
    for (const layer of scene.layers) {
      this.validateLayer(layer)
    }

    // 校验每个 effect
    for (const effect of scene.effects) {
      this.validateEffect(effect, layerIds)
    }

    // 校验每个 region
    for (const region of scene.regions) {
      this.validateRegion(region, layerIds)
    }

    // 校验:至少有一个 layer
    if (scene.layers.length === 0) {
      this.addWarning('场景没有图层,将渲染空白画面', scene.line, scene.column)
    }

    // 校验:有 layer 但没有 region 时给出警告
    if (scene.layers.length > 0 && scene.regions.length === 0) {
      this.addWarning('场景有图层但没有区域,可能无法正确渲染', scene.line, scene.column)
    }
  }

  // --------------------------------------------------------------------------
  // Layer 校验
  // --------------------------------------------------------------------------

  private validateLayer(layer: LayerNode): void {
    // 必须有 opcode
    const opcodeParam = layer.params.find((p) => p.key === 'opcode')
    if (!opcodeParam) {
      this.addError(`图层 "${layer.name}" 缺少 opcode 参数`, layer.line, layer.column)
    } else {
      // opcode 值必须是 ident 或 string
      if (opcodeParam.value.kind !== 'ident' && opcodeParam.value.kind !== 'string') {
        this.addError(
          `图层 "${layer.name}" 的 opcode 必须是标识符`,
          opcodeParam.value.line,
          opcodeParam.value.column,
        )
      }
    }

    // color 参数(如果存在)应是 3 或 4 元素数组
    const colorParam = layer.params.find((p) => p.key === 'color')
    if (colorParam && colorParam.value.kind === 'array') {
      const len = colorParam.value.elements.length
      if (len !== 3 && len !== 4) {
        this.addError(
          `图层 "${layer.name}" 的 color 参数必须是 3 或 4 元素数组,当前 ${len} 个`,
          colorParam.value.line,
          colorParam.value.column,
        )
      }
    }
  }

  // --------------------------------------------------------------------------
  // Effect 校验
  // --------------------------------------------------------------------------

  private validateEffect(effect: EffectNode, layerIds: Set<string>): void {
    // 必须有 type
    const typeParam = effect.params.find((p) => p.key === 'type')
    if (!typeParam) {
      this.addError(`效果 "${effect.name}" 缺少 type 参数`, effect.line, effect.column)
    }

    // target 引用的 layer 必须存在
    const targetParam = effect.params.find((p) => p.key === 'target')
    if (targetParam) {
      const targetValue = targetParam.value
      if (targetValue.kind === 'string' || targetValue.kind === 'ident') {
        if (!layerIds.has(targetValue.value)) {
          this.addError(
            `效果 "${effect.name}" 的 target "${targetValue.value}" 引用了不存在的图层`,
            targetValue.line,
            targetValue.column,
          )
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // Region 校验
  // --------------------------------------------------------------------------

  private validateRegion(region: RegionNode, layerIds: Set<string>): void {
    // 必须有 bounds
    const boundsParam = region.params.find((p) => p.key === 'bounds')
    if (!boundsParam) {
      this.addError(`区域 "${region.name}" 缺少 bounds 参数`, region.line, region.column)
    } else if (boundsParam.value.kind === 'array') {
      if (boundsParam.value.elements.length !== 4) {
        this.addError(
          `区域 "${region.name}" 的 bounds 必须是 4 元素数组 [x, y, width, height]`,
          boundsParam.value.line,
          boundsParam.value.column,
        )
      } else {
        // 检查 bounds 元素是否都是数字
        for (let i = 0; i < boundsParam.value.elements.length; i++) {
          const elem = boundsParam.value.elements[i]
          if (elem.kind !== 'number') {
            this.addError(
              `区域 "${region.name}" 的 bounds[${i}] 必须是数字`,
              elem.line,
              elem.column,
            )
          }
        }
        // 检查 width 和 height 是否为正
        if (boundsParam.value.elements.length === 4) {
          const width = boundsParam.value.elements[2]
          const height = boundsParam.value.elements[3]
          if (width.kind === 'number' && width.value <= 0) {
            this.addError(
              `区域 "${region.name}" 的 bounds width 必须为正数`,
              width.line,
              width.column,
            )
          }
          if (height.kind === 'number' && height.value <= 0) {
            this.addError(
              `区域 "${region.name}" 的 bounds height 必须为正数`,
              height.line,
              height.column,
            )
          }
        }
      }
    } else {
      this.addError(
        `区域 "${region.name}" 的 bounds 必须是数组`,
        boundsParam.value.line,
        boundsParam.value.column,
      )
    }

    // 必须有 layers
    const layersParam = region.params.find((p) => p.key === 'layers')
    if (!layersParam) {
      this.addError(`区域 "${region.name}" 缺少 layers 参数`, region.line, region.column)
    } else if (layersParam.value.kind === 'array') {
      // 检查每个 layers 元素引用的 layer 是否存在
      for (const elem of layersParam.value.elements) {
        if (elem.kind === 'string' || elem.kind === 'ident') {
          if (!layerIds.has(elem.value)) {
            this.addError(
              `区域 "${region.name}" 的 layers 引用了不存在的图层 "${elem.value}"`,
              elem.line,
              elem.column,
            )
          }
        } else {
          this.addError(
            `区域 "${region.name}" 的 layers 数组元素必须是字符串`,
            elem.line,
            elem.column,
          )
        }
      }
    } else {
      this.addError(
        `区域 "${region.name}" 的 layers 必须是数组`,
        layersParam.value.line,
        layersParam.value.column,
      )
    }

    // layers 不应为空
    if (layersParam && layersParam.value.kind === 'array' && layersParam.value.elements.length === 0) {
      this.addWarning(
        `区域 "${region.name}" 的 layers 为空,该区域不会渲染任何图层`,
        region.line,
        region.column,
      )
    }
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  private addError(message: string, line: number, column: number): void {
    this.errors.push({ severity: 'error', message, line, column })
  }

  private addWarning(message: string, line: number, column: number): void {
    this.warnings.push({ severity: 'warning', message, line, column })
  }
}

// ============================================================================
// 3. 便捷函数
// ============================================================================

/**
 * 校验 WDL AST。
 *
 * @param ast WDL AST
 * @returns 校验报告
 */
export function validate(ast: SceneNode): ValidationReport {
  return new Validator().validate(ast)
}

/**
 * 校验 WDL 源码(解析 + 校验)。
 * 如果解析失败,返回包含解析错误的报告。
 *
 * @param source WDL 源码
 * @returns 校验报告
 */
export function validateSource(source: string): ValidationReport {
  try {
    const ast = parse(source)
    return validate(ast)
  } catch (e) {
    // 解析错误转为校验报告
    const errors: ValidationMessage[] = []
    if (e instanceof Error) {
      const line = (e as { line?: number }).line ?? 0
      const column = (e as { column?: number }).column ?? 0
      errors.push({
        severity: 'error',
        message: e.message,
        line,
        column,
      })
    }
    return {
      valid: false,
      errors,
      warnings: [],
    }
  }
}
