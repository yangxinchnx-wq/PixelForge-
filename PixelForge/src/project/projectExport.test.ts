/**
 * projectExport.test.ts — 批量导出 + manifest 测试。
 *
 * 测试分组:
 *   P: prepareProjectExport / B: prepareBatchExport / M: manifest
 *   S: serialize/deserialize manifest / V: validateManifest
 *   D: 拖拽辅助 / C: 常量
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  prepareProjectExport,
  prepareBatchExport,
  serializeManifest,
  deserializeManifest,
  validateManifest,
  extractDroppedFiles,
  hasDroppableFiles,
  triggerDownload,
  MANIFEST_FORMAT_VERSION,
  type ExportManifest,
  type ManifestProjectEntry,
} from './projectExport'
import type { PixelForgeProject } from './types'
import { PROJECT_FILE_VERSION, PROJECT_FILE_EXTENSION } from './types'

// —— 测试辅助 ——

function makeProject(overrides: { id?: string; name?: string } = {}): PixelForgeProject {
  return {
    metadata: {
      id: overrides.id ?? 'p1',
      name: overrides.name ?? 'Project 1',
      version: PROJECT_FILE_VERSION,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      scenario: 'blend_demo',
      canvasSize: { width: 1024, height: 768 },
    },
    renderIR: {
      canvas: { width: 1024, height: 768 },
      layers: [{ id: 'layer_0', opcode: 0, params: {}, source: 'system_default', paramOwnership: {}, visible: true, blendMode: 'normal' }],
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

function makeManifestEntry(): ManifestProjectEntry {
  return {
    id: 'p1',
    name: 'Project 1',
    version: '0.1.0',
    fileName: 'Project 1.pixelforge',
    fileSize: 1000,
    checksum: 'deadbeef',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    canvasSize: { width: 1024, height: 768 },
  }
}

// ============================================================================
// 1. 单项目导出
// ============================================================================

describe('projectExport / prepareProjectExport', () => {
  it('P01: 返回完整导出结果', () => {
    const proj = makeProject()
    const result = prepareProjectExport(proj)
    expect(result.metadata.id).toBe('p1')
    expect(result.json).toBeDefined()
    expect(result.fileName).toBe('Project 1.pixelforge')
    expect(result.fileSize).toBeGreaterThan(0)
    expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
    expect(result.validation).toBeDefined()
  })

  it('P02: 文件名包含扩展名', () => {
    const proj = makeProject({ name: 'Starry' })
    const result = prepareProjectExport(proj)
    expect(result.fileName).toBe('Starry.pixelforge')
  })

  it('P03: 文件名清洗非法字符', () => {
    const proj = makeProject({ name: 'Star/Night?' })
    const result = prepareProjectExport(proj)
    expect(result.fileName).toBe('Star_Night_.pixelforge')
  })

  it('P04: checksum 是 8 位 hex', () => {
    const proj = makeProject()
    const result = prepareProjectExport(proj)
    expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
  })

  it('P05: 相同项目产生相同 checksum(确定性)', () => {
    const proj = makeProject()
    const r1 = prepareProjectExport(proj)
    const r2 = prepareProjectExport(proj)
    expect(r1.checksum).toBe(r2.checksum)
  })

  it('P06: 不同项目产生不同 checksum', () => {
    const r1 = prepareProjectExport(makeProject({ id: 'p1', name: 'A' }))
    const r2 = prepareProjectExport(makeProject({ id: 'p2', name: 'B' }))
    expect(r1.checksum).not.toBe(r2.checksum)
  })

  it('P07: 校验结果存在 valid 字段', () => {
    const result = prepareProjectExport(makeProject())
    expect(result.validation.valid).toBe(true)
  })
})

// ============================================================================
// 2. 批量导出
// ============================================================================

describe('projectExport / prepareBatchExport', () => {
  it('B01: 单项目批量导出', () => {
    const projects = [makeProject()]
    const result = prepareBatchExport(projects)
    expect(result.items).toHaveLength(1)
    expect(result.manifest.projectCount).toBe(1)
    expect(result.successCount).toBe(1)
    expect(result.failureCount).toBe(0)
  })

  it('B02: 多项目批量导出', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'A' }),
      makeProject({ id: 'p2', name: 'B' }),
      makeProject({ id: 'p3', name: 'C' }),
    ]
    const result = prepareBatchExport(projects)
    expect(result.items).toHaveLength(3)
    expect(result.manifest.projectCount).toBe(3)
  })

  it('B03: 空列表批量导出', () => {
    const result = prepareBatchExport([])
    expect(result.items).toHaveLength(0)
    expect(result.manifest.projectCount).toBe(0)
    expect(result.successCount).toBe(0)
  })

  it('B04: manifest projects 条目与 items 对应', () => {
    const projects = [makeProject({ id: 'p1', name: 'A' })]
    const result = prepareBatchExport(projects)
    expect(result.manifest.projects[0].id).toBe('p1')
    expect(result.manifest.projects[0].name).toBe('A')
    expect(result.manifest.projects[0].fileName).toBe(result.items[0].fileName)
    expect(result.manifest.projects[0].checksum).toBe(result.items[0].checksum)
  })

  it('B05: manifest formatVersion 与常量一致', () => {
    const result = prepareBatchExport([makeProject()])
    expect(result.manifest.formatVersion).toBe(MANIFEST_FORMAT_VERSION)
  })

  it('B06: manifest exportedAt 是合理时间戳', () => {
    const before = Date.now()
    const result = prepareBatchExport([makeProject()])
    const after = Date.now()
    expect(result.manifest.exportedAt).toBeGreaterThanOrEqual(before)
    expect(result.manifest.exportedAt).toBeLessThanOrEqual(after)
  })
})

// ============================================================================
// 3. manifest 序列化
// ============================================================================

describe('projectExport / manifest 序列化', () => {
  it('S01: serializeManifest 输出 JSON', () => {
    const result = prepareBatchExport([makeProject()])
    const json = serializeManifest(result.manifest)
    expect(JSON.parse(json)).toEqual(result.manifest)
  })

  it('S02: deserializeManifest 正常解析', () => {
    const result = prepareBatchExport([makeProject()])
    const json = serializeManifest(result.manifest)
    const restored = deserializeManifest(json)
    expect(restored).toEqual(result.manifest)
  })

  it('S03: deserializeManifest JSON 解析失败返回 null', () => {
    expect(deserializeManifest('not json')).toBeNull()
  })

  it('S04: deserializeManifest 非对象返回 null', () => {
    expect(deserializeManifest('"string"')).toBeNull()
  })

  it('S05: deserializeManifest 缺少 formatVersion 返回 null', () => {
    const manifest = { exportedAt: 1, projectCount: 0, projects: [] }
    expect(deserializeManifest(JSON.stringify(manifest))).toBeNull()
  })

  it('S06: deserializeManifest projects 非数组返回 null', () => {
    const manifest = { formatVersion: '1.0', exportedAt: 1, projectCount: 0, projects: 'not array' }
    expect(deserializeManifest(JSON.stringify(manifest))).toBeNull()
  })
})

// ============================================================================
// 4. manifest 校验
// ============================================================================

describe('projectExport / validateManifest', () => {
  it('V01: 合法 manifest 通过', () => {
    const manifest: ExportManifest = {
      formatVersion: MANIFEST_FORMAT_VERSION,
      exportedAt: 1700000000000,
      projectCount: 1,
      projects: [makeManifestEntry()],
    }
    expect(validateManifest(manifest)).toBe(true)
  })

  it('V02: formatVersion 不匹配返回 false', () => {
    const manifest: ExportManifest = {
      formatVersion: '0.9',
      exportedAt: 1,
      projectCount: 1,
      projects: [makeManifestEntry()],
    }
    expect(validateManifest(manifest)).toBe(false)
  })

  it('V03: projectCount 与 projects.length 不一致返回 false', () => {
    const manifest: ExportManifest = {
      formatVersion: MANIFEST_FORMAT_VERSION,
      exportedAt: 1,
      projectCount: 2,
      projects: [makeManifestEntry()],
    }
    expect(validateManifest(manifest)).toBe(false)
  })

  it('V04: 条目 id 非字符串返回 false', () => {
    const manifest: ExportManifest = {
      formatVersion: MANIFEST_FORMAT_VERSION,
      exportedAt: 1,
      projectCount: 1,
      projects: [{ ...makeManifestEntry(), id: 123 as unknown as string }],
    }
    expect(validateManifest(manifest)).toBe(false)
  })

  it('V05: 条目 checksum 非字符串返回 false', () => {
    const manifest: ExportManifest = {
      formatVersion: MANIFEST_FORMAT_VERSION,
      exportedAt: 1,
      projectCount: 1,
      projects: [{ ...makeManifestEntry(), checksum: undefined as unknown as string }],
    }
    expect(validateManifest(manifest)).toBe(false)
  })

  it('V06: 空列表合法', () => {
    const manifest: ExportManifest = {
      formatVersion: MANIFEST_FORMAT_VERSION,
      exportedAt: 1,
      projectCount: 0,
      projects: [],
    }
    expect(validateManifest(manifest)).toBe(true)
  })
})

// ============================================================================
// 5. 拖拽辅助
// ============================================================================

describe('projectExport / 拖拽辅助', () => {
  function makeDragEvent(files: File[]): DragEvent {
    return {
      dataTransfer: { files: files as unknown as FileList },
    } as DragEvent
  }

  it('D01: extractDroppedFiles 过滤 .pixelforge 文件', () => {
    const files = [
      new File(['{}'], 'a.pixelforge'),
      new File(['{}'], 'b.txt'),
    ]
    const result = extractDroppedFiles(makeDragEvent(files))
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('a.pixelforge')
  })

  it('D02: extractDroppedFiles 也接受 application/json', () => {
    const files = [
      new File(['{}'], 'a.json', { type: 'application/json' }),
    ]
    const result = extractDroppedFiles(makeDragEvent(files))
    expect(result).toHaveLength(1)
  })

  it('D03: extractDroppedFiles 空列表', () => {
    const result = extractDroppedFiles(makeDragEvent([]))
    expect(result).toHaveLength(0)
  })

  it('D04: extractDroppedFiles 无 dataTransfer 返回空', () => {
    const event = { dataTransfer: null } as DragEvent
    expect(extractDroppedFiles(event)).toHaveLength(0)
  })

  it('D05: hasDroppableFiles 有合法文件返回 true', () => {
    const files = [new File(['{}'], 'a.pixelforge')]
    expect(hasDroppableFiles(makeDragEvent(files))).toBe(true)
  })

  it('D06: hasDroppableFiles 无合法文件返回 false', () => {
    const files = [new File(['{}'], 'a.txt')]
    expect(hasDroppableFiles(makeDragEvent(files))).toBe(false)
  })
})

// ============================================================================
// 6. triggerDownload(浏览器 API mock)
// ============================================================================

describe('projectExport / triggerDownload', () => {
  let createdAnchors: HTMLAnchorElement[] = []
  let revokedUrls: string[] = []

  beforeEach(() => {
    createdAnchors = []
    revokedUrls = []
    // 简单 mock,只验证不抛错
    vi.stubGlobal('document', {
      createElement: () => {
        const anchor = {
          href: '',
          download: '',
          style: { display: '' },
          click: () => {},
        } as unknown as HTMLAnchorElement
        createdAnchors.push(anchor)
        return anchor
      },
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
    })
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:mock',
      revokeObjectURL: (url: string) => { revokedUrls.push(url) },
    })
    vi.stubGlobal('Blob', class MockBlob {
      constructor(private parts: string[]) {}
      get size() { return this.parts.join('').length }
    })
  })

  it('D07: triggerDownload 不抛错', () => {
    expect(() => triggerDownload('{}', 'test.pixelforge')).not.toThrow()
  })
})

// ============================================================================
// 7. 常量
// ============================================================================

describe('projectExport / 常量', () => {
  it('C01: MANIFEST_FORMAT_VERSION = "1.0"', () => {
    expect(MANIFEST_FORMAT_VERSION).toBe('1.0')
  })
  it('C02: PROJECT_FILE_EXTENSION 仍为 .pixelforge', () => {
    expect(PROJECT_FILE_EXTENSION).toBe('.pixelforge')
  })
})
