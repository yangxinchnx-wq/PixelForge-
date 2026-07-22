/**
 * projectValidator.test.ts — 项目文件格式校验测试。
 *
 * 测试分组:
 *   V: 校验主入口 / VM: metadata / VR: renderIR / VT: timeline
 *   VER: 版本比较 / F: 格式化 / EX: 提取 / I: isProjectFile
 */
import { describe, it, expect } from 'vitest'

import {
  validateProject,
  compareVersions,
  formatValidationResult,
  extractMetadata,
  isProjectFile,
  type ValidationResult,
} from './projectValidator'
import type { PixelForgeProject } from './types'
import { PROJECT_FILE_VERSION } from './types'

// —— 测试辅助 ——

function makeValidProject(): PixelForgeProject {
  return {
    metadata: {
      id: 'test-001',
      name: 'Test Project',
      version: PROJECT_FILE_VERSION,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      scenario: 'blend_demo',
      canvasSize: { width: 1024, height: 768 },
    },
    renderIR: {
      canvas: { width: 1024, height: 768 },
      layers: [
        { id: 'layer_0', opcode: 0, params: {}, source: 'system_default', paramOwnership: {}, visible: true, blendMode: 'normal' },
      ],
      regions: [],
      effects: [],
      compileHints: {},
    },
    timeline: {
      currentFrame: 0,
      totalFrames: 120,
      fps: 60,
      tracks: [],
    },
  }
}

// ============================================================================
// 1. 主入口校验
// ============================================================================

describe('projectValidator / 主入口', () => {
  it('V01: 合法项目通过校验', () => {
    const result = validateProject(makeValidProject())
    expect(result.valid).toBe(true)
    expect(result.errorCount).toBe(0)
  })

  it('V02: 非对象返回 error', () => {
    const result = validateProject('string')
    expect(result.valid).toBe(false)
    expect(result.errorCount).toBe(1)
    expect(result.issues[0].field).toBe('')
  })

  it('V03: null 返回 error', () => {
    const result = validateProject(null)
    expect(result.valid).toBe(false)
  })

  it('V04: 缺少 metadata 返回 error', () => {
    const proj = makeValidProject()
    delete (proj as { metadata?: unknown }).metadata
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.field === 'metadata')).toBe(true)
  })

  it('V05: 缺少 renderIR 返回 error', () => {
    const proj = makeValidProject()
    delete (proj as { renderIR?: unknown }).renderIR
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('V06: 缺少 timeline 返回 error', () => {
    const proj = makeValidProject()
    delete (proj as { timeline?: unknown }).timeline
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('V07: history 非数组产生 warning(不阻止校验)', () => {
    const proj = makeValidProject()
    ;(proj as { history?: unknown }).history = 'not array'
    const result = validateProject(proj)
    expect(result.valid).toBe(true)
    expect(result.warningCount).toBeGreaterThan(0)
  })
})

// ============================================================================
// 2. metadata 校验
// ============================================================================

describe('projectValidator / metadata', () => {
  it('VM01: id 空字符串返回 error', () => {
    const proj = makeValidProject()
    proj.metadata.id = ''
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'metadata.id')).toBe(true)
  })

  it('VM02: id 非字符串返回 error', () => {
    const proj = makeValidProject()
    ;(proj.metadata as { id?: unknown }).id = 123
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('VM03: name 缺失返回 error', () => {
    const proj = makeValidProject()
    ;(proj.metadata as { name?: unknown }).name = undefined
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('VM04: version 非字符串产生 warning', () => {
    const proj = makeValidProject()
    ;(proj.metadata as { version?: unknown }).version = 123
    const result = validateProject(proj)
    expect(result.warningCount).toBeGreaterThan(0)
  })

  it('VM05: createdAt 负数产生 warning', () => {
    const proj = makeValidProject()
    proj.metadata.createdAt = -1
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'metadata.createdAt')).toBe(true)
  })

  it('VM06: canvasSize 缺失产生 warning', () => {
    const proj = makeValidProject()
    ;(proj.metadata as { canvasSize?: unknown }).canvasSize = undefined
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'metadata.canvasSize')).toBe(true)
  })

  it('VM07: canvasSize.width 超出范围产生 warning', () => {
    const proj = makeValidProject()
    proj.metadata.canvasSize.width = 99999
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'metadata.canvasSize.width')).toBe(true)
  })

  it('VM08: canvasSize.height 超出范围产生 warning', () => {
    const proj = makeValidProject()
    proj.metadata.canvasSize.height = 0
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'metadata.canvasSize.height')).toBe(true)
  })
})

// ============================================================================
// 3. renderIR 校验
// ============================================================================

describe('projectValidator / renderIR', () => {
  it('VR01: canvas 缺失返回 error', () => {
    const proj = makeValidProject()
    ;(proj.renderIR as { canvas?: unknown }).canvas = undefined
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('VR02: layers 非数组返回 error', () => {
    const proj = makeValidProject()
    ;(proj.renderIR as { layers?: unknown }).layers = 'not array'
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('VR03: layer id 空返回 error', () => {
    const proj = makeValidProject()
    proj.renderIR.layers[0].id = ''
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field.includes('layers[0].id'))).toBe(true)
  })

  it('VR04: layer id 重复返回 error', () => {
    const proj = makeValidProject()
    proj.renderIR.layers.push({ id: 'layer_0', opcode: 0, params: {}, source: 'system_default', paramOwnership: {}, visible: true, blendMode: 'normal' })
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.message.includes('重复'))).toBe(true)
  })

  it('VR05: effects 非数组产生 warning', () => {
    const proj = makeValidProject()
    ;(proj.renderIR as { effects?: unknown }).effects = 'not array'
    const result = validateProject(proj)
    expect(result.warningCount).toBeGreaterThan(0)
  })
})

// ============================================================================
// 4. timeline 校验
// ============================================================================

describe('projectValidator / timeline', () => {
  it('VT01: totalFrames 负数返回 error', () => {
    const proj = makeValidProject()
    proj.timeline.totalFrames = -1
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('VT02: fps 超出范围产生 warning', () => {
    const proj = makeValidProject()
    proj.timeline.fps = 999
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'timeline.fps')).toBe(true)
  })

  it('VT03: tracks 非数组返回 error', () => {
    const proj = makeValidProject()
    ;(proj.timeline as { tracks?: unknown }).tracks = 'not array'
    const result = validateProject(proj)
    expect(result.valid).toBe(false)
  })

  it('VT04: currentFrame 负数产生 warning', () => {
    const proj = makeValidProject()
    proj.timeline.currentFrame = -1
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.field === 'timeline.currentFrame')).toBe(true)
  })
})

// ============================================================================
// 5. 版本比较
// ============================================================================

describe('projectValidator / 版本比较', () => {
  it('VER01: 相同版本返回 0', () => {
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
  })

  it('VER02: a > b 返回 1', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1)
  })

  it('VER03: a < b 返回 -1', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
  })

  it('VER04: major 版本差异', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1)
  })

  it('VER05: patch 版本差异', () => {
    expect(compareVersions('0.1.2', '0.1.1')).toBe(1)
  })

  it('VER06: 非数字段视为 0', () => {
    expect(compareVersions('0.1.x', '0.1.0')).toBe(0)
  })

  it('VER07: 文件版本高于当前版本产生 warning', () => {
    const proj = makeValidProject()
    proj.metadata.version = '99.0.0'
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.message.includes('高于当前支持'))).toBe(true)
  })

  it('VER08: 文件版本等于当前版本无 warning', () => {
    const proj = makeValidProject()
    proj.metadata.version = PROJECT_FILE_VERSION
    const result = validateProject(proj)
    expect(result.issues.some((i) => i.message.includes('高于当前支持'))).toBe(false)
  })
})

// ============================================================================
// 6. 格式化
// ============================================================================

describe('projectValidator / 格式化', () => {
  it('F01: 全通过返回"校验通过"', () => {
    const result: ValidationResult = { valid: true, issues: [], errorCount: 0, warningCount: 0 }
    expect(formatValidationResult(result)).toBe('项目文件校验通过')
  })

  it('F02: 包含错误信息', () => {
    const result: ValidationResult = {
      valid: false,
      issues: [
        { severity: 'error', field: 'metadata.id', message: 'id 必须非空' },
      ],
      errorCount: 1,
      warningCount: 0,
    }
    const text = formatValidationResult(result)
    expect(text).toContain('1 个错误')
    expect(text).toContain('metadata.id')
    expect(text).toContain('id 必须非空')
  })

  it('F03: 包含警告信息', () => {
    const result: ValidationResult = {
      valid: true,
      issues: [
        { severity: 'warning', field: 'timeline.fps', message: 'fps 超出范围' },
      ],
      errorCount: 0,
      warningCount: 1,
    }
    const text = formatValidationResult(result)
    expect(text).toContain('1 个警告')
  })
})

// ============================================================================
// 7. 提取 / isProjectFile
// ============================================================================

describe('projectValidator / 提取', () => {
  it('EX01: 校验通过时提取 metadata', () => {
    const proj = makeValidProject()
    const result = validateProject(proj)
    const meta = extractMetadata(result, proj)
    expect(meta).not.toBeNull()
    expect(meta?.id).toBe('test-001')
  })

  it('EX02: 校验失败时返回 null', () => {
    const result = validateProject('not project')
    const meta = extractMetadata(result, 'not project')
    expect(meta).toBeNull()
  })

  it('I01: isProjectFile 合法项目返回 true', () => {
    const proj = makeValidProject()
    expect(isProjectFile(proj)).toBe(true)
  })

  it('I02: isProjectFile 非法项目返回 false', () => {
    expect(isProjectFile({ foo: 'bar' })).toBe(false)
  })

  it('I03: isProjectFile null 返回 false', () => {
    expect(isProjectFile(null)).toBe(false)
  })
})
