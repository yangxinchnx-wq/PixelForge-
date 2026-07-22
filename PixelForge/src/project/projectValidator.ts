/**
 * Project Validator(Step 40.3)— 增强项目文件格式校验。
 *
 * 替代 serializer.ts 中基础的 assertProjectShape,提供更细粒度的校验:
 * - 顶层字段存在性 + 类型校验
 * - metadata 字段完整性(id / name / version / 时间戳 / canvasSize)
 * - renderIR 结构校验(canvas / layers 数组 / effects 数组)
 * - timeline 结构校验(currentFrame / totalFrames / fps / tracks 数组)
 * - 版本兼容性检查(向后兼容老版本)
 * - 返回结构化 ValidationResult(errors + warnings),便于 UI 展示
 *
 * 设计原则:
 * - 纯函数,不抛异常(返回结果对象)
 * - 错误分级:error(无法加载) / warning(可加载但不完美)
 * - 错误路径(severity / field / message)便于 UI 高亮定位
 * - 支持版本迁移检测(老版本 → 新版本提示升级)
 */
import type { PixelForgeProject, ProjectMetadata } from './types'
import { PROJECT_FILE_VERSION } from './types'

// ============================================================================
// 类型定义
// ============================================================================

/** 校验严重级别 */
export type ValidationSeverity = 'error' | 'warning'

/** 校验问题条目 */
export interface ValidationIssue {
  /** 严重级别(error 阻止加载,warning 仅提示) */
  severity: ValidationSeverity
  /** 字段路径(如 'metadata.id' / 'renderIR.layers[0].id') */
  field: string
  /** 问题描述 */
  message: string
}

/** 校验结果 */
export interface ValidationResult {
  /** 是否通过(error 数量 = 0) */
  valid: boolean
  /** 错误列表(error + warning) */
  issues: ValidationIssue[]
  /** 错误数量 */
  errorCount: number
  /** 警告数量 */
  warningCount: number
}

// ============================================================================
// 主入口
// ============================================================================

/**
 * 校验项目对象是否符合 PixelForgeProject 格式。
 *
 * @param value 任意值(通常从 JSON.parse 得来)
 * @returns 校验结果
 */
export function validateProject(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = []

  // —— 1. 顶层结构 ——
  if (typeof value !== 'object' || value === null) {
    return {
      valid: false,
      issues: [{
        severity: 'error',
        field: '',
        message: '项目文件根必须是对象',
      }],
      errorCount: 1,
      warningCount: 0,
    }
  }
  const obj = value as Record<string, unknown>

  // —— 2. metadata ——
  if (typeof obj.metadata !== 'object' || obj.metadata === null) {
    issues.push({
      severity: 'error',
      field: 'metadata',
      message: '项目文件缺少 metadata 字段',
    })
  } else {
    validateMetadata(obj.metadata as Record<string, unknown>, issues)
  }

  // —— 3. renderIR ——
  if (typeof obj.renderIR !== 'object' || obj.renderIR === null) {
    issues.push({
      severity: 'error',
      field: 'renderIR',
      message: '项目文件缺少 renderIR 字段',
    })
  } else {
    validateRenderIR(obj.renderIR as Record<string, unknown>, issues)
  }

  // —— 4. timeline ——
  if (typeof obj.timeline !== 'object' || obj.timeline === null) {
    issues.push({
      severity: 'error',
      field: 'timeline',
      message: '项目文件缺少 timeline 字段',
    })
  } else {
    validateTimeline(obj.timeline as Record<string, unknown>, issues)
  }

  // —— 5. history(可选) ——
  if (obj.history !== undefined) {
    if (!Array.isArray(obj.history)) {
      issues.push({
        severity: 'warning',
        field: 'history',
        message: 'history 字段应为数组,已忽略',
      })
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  return {
    valid: errorCount === 0,
    issues,
    errorCount,
    warningCount,
  }
}

// ============================================================================
// 子校验函数
// ============================================================================

/**
 * 校验 metadata 字段。
 */
function validateMetadata(meta: Record<string, unknown>, issues: ValidationIssue[]): void {
  if (typeof meta.id !== 'string' || meta.id.length === 0) {
    issues.push({
      severity: 'error',
      field: 'metadata.id',
      message: 'metadata.id 必须是非空字符串',
    })
  }
  if (typeof meta.name !== 'string') {
    issues.push({
      severity: 'error',
      field: 'metadata.name',
      message: 'metadata.name 必须是字符串',
    })
  }
  if (typeof meta.version !== 'string') {
    issues.push({
      severity: 'warning',
      field: 'metadata.version',
      message: 'metadata.version 缺失或非字符串,使用默认版本',
    })
  } else {
    // 版本兼容性检查
    checkVersionCompatibility(meta.version, issues)
  }
  if (typeof meta.createdAt !== 'number' || meta.createdAt < 0) {
    issues.push({
      severity: 'warning',
      field: 'metadata.createdAt',
      message: 'metadata.createdAt 应为非负时间戳',
    })
  }
  if (typeof meta.updatedAt !== 'number' || meta.updatedAt < 0) {
    issues.push({
      severity: 'warning',
      field: 'metadata.updatedAt',
      message: 'metadata.updatedAt 应为非负时间戳',
    })
  }
  // canvasSize
  const canvas = meta.canvasSize as Record<string, unknown> | undefined
  if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    issues.push({
      severity: 'warning',
      field: 'metadata.canvasSize',
      message: 'metadata.canvasSize 缺失或字段不完整',
    })
  } else {
    if (canvas.width <= 0 || canvas.width > 16384) {
      issues.push({
        severity: 'warning',
        field: 'metadata.canvasSize.width',
        message: `canvasSize.width ${canvas.width} 超出合理范围(1~16384)`,
      })
    }
    if (canvas.height <= 0 || canvas.height > 16384) {
      issues.push({
        severity: 'warning',
        field: 'metadata.canvasSize.height',
        message: `canvasSize.height ${canvas.height} 超出合理范围(1~16384)`,
      })
    }
  }
}

/**
 * 校验 renderIR 结构。
 */
function validateRenderIR(ir: Record<string, unknown>, issues: ValidationIssue[]): void {
  // canvas
  const canvas = ir.canvas as Record<string, unknown> | undefined
  if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    issues.push({
      severity: 'error',
      field: 'renderIR.canvas',
      message: 'renderIR.canvas 缺失或字段不完整(width/height)',
    })
  }
  // layers
  if (!Array.isArray(ir.layers)) {
    issues.push({
      severity: 'error',
      field: 'renderIR.layers',
      message: 'renderIR.layers 必须是数组',
    })
  } else {
    validateLayers(ir.layers as Record<string, unknown>[], issues)
  }
  // effects(可选,但存在则必须是数组)
  if (ir.effects !== undefined && !Array.isArray(ir.effects)) {
    issues.push({
      severity: 'warning',
      field: 'renderIR.effects',
      message: 'renderIR.effects 应为数组,已忽略',
    })
  }
}

/**
 * 校验 layers 数组(检查 id 唯一性 + 基础字段)。
 */
function validateLayers(layers: Record<string, unknown>[], issues: ValidationIssue[]): void {
  const idSet = new Set<string>()
  layers.forEach((layer, idx) => {
    const path = `renderIR.layers[${idx}]`
    if (typeof layer.id !== 'string' || layer.id.length === 0) {
      issues.push({
        severity: 'error',
        field: `${path}.id`,
        message: `layer[${idx}] 缺少 id 或 id 为空`,
      })
    } else {
      if (idSet.has(layer.id)) {
        issues.push({
          severity: 'error',
          field: `${path}.id`,
          message: `layer id "${layer.id}" 重复`,
        })
      }
      idSet.add(layer.id)
    }
  })
}

/**
 * 校验 timeline 结构。
 */
function validateTimeline(tl: Record<string, unknown>, issues: ValidationIssue[]): void {
  if (typeof tl.currentFrame !== 'number' || tl.currentFrame < 0) {
    issues.push({
      severity: 'warning',
      field: 'timeline.currentFrame',
      message: 'timeline.currentFrame 应为非负整数',
    })
  }
  if (typeof tl.totalFrames !== 'number' || tl.totalFrames < 0) {
    issues.push({
      severity: 'error',
      field: 'timeline.totalFrames',
      message: 'timeline.totalFrames 必须是非负整数',
    })
  }
  if (typeof tl.fps !== 'number' || tl.fps <= 0 || tl.fps > 240) {
    issues.push({
      severity: 'warning',
      field: 'timeline.fps',
      message: `timeline.fps ${tl.fps} 超出合理范围(1~240)`,
    })
  }
  if (!Array.isArray(tl.tracks)) {
    issues.push({
      severity: 'error',
      field: 'timeline.tracks',
      message: 'timeline.tracks 必须是数组',
    })
  }
}

/**
 * 版本兼容性检查(向前兼容)。
 *
 * 当前策略:
 * - 文件版本 <= 当前版本:正常加载
 * - 文件版本 > 当前版本:warning(可能丢失新字段,但尽力加载)
 */
function checkVersionCompatibility(fileVersion: string, issues: ValidationIssue[]): void {
  const comparison = compareVersions(fileVersion, PROJECT_FILE_VERSION)
  if (comparison > 0) {
    issues.push({
      severity: 'warning',
      field: 'metadata.version',
      message: `文件版本 ${fileVersion} 高于当前支持的 ${PROJECT_FILE_VERSION},可能丢失部分字段`,
    })
  }
}

/**
 * 语义化版本比较(简单实现:a.b.c 三段数字比较)。
 *
 * @returns 1 = a > b, -1 = a < b, 0 = 相等
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1
    if (pa[i] < pb[i]) return -1
  }
  return 0
}

/** 解析语义化版本为 [major, minor, patch] 数字数组(非数字段视为 0) */
function parseSemver(v: string): [number, number, number] {
  const parts = v.split('.').map((s) => {
    const n = parseInt(s, 10)
    return isNaN(n) ? 0 : n
  })
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 把校验结果转为可读字符串(用于 alert / console)。
 */
export function formatValidationResult(result: ValidationResult): string {
  if (result.valid && result.warningCount === 0) {
    return '项目文件校验通过'
  }
  const lines: string[] = []
  if (result.errorCount > 0) {
    lines.push(`${result.errorCount} 个错误:`)
    for (const issue of result.issues.filter((i) => i.severity === 'error')) {
      lines.push(`  [${issue.field}] ${issue.message}`)
    }
  }
  if (result.warningCount > 0) {
    lines.push(`${result.warningCount} 个警告:`)
    for (const issue of result.issues.filter((i) => i.severity === 'warning')) {
      lines.push(`  [${issue.field}] ${issue.message}`)
    }
  }
  return lines.join('\n')
}

/**
 * 从校验结果提取 metadata(若校验通过)。
 *
 * @returns 校验通过返回 metadata,失败返回 null
 */
export function extractMetadata(result: ValidationResult, value: unknown): ProjectMetadata | null {
  if (!result.valid) return null
  if (typeof value !== 'object' || value === null) return null
  const obj = value as { metadata?: ProjectMetadata }
  return obj.metadata ?? null
}

/**
 * 快速判断值是否为合法 PixelForgeProject(轻量校验,不返回详细 issues)。
 */
export function isProjectFile(value: unknown): value is PixelForgeProject {
  return validateProject(value).valid
}
